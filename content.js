// Runs in every page/frame of an allowed site. While recording, reports each real user action to the
// service worker, which takes the screenshot: clicks, typing (when the field is committed), Enter in a
// field, and dropdown choices. Only element *labels* are sent, plus the chosen option of a dropdown.
// Typed text and field values are never read or sent.
(() => {
  if (window.__testimonyLoaded) return;
  window.__testimonyLoaded = true;

  let recording = false;
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  chrome.storage.local.get('recording').then((r) => { recording = !!r.recording; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recording) recording = !!changes.recording.newValue;
  });

  const INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch]';
  const BUTTON_TYPES = ['button', 'submit', 'reset'];
  const TEXT_TYPES = new Set(['text', 'email', 'search', 'tel', 'url', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week']);

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const isTextField = (el) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.has(el.type));
  const isSelect = (el) => el.tagName === 'SELECT';
  const isFileInput = (el) => el.tagName === 'INPUT' && el.type === 'file';

  // ---- Naming --------------------------------------------------------------------------------

  // Human label for an element. `nameFallback` also tries name/id, for form fields that have no visible label.
  function labelOf(el, { nameFallback = false } = {}) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let label =
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      '';
    if (!label && tag === 'input' && BUTTON_TYPES.includes(type)) label = el.value;
    if (!label && tag !== 'input' && tag !== 'textarea' && tag !== 'select') label = el.innerText || el.textContent;
    if (!label && nameFallback) label = (el.name || el.id || '').replace(/[_-]+/g, ' ');
    return clean(label);
  }

  function nounFor(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || (tag === 'input' && BUTTON_TYPES.includes(type))) return 'button';
    if ((tag === 'input' && type === 'checkbox') || role === 'checkbox' || role === 'switch') return 'checkbox';
    if ((tag === 'input' && type === 'radio') || role === 'radio') return 'option';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu item';
    if (tag === 'input' || tag === 'textarea') return 'field';
    return '';
  }

  function describeClick(el) {
    const label = labelOf(el);
    const noun = nounFor(el);
    if (label && noun) return `Click the '${label}' ${noun}`;
    if (label) return `Click '${label}'`;
    return noun ? `Click the ${noun}` : 'Click';
  }

  const fieldName = (el) => (el.type === 'password' ? '' : labelOf(el, { nameFallback: true }));

  function typedTitle(el) {
    if (el.type === 'password') return 'Typed in the password field';
    const name = fieldName(el);
    return name ? `Typed in the '${name}' field` : 'Typed in the field';
  }

  function pressedEnterTitle(el) {
    if (el.type === 'password') return 'Pressed Enter in the password field';
    const name = fieldName(el);
    return name ? `Pressed Enter in the '${name}' field` : 'Pressed Enter';
  }

  function selectTitle(el) {
    const name = fieldName(el);
    const chosen = [...el.selectedOptions].map((o) => clean(o.label || o.textContent)).filter(Boolean);
    const what = chosen.length === 1 ? `'${chosen[0]}'` : chosen.length > 1 ? `${chosen.length} options` : 'an option';
    return name ? `Selected ${what} in the '${name}' dropdown` : `Selected ${what} in the dropdown`;
  }

  function fileTitle(el) {
    const name = fieldName(el);
    return name ? `Chose a file for the '${name}' field` : 'Chose a file';
  }

  // ---- Geometry (in top-level viewport coordinates) ----------------------------------------------

  // Offset of this frame inside the top-level viewport (same-origin frames only).
  function topFrame() {
    let ox = 0, oy = 0, w = window;
    try {
      while (w !== w.top) {
        const fe = w.frameElement;
        if (!fe) return null;
        const r = fe.getBoundingClientRect();
        ox += r.left; oy += r.top;
        w = w.parent;
      }
      return { ox, oy, vw: w.innerWidth, vh: w.innerHeight };
    } catch {
      return null;
    }
  }

  function rectOf(el) {
    const f = topFrame();
    if (!f) return null;
    const r = el.getBoundingClientRect();
    const pad = 4;
    return { x: r.left + f.ox - pad, y: r.top + f.oy - pad, w: r.width + pad * 2, h: r.height + pad * 2, vw: f.vw, vh: f.vh };
  }

  function centerOf(el) {
    const f = topFrame();
    if (!f) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 + f.ox, y: r.top + r.height / 2 + f.oy, vw: f.vw, vh: f.vh };
  }

  // ---- Reporting -------------------------------------------------------------------------------------

  // kind: 'click' | 'key' (Enter: the page is about to react, so the screenshot waits) | 'input' (typing/dropdown: immediate)
  function report(kind, title, { point = null, rect = null } = {}) {
    if (!alive()) return;
    const msg = { type: 'click-step', kind, title, url: location.href, pageTitle: document.title, point, rect };
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* extension reloaded */ }
  }

  // ---- Clicks -------------------------------------------------------------------------------------------

  // Clicking a <label> makes the browser fire a second click on its control; record only one step.
  let forwarded = null;
  let forwardedAt = 0;

  function onClick(e) {
    if (!recording || !e.isTrusted) return;
    if (!alive()) { document.removeEventListener('click', onClick, true); return; }
    const raw = e.target instanceof Element ? e.target : e.target.parentElement;
    if (!raw) return;
    if (raw === forwarded && Date.now() - forwardedAt < 100) { forwarded = null; return; }
    let el = raw.closest(INTERACTIVE) || raw;
    if (el.tagName === 'LABEL' && el.control) {
      forwarded = el.control;
      forwardedAt = Date.now();
      el = el.control;
    }
    // Typing and dropdown choices are recorded from their own events. The click that focuses them is noise.
    if (isTextField(el) || isSelect(el)) return;

    // A keyboard-activated click (Enter/Space on a focused button) has no pointer position.
    const keyboard = e.detail === 0 || (e.clientX === 0 && e.clientY === 0);
    const frame = topFrame();
    const point = keyboard
      ? centerOf(el)
      : frame ? { x: e.clientX + frame.ox, y: e.clientY + frame.oy, vw: frame.vw, vh: frame.vh } : null;
    report('click', describeClick(el), { point });
  }
  document.addEventListener('click', onClick, true);

  // ---- Typing, Enter, dropdowns ----------------------------------------------------------------------------

  // A text field counts as "typed in" once its value is committed (blur or Enter), not per keystroke.
  const dirty = new WeakSet();

  document.addEventListener('input', (e) => {
    if (recording && e.isTrusted && e.target instanceof Element && isTextField(e.target)) dirty.add(e.target);
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!recording || !e.isTrusted || !(el instanceof Element)) return;
    if (isSelect(el)) return report('input', selectTitle(el), { rect: rectOf(el) });
    if (isFileInput(el)) return report('input', fileTitle(el), { rect: rectOf(el) });
    if (isTextField(el) && dirty.delete(el)) report('input', typedTitle(el), { rect: rectOf(el) });
  }, true);

  // Enter in a single-line field submits it. One step covers the typing and the Enter, so the
  // "change" event that follows finds the field already clean and adds nothing.
  document.addEventListener('keydown', (e) => {
    if (!recording || !e.isTrusted || e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const el = e.target;
    if (!(el instanceof Element) || el.tagName !== 'INPUT' || !isTextField(el)) return;
    const typed = dirty.delete(el);
    report('key', typed ? `${typedTitle(el)} and pressed Enter` : pressedEnterTitle(el), { rect: rectOf(el) });
  }, true);

  // ---- Presence ping ---------------------------------------------------------------------------------------------

  // The service worker pings the active tab to learn whether a recorder is present. Top frame answers.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'ping' && window === window.top) sendResponse({ ok: true, recording });
  });
})();

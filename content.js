// Runs in every page/frame of an allowed site. While recording, reports each real user action to the
// service worker, which takes the screenshot: clicks, typing (when the field is committed), Enter in a
// field, and dropdown choices. Only element *labels* are sent, plus the chosen option of a dropdown.
// Typed text and field values are never read or sent.
(() => {
  if (window.__testimonyLoaded) return;
  window.__testimonyLoaded = true;

  let recording = false;
  let known = false; // true once we know whether recording is on
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  // The recorder is injected at document_start so nothing done during a page load is missed. Actions in the first
  // few milliseconds wait on this promise for the answer instead of being dropped.
  const ready = chrome.storage.local.get('recording')
    .then((r) => { recording = !!r.recording; })
    .catch(() => {})
    .then(() => { known = true; });
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

  let counter = 0;
  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${counter++}`;

  // Sends with a couple of retries (the extension's service worker can be starting up). Every message carries
  // an id so a retry that was in fact delivered is not recorded twice.
  function send(msg, attempt = 0) {
    if (!alive()) return;
    try {
      chrome.runtime.sendMessage(msg).catch(() => {
        if (attempt < 2) setTimeout(() => send(msg, attempt + 1), 250 * (attempt + 1));
      });
    } catch { /* extension reloaded */ }
  }

  // kind: 'click' | 'key' (Enter: the page is about to react, so the screenshot waits) | 'input' (typing/dropdown: immediate)
  // `nav`: the click is on a link, so the page is about to change and the screenshot must not wait. `pre`: id of the
  // early screenshot requested when the mouse went down, which this step should use.
  function report(kind, title, { point = null, rect = null, nav = false, pre = null } = {}) {
    const msg = { type: 'click-step', id: newId(), kind, title, url: location.href, pageTitle: document.title, point, rect };
    if (nav) msg.nav = true;
    if (pre) msg.pre = pre;
    ready.then(() => { if (recording) send(msg); });
  }

  const idle = () => known && !recording; // cheap early exit for the common "not recording" case

  // ---- Clicks -------------------------------------------------------------------------------------------
  //
  // Most clicks arrive as a normal "click" event. Pages that act on mouse-down and remove or replace the element
  // (custom menus, some buttons) never deliver a usable click, so every press is remembered as well: if no click
  // follows and the pressed element has gone, the press is recorded as the click it was.
  // Listeners are on window in the capture phase, registered at document_start, so they run before the page's own
  // handlers and cannot be pre-empted by a page that stops propagation.

  const presses = new Set();
  let forwarded = null; // clicking a <label> makes the browser fire a second click on its control: record one
  let forwardedAt = 0;
  let lastClick = { title: null, x: 0, y: 0, at: 0 };

  // A link with a real destination will replace the page. Same-page anchors (#...), script links, mail/phone links,
  // downloads and menu toggles stay on the page, so their result (an opened menu, a toast) is still worth waiting for.
  function likelyNavigates(el) {
    const a = el.closest('a[href]');
    if (!a || a.hasAttribute('download') || a.hasAttribute('aria-haspopup') || a.hasAttribute('aria-expanded')) return false;
    const href = (a.getAttribute('href') || '').trim();
    return !!href && !href.startsWith('#') && !/^(javascript|mailto|tel):/i.test(href);
  }

  // Everything we need to describe an action, worked out immediately because the page may change the DOM next.
  function snapshot(raw, e, keyboard) {
    let el = raw.closest(INTERACTIVE) || raw;
    let viaLabel = false;
    if (el.tagName === 'LABEL' && el.control) { el = el.control; viaLabel = true; }
    const frame = topFrame();
    const point = keyboard
      ? centerOf(el)
      : frame ? { x: e.clientX + frame.ox, y: e.clientY + frame.oy, vw: frame.vw, vh: frame.vh } : null;
    // Typing and dropdown choices are recorded from their own events. The click that focuses them is noise.
    return { el, viaLabel, title: describeClick(el), point, nav: likelyNavigates(el), skip: isTextField(el) || isSelect(el) };
  }

  const targetOf = (e) => (e.target instanceof Element ? e.target : e.target && e.target.parentElement);

  window.addEventListener('pointerdown', (e) => {
    if (idle() || !e.isTrusted || e.button !== 0) return;
    const raw = targetOf(e);
    if (!raw) return;
    const snap = snapshot(raw, e, false);
    if (snap.skip) return;
    const now = Date.now();
    const press = { ...snap, pointerId: e.pointerId, at: now, done: false, released: false, pre: null };
    // The second press of a double-click is collapsed into the first step, so it needs no early screenshot of its own.
    const repeat = snap.title === lastClick.title && now - lastClick.at < 300 && snap.point
      && Math.abs(snap.point.x - lastClick.x) < 8 && Math.abs(snap.point.y - lastClick.y) < 8;
    if (snap.nav && !repeat) {
      // The page is about to change: ask for a screenshot now, while the link is still on screen. The click that
      // follows will reuse it (it is thrown away if no click comes, e.g. a drag).
      press.pre = newId();
      ready.then(() => { if (recording) send({ type: 'pre-shot', id: press.pre }); });
    }
    presses.add(press);
    setTimeout(() => presses.delete(press), 3000);
  }, true);

  window.addEventListener('pointerup', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    const press = [...presses].reverse().find((p) => p.pointerId === e.pointerId && !p.released);
    if (!press) return;
    press.released = true;
    setTimeout(() => {
      // A normal click arrives within a few milliseconds. If none did and the element is gone, the page swallowed it.
      if (!press.done && !press.el.isConnected) { press.done = true; report('click', press.title, { point: press.point, nav: press.nav, pre: press.pre }); }
    }, 350);
  }, true);

  function onClick(e) {
    if (!e.isTrusted) return;
    if (!alive()) { window.removeEventListener('click', onClick, true); return; }
    if (idle()) return;
    const raw = targetOf(e);
    if (!raw) return;
    const keyboard = e.detail === 0 || (e.clientX === 0 && e.clientY === 0); // Enter/Space on a focused button
    const now = Date.now();

    const press = keyboard ? null : [...presses].reverse().find((p) => !p.done && now - p.at < 3000);
    if (press) press.done = true;

    if (raw === forwarded && now - forwardedAt < 100) { forwarded = null; return; }
    let snap = snapshot(raw, e, keyboard);
    if (snap.viaLabel) { forwarded = snap.el; forwardedAt = now; }
    // The page replaced what was pressed: describe what the user actually pressed, not what is now under the pointer.
    if (press && !press.el.isConnected) snap = press;
    if (snap.skip) return;

    // A true double-click (the browser says so, at the same spot, within 300 ms) is one step. Two deliberate
    // clicks on the same control, even quick ones, are two steps.
    const spot = snap.point ? { x: snap.point.x, y: snap.point.y } : { x: 0, y: 0 };
    const sameSpot = Math.abs(spot.x - lastClick.x) < 8 && Math.abs(spot.y - lastClick.y) < 8;
    if (e.detail > 1 && snap.title === lastClick.title && sameSpot && now - lastClick.at < 300) return;
    lastClick = { title: snap.title, x: spot.x, y: spot.y, at: now };

    report('click', snap.title, { point: snap.point, nav: snap.nav, pre: press ? press.pre : null });
  }
  window.addEventListener('click', onClick, true);

  // ---- Typing, Enter, dropdowns ----------------------------------------------------------------------------

  // A text field counts as "typed in" once its value is committed (blur or Enter), not per keystroke.
  const dirty = new WeakSet();

  window.addEventListener('input', (e) => {
    if (e.isTrusted && e.target instanceof Element && isTextField(e.target)) dirty.add(e.target);
  }, true);

  window.addEventListener('change', (e) => {
    const el = e.target;
    if (idle() || !e.isTrusted || !(el instanceof Element)) return;
    if (isSelect(el)) return report('input', selectTitle(el), { rect: rectOf(el) });
    if (isFileInput(el)) return report('input', fileTitle(el), { rect: rectOf(el) });
    if (isTextField(el) && dirty.delete(el)) report('input', typedTitle(el), { rect: rectOf(el) });
  }, true);

  // Enter in a single-line field submits it. One step covers the typing and the Enter, so the
  // "change" event that follows finds the field already clean and adds nothing.
  window.addEventListener('keydown', (e) => {
    if (idle() || !e.isTrusted || e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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

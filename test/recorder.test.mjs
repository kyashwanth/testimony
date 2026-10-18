// Runs the real content.js (the recorder that lives in web pages) in a sandbox with a minimal fake DOM, so its
// decisions are checked in CI: which clicks count as navigation, the early "press" screenshot request, double-click
// collapse, buttons that vanish on press, retries, and never recording when recording is off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a tiny DOM: just what the recorder touches ------------------------------------------------------------------
class FakeElement {
  constructor(tag, { attrs = {}, text = '', parent = null, type = '', connected = true } = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.innerText = text; this.textContent = text;
    this.parent = parent; this.type = type; this.connected = connected; this.labels = null; this.control = null; this.value = '';
  }
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  hasAttribute(n) { return n in this.attrs; }
  getBoundingClientRect() { return { left: 100, top: 50, width: 80, height: 24 }; }
  matches(selector) {
    return selector.split(',').some((part) => {
      const m = part.trim().match(/^([a-z0-9]*)(?:\[([a-z-]+)(?:=([^\]]+))?\])?$/);
      if (!m) return false;
      const [, tag, attr, value] = m;
      if (tag && this.tagName.toLowerCase() !== tag) return false;
      if (attr && !(attr in this.attrs)) return false;
      if (attr && value !== undefined && this.attrs[attr] !== value) return false;
      return true;
    });
  }
  closest(selector) { for (let n = this; n; n = n.parent) if (n.matches(selector)) return n; return null; }
}

function startRecorder({ recording = true, failFirstSend = false } = {}) {
  const listeners = {};
  const sent = [];
  let calls = 0;
  const win = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    innerWidth: 1000, innerHeight: 700, frameElement: null,
  };
  win.top = win;
  const chrome = {
    runtime: {
      id: 'test',
      sendMessage(msg) { calls++; if (failFirstSend && calls === 1) return Promise.reject(new Error('no receiver')); sent.push(msg); return Promise.resolve(); },
      onMessage: { addListener() {} },
    },
    storage: { local: { get: async () => ({ recording }) }, onChanged: { addListener() {} } },
  };
  vm.runInNewContext(SOURCE, { window: win, document: { title: 'Page' }, location: { href: 'https://uat.example.com/p' }, chrome, Element: FakeElement, setTimeout, Date, Promise, WeakSet, Set, Math });
  let pointer = 0;
  const fire = (type, props) => (listeners[type] || []).forEach((fn) => fn({ isTrusted: true, button: 0, detail: 0, ...props }));
  const at = (x, y) => ({ clientX: x, clientY: y });
  // a full mouse click: press, release, click
  const click = async (target, { x = 120, y = 60, detail = 1, gap = 5 } = {}) => {
    const id = ++pointer;
    fire('pointerdown', { target, pointerId: id, ...at(x, y) });
    await sleep(gap);
    fire('pointerup', { target, pointerId: id, ...at(x, y) });
    fire('click', { target, detail, ...at(x, y) });
  };
  return { sent, fire, click, at };
}
const link = (href, extra = {}, text = 'Orders') => new FakeElement('a', { attrs: { href, ...extra }, text });
const button = (text = 'Save') => new FakeElement('button', { text });
const settle = () => sleep(30); // let the recorder's "ready" promise resolve

// ---- links are navigation, in-page links and buttons are not ------------------------------------------------------
{
  const r = startRecorder(); await settle();
  const a = link('/orders');
  await r.click(a);
  await settle();
  assert.deepEqual(r.sent.map((m) => m.type), ['pre-shot', 'click-step'], 'an early screenshot is requested at the press, then the step');
  const [pre, step] = r.sent;
  assert.equal(step.nav, true);
  assert.equal(step.pre, pre.id, 'the step names the early screenshot it should use');
  assert.equal(step.title, "Click the 'Orders' link");
  assert.deepEqual([Math.round(step.point.x), Math.round(step.point.y)], [120, 60]);
  assert.ok(step.id && step.id !== pre.id);
  console.log('ok  a link press requests an early screenshot and the click carries its id');
}
for (const [name, el] of [
  ['an in-page #anchor', link('#top')],
  ['a javascript: link', link('javascript:void(0)')],
  ['a mailto: link', link('mailto:a@example.com')],
  ['a tel: link', link('tel:+10000000')],
  ['an empty href', link('')],
  ['a download link', link('/file.pdf', { download: '' })],
  ['a menu toggle (aria-haspopup)', link('/menu', { 'aria-haspopup': 'true' })],
  ['an expandable link (aria-expanded)', link('/more', { 'aria-expanded': 'false' })],
  ['an anchor with no href', new FakeElement('a', { text: 'Orders' })],
  ['a plain button', button()],
]) {
  const r = startRecorder(); await settle();
  await r.click(el); await settle();
  assert.deepEqual(r.sent.map((m) => m.type), ['click-step'], `${name}: no early screenshot`);
  assert.ok(!r.sent[0].nav && !r.sent[0].pre, `${name}: not treated as navigation, so it keeps the delay that shows the result`);
}
console.log('ok  in-page links, script/mail/phone links, downloads, menu toggles and buttons are not navigation');

// a child of a link counts as the link
{
  const a = link('/orders'); const span = new FakeElement('span', { parent: a, text: 'Orders' });
  const r = startRecorder(); await settle();
  await r.click(span); await settle();
  assert.equal(r.sent[1].nav, true);
  console.log('ok  a click on something inside a link counts as the link');
}

// ---- double-click collapse, quick repeats ------------------------------------------------------------------------------
{
  const r = startRecorder(); await settle();
  const a = link('/orders');
  await r.click(a, { detail: 1, gap: 2 });
  await r.click(a, { detail: 2, gap: 2 });          // the second press and click of a double-click
  await settle();
  assert.deepEqual(r.sent.map((m) => m.type), ['pre-shot', 'click-step'], 'one early screenshot and one step for a double-click');
  console.log('ok  a double-click on a link is one step and one early screenshot');
}
{
  const r = startRecorder(); await settle();
  const b = button('Next');
  await r.click(b, { detail: 1 });
  await sleep(350);                                  // slower than a double-click
  await r.click(b, { detail: 1 });
  await settle();
  assert.equal(r.sent.filter((m) => m.type === 'click-step').length, 2, 'two deliberate clicks are two steps');
  const c = startRecorder(); await settle();
  await c.click(b, { detail: 1, gap: 2 });
  await c.click(b, { detail: 2, gap: 2 });
  await settle();
  assert.equal(c.sent.filter((m) => m.type === 'click-step').length, 1, 'a true double-click is one step');
  console.log('ok  deliberate repeats are separate steps; a true double-click is one');
}

// ---- a control that disappears on press ---------------------------------------------------------------------------------
{
  const r = startRecorder(); await settle();
  const a = link('/orders');
  r.fire('pointerdown', { target: a, pointerId: 9, ...r.at(120, 60) });
  a.connected = false;                               // the page removed it on mouse-down, so no click will arrive
  r.fire('pointerup', { target: a, pointerId: 9, ...r.at(120, 60) });
  await sleep(900);
  const steps = r.sent.filter((m) => m.type === 'click-step');
  assert.equal(steps.length, 1, 'the press is recorded as the click it was');
  assert.equal(steps[0].title, "Click the 'Orders' link");
  assert.equal(steps[0].nav, true);
  assert.equal(steps[0].pre, r.sent.find((m) => m.type === 'pre-shot').id);
  console.log('ok  a control that vanishes on mouse-down is still recorded, with its early screenshot');
}
{
  const r = startRecorder(); await settle();
  const b = button('Drag handle');
  r.fire('pointerdown', { target: b, pointerId: 4, ...r.at(10, 10) });
  r.fire('pointerup', { target: b, pointerId: 4, ...r.at(300, 10) });   // a drag: the element is still there and no click came
  await sleep(900);
  assert.equal(r.sent.length, 0, 'a drag is not a click');
  console.log('ok  a press that becomes a drag records nothing');
}

// ---- keyboard activation ----------------------------------------------------------------------------------------------------
{
  const r = startRecorder(); await settle();
  r.fire('click', { target: link('/orders'), detail: 0, clientX: 0, clientY: 0 });   // Enter on a focused link
  await settle();
  assert.deepEqual(r.sent.map((m) => m.type), ['click-step']);
  assert.equal(r.sent[0].nav, true); assert.ok(!r.sent[0].pre, 'no press, so no early screenshot');
  assert.ok(r.sent[0].point && r.sent[0].point.x > 0, 'the marker goes on the element, not the top-left corner');
  console.log('ok  a link opened with the keyboard is flagged as navigation and marked on the link');
}

// ---- recording off, text fields, delivery ---------------------------------------------------------------------------------------
{
  const r = startRecorder({ recording: false }); await settle();
  await r.click(link('/orders')); await r.click(button());
  r.fire('input', { target: new FakeElement('input', { type: 'text' }) });
  await settle();
  assert.equal(r.sent.length, 0, 'nothing is sent, and no early screenshot is requested, while recording is off');
  console.log('ok  nothing is sent when recording is off');
}
{
  const r = startRecorder(); await settle();
  await r.click(new FakeElement('input', { type: 'text', attrs: { placeholder: 'Email' } }));
  await settle();
  assert.equal(r.sent.length, 0, 'a click into a text field is not a step of its own');
  console.log('ok  a click into a text field is not a step');
}
{
  const r = startRecorder({ failFirstSend: true }); await settle();
  await r.click(button('Pay'));
  await sleep(900);                                  // the first send was rejected; the recorder retries
  assert.equal(r.sent.length, 1, 'the retry delivered it');
  console.log('ok  a message that fails to send is retried');
}

console.log('\nrecorder tests passed');
process.exit(0);

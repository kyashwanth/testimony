// Clicks on links navigate, so a screenshot taken after the usual delay shows the NEXT page and the click marker
// cannot be placed. These tests describe the required behaviour: a link click is photographed as it happens
// (starting at the mouse press), keeps its marker, and when the page changes anyway the step says so.
import assert from 'node:assert/strict';
import { installFakeIndexedDB, installFakeChrome } from './fakes.mjs';

const stores = installFakeIndexedDB();
const t = installFakeChrome({
  granted: ['https://uat.example.com/*'],
  tabs: [{ id: 1, windowId: 1, active: true, url: 'https://uat.example.com/list', title: 'List' }],
});
await import('../background.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 15000) => {
  const end = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > end) throw new Error('timed out waiting for: ' + cond); await sleep(15); }
};
const steps = () => [...stores.steps.rows.values()].sort((a, b) => a.order - b.order);
const sender = (extra = {}) => ({ tab: { id: 1, windowId: 1, active: true, url: t.state.tabs[0].url, ...extra } });
let seq = 0;
const click = (title, extra = {}) => t.send({ type: 'click-step', id: `c${++seq}`, kind: 'click', title, url: t.state.tabs[0].url, pageTitle: 'List',
  point: { x: 200, y: 100, vw: 720, vh: 450 }, ...extra }, sender());
const reset = async () => { await sleep(1300); stores.steps.rows.clear(); t.calls.captureTimes.length = 0; t.calls.quotaErrors = 0; t.state.captureFailures = 0; t.state.tabs[0].url = 'https://uat.example.com/list'; };
const ring = (s) => s.annotations.find((a) => a.type === 'ring');
const banner = (s) => s.annotations.find((a) => a.type === 'text' && /page changed/i.test(a.text));

await t.send({ type: 'start' });
t.store.captureDelayMs = 700;

// 1. A click that navigates during the delay (no hint beforehand) must not silently lose its marker:
//    the screenshot shows the next page, so the step says so.
await reset();
await click('Click the Orders link');
await sleep(150);
t.state.tabs[0].url = 'https://uat.example.com/orders'; // the page changed before the delayed screenshot
await until(() => steps().length === 1);
assert.ok(!ring(steps()[0]), 'no ring: it would point at unrelated content on the new page');
assert.ok(banner(steps()[0]), 'but the step says the page changed, instead of being silently unmarked');
console.log('ok  a navigation during the delay is labelled, not silently unmarked');

// 2. A click flagged as navigating (a link) is photographed immediately, with its marker.
await reset();
const t2 = Date.now();
await click('Click the Orders link', { nav: true });
await until(() => steps().length === 1);
assert.ok(t.calls.captureTimes[0] - t2 < 250, `a link click is captured at once (took ${t.calls.captureTimes[0] - t2} ms), not after the 700 ms delay`);
assert.ok(ring(steps()[0]) && !banner(steps()[0]), 'it keeps its click marker');
console.log('ok  a link click is photographed immediately, with its marker');

// 3. The press is photographed before the click lands, and the click then uses that picture.
await reset();
const t3 = Date.now();
await t.send({ type: 'pre-shot', id: 'press-1' }, sender());
await sleep(120);                                           // the mouse button is held down for a moment
await click('Click the Orders link', { nav: true, pre: 'press-1' });
await until(() => steps().length === 1);
assert.equal(t.calls.captureTimes.length, 1, 'one screenshot for the whole interaction');
assert.ok(t.calls.captureTimes[0] - t3 < 100, 'taken at the press, before the click');
assert.ok(ring(steps()[0]), 'with the click marker');
console.log('ok  the picture is taken at the mouse press and reused by the click');

// 4. Even if the page has already navigated by the time the click is processed, the earlier picture is still the right one.
await reset();
await t.send({ type: 'pre-shot', id: 'press-2' }, sender());
await sleep(80);
t.state.tabs[0].url = 'https://uat.example.com/orders';
await click('Click the Orders link', { nav: true, pre: 'press-2' });
await until(() => steps().length === 1);
assert.ok(ring(steps()[0]) && !banner(steps()[0]), 'the pre-navigation picture keeps its marker and needs no warning');
console.log('ok  a picture taken before navigation keeps its marker');

// 5. If the early picture fails, the step is still recorded (normal capture, or a placeholder).
await reset();
t.state.captureFailures = 99;
await t.send({ type: 'pre-shot', id: 'press-3' }, sender());
await sleep(60);
await click('Click the Orders link', { nav: true, pre: 'press-3' });
await until(() => steps().length === 1, 25000);
assert.equal(steps()[0].title, 'Click the Orders link');
t.state.captureFailures = 0;
console.log('ok  a failed early picture never loses the step');

// 6. An unknown or expired press id simply falls back to the normal path.
await reset();
await click('Click something', { pre: 'no-such-press' });
await until(() => steps().length === 1);
assert.ok(ring(steps()[0]));
console.log('ok  an unknown press id falls back to the normal capture');

// 7. A press from a tab that is not the active one is ignored.
await reset();
await t.send({ type: 'pre-shot', id: 'press-bg' }, sender({ active: false }));
await sleep(150);
assert.equal(t.calls.captureTimes.length, 0, 'no screenshot for an inactive tab');
console.log('ok  an inactive tab is ignored');

// 8. A press that never becomes a click (a drag) creates no step.
await reset();
await t.send({ type: 'pre-shot', id: 'press-drag' }, sender());
await sleep(500);
assert.equal(steps().length, 0);
console.log('ok  a press without a click creates no step');

// 9. A burst of link clicks (press + click each) is complete, in order, and within Chrome's screenshot quota.
await reset();
for (let i = 1; i <= 6; i++) {
  await t.send({ type: 'pre-shot', id: `b${i}` }, sender());
  await sleep(60);
  await click(`Click link ${i}`, { nav: true, pre: `b${i}` });
  await sleep(90);
}
await until(() => steps().length === 6);
assert.deepEqual(steps().map((s) => s.title), [1, 2, 3, 4, 5, 6].map((i) => `Click link ${i}`));
assert.equal(t.calls.quotaErrors, 0, 'never exceeded 2 screenshots per second');
assert.ok(steps().every((s) => !s.captureFailed));
console.log('ok  a burst of link clicks: all steps, in order, no quota errors');

// 10. A change to only the #hash or ?query is the same page: the marker stays and nothing claims the page changed.
await reset();
await click('Click the Files tab');
await sleep(150);
t.state.tabs[0].url = 'https://uat.example.com/list?tab=files#readme';
await until(() => steps().length === 1);
assert.ok(ring(steps()[0]) && !banner(steps()[0]), 'an in-page URL update is not a navigation');
console.log('ok  a hash or query change is not treated as a page change');

// 11. A retried press (same id) keeps the early picture instead of replacing it with a later one.
await reset();
await t.send({ type: 'pre-shot', id: 'press-dup' }, sender());
await sleep(60);
t.state.tabs[0].url = 'https://uat.example.com/orders';       // the link has navigated by the time the retry arrives
await t.send({ type: 'pre-shot', id: 'press-dup' }, sender());
await click('Click the Orders link', { nav: true, pre: 'press-dup' });
await until(() => steps().length === 1);
assert.equal(t.calls.captureTimes.length, 1, 'the duplicate press did not take a second screenshot');
assert.ok(ring(steps()[0]) && !banner(steps()[0]));
console.log('ok  a retried press does not replace the early picture');

// 12. A link opened with the keyboard has no press to photograph: if the page changed before the immediate capture, say so.
await reset();
await click('Click the Orders link', { nav: true });
t.state.tabs[0].url = 'https://uat.example.com/orders';
await until(() => steps().length === 1);
assert.ok(!ring(steps()[0]) && banner(steps()[0]), 'no marker on the wrong page, and a label explains it');
console.log('ok  a keyboard-opened link that already navigated is labelled, not marked');

console.log('\nnavigation click tests passed');
process.exit(0);

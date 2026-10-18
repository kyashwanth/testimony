import assert from 'node:assert/strict';
import { installFakeIndexedDB, installFakeChrome } from './fakes.mjs';

const stores = installFakeIndexedDB();
const t = installFakeChrome({
  granted: ['https://uat.example.com/*'],
  tabs: [{ id: 1, windowId: 1, active: true, url: 'https://uat.example.com/a', title: 'App' }],
});
await import('../background.js');

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting for: ' + cond);
    await settle(10);
  }
};
const steps = () => [...stores.steps.rows.values()].sort((a, b) => a.order - b.order);
const sender = () => ({ tab: { id: 1, windowId: 1, active: true, url: t.state.tabs[0].url } });
const click = (title, extra = {}) =>
  t.send({ type: 'click-step', kind: 'click', title, url: t.state.tabs[0].url, pageTitle: 'App', point: { x: 100, y: 50, vw: 720, vh: 450 }, ...extra }, sender());
const fresh = async () => { // start each scenario from an empty session, past the duplicate + rate-limit windows
  await settle(700);
  stores.steps.rows.clear();
  t.state.tabs[0].url = 'https://uat.example.com/a';
  t.state.tabs[0].active = true;
};

await t.send({ type: 'start' });

// 1. Default delay is 700 ms: nothing at 400 ms, step present after
delete t.store.captureDelayMs;
const t0 = Date.now();
await click('Click the delay default button');
await settle(400);
assert.equal(steps().length, 0, 'not captured before the default delay');
await until(() => steps().length === 1);
assert.ok(Date.now() - t0 >= 690, `captured after the default delay (took ${Date.now() - t0}ms)`);
console.log('ok  default capture delay is 700 ms');

// 2. Custom delay from settings, and 0 = instant
await fresh();
t.store.captureDelayMs = 400;
const t1 = Date.now();
await click('Click the slow button');
await settle(150);
assert.equal(steps().length, 0);
await until(() => steps().length === 1);
assert.ok(Date.now() - t1 >= 390);
await fresh();
t.store.captureDelayMs = 0;
const t2 = Date.now();
await click('Click the instant button');
await until(() => steps().length === 1);
assert.ok(Date.now() - t2 < 300, 'no delay when set to instantly');
console.log('ok  custom delay and "instantly" are honoured');

// 3. Typing ignores the delay and highlights the field with a box scaled to the screenshot
await fresh();
t.store.captureDelayMs = 1500;
const t3 = Date.now();
await click("Typed in the 'Email' field", { kind: 'input', point: null, rect: { x: 10, y: 20, w: 100, h: 30, vw: 720, vh: 450 } });
await until(() => steps().length === 1);
assert.ok(Date.now() - t3 < 600, 'typing is captured immediately');
const typed = steps()[0];
assert.equal(typed.kind, 'input');
assert.deepEqual([typed.annotations[0].type, typed.annotations[0].x, typed.annotations[0].y, typed.annotations[0].w, typed.annotations[0].h], ['rect', 20, 40, 200, 60]);
console.log('ok  typing is instant and marked with a box around the field');

// 4. Enter uses the delay (the page is about to react); marker is a ring
await fresh();
t.store.captureDelayMs = 300;
const t4 = Date.now();
await click("Pressed Enter in the 'Search' field", { kind: 'key' });
await settle(120);
assert.equal(steps().length, 0);
await until(() => steps().length === 1);
assert.ok(Date.now() - t4 >= 290);
assert.equal(steps()[0].kind, 'key');
console.log('ok  Enter waits for the page to react');

// 5. Marker kept when the page did not navigate, dropped when it did during the delay
await fresh();
t.store.captureDelayMs = 250;
await click('Click stays');
await until(() => steps().length === 1);
assert.equal(steps()[0].annotations.length, 1, 'marker kept on same page');

await fresh();
await click('Click navigates');
await settle(80);
t.state.tabs[0].url = 'https://uat.example.com/b'; // page navigated before the delayed screenshot
await until(() => steps().length === 1);
assert.ok(!steps()[0].annotations.some((a) => a.type === 'ring' || a.type === 'rect'), 'no marker: it would point at different content');
assert.ok(steps()[0].annotations.some((a) => a.type === 'text' && /page changed/i.test(a.text)), 'but a label says why');
console.log('ok  no misleading marker when the page navigated during the delay, and a label explains it');

// 6. Rapid actions are all kept, in event order, including repeats of the same control
//    (collapsing a true double-click happens in the recorder, which can tell from the browser)
await fresh();
t.store.captureDelayMs = 100;
await click('Click Save');
await click('Click Save');
await click('Click Next');
await until(() => steps().length === 3);
await settle(400);
assert.deepEqual(steps().map((s) => s.title), ['Click Save', 'Click Save', 'Click Next']);
console.log('ok  rapid actions are all kept in order, repeats included');

// 7. Click then typing straight after (blur triggers "typed", then submit click): neither is lost
await fresh();
t.store.captureDelayMs = 300;
await click("Typed in the 'Amount' field", { kind: 'input', point: null, rect: { x: 1, y: 1, w: 5, h: 5, vw: 720, vh: 450 } });
await click("Click the 'Submit' button");
await until(() => steps().length === 2, 6000);
assert.deepEqual(steps().map((s) => s.title), ["Typed in the 'Amount' field", "Click the 'Submit' button"]);
console.log('ok  typing followed by an immediate click keeps both steps');

// 8. Stop adds a final screenshot, flushes a pending delayed click, and closes recording
await fresh();
t.store.captureDelayMs = 3000;
await click('Click Pay');
const s8 = Date.now();
await t.send({ type: 'stop' });
assert.ok(Date.now() - s8 < 2500, `stop does not wait out the 3 s delay (took ${Date.now() - s8}ms)`);
assert.deepEqual(steps().map((s) => [s.title, s.kind]), [['Click Pay', 'click'], ['Final state', 'final']]);
assert.equal(t.store.recording, false);
console.log('ok  stop flushes pending captures then adds a "Final state" step');

// 9. Final screenshot can be turned off
await fresh();
t.store.captureDelayMs = 0;
t.store.finalShot = false;
await t.send({ type: 'start' });
await click('Click Once');
await until(() => steps().length === 1);
await t.send({ type: 'stop' });
assert.deepEqual(steps().map((s) => s.title), ['Click Once']);
console.log('ok  final screenshot respects the setting');

// 10. Final screenshot is skipped when there is nothing recorded, on the editor page, or outside the recording
t.store.finalShot = true;
await fresh();
await t.send({ type: 'start' });
await t.send({ type: 'stop' });
assert.equal(steps().length, 0, 'no steps => no lone final screenshot');

await fresh();
await t.send({ type: 'start' });
await click('Click X');
await until(() => steps().length === 1);
t.state.tabs[0].active = false;
t.state.tabs.push({ id: 40, windowId: 1, active: true, url: 'chrome-extension://abc/editor.html', title: 'Testimony' });
await t.send({ type: 'stop' });
assert.equal(steps().length, 1, 'editor page is never captured as the final state');
t.state.tabs.pop();

await fresh();
await t.send({ type: 'start' });
await click('Click Y');
await until(() => steps().length === 1);
t.state.tabs[0].active = false;
t.state.tabs.push({ id: 41, windowId: 9, active: true, url: 'https://uat.example.com/elsewhere', title: 'Other window' });
t.state.focusedWindow = 9;
await t.send({ type: 'stop' });
assert.equal(steps().length, 1, 'tab outside the recording scope is not captured');
t.state.focusedWindow = 1;
console.log('ok  final screenshot is skipped when it would be meaningless');

// 11. Manual capture is never delayed
await fresh();
t.state.tabs = t.state.tabs.filter((x) => x.id === 1);
t.state.tabs[0].active = true;
t.store.captureDelayMs = 3000;
const t11 = Date.now();
await t.send({ type: 'capture' });
assert.equal(steps().length, 1);
assert.ok(Date.now() - t11 < 1500, 'manual screenshot ignores the delay');
console.log('ok  manual screenshots ignore the delay');

// 12. The final screenshot follows the mode: test runs get one by default, guides do not (and call it "Final screen")
const { setMeta } = await import('../db.js');
const runSession = async (mode, settings) => {
  await fresh();
  t.store.captureDelayMs = 0;
  delete t.store.finalShot; delete t.store.finalShotGuide;
  Object.assign(t.store, settings);
  t.state.tabs = t.state.tabs.filter((x) => x.id === 1); t.state.tabs[0].active = true;
  await setMeta({ mode });
  await t.send({ type: 'start' });
  await click('Click once');
  await until(() => steps().length === 1);
  await t.send({ type: 'stop' });
  return steps().map((s) => s.title);
};
assert.deepEqual(await runSession('guide', {}), ['Click once'], 'a guide gets no final screenshot by default');
assert.deepEqual(await runSession('guide', { finalShotGuide: true }), ['Click once', 'Final screen'], 'but can opt in');
assert.deepEqual(await runSession('test', {}), ['Click once', 'Final state'], 'a test run gets one by default');
assert.deepEqual(await runSession('test', { finalShot: false }), ['Click once'], 'and can opt out');
assert.deepEqual(await runSession('test', { finalShot: false, finalShotGuide: true }), ['Click once'], 'the two settings are independent');
console.log('ok  the final screenshot follows the mode, with separate settings');

console.log('\ncapture tests passed');
process.exit(0);

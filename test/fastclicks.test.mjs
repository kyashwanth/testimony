// Reproduces "clicks are missed when actions are taken too fast": every user action must become a step,
// in order, even in bursts, and a screenshot that cannot be taken must not make the step disappear.
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
const sender = () => ({ tab: { id: 1, windowId: 1, active: true, url: t.state.tabs[0].url } });
let seq = 0;
const act = (title, extra = {}) => t.send({ type: 'click-step', id: `m${++seq}`, kind: 'click', title, url: t.state.tabs[0].url, pageTitle: 'List',
  point: { x: 100 + seq * 10, y: 50, vw: 720, vh: 450 }, ...extra }, sender());
const reset = async () => { await sleep(1300); stores.steps.rows.clear(); t.calls.captureTimes.length = 0; t.calls.quotaErrors = 0; t.state.captureFailures = 0; };

await t.send({ type: 'start' });
t.store.captureDelayMs = 700;

// 1. Same-named controls clicked quickly (e.g. a Delete icon on three rows) are three steps, not one.
for (let i = 0; i < 4; i++) { await act("Click the 'Delete' button"); await sleep(120); }
await until(() => steps().length === 4);
await sleep(300);
assert.equal(steps().length, 4, 'every fast click on a same-named control is recorded');
console.log('ok  fast clicks on same-named controls are all recorded');

// 2. A burst never trips Chrome's screenshot quota, and nothing is lost.
await reset();
for (let i = 1; i <= 8; i++) { await act(`Click item ${i}`); await sleep(90); }
await until(() => steps().length === 8);
assert.deepEqual(steps().map((s) => s.title), [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `Click item ${i}`), 'order is preserved');
assert.equal(t.calls.quotaErrors, 0, 'never exceeded 2 screenshots per second');
assert.ok(steps().every((s) => !s.captureFailed), 'all of them got a real screenshot');
console.log('ok  an 8-click burst: all steps, in order, no quota errors');

// 3. A screenshot that fails once or twice is retried and the step is kept.
await reset();
t.state.captureFailures = 2;
await act('Click Pay');
await until(() => steps().length === 1);
assert.equal(steps()[0].title, 'Click Pay');
assert.ok(!steps()[0].captureFailed, 'retry succeeded, so it has a real screenshot');
console.log('ok  a failing screenshot is retried and the step is kept');

// 4. If it keeps failing the step is still saved, with a placeholder image and a note drawn on it.
await reset();
t.state.captureFailures = 99;
await act('Click Submit');
await until(() => steps().length === 1);
const failed = steps()[0];
assert.equal(failed.title, 'Click Submit');
assert.equal(failed.captureFailed, true);
assert.ok(failed.image instanceof Blob && failed.w > 0 && failed.h > 0);
assert.ok(failed.annotations.some((a) => a.type === 'text' && /could not be captured/i.test(a.text)), 'a note explains the grey image');
t.state.captureFailures = 0;
console.log('ok  a step whose screenshot cannot be taken is kept with a placeholder');

// 5. When the next action follows quickly, the earlier step is photographed before it, not 0.7 s later.
await reset();
const t0 = Date.now();
await act('Click first');
await sleep(300);
await act('Click second');
await until(() => steps().length === 2);
const firstShot = t.calls.captureTimes[0];
assert.ok(firstShot - t0 < 450, `first screenshot was taken ${firstShot - t0} ms after the first click (should be before the second action, not after the 700 ms delay)`);
console.log('ok  the screenshot for a step is taken before the next action changes the page');

// 6. A lone click still waits the full delay so toasts and new rows are visible.
await reset();
const t1 = Date.now();
await act('Click alone');
await until(() => steps().length === 1);
assert.ok(t.calls.captureTimes[0] - t1 >= 650, 'a lone click keeps the 0.7 s delay');
console.log('ok  a lone click still waits for the page to react');

// 7. The same message delivered twice (a retry) is recorded once.
await reset();
const dupe = { type: 'click-step', id: 'same-id', kind: 'click', title: 'Click retry', url: 'https://uat.example.com/list', pageTitle: 'List', point: null };
await t.send(dupe, sender());
await t.send(dupe, sender());
await until(() => steps().length >= 1);
await sleep(900);
assert.equal(steps().length, 1, 'duplicate delivery of the same message id is ignored');
console.log('ok  a retried message is not recorded twice');

console.log('\nfast click tests passed');
process.exit(0);

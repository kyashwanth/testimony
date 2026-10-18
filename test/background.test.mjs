import assert from 'node:assert/strict';
import { installFakeIndexedDB, installFakeChrome } from './fakes.mjs';

const stores = installFakeIndexedDB();
const t = installFakeChrome({
  granted: ['https://uat.example.com/*'],
  tabs: [
    { id: 1, windowId: 1, active: true, url: 'https://uat.example.com/login', title: 'Login' },
    { id: 2, windowId: 1, active: false, url: 'https://other.example.org/', title: 'Other' },
  ],
});
await import('../background.js');
t.store.captureDelayMs = 50; // keep the suite quick; the delay itself is covered in capture.test.mjs

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting for: ' + cond);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const rec = () => t.store.recording === true;
const steps = () => stores.steps.rows.size;
const activeSender = { tab: { id: 1, windowId: 1, active: true } };

// 1. Start: recorder registered only for granted sites, injected into matching open tabs, badge shows REC
await t.send({ type: 'start' });
assert.ok(rec(), 'recording flag set');
assert.equal(t.calls.register.length, 1);
assert.deepEqual(t.calls.register[0].matches, ['https://uat.example.com/*']);
assert.equal(t.calls.register[0].allFrames, true);
assert.deepEqual(t.calls.inject, [1], 'injected only into the granted-site tab, not tab 2');
assert.equal(t.calls.badge.at(-1), 'REC');
console.log('ok  start registers recorder for granted sites only');

// 2. A click becomes a step with a marker; badge counts it
await t.send({ type: 'click-step', title: "Click the 'Sign in' button", url: 'https://uat.example.com/login', pageTitle: 'Login',
  point: { x: 100, y: 50, vw: 720, vh: 450 } }, activeSender);
await until(() => steps() === 1);
await until(() => t.calls.badge.at(-1) === '1');
assert.equal(steps(), 1);
const step = [...stores.steps.rows.values()][0];
assert.equal(step.kind, 'click');
assert.equal(step.annotations[0].type, 'ring');
assert.equal(step.annotations[0].x, 200); // 100 * (1440/720)
assert.equal(t.calls.badge.at(-1), '1');
console.log('ok  click -> step with scaled marker, badge = 1');

// 3. The same step twice in quick succession (a double-click) keeps one step
await t.send({ type: 'click-step', title: "Click the 'Sign in' button", url: 'u', pageTitle: 'p', point: null }, activeSender);
await settle(300);
assert.equal(steps(), 1, 'duplicate inside 600ms ignored');
console.log('ok  double-click keeps one step');

// 4. Clicks from a background tab are ignored
await settle(600);
await t.send({ type: 'click-step', title: 'bg', url: 'u', pageTitle: 'p', point: null }, { tab: { id: 2, windowId: 1, active: false } });
await settle(300);
assert.equal(steps(), 1);
console.log('ok  background-tab click ignored');

// 5. Granting another site while recording re-registers with both
t.state.granted.push('https://sso.login.example.net/*');
await t.ev.added.fire({ origins: ['https://sso.login.example.net/*'] });
await settle();
assert.deepEqual(t.calls.register.at(-1).matches, ['https://uat.example.com/*', 'https://sso.login.example.net/*']);
console.log('ok  new grant while recording updates registration');

// 6. Revoking a site while recording shrinks it
t.state.granted.splice(1, 1);
await t.ev.removed.fire({ origins: ['https://sso.login.example.net/*'] });
await settle();
assert.deepEqual(t.calls.register.at(-1).matches, ['https://uat.example.com/*']);
console.log('ok  revoke while recording updates registration');

// 7. Stop: recorder unregistered, editor opened
await t.send({ type: 'stop' });
assert.ok(!rec());
assert.equal(t.registered.length, 0, 'recorder unregistered when not recording');
assert.deepEqual(t.calls.created, ['chrome-extension://abc/editor.html']);
console.log('ok  stop unregisters recorder and opens editor');

// 8. Grant while NOT recording and no pending start: nothing starts
await t.ev.added.fire({});
await settle();
assert.ok(!rec());
assert.equal(t.registered.length, 0);
console.log('ok  grant while idle does not start or register');

// 9. Pending start (popup closed by the permission prompt): grant completes the start
t.store.pendingStart = Date.now();
await t.ev.added.fire({});
await settle();
assert.ok(rec(), 'pending start honoured');
assert.equal(t.store.pendingStart, undefined, 'marker cleared');
assert.equal(t.registered.length, 1);
console.log('ok  pending start completes on grant');
await t.send({ type: 'stop' });

// 10. Stale pending start is ignored
t.store.pendingStart = Date.now() - 120_000;
await t.ev.added.fire({});
await settle();
assert.ok(!rec(), 'stale marker must not start recording');
console.log('ok  stale pending start ignored');

// 11. Shortcut toggle with nothing granted and unknown site: refuses and flashes "!"
t.state.granted.length = 0;
t.state.tabs[0].url = 'https://never-granted.example.com/';
await t.ev.command.fire('toggle-recording');
await settle();
assert.ok(!rec());
assert.equal(t.calls.badge.at(-1), '!');
console.log('ok  shortcut start refused without any site access');

// 12. Shortcut toggle works when a site is granted
t.state.granted.push('https://uat.example.com/*');
await t.ev.command.fire('toggle-recording');
await settle();
assert.ok(rec());
await t.send({ type: 'stop' });
console.log('ok  shortcut start works with a granted site');

// 13. Manual capture (activeTab) works on a site that was never granted
const before = steps();
t.state.granted.length = 0;
await t.ev.command.fire('capture-now');
await until(() => steps() === before + 1);
assert.equal(steps(), before + 1);
assert.equal([...stores.steps.rows.values()].at(-1).kind, 'manual');
console.log('ok  manual capture works on un-granted site');

// 14. Startup/install resets any stale recording state
t.store.recording = true;
t.store.pendingStart = Date.now();
await t.ev.startup.fire();
assert.ok(!rec());
assert.equal(t.store.pendingStart, undefined);
console.log('ok  startup resets state');

console.log('\nbackground tests passed');
process.exit(0);

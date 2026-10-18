import assert from 'node:assert/strict';
import { installFakeIndexedDB, installFakeChrome } from './fakes.mjs';

const stores = installFakeIndexedDB();
const t = installFakeChrome({
  granted: ['https://uat.example.com/*'],
  tabs: [{ id: 1, windowId: 1, active: true, url: 'https://uat.example.com/', title: 'App' }],
});
await import('../background.js');

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 4000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting for: ' + cond);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const steps = () => [...stores.steps.rows.values()];
// Sends a click and, unless `expectStep` is false, waits until it has been stored.
const click = async (tab, title, expectStep = true) => {
  await settle(600); // respect the screenshot rate limit
  const before = steps().length;
  await t.send({ type: 'click-step', title, url: tab.url, pageTitle: 't', point: null }, { tab: { id: tab.id, windowId: tab.windowId, active: tab.active } });
  if (expectStep) await until(() => steps().length === before + 1);
  else await settle(300);
};
const openTab = async (tab) => { t.state.tabs.push(tab); await t.ev.created.fire(tab); await settle(20); };

await t.send({ type: 'start' });
assert.deepEqual(t.session.scope, { windowId: 1, members: [1], nums: { 1: 1 }, next: 2 });
console.log('ok  start scopes recording to the starting window and tab');

// 1. Clicks in the start tab are Tab 1
await click(t.state.tabs[0], 'first');
assert.equal(steps().at(-1).tab, 1);
console.log('ok  start tab is Tab 1');

// 2. A tab opened from the recorded tab (in another window, e.g. a popup) joins and becomes Tab 2
const popup = { id: 6, windowId: 2, active: true, openerTabId: 1, url: 'https://uat.example.com/popup', title: 'Popup' };
await openTab(popup);
await click(popup, 'in popup');
assert.equal(steps().at(-1).title, 'in popup', 'click from opened tab recorded');
assert.equal(steps().at(-1).tab, 2);
console.log('ok  tab opened from the recorded tab is followed (Tab 2)');

// 3. A tab opened from THAT tab is followed too (nested), numbered on first use
const nested = { id: 7, windowId: 2, active: false, openerTabId: 6, url: 'https://uat.example.com/n', title: 'N' };
await openTab(nested);
nested.active = true; popup.active = false;
await click(nested, 'in nested');
assert.equal(steps().at(-1).tab, 3);
console.log('ok  nested opener chain followed (Tab 3)');

// 4. Back to the first tab keeps its number
popup.active = false;
await click(t.state.tabs[0], 'back on first');
assert.equal(steps().at(-1).tab, 1);
console.log('ok  tab numbers are stable');

// 5. An unrelated window (no opener link) is NOT recorded
const stranger = { id: 9, windowId: 3, active: true, url: 'https://uat.example.com/other', title: 'Other' };
t.state.tabs.push(stranger);
const before = steps().length;
await click(stranger, 'unrelated', false);
assert.equal(steps().length, before, 'click from unrelated window ignored');
console.log('ok  unrelated window is ignored');

// 6. Another tab in the SAME window (opened by hand, no opener) is in scope
const sameWindow = { id: 10, windowId: 1, active: true, url: 'https://uat.example.com/manual', title: 'M' };
t.state.tabs[0].active = false;
t.state.tabs.push(sameWindow);
await click(sameWindow, 'same window');
assert.equal(steps().at(-1).title, 'same window');
assert.equal(steps().at(-1).tab, 4);
console.log('ok  other tabs in the recording window are included');
sameWindow.active = false; t.state.tabs[0].active = true;

// 7. Closing a tab removes it from scope membership
await t.ev.removed_.fire(7);
await settle(20);
assert.ok(!t.session.scope.members.includes(7));
console.log('ok  closed tab leaves the scope');

// 8. "!" when the active tab has no recorder, cleared when a recorded tab is active again
t.state.tabs[0].active = false;
const noRecorder = { id: 20, windowId: 1, active: true, url: undefined, title: undefined };
t.state.tabs.push(noRecorder);
t.state.recorderTabs.delete(20);
await t.ev.activated.fire({ tabId: 20 });
await settle(1300);
assert.equal(t.session.notRecorded, 20);
assert.equal(t.calls.badge.at(-1), '!');
console.log('ok  badge "!" when the active tab is not recorded');

noRecorder.active = false; t.state.tabs[0].active = true;
await t.ev.activated.fire({ tabId: 1 });
await settle(1300);
assert.equal(t.session.notRecorded, undefined);
assert.notEqual(t.calls.badge.at(-1), '!');
console.log('ok  "!" clears when a recorded tab is active');

// 9. A slow recorder that answers on the second check does not leave a stuck warning
t.state.recorderTabs.delete(1);
await t.ev.updated.fire(1, { status: 'complete' });
await settle(1300);
assert.equal(t.session.notRecorded, 1, 'first check: not there yet');
t.state.recorderTabs.add(1);
await settle(2500);
assert.equal(t.session.notRecorded, undefined, 'second check: recorder answered, warning cleared');
console.log('ok  late recorder clears the warning on the second check');

// 10. The extension's own pages (editor) never trigger the warning
t.state.tabs[0].active = false;
const editorTab = { id: 30, windowId: 1, active: true, url: 'chrome-extension://abc/editor.html', title: 'Testimony' };
t.state.tabs.push(editorTab);
t.state.recorderTabs.delete(30);
await t.ev.activated.fire({ tabId: 30 });
await settle(1300);
assert.equal(t.session.notRecorded, undefined);
console.log('ok  extension pages are exempt');
editorTab.active = false; t.state.tabs[0].active = true;

// 11. Stop clears scope and warning; a later start builds a fresh scope with numbering restarted
t.session.notRecorded = 99;
await t.send({ type: 'stop' });
assert.equal(t.session.scope, undefined);
assert.equal(t.session.notRecorded, undefined);
await t.send({ type: 'start' });
assert.deepEqual(t.session.scope.nums, { 1: 1 });
console.log('ok  stop clears scope; restart renumbers');

// 12. Not recording => no warning even on an unrecorded tab
await t.send({ type: 'stop' });
t.state.tabs[0].active = false; noRecorder.active = true;
await t.ev.activated.fire({ tabId: 20 });
await settle(1300);
assert.equal(t.session.notRecorded, undefined);
console.log('ok  no warning while not recording');

console.log('\ntab tests passed');
process.exit(0);

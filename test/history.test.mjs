import assert from 'node:assert/strict';
import { installFakeIndexedDB } from './fakes.mjs';

installFakeIndexedDB();
const db = await import('../db.js');

const step = (title) => ({ title, note: '', status: '', image: new Blob([title]), w: 10, h: 10, annotations: [], ts: 1 });
const fill = async (ticket, titles) => {
  await db.resetMeta({ ticket, tester: 'Jane Tester', env: 'UAT' });
  for (const t of titles) await db.addStep(step(t));
};

// 1. An empty session is never archived
assert.equal(await db.archiveCurrentSession(), null);
assert.deepEqual(await db.listSessions(), []);
console.log('ok  empty session is not archived');

// 2. New session archives the current one, clears it, and keeps the carried-over meta
await fill('PROJ-1', ['a', 'b']);
await db.startNewSession({ tester: 'Jane Tester', env: 'UAT' });
assert.equal((await db.getSteps()).length, 0);
assert.deepEqual(await db.getMeta(), { tester: 'Jane Tester', env: 'UAT' });
let list = await db.listSessions();
assert.equal(list.length, 1);
assert.equal(list[0].meta.ticket, 'PROJ-1');
assert.equal(list[0].count, 2);
console.log('ok  new session saves the old one and clears the current');

// 3. Only the newest 5 are kept, newest first
for (let i = 2; i <= 8; i++) { await fill(`PROJ-${i}`, ['x']); await new Promise((r) => setTimeout(r, 3)); await db.startNewSession({}); }
list = await db.listSessions();
assert.equal(list.length, 5);
assert.deepEqual(list.map((s) => s.meta.ticket), ['PROJ-8', 'PROJ-7', 'PROJ-6', 'PROJ-5', 'PROJ-4']);
console.log('ok  history keeps the last 5, newest first');

// 4. Restore: the old session becomes current, keeps step order and content, and leaves history
await fill('CURRENT', ['c1', 'c2', 'c3']);
const target = list.find((s) => s.meta.ticket === 'PROJ-6');
assert.ok(await db.restoreSession(target.id));
assert.equal((await db.getMeta()).ticket, 'PROJ-6');
assert.deepEqual((await db.getSteps()).map((s) => s.title), ['x']);
list = await db.listSessions();
assert.ok(!list.some((s) => s.id === target.id), 'restored session removed from history');
assert.ok(list.some((s) => s.meta.ticket === 'CURRENT'), 'session that was replaced is saved, not lost');
assert.ok(list.some((s) => s.meta.ticket === 'PROJ-4'), 'the oldest session is not thrown away by a restore');
assert.equal(list.length, 5);
console.log('ok  restore swaps sessions without losing the replaced one');

// 5. Restored steps keep their order and blobs
await db.startNewSession({});
await fill('ORDER', ['one', 'two', 'three', 'four']);
await db.startNewSession({});
const ord = (await db.listSessions()).find((s) => s.meta.ticket === 'ORDER');
await db.restoreSession(ord.id);
const restored = await db.getSteps();
assert.deepEqual(restored.map((s) => s.title), ['one', 'two', 'three', 'four']);
assert.ok(restored.every((s) => s.image instanceof Blob));
console.log('ok  restored steps keep order and screenshots');

// 6. Delete and unknown ids
const first = (await db.listSessions())[0];
await db.deleteSession(first.id);
assert.ok(!(await db.listSessions()).some((s) => s.id === first.id));
assert.equal(await db.restoreSession(99999), false);
console.log('ok  delete works; restoring an unknown id is a no-op');

console.log('\nhistory tests passed');
process.exit(0);

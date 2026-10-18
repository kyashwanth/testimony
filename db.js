// IndexedDB storage shared by the service worker, popup and editor.
// steps:    one record per captured step of the CURRENT session (screenshot stored as a Blob).
// meta:     single "session" record with ticket / environment / tester / result.
// sessions: archived past sessions ({ savedAt, meta, steps }); the newest MAX_SESSIONS are kept.

const DB_NAME = 'uat-capture';
const DB_VERSION = 2;
const MAX_SESSIONS = 5;
const STORES = {
  steps: { keyPath: 'id', autoIncrement: true },
  meta: { keyPath: 'key' },
  sessions: { keyPath: 'id', autoIncrement: true },
};
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let orderSeq = 0;

export async function addStep(step) {
  const record = { ...step, order: Date.now() + (orderSeq++ % 1000) / 1000 };
  return run('steps', 'readwrite', (s) => s.add(record));
}

export const putStep = (step) => run('steps', 'readwrite', (s) => s.put(step));
export const deleteStep = (id) => run('steps', 'readwrite', (s) => s.delete(id));
export const clearSteps = () => run('steps', 'readwrite', (s) => s.clear());
export const countSteps = () => run('steps', 'readonly', (s) => s.count());

export async function getSteps() {
  const all = await run('steps', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.order - b.order);
}

export async function getMeta() {
  const rec = await run('meta', 'readonly', (s) => s.get('session'));
  return rec?.value ?? {};
}

export async function setMeta(patch) {
  const current = await getMeta();
  return run('meta', 'readwrite', (s) => s.put({ key: 'session', value: { ...current, ...patch } }));
}

export async function resetMeta(keep = {}) {
  return run('meta', 'readwrite', (s) => s.put({ key: 'session', value: keep }));
}

export const changes = () => new BroadcastChannel('uat-capture');

// ---- Session history --------------------------------------------------------------------

const newestFirst = (a, b) => b.savedAt - a.savedAt;

// Keeps only the newest MAX_SESSIONS archived sessions.
async function pruneSessions() {
  const all = (await run('sessions', 'readonly', (s) => s.getAll())).sort(newestFirst);
  for (const old of all.slice(MAX_SESSIONS)) await run('sessions', 'readwrite', (s) => s.delete(old.id));
}

// Copies the current session into history (if it has any steps), then prunes.
export async function archiveCurrentSession({ prune = true } = {}) {
  const [steps, meta] = await Promise.all([getSteps(), getMeta()]);
  if (!steps.length) return null;
  const id = await run('sessions', 'readwrite', (s) => s.add({ savedAt: Date.now(), meta, steps }));
  if (prune) await pruneSessions();
  return id;
}

// Saves the current session to history, then empties it. `keep` is the meta to carry over (tester, env...).
export async function startNewSession(keep = {}) {
  await archiveCurrentSession();
  await clearSteps();
  await resetMeta(keep);
}

export async function listSessions() {
  const all = await run('sessions', 'readonly', (s) => s.getAll());
  return all.sort(newestFirst).map(({ id, savedAt, meta, steps }) => ({ id, savedAt, meta, count: steps.length }));
}

export const getSession = (id) => run('sessions', 'readonly', (s) => s.get(id));
export const deleteSession = (id) => run('sessions', 'readwrite', (s) => s.delete(id));

// Makes an archived session the current one. The session being replaced is saved to history first.
export async function restoreSession(id) {
  const session = await getSession(id);
  if (!session) return false;
  // Prune only after the swap: the restored session leaves history, so nothing older needs to be dropped.
  await archiveCurrentSession({ prune: false });
  await clearSteps();
  for (const { id: _old, ...step } of session.steps) await addStep(step);
  await resetMeta(session.meta || {});
  await deleteSession(id);
  await pruneSessions();
  return true;
}

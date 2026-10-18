// Minimal in-memory stand-ins for indexedDB and the chrome.* APIs used by background.js.

export function installFakeIndexedDB() {
  const stores = { steps: { rows: new Map(), auto: 0, keyPath: 'id' }, meta: { rows: new Map(), auto: 0, keyPath: 'key' }, sessions: { rows: new Map(), auto: 0, keyPath: 'id' } };
  const request = (result) => ({ result });
  globalThis.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => false },
          createObjectStore() {},
          transaction(name) {
            const tx = {};
            const s = stores[name];
            tx.objectStore = () => ({
              add(v) { const key = ++s.auto; s.rows.set(key, { ...v, [s.keyPath]: key }); return request(key); },
              put(v) { s.rows.set(v[s.keyPath], v); return request(v[s.keyPath]); },
              get: (k) => request(s.rows.get(k)),
              getAll: () => request([...s.rows.values()]),
              delete(k) { s.rows.delete(k); return request(); },
              clear() { s.rows.clear(); return request(); },
              count: () => request(s.rows.size),
            });
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
            return tx;
          },
        };
        req.onupgradeneeded && req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
  return stores;
}

const emitter = () => { const fns = []; return { addListener: (f) => fns.push(f), fire: (...a) => Promise.all(fns.map((f) => f(...a))), fns }; };

const matchesPattern = (pattern, url) => {
  const m = pattern.match(/^(\*|https?):\/\/([^/]+)\/\*$/);
  const u = new URL(url);
  if (!m) return false;
  if (m[1] !== '*' && m[1] + ':' !== u.protocol) return false;
  return m[2].startsWith('*.') ? u.hostname.endsWith(m[2].slice(1)) : u.hostname === m[2];
};

export function installFakeChrome({ granted = [], tabs = [] } = {}) {
  const store = {};
  const calls = { register: [], unregister: 0, inject: [], captures: 0, captureTimes: [], quotaErrors: 0, created: [], badge: [] };
  const registered = [];
  const state = { granted: [...granted], tabs: [...tabs], focusedWindow: 1, recorderTabs: new Set(tabs.map((t) => t.id)), captureFailures: 0 };
  const session = {};
  const ev = { created: emitter(), removed_: emitter(), activated: emitter(), updated: emitter(), focus: emitter(), message: emitter(), command: emitter(), added: emitter(), removed: emitter(), installed: emitter(), startup: emitter() };

  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  globalThis.createImageBitmap = async () => ({ width: 1440, height: 900, close() {} });

  globalThis.chrome = {
    storage: { session: {
      async get(k) { if (typeof k === 'string') return k in session ? { [k]: structuredClone(session[k]) } : {}; return {}; },
      async set(o) { Object.assign(session, structuredClone(o)); },
      async remove(k) { (Array.isArray(k) ? k : [k]).forEach((x) => delete session[x]); },
    }, local: {
      async get(k) { return typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : { ...store }; },
      async set(o) { Object.assign(store, o); },
      async remove(k) { delete store[k]; },
    } },
    action: {
      async setBadgeText({ text }) { calls.badge.push(text); },
      async setBadgeBackgroundColor() {},
    },
    tabs: {
      async query(q) {
        if (q.active) return state.tabs.filter((t) => t.active && t.windowId === state.focusedWindow);
        if (Array.isArray(q.url)) return state.tabs.filter((t) => t.url && q.url.some((p) => matchesPattern(p, t.url))); // tabs without a readable url never match
        return state.tabs.filter((t) => t.url === q.url);
      },
      async get(id) { const tab = state.tabs.find((x) => x.id === id); if (!tab) throw new Error('No tab with id ' + id); return tab; },
      async captureVisibleTab() {
        const now = Date.now();
        calls.captures++;
        // Chrome allows at most 2 captureVisibleTab calls per second and throws when exceeded.
        const recent = calls.captureTimes.filter((t) => t > now - 1000).length;
        calls.captureTimes.push(now);
        if (recent >= 2) { calls.quotaErrors++; throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.'); }
        if (state.captureFailures > 0) { state.captureFailures--; throw new Error('Failed to capture tab: simulated failure'); }
        return jpeg;
      },
      async create(o) { calls.created.push(o.url); },
      async sendMessage(tabId) { if (state.recorderTabs.has(tabId)) return { ok: true }; throw new Error('Could not establish connection. Receiving end does not exist.'); },
      onCreated: ev.created, onRemoved: ev.removed_, onActivated: ev.activated, onUpdated: ev.updated,
      async update() {},
    },
    windows: { async update() {}, onFocusChanged: ev.focus },
    scripting: {
      async getRegisteredContentScripts({ ids }) { return registered.filter((r) => ids.includes(r.id)); },
      async unregisterContentScripts() { calls.unregister++; registered.length = 0; },
      async registerContentScripts(list) { calls.register.push(list[0]); registered.push(...list); },
      async executeScript(o) { calls.inject.push(o.target.tabId); },
    },
    permissions: {
      async getAll() { return { origins: state.granted }; },
      async contains({ origins }) { return origins.every((o) => state.granted.includes(o)); },
      onAdded: ev.added, onRemoved: ev.removed,
    },
    runtime: {
      getURL: (p) => `chrome-extension://abc/${p}`,
      onMessage: ev.message, onInstalled: ev.installed, onStartup: ev.startup,
    },
    commands: { onCommand: ev.command },
  };

  // Send a runtime message through the registered listener, resolving with its response.
  const send = (msg, sender = {}) => new Promise((resolve) => {
    let responded = false;
    const respond = (r) => { responded = true; resolve(r); };
    const keepOpen = ev.message.fns[0](msg, sender, respond);
    if (!keepOpen && !responded) resolve(undefined);
  });

  return { store, session, calls, registered, state, ev, send };
}

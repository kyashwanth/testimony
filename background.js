// Service worker: owns recording state, takes screenshots and stores steps.
//
// Site access model (v2): the extension has no install-time host permissions. The user grants access
// per site (chrome.permissions.request from the popup). While recording, the click recorder is
// registered only for those granted sites; when recording stops it is unregistered. Screenshots
// triggered by the toolbar button or a shortcut work on any tab via activeTab.
//
// Recording scope: the window recording started in, plus any tab or window opened from those
// (via openerTabId). Steps are numbered by tab. If the tab the user is looking at has no recorder
// (site not allowed, browser page...) the badge shows "!" so the gap is never silent.
import * as db from './db.js';
import { COLORS, baseLW } from './annotate.js';
import { patternForUrl, webOrigins, samePage } from './sites.js';
import { modeOf } from './modes.js';
import { PLACEHOLDER_DATA_URL, PLACEHOLDER_W, PLACEHOLDER_H } from './placeholder.js';

const channel = db.changes();
// captureVisibleTab allows 2 calls per second. We allow a burst of 2 per 1.1 s window (a little margin) so
// fast sequences are served as quickly as Chrome permits without ever tripping the quota.
const SHOT_BURST = 2;
const SHOT_WINDOW_MS = 1100;
const LEAD_MS = 100;            // take a step's screenshot this long before the user's next action lands
const SHOT_ATTEMPTS = 3;
const SHOT_TIMEOUT_MS = 5000;
const SCRIPT_ID = 'uat-recorder';
const PENDING_START_TTL_MS = 60_000;
const CHECK_DELAYS_MS = [1000, 3500]; // check twice after a load, in case the page is slow to settle
const SETTINGS_DEFAULTS = { captureDelayMs: 700, finalShot: true, finalShotGuide: false };
let shotTimes = [];                   // when recent captureVisibleTab calls were made (for the quota)
let arrivals = [];                    // when recent user actions arrived (so a step is shot before the next one)
const seenIds = new Set();            // message ids already handled, so a retried message is not recorded twice
const preShots = new Map();           // press id -> screenshot taken at a mouse press on a link, before the page can change
const PRESHOT_TTL_MS = 8000;
let queue = Promise.resolve();
let stopping = false;                 // while stopping, pending delayed captures are taken immediately

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getSettings = async () => ({ ...SETTINGS_DEFAULTS, ...(await chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS))) });

const isRecording = async () => !!(await chrome.storage.local.get('recording')).recording;

async function refreshBadge() {
  const recording = await isRecording();
  const n = await db.countSteps();
  const { notRecorded } = await chrome.storage.session.get('notRecorded');
  if (recording && notRecorded != null) {
    await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
    await chrome.action.setBadgeText({ text: '!' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: recording ? '#d93025' : '#5f6368' });
  await chrome.action.setBadgeText({ text: recording ? (n ? String(n) : 'REC') : n ? String(n) : '' });
}

async function flashError() {
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
  await chrome.action.setBadgeText({ text: '!' });
  setTimeout(refreshBadge, 2500);
}

// ---- Recording scope -----------------------------------------------------------------
// scope = { windowId, members: [tabId], nums: { tabId: n }, next }
let scopeLock = Promise.resolve();
const readScope = async () => (await chrome.storage.session.get('scope')).scope || null;

// Serialised read-modify-write. fn(scope|null) returns the new scope, null to clear, or undefined to keep.
function updateScope(fn) {
  const run = scopeLock.then(async () => {
    const current = await readScope();
    const next = fn(current ? structuredClone(current) : null);
    if (next === undefined) return current;
    if (next === null) await chrome.storage.session.remove('scope');
    else await chrome.storage.session.set({ scope: next });
    return next;
  });
  scopeLock = run.catch(() => {});
  return run;
}

const inScope = (scope, tab) => !scope || tab.windowId === scope.windowId || scope.members.includes(tab.id);

async function startScope() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await updateScope(() => (tab ? { windowId: tab.windowId, members: [tab.id], nums: { [tab.id]: 1 }, next: 2 } : null));
}

// Returns the 1-based tab number for this tab, assigning the next one on first use.
async function tabNumber(tabId) {
  const scope = await updateScope((s) => {
    if (!s) return undefined;
    if (!(tabId in s.nums)) s.nums[tabId] = s.next++;
    if (!s.members.includes(tabId)) s.members.push(tabId);
    return s;
  });
  return scope?.nums[tabId] ?? 1;
}

async function screenshot(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return { blob, ...size };
}

function enqueue(job) {
  queue = queue.then(job).catch((err) => { console.warn('[Testimony]', err); return flashError(); });
  return queue;
}

// ---- Pacing -------------------------------------------------------------------------------

function noteArrival(at) {
  arrivals.push(at);
  const cutoff = at - 30_000;
  while (arrivals.length > 200 || (arrivals.length && arrivals[0] < cutoff)) arrivals.shift();
}

function alreadySeen(id) {
  if (seenIds.has(id)) return true;
  seenIds.add(id);
  if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value);
  return false;
}

// Earliest time another screenshot may be requested without exceeding Chrome's per-second quota.
function nextShotSlot(now = Date.now()) {
  shotTimes = shotTimes.filter((t) => t > now - SHOT_WINDOW_MS);
  return shotTimes.length >= SHOT_BURST ? shotTimes[shotTimes.length - SHOT_BURST] + SHOT_WINDOW_MS : 0;
}

// Waits for a slot and takes it in the same step, so two screenshots requested at once (a press on a link while a
// delayed capture is waiting) can never both claim the same slot and trip the quota.
async function reserveShotSlot() {
  for (;;) {
    const wait = nextShotSlot() - Date.now();
    if (wait <= 0) { shotTimes.push(Date.now()); return; }
    await sleep(Math.min(wait, 50));
  }
}

// Waits until it is time to photograph a step: `delayMs` after the action so the page can react (toast, new
// row...), but sooner if the user has already moved on, so the picture is not of a later step's result.
// Re-evaluated while waiting, because the next action can arrive at any moment.
async function waitUntilDue(eventAt, delayMs) {
  for (;;) {
    const now = Date.now();
    let due = stopping ? now : eventAt + delayMs;
    if (!stopping) {
      const next = arrivals.find((a) => a > eventAt);
      if (next !== undefined) due = Math.min(due, next - LEAD_MS);
    }
    due = Math.max(due, nextShotSlot(now));
    if (due <= now) return;
    await sleep(Math.min(due - now, 40));
  }
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot timed out')), ms)),
]);

// Takes a screenshot, retrying on transient failures. It never throws: if Chrome keeps refusing, a placeholder
// image is returned so the step is still recorded and the sequence stays complete.
async function takeScreenshot(windowId) {
  let lastError;
  for (let attempt = 0; attempt < SHOT_ATTEMPTS; attempt++) {
    if (attempt) await sleep(300);
    await reserveShotSlot();
    try {
      return await withTimeout(screenshot(windowId), SHOT_TIMEOUT_MS);
    } catch (err) {
      lastError = err;
    }
  }
  console.warn('[Testimony] screenshot failed, saving a placeholder:', lastError);
  flashError();
  const blob = await (await fetch(PLACEHOLDER_DATA_URL)).blob();
  return { blob, w: PLACEHOLDER_W, h: PLACEHOLDER_H, failed: true };
}

// Takes the screenshot and stores the step. `delayMs` waits after the event so the page can react
// (toast, new row...) before the screenshot; clicks and Enter use the user's setting, typing uses none.
async function addCapture({ windowId, tabId, title, url, tabUrl, pageTitle, point, rect, kind, eventAt = Date.now(), delayMs = 0, preId }) {
  // A link was pressed: its screenshot was taken at the press, before the page could change. Use it if it is good.
  let shot = null;
  let early = false;
  if (preId && preShots.has(preId)) {
    const pre = await preShots.get(preId).promise;
    preShots.delete(preId);
    if (pre && !pre.failed) { shot = pre; early = true; }
  }
  if (!shot) {
    await waitUntilDue(eventAt, delayMs);
    shot = await takeScreenshot(windowId);
  }
  const tab = await tabNumber(tabId);

  // If the page navigated during the delay, the screenshot shows the NEXT page, so a marker placed at click time
  // would point at unrelated content. The marker is left off and the step says why, rather than silently lacking it.
  let keepMarks = !shot.failed;
  let navigated = false;
  // Checked for every screenshot that was not taken early, even an immediate one (a link opened with the keyboard has
  // no press to photograph, so its screenshot can still race the navigation). A change to only the #hash or ?query is
  // the same page, so it does not count.
  if (keepMarks && !early && tabUrl) {
    const now = await chrome.tabs.get(tabId).catch(() => null);
    navigated = !!(now && now.url && !samePage(now.url, tabUrl));
    keepMarks = !navigated;
  }

  const annotations = [];
  const lw = baseLW(shot.w);
  if (shot.failed) {
    annotations.push({ type: 'text', color: '#b45309', text: 'Screenshot could not be captured', x: 36, y: 168, size: 26 });
  } else if (navigated) {
    annotations.push({ type: 'text', color: '#b45309', text: 'Page changed after this click', x: Math.round(shot.w * 0.02), y: Math.round(shot.h * 0.02), size: Math.max(18, Math.round(shot.w / 70)) });
  } else if (keepMarks && rect) {
    const k = shot.w / rect.vw;
    annotations.push({
      type: 'rect', color: COLORS[0], lw,
      x: Math.round(rect.x * k), y: Math.round(rect.y * k), w: Math.round(rect.w * k), h: Math.round(rect.h * k),
    });
  } else if (keepMarks && point) {
    const k = shot.w / point.vw;
    annotations.push({
      type: 'ring', color: COLORS[0], lw,
      x: Math.round(point.x * k), y: Math.round(point.y * k), r: Math.round(24 * k),
    });
  }
  await db.addStep({
    title, note: '', status: '', kind, url: url || '', pageTitle: pageTitle || '', tab,
    image: shot.blob, w: shot.w, h: shot.h, annotations, ts: Date.now(),
    ...(shot.failed ? { captureFailed: true } : {}),
  });
  channel.postMessage('changed');
  await refreshBadge();
}

async function captureActive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  return enqueue(() => addCapture({
    windowId: tab.windowId, tabId: tab.id, kind: 'manual', title: 'Screenshot', url: tab.url, pageTitle: tab.title,
  }));
}

async function openEditor() {
  const url = chrome.runtime.getURL('editor.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---- Click recorder registration ----------------------------------------------------

async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return webOrigins(origins);
}

// Makes the registered recorder match reality: present (for granted sites) while recording, absent otherwise.
async function syncRecorder() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!(await isRecording())) return;

  const origins = await grantedOrigins();
  if (!origins.length) return;
  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID, js: ['content.js'], matches: origins,
    allFrames: true, runAt: 'document_start', persistAcrossSessions: false,
  }]);

  // Registered scripts only apply to future page loads, so also inject into tabs that are already open.
  const tabs = await chrome.tabs.query({ url: origins });
  await Promise.all(tabs.map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content.js'] }).catch(() => {})
  ));
}

async function setRecording(on) {
  const was = await isRecording();
  await chrome.storage.local.set({ recording: on });
  if (on && !was) await startScope();
  if (!on) {
    await updateScope(() => null);
    await chrome.storage.session.remove('notRecorded');
  }
  await syncRecorder();
  if (on) scheduleCheck();
  await refreshBadge();
  channel.postMessage('changed');
}

// Starting from a keyboard shortcut can't show a permission prompt, so it needs the current site
// to be allowed already. Otherwise flash "!" so the user knows to use the toolbar popup instead.
// Adds a "Final state" step for the tab the user is on, so the session ends with the outcome on screen.
// Best effort: silently skipped for browser pages, the editor, tabs outside the recording, or when disabled.
function captureFinal() {
  queue = queue.then(async () => {
    try {
      const settings = await getSettings();
      const guide = modeOf(await db.getMeta()) === 'guide';
      if (!(guide ? settings.finalShotGuide : settings.finalShot) || (await db.countSteps()) === 0) return;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || (tab.url && tab.url.startsWith(chrome.runtime.getURL('')))) return;
      if (!inScope(await readScope(), tab)) return;
      await addCapture({
        windowId: tab.windowId, tabId: tab.id, kind: 'final', title: guide ? 'Final screen' : 'Final state', url: tab.url, pageTitle: tab.title,
      });
    } catch (err) {
      console.warn('[Testimony] final screenshot skipped:', err);
    }
  });
  return queue;
}

async function stopRecording() {
  stopping = true; // don't make queued clicks wait out their delay
  try {
    await captureFinal();
    await setRecording(false);
  } finally {
    stopping = false;
  }
  await openEditor();
}

async function toggle() {
  if (await isRecording()) return stopRecording();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const pattern = tab && patternForUrl(tab.url);
  const allowed = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  if (!allowed && !(await grantedOrigins()).length) return flashError();
  await setRecording(true);
}

// ---- Messages, commands, permission events ------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'click-step': {
      if (!(sender.tab && sender.tab.active)) return false;
      if (msg.id && alreadySeen(msg.id)) return false;
      // Queue synchronously so a Stop that follows can never overtake this action; checks run inside the job.
      const eventAt = Date.now();
      noteArrival(eventAt);
      enqueue(async () => {
        if (!inScope(await readScope(), sender.tab)) return;
        const { captureDelayMs } = await getSettings();
        await addCapture({
          windowId: sender.tab.windowId, tabId: sender.tab.id, kind: msg.kind || 'click', title: msg.title,
          url: msg.url, tabUrl: sender.tab.url, pageTitle: msg.pageTitle, point: msg.point, rect: msg.rect,
          eventAt, preId: msg.pre,
          // typing and link clicks are photographed at once: a link changes the page, so waiting would photograph the next one
          delayMs: msg.kind === 'input' || msg.nav ? 0 : captureDelayMs,
        });
      });
      return false;
    }
    case 'pre-shot': {
      // The mouse went down on a link. Photograph the page now, before the click can navigate away from it. The click
      // that follows (message carries `pre`) uses this picture; a press that is not followed by a click is discarded.
      // A repeated id (the recorder retries a message) must not replace the earlier screenshot with a later one.
      if (!(sender.tab && sender.tab.active) || !msg.id || preShots.has(msg.id)) return false;
      const { windowId } = sender.tab;
      const tabRef = sender.tab;
      preShots.set(msg.id, {
        promise: readScope().then((scope) => (inScope(scope, tabRef) ? takeScreenshot(windowId) : null)).catch(() => null),
      });
      setTimeout(() => preShots.delete(msg.id), PRESHOT_TTL_MS);
      return false;
    }
    case 'start': setRecording(true).then(() => sendResponse({ ok: true })); return true;
    case 'stop': stopRecording().then(() => sendResponse({ ok: true })); return true;
    case 'capture': captureActive().then(() => sendResponse({ ok: true })); return true;
    case 'open-editor': openEditor().then(() => sendResponse({ ok: true })); return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-now') captureActive();
  if (command === 'toggle-recording') toggle();
});

// The permission prompt can close the popup before its promise resolves. The popup therefore leaves a
// short-lived "pendingStart" marker, and we finish the start here once the grant arrives.
chrome.permissions.onAdded.addListener(async () => {
  const { pendingStart } = await chrome.storage.local.get('pendingStart');
  if (pendingStart && Date.now() - pendingStart < PENDING_START_TTL_MS) {
    await chrome.storage.local.remove('pendingStart');
    if (!(await isRecording())) return setRecording(true);
  }
  if (await isRecording()) { await syncRecorder(); scheduleCheck(); }
  channel.postMessage('changed');
});

chrome.permissions.onRemoved.addListener(async () => {
  if (await isRecording()) await syncRecorder();
  channel.postMessage('changed');
});

// ---- Following new tabs, and telling the user when the current tab isn't recorded -----------

// Tabs/windows opened from a tab in scope join the scope (window.open, target=_blank, Ctrl+click...).
chrome.tabs.onCreated.addListener((tab) => updateScope((s) => {
  if (!s || tab.openerTabId == null || !s.members.includes(tab.openerTabId) || s.members.includes(tab.id)) return undefined;
  s.members.push(tab.id);
  return s;
}));
chrome.tabs.onRemoved.addListener((tabId) => updateScope((s) => {
  if (!s || !s.members.includes(tabId)) return undefined;
  s.members = s.members.filter((id) => id !== tabId);
  return s;
}));

async function setNotRecorded(tabId) {
  const { notRecorded = null } = await chrome.storage.session.get('notRecorded');
  if (notRecorded === tabId) return;
  if (tabId === null) await chrome.storage.session.remove('notRecorded');
  else await chrome.storage.session.set({ notRecorded: tabId });
  await refreshBadge();
  channel.postMessage('changed');
}

// Asks the recorder in the active tab to answer a ping. No answer means it isn't injected there.
async function checkActiveTab() {
  if (!(await isRecording())) return setNotRecorded(null);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  const ownPage = tab.url && tab.url.startsWith(chrome.runtime.getURL(''));
  if (ownPage || !inScope(await readScope(), tab)) return setNotRecorded(null);
  const ok = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }, { frameId: 0 }).then((r) => !!(r && r.ok), () => false);
  await setNotRecorded(ok ? null : tab.id);
}

let checkTimers = [];
function scheduleCheck() {
  checkTimers.forEach(clearTimeout);
  checkTimers = CHECK_DELAYS_MS.map((ms) => setTimeout(() => checkActiveTab().catch(() => {}), ms));
}
chrome.tabs.onActivated.addListener(scheduleCheck);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') scheduleCheck(); });
chrome.windows.onFocusChanged.addListener(scheduleCheck);

async function reset() {
  await chrome.storage.local.set({ recording: false });
  await chrome.storage.session.remove(['scope', 'notRecorded']);
  await chrome.storage.local.remove('pendingStart');
  await syncRecorder();
  await refreshBadge();
}
chrome.runtime.onInstalled.addListener(reset);
chrome.runtime.onStartup.addListener(reset);

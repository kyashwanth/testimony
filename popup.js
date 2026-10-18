import * as db from './db.js';
import { isWebUrl, patternForUrl, normalizePattern, webOrigins, label } from './sites.js';
import { modeOf } from './modes.js';

const $ = (id) => document.getElementById(id);

let tab = null;          // the tab the popup was opened on
let recording = false;
let siteAllowed = false; // is the current tab's site already allowed?
let grantedCount = 0;
let mode = 'test';       // 'guide' or 'test': what this session is for (stored with the session)
let finalShotSettings = { finalShot: true, finalShotGuide: false };
const channel = db.changes();

function message(text) {
  $('msg').textContent = text || '';
  $('msg').hidden = !text;
}

// Shows the fields, wording and options that belong to the current mode.
function applyMode() {
  const guide = mode === 'guide';
  $('modeGuide').classList.toggle('on', guide);
  $('modeTest').classList.toggle('on', !guide);
  $('guideFields').hidden = !guide;
  $('testFields').hidden = guide;
  $('finalLabel').textContent = guide ? 'Add a closing screenshot when I stop' : 'Add a final screenshot when I stop';
  $('finalShot').checked = guide ? finalShotSettings.finalShotGuide : finalShotSettings.finalShot;
}

async function setMode(next) {
  if (next === mode) return;
  mode = next;
  await db.setMeta({ mode });
  applyMode();
  channel.postMessage('changed'); // the editor, if open, switches too
  refresh();
}

async function refresh() {
  ({ recording } = await chrome.storage.local.get('recording'));
  recording = !!recording;
  const wanted = modeOf(await db.getMeta());
  if (wanted !== mode) { mode = wanted; applyMode(); }
  const n = await db.countSteps();
  const { origins = [] } = await chrome.permissions.getAll();
  const granted = webOrigins(origins);
  grantedCount = granted.length;

  // -- current site status
  const web = tab && isWebUrl(tab.url);
  const suggested = web ? patternForUrl(tab.url) : null;
  siteAllowed = !!suggested && (await chrome.permissions.contains({ origins: [suggested] }));
  $('dot').className = 'dot ' + (siteAllowed ? 'ok' : web ? 'warn' : '');
  if (siteAllowed) $('siteText').textContent = `${new URL(tab.url).hostname} is allowed`;
  else if (web) $('siteText').textContent = `${new URL(tab.url).hostname} isn't allowed yet`;
  else $('siteText').textContent = 'Open the site you are testing to record its clicks';
  $('allowBox').hidden = !web || siteAllowed;
  if (web && !siteAllowed && !$('pattern').value) $('pattern').value = suggested;

  // -- is the tab you're looking at being recorded?
  const { notRecorded = null } = await chrome.storage.session.get('notRecorded');
  const unrecorded = recording && tab && notRecorded === tab.id;
  $('notice').hidden = !unrecorded;
  if (unrecorded) {
    $('notice').textContent = web && !siteAllowed
      ? "This tab isn't being recorded because its site isn't allowed yet. Press \"Allow this site\" to capture clicks here."
      : "This tab isn't being recorded. Alt+Shift+S still captures a screenshot of it.";
  }

  // -- record button
  const needsGrant = web && !siteAllowed;
  $('toggle').textContent = recording ? 'Stop & review' : needsGrant ? 'Allow site & start recording' : 'Start recording';
  $('toggle').classList.toggle('recording', recording);
  $('toggle').disabled = !recording && !web && grantedCount === 0;
  const guide = mode === 'guide';
  $('hint').textContent = recording
    ? (guide ? 'Recording. Do the task as you would show it; each action becomes a step.' : 'Recording. Work through your test; each action becomes a step.')
    : (guide ? 'Captures each click and choice as a step in your guide, on allowed sites.' : 'Captures each click, typed field and dropdown choice on allowed sites.');
  $('count').textContent = `${n} step${n === 1 ? '' : 's'}`;

  // -- allowed sites list
  $('siteCount').textContent = String(grantedCount);
  $('noSites').hidden = grantedCount > 0;
  $('siteList').replaceChildren(...granted.map((origin) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = label(origin);
    name.title = origin;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await chrome.permissions.remove({ origins: [origin] });
      refresh();
    });
    li.append(name, remove);
    return li;
  }));
}

// Asks Chrome for access to the pattern typed in the box. Must run directly from a click.
// Returns true if granted. `startAfter` leaves a marker so the worker can finish starting the recording
// even if the permission prompt closes this popup before the promise resolves.
async function requestSite({ startAfter }) {
  const pattern = normalizePattern($('pattern').value);
  if (!pattern) {
    message('That is not a valid site. Use a host like uat.example.com or *.example.com.');
    return false;
  }
  if (startAfter) await chrome.storage.local.set({ pendingStart: Date.now() });
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    message(`Chrome refused that pattern: ${err.message}`);
  }
  if (startAfter) await chrome.storage.local.remove('pendingStart');
  if (!granted) message('Access was not granted, so clicks on this site can not be recorded.');
  return granted;
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const meta = await db.getMeta();
  mode = modeOf(meta);
  $('ticket').value = meta.ticket || '';
  $('env').value = meta.env || '';
  $('guideTitle').value = meta.guideTitle || '';
  for (const id of ['ticket', 'env', 'guideTitle']) {
    $(id).addEventListener('input', () => db.setMeta({ [id]: $(id).value.trim() }));
  }
  $('modeGuide').addEventListener('click', () => setMode('guide'));
  $('modeTest').addEventListener('click', () => setMode('test'));

  // -- capture options (read by the service worker at capture time). The final screenshot is remembered per mode:
  //    on for test runs, off for guides.
  const stored = await chrome.storage.local.get(['captureDelayMs', 'finalShot', 'finalShotGuide']);
  finalShotSettings = { finalShot: stored.finalShot ?? true, finalShotGuide: stored.finalShotGuide ?? false };
  $('delay').value = String(stored.captureDelayMs ?? 700);
  applyMode();
  $('delay').addEventListener('change', () => chrome.storage.local.set({ captureDelayMs: Number($('delay').value) }));
  $('finalShot').addEventListener('change', () => {
    const key = mode === 'guide' ? 'finalShotGuide' : 'finalShot';
    finalShotSettings[key] = $('finalShot').checked;
    chrome.storage.local.set({ [key]: $('finalShot').checked });
  });

  $('toggle').addEventListener('click', async () => {
    message('');
    if (recording) {
      await chrome.runtime.sendMessage({ type: 'stop' });
      return window.close();
    }
    if (isWebUrl(tab?.url) && !siteAllowed) {
      if (!(await requestSite({ startAfter: true }))) return refresh();
    }
    await chrome.runtime.sendMessage({ type: 'start' });
    window.close();
  });

  $('allow').addEventListener('click', async () => {
    message('');
    await requestSite({ startAfter: false });
    refresh();
  });

  $('shot').addEventListener('click', async () => {
    $('shot').disabled = true;
    await chrome.runtime.sendMessage({ type: 'capture' });
    $('shot').disabled = false;
    refresh();
  });

  $('edit').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'open-editor' });
    window.close();
  });

  channel.onmessage = refresh;
  chrome.permissions.onAdded.addListener(refresh);
  chrome.permissions.onRemoved.addListener(refresh);
  refresh();
}

init();

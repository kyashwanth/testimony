import * as db from './db.js';
import { COLORS, baseLW, baseFont, drawAnnotation, drawAnnotations, renderStep, cropFor } from './annotate.js';
import { buildPdf } from './pdf.js';
import { modeOf, MODES, isTextStep, stepNumbers, resultFrom, fileNameFor, sessionLabel } from './modes.js';

const $ = (sel) => document.querySelector(sel);
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids);
  return el;
}

let steps = [];
let meta = {};
const channel = db.changes();

// ---- Bitmap cache -----------------------------------------------------------

const bitmaps = new Map();
async function bitmapFor(step) {
  const key = `${step.id}:${step.image.size}:${step.ts}`;
  const hit = bitmaps.get(step.id);
  if (hit && hit.key === key) return hit.bmp;
  const bmp = await createImageBitmap(step.image);
  bitmaps.set(step.id, { key, bmp });
  return bmp;
}

// ---- Persistence -------------------------------------------------------------

const timers = new Map();
function saveStepSoon(step) {
  clearTimeout(timers.get(step.id));
  timers.set(step.id, setTimeout(() => { timers.delete(step.id); db.putStep(step); }, 300));
}
async function flushSaves() {
  for (const [id, t] of timers) {
    clearTimeout(t);
    const s = steps.find((x) => x.id === id);
    if (s) await db.putStep(s);
  }
  timers.clear();
}
let metaTimer;
function saveMetaSoon() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => db.setMeta(meta), 300);
}

async function load() {
  await flushSaves();
  steps = await db.getSteps();
  render();
}

// ---- Session details -----------------------------------------------------------

const FIELDS = ['ticket', 'env', 'tester', 'date', 'result', 'summary', 'guideTitle', 'author', 'version', 'prereq'];
function fillMeta() {
  for (const f of FIELDS) {
    const el = $('#' + f);
    if (document.activeElement !== el) el.value = meta[f] ?? (f === 'date' ? today() : '');
  }
}
for (const f of FIELDS) {
  $('#' + f).addEventListener('input', (e) => { meta[f] = e.target.value; saveMetaSoon(); });
}

// ---- Modes -----------------------------------------------------------------------------
// A session is either a guide (how-to / SOP) or a test run (UAT evidence). The mode only changes how it is edited
// and exported; switching never deletes anything.

const guideMode = () => modeOf(meta) === 'guide';

function applyMode() {
  const guide = guideMode();
  document.body.classList.toggle('mode-guide', guide);
  document.body.classList.toggle('mode-test', !guide);
  $('#edGuide').classList.toggle('on', guide);
  $('#edTest').classList.toggle('on', !guide);
  $('#dateLabel').textContent = guide ? 'Last updated' : 'Date';
  $('#summaryLabel').textContent = guide ? 'Overview' : 'Summary';
  $('#summary').placeholder = guide ? 'What this guide helps the reader do.' : 'What was tested, and anything worth knowing.';
}

async function setMode(next) {
  if (modeOf(meta) === next) return;
  meta.mode = next;
  await db.setMeta({ mode: next });
  applyMode();
  render(); // the cards differ per mode
  channel.postMessage('changed');
}
$('#edGuide').addEventListener('click', () => setMode('guide'));
$('#edTest').addEventListener('click', () => setMode('test'));

// ---- Step list -----------------------------------------------------------------

async function drawPreview(step, canvas) {
  const bmp = await bitmapFor(step);
  const crop = guideMode() ? cropFor(step, bmp.width, bmp.height) : null;
  renderStep(canvas, bmp, step.annotations || [], Math.min(1, 1000 / (crop ? crop.w : bmp.width)), crop);
}

const bind = (step, key) => (e) => { step[key] = e.target.value; saveStepSoon(step); };

function stepFoot(step, i) {
  const multiTab = new Set(steps.map((s) => s.tab).filter(Boolean)).size > 1;
  return h('div', { class: 'step-foot' },
    multiTab && step.tab ? h('span', { class: 'tabpill', text: `Tab ${step.tab}` }) : '',
    h('span', { class: 'url', text: step.url || '', title: step.url || '' }),
    h('button', { text: 'Up', disabled: i === 0, onclick: () => move(step, -1) }),
    h('button', { text: 'Down', disabled: i === steps.length - 1, onclick: () => move(step, 1) }),
    h('button', { class: 'del', text: 'Delete', onclick: () => remove(step) }),
  );
}

function stepCard(step, i, nums) {
  const foot = stepFoot(step, i);

  // Headings and text-only steps have no screenshot.
  if (step.kind === 'heading') {
    return h('article', { class: 'card step heading', 'data-id': step.id },
      h('div', { class: 'step-head' }, h('span', { class: 'num', text: '#' }),
        h('input', { class: 'title', value: step.title || '', placeholder: 'Section heading', 'aria-label': 'Section heading', oninput: bind(step, 'title') })),
      foot);
  }
  if (step.kind === 'text') {
    return h('article', { class: 'card step text', 'data-id': step.id },
      h('div', { class: 'step-head' }, h('span', { class: 'num', text: '¶' }), h('b', { text: 'Text' })),
      h('textarea', { rows: 3, placeholder: 'Write a paragraph. It appears in the PDF with no screenshot.', value: step.note || '', oninput: bind(step, 'note') }),
      foot);
  }

  const canvas = h('canvas');
  drawPreview(step, canvas);
  const num = h('span', { class: 'num', text: String(nums[i]) });
  const shot = h('div', { class: 'shot', onclick: () => openAnnotator(step) }, canvas, h('span', { class: 'badge', text: 'Click to annotate' }));

  if (guideMode()) {
    const title = h('input', { class: 'title', value: step.title || '', placeholder: 'What to do in this step', 'aria-label': 'Instruction', oninput: bind(step, 'title') });
    const type = h('select', { 'aria-label': 'Callout type', onchange: (e) => { step.callout = e.target.value; saveStepSoon(step); } });
    for (const [v, label] of [['', 'No callout'], ['tip', 'Tip'], ['warning', 'Warning'], ['note', 'Note']]) type.append(h('option', { value: v, text: label }));
    type.value = step.callout || '';
    const text = h('textarea', { rows: 2, placeholder: 'Optional tip, warning or note shown under this step', value: step.note || '', oninput: bind(step, 'note') });
    const zoom = h('label', { class: 'zoom' },
      h('input', { type: 'checkbox', checked: !!step.zoom, onchange: (e) => { step.zoom = e.target.checked; saveStepSoon(step); drawPreview(step, canvas); } }),
      'Zoom to the clicked area in the PDF');
    return h('article', { class: 'card step', 'data-id': step.id },
      h('div', { class: 'step-head' }, num, title),
      h('div', { class: 'callout' }, h('label', {}, 'Callout', type), h('label', {}, 'Text', text)),
      zoom, shot, foot);
  }

  const title = h('input', { class: 'title', value: step.title || '', 'aria-label': 'Step title', oninput: bind(step, 'title') });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Step result' });
  for (const [v, label] of [['pass', 'Pass'], ['fail', 'Fail']]) {
    seg.append(h('button', { 'data-v': v, class: step.status === v ? 'on' : '', text: label,
      onclick: () => {
        step.status = step.status === v ? '' : v;
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === step.status));
        saveStepSoon(step);
      } }));
  }
  const expected = h('textarea', { rows: 2, placeholder: 'What should happen', value: step.expected || '', oninput: bind(step, 'expected') });
  const actual = h('textarea', { rows: 2, placeholder: 'What actually happened', value: step.actual || '', oninput: bind(step, 'actual') });
  const notes = h('textarea', { class: 'notes', rows: 1, placeholder: 'Notes (optional)', value: step.note || '', oninput: bind(step, 'note') });
  return h('article', { class: 'card step', 'data-id': step.id },
    h('div', { class: 'step-head' }, num, title, seg),
    h('div', { class: 'cols' }, h('label', {}, 'Expected', expected), h('label', {}, 'Actual', actual)),
    notes, shot, foot);
}

function render() {
  const nums = stepNumbers(steps);
  $('#steps').replaceChildren(...steps.map((s, i) => stepCard(s, i, nums)));
  $('#empty').hidden = steps.length > 0;
  $('#btnPdf').disabled = false;
}

// Adds a section heading or a paragraph (guides): steps with no screenshot.
async function addTextStep(kind) {
  await flushSaves();
  await db.addStep({ kind, title: kind === 'heading' ? 'New section' : '', note: '', status: '', url: '', image: null, w: 0, h: 0, annotations: [], ts: Date.now() });
  await load();
  channel.postMessage('changed');
  const last = $('#steps').lastElementChild;
  last?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  last?.querySelector('input, textarea')?.focus();
}
$('#addHeading').addEventListener('click', () => addTextStep('heading'));
$('#addText').addEventListener('click', () => addTextStep('text'));

async function move(step, dir) {
  const i = steps.indexOf(step);
  const other = steps[i + dir];
  if (!other) return;
  [step.order, other.order] = [other.order, step.order];
  await Promise.all([db.putStep(step), db.putStep(other)]);
  steps.sort((a, b) => a.order - b.order);
  render();
  channel.postMessage('changed');
}

async function remove(step) {
  if (!confirm('Delete this step?')) return;
  await db.deleteStep(step.id);
  steps = steps.filter((s) => s !== step);
  bitmaps.delete(step.id);
  render();
  channel.postMessage('changed');
}

// ---- Adding images (upload / paste / drop) ----------------------------------------

async function addImages(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const bmp = await createImageBitmap(file);
    await db.addStep({
      title: 'Screenshot', note: '', status: '', kind: 'upload', url: '', pageTitle: '',
      image: file, w: bmp.width, h: bmp.height, annotations: [], ts: Date.now(),
    });
    bmp.close();
  }
  await load();
  channel.postMessage('changed');
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

$('#btnAdd').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { addImages([...e.target.files]); e.target.value = ''; });
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addImages(files); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); addImages([...(e.dataTransfer?.files || [])]); });

// ---- Annotator -------------------------------------------------------------------

const A = { step: null, bmp: null, list: [], tool: 'rect', color: COLORS[0], draft: null, start: null, textAt: null };
const aCanvas = $('#aCanvas');
const aText = $('#aText');

for (const c of COLORS) {
  $('#swatches').append(h('button', { style: `background:${c}`, 'data-c': c, 'aria-label': `Colour ${c}`,
    onclick: () => { A.color = c; syncTools(); } }));
}
$('#tools').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]');
  if (t) { commitText(); A.tool = t.dataset.tool; syncTools(); }
});
function syncTools() {
  $('#tools').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === A.tool));
  $('#swatches').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === A.color));
}

function paintAnnotator() {
  const ctx = aCanvas.getContext('2d');
  ctx.drawImage(A.bmp, 0, 0);
  A.list.forEach((a) => drawAnnotation(ctx, a));
  if (A.draft) drawAnnotation(ctx, A.draft);
}

async function openAnnotator(step) {
  A.step = step;
  A.bmp = await bitmapFor(step);
  A.list = structuredClone(step.annotations || []);
  A.draft = null;
  aCanvas.width = A.bmp.width;
  aCanvas.height = A.bmp.height;
  syncTools();
  $('#annot').hidden = false;
  document.body.style.overflow = 'hidden';
  paintAnnotator();
}

function closeAnnotator() {
  aText.hidden = true;
  A.textAt = null;
  $('#annot').hidden = true;
  document.body.style.overflow = '';
}

function pointOf(e) {
  const r = aCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * aCanvas.width) / r.width, y: ((e.clientY - r.top) * aCanvas.height) / r.height };
}

function makeDraft(p0, p1) {
  const base = { color: A.color, lw: baseLW(aCanvas.width) };
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  switch (A.tool) {
    case 'arrow': return { type: 'arrow', ...base, x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y };
    case 'ring': return { type: 'ring', ...base, x: p0.x, y: p0.y, r: Math.hypot(dx, dy) };
    default: return { type: A.tool, ...base, x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx), h: Math.abs(dy) };
  }
}
const draftSize = (d) => (d.type === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) : d.type === 'ring' ? d.r : Math.max(d.w, d.h));

function commitText() {
  const at = A.textAt;
  A.textAt = null;
  if (!at) return;
  const text = aText.value.trim();
  aText.hidden = true;
  if (text) {
    A.list.push({ type: 'text', text, x: at.x, y: at.y, size: baseFont(aCanvas.width), color: A.color });
    paintAnnotator();
  }
}

aCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  commitText();
  const p = pointOf(e);
  if (A.tool === 'text') {
    const r = aCanvas.getBoundingClientRect();
    const wr = $('#aWrap').getBoundingClientRect();
    A.textAt = p;
    aText.style.left = `${e.clientX - wr.left}px`;
    aText.style.top = `${e.clientY - wr.top}px`;
    aText.style.fontSize = `${Math.max(13, (baseFont(aCanvas.width) * r.width) / aCanvas.width)}px`;
    aText.value = '';
    aText.hidden = false;
    setTimeout(() => aText.focus(), 0);
    return;
  }
  aCanvas.setPointerCapture(e.pointerId);
  A.start = p;
});
aCanvas.addEventListener('pointermove', (e) => {
  if (!A.start) return;
  A.draft = makeDraft(A.start, pointOf(e));
  paintAnnotator();
});
aCanvas.addEventListener('pointerup', () => {
  if (!A.start) return;
  const r = aCanvas.getBoundingClientRect();
  if (A.draft && draftSize(A.draft) > (6 * aCanvas.width) / r.width) A.list.push(A.draft);
  A.draft = null;
  A.start = null;
  paintAnnotator();
});
aText.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') commitText();
  if (e.key === 'Escape') { A.textAt = null; aText.hidden = true; }
});
aText.addEventListener('blur', commitText);

$('#aUndo').addEventListener('click', () => { A.list.pop(); paintAnnotator(); });
$('#aClear').addEventListener('click', () => { A.list = []; paintAnnotator(); });
$('#aCancel').addEventListener('click', closeAnnotator);
$('#aSave').addEventListener('click', async () => {
  commitText();
  A.step.annotations = A.list;
  await db.putStep(A.step);
  const canvas = document.querySelector(`[data-id="${A.step.id}"] canvas`);
  if (canvas) drawPreview(A.step, canvas);
  closeAnnotator();
});
document.addEventListener('keydown', (e) => {
  if ($('#annot').hidden) return;
  if (e.key === 'Escape') closeAnnotator();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); A.list.pop(); paintAnnotator(); }
});

// ---- PDF export --------------------------------------------------------------------

// Turns steps into PDF bytes. `cache` reuses decoded bitmaps for the live session; archived steps decode on demand.
async function renderPdf(list, metaObj, { cache = false, onProgress = () => {} } = {}) {
  const guide = modeOf(metaObj) === 'guide';
  const prepared = [];
  for (let i = 0; i < list.length; i++) {
    onProgress(i + 1, list.length);
    const s = list[i];
    if (isTextStep(s)) { prepared.push({ kind: s.kind, title: s.title, note: s.note }); continue; }
    const bmp = cache ? await bitmapFor(s) : await createImageBitmap(s.image);
    const crop = guide ? cropFor(s, bmp.width, bmp.height) : null;
    const canvas = document.createElement('canvas');
    renderStep(canvas, bmp, s.annotations || [], Math.min(1, 1600 / (crop ? crop.w : bmp.width)), crop);
    if (!cache) bmp.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    prepared.push({
      kind: s.kind, title: s.title, note: s.note, status: s.status, url: s.url, tab: s.tab,
      expected: s.expected, actual: s.actual, callout: s.callout,
      jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height,
    });
  }
  const date = metaObj.date || today();
  const bytes = buildPdf({ meta: { ...metaObj, date, result: metaObj.result || resultFrom(list) }, steps: prepared });
  return { bytes, name: fileNameFor(metaObj, date) };
}

function saveBlob(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  window.__lastPdf = bytes; // handy for tests
}

async function exportPdf() {
  const btn = $('#btnPdf');
  btn.disabled = true;
  const label = btn.textContent;
  try {
    await flushSaves();
    await db.setMeta(meta);
    const { bytes, name } = await renderPdf(steps, meta, {
      cache: true, onProgress: (i, n) => { btn.textContent = `Building… ${i}/${n}`; },
    });
    saveBlob(bytes, name);
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}
$('#btnPdf').addEventListener('click', exportPdf);

// ---- Toast, new session, history -----------------------------------------------------------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function refreshHistoryCount() {
  const n = (await db.listSessions()).length;
  $('#btnHistory').textContent = n ? `History (${n})` : 'History';
}

async function reloadAll() {
  bitmaps.clear();
  meta = await db.getMeta();
  fillMeta();
  applyMode();
  await load();
  await refreshHistoryCount();
  channel.postMessage('changed');
}

const hasWork = () => steps.length > 0 || !!`${meta.ticket || ''}${meta.guideTitle || ''}`.trim();

async function openHistory() {
  const list = await db.listSessions();
  $('#hEmpty').hidden = list.length > 0;
  $('#hList').replaceChildren(...list.map((s) => {
    const when = new Date(s.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const kind = modeOf(s.meta);
    const result = kind === 'test' && s.meta.result ? ` · ${s.meta.result}` : '';
    return h('li', {},
      h('div', { class: 'info' },
        h('b', { text: sessionLabel(s.meta) }),
        h('span', { text: `${MODES[kind]} · ${when} · ${s.count} step${s.count === 1 ? '' : 's'}${result}` })),
      h('button', { text: 'Restore', onclick: () => restoreFromHistory(s.id) }),
      h('button', { text: 'PDF', onclick: (e) => pdfFromHistory(s.id, e.target) }),
      h('button', { class: 'del', text: 'Delete', onclick: async () => {
        if (!confirm('Delete this saved session? This can not be undone.')) return;
        await db.deleteSession(s.id);
        await refreshHistoryCount();
        openHistory();
      } }));
  }));
  $('#historyModal').hidden = false;
}

async function restoreFromHistory(id) {
  if (hasWork() && !confirm('Restore this session? Your current session is saved to History first.')) return;
  await flushSaves();
  await db.restoreSession(id);
  $('#historyModal').hidden = true;
  await reloadAll();
  toast('Session restored');
}

async function pdfFromHistory(id, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  try {
    const session = await db.getSession(id);
    const { bytes, name } = await renderPdf(session.steps, session.meta || {}, {
      onProgress: (i, n) => { btn.textContent = `${i}/${n}`; },
    });
    saveBlob(bytes, name);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

$('#btnHistory').addEventListener('click', openHistory);
$('#hClose').addEventListener('click', () => { $('#historyModal').hidden = true; });
$('#historyModal').addEventListener('click', (e) => { if (e.target.id === 'historyModal') e.target.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#historyModal').hidden = true; });

$('#btnNew').addEventListener('click', async () => {
  if (!hasWork()) return;
  const saves = steps.length > 0;
  const ok = confirm(saves
    ? 'Start a new session? The current one is saved to History (the last 5 are kept).'
    : 'Start a new session?');
  if (!ok) return;
  await flushSaves();
  await db.startNewSession({ tester: meta.tester || '', env: meta.env || '', author: meta.author || '', mode: meta.mode });
  await reloadAll();
  if (saves) toast('Saved to History');
});

// ---- Live updates while recording ------------------------------------------------------

const hasChrome = typeof chrome !== 'undefined' && chrome.storage?.local;
async function syncRecording() {
  if (!hasChrome) return;
  const { recording } = await chrome.storage.local.get('recording');
  $('#recPill').hidden = !recording;
}
channel.onmessage = async () => {
  // The popup may have switched the mode. Only the mode is taken from storage, so a field being typed is not overwritten.
  const fresh = await db.getMeta();
  if (modeOf(fresh) !== modeOf(meta)) { meta.mode = fresh.mode; applyMode(); }
  await load();
  syncRecording();
};
window.addEventListener('focus', async () => { meta = await db.getMeta(); fillMeta(); applyMode(); });

(async function init() {
  meta = await db.getMeta();
  fillMeta();
  applyMode();
  await load();
  syncRecording();
  refreshHistoryCount();
})();

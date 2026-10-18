import * as db from './db.js';
import { COLORS, baseLW, baseFont, drawAnnotation, drawAnnotations, renderStep } from './annotate.js';
import { buildPdf } from './pdf.js';

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

const FIELDS = ['ticket', 'env', 'tester', 'date', 'result', 'summary'];
function fillMeta() {
  for (const f of FIELDS) {
    const el = $('#' + f);
    if (document.activeElement !== el) el.value = meta[f] ?? (f === 'date' ? today() : '');
  }
}
for (const f of FIELDS) {
  $('#' + f).addEventListener('input', (e) => { meta[f] = e.target.value; saveMetaSoon(); });
}

// ---- Step list -----------------------------------------------------------------

async function drawPreview(step, canvas) {
  const bmp = await bitmapFor(step);
  renderStep(canvas, bmp, step.annotations || [], Math.min(1, 1000 / bmp.width));
}

function stepCard(step, i) {
  const multiTab = new Set(steps.map((s) => s.tab).filter(Boolean)).size > 1;
  const canvas = h('canvas');
  drawPreview(step, canvas);

  const title = h('input', { class: 'title', value: step.title || '', 'aria-label': 'Step title',
    oninput: (e) => { step.title = e.target.value; saveStepSoon(step); } });

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Step result' });
  for (const [v, label] of [['pass', 'Pass'], ['fail', 'Fail']]) {
    seg.append(h('button', { 'data-v': v, class: step.status === v ? 'on' : '', text: label,
      onclick: () => {
        step.status = step.status === v ? '' : v;
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === step.status));
        saveStepSoon(step);
      } }));
  }

  const note = h('textarea', { rows: 2, placeholder: 'Add a note: what you verified, expected vs actual…', value: step.note || '',
    oninput: (e) => { step.note = e.target.value; saveStepSoon(step); } });

  const shot = h('div', { class: 'shot', onclick: () => openAnnotator(step) }, canvas, h('span', { class: 'badge', text: 'Click to annotate' }));

  const foot = h('div', { class: 'step-foot' },
    multiTab && step.tab ? h('span', { class: 'tabpill', text: `Tab ${step.tab}` }) : '',
    h('span', { class: 'url', text: step.url || '', title: step.url || '' }),
    h('button', { text: 'Up', disabled: i === 0, onclick: () => move(step, -1) }),
    h('button', { text: 'Down', disabled: i === steps.length - 1, onclick: () => move(step, 1) }),
    h('button', { class: 'del', text: 'Delete', onclick: () => remove(step) }),
  );

  return h('article', { class: 'card step', 'data-id': step.id },
    h('div', { class: 'step-head' }, h('span', { class: 'num', text: String(i + 1) }), title, seg),
    note, shot, foot);
}

function render() {
  const list = $('#steps');
  list.replaceChildren(...steps.map(stepCard));
  $('#empty').hidden = steps.length > 0;
  $('#btnPdf').disabled = false;
}

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
  const prepared = [];
  for (let i = 0; i < list.length; i++) {
    onProgress(i + 1, list.length);
    const s = list[i];
    const bmp = cache ? await bitmapFor(s) : await createImageBitmap(s.image);
    const canvas = document.createElement('canvas');
    renderStep(canvas, bmp, s.annotations || [], Math.min(1, 1600 / bmp.width));
    if (!cache) bmp.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    prepared.push({
      title: s.title, note: s.note, status: s.status, url: s.url, tab: s.tab,
      jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height,
    });
  }
  const statuses = list.map((s) => s.status);
  const derived = statuses.includes('fail') ? 'fail' : statuses.length && statuses.every((v) => v === 'pass') ? 'pass' : '';
  const date = metaObj.date || today();
  const bytes = buildPdf({ meta: { ...metaObj, date, result: metaObj.result || derived }, steps: prepared });
  const name = `UAT-${(metaObj.ticket || 'evidence').trim()}-${date}.pdf`.replace(/[^\w.-]+/g, '_');
  return { bytes, name };
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
  await load();
  await refreshHistoryCount();
  channel.postMessage('changed');
}

const hasWork = () => steps.length > 0 || !!(meta.ticket || '').trim();

async function openHistory() {
  const list = await db.listSessions();
  $('#hEmpty').hidden = list.length > 0;
  $('#hList').replaceChildren(...list.map((s) => {
    const when = new Date(s.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const result = s.meta.result ? ` · ${s.meta.result}` : '';
    return h('li', {},
      h('div', { class: 'info' },
        h('b', { text: s.meta.ticket || 'Untitled session' }),
        h('span', { text: `${when} · ${s.count} step${s.count === 1 ? '' : 's'}${result}` })),
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
  await db.startNewSession({ tester: meta.tester || '', env: meta.env || '' });
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
channel.onmessage = async () => { await load(); syncRecording(); };
window.addEventListener('focus', async () => { meta = await db.getMeta(); fillMeta(); });

(async function init() {
  meta = await db.getMeta();
  fillMeta();
  await load();
  syncRecording();
  refreshHistoryCount();
})();

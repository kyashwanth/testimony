import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { modeOf, isTextStep, stepNumbers, resultFrom, fileNameFor, sessionLabel, CALLOUTS } from '../modes.js';
import { cropFor, renderKey } from '../annotate.js';
import { buildPdf } from '../pdf.js';

// ---- modes.js ---------------------------------------------------------------------------------
assert.equal(modeOf({}), 'test');
assert.equal(modeOf(undefined), 'test');
assert.equal(modeOf({ mode: 'guide' }), 'guide');
assert.equal(modeOf({ mode: 'nonsense' }), 'test', 'unknown or old sessions are test runs');

const mixed = [{ kind: 'heading' }, { kind: 'click' }, { kind: 'text' }, { kind: 'click' }, { kind: 'manual' }];
assert.deepEqual(stepNumbers(mixed), [null, 1, null, 2, 3], 'headings and text-only steps are not numbered');
assert.ok(isTextStep({ kind: 'heading' }) && isTextStep({ kind: 'text' }) && !isTextStep({ kind: 'click' }));

assert.equal(resultFrom([{ status: 'pass' }, { status: 'pass' }]), 'pass');
assert.equal(resultFrom([{ status: 'pass' }, { status: 'fail' }]), 'fail');
assert.equal(resultFrom([{ status: 'pass' }, { status: '' }]), '');
assert.equal(resultFrom([{ kind: 'heading', status: '' }, { status: 'pass' }]), 'pass', 'headings do not block a pass');
assert.equal(resultFrom([]), '');

assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'How to raise an order!' }, '2026-10-20'), 'Guide-How_to_raise_an_order.pdf');
assert.equal(fileNameFor({ mode: 'guide' }, '2026-10-20'), 'Guide-untitled.pdf');
assert.equal(fileNameFor({ ticket: 'PROJ-123' }, '2026-10-20'), 'UAT-PROJ-123-2026-10-20.pdf');
assert.equal(fileNameFor({}, '2026-10-20'), 'UAT-evidence-2026-10-20.pdf');
assert.equal(sessionLabel({ mode: 'guide', guideTitle: ' Refunds ' }), 'Refunds');
assert.equal(sessionLabel({ mode: 'guide' }), 'Untitled guide');
assert.equal(sessionLabel({ ticket: 'PROJ-9' }), 'PROJ-9');
assert.equal(sessionLabel({}), 'Untitled session');
// file names keep every script, drop anything unsafe, and stay short
assert.equal(fileNameFor({ mode: 'guide', guideTitle: '日本語の手順' }, '2026-10-20'), 'Guide-日本語の手順.pdf');
assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'नमस्ते दुनिया' }, '2026-10-20', 'zip'), 'Guide-नमस्ते_दुनिया.zip', 'combining marks are kept');
assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'Café Münster' }, '2026-10-20', 'html'), 'Guide-Café_Münster.html');
assert.equal(fileNameFor({ ticket: '../../etc/passwd' }, '2026-10-20'), 'UAT-etc_passwd-2026-10-20.pdf', 'separators and leading dots never survive');
assert.ok(!/[\/\\:*?"<>|]/.test(fileNameFor({ ticket: 'a/b\\c:d*e?f"g<h>i|j' }, '2026-10-20')), 'no character a file system rejects');
assert.equal(fileNameFor({ mode: 'guide', guideTitle: '😀😀' }, '2026-10-20'), 'Guide-untitled.pdf', 'nothing usable left');
assert.ok(fileNameFor({ mode: 'guide', guideTitle: 'x'.repeat(500) }, '2026-10-20').length < 100, 'length is capped');
// truncation never splits a character and never leaves a trailing dot or underscore
const astral = '\u{20BB7}'.repeat(100);                            // 𠮷 is outside the BMP: two UTF-16 units each
const cut = fileNameFor({ mode: 'guide', guideTitle: astral }, '2026-10-20').replace(/^Guide-|\.pdf$/g, '');
assert.equal(Array.from(cut).length, 80); assert.ok(!/[\uD800-\uDFFF]/.test(cut.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), 'no lone surrogate');
assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'Orders.' }, '2026-10-20', 'zip'), 'Guide-Orders.zip', 'trailing dot removed');
assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'a'.repeat(79) + '!' + 'b' }, '2026-10-20'), 'Guide-' + 'a'.repeat(79) + '.pdf', 'cut ending on a separator is cleaned');
console.log('ok  mode helpers');

// ---- cropFor ----------------------------------------------------------------------------------
assert.equal(cropFor({ zoom: false, annotations: [{ type: 'ring', x: 500, y: 400 }] }, 1440, 900), null, 'off unless asked for');
assert.equal(cropFor({ zoom: true, annotations: [] }, 1440, 900), null, 'nothing to zoom to');
assert.equal(cropFor({ zoom: true, annotations: [{ type: 'text', x: 1, y: 1 }] }, 1440, 900), null, 'only click marks and field boxes count');
const mid = cropFor({ zoom: true, annotations: [{ type: 'ring', x: 720, y: 450, r: 30 }] }, 1440, 900);
assert.deepEqual(mid, { x: 396, y: 248, w: 648, h: 405 }, 'centred on the click, 45% wide, same proportions');
const corner = cropFor({ zoom: true, annotations: [{ type: 'ring', x: 5, y: 5, r: 30 }] }, 1440, 900);
assert.deepEqual([corner.x, corner.y], [0, 0], 'clamped inside the screenshot at the top-left');
const far = cropFor({ zoom: true, annotations: [{ type: 'rect', x: 1400, y: 880, w: 30, h: 20 }] }, 1440, 900);
assert.equal(far.x + far.w, 1440);
assert.equal(far.y + far.h, 900, 'clamped at the bottom-right');
const small = cropFor({ zoom: true, annotations: [{ type: 'ring', x: 100, y: 100, r: 20 }] }, 400, 250);
assert.deepEqual([small.x, small.y, small.w, small.h], [0, 0, 400, 250], 'a small screenshot is not cropped further');
console.log('ok  zoom crop');

// ---- renderKey: when a cached picture may be reused ------------------------------------------------------------------
const base = { id: 1, ts: 100, annotations: [{ type: 'ring', x: 1, y: 2, r: 3 }], zoom: false, title: 'A', note: 'x' };
const k0 = renderKey(base, false, 1600, 0.85);
assert.equal(renderKey({ ...base, title: 'Renamed', note: 'other', status: 'pass', expected: 'e', actual: 'a', callout: 'tip' }, false, 1600, 0.85), k0, 'text fields are not part of the picture');
for (const [what, other] of [
  ['an annotation changed', renderKey({ ...base, annotations: [{ type: 'ring', x: 9, y: 2, r: 3 }] }, false, 1600, 0.85)],
  ['an annotation added', renderKey({ ...base, annotations: [...base.annotations, { type: 'text', text: 'hi', x: 0, y: 0, size: 14, color: '#000' }] }, false, 1600, 0.85)],
  ['zoom toggled', renderKey({ ...base, zoom: true }, false, 1600, 0.85)],
  ['mode (guide crops)', renderKey(base, true, 1600, 0.85)],
  ['width', renderKey(base, false, 1400, 0.85)],
  ['quality', renderKey(base, false, 1600, 0.82)],
  ['another step', renderKey({ ...base, id: 2 }, false, 1600, 0.85)],
  ['the step was replaced (new timestamp)', renderKey({ ...base, ts: 101 }, false, 1600, 0.85)],
]) assert.notEqual(other, k0, `${what} must produce a new key`);
assert.equal(renderKey({ id: 1, ts: 1 }, false, 1600, 0.85), renderKey({ id: 1, ts: 1, annotations: [] }, false, 1600, 0.85), 'missing and empty annotations match');
console.log('ok  the image cache key changes exactly when the picture can change');

// ---- PDF layouts -------------------------------------------------------------------------------
const jpg = (n) => new Uint8Array(readFileSync(new URL(`./${n}.jpg`, import.meta.url)));
const a = jpg('a'), b = jpg('b');
const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const pageCount = (t) => (t.match(/\/Type \/Page /g) || []).length;

const guideSteps = [
  { kind: 'heading', title: 'Before you submit' },
  { kind: 'text', note: 'Make sure the customer record is complete. This paragraph has no screenshot.' },
  { kind: 'click', title: "Click the 'New order' button", note: 'The button is at the top right.', callout: 'tip', jpeg: a, w: 640, h: 400, url: 'https://uat.example.com/orders' },
  { kind: 'input', title: "Selected 'INR' in the 'Currency' dropdown", note: 'Do not change the currency after saving.', callout: 'warning', jpeg: b, w: 400, h: 900 },
  { kind: 'click', title: "Click the 'Create order' button", note: '', jpeg: a, w: 640, h: 400, status: 'fail' },
];
const guideMeta = { mode: 'guide', guideTitle: 'Raise an INR order', summary: 'How to raise a new order in a foreign currency.',
  prereq: 'You need the Orders role and a customer record.', author: 'Jane Tester', version: '1.2', date: '2026-10-20' };
const g = buildPdf({ meta: guideMeta, steps: guideSteps, generatedAt: new Date('2026-10-20T10:00:00Z') });
const gt = text(g);
assert.ok(gt.startsWith('%PDF-1.4') && gt.trimEnd().endsWith('%%EOF'));
for (const must of ['(GUIDE)', '(Raise an INR order)', 'By Jane Tester', 'Version 1.2', 'Updated 2026-10-20', '(Before you start)',
  '(You need the Orders role', '(Before you submit)', '(Make sure the customer record', '(1. Click the', '(2. Selected', '(3. Click the', '(Tip)', '(Warning)']) {
  assert.ok(gt.includes(must), `guide PDF should contain ${must}`);
}
for (const mustNot of ['PASSED', 'FAILED', 'UAT EVIDENCE', '(Result)', 'https://uat.example.com']) {
  assert.ok(!gt.includes(mustNot), `guide PDF should not contain ${mustNot}`);
}
assert.ok(gt.includes('Guide - Raise an INR order'), 'document title');
assert.equal((gt.match(/\/Subtype \/Image/g) || []).length, 3, 'one image per real step; headings and text steps have none');
console.log('ok  guide PDF: instructions, callouts, headings, no results');

const testSteps = [
  { kind: 'click', title: "Click the 'Sign in' button", status: 'pass', expected: 'Dashboard opens', actual: 'Dashboard opened in 2 s', note: 'Fast enough', jpeg: a, w: 640, h: 400, url: 'https://uat.example.com/login' },
  { kind: 'click', title: "Click the 'Pay' button", status: 'fail', expected: 'Receipt is shown', actual: 'Error 500', jpeg: b, w: 400, h: 900 },
];
const tt = text(buildPdf({ meta: { ticket: 'PROJ-123', env: 'UAT', tester: 'Jane', result: 'fail', date: '2026-10-20' }, steps: testSteps, generatedAt: new Date('2026-10-20T10:00:00Z') }));
for (const must of ['(UAT EVIDENCE)', '(PROJ-123)', '(PASSED)', '(FAILED)', '(Expected)', '(Actual)', '(Dashboard opens)', '(Error 500)', '(FAIL)', '(Fast enough)']) {
  assert.ok(tt.includes(must), `test PDF should contain ${must}`);
}
assert.ok(!tt.includes('(GUIDE)') && !tt.includes('(Tip)'), 'no guide furniture in an evidence report');
console.log('ok  test PDF: result, Pass/Fail, expected vs actual');

// numbering skips headings in the evidence report too (a session can be switched between modes)
const switched = text(buildPdf({ meta: { ticket: 'X' }, steps: [{ kind: 'heading', title: 'Setup' }, ...testSteps], generatedAt: new Date() }));
assert.ok(switched.includes('(1. Click the') && switched.includes('(2. Click the') && switched.includes('(Setup)'));
console.log('ok  a session switched between modes still exports cleanly');

// many steps flow over several pages without losing any
const many = Array.from({ length: 14 }, (_, i) => ({ kind: 'click', title: `Step number ${i + 1}`, note: i % 3 === 0 ? 'A tip.' : '', callout: 'tip', jpeg: a, w: 640, h: 400 }));
const mp = text(buildPdf({ meta: { mode: 'guide', guideTitle: 'Long one' }, steps: many, generatedAt: new Date() }));
assert.ok(pageCount(mp) >= 4, 'flows over several pages');
for (let i = 1; i <= 14; i++) assert.ok(mp.includes(`(${i}. Step number ${i})`), `step ${i} present`);
console.log('ok  a long guide paginates and keeps every step');

// an empty guide still produces a valid document
const empty = text(buildPdf({ meta: { mode: 'guide' }, steps: [], generatedAt: new Date() }));
assert.ok(empty.includes('(Untitled guide)') && empty.includes('No steps were captured'));
console.log('ok  an empty guide is valid');

// write samples for the visual check
const out = process.env.SAMPLE_DIR;
if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/guide.pdf`, g); writeFileSync(`${out}/many.pdf`, buildPdf({ meta: { mode: 'guide', guideTitle: 'Long one' }, steps: many, generatedAt: new Date() })); }
console.log('\nmodes tests passed');

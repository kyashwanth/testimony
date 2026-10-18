import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildHtml, esc } from '../html.js';
import { fileNameFor } from '../modes.js';

const jpg = (n) => new Uint8Array(readFileSync(new URL(`./${n}.jpg`, import.meta.url)));
const a = jpg('a'), b = jpg('b');
const NOW = new Date('2026-10-20T10:00:00Z');

// ---- escaping -------------------------------------------------------------------------------------
assert.equal(esc(`<script>alert("x")</script> & 'q'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
assert.equal(esc(undefined), '');
assert.equal(esc(0), '0');

// Hostile text in EVERY user-controlled field must come out inert.
const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
const hostile = {
  meta: { mode: 'test', ticket: evil, env: evil, tester: evil, summary: evil, result: 'fail', date: evil },
  steps: [{ kind: 'click', title: evil, note: evil, status: 'fail', url: evil, tab: 1, expected: evil, actual: evil, jpeg: a, w: 640, h: 400 },
          { kind: 'click', title: 'second', tab: 2, jpeg: b, w: 400, h: 900 }],
};
const guideHostile = {
  meta: { mode: 'guide', guideTitle: evil, author: evil, version: evil, summary: evil, prereq: evil },
  steps: [{ kind: 'heading', title: evil }, { kind: 'text', note: evil }, { kind: 'heading', title: 'Second' },
          { kind: 'click', title: evil, note: evil, callout: 'tip', jpeg: a, w: 640, h: 400 }],
};
for (const [name, doc] of [['test run', hostile], ['guide', guideHostile]]) {
  const html = buildHtml({ ...doc, generatedAt: NOW });
  assert.ok(!/<script/i.test(html), `${name}: no script element can be injected`);
  // Every <img> must be exactly what the builder emits: only alt/width/height/src, the alt holding no raw quote or
  // angle bracket and the src being a base64 data URI. Anything injected would break this shape.
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  for (const tag of imgs) {
    assert.match(tag, /^<img alt="[^"<>]*" width="\d+" height="\d+" src="data:image\/jpeg;base64,[A-Za-z0-9+\/=]+">$/, `${name}: unexpected <img> shape: ${tag.slice(0, 120)}`);
  }
  assert.ok(!/"><img/.test(html), `${name}: attribute breakout is neutralised`);
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), `${name}: hostile text is shown as text`);
}
console.log('ok  hostile text in every field is escaped (test run and guide)');

// ---- self-contained --------------------------------------------------------------------------------
const guideSteps = [
  { kind: 'heading', title: 'Prepare' },
  { kind: 'text', note: 'Read this first.\nSecond line of the paragraph.' },
  { kind: 'heading', title: 'Create the order' },
  { kind: 'click', title: "Click the 'New order' button", note: 'Top right of the list.', callout: 'tip', jpeg: a, w: 640, h: 400, url: 'https://uat.example.com/orders' },
  { kind: 'input', title: "Selected 'INR' in the 'Currency' dropdown", note: 'Do not change it later.', callout: 'warning', jpeg: b, w: 400, h: 900 },
  { kind: 'click', title: 'Click Save', note: '', jpeg: a, w: 640, h: 400 },
];
const guideMeta = { mode: 'guide', guideTitle: 'Raise an INR order', author: 'Jane Tester', version: '1.2', date: '2026-10-20',
  summary: 'How to raise a new order in a foreign currency.', prereq: 'You need the Orders role.' };
const guide = buildHtml({ meta: guideMeta, steps: guideSteps, generatedAt: NOW });

assert.ok(guide.startsWith('<!doctype html>'));
assert.ok(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'/.test(guide), 'strict CSP');
assert.ok(!/<script|<link|<iframe|<object|<embed|@import|url\(/i.test(guide), 'no script, link, iframe, import or css url()');
assert.ok(!/(?:src|href)="https?:/i.test(guide), 'no external resource or link');
assert.equal((guide.match(/src="data:image\/jpeg;base64,/g) || []).length, 3, 'one embedded image per real step');
console.log('ok  self-contained: no script, no external resource, strict CSP');

// the embedded image is byte-for-byte the screenshot that went in
const m = guide.match(/src="data:image\/jpeg;base64,([^"]+)"/);
const back = Uint8Array.from(Buffer.from(m[1], 'base64'));
assert.deepEqual([...back], [...a], 'first embedded image is identical to the input');
console.log('ok  embedded screenshots are byte-identical');

// ---- guide content ---------------------------------------------------------------------------------------
for (const must of ['<p class="eyebrow">Guide</p>', '<h1>Raise an INR order</h1>', 'By Jane Tester', 'Version 1.2', 'Updated 2026-10-20',
  'How to raise a new order', 'Before you start', 'You need the Orders role.', '<title>Guide: Raise an INR order</title>',
  '<h2 id="h0">Prepare</h2>', '<h2 id="h2">Create the order</h2>', 'Read this first.\nSecond line',
  '<span class="n">1.</span>', '<span class="n">2.</span>', '<span class="n">3.</span>', 'class="callout tip"', 'class="callout warning"',
  '<nav class="toc"', 'href="#h0"', 'href="#h2"', 'alt="Screenshot for step 2: Selected &#39;INR&#39;']) {
  assert.ok(guide.includes(must), `guide should contain: ${must}`);
}
for (const mustNot of ['Passed', 'Failed', 'UAT evidence', 'class="facts"', 'https://uat.example.com']) {
  assert.ok(!guide.includes(mustNot), `guide should not contain: ${mustNot}`);
}
assert.ok(!guide.includes('<span class="n">4.</span>'), 'headings and text steps are not numbered');
console.log('ok  guide: header, contents, numbered steps, callouts, no results');

// ---- test run content --------------------------------------------------------------------------------------
const testHtml = buildHtml({
  meta: { ticket: 'PROJ-123', env: 'UAT, build 7', tester: 'Jane', date: '2026-10-20', result: 'fail', summary: 'Login works; payment fails.' },
  steps: [
    { kind: 'click', title: 'Sign in', status: 'pass', expected: 'Dashboard opens', actual: 'Opened in 2 s', note: 'Fast', tab: 1, url: 'https://uat.example.com/login', jpeg: a, w: 640, h: 400 },
    { kind: 'click', title: 'Pay', status: 'fail', expected: 'Receipt', actual: 'Error 500', tab: 2, jpeg: b, w: 400, h: 900 },
  ],
  generatedAt: NOW,
});
for (const must of ['<p class="eyebrow">UAT evidence</p>', '<h1>PROJ-123</h1>', 'UAT, build 7', 'Jane', '2026-10-20', '2 captured (1 passed, 1 failed)',
  '<span class="badge fail">Fail</span>', '<span class="badge pass">Passed</span>', '<span class="badge fail">Failed</span>',
  '<b>Expected</b>', '<b>Actual</b>', 'Dashboard opens', 'Error 500', 'Tab 1', 'Tab 2', 'https://uat.example.com/login', 'Login works; payment fails.',
  '<title>UAT evidence: PROJ-123</title>', 'generated 2026-10-20 10:00 UTC']) {
  assert.ok(testHtml.includes(must), `test HTML should contain: ${must}`);
}
assert.ok(!testHtml.includes('class="callout') && !testHtml.includes('>Guide<') && !testHtml.includes('class="toc"'), 'no guide furniture in a test report');
console.log('ok  test run: result, Pass/Fail, expected vs actual, tabs');

// single-tab sessions do not show tab labels
const single = buildHtml({ meta: { ticket: 'X' }, steps: [{ kind: 'click', title: 'A', tab: 1, jpeg: a, w: 640, h: 400 }, { kind: 'click', title: 'B', tab: 1, jpeg: a, w: 640, h: 400 }], generatedAt: NOW });
assert.ok(!single.includes('Tab 1'));
console.log('ok  tab labels appear only when several tabs were used');

// unicode survives (HTML, unlike the PDF's built-in fonts, supports every script)
const uni = buildHtml({ meta: { mode: 'guide', guideTitle: 'Café — 日本語 😀 ₹' }, steps: [{ kind: 'text', note: 'Emoji 😀 and Hindi नमस्ते' }], generatedAt: NOW });
assert.ok(uni.includes('Café — 日本語 😀 ₹') && uni.includes('नमस्ते') && uni.includes('<meta charset="utf-8">'));
console.log('ok  any script and emoji are preserved');

// ---- structure -----------------------------------------------------------------------------------------------------
function balanced(html) {
  const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);
  const stack = [];
  const noData = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '<style></style>');
  for (const t of noData.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const [, close, name] = t; const tag = name.toLowerCase();
    if (VOID.has(tag) || t[0].endsWith('/>')) continue;
    if (!close) stack.push(tag);
    else { if (stack.pop() !== tag) return `unexpected </${tag}>`; }
  }
  return stack.length ? `unclosed: ${stack.join(',')}` : 'ok';
}
for (const [name, html] of [['guide', guide], ['test', testHtml], ['hostile', buildHtml({ ...hostile, generatedAt: NOW })], ['guide hostile', buildHtml({ ...guideHostile, generatedAt: NOW })]]) {
  assert.equal(balanced(html), 'ok', `${name}: tags are balanced`);
  assert.equal((html.match(/<h1>/g) || []).length, 1, `${name}: exactly one h1`);
}
console.log('ok  well-formed: balanced tags, one h1');

// responsive and print rules are present
assert.ok(guide.includes('@media print') && guide.includes('@media (max-width:560px)') && guide.includes('prefers-color-scheme:dark') && guide.includes('name="viewport"'));
console.log('ok  has print, dark and small-screen styles');

// ---- edge cases ------------------------------------------------------------------------------------------------------
const empty = buildHtml({ meta: { mode: 'guide' }, steps: [], generatedAt: NOW });
assert.ok(empty.includes('Untitled guide') && empty.includes('No steps were captured.') && balanced(empty) === 'ok');
const emptyTest = buildHtml({ meta: {}, steps: [], generatedAt: NOW });
assert.ok(emptyTest.includes('Untitled test session') && balanced(emptyTest) === 'ok');
const noContents = buildHtml({ meta: { mode: 'guide' }, steps: [{ kind: 'heading', title: 'Only one' }], generatedAt: NOW });
assert.ok(!noContents.includes('class="toc"'), 'a contents list needs at least two headings');
// a session switched between modes still exports
const switched = buildHtml({ meta: { ticket: 'S' }, steps: [{ kind: 'heading', title: 'Setup' }, { kind: 'click', title: 'One', status: 'pass', jpeg: a, w: 640, h: 400 }], generatedAt: NOW });
assert.ok(switched.includes('<h2 id="h0">Setup</h2>') && switched.includes('<span class="n">1.</span>') && balanced(switched) === 'ok');
// a large session
const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'click', title: `Step ${i + 1}`, jpeg: b, w: 400, h: 900 }));
const big = buildHtml({ meta: { mode: 'guide', guideTitle: 'Big' }, steps: many, generatedAt: NOW });
assert.equal((big.match(/<section class="step"/g) || []).length, 30);
console.log('ok  empty, switched and large sessions');

// file names
assert.equal(fileNameFor({ mode: 'guide', guideTitle: 'How to raise an order' }, '2026-10-20', 'html'), 'Guide-How_to_raise_an_order.html');
assert.equal(fileNameFor({ ticket: 'PROJ-123' }, '2026-10-20', 'html'), 'UAT-PROJ-123-2026-10-20.html');
assert.equal(fileNameFor({ ticket: 'PROJ-123' }, '2026-10-20'), 'UAT-PROJ-123-2026-10-20.pdf', 'pdf stays the default');
console.log('ok  file names');

const out = process.env.SAMPLE_DIR;
if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/guide.html`, guide); writeFileSync(`${out}/test-run.html`, testHtml); writeFileSync(`${out}/hostile.html`, buildHtml({ ...hostile, generatedAt: NOW })); }
console.log('\nhtml tests passed');

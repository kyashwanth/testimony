import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMarkdown, escapeInline } from '../markdown.js';
import { buildZip } from '../zip.js';
import { imageName, fileNameFor } from '../modes.js';

const jpg = (n) => new Uint8Array(readFileSync(new URL(`./${n}.jpg`, import.meta.url)));
const a = jpg('a'), b = jpg('b');
const NOW = new Date('2026-10-20T10:00:00Z');

// ---- escaping ---------------------------------------------------------------------------------------------
assert.equal(escapeInline('*bold* _it_ `code` [x](y) | <b>&</b> \\'), '\\*bold\\* \\_it\\_ \\`code\\` \\[x\\](y) \\| &lt;b&gt;&amp;&lt;/b&gt; \\\\');
assert.equal(escapeInline("Click the 'Sign in' button."), "Click the 'Sign in' button.", 'ordinary text is left readable');
assert.equal(escapeInline(undefined), '');
console.log('ok  inline escaping');

// ---- hostile text must stay inert in every field --------------------------------------------------------------
const evil = '![x](javascript:alert(1)) [click](https://evil.example) <script>alert(2)</script> <img src=x onerror=alert(3)> `` ` ``';
const hostile = buildMarkdown({
  meta: { mode: 'test', ticket: evil, env: evil, tester: evil, summary: evil, result: 'fail', date: evil },
  steps: [{ kind: 'click', title: evil, note: evil, status: 'fail', url: evil, tab: 1, expected: evil, actual: evil, jpeg: a, w: 640, h: 400 },
          { kind: 'click', title: 'two', tab: 2, jpeg: b, w: 400, h: 900 }],
  generatedAt: NOW,
});
const hostileGuide = buildMarkdown({
  meta: { mode: 'guide', guideTitle: evil, author: evil, version: evil, summary: evil, prereq: evil },
  steps: [{ kind: 'heading', title: evil }, { kind: 'text', note: evil }, { kind: 'click', title: evil, note: evil, callout: 'tip', jpeg: a, w: 640, h: 400 }],
  generatedAt: NOW,
});
for (const [name, { markdown: md }] of [['test run', hostile], ['guide', hostileGuide]]) {
  assert.ok(!/</.test(md), `${name}: no raw "<" so no HTML can be injected`);
  // Code spans are literal in Markdown (they hold URLs), so check the prose around them.
  const prose = md.replace(/(`+)[\s\S]*?\1/g, '');
  assert.ok(!/(?<!\\)\]\(/.test(prose.replace(/\]\(images\/step-\d+\.jpg\)/g, '')), `${name}: no unescaped link syntax from user text`);
  // the only unescaped "[" allowed are the image links this builder writes itself
  const bare = prose.match(/(?<!\\)\[/g) || [];
  assert.equal(bare.length, (prose.match(/!\[Screenshot for step/g) || []).length, `${name}: no unescaped [ from user text`);
  const headings = md.split('\n').filter((l) => /^#{1,6}\s/.test(l)).length;
  assert.equal(headings, name === 'guide' ? 3 : 4, `${name}: only the headings the builder writes (user text cannot start a heading)`);
  assert.ok(md.includes('&lt;script&gt;alert\\(2\\)') || md.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), `${name}: the text is shown literally`);
}
console.log('ok  hostile text in every field cannot become HTML, a link or an image');

// ---- text that would turn into formatting at the start of a line --------------------------------------------------
const lineStarts = buildMarkdown({ meta: { ticket: 'L' }, steps: [{ kind: 'text', note: '# not a heading\n1. not a list\n- not a bullet\n+ not either\n> not a quote\n---\n===' }], generatedAt: NOW }).markdown;
assert.ok(lineStarts.includes('\\# not a heading  \n1\\. not a list  \n\\- not a bullet  \n\\+ not either  \n&gt; not a quote  \n\\---  \n\\==='), lineStarts);
console.log('ok  line-start formatting characters are escaped, and line breaks are kept');

// text must not be able to open a code block and swallow the rest of the document
const codeBlocks = buildMarkdown({ meta: { ticket: 'C' }, steps: [
  { kind: 'text', note: '~~~\nnot a fence\n~~~~' },
  { kind: 'text', note: '    four spaces\n\ttab indented\n  two spaces' },
  { kind: 'click', title: 'After', jpeg: a, w: 640, h: 400 },
], generatedAt: NOW }).markdown;
assert.ok(!/(^|\n) {0,3}~{3,}/.test(codeBlocks), 'no line starts with a tilde fence (the escaped ones start with a backslash)');
assert.ok(codeBlocks.includes('\\~~~  \nnot a fence  \n\\~~~~'), codeBlocks);
assert.ok(!/(^|\n)( {4}|\t)\S/.test(codeBlocks), 'no line indented enough to become a code block');
assert.ok(codeBlocks.includes('four spaces') && codeBlocks.includes('   tab indented') && codeBlocks.includes('  two spaces'), 'the text is kept and indentation is capped at three columns');
console.log('ok  tilde fences and deep indentation cannot open a code block');

// ---- guide ----------------------------------------------------------------------------------------------------------
const guideSteps = [
  { kind: 'heading', title: 'Create the order' },
  { kind: 'text', note: 'Read this first.\nSecond line.' },
  { kind: 'click', title: "Click the 'New order' button", note: 'Top right of the list.', callout: 'tip', jpeg: a, w: 640, h: 400, url: 'https://uat.example.com/orders' },
  { kind: 'input', title: "Selected 'INR' in the 'Currency' dropdown", note: 'Do not change it later.\nReally.', callout: 'warning', jpeg: b, w: 400, h: 900 },
  { kind: 'click', title: 'Click Save', note: '', jpeg: a, w: 640, h: 400 },
];
const gmeta = { mode: 'guide', guideTitle: 'Raise an INR order', author: 'Jane Tester', version: '1.2', date: '2026-10-20', summary: 'How to raise a new order.', prereq: 'You need the Orders role.' };
const g = buildMarkdown({ meta: gmeta, steps: guideSteps, generatedAt: NOW });
for (const must of ['# Raise an INR order', '*By Jane Tester · Version 1.2 · Updated 2026-10-20*', 'How to raise a new order.', '> **Before you start:** You need the Orders role.',
  '## Create the order', 'Read this first.  \nSecond line.', "### 1. Click the 'New order' button", '> **Tip:** Top right of the list.',
  "### 2. Selected 'INR' in the 'Currency' dropdown", '> **Warning:** Do not change it later.  \n> Really.', '### 3. Click Save',
  '![Screenshot for step 1: Click the \'New order\' button](images/step-01.jpg)', '![Screenshot for step 3: Click Save](images/step-03.jpg)', 'updated 2026-10-20']) {
  assert.ok(g.markdown.includes(must), `guide should contain: ${must}`);
}
for (const mustNot of ['PASSED', 'FAILED', 'UAT evidence', '| **Environment**', 'https://uat.example.com']) assert.ok(!g.markdown.includes(mustNot), `guide must not contain: ${mustNot}`);
assert.deepEqual(g.images.map((i) => i.name), ['images/step-01.jpg', 'images/step-02.jpg', 'images/step-03.jpg'], 'headings and text steps have no image');
assert.deepEqual([...g.images[0].data], [...a], 'images are the exact screenshots');
for (const img of g.images) assert.ok(g.markdown.includes(`](${img.name})`), `${img.name} is referenced`);
console.log('ok  guide: header, headings, callouts, numbered steps, images');

// ---- test run ---------------------------------------------------------------------------------------------------------
const t = buildMarkdown({
  meta: { ticket: 'PROJ-123', env: 'UAT | build 7', tester: 'Jane', date: '2026-10-20', result: 'fail', summary: 'Login works; payment fails.' },
  steps: [
    { kind: 'click', title: 'Sign in', status: 'pass', expected: 'Dashboard opens', actual: 'Opened in 2 s', note: 'Fast', tab: 1, url: 'https://uat.example.com/login', jpeg: a, w: 640, h: 400 },
    { kind: 'click', title: 'Pay', status: 'fail', expected: 'Receipt', actual: 'Error 500', tab: 2, url: 'https://uat.example.com/pay?x=`1`', jpeg: b, w: 400, h: 900 },
  ],
  generatedAt: NOW,
});
for (const must of ['# PROJ-123', '| **Environment** | UAT \\| build 7 |', '| **Tested by** | Jane |', '| **Steps** | 2 captured (1 passed, 1 failed) |', '| **Result** | **FAIL** |',
  '## Summary', 'Login works; payment fails.', '### 1. Sign in — **PASSED**', '### 2. Pay — **FAILED**', '**Expected:** Dashboard opens  \n**Actual:** Opened in 2 s',
  '*`Tab 1` · `https://uat.example.com/login`*', '`` Tab 2``', 'Fast', 'UAT evidence · generated 2026-10-20 10:00 UTC']) {
  if (must === '`` Tab 2``') continue;
  assert.ok(t.markdown.includes(must), `test run should contain: ${must}`);
}
assert.ok(t.markdown.includes('`` https://uat.example.com/pay?x=`1` ``'), 'a URL containing a backtick is wrapped in a longer code fence');
assert.ok(!t.markdown.includes('> **Tip') && !t.markdown.includes('Before you start'), 'no guide furniture');
const single = buildMarkdown({ meta: { ticket: 'X' }, steps: [{ kind: 'click', title: 'A', tab: 1, jpeg: a, w: 1, h: 1 }, { kind: 'click', title: 'B', tab: 1, jpeg: a, w: 1, h: 1 }], generatedAt: NOW });
assert.ok(!single.markdown.includes('Tab 1'), 'tab labels only with several tabs');
console.log('ok  test run: table, result, Pass/Fail, expected vs actual, code-spanned URLs');

// ---- edge cases ----------------------------------------------------------------------------------------------------------
assert.ok(buildMarkdown({ meta: { mode: 'guide' }, steps: [], generatedAt: NOW }).markdown.includes('# Untitled guide'));
const emptyTest = buildMarkdown({ meta: {}, steps: [], generatedAt: NOW });
assert.ok(emptyTest.markdown.includes('# Untitled test session') && emptyTest.markdown.includes('*No steps were captured.*') && emptyTest.images.length === 0);
const uni = buildMarkdown({ meta: { mode: 'guide', guideTitle: 'Café 日本語 😀 ₹' }, steps: [{ kind: 'text', note: 'नमस्ते 😀' }], generatedAt: NOW }).markdown;
assert.ok(uni.includes('# Café 日本語 😀 ₹') && uni.includes('नमस्ते 😀'));
const big = buildMarkdown({ meta: { mode: 'guide', guideTitle: 'Big' }, steps: Array.from({ length: 120 }, (_, i) => ({ kind: 'click', title: `S${i}`, jpeg: b, w: 1, h: 1 })), generatedAt: NOW });
assert.equal(big.images[0].name, 'images/step-001.jpg'); assert.equal(big.images[119].name, 'images/step-120.jpg');
assert.equal(imageName(5, 9), 'step-05.jpg');
console.log('ok  empty, unicode and 100+ step sessions');

// ---- the package: Markdown + images in a folder, as the editor zips it --------------------------------------------------------
const stem = fileNameFor(gmeta, '2026-10-20', 'md').replace(/\.md$/, '');
const zip = buildZip([{ name: `${stem}/${stem}.md`, data: g.markdown }, ...g.images.map((i) => ({ name: `${stem}/${i.name}`, data: i.data }))], new Date(2026, 9, 20));
const dir = mkdtempSync(join(tmpdir(), 'md-'));
writeFileSync(join(dir, 'pkg.zip'), zip);
const un = spawnSync('unzip', ['-q', join(dir, 'pkg.zip'), '-d', join(dir, 'out')], { encoding: 'utf8' });
if (un.error === undefined) {
  assert.equal(un.status, 0, un.stderr);
  const md = readFileSync(join(dir, 'out', stem, `${stem}.md`), 'utf8');
  for (const m of md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)) {
    assert.ok(readFileSync(join(dir, 'out', stem, m[1])).length > 0, `${m[1]} exists next to the Markdown file after unzipping`);
  }
  console.log('ok  unzipped package: every image the Markdown refers to is present beside it');
}
rmSync(dir, { recursive: true, force: true });

console.log('\nmarkdown tests passed');

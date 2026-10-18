import assert from 'node:assert/strict';
import { buildCsv, cell, TEST_COLUMNS, GUIDE_COLUMNS } from '../csv.js';
import { imageName } from '../modes.js';

// An independent RFC 4180 reader, so the output is checked against a parser and not against itself.
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xfeff, 'starts with a byte-order mark so Excel reads UTF-8');
  text = text.slice(1);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (c === '\n') assert.fail('bare LF outside quotes: line endings must be CRLF');
    else field += c;
  }
  assert.equal(q, false, 'no unterminated quote');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---- quoting ------------------------------------------------------------------------------------------
assert.equal(cell('plain'), 'plain');
assert.equal(cell('a,b'), '"a,b"');
assert.equal(cell('say "hi"'), '"say ""hi"""');
assert.equal(cell('two\nlines'), '"two\nlines"');
assert.equal(cell('cr\rlf'), '"cr\rlf"');
assert.equal(cell(null), ''); assert.equal(cell(undefined), ''); assert.equal(cell(0), '0');
console.log('ok  quoting follows RFC 4180');

// ---- formula injection --------------------------------------------------------------------------------
for (const evil of ['=1+1', '=HYPERLINK("http://evil.example","click")', '+1', '-2+3', '@SUM(A1:A2)', '\tcmd', '\rcmd']) {
  const out = cell(evil);
  assert.ok(out.startsWith("'") || out.startsWith('"\''), `${JSON.stringify(evil)} must be neutralised, got ${JSON.stringify(out)}`);
}
assert.equal(cell('a=b'), 'a=b', 'only a leading character matters');
assert.equal(cell("'already"), "'already");
assert.equal(cell('Total: -5'), 'Total: -5');
console.log('ok  cells that could run as formulas are neutralised');

// ---- test run ----------------------------------------------------------------------------------------------
const meta = { ticket: 'PROJ-123', env: 'UAT, build 7', tester: 'Jane "JT" Tester', date: '2026-10-20', result: 'fail' };
const t0 = Date.UTC(2026, 9, 20, 10, 0, 0);
const steps = [
  { kind: 'heading', title: 'Login' },
  { kind: 'click', title: "Click the 'Sign in' button", status: 'pass', expected: 'Dashboard opens', actual: 'Opened in 2 s', note: 'Fast', tab: 1, url: 'https://uat.example.com/login?a=1&b=2', ts: t0 },
  { kind: 'text', note: 'A paragraph between steps' },
  { kind: 'input', title: 'Typed, with a comma', status: 'fail', expected: 'Line one\nLine two', actual: '=SUM(A1)', note: '-5% fee', tab: 2, ts: t0 + 60000 },
  { kind: 'final', title: 'Final state', ts: t0 + 120000 },
];
const csv = buildCsv({ meta, steps });
const rows = parseCsv(csv);
assert.deepEqual(rows[0], TEST_COLUMNS);
assert.ok(rows.every((r) => r.length === TEST_COLUMNS.length), 'every row has the same number of columns as the header');
assert.equal(rows.length, 1 + 4, 'header + 3 steps + 1 text row; the heading is not a row');
const col = (name) => TEST_COLUMNS.indexOf(name);

const r1 = rows[1];
assert.deepEqual([r1[col('Ticket')], r1[col('Environment')], r1[col('Tested by')], r1[col('Date')], r1[col('Overall result')]],
  ['PROJ-123', 'UAT, build 7', 'Jane "JT" Tester', '2026-10-20', 'Fail'], 'session details are repeated on every row and survive quoting');
assert.deepEqual([r1[col('Step')], r1[col('Title')], r1[col('Result')], r1[col('Expected')], r1[col('Actual')], r1[col('Notes')], r1[col('Tab')]],
  ['1', "Click the 'Sign in' button", 'Passed', 'Dashboard opens', 'Opened in 2 s', 'Fast', '1']);
assert.equal(r1[col('Page')], 'https://uat.example.com/login?a=1&b=2');
assert.equal(r1[col('Captured at')], '2026-10-20T10:00:00.000Z');
assert.equal(r1[col('Screenshot')], imageName(1, 3), 'matches the file name in the Markdown package');
const rText = rows[2];
assert.deepEqual([rText[col('Step')], rText[col('Title')], rText[col('Screenshot')]], ['', 'A paragraph between steps', ''], 'text-only step: no number, no screenshot');
const r2 = rows[3];
assert.equal(r2[col('Step')], '2');
assert.equal(r2[col('Result')], 'Failed');
assert.equal(r2[col('Expected')], 'Line one\nLine two', 'newlines inside a cell survive');
assert.equal(r2[col('Actual')], "'=SUM(A1)", 'a formula-looking cell is neutralised');
assert.equal(r2[col('Notes')], "'-5% fee");
assert.equal(r2[col('Title')], 'Typed, with a comma');
assert.equal(r2[col('Screenshot')], imageName(2, 3));
assert.equal(rows[4][col('Step')], '3'); assert.equal(rows[4][col('Result')], '', 'no mark, no result');
assert.ok(csv.endsWith('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')), 'CRLF line endings outside quoted cells');
console.log('ok  test run: columns, repeated details, results, quoting, injection, screenshot names');

// ---- guide -------------------------------------------------------------------------------------------------------
const gmeta = { mode: 'guide', guideTitle: 'Raise an INR order', version: '1.2', author: 'Jane', date: '2026-10-20' };
const gsteps = [
  { kind: 'heading', title: 'Prepare' },
  { kind: 'click', title: 'Open the form', note: 'Top right', callout: 'tip', url: 'https://uat.example.com/orders', ts: t0 },
  { kind: 'heading', title: 'Submit' },
  { kind: 'click', title: 'Press Save', note: 'Do not close the tab', callout: 'warning' },
  { kind: 'click', title: 'Confirm', note: '', callout: '' },
  { kind: 'text', note: 'Done.' },
];
const grows = parseCsv(buildCsv({ meta: gmeta, steps: gsteps }));
assert.deepEqual(grows[0], GUIDE_COLUMNS);
assert.ok(grows.every((r) => r.length === GUIDE_COLUMNS.length));
const g = (name) => GUIDE_COLUMNS.indexOf(name);
assert.deepEqual([grows[1][g('Guide')], grows[1][g('Version')], grows[1][g('Author')], grows[1][g('Updated')]], ['Raise an INR order', '1.2', 'Jane', '2026-10-20']);
assert.deepEqual([grows[1][g('Section')], grows[1][g('Step')], grows[1][g('Instruction')], grows[1][g('Callout')], grows[1][g('Callout text')]], ['Prepare', '1', 'Open the form', 'Tip', 'Top right']);
assert.deepEqual([grows[2][g('Section')], grows[2][g('Step')], grows[2][g('Callout')]], ['Submit', '2', 'Warning'], 'the section follows the heading');
assert.deepEqual([grows[3][g('Section')], grows[3][g('Callout')], grows[3][g('Callout text')]], ['Submit', '', ''], 'no note, no callout');
assert.deepEqual([grows[4][g('Step')], grows[4][g('Instruction')]], ['', 'Done.']);
assert.ok(!grows.some((r) => r.includes('Passed') || r.includes('Failed')), 'no results in a guide');
console.log('ok  guide: sections, callouts, no results');

// ---- unicode, empty, large ------------------------------------------------------------------------------------------
const uni = parseCsv(buildCsv({ meta: { ticket: 'Café ₹ 日本語 😀' }, steps: [{ kind: 'click', title: 'नमस्ते 😀', jpeg: null }] }));
assert.equal(uni[1][col('Ticket')], 'Café ₹ 日本語 😀'); assert.equal(uni[1][col('Title')], 'नमस्ते 😀');
const none = parseCsv(buildCsv({ meta: {}, steps: [] }));
assert.deepEqual(none, [TEST_COLUMNS], 'an empty session is just the header');
const many = parseCsv(buildCsv({ meta: { ticket: 'X' }, steps: Array.from({ length: 150 }, (_, i) => ({ kind: 'click', title: `Step ${i + 1}` })) }));
assert.equal(many.length, 151);
assert.equal(many[1][col('Screenshot')], 'step-001.jpg', 'padding grows with the number of steps, like the Markdown package');
assert.equal(many[150][col('Screenshot')], 'step-150.jpg');
console.log('ok  unicode, empty and large sessions');

console.log('\ncsv tests passed');

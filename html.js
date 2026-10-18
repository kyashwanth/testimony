// Builds a single, self-contained HTML document for a session: the same content as the PDF, as a web page.
// Screenshots are embedded as data: URIs, styles are inline, and there is no script, so the file can be opened
// anywhere, attached to a ticket or dropped into a wiki without breaking, and never contacts a server.
//
// Everything a person typed (titles, notes, URLs, ticket numbers...) is escaped. The page also carries a strict
// Content-Security-Policy as defence in depth. Pure functions with no DOM access, so it runs under Node for tests.

import { modeOf, stepNumbers, isTextStep, CALLOUTS } from './modes.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const STATUS = { pass: ['pass', 'Passed'], fail: ['fail', 'Failed'] };
const RESULT = { pass: ['pass', 'Pass'], fail: ['fail', 'Fail'], blocked: ['blocked', 'Blocked'] };

const CSS = `
:root{--bg:#fff;--ink:#14213d;--muted:#5b6475;--line:#e1e5ee;--soft:#f4f6fb;--accent:#2563eb;
--tip:#2563eb;--tip-bg:#e8efff;--warning:#b45309;--warning-bg:#fff7e0;--note:#5b6475;--note-bg:#f3f4f6;
--pass:#15803d;--fail:#b91c1c;--blocked:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0f1424;--ink:#e8ecf6;--muted:#aab3c8;--line:#2a3350;--soft:#151b2f;--accent:#6c9cff;
--tip:#8db1ff;--tip-bg:#1b2748;--warning:#f0b254;--warning-bg:#33290f;--note:#aab3c8;--note-bg:#1b2236;
--pass:#4ade80;--fail:#f87171;--blocked:#f0b254}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 24px 64px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 6px}
h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:0 0 10px}
h2{font-size:22px;margin:40px 0 6px;padding-bottom:6px;border-bottom:2px solid var(--accent)}
.byline,.muted{color:var(--muted);font-size:14px}
.lead{font-size:18px;margin:16px 0}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 18px;margin:16px 0 8px;font-size:15px}
dl.facts dt{color:var(--muted)} dl.facts dd{margin:0}
.badge{display:inline-block;padding:1px 10px;border-radius:99px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff}
.badge.pass{background:var(--pass)}.badge.fail{background:var(--fail)}.badge.blocked{background:var(--blocked)}
.callout{border-left:4px solid var(--note);background:var(--note-bg);padding:10px 16px;margin:12px 0;border-radius:0 8px 8px 0}
.callout .label{display:block;font-weight:700;font-size:14px;margin-bottom:2px;color:var(--note)}
.callout.tip{border-color:var(--tip);background:var(--tip-bg)}.callout.tip .label{color:var(--tip)}
.callout.warning{border-color:var(--warning);background:var(--warning-bg)}.callout.warning .label{color:var(--warning)}
.callout p{margin:0}
nav.toc{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px 20px;margin:24px 0}
nav.toc strong{display:block;margin-bottom:4px}
nav.toc ol{margin:0;padding-left:20px}
.step{margin:28px 0 0;padding-top:18px;border-top:1px solid var(--line)}
.step h3{font-size:18px;margin:0 0 4px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.step h3 .n{color:var(--accent)}
.step .where{font-size:13px;color:var(--muted);word-break:break-all;margin:0 0 6px}
.pair{display:grid;grid-template-columns:78px 1fr;gap:2px 12px;font-size:15px;margin:6px 0}
.pair b{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.04em;padding-top:2px}
.pre{white-space:pre-wrap;margin:6px 0}
figure{margin:12px 0 0}
figure img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
footer{margin-top:48px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media print{
:root{--bg:#fff;--ink:#14213d;--muted:#5b6475;--line:#e1e5ee;--soft:#f4f6fb;--accent:#2563eb;--tip:#2563eb;--tip-bg:#e8efff;--warning:#b45309;--warning-bg:#fff7e0;--note:#5b6475;--note-bg:#f3f4f6;--pass:#15803d;--fail:#b91c1c;--blocked:#b45309}
body{font-size:11pt}main{max-width:none;padding:0}.step{break-inside:avoid}h2{break-after:avoid}
.badge,.callout{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media (max-width:560px){h1{font-size:28px}.pair{grid-template-columns:1fr}dl.facts{grid-template-columns:1fr}}
`.trim();

// `steps` are prepared steps: { kind, title, note, status, url, tab, expected, actual, callout, jpeg (bytes), w, h }.
// Headings and text-only steps have no jpeg.
export function buildHtml({ meta = {}, steps = [], generatedAt = new Date() }) {
  const guide = modeOf(meta) === 'guide';
  const nums = stepNumbers(steps);
  const date = meta.date || generatedAt.toISOString().slice(0, 10);
  const stamp = generatedAt.toISOString().slice(0, 16).replace('T', ' ');
  const numbered = steps.filter((s) => !isTextStep(s));
  const multiTab = new Set(steps.map((s) => s.tab).filter(Boolean)).size > 1;

  const title = guide ? (meta.guideTitle || '').trim() || 'Untitled guide' : (meta.ticket || '').trim() || 'Untitled test session';
  const docTitle = guide ? `Guide: ${title}` : `UAT evidence: ${title}`;
  const para = (text) => `<p class="pre">${esc(text)}</p>`;
  const callout = (kind, text) =>
    `<div class="callout ${kind}"><span class="label">${esc(CALLOUTS[kind] || 'Note')}</span><p class="pre">${esc(text)}</p></div>`;

  // ---- header -------------------------------------------------------------------------------
  const head = [];
  if (guide) {
    head.push(`<p class="eyebrow">Guide</p>`, `<h1>${esc(title)}</h1>`);
    const by = [meta.author && `By ${meta.author}`, meta.version && `Version ${meta.version}`, `Updated ${date}`].filter(Boolean);
    head.push(`<p class="byline">${by.map(esc).join(' &middot; ')}</p>`);
    if (meta.summary && meta.summary.trim()) head.push(`<p class="lead pre">${esc(meta.summary)}</p>`);
    if (meta.prereq && meta.prereq.trim()) head.push(`<div class="callout tip"><span class="label">Before you start</span><p class="pre">${esc(meta.prereq)}</p></div>`);
    const headings = steps.map((s, i) => [s, i]).filter(([s]) => s.kind === 'heading');
    if (headings.length >= 2) {
      head.push(`<nav class="toc" aria-label="Contents"><strong>Contents</strong><ol>${
        headings.map(([s, i]) => `<li><a href="#h${i}">${esc(s.title || 'Section')}</a></li>`).join('')}</ol></nav>`);
    }
  } else {
    const counts = { pass: 0, fail: 0 };
    numbered.forEach((s) => { if (counts[s.status] !== undefined) counts[s.status]++; });
    const result = RESULT[meta.result];
    head.push(`<p class="eyebrow">UAT evidence</p>`, `<h1>${esc(meta.ticket ? meta.ticket : 'Untitled test session')}</h1>`);
    head.push(`<dl class="facts">`
      + `<dt>Environment</dt><dd>${esc(meta.env || '-')}</dd>`
      + `<dt>Tested by</dt><dd>${esc(meta.tester || '-')}</dd>`
      + `<dt>Date</dt><dd>${esc(date)}</dd>`
      + `<dt>Steps</dt><dd>${numbered.length} captured${counts.pass || counts.fail ? ` (${counts.pass} passed, ${counts.fail} failed)` : ''}</dd>`
      + `<dt>Result</dt><dd>${result ? `<span class="badge ${result[0]}">${result[1]}</span>` : '-'}</dd></dl>`);
    if (meta.summary && meta.summary.trim()) head.push(`<h2>Summary</h2>`, para(meta.summary));
  }

  // ---- steps --------------------------------------------------------------------------------
  const body = steps.map((s, i) => {
    if (s.kind === 'heading') return `<h2 id="h${i}">${esc(s.title || 'Section')}</h2>`;
    if (s.kind === 'text') return s.note && s.note.trim() ? para(s.note) : '';

    const n = nums[i];
    const out = [`<section class="step" id="s${n}">`];
    if (guide) {
      out.push(`<h3><span class="n">${n}.</span> ${esc(s.title || 'Step')}</h3>`);
      if (s.note && s.note.trim()) out.push(callout(CALLOUTS[s.callout] ? s.callout : 'note', s.note));
    } else {
      const status = STATUS[s.status];
      out.push(`<h3><span class="n">${n}.</span> ${esc(s.title || 'Step')}${status ? ` <span class="badge ${status[0]}">${status[1]}</span>` : ''}</h3>`);
      const where = [multiTab && s.tab ? `Tab ${s.tab}` : '', s.url || ''].filter(Boolean).join('  |  ');
      if (where) out.push(`<p class="where">${esc(where)}</p>`);
      for (const [label, value] of [['Expected', s.expected], ['Actual', s.actual]]) {
        if (value && value.trim()) out.push(`<div class="pair"><b>${label}</b><span class="pre">${esc(value)}</span></div>`);
      }
      if (s.note && s.note.trim()) out.push(para(s.note));
    }
    if (s.jpeg) {
      const alt = `Screenshot for step ${n}: ${s.title || 'Step'}`;
      out.push(`<figure><img alt="${esc(alt)}" width="${Math.round(s.w)}" height="${Math.round(s.h)}" src="data:image/jpeg;base64,${toBase64(s.jpeg)}"></figure>`);
    }
    out.push('</section>');
    return out.join('\n');
  });
  if (!steps.length) body.push('<p class="muted">No steps were captured.</p>');

  // ---- footer + document ----------------------------------------------------------------------
  const footer = guide ? `${esc(title)} &middot; updated ${esc(date)}` : `${meta.ticket ? `${esc(meta.ticket)} &middot; ` : ''}UAT evidence &middot; generated ${esc(stamp)} UTC`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Testimony">
<title>${esc(docTitle)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
${head.join('\n')}
${body.join('\n')}
<footer>${footer}</footer>
</main>
</body>
</html>
`;
}

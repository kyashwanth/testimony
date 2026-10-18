// Builds a Markdown document for a session, plus the screenshots it refers to (images/step-01.jpg ...).
// The editor packs the two into a ZIP, so the Markdown works anywhere: Confluence, GitHub, Notion, a wiki, an editor.
//
// Markdown is also an injection route: pasted into a tool that renders it, user text could add links, images or
// raw HTML. Everything typed is therefore escaped so it shows literally, including characters that only matter at the
// start of a line (headings, lists, rules). Pure functions; runs under Node for tests.

import { modeOf, stepNumbers, isTextStep, imageName, CALLOUTS } from './modes.js';

// Escapes text so it renders literally. `\` ` * _ [ ] | are backslash-escaped; & < > become entities, which also
// stops raw HTML such as <script> or <img onerror=...> from surviving.
export function escapeInline(text) {
  return String(text ?? '')
    .replace(/[\\`*_\[\]|]/g, '\\$&')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Characters that change meaning only at the start of a line: #, "1.", "-", "+", a line of --- or ===, a ~~~ code
// fence, and four or more columns of indentation (an indented code block).
function escapeLine(line) {
  return escapeInline(line.replace(/^(?: {4,}|\t)[ \t]*/, '   '))
    .replace(/^(\s*)(~{3,})/, '$1\\$2')
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4')
    .replace(/^(\s*)([-+])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)([-=]{3,})\s*$/, '$1\\$2');
}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const title1 = (text, fallback) => escapeInline(oneLine(text) || fallback);
// A multi-line text block; two trailing spaces make each line break survive.
const block = (text) => String(text ?? '').trim().split(/\r?\n/).map(escapeLine).join('  \n');

// Inline code, with a fence long enough to survive backticks inside (used for URLs, which must not be interpreted).
// A code span is literal in Markdown, but "<" and ">" are percent-encoded as a URL would be, so no renderer that is
// less strict than the standard can be tricked into seeing a tag.
function code(text) {
  const t = oneLine(text).replace(/</g, '%3C').replace(/>/g, '%3E');
  const longest = Math.max(0, ...(t.match(/`+/g) || []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return longest ? `${fence} ${t} ${fence}` : `${fence}${t}${fence}`;
}

const quote = (label, text) => `> **${label}:** ${String(text).trim().split(/\r?\n/).map(escapeLine).join('  \n> ')}`;

const RESULT = { pass: 'PASS', fail: 'FAIL', blocked: 'BLOCKED' };
const STATUS = { pass: 'PASSED', fail: 'FAILED' };

// `steps` are prepared steps: { kind, title, note, status, url, tab, expected, actual, callout, jpeg (bytes), w, h }.
// Returns { markdown, images: [{ name: 'images/step-01.jpg', data: Uint8Array }] }.
export function buildMarkdown({ meta = {}, steps = [], generatedAt = new Date() }) {
  const guide = modeOf(meta) === 'guide';
  const nums = stepNumbers(steps);
  const total = nums.filter(Boolean).length;
  const date = meta.date || generatedAt.toISOString().slice(0, 10);
  const multiTab = new Set(steps.map((s) => s.tab).filter(Boolean)).size > 1;
  const out = [];
  const images = [];

  // ---- header ---------------------------------------------------------------------------------------
  if (guide) {
    out.push(`# ${title1(meta.guideTitle, 'Untitled guide')}`);
    const by = [meta.author && `By ${meta.author}`, meta.version && `Version ${meta.version}`, `Updated ${date}`].filter(Boolean);
    out.push(`*${by.map(escapeInline).join(' · ')}*`);
    if (meta.summary && meta.summary.trim()) out.push(block(meta.summary));
    if (meta.prereq && meta.prereq.trim()) out.push(quote('Before you start', meta.prereq));
  } else {
    const numbered = steps.filter((s) => !isTextStep(s));
    const counts = { pass: 0, fail: 0 };
    numbered.forEach((s) => { if (counts[s.status] !== undefined) counts[s.status]++; });
    out.push(`# ${title1(meta.ticket, 'Untitled test session')}`);
    out.push([
      '| | |', '|---|---|',
      `| **Environment** | ${escapeInline(oneLine(meta.env) || '-')} |`,
      `| **Tested by** | ${escapeInline(oneLine(meta.tester) || '-')} |`,
      `| **Date** | ${escapeInline(date)} |`,
      `| **Steps** | ${numbered.length} captured${counts.pass || counts.fail ? ` (${counts.pass} passed, ${counts.fail} failed)` : ''} |`,
      `| **Result** | ${RESULT[meta.result] ? `**${RESULT[meta.result]}**` : '-'} |`,
    ].join('\n'));
    if (meta.summary && meta.summary.trim()) out.push('## Summary', block(meta.summary));
  }

  // ---- steps ----------------------------------------------------------------------------------------
  steps.forEach((s, i) => {
    if (s.kind === 'heading') { out.push(`## ${title1(s.title, 'Section')}`); return; }
    if (s.kind === 'text') { if (s.note && s.note.trim()) out.push(block(s.note)); return; }

    const n = nums[i];
    const status = STATUS[s.status];
    out.push(`### ${n}. ${title1(s.title, 'Step')}${!guide && status ? ` — **${status}**` : ''}`);

    if (guide) {
      if (s.note && s.note.trim()) out.push(quote(CALLOUTS[s.callout] || 'Note', s.note));
    } else {
      const where = [multiTab && s.tab ? `Tab ${s.tab}` : '', s.url || ''].filter(Boolean);
      if (where.length) out.push(`*${where.map((w) => code(w)).join(' · ')}*`);
      const lines = [];
      if (s.expected && s.expected.trim()) lines.push(`**Expected:** ${block(s.expected)}`);
      if (s.actual && s.actual.trim()) lines.push(`**Actual:** ${block(s.actual)}`);
      if (lines.length) out.push(lines.join('  \n'));
      if (s.note && s.note.trim()) out.push(block(s.note));
    }

    if (s.jpeg) {
      const name = imageName(n, total);
      images.push({ name: `images/${name}`, data: s.jpeg });
      out.push(`![${escapeInline(`Screenshot for step ${n}: ${oneLine(s.title) || 'Step'}`)}](images/${name})`);
    }
  });

  if (!steps.length) out.push('*No steps were captured.*');
  out.push('---', guide
    ? `${escapeInline(oneLine(meta.guideTitle) || 'Guide')} · updated ${escapeInline(date)}`
    : `${meta.ticket ? `${escapeInline(oneLine(meta.ticket))} · ` : ''}UAT evidence · generated ${escapeInline(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC`);

  return { markdown: out.join('\n\n') + '\n', images };
}

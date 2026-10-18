// Builds a CSV of the session's steps, for spreadsheets and test-management imports.
//
// Format: UTF-8 with a byte-order mark (so Excel opens non-English text correctly), CRLF line endings, fields
// quoted per RFC 4180. One row per step, with the session details repeated on every row so a flat import works.
//
// Spreadsheets treat a cell that starts with = + - @ (or a tab or carriage return) as a formula, and people type
// notes like "-5% fee" or "=A1". Such cells are prefixed with an apostrophe so they stay text and cannot run
// anything ("CSV injection"). Pure functions; runs under Node for tests.

import { modeOf, stepNumbers, isTextStep, imageName } from './modes.js';

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

export function cell(value) {
  let s = String(value ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (ts) => (Number.isFinite(ts) ? new Date(ts).toISOString() : '');
const RESULT = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked' };
const STATUS = { pass: 'Passed', fail: 'Failed' };
const CALLOUT = { tip: 'Tip', warning: 'Warning', note: 'Note' };

export const TEST_COLUMNS = ['Ticket', 'Environment', 'Tested by', 'Date', 'Overall result', 'Step', 'Title', 'Result',
  'Expected', 'Actual', 'Notes', 'Page', 'Tab', 'Captured at', 'Screenshot'];
export const GUIDE_COLUMNS = ['Guide', 'Version', 'Author', 'Updated', 'Section', 'Step', 'Instruction', 'Callout',
  'Callout text', 'Page', 'Captured at', 'Screenshot'];

// `steps` are the editor's step records (no images needed). The overall result is whatever meta.result holds.
export function buildCsv({ meta = {}, steps = [] }) {
  const guide = modeOf(meta) === 'guide';
  const nums = stepNumbers(steps);
  const total = nums.filter(Boolean).length;
  const date = meta.date || '';
  const rows = [guide ? GUIDE_COLUMNS : TEST_COLUMNS];

  let section = '';
  steps.forEach((s, i) => {
    if (s.kind === 'heading') { section = s.title || ''; return; }
    const text = isTextStep(s);
    const step = nums[i] ?? '';
    const shot = text ? '' : imageName(nums[i], total);
    if (guide) {
      rows.push([meta.guideTitle || '', meta.version || '', meta.author || '', date, section, step,
        text ? s.note || '' : s.title || '', text ? '' : (s.note ? CALLOUT[s.callout] || 'Note' : ''), text ? '' : s.note || '',
        s.url || '', iso(s.ts), shot]);
    } else {
      rows.push([meta.ticket || '', meta.env || '', meta.tester || '', date, RESULT[meta.result] || '', step,
        text ? s.note || '' : s.title || '', text ? '' : STATUS[s.status] || '', s.expected || '', s.actual || '',
        text ? '' : s.note || '', s.url || '', s.tab ?? '', iso(s.ts), shot]);
    }
  });
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

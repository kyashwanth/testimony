// Shared logic for the two ways of using Testimony. Pure functions (no DOM, no chrome.*) so the popup, editor,
// service worker and PDF writer all agree, and so they can be unit tested.
//
//   guide: a how-to / SOP. Instructions, tips and warnings, no results.
//   test:  evidence for a test run. Ticket, environment, Pass/Fail, expected vs actual.
//
// The mode belongs to the session (meta.mode) and only changes how it is edited and exported. Switching it never
// deletes anything, so one recording can be turned into either document.

export const MODES = { guide: 'Guide', test: 'Test run' };
export const CALLOUTS = { tip: 'Tip', warning: 'Warning', note: 'Note' };

export const modeOf = (meta) => (meta && meta.mode === 'guide' ? 'guide' : 'test');

// Headings and text-only steps have no screenshot and are not numbered.
export const isTextStep = (step) => step.kind === 'heading' || step.kind === 'text';

// Step numbers for display: 1, 2, 3 for real steps, null for headings and text-only steps.
export function stepNumbers(steps) {
  let n = 0;
  return steps.map((s) => (isTextStep(s) ? null : ++n));
}

// Overall result worked out from the individual Pass/Fail marks.
export function resultFrom(steps) {
  const marks = steps.filter((s) => !isTextStep(s)).map((s) => s.status);
  if (marks.includes('fail')) return 'fail';
  return marks.length && marks.every((m) => m === 'pass') ? 'pass' : '';
}

// File-name safe, but keeps letters, accents and digits from every script, so a guide titled in Japanese or Hindi does
// not become "untitled". Path separators, quotes and other punctuation become "_"; the length is capped.
const safe = (s) => Array.from(String(s || '').trim().replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_').replace(/^[_.-]+/, ''))
  .slice(0, 80).join('').replace(/[_.-]+$/, ''); // cut on whole characters; no trailing dot (Windows drops it) or underscore

export function fileNameFor(meta, date, ext = 'pdf') {
  if (modeOf(meta) === 'guide') return `Guide-${safe(meta.guideTitle) || 'untitled'}.${ext}`;
  return `UAT-${safe(meta.ticket) || 'evidence'}-${date}.${ext}`;
}

// What the History list shows as a session's name.
export function sessionLabel(meta) {
  if (modeOf(meta) === 'guide') return (meta.guideTitle || '').trim() || 'Untitled guide';
  return (meta.ticket || '').trim() || 'Untitled session';
}

// File name of a step's screenshot inside the Markdown package: step-01.jpg, step-02.jpg... Zero-padded so the
// files sort correctly, and the CSV's "Screenshot" column uses the same names so the two exports line up.
export function imageName(n, total) {
  return `step-${String(n).padStart(Math.max(2, String(total).length), '0')}.jpg`;
}

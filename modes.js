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

const safe = (s) => String(s || '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');

export function fileNameFor(meta, date) {
  if (modeOf(meta) === 'guide') return `Guide-${safe(meta.guideTitle) || 'untitled'}.pdf`;
  return `UAT-${safe(meta.ticket) || 'evidence'}-${date}.pdf`;
}

// What the History list shows as a session's name.
export function sessionLabel(meta) {
  if (modeOf(meta) === 'guide') return (meta.guideTitle || '').trim() || 'Untitled guide';
  return (meta.ticket || '').trim() || 'Untitled session';
}

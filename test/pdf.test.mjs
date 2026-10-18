import { readFileSync, writeFileSync } from 'node:fs';
import { buildPdf } from '../pdf.js';

const a = new Uint8Array(readFileSync(new URL('./a.jpg', import.meta.url)));
const b = new Uint8Array(readFileSync(new URL('./b.jpg', import.meta.url)));

const long = 'The login page accepted the credentials and redirected to the dashboard. '.repeat(6);
const steps = [
  { title: "Click the 'Sign in' button", note: 'Expected: dashboard loads. Actual: dashboard loads in ~2s.', status: 'pass', tab: 1, url: 'https://uat.example.com/login?redirect=%2Fdashboard%3Ftab%3Dhome', jpeg: a, w: 640, h: 400 },
  { title: 'Screenshot – smart “quotes” and — dashes, café, 日本語, 😀', note: long, status: 'fail', tab: 2, url: '', jpeg: b, w: 400, h: 900 },
  { title: 'Third step (should start on a new page if it does not fit)', note: '', status: '', url: 'https://uat.example.com/a-very-long-url/' + 'segment/'.repeat(30), jpeg: a, w: 640, h: 400 },
  { title: 'Fourth', note: 'Line one\nLine two (with parens) and back\\slash', status: 'pass', jpeg: a, w: 640, h: 400 },
];
const meta = { ticket: 'PROJ-123', env: 'UAT (build 2026.09.19.3)', tester: 'Jane Tester', date: '2026-09-19', result: 'fail', summary: 'Login works; one defect found on step 2.\nSee PROJ-456.' };

const bytes = buildPdf({ meta, steps, generatedAt: new Date('2026-09-19T10:30:00Z') });
writeFileSync(new URL('./out.pdf', import.meta.url), bytes);
const text = new TextDecoder('latin1').decode(bytes);
if (!text.includes('(Tab 2)') || !text.includes('(Tab 1  |  https://uat.example.com/login')) { console.error('tab labels missing from multi-tab PDF'); process.exit(1); }
const single = new TextDecoder('latin1').decode(buildPdf({ meta, steps: steps.map((s) => ({ ...s, tab: 1 })) }));
if (single.includes('(Tab 1')) { console.error('single-tab PDF should not show tab labels'); process.exit(1); }
console.log('tab labels ok');
const head = new TextDecoder('latin1').decode(bytes.slice(0, 8));
const tail = new TextDecoder('latin1').decode(bytes.slice(-6));
console.log({ size: bytes.length, head: head.trim(), tail: tail.trim() });
if (!head.startsWith('%PDF-1.4') || !tail.includes('%%EOF')) process.exit(1);

// xref offsets must point at "N 0 obj"
const txt = new TextDecoder('latin1').decode(bytes);
const xrefAt = Number(txt.match(/startxref\n(\d+)/)[1]);
const entries = txt.slice(xrefAt).split('\n').slice(3).filter((l) => /^\d{10} 00000 n/.test(l));
entries.forEach((l, i) => {
  const off = Number(l.slice(0, 10));
  if (!txt.startsWith(`${i + 1} 0 obj`, off)) { console.error('bad xref for obj', i + 1); process.exit(1); }
});
console.log('xref ok for', entries.length, 'objects; pages:', (txt.match(/\/Type \/Page /g) || []).length);

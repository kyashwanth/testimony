// Minimal, dependency-free PDF writer for the UAT evidence report.
// Text uses the built-in Helvetica fonts (WinAnsi); screenshots are embedded
// as JPEG (DCTDecode) so nothing is re-compressed. No DOM access, so it also
// runs under Node for tests.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 46; // leave room for the footer

// Helvetica advance widths (1/1000 em) for ASCII 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const CP1252 = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };

const COLOR = {
  ink: [0.10, 0.11, 0.13],
  grey: [0.42, 0.45, 0.50],
  line: [0.85, 0.87, 0.90],
  pass: [0.09, 0.55, 0.25],
  fail: [0.85, 0.19, 0.16],
  warn: [0.80, 0.52, 0.04],
  accent: [0.15, 0.39, 0.92],
};

// Convert to a "binary string" of WinAnsi bytes; anything unmappable becomes '?'.
function enc(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if ((c >= 32 && c < 127) || (c >= 160 && c < 256)) out += ch;
    else if (CP1252[ch]) out += String.fromCharCode(CP1252[ch]);
    else if (ch === '\t') out += '  ';
    else if (ch === '\n') out += '\n';
    else out += '?';
  }
  return out;
}

const esc = (s) => s.replace(/[\\()]/g, '\\$&');

function width(s, size, bold) {
  const t = bold ? HELV_B : HELV;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += c >= 32 && c <= 126 ? t[c - 32] : bold ? 611 : 556;
  }
  return (w * size) / 1000;
}

function wrap(text, size, bold, maxW) {
  const lines = [];
  for (const para of enc(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/ +/)) {
      const trial = line ? line + ' ' + word : word;
      if (width(trial, size, bold) <= maxW) { line = trial; continue; }
      if (line) lines.push(line);
      line = word;
      // break words that are wider than a whole line (long URLs, ids)
      while (width(line, size, bold) > maxW) {
        let cut = line.length - 1;
        while (cut > 1 && width(line.slice(0, cut), size, bold) > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

function truncate(text, size, bold, maxW) {
  const s = enc(text);
  if (width(s, size, bold) <= maxW) return s;
  let n = s.length;
  while (n > 1 && width(s.slice(0, n) + '...', size, bold) > maxW) n--;
  return s.slice(0, n) + '...';
}

const f = (n) => (Math.round(n * 100) / 100).toString();
const rg = (c) => `${f(c[0])} ${f(c[1])} ${f(c[2])}`;

class Page {
  constructor() {
    this.ops = [];
    this.images = []; // { data, w, h }
  }
  text(x, yTop, str, size, { bold = false, color = COLOR.ink } = {}) {
    const base = PAGE_H - (yTop + size);
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${rg(color)} rg ${f(x)} ${f(base)} Td (${esc(str)}) Tj ET`);
  }
  rect(x, yTop, w, h, { fill, stroke, lw = 0.75 } = {}) {
    const y = PAGE_H - yTop - h;
    let ops = '';
    if (fill) ops += `${rg(fill)} rg `;
    if (stroke) ops += `${rg(stroke)} RG ${f(lw)} w `;
    ops += `${f(x)} ${f(y)} ${f(w)} ${f(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`;
    this.ops.push(ops);
  }
  line(x1, yTop, x2, { color = COLOR.line, lw = 0.75 } = {}) {
    const y = PAGE_H - yTop;
    this.ops.push(`${rg(color)} RG ${f(lw)} w ${f(x1)} ${f(y)} m ${f(x2)} ${f(y)} l S`);
  }
  image(img, x, yTop, w, h) {
    this.images.push(img);
    const name = `Im${this.images.length}`;
    this.ops.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(PAGE_H - yTop - h)} cm /${name} Do Q`);
    this.rect(x, yTop, w, h, { stroke: COLOR.line });
  }
}

const STATUS = {
  pass: { label: 'PASSED', color: COLOR.pass },
  fail: { label: 'FAILED', color: COLOR.fail },
};

const RESULT = {
  pass: { label: 'PASS', color: COLOR.pass },
  fail: { label: 'FAIL', color: COLOR.fail },
  blocked: { label: 'BLOCKED', color: COLOR.warn },
};

export function buildPdf({ meta = {}, steps = [], generatedAt = new Date() }) {
  const pages = [];
  let page;
  let y;

  const newPage = () => { page = new Page(); pages.push(page); y = MARGIN; };
  const remaining = () => BOTTOM - y;
  const ensure = (h) => { if (h > remaining()) newPage(); };

  const paragraph = (text, size, opts = {}) => {
    const lh = size * 1.4;
    for (const l of wrap(text, size, !!opts.bold, opts.width || CONTENT_W)) {
      ensure(lh);
      if (l) page.text(opts.x ?? MARGIN, y, l, size, opts);
      y += lh;
    }
  };

  // ---- Header -------------------------------------------------------------
  newPage();
  page.rect(0, 0, PAGE_W, 6, { fill: COLOR.accent });
  y = MARGIN + 6;
  page.text(MARGIN, y, 'UAT EVIDENCE', 9, { bold: true, color: COLOR.accent });
  y += 16;
  const heading = meta.ticket ? enc(meta.ticket) : 'Untitled test session';
  page.text(MARGIN, y, truncate(heading, 24, true, CONTENT_W), 24, { bold: true });
  y += 38;

  const date = meta.date || generatedAt.toISOString().slice(0, 10);
  const result = RESULT[meta.result];
  const counts = { pass: 0, fail: 0 };
  steps.forEach((s) => { if (counts[s.status] !== undefined) counts[s.status]++; });

  const rows = [
    ['Environment', meta.env || '-'],
    ['Tested by', meta.tester || '-'],
    ['Date', date],
    ['Steps', `${steps.length} captured` + (counts.pass || counts.fail ? `  (${counts.pass} passed, ${counts.fail} failed)` : '')],
  ];
  const labelW = 86;
  for (const [k, v] of rows) {
    page.text(MARGIN, y, k, 10, { color: COLOR.grey });
    page.text(MARGIN + labelW, y, truncate(v, 10, false, CONTENT_W - labelW), 10);
    y += 16;
  }
  page.text(MARGIN, y, 'Result', 10, { color: COLOR.grey });
  if (result) {
    const bw = width(result.label, 10, true) + 16;
    page.rect(MARGIN + labelW, y - 3, bw, 17, { fill: result.color });
    page.text(MARGIN + labelW + 8, y, result.label, 10, { bold: true, color: [1, 1, 1] });
  } else {
    page.text(MARGIN + labelW, y, '-', 10);
  }
  y += 26;

  if (meta.summary && meta.summary.trim()) {
    page.line(MARGIN, y, PAGE_W - MARGIN);
    y += 12;
    paragraph('Summary', 11, { bold: true });
    y += 2;
    paragraph(meta.summary, 10);
  }
  y += 8;

  // ---- Steps --------------------------------------------------------------
  const MAX_IMG_H = 500;
  const multiTab = new Set(steps.map((s) => s.tab).filter(Boolean)).size > 1;
  steps.forEach((s, i) => {
    const where = [multiTab && s.tab ? `Tab ${s.tab}` : '', s.url || ''].filter(Boolean).join('  |  ');
    const titleLines = wrap(`${i + 1}. ${s.title || 'Step'}`, 12, true, CONTENT_W);
    const noteLines = s.note && s.note.trim() ? wrap(s.note, 10, false, CONTENT_W) : [];
    let iw = CONTENT_W;
    let ih = iw * (s.h / s.w);
    if (ih > MAX_IMG_H) { ih = MAX_IMG_H; iw = ih * (s.w / s.h); }

    const status = STATUS[s.status];
    const blockH = titleLines.length * 16.5 + (status ? 15 : 0) + (where ? 13 : 0) + noteLines.length * 14 + 6 + ih + 26;
    if (blockH <= BOTTOM - MARGIN && blockH > remaining()) newPage();
    else ensure(60);

    page.line(MARGIN, y, PAGE_W - MARGIN);
    y += 12;
    for (const l of titleLines) { ensure(16.5); page.text(MARGIN, y, l, 12, { bold: true }); y += 16.5; }
    if (status) {
      ensure(15);
      page.text(MARGIN, y, status.label, 9, { bold: true, color: status.color });
      y += 15;
    }
    if (where) {
      ensure(13);
      page.text(MARGIN, y, truncate(where, 8, false, CONTENT_W), 8, { color: COLOR.grey });
      y += 13;
    }
    for (const l of noteLines) { ensure(14); if (l) page.text(MARGIN, y, l, 10); y += 14; }
    y += 6;
    ensure(ih);
    page.image({ data: s.jpeg, w: s.w, h: s.h }, MARGIN, y, iw, ih);
    y += ih + 14;
  });

  if (!steps.length) paragraph('No steps were captured.', 10, { color: COLOR.grey });

  // ---- Footer on every page -------------------------------------------------
  const footerLabel = enc(`${meta.ticket ? meta.ticket + '  |  ' : ''}UAT evidence  |  generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  pages.forEach((p, i) => {
    p.line(MARGIN, PAGE_H - 34, PAGE_W - MARGIN);
    p.text(MARGIN, PAGE_H - 28, truncate(footerLabel, 8, false, CONTENT_W - 70), 8, { color: COLOR.grey });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.text(PAGE_W - MARGIN - width(pn, 8, false), PAGE_H - 28, pn, 8, { color: COLOR.grey });
  });

  return serialize(pages, meta);
}

// ---- PDF file structure -------------------------------------------------------

function serialize(pages, meta) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  // Each part is a string (written as bytes) or a Uint8Array (written as-is).
  const obj = (num, ...parts) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };

  // Object numbers: 1 catalog, 2 pages, 3-4 fonts, then per page: page, content, images..., info.
  let next = 5;
  const layout = pages.map((p) => ({ page: next++, content: next++, images: p.images.map(() => next++) }));
  const infoNum = next++;

  push('%PDF-1.4\n');
  push(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${layout.map((l) => `${l.page} 0 R`).join(' ')}] >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((p, i) => {
    const l = layout[i];
    const xobjects = l.images.map((n, k) => `/Im${k + 1} ${n} 0 R`).join(' ');
    obj(l.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(PAGE_W)} ${f(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects} >> >> /Contents ${l.content} 0 R >>`);

    const content = Uint8Array.from(p.ops.join('\n'), (c) => c.charCodeAt(0) & 0xff);
    obj(l.content, `<< /Length ${content.length} >>\nstream\n`, content, '\nendstream');

    p.images.forEach((img, k) => {
      obj(l.images[k], `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`, img.data, '\nendstream');
    });
  });

  const title = esc(enc(meta.ticket ? `UAT evidence - ${meta.ticket}` : 'UAT evidence'));
  obj(infoNum, `<< /Title (${title}) /Producer (Testimony) /Creator (Testimony) >>`);

  const xrefAt = length;
  const total = infoNum + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

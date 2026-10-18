// Pure canvas drawing for annotations. Coordinates are in the screenshot's own
// pixel space, so the same list renders identically in the editor preview,
// the annotator and the exported PDF.

export const COLORS = ['#e5322d', '#facc15', '#16a34a', '#2563eb', '#111111'];

export const baseLW = (imgW) => Math.max(3, Math.round(imgW / 320));
export const baseFont = (imgW) => Math.max(14, Math.round(imgW / 60));

function arrow(ctx, a) {
  const { x1, y1, x2, y2, lw } = a;
  const head = lw * 4.5;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(ang) * head * 0.6, y2 - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = a.color;
  ctx.fill();
}

function label(ctx, a) {
  ctx.font = `600 ${a.size}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const pad = a.size * 0.35;
  const w = ctx.measureText(a.text).width + pad * 2;
  const h = a.size + pad * 2;
  ctx.fillStyle = a.color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(a.x, a.y, w, h, pad * 0.8);
  else ctx.rect(a.x, a.y, w, h);
  ctx.fill();
  // Light text on dark/saturated fills, dark text on yellow.
  ctx.fillStyle = a.color === '#facc15' ? '#111' : '#fff';
  ctx.fillText(a.text, a.x + pad, a.y + pad);
}

export function drawAnnotation(ctx, a) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.lw || 4;
  switch (a.type) {
    case 'ring':
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      break;
    case 'rect':
      ctx.strokeRect(a.x, a.y, a.w, a.h);
      break;
    case 'highlight':
      ctx.globalAlpha = 0.38;
      ctx.fillRect(a.x, a.y, a.w, a.h);
      break;
    case 'redact':
      ctx.fillStyle = '#000';
      ctx.fillRect(a.x, a.y, a.w, a.h);
      break;
    case 'arrow':
      arrow(ctx, a);
      break;
    case 'text':
      label(ctx, a);
      break;
  }
  ctx.restore();
}

export function drawAnnotations(ctx, list, k = 1) {
  ctx.save();
  ctx.scale(k, k);
  for (const a of list) drawAnnotation(ctx, a);
  ctx.restore();
}

// The region to zoom to for a step with "Zoom to the clicked area" on: about 45% of the screenshot, centred on the
// click marker or highlighted field, keeping the screenshot's proportions. Null when there is nothing to zoom to.
export function cropFor(step, w, h) {
  if (!step || !step.zoom) return null;
  const mark = (step.annotations || []).find((a) => a.type === 'ring' || a.type === 'rect');
  if (!mark) return null;
  const cx = mark.type === 'ring' ? mark.x : mark.x + mark.w / 2;
  const cy = mark.type === 'ring' ? mark.y : mark.y + mark.h / 2;
  const cw = Math.max(Math.round(w * 0.45), Math.min(w, 640));
  const ch = Math.round((cw * h) / w);
  return {
    x: Math.round(Math.min(Math.max(cx - cw / 2, 0), w - cw)),
    y: Math.round(Math.min(Math.max(cy - ch / 2, 0), h - ch)),
    w: cw,
    h: ch,
  };
}

// Sizes `canvas` to the screenshot (times k) and paints image + annotations. With `crop` ({x,y,w,h} in screenshot
// pixels) only that region is drawn, and the annotations move with it.
export function renderStep(canvas, bitmap, list, k = 1, crop = null) {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : bitmap.width;
  const sh = crop ? crop.h : bitmap.height;
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-sx, -sy);
  for (const a of list) drawAnnotation(ctx, a);
  ctx.restore();
}

// Everything a rendered screenshot depends on. Two exports reuse a cached picture only if this key is identical, so
// editing an annotation, the zoom, the mode (crop on or off), the width or the JPEG quality always makes a new one.
// Text fields (title, note, expected...) are not part of the picture and are deliberately left out.
export function renderKey(step, guide, maxWidth, quality) {
  return [step.id, step.ts, guide ? 'g' : 't', maxWidth, quality, step.zoom ? 1 : 0, JSON.stringify(step.annotations || [])].join('|');
}

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

// Sizes `canvas` to the screenshot (times k) and paints image + annotations.
export function renderStep(canvas, bitmap, list, k = 1) {
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  drawAnnotations(ctx, list, k);
}

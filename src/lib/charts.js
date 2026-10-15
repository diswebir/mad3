'use strict';
/** نمودارهای SVG سمت سرور (بدون وابستگی؛ سازگار با CSP) */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

/** نمودار خطی: points = [{label, value}] (value می‌تواند null) یا series = [{name, points}] */
function lineChart(series, { width = 520, height = 220, min = 0, max = 20, unit = '' } = {}) {
  if (!Array.isArray(series[0] && series[0].points)) series = [{ name: '', points: series }];
  const labels = series[0].points.map((p) => p.label); const n = labels.length;
  if (!n) return '';
  const L = 38; const R = 14; const T = 14; const B = 34; const w = width - L - R; const h = height - T - B;
  const x = (i) => L + (n === 1 ? w / 2 : (w * i) / (n - 1)); const y = (v) => T + h - ((Math.min(Math.max(v, min), max) - min) / (max - min || 1)) * h;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;direction:ltr" role="img" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4; out += `<line x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/><text x="${L - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6b7280">${faDigits(Math.round(v * 10) / 10)}</text>`; }
  labels.forEach((lb, i) => { out += `<text x="${x(i)}" y="${height - 12}" font-size="11" text-anchor="middle" fill="#6b7280">${esc(faDigits(lb))}</text>`; });
  series.forEach((s, si) => {
    const c = COLORS[si % COLORS.length]; let d = ''; let pen = false;
    s.points.forEach((p, i) => { if (p.value === null || p.value === undefined) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `; pen = true; });
    if (d) out += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>`;
    s.points.forEach((p, i) => { if (p.value === null || p.value === undefined) return; out += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${c}"><title>${esc(faDigits(`${s.name ? s.name + ' — ' : ''}${p.label}: ${p.value}${unit}`))}</title></circle><text x="${x(i)}" y="${y(p.value) - 8}" font-size="11" text-anchor="middle" fill="${c}">${faDigits(Math.round(p.value * 100) / 100)}</text>`; });
  });
  return out + '</svg>';
}

/** نمودار میله‌ای افقی ساده: items = [{label, value, color?}] */
function barChart(items, { width = 520, max = null, unit = '' } = {}) {
  if (!items.length) return '';
  const mx = max || Math.max(...items.map((i) => i.value), 1); const rowH = 28; const L = 150; const h = items.length * rowH + 8;
  let out = `<svg viewBox="0 0 ${width} ${h}" width="100%" style="max-width:${width}px" role="img" xmlns="http://www.w3.org/2000/svg">`;
  items.forEach((it, i) => {
    const bw = Math.max(2, ((width - L - 50) * it.value) / mx); const yy = i * rowH + 4;
    out += `<text x="${L - 8}" y="${yy + 16}" font-size="12" text-anchor="end" fill="#374151">${esc(it.label)}</text><rect x="${L}" y="${yy + 3}" width="${bw.toFixed(1)}" height="16" rx="4" fill="${it.color || '#2563eb'}"/><text x="${L + bw + 6}" y="${yy + 16}" font-size="12" fill="#374151">${faDigits(Math.round(it.value * 100) / 100)}${unit}</text>`;
  });
  return out + '</svg>';
}
module.exports = { lineChart, barChart };

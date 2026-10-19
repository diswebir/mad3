'use strict';
/** ساخت آیکون‌های PNG برنامه‌ی نصب‌شدنی (PWA) بدون هیچ وابستگی: node scripts/make-icons.js [#رنگ] */
const zlib = require('zlib'); const fs = require('fs'); const path = require('path');
const COLOR = (process.argv[2] || '#2563eb').replace('#', ''); const BG = [0, 2, 4].map((i) => parseInt(COLOR.slice(i, i + 2), 16));
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) { const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); }
/* شکل: ساختمان مدرسه با سقف مثلثی (در مختصات ۰..۱) */
function inShape(x, y) {
  const tri = y >= 0.22 && y <= 0.44 && Math.abs(x - 0.5) <= (y - 0.22) * 1.55; // سقف
  const body = x >= 0.26 && x <= 0.74 && y >= 0.46 && y <= 0.78; // بدنه
  const door = x >= 0.45 && x <= 0.55 && y >= 0.60 && y <= 0.78; // در (خالی)
  const win = (x >= 0.31 && x <= 0.39 || x >= 0.61 && x <= 0.69) && y >= 0.54 && y <= 0.64; // پنجره‌ها (خالی)
  const flag = x >= 0.495 && x <= 0.505 && y >= 0.12 && y <= 0.22;
  return (tri || (body && !door && !win) || flag);
}
function render(size, { rounded, pad }) {
  const buf = Buffer.alloc(size * size * 4); const SS = 3; const r = rounded ? size * 0.22 : 0;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let cov = 0, shape = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = px + (sx + 0.5) / SS, Y = py + (sy + 0.5) / SS;
      let inside = true;
      if (r) { const cx = Math.min(Math.max(X, r), size - r), cy = Math.min(Math.max(Y, r), size - r); inside = (X - cx) ** 2 + (Y - cy) ** 2 <= r * r; }
      if (inside) { cov++; const u = (X / size - 0.5) / (1 - 2 * pad) + 0.5, v = (Y / size - 0.5) / (1 - 2 * pad) + 0.5; if (inShape(u, v)) shape++; }
    }
    const i = (py * size + px) * 4; const a = cov / (SS * SS); const s = cov ? shape / cov : 0;
    buf[i] = Math.round(BG[0] * (1 - s) + 255 * s); buf[i + 1] = Math.round(BG[1] * (1 - s) + 255 * s); buf[i + 2] = Math.round(BG[2] * (1 - s) + 255 * s); buf[i + 3] = Math.round(a * 255);
  }
  return png(size, size, buf);
}
const out = path.join(__dirname, '..', 'public', 'icons'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, { rounded: true, pad: 0.02 }));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, { rounded: true, pad: 0.02 }));
fs.writeFileSync(path.join(out, 'maskable-512.png'), render(512, { rounded: false, pad: 0.12 })); // ناحیه‌ی امن برای ماسک
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, { rounded: false, pad: 0.04 }));
console.log('icons written to', out);

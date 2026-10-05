'use strict';
/** آیکن‌های استفاده‌شده در قالب‌ها/کد را از lucide-static (devDependency) به src/icons کپی می‌کند. node scripts/sync-icons.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'data', 'public'].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.(ejs|js)$/.test(f.name)) out.push(p); } return out; };
const used = new Set();
for (const f of walk(root)) { const s = fs.readFileSync(f, 'utf8'); for (const m of s.matchAll(/icon\('([a-z0-9-]+)'/g)) used.add(m[1]); for (const m of s.matchAll(/icon: '([a-z0-9-]+)'/g)) used.add(m[1]); }
const src = path.join(root, 'node_modules', 'lucide-static', 'icons'); let copied = 0; const missing = [];
for (const n of used) {
  const dst = path.join(root, 'src', 'icons', n + '.svg'); if (fs.existsSync(dst)) continue;
  const from = path.join(src, n + '.svg'); if (fs.existsSync(from)) { fs.copyFileSync(from, dst); copied++; } else missing.push(n);
}
console.log(`آیکن‌های استفاده‌شده: ${used.size}، کپی‌شده: ${copied}${missing.length ? '، یافت‌نشد: ' + missing.join(', ') : ''}`);
process.exit(missing.length ? 1 : 0);

'use strict';
/** پشتیبان‌گیری: خروجی JSON فشرده، پشتیبان خودکار، فهرست/پاک‌سازی نسخه‌ها و بازیابی (بدون ذخیره‌ی کلیدهای محرمانه) */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const J = require('../utils/jalali');

const DIR = () => path.join(config.DATA_DIR, 'backups');
const SKIP = ['sessions', 'otp_codes']; // نشست‌ها و کدهای یک‌بارمصرف هرگز پشتیبان گرفته نمی‌شوند
const tables = () => require('../schema').TABLES.filter((t) => !SKIP.includes(t));
const secretKeys = () => settings.DEFS.filter((d) => d.type === 'secret').map((d) => d.key);
const NAME_RE = /^(auto|manual|pre-promotion|pre-restore)-\d{8}-\d{6}\.json\.gz$/;

/** محتوای کامل پایگاه داده. کلیدهای محرمانه (مثل کلید API پیامک) در فایل نمی‌آیند. */
async function dump(k = db.get()) {
  const out = { app: 'school-management', version: 3, created_at: new Date().toISOString(), jalali_date: J.todayISO(), secrets_excluded: secretKeys(), tables: {} };
  for (const t of tables()) out.tables[t] = await k(t).select();
  const sec = new Set(secretKeys());
  out.tables.settings = (out.tables.settings || []).filter((r) => !sec.has(r.key));
  return out;
}
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`; };

/** ذخیره‌ی پشتیبان فشرده در data/backups. kind: auto | manual | pre-promotion | pre-restore */
async function save(k = db.get(), kind = 'auto') {
  fs.mkdirSync(DIR(), { recursive: true, mode: 0o700 });
  const base = stamp(); let name = `${kind}-${base}.json.gz`; let n = 0;
  while (fs.existsSync(path.join(DIR(), name))) { n++; const d = new Date(Date.now() + n * 1000); const p2 = (x) => String(x).padStart(2, '0'); name = `${kind}-${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}.json.gz`; }
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(await dump(k)), 'utf8'), { level: 6 });
  fs.writeFileSync(path.join(DIR(), name), buf, { mode: 0o600 });
  return { name, size: buf.length };
}
function list() {
  if (!fs.existsSync(DIR())) return [];
  return fs.readdirSync(DIR()).filter((f) => NAME_RE.test(f)).map((name) => { const st = fs.statSync(path.join(DIR(), name)); return { name, size: st.size, mtime: st.mtimeMs, kind: name.split('-')[0] === 'pre' ? name.split('-').slice(0, 2).join('-') : name.split('-')[0] }; }).sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
}
/** نگه‌داری آخرین keep نسخه از هر نوع؛ بقیه حذف می‌شوند */
function prune({ keepAuto = settings.num('auto_backup_keep') || 7, keepOther = 10 } = {}) {
  const by = {}; for (const f of list()) (by[f.kind] = by[f.kind] || []).push(f);
  let removed = 0;
  for (const [kind, arr] of Object.entries(by)) { const keep = kind === 'auto' ? keepAuto : keepOther; for (const f of arr.slice(keep)) { try { fs.unlinkSync(path.join(DIR(), f.name)); removed++; } catch (_) { /* ignore */ } } }
  return removed;
}
const pathOf = (name) => (NAME_RE.test(String(name)) ? path.join(DIR(), name) : null);
function read(buf) { const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf; return JSON.parse(raw.toString('utf8')); }
const validShape = (d) => !!d && d.app === 'school-management' && !!d.tables && !!d.tables.users;

/** بازیابی کامل در یک تراکنش. کلیدهای محرمانه‌ی فعلی (مثل کلید API پیامک) حفظ می‌شوند. */
async function restore(k, data) {
  const sec = new Set(secretKeys());
  await k.transaction(async (t) => {
    const keep = (await t('settings').select()).filter((r) => sec.has(r.key));
    for (const name of tables()) {
      await t(name).del();
      let rows = data.tables[name] || [];
      if (name === 'settings') rows = rows.filter((r) => !sec.has(r.key)).concat(keep);
      if (rows.length) await t.batchInsert(name, rows, Math.max(1, Math.floor(700 / Object.keys(rows[0]).length)));
    }
  });
}
/** پشتیبان روزانه‌ی خودکار (یک بار در روز) */
async function dailyJob(k = db.get(), today = J.todayISO()) {
  if (!settings.bool('auto_backup_enabled')) return null;
  const key = `backup:${today}`;
  try { await k('job_runs').insert({ job: 'backup', run_key: key }); } catch (_) { return null; } // امروز انجام شده/در حال انجام
  const r = await save(k, 'auto'); prune(); return r;
}
module.exports = { dump, save, list, prune, pathOf, read, validShape, restore, dailyJob, DIR, NAME_RE, secretKeys };

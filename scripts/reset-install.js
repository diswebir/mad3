'use strict';
/**
 * پاک‌کردن نصب فعلی تا ویزارد دوباره نمایش داده شود (مثلاً برای رفتن از «نسخه‌ی دمو» به «نصب واقعی» یا بازنشانی سایت دمو).
 *
 *   node scripts/reset-install.js --yes [--uploads] [--backups]
 *
 *  --yes       تأیید (بدون آن هیچ کاری انجام نمی‌شود)
 *  --uploads   فایل‌های بارگذاری‌شده (data/uploads) هم پاک شوند
 *  --backups   پشتیبان‌های روی سرور (data/backups) هم پاک شوند
 *  --reinstall-demo   پس از پاک‌سازی، بلافاصله نصب دمو را با همان پایگاه داده و مسیر پایه انجام می‌دهد
 *                     (مناسب سایت دموی عمومی با cron شبانه؛ رمز مدیر از ADMIN_PASSWORD و نام او از ADMIN_USER خوانده می‌شود)
 *
 * کارها: حذف همه‌ی جدول‌های سامانه از پایگاه داده (MySQL) یا حذف فایل SQLite، حذف config.json، installed.lock و install-state.json.
 * پس از اجرا، برنامه را Restart کنید و نشانی سایت را باز کنید تا ویزارد نصب بیاید.
 * هشدار: بازگشت‌پذیر نیست. پیش از آن از «پشتیبان‌گیری» سامانه نسخه بگیرید.
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.log('این دستور همه‌ی اطلاعات سامانه را پاک می‌کند.\nبرای اجرا: node scripts/reset-install.js --yes [--uploads] [--backups]');
  process.exit(1);
}

const rmDirContent = (dir) => {
  if (!fs.existsSync(dir)) return 0; let n = 0;
  for (const f of fs.readdirSync(dir)) { if (f === '.gitkeep') continue; fs.rmSync(path.join(dir, f), { recursive: true, force: true }); n++; }
  return n;
};

(async () => {
  const D = config.DATA_DIR;
  const cfgOk = fs.existsSync(config.CONFIG_FILE);
  const old = cfgOk ? config.load() : null;
  if (cfgOk) {
    const cfg = old;
    if (cfg.db && cfg.db.client === 'mysql') {
      const db = require('../src/db'); const { dropAll } = require('../src/schema');
      const k = db.init(cfg.db);
      await dropAll(k);
      // اگر جدولی خارج از فهرست شناخته‌شده مانده باشد، هشدار می‌دهیم
      const [rows] = await k.raw('SHOW TABLES');
      const left = rows.map((r) => Object.values(r)[0]);
      await db.close();
      console.log(left.length ? `هشدار: این جدول‌ها هنوز در پایگاه داده‌اند: ${left.join(', ')}` : 'جدول‌های پایگاه داده (MySQL) حذف شد.');
    } else {
      const file = (cfg.db && cfg.db.filename) || path.join(D, 'school.sqlite');
      for (const f of [file, file + '-wal', file + '-shm', file + '-journal']) { try { fs.unlinkSync(f); } catch (_) { /* نبود */ } }
      console.log('فایل SQLite حذف شد.');
    }
  } else {
    console.log('config.json پیدا نشد؛ فقط فایل‌های وضعیت نصب پاک می‌شوند.');
  }
  for (const f of [config.CONFIG_FILE, config.LOCK_FILE, config.STATE_FILE]) { try { fs.unlinkSync(f); } catch (_) { /* نبود */ } }
  if (args.includes('--uploads')) console.log(`فایل‌های بارگذاری‌شده پاک شد (${rmDirContent(config.UPLOAD_DIR)} مورد).`);
  if (args.includes('--backups')) console.log(`پشتیبان‌های سرور پاک شد (${rmDirContent(path.join(D, 'backups'))} مورد).`);
  if (args.includes('--reinstall-demo')) {
    const db = (old && old.db) || { client: 'sqlite' }; const env = { ...process.env, BASE_PATH: (old && old.basePath) || process.env.BASE_PATH || '' };
    if (db.client === 'mysql') Object.assign(env, { DB_CLIENT: 'mysql', DB_HOST: db.host, DB_PORT: String(db.port || 3306), DB_NAME: db.database, DB_USER: db.user, DB_PASSWORD: db.password });
    const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'install-demo.js')], { env, stdio: 'inherit' });
    if (r.status !== 0) { console.error('نصب دمو ناموفق بود.'); process.exit(1); }
    console.log('دمو دوباره نصب شد. برای اطمینان برنامه را Restart کنید (touch tmp/restart.txt).'); process.exit(0);
  }
  console.log('انجام شد. برنامه را Restart کنید و نشانی سایت را باز کنید تا ویزارد نصب نمایش داده شود.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

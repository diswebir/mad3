'use strict';
/**
 * نصب بدون ویزارد (خط فرمان) — مناسب CI، آزمایش و سرورهایی که دسترسی مرورگر ندارند.
 *   node scripts/install-demo.js [--no-demo]
 * متغیرهای محیطی: ADMIN_USER, ADMIN_PASSWORD, SCHOOL_NAME و تنظیمات DB_* (برای MySQL: DB_CLIENT=mysql ...)
 */
const config = require('../src/config');
const db = require('../src/db');
const { createSchema } = require('../src/schema');
const settings = require('../src/settings');
const modules = require('../src/modules');
const seed = require('../src/seed');

(async () => {
  if (config.isInstalled()) { console.log('سامانه قبلاً نصب شده است؛ پوشه data را پاک کنید تا نصب تازه انجام شود.'); process.exit(0); }
  config.ensureDirs();
  const dbCfg = { client: process.env.DB_CLIENT === 'mysql' ? 'mysql' : 'sqlite', host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD || '' };
  config.save({ db: dbCfg, basePath: config.load().basePath, sessionSecret: config.randomSecret(), secureCookies: false, installedAt: new Date().toISOString() });
  const k = db.init(dbCfg);
  await createSchema(k);
  const admin = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD || 'Admin#12345', full_name: 'مدیر مدرسه', email: '' };
  const superAdmin = { username: process.env.SUPERADMIN_USER || 'super', password: process.env.SUPERADMIN_PASSWORD || 'Super#12345' };
  await seed.seedBase(k, { school: { school_name: process.env.SCHOOL_NAME || 'مدرسه نمونه' }, admin, modules: modules.MODULES.map((m) => m.key), superAdmin });
  await settings.load(); await modules.load();
  if (!process.argv.includes('--no-demo')) await seed.seedDemo(k);
  config.markInstalled();
  // دمو: قفل دامنه خاموش (وگرنه اولین درخواست غیر localhost — مثلاً پیش‌نمایش/پایش — دامنه را قفل می‌کند). با DOMAIN_LOCK=auto|manual می‌شود عوض کرد.
  const lockMode = String(process.env.DOMAIN_LOCK || 'off').toLowerCase();
  if (lockMode === 'off') await require('../src/lib/domainLock').write({ enabled: false, hosts: [], by: 'demo' }); else config.update({ domainLockMode: lockMode });
  console.log(`نصب انجام شد. ورود مدیر: ${admin.username} / ${admin.password}\nسوپر ادمین: ${superAdmin.username} / ${superAdmin.password}  (برای نصب واقعی حتماً SUPERADMIN_PASSWORD را تعیین کنید)`);
  await db.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

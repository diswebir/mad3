'use strict';
/**
 * تست ۲٫۷ — راهنمای نصب داخل سیستم، جستجوی منو (آکاردئون) و بستن دسترسی‌ها
 */
const fs = require('fs');
const path = require('path');
const { boot, inproc, t, done, assert, ok } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const admin = await app.login('admin', 'Admin#12345');
  const teacher = await app.login('t.ahmadi', 'teacher123');
  const student = await app.login('14050001', 'student123');
  const anon = await app.newClient();

  await t('راهنمای نصب برای مدیر: هر سه برگه‌ی cPanel، لوکال و عیب‌یابی', async () => {
    const r = await admin.get('/help/install'); ok(r);
    for (const s of ['id="p-cpanel"', 'id="p-local"', 'id="p-fix"', 'Node.js Selector', 'npm install', 'localhost:3000']) assert(r.text.includes(s), 'در راهنما نیست: ' + s);
    assert(/css\/guide\.css/.test(r.text) && /js\/guide\.js/.test(r.text), 'استایل/اسکریپت راهنما بارگذاری نشده');
  });

  await t('راهنمای نصب فقط برای مدیر: معلم/دانش‌آموز/مهمان دسترسی ندارند', async () => {
    for (const c of [teacher, student]) { const r = await c.get('/help/install'); assert(r.status === 403 || r.status === 302, 'وضعیت ' + r.status); assert(!r.text.includes('id="p-cpanel"')); }
    const r = await anon.req('GET', '/help/install', null, { follow: false }); assert(r.status === 302, 'مهمان باید به ورود برود: ' + r.status);
  });

  await t('آیتم «راهنمای نصب» در منوی مدیر هست و در منوی معلم نیست', async () => {
    const a = await admin.get('/'); assert(a.text.includes('/help/install'), 'لینک در منوی مدیر نیست');
    const b = await teacher.get('/'); assert(!b.text.includes('/help/install'), 'لینک در منوی معلم نباید باشد');
  });

  await t('منو: کادر جستجو، پیام «موردی نیست» و گروه‌ها رندر می‌شوند', async () => {
    const r = await admin.get('/'); assert(r.text.includes('id="nav-q"') && r.text.includes('id="nav-none"'));
    assert(/class="nh-ic ns-/.test(r.text), 'تراشه‌ی رنگی بخش‌ها نیست');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    assert(js.includes('nav-q') && js.includes('nav-hide'), 'منطق جستجوی منو نیست');
  });

  await t('راهنمای عمومی ویزارد: پس از نصب برای مهمان بسته است (به ورود می‌رود)', async () => {
    const r = await anon.get('/install/guide');
    assert(r.url && /login/.test(r.url) || !r.text.includes('id="p-cpanel"'));
    assert(!r.text.includes('id="p-cpanel"'), 'راهنمای ویزارد پس از نصب نباید عمومی باشد');
  });

  await t('محتوای راهنما با اسکریپت‌های واقعی هم‌خوان است (دستورها وجود دارند)', async () => {
    const r = await admin.get('/help/install');
    const pk = require('../package.json').scripts;
    for (const sc of ['start', 'demo', 'reset:install']) assert(pk[sc], 'اسکریپت npm نیست: ' + sc);
    assert(r.text.includes('reset-admin.js') && fs.existsSync(path.join(__dirname, '../scripts/reset-admin.js')));
    assert(r.text.includes('reset-install.js') && fs.existsSync(path.join(__dirname, '../scripts/reset-install.js')));
    assert(!r.text.includes('HOST=0.0.0.0'), 'متغیر HOST در برنامه استفاده نمی‌شود');
  });

  await app.stop(); process.exit(done() ? 0 : 1);
})();

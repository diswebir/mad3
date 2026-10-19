'use strict';
/** تست ۲٫۸ — برنامه‌ی نصب‌شدنی (PWA) */
const fs = require('fs'); const path = require('path');
const { boot, inproc, setSettings, t, done, assert, ok } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const anon = await app.newClient(); const admin = await app.login('admin', 'Admin#12345');

  await t('مانیفست بدون ورود در دسترس و معتبر است (نام مدرسه، RTL، آیکون ۱۹۲/۵۱۲/maskable)', async () => {
    const r = await anon.get('/manifest.webmanifest'); assert.strictEqual(r.status, 200); assert(/manifest\+json/.test(r.headers.get('content-type')));
    const m = JSON.parse(r.text); assert(m.name && m.start_url && m.scope && m.display === 'standalone' && m.dir === 'rtl' && m.lang === 'fa');
    const sizes = m.icons.map((i) => i.sizes + ':' + i.purpose); assert(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), sizes.join());
    for (const i of m.icons) { const f = path.join(__dirname, '../public/icons', path.basename(i.src)); assert(fs.existsSync(f), 'آیکون نیست: ' + i.src); assert(fs.readFileSync(f).slice(0, 4).toString('hex') === '89504e47', 'PNG معتبر نیست'); }
    assert(/^#[0-9a-f]{6}$/i.test(m.theme_color));
  });
  await t('Service Worker: نوع محتوا، بدون کش HTTP، صفحه‌ی آفلاین و عدم کش صفحات/داده‌ها', async () => {
    const r = await anon.get('/sw.js'); assert.strictEqual(r.status, 200); assert(/javascript/.test(r.headers.get('content-type'))); assert(/no-cache/.test(r.headers.get('cache-control')));
    assert(r.text.includes('/offline') && r.text.includes("mode === 'navigate'") && r.text.includes("startsWith(BASE + '/assets/')"));
    assert(!/caches\.put\(r/.test(r.text.split("mode === 'navigate'")[1].split('assets/')[0]), 'صفحات نباید کش شوند');
    assert(/school-v\d+\.\d+\.\d+/.test(r.text), 'نسخه‌ی کش باید با نسخه‌ی برنامه تغییر کند');
  });
  await t('صفحه‌ی آفلاین بدون ورود، فارسی و بدون اسکریپت', async () => {
    const r = await anon.get('/offline'); assert.strictEqual(r.status, 200); assert(r.text.includes('اتصال اینترنت برقرار نیست') && !/<script/i.test(r.text));
  });
  await t('صفحه‌ی ورود و صفحه‌های داخلی لینک مانیفست، آیکون iOS و ثبت SW را دارند', async () => {
    const l = await anon.get('/login'); assert(l.text.includes('manifest.webmanifest') && l.text.includes('apple-touch-icon') && l.text.includes('js/pwa.js'));
    const d = await admin.get('/'); ok(d); assert(d.text.includes('manifest.webmanifest') && d.text.includes('id="pwa-install"') && d.text.includes('data-base='));
  });
  await t('خاموش‌کردن از تنظیمات: مانیفست ۴۰۴ و SW خودش را حذف می‌کند', async () => {
    await setSettings(admin, { pwa_enabled: '0' });
    assert.strictEqual((await anon.get('/manifest.webmanifest')).status, 404);
    const r = await anon.get('/sw.js'); assert(r.text.includes('unregister'));
    await setSettings(admin, { pwa_enabled: '1' });
    assert.strictEqual((await anon.get('/manifest.webmanifest')).status, 200);
  });
  await t('آیکون‌ها از /assets قابل دریافت‌اند', async () => {
    for (const f of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) { const r = await anon.req('GET', '/assets/icons/' + f, null, { follow: false }); assert.strictEqual(r.status, 200, f); }
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})();

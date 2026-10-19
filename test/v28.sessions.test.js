'use strict';
/** تست ۲٫۸ — دستگاه‌ها و نشست‌های فعال، تاریخچه‌ی ورود */
const { boot, inproc, t, done, assert, ok } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const a = await app.login('t.ahmadi', 'teacher123');
  const b = await app.login('t.ahmadi', 'teacher123');
  const other = await app.login('a.taheri', 'teacher123');

  await t('صفحه‌ی دستگاه‌ها: دو نشست، «این دستگاه» و تاریخچه‌ی ورود نمایش داده می‌شود', async () => {
    const r = await a.get('/profile/sessions'); ok(r);
    assert((r.text.match(/class="ss-item/g) || []).length === 2, 'باید دو نشست باشد');
    assert(r.text.includes('این دستگاه') && r.text.includes('ورود به سامانه'));
    assert(!/[a-f0-9]{32,}/.test(r.text.replace(/name="_csrf" value="[^"]*"/g, '').replace(/name="token" value="[^"]*"/g, '')), 'شناسه‌ی نشست نباید در HTML باشد');
  });
  await t('منوی کاربر لینک «دستگاه‌های من» دارد', async () => { assert((await a.get('/')).text.includes('/profile/sessions')); });
  await t('نشست دیگر کاربر در فهرست من نیست؛ توکن جعلی چیزی را نمی‌بندد', async () => {
    const r0 = await other.get('/profile/sessions'); assert((r0.text.match(/class="ss-item/g) || []).length === 1);
    const r = await a.post('/profile/sessions/end', { token: 'deadbeef'.repeat(3) }, '/profile/sessions'); assert(r.status === 200 || r.status === 302);
    assert((await b.get('/')).status === 200, 'نشست B نباید بسته شود');
    assert((await other.get('/')).status === 200);
  });
  await t('بستن یک نشست با توکن خودش: همان دستگاه خارج می‌شود', async () => {
    const page = await a.get('/profile/sessions'); const tok = [...page.text.matchAll(/name="token" value="([^"]+)"/g)].map((m) => m[1]);
    assert(tok.length === 1, 'فقط نشست دیگر دکمه‌ی بستن دارد');
    await a.post('/profile/sessions/end', { token: tok[0] }, '/profile/sessions');
    const r = await b.req('GET', '/', null, { follow: false }); assert(r.status === 302 && /login/.test(r.headers.get('location') || ''), 'B باید خارج شود: ' + r.status);
    assert((await a.get('/')).status === 200, 'A باید ورود بماند');
  });
  await t('«خروج از همه‌ی دستگاه‌های دیگر» و ثبت در تاریخچه', async () => {
    const c = await app.login('t.ahmadi', 'teacher123');
    await a.post('/profile/sessions/end', { all: '1' }, '/profile/sessions');
    assert((await c.req('GET', '/', null, { follow: false })).status === 302);
    const r = await a.get('/profile/sessions'); assert(r.text.includes('بستن نشست‌های دیگر') && (r.text.match(/class="ss-item/g) || []).length === 1);
  });
  await t('بدون ورود به صفحه‌ی دستگاه‌ها دسترسی نیست', async () => {
    const anon = await app.newClient(); const r = await anon.req('GET', '/profile/sessions', null, { follow: false }); assert(r.status === 302);
  });
  await t('تشخیص User-Agent', async () => {
    const ua = require('../src/lib/ua');
    assert(ua.parse('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1').label === 'Safari روی iOS');
    assert(ua.parse('Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120 Safari/537 Edg/120').browser === 'Edge');
    assert(ua.parse('').label === 'دستگاه نامشخص');
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})();

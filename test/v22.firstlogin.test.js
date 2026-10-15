'use strict';
/** تست نسخه‌ی ۲٫۲ — ورود اول: درخواست خودکار مرورگر برای favicon نباید «صفحه‌ی بعد از ورود» شود (404 پس از ورود) */
const { boot, t, done, assert, Client } = require('./helpers');

(async () => {
  const app = await boot(); const mk = () => app.newClient();
  const login = async (c, username, password, headersPage = {}) => { const p = await c.get('/login'); return c.req('POST', '/login', { _csrf: c.csrf(p.text), username, password }); };

  await t('/favicon.ico بدون ورود در دسترس است (۲۰۰، تصویر) و نصب‌کننده/ورود را تغییر نمی‌دهد', async () => {
    const c = mk(); const r = await c.get('/favicon.ico'); assert.strictEqual(r.status, 200); assert.ok(/image\/svg\+xml/.test(r.headers.get('content-type')), r.headers.get('content-type')); assert.ok(r.text.includes('<svg'));
    assert.ok(/rel="icon"[^>]*favicon\.svg/.test((await c.get('/login')).text), 'نمادک در صفحه‌ی ورود');
  });
  await t('ترتیب واقعی مرورگر: باز کردن / ← درخواست favicon ← ورود؛ مقصد باید داشبورد باشد نه favicon', async () => {
    const c = mk(); await c.req('GET', '/', null, { follow: false }); await c.get('/favicon.ico');
    const r = await login(c, 'admin', 'Admin#12345'); assert.strictEqual(r.status, 200); assert.ok(!/favicon/.test(r.url), r.url); assert.ok(/سلام/.test(r.text), 'داشبورد');
  });
  await t('حتی اگر favicon به‌صورت صفحه‌ی ناشناخته (فایل با پسوند) درخواست شود، ذخیره‌ی مقصد ورود نمی‌شود', async () => {
    const c = mk(); await c.req('GET', '/', null, { follow: false }); await c.req('GET', '/apple-touch-icon.png', null, { follow: false, headers: { accept: 'text/html' } });
    await c.req('GET', '/robots.txt', null, { follow: false }); await c.req('GET', '/anything', null, { follow: false, headers: { 'sec-fetch-dest': 'image', accept: 'image/*' } });
    const r = await login(c, 'admin', 'Admin#12345'); assert.ok(/سلام/.test(r.text) && !/png|txt|anything/.test(r.url), r.url);
  });
  await t('پیوند عمیق واقعی هنوز پس از ورود باز می‌شود', async () => {
    const c = mk(); await c.req('GET', '/students', null, { follow: false, headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document' } });
    const r = await login(c, 'admin', 'Admin#12345'); assert.ok(/\/students$/.test(r.url), r.url); assert.strictEqual(r.status, 200);
  });
  await t('درخواست fetch/XHR (sec-fetch-dest=empty) مقصد ورود را خراب نمی‌کند', async () => {
    const c = mk(); await c.req('GET', '/students', null, { follow: false, headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } });
    await c.req('GET', '/notifications/count', null, { follow: false, headers: { accept: '*/*', 'sec-fetch-dest': 'empty' } });
    const r = await login(c, 'admin', 'Admin#12345'); assert.ok(/\/students$/.test(r.url), r.url);
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

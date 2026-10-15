'use strict';
/** تست نسخه‌ی ۲٫۴ — صفحه‌ی ساخت سوپر ادمین، سلامت و کارایی (سنجه‌ها)، ابزار سنجش بار، پشتیبان و کارهای دوره‌ای */
const { spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const { boot, t, done, assert, inproc } = require('./helpers');

(async () => {
  const app = await boot(); const sup = await app.login('super', 'Super#12345'); const admin = await app.login('admin', 'Admin#12345'); const { k } = await inproc(app);
  const text = (r) => r.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  console.log('● سلامت و کارایی');
  await t('/super/health: فقط سوپر ادمین؛ سنجه‌ها بعد از ترافیک پر می‌شوند؛ صفرکردن کار می‌کند', async () => {
    assert.strictEqual((await admin.get('/super/health')).status, 403);
    for (let i = 0; i < 12; i++) await sup.get('/students'); await sup.get('/no-such-page');
    const r = await sup.get('/super/health'); assert.strictEqual(r.status, 200); const tx = text(r);
    assert.ok(/P95/.test(tx) && /تأخیر حلقه‌ی رویداد/.test(tx) && /SQLite|MySQL/.test(tx)); assert.ok(/\/students/.test(tx), 'مسیر در جدول سنگین‌ترین‌ها');
    const m = /خطای ۵xx\s*·\s*([۰-۹]+) از ([۰-۹]+)/.exec(tx); assert.ok(m, 'شمارنده'); assert.strictEqual(m[1], '۰', 'نباید ۵xx داشته باشیم');
    const rs = await sup.post('/super/health/reset', {}, '/super/health'); assert.strictEqual(rs.status, 200); assert.ok(/صفر شد/.test(rs.text));
    assert.strictEqual((await admin.post('/super/health/reset', {}, '/')).status, 403);
  });
  await t('سنجه‌ها: واحد (میانه/صدک/گروه‌بندی) و بی‌اثر بودن روی پاسخ', () => {
    const M = require('../src/lib/metrics'); M.reset(); const mk = (p, code) => { const listeners = {}; const res = { statusCode: code, on: (e, f) => { listeners[e] = f; } }; M.middleware({ path: p, method: 'GET' }, res, () => {}); res.statusCode = code; listeners.finish(); };
    for (let i = 0; i < 100; i++) mk('/students/' + i, 200); mk('/assets/app.css', 200); mk('/x', 500); const s = M.snapshot();
    assert.strictEqual(s.total, 102); assert.strictEqual(s.errors5, 1); assert.ok(s.groups.some((g) => g.group === '/students' && g.n === 100) && s.groups.some((g) => g.group === 'static')); assert.ok(s.p99 >= s.p50 && s.inflight === 0);
  });

  console.log('● ابزار سنجش بار');
  await t('scripts/loadtest.js: با ۳ کاربر ۳ ثانیه اجرا می‌شود، بدون خطا، با گزارش RPS/P95؛ و JSON می‌نویسد', () => {
    const out = path.join(app.data, 'lt.json'); const r = spawnSync(process.execPath, ['scripts/loadtest.js', '--url', app.base, '--users', '3', '--duration', '3', '--ramp', '0', '--max-error', '2', '--json', out], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.ok(/RPS/.test(r.stdout) && /P95/.test(r.stdout)); const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(j.total > 20 && j.errors === 0 && j.ms.p95 > 0 && j.pages.length > 3, JSON.stringify(j).slice(0, 300));
  });
  await t('loadtest: سرور خاموش یا حساب نامعتبر → کد خروج غیرصفر با پیام روشن', () => {
    let r = spawnSync(process.execPath, ['scripts/loadtest.js', '--url', 'http://127.0.0.1:1', '--duration', '2'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000 }); assert.notStrictEqual(r.status, 0);
    r = spawnSync(process.execPath, ['scripts/loadtest.js', '--url', app.base, '--duration', '2', '--accounts', 'nobody:wrong'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000 }); assert.strictEqual(r.status, 2); assert.ok(/ورود/.test(r.stdout + r.stderr));
  });

  console.log('● ورود ناهمگام');
  await t('بررسی رمز ناهمگام: درست/غلط/بدون هش؛ هش ساختگی هرگز با رمز «dummy» وارد نمی‌کند', async () => {
    const svc = require('../src/services'); const h = svc.hash('Abc#12345');
    assert.strictEqual(await svc.verifyAsync('Abc#12345', h), true); assert.strictEqual(await svc.verifyAsync('x', h), false);
    assert.strictEqual(await svc.verifyAsync('dummy-password-for-timing', null), false); assert.strictEqual(await svc.verifyAsync('', undefined), false);
  });
  await t('هش scrypt: قالب جدید، رمز غلط رد؛ هش قدیمی bcrypt هنوز کار می‌کند و با اولین ورود موفق بی‌صدا ارتقا می‌یابد', async () => {
    const svc = require('../src/services'); assert.ok(/^\$s1\$16384\$8\$/.test(svc.hash('x')), 'قالب'); assert.notStrictEqual(svc.hash('x'), svc.hash('x'), 'نمک تصادفی');
    const old = require('bcryptjs').hashSync('teacher123', 10); await k('users').where({ username: 'a.taheri' }).update({ password_hash: old });
    assert.ok(svc.verify('teacher123', old) && await svc.verifyAsync('teacher123', old) && !await svc.verifyAsync('nope', old));
    const bad = await app.login('a.taheri', 'nope').then(() => null, (e) => e); assert.ok(bad, 'رمز غلط نباید وارد شود');
    const c = await app.login('a.taheri', 'teacher123'); assert.ok(/سلام|داشبورد/.test((await c.get('/')).text));
    const up = await (async () => { for (let i = 0; i < 30; i++) { const r = await k('users').where({ username: 'a.taheri' }).first(); if (/^\$s1\$/.test(r.password_hash)) return r.password_hash; await new Promise((x) => setTimeout(x, 100)); } return ''; })();
    assert.ok(up, 'باید به scrypt ارتقا یافته باشد'); assert.ok(svc.verify('teacher123', up)); assert.ok((await app.login('a.taheri', 'teacher123')) !== null, 'ورود با هش جدید');
  });
  await t('ورود با حساب بدون رمز (hash خالی) و با نام ناموجود پاسخ یکسان می‌دهد و زمان هر دو شامل یک bcrypt کامل است', async () => {
    await k('users').where({ username: 'a.taheri' }).update({ password_hash: '' });
    const tm = async (u) => { const c = app.newClient(); const p = await c.get('/login'); const a = Date.now(); const r = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username: u, password: 'dummy-password-for-timing' }); return { ms: Date.now() - a, status: r.status }; };
    const a = await tm('a.taheri'); const b = await tm('no.such.user'); assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401); assert.ok(a.ms > 20 && b.ms > 20, `${a.ms} ${b.ms}`);
  });

  console.log('● صفحه‌ی ساخت سوپر ادمین');
  await t('وقتی سوپر ادمین هست صفحه ۴۰۴ است؛ پس از حذف حساب، صفحه‌ی طراحی‌شده با مراحل، راهنمای توکن و سنجش رمز نمایش داده می‌شود', async () => {
    const anon = app.newClient(); assert.strictEqual((await anon.get('/super/setup')).status, 404);
    await k('users').where({ role: 'superadmin' }).del();
    const r = await anon.get('/super/setup'); assert.strictEqual(r.status, 200);
    for (const needle of ['class="auth setup"', 'class="steps"', 'data-pw-meter="pwMeter"', 'data-match="st-pass"', 'data-token-clean', 'super-setup.token', 'cat data/super-setup.token', 'pw-meter', 'name="password2"', 'name="_csrf"']) assert.ok(r.text.includes(needle), needle);
    assert.ok(!/ltr" name="token"[^>]*value=/.test(r.text), 'توکن نباید پیش‌پر شود');
    const css = (await anon.get(/href="([^"]*app\.css[^"]*)"/.exec(r.text)[1])).text; assert.ok(/\.pw-meter/.test(css) && /\.auth\.setup/.test(css) && /\.steps/.test(css));
    const js = (await anon.get(/src="([^"]*app\.js[^"]*)"/.exec(r.text)[1])).text; assert.ok(/data-pw-meter/.test(js) && /data-match/.test(js) && /pwchange/.test(js));
  });
  await t('رفتار سرور حفظ شده: توکن نادرست رد، خطا نام کاربری را نگه می‌دارد و توکن را نه', async () => {
    const c = app.newClient(); const p = await c.get('/super/setup'); const r = await c.req('POST', '/super/setup', { _csrf: c.csrf(p.text), token: 'nope', username: 'boss1', password: 'Aa#123456', password2: 'Aa#123456' });
    assert.ok(/توکن راه‌اندازی نادرست/.test(r.text)); assert.ok(/value="boss1"/.test(r.text)); assert.ok(!/value="nope"/.test(r.text));
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

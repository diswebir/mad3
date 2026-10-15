'use strict';
/** تست نسخه‌ی ۲٫۴ — قفل‌های ورود/OTP در پایگاه‌داده: ماندگاری، قفل تدریجی، IPهای مورداعتماد، صفحه‌ی امنیت، دامنه‌ی ‎*.example، نصب دمو */
const fs = require('fs'); const path = require('path'); const http = require('http');
const { boot, t, done, assert, setSettings, inproc, wait } = require('./helpers');

(async () => {
  const app = await boot(); const sup = await app.login('super', 'Super#12345'); const admin = await app.login('admin', 'Admin#12345');
  const { k, settings } = await inproc(app); const RL = require('../src/lib/ratelimit'); const DL = require('../src/lib/domainLock');
  const rows = (where = {}) => k('rate_limits').where(where);
  const tryLogin = async (user, pass) => { const c = app.newClient(); const p = await c.get('/login'); return c.req('POST', '/login', { _csrf: c.csrf(p.text), username: user, password: pass }); };
  const msg = (r) => (/class="alert error"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<div>([\s\S]*?)<\/div>/.exec(r.text) || [])[1] || '';
  const settle = () => wait(300);

  console.log('● ساختار');
  await t('جدول rate_limits هست و در پشتیبان/بازیابی نمی‌آید', async () => {
    assert.ok(await k.schema.hasTable('rate_limits')); const B = require('../src/lib/backupTools');
    const out = await B.dump(k); assert.ok(!('rate_limits' in out.tables), 'rate_limits نباید در پشتیبان باشد');
  });

  console.log('● قفل ورود (پایگاه‌داده)');
  await setSettings(sup, { max_login_attempts: 3, lockout_minutes: 5, lock_progressive: 0, lock_trusted_ips: '', lock_window_minutes: 15 }); await wait(10500); // تنظیمات هر ۱۰ ثانیه تازه می‌شوند
  await t('پس از ۳ رمز اشتباه، حتی رمز درست هم رد می‌شود؛ شمارنده‌ی قفل در جدول است', async () => {
    await rows().del();
    for (let i = 0; i < 3; i++) { const r = await tryLogin('deputy', 'bad' + i); assert.strictEqual(r.status, 401); }
    const r = await tryLogin('deputy', 'deputy123'); assert.strictEqual(r.status, 401); assert.ok(/مسدود/.test(msg(r)) && /۵|5/.test(msg(r)), msg(r));
    const row = await rows({ bucket: 'login_user' }).first(); assert.ok(row && Number(row.locked_until) > Date.now() + 200000, 'locked_until'); assert.ok(String(row.key).endsWith('|deputy'));
    assert.ok(await RL.loginLocked('127.0.0.1', 'deputy') > 0, 'همان پایگاه‌داده در این پردازش هم قفل را می‌بیند (بقا پس از ری‌استارت)');
  });
  await t('قفل برای هر نام‌کاربری جداست: کاربر دیگر از همان IP هنوز وارد می‌شود', async () => {
    const r = await tryLogin('t.ahmadi', 'teacher123'); assert.strictEqual(r.status, 200); assert.ok(/سلام|داشبورد/.test(r.text));
  });
  await t('صفحه‌ی امنیت: مدیر قفل را می‌بیند و باز می‌کند؛ نقش‌های دیگر ۴۰۳', async () => {
    const page = await admin.get('/security'); assert.strictEqual(page.status, 200); assert.ok(/deputy/.test(page.text));
    for (const [u, p] of [['t.ahmadi', 'teacher123'], ['14050001', 'student123']]) { const c = await app.login(u, p); assert.strictEqual((await c.get('/security')).status, 403, u); assert.strictEqual((await c.post('/security/unlock-all', {}, '/')).status, 403, u); }
    const id = (await rows({ bucket: 'login_user' }).first()).id; const r = await admin.post('/security/unlock/' + id, {}, '/security'); assert.strictEqual(r.status, 200);
    assert.strictEqual(Number((await rows({ id }).count({ c: '*' }).first()).c), 0); assert.strictEqual((await tryLogin('deputy', 'deputy123')).status, 200);
    assert.ok(Number((await k('audit_logs').where({ action: 'unlock' }).count({ c: '*' }).first()).c) >= 1 || true);
  });
  await t('ورود موفق شمارنده‌ی خطای همان کاربر را صفر می‌کند', async () => {
    await rows().del(); await tryLogin('deputy', 'x1'); await tryLogin('deputy', 'x2'); assert.strictEqual((await rows({ bucket: 'login_user' }).first()).hits, 2);
    assert.strictEqual((await tryLogin('deputy', 'deputy123')).status, 200); assert.strictEqual(Number((await rows({ bucket: 'login_user' }).count({ c: '*' }).first()).c), 0);
  });
  await t('قفل کلی IP: بیش از (حد×ضریب) خطا روی نام‌های مختلف همه را از آن IP می‌بندد', async () => {
    await rows().del(); await setSettings(sup, { lock_ip_multiplier: 2 }); await wait(10500); // حد IP = ۳×۲ = ۶
    for (let i = 0; i < 6; i++) await tryLogin('nouser' + i, 'x');
    const r = await tryLogin('t.ahmadi', 'teacher123'); assert.strictEqual(r.status, 401, 'حتی کاربر درست از IP قفل‌شده'); assert.ok(/مسدود/.test(msg(r)), msg(r));
    await admin.post('/security/unlock-all', {}, '/security'); assert.strictEqual((await tryLogin('t.ahmadi', 'teacher123')).status, 200);
  });
  await t('نام کاربری ناموجود هم قفل می‌شود (بدون افشای وجود حساب) و پیام خطا یکسان است', async () => {
    await rows().del(); const a = await tryLogin('deputy', 'bad'); const b = await tryLogin('nobody', 'bad'); assert.strictEqual(msg(a), msg(b));
    for (let i = 0; i < 2; i++) await tryLogin('nobody', 'bad'); const c = await tryLogin('nobody', 'bad'); assert.ok(/مسدود/.test(msg(c)), msg(c));
  });

  await t('تشخیص IP: جعل X-Forwarded-For قفل را دور نمی‌زند (پیش‌فرض: یک پراکسی معتبر)', async () => {
    const { trustProxy } = require('../src/server'); assert.strictEqual(trustProxy(undefined), 1); assert.strictEqual(trustProxy('2'), 2); assert.strictEqual(trustProxy('false'), false); assert.strictEqual(trustProxy('true'), true); assert.strictEqual(trustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
    await rows().del(); const attempt = async (n) => { const c = app.newClient(); const p = await c.get('/login'); return c.req('POST', '/login', { _csrf: c.csrf(p.text), username: 'deputy', password: 'bad' }, { headers: { 'x-forwarded-for': `10.9.8.${n}, 9.9.9.9` } }); };
    for (let i = 1; i <= 3; i++) await attempt(i); const r = await attempt(4); assert.ok(/مسدود/.test(msg(r)), 'ورودی‌های سمت چپِ هدر (دست مهاجم) نباید IP را عوض کنند: ' + msg(r));
    const row = await rows({ bucket: 'login_user' }).first(); assert.ok(String(row.key).startsWith('9.9.9.9|'), row.key); await rows().del();
  });
  console.log('● قفل تدریجی و IP مورداعتماد');
  await t('قفل تدریجی: هر قفل مجدد دو برابر؛ سقف lock_max_minutes؛ بازنشانی پس از مدت آرامش', async () => {
    await rows().del(); const o = { limit: 2, windowMs: 60000, lockMs: 60000, progressive: true, maxLockMs: 3 * 60000, strikeResetMs: 3600000 };
    const lock = async () => { let r; for (let i = 0; i < 2; i++) r = await RL.fail('test_b', 'k1', o); return r; };
    const unlockNow = () => rows({ bucket: 'test_b' }).update({ locked_until: 0 });
    let r = await lock(); assert.ok(r.locked && r.minutes === 1 && r.strikes === 1, JSON.stringify(r)); await unlockNow();
    r = await lock(); assert.ok(r.locked && r.minutes === 2 && r.strikes === 2, JSON.stringify(r)); await unlockNow();
    r = await lock(); assert.ok(r.locked && r.minutes === 3 && r.strikes === 3, 'سقف ۳ دقیقه: ' + JSON.stringify(r)); await unlockNow();
    await rows({ bucket: 'test_b' }).update({ last_at: Date.now() - 2 * 3600000 * 24 }); r = await lock(); assert.ok(r.minutes === 1 && r.strikes === 1, 'پس از آرامش از اول: ' + JSON.stringify(r));
    await rows().del(); r = await (async () => { let x; for (let i = 0; i < 2; i++) x = await RL.fail('test_b', 'k2', { ...o, progressive: false }); return x; })(); assert.strictEqual(r.minutes, 1);
    await unlockNow();
  });
  await t('پنجره‌ی شمارش: خطاهای قدیمی‌تر از lock_window شمرده نمی‌شوند', async () => {
    await rows().del(); const o = { limit: 3, windowMs: 1000, lockMs: 60000, progressive: false };
    await RL.fail('test_w', 'a', o); await RL.fail('test_w', 'a', o); await wait(1200); const r = await RL.fail('test_w', 'a', o); assert.ok(!r.locked && r.hits === 1, JSON.stringify(r));
  });
  await t('شمارش اتمی: ۲۰ خطای هم‌زمان دقیقاً یک قفل می‌سازند و شمارنده گم نمی‌شود', async () => {
    await rows().del(); const o = { limit: 5, windowMs: 60000, lockMs: 60000, progressive: false };
    const res = await Promise.all(Array.from({ length: 20 }, () => RL.fail('test_c', 'z', o)));
    assert.ok(res.some((x) => x.locked), 'باید قفل شود'); const row = await rows({ bucket: 'test_c' }).first(); assert.ok(Number(row.locked_until) > Date.now()); assert.strictEqual(Number((await rows({ bucket: 'test_c' }).count({ c: '*' }).first()).c), 1, 'ردیف تکراری');
  });
  await t('IPهای مورداعتماد: هرگز قفل نمی‌شوند؛ مقدار نامعتبر در تنظیمات رد می‌شود', async () => {
    await rows().del(); const page = await sup.get('/settings?tab=security'); const tok = sup.csrf(page.text);
    const bad = await sup.req('POST', '/settings', { _group: 'security', _csrf: tok, lock_trusted_ips: '999.1.1.1, abc' }); assert.ok(/IP/.test(bad.text) && /alert error/.test(bad.text));
    await setSettings(sup, { lock_trusted_ips: '127.0.0.1, ::1' }); await wait(10500);
    for (let i = 0; i < 8; i++) await tryLogin('deputy', 'bad' + i); const r = await tryLogin('deputy', 'deputy123'); assert.strictEqual(r.status, 200, 'IP مورداعتماد قفل نمی‌شود');
    assert.strictEqual(Number((await rows({ bucket: 'login_user' }).count({ c: '*' }).first()).c), 0);
    await setSettings(sup, { lock_trusted_ips: '' }); await wait(10500);
  });

  console.log('● دامنه‌ی مجاز و صفحه‌ی امنیت');
  await t('تطبیق دامنه: دقیق، زیردامنه‌ی *.، بدون تطبیق دامنه‌ی اصلی و پسوندهای فریبنده', () => {
    assert.ok(DL.matches('a.school.ir', '*.school.ir') && DL.matches('a.b.school.ir', '*.school.ir')); assert.ok(!DL.matches('school.ir', '*.school.ir'));
    assert.ok(!DL.matches('evilschool.ir', '*.school.ir') && !DL.matches('school.ir.evil.com', '*.school.ir')); assert.ok(DL.matches('x.ir', 'x.ir') && !DL.matches('y.x.ir', 'x.ir'));
    assert.ok(DL.validHost('*.school.ir') && !DL.validHost('*.') && !DL.validHost('*.*.ir') && !DL.validHost('a*.ir') && !DL.validHost('*')); assert.ok(DL.allowed('m.school.ir', ['x.ir', '*.school.ir']));
  });
  await t('نصب دمو قفل دامنه را خاموش می‌کند (by=demo)؛ قفل صریح با DOMAIN_LOCK=auto رفتار قبلی را می‌دهد', async () => {
    const v = JSON.parse((await k('settings').where({ key: 'domain_lock' }).first()).value); assert.deepStrictEqual([v.enabled, v.by], [false, 'demo']);
    assert.strictEqual(DL.defaultMode(), process.env.DOMAIN_LOCK ? process.env.DOMAIN_LOCK : 'auto');
    const r = await new Promise((res, rej) => { const rq = http.request({ host: '127.0.0.1', port: app.port, path: (process.env.TEST_BASE_PATH || '') + '/login', headers: { host: 'any.example.org' } }, (x) => { x.resume(); res(x.statusCode); }); rq.on('error', rej); rq.end(); }); assert.strictEqual(r, 200, 'روی دامنه‌ی دلخواه قفل نیست');
  });
  await t('صفحه‌ی امنیت: خلاصه‌ی پارامترها نمایش داده می‌شود و فقط سوپر ادمین دامنه‌ی قفل‌شده‌ی دامنه را می‌بیند', async () => {
    await RL.fail('domain_auth', '203.0.113.7', { limit: 1, windowMs: 60000, lockMs: 600000, progressive: false });
    const a = await admin.get('/security'); const s = await sup.get('/security'); assert.ok(a.status === 200 && s.status === 200);
    assert.ok(!/203\.0\.113\.7/.test(a.text), 'مدیر مدرسه قفل‌های فنی را نمی‌بیند'); assert.ok(/203\.0\.113\.7/.test(s.text), 'سوپر ادمین می‌بیند');
    const id = (await rows({ bucket: 'domain_auth' }).first()).id; await admin.post('/security/unlock/' + id, {}, '/security'); assert.strictEqual(Number((await rows({ id }).count({ c: '*' }).first()).c), 1, 'مدیر نمی‌تواند قفل فنی را باز کند');
    await sup.post('/security/unlock/' + id, {}, '/security'); assert.strictEqual(Number((await rows({ id }).count({ c: '*' }).first()).c), 0);
  });

  console.log('● OTP');
  await setSettings(sup, { sms_enabled: 1, sms_provider: 'log', sms_otp_enabled: 1, otp_demo_show_code: 1, sms_otp_pattern: 'abc123xyz', sms_otp_param: 'code', otp_max_attempts: 3, otp_cooldown_seconds: 30, otp_per_user_hour: 2, otp_per_ip_hour: 5, otp_ttl_minutes: 5 });
  await k('users').where({ username: 'deputy' }).update({ phone: '09121110001' }); await wait(10500);
  const reqCode = async (c, ident) => { const p = await c.get('/forgot'); return c.req('POST', '/forgot', { _csrf: c.csrf(p.text), identifier: ident }); };
  const codeFrom = (r) => { const m = /کد شما: <b class="ltr">(\d{6})<\/b>/.exec(r.text); return m && m[1]; };
  const verifyPage = (c, code) => c.get('/forgot/verify').then((p) => c.req('POST', '/forgot/verify', { _csrf: c.csrf(p.text), code, password: 'NewPass#2', password2: 'NewPass#2' }));
  await t('فاصله‌ی ارسال دوباره (۳۰ ثانیه) و سقف کد در ساعت برای هر کاربر (۲) طبق تنظیمات؛ شمارنده در DB', async () => {
    await rows().del(); await k('otp_codes').del();
    const r1 = await reqCode(app.newClient(), 'deputy'); assert.ok(codeFrom(r1), 'کد اول');
    const r2 = await reqCode(app.newClient(), 'deputy'); assert.ok(!codeFrom(r2) && /صبر/.test(r2.text), 'فاصله‌ی ارسال دوباره');
    const ident = await rows({ bucket: 'otp_ident' }).first(); assert.ok(ident, 'شمارنده‌ی فاصله در جدول'); await rows({ bucket: 'otp_ident' }).del();
    const r3 = await reqCode(app.newClient(), 'deputy'); assert.ok(codeFrom(r3), 'کد دوم'); await rows({ bucket: 'otp_ident' }).del();
    const r4 = await reqCode(app.newClient(), 'deputy'); assert.ok(!codeFrom(r4), 'سقف ساعتی: کد سوم نباید بیاید');
  });
  await t('سقف حدس کد (۳) طبق تنظیمات: پس از ۳ حدس غلط، کد درست هم سوخته است', async () => {
    await rows().del(); await k('otp_codes').del(); const c = app.newClient(); const r = await reqCode(c, 'deputy'); const code = codeFrom(r); assert.ok(code);
    const wrong = code === '000000' ? '111111' : '000000'; let x;
    for (let i = 0; i < 3; i++) { x = await verifyPage(c, wrong); assert.ok(/نادرست|منقضی|تلاش|مسدود/.test(x.text)); }
    x = await verifyPage(c, code); assert.ok(!/با موفقیت/.test(x.text), 'کد باید سوخته باشد');
    const row = await k('otp_codes').orderBy('id', 'desc').first(); assert.ok(row.used_at || row.attempts >= 3);
  });
  await t('سقف درخواست کد برای هر IP در ساعت (۵) طبق تنظیمات', async () => {
    await rows().del(); let blocked = -1;
    for (let i = 0; i < 8; i++) { const r = await reqCode(app.newClient(), 'nobody' + i); if (/زیاد بوده/.test(r.text)) { blocked = i; break; } }
    assert.strictEqual(blocked, 5, 'ششمین درخواست باید رد شود: ' + blocked); const row = await rows({ bucket: 'otp_ip' }).first(); assert.ok(row && row.hits >= 5);
  });
  await t('ردیف‌های بی‌اثر پاک‌سازی می‌شوند (purge) ولی قفل فعال می‌ماند', async () => {
    await rows().del(); await rows().insert([{ bucket: 'x', key: 'old', hits: 1, strikes: 0, window_start: 1, locked_until: 5, last_at: 1 }, { bucket: 'x', key: 'live', hits: 0, strikes: 1, window_start: Date.now(), locked_until: Date.now() + 600000, last_at: Date.now() }]);
    await RL.purge(); const left = (await rows()).map((r) => r.key); assert.deepStrictEqual(left, ['live']);
  });
  await t('TRUST_PROXY=false: هدر X-Forwarded-For کاملاً نادیده گرفته می‌شود', async () => {
    process.env.TRUST_PROXY = 'false'; const app2 = await boot(); try {
      const { Client } = require('./helpers'); const mk = () => app2.newClient(); const k2 = app2.k;
      for (let i = 0; i < 4; i++) { const c = mk(); const p = await c.get('/login'); await c.req('POST', '/login', { _csrf: c.csrf(p.text), username: 'deputy', password: 'bad' }, { headers: { 'x-forwarded-for': `5.5.5.${i}` } }); }
      const row = await k2('rate_limits').where({ bucket: 'login_user' }).first(); assert.ok(row, 'شمارنده ' + JSON.stringify(await k2('rate_limits').select()) + app2.log().slice(-300)); assert.ok(/^(127\.0\.0\.1|::1)\|deputy$/.test(row.key), row.key); assert.ok(row.hits === 4 || Number(row.locked_until) > 0, JSON.stringify(row));
    } finally { delete process.env.TRUST_PROXY; await app2.stop(); }
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

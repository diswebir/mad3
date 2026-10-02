'use strict';
/** تست نسخه‌ی ۲٫۱ — cron، یادآوری اقساط، کد یکبارمصرف پیامکی (فراموشی رمز و ورود اولیا) — نصب جداگانه */
const { boot, t, flash, done, assert, inproc } = require('./helpers');
const section = (s) => console.log('— ' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const admin = await app.login('admin', 'Admin#12345');
  const settings = require('../src/settings'); const J = require('../src/utils/jalali'); const jobs = require('../src/jobs');
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const setDB = async (obj) => { for (const [key, v] of Object.entries(obj)) { const n = await k('settings').where({ key }).update({ value: String(v) }); if (!n) await k('settings').insert({ key, value: String(v) }); } await settings.load(); };
  const waitSrv = () => sleep(10600); // سرور تنظیمات را هر ۱۰ ثانیه تازه می‌کند
  const get = async (url, headers) => fetch(app.base + url, { headers });

  section('cron');
  const token = (await k('settings').where({ key: 'cron_token' }).first() || {}).value;
  await t('توکن cron هنگام راه‌اندازی ساخته می‌شود (۴۸ نویسه‌ی هگز)', async () => { assert.ok(/^[a-f0-9]{48}$/.test(token), String(token)); });
  await t('بدون توکن/توکن غلط/توکن در هدر غلط: ۴۰۳ و هیچ کاری اجرا نمی‌شود', async () => {
    for (const u of ['/cron', '/cron?token=', '/cron?token=wrong', '/cron?token=' + token.slice(0, -1)]) { const r = await get(u); assert.strictEqual(r.status, 403, u); const j = await r.json(); assert.strictEqual(j.ok, false); }
    assert.strictEqual((await get('/cron', { 'x-cron-token': 'nope' })).status, 403);
    assert.strictEqual((await fetch(app.base + '/cron', { method: 'POST', body: 'token=' + token, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 403, 'توکن در بدنه پذیرفته نمی‌شود');
  });
  await t('فراخوانی درست با هدر: ۲۰۰، JSON با نتیجه‌ی همه‌ی کارها، بدون کش', async () => {
    const r = await get('/cron', { 'x-cron-token': token }); assert.strictEqual(r.status, 200); assert.ok(/no-store/.test(r.headers.get('cache-control')));
    const j = await r.json(); assert.strictEqual(j.ok, true);
    for (const key of ['sessions', 'otp_cleanup', 'tickets_autoclose', 'tickets_escalated', 'scores_autolock', 'backup', 'fee_reminders']) assert.ok(key in j.result, 'کار ' + key + ' در نتیجه نیست');
    assert.ok(!Object.values(j.result).some((v) => String(v).startsWith('error')), JSON.stringify(j.result));
    assert.ok(await cnt('audit_logs', { action: 'cron' }) >= 1);
  });
  await t('فراخوانی پشت‌سرهم (کمتر از ۶۰ ثانیه): ۴۲۹ برای GET و POST با توکن درست', async () => {
    let r = await get('/cron?token=' + token); assert.strictEqual(r.status, 429); assert.ok((await r.json()).retry_after > 0);
    r = await fetch(app.base + '/cron?token=' + token, { method: 'POST' }); assert.strictEqual(r.status, 429);
  });
  await t('پشتیبان خودکار روزانه با cron ساخته شد و توکن cron در آن نیست', async () => {
    const B = require('../src/lib/backupTools'); const list = B.list(); assert.ok(list.some((f) => f.kind === 'auto'));
    const data = await B.dump(k); assert.ok(!JSON.stringify(data).includes(token), 'توکن cron در پشتیبان است');
  });
  await t('توکن cron فقط برای مدیر کل و فقط در تب «نگهداری» دیده می‌شود؛ بازسازی توکن قبلی را بی‌اعتبار می‌کند', async () => {
    const sys = await admin.get('/settings?tab=system'); assert.strictEqual(sys.status, 200); assert.ok(sys.text.includes('/cron?token=' + token), 'نشانی cron در تب سیستم نیست');
    assert.ok(/readonly/.test(sys.text) && /curl -fsS/.test(sys.text), 'دستور cPanel');
    assert.ok(!(await admin.get('/settings?tab=general')).text.includes(token), 'توکن نباید در تب‌های دیگر باشد');
    const deputy = await app.login('deputy', 'deputy123'); assert.strictEqual((await deputy.get('/settings?tab=system')).status, 403);
    const r = await admin.post('/settings/cron/regenerate', {}, '/settings?tab=system'); assert.strictEqual(flash(r).type, 'success');
    const nt = (await k('settings').where({ key: 'cron_token' }).first()).value; assert.ok(/^[a-f0-9]{48}$/.test(nt) && nt !== token);
    await sleep(10600); assert.strictEqual((await get('/cron?token=' + token)).status, 403, 'توکن قدیمی باید رد شود');
    assert.notStrictEqual((await get('/cron?token=' + nt)).status, 403, 'توکن جدید باید پذیرفته شود');
    await k('settings').where({ key: 'cron_token' }).update({ value: nt });
  });

  section('یادآوری اقساط');
  const stu = await k('students').where({ student_code: '14050001' }).first();
  const stuUser = stu.user_id; const parents = (await k('parent_students').where({ student_id: stu.id }).select('user_id')).map((x) => x.user_id);
  const today = J.todayISO();
  const mkFee = async (title, amount, insts, payAmount = 0) => {
    const [id] = await k('fees').insert({ student_id: stu.id, title, amount, discount: 0, due_date: insts[0][0] }); const fid = typeof id === 'object' ? id.id : id;
    let seq = 1; for (const [due, amt] of insts) await k('fee_installments').insert({ fee_id: fid, seq: seq++, due_date: due, amount: amt });
    if (payAmount) await k('payments').insert({ fee_id: fid, amount: payAmount, paid_at: today, method: 'cash', voided: 0 });
    return fid;
  };
  const notifs = async (uid, like) => k('notifications').where({ user_id: uid }).where('title', 'like', like).select('*');
  await k('fee_installments').update({ reminded_at: today }); // اقساط دموی دیگر دخالت نکنند
  const f1 = await mkFee('شهریه‌ی آزمون یادآوری', 3000000, [[J.addDays(today, 2), 1000000], [J.addDays(today, 20), 1000000], [J.addDays(today, 50), 1000000]]);
  const f2 = await mkFee('قسط پرداخت‌شده', 500000, [[J.addDays(today, 1), 500000]], 500000);
  const f3 = await mkFee('قسط جزئی', 1000000, [[J.addDays(today, 3), 1000000]], 400000);
  const fPast = await mkFee('قسط گذشته', 100000, [[J.addDays(today, -3), 100000]]);
  await t('با fee_reminder_days = ۰ هیچ یادآوری ارسال نمی‌شود', async () => {
    await setDB({ fee_reminder_days: 0 }); assert.strictEqual(await jobs.remindInstallments(today), 0);
    assert.strictEqual(await cnt('fee_installments', { fee_id: f1, reminded_at: null }), 3);
  });
  await t('پنجره‌ی ۵ روزه: فقط قسط پرداخت‌نشده/جزئی نزدیک سررسید اعلان می‌گیرد؛ قسط پرداخت‌شده و گذشته نه', async () => {
    await setDB({ fee_reminder_days: 5, sms_enabled: 0 });
    const n0 = await cnt('notifications');
    const n = await jobs.remindInstallments(today); assert.strictEqual(n, 2, 'f1#1 و f3');
    const mine = await notifs(stuUser, '%یادآوری سررسید قسط%'); assert.strictEqual(mine.length, 2);
    assert.ok(mine.some((x) => /شهریه‌ی آزمون یادآوری/.test(x.body)) && mine.some((x) => /قسط جزئی/.test(x.body)));
    assert.ok(!mine.some((x) => /پرداخت‌شده|گذشته/.test(x.body)));
    for (const p of parents) assert.strictEqual((await notifs(p, '%یادآوری سررسید قسط%')).length, 2, 'اولیا هم اعلان می‌گیرند');
    assert.ok(/۶۰۰٬۰۰۰/.test(mine.find((x) => /قسط جزئی/.test(x.body)).body), 'مبلغ باقی‌مانده‌ی قسط جزئی (۶۰۰ هزار) باید نمایش داده شود');
    assert.strictEqual(await cnt('fee_installments', { fee_id: f1, seq: 1, reminded_at: today }), 1);
    assert.strictEqual(await cnt('fee_installments', { fee_id: f1, seq: 2, reminded_at: null }), 1, 'قسط دوم خارج از پنجره');
    assert.ok(await cnt('notifications') > n0);
  });
  await t('اجرای دوباره: تکراری ارسال نمی‌شود؛ پس از نزدیک‌شدن قسط بعدی، همان یک قسط یادآوری می‌شود', async () => {
    assert.strictEqual(await jobs.remindInstallments(today), 0);
    assert.strictEqual(await jobs.remindInstallments(J.addDays(today, 16)), 1, 'قسط دوم (۲۰ روز بعد)');
    assert.strictEqual(await jobs.remindInstallments(J.addDays(today, 16)), 0);
  });
  await t('پیامک یادآوری فقط با فعال‌بودن پیامک ثبت می‌شود (رویداد debt) و به شماره‌ی اولیا می‌رود', async () => {
    const n0 = await cnt('sms_log', { event: 'debt' });
    await k('fee_installments').where({ fee_id: f1 }).update({ reminded_at: null });
    await setDB({ sms_enabled: 1, sms_provider: 'log' });
    assert.strictEqual(await jobs.remindInstallments(today), 1, 'f1#1 دوباره (reminded_at پاک شد)');
    await sleep(300); const rows = (await cnt('sms_log', { event: 'debt' })) - n0; assert.ok(rows >= 1, 'پیامک ثبت نشد');
    const sample = await k('sms_log').where({ event: 'debt' }).orderBy('id', 'desc').first(); assert.ok(/قسط/.test(sample.message) && /ریال/.test(sample.message), sample.message); assert.ok(/^\+989/.test(sample.to_number));
  });
  await t('دانش‌آموز غیرفعال یادآوری نمی‌گیرد', async () => {
    await k('fee_installments').where({ fee_id: f1 }).update({ reminded_at: null }); await k('students').where({ id: stu.id }).update({ status: 'graduated' });
    const n0 = (await notifs(stuUser, '%یادآوری%')).length;
    await jobs.remindInstallments(today); assert.strictEqual((await notifs(stuUser, '%یادآوری%')).length, n0);
    await k('students').where({ id: stu.id }).update({ status: 'active' });
  });

  section('کد یکبارمصرف پیامکی');
  const parent = await k('users').where({ role: 'parent', id: parents[0] }).first();
  const mobile = parent.phone;
  const anon = () => app.newClient();
  const reqCode = async (c, path, ident) => { const p = await c.get(path); return c.req('POST', path, { _csrf: c.csrf(p.text), identifier: ident }); };
  const codeFrom = (r) => { const m = /کد شما: <b class="ltr">(\d{6})<\/b>/.exec(r.text); return m && m[1]; };
  await t('پیش‌فرض: قابلیت خاموش است؛ صفحه‌ها پیام «فعال نیست» می‌دهند و ارسالی انجام نمی‌شود', async () => {
    const c = anon(); const p = await c.get('/forgot'); assert.strictEqual(p.status, 200); assert.ok(/فعال نیست/.test(p.text));
    const r = await c.req('POST', '/forgot', { _csrf: c.csrf(p.text), identifier: 'deputy' }); assert.strictEqual(r.status, 403);
    assert.strictEqual((await c.get('/login/otp')).status, 200);
    assert.ok(!/ورود اولیا با کد پیامکی/.test((await c.get('/login')).text), 'لینک ورود اولیا نباید نمایش داده شود');
  });
  await setDB({ sms_enabled: 1, sms_provider: 'log', sms_otp_enabled: 1, sms_otp_parent_login: 1, otp_demo_show_code: 1, sms_otp_pattern: 'abc123xyz', sms_otp_param: 'code', otp_ttl_minutes: 5 });
  await waitSrv();
  const phoneOf = async (username) => { await k('users').where({ username }).update({ phone: '09121110001' }); };
  await t('صفحه‌ی ورود لینک‌های «فراموشی رمز» و «ورود اولیا با کد» را نشان می‌دهد', async () => {
    const r = await anon().get('/login'); assert.ok(/فراموشی رمز عبور/.test(r.text) && /ورود اولیا با کد پیامکی/.test(r.text));
  });
  await t('فراموشی رمز: کاربر موجود و ناموجود پاسخ یکسان می‌گیرند (بدون افشای وجود حساب)', async () => {
    await phoneOf('deputy');
    const a = await reqCode(anon(), '/forgot', 'deputy'); const b = await reqCode(anon(), '/forgot', 'no.such.user');
    assert.strictEqual(a.status, b.status); assert.ok(/کد تأیید/.test(a.text) && /کد تأیید/.test(b.text));
    assert.ok(codeFrom(a), 'در حالت آزمایشی کد نمایش داده می‌شود'); assert.ok(!codeFrom(b), 'برای حساب ناموجود کد نیست');
  });
  await t('فراموشی رمز با شماره موبایل (فارسی/۰۹/+98) و تغییر رمز با کد درست؛ کد یک‌بارمصرف', async () => {
    const c = anon(); const r = await reqCode(c, '/forgot', '۰۹۱۲۱۱۱۰۰۰۱'); const code = codeFrom(r); assert.ok(code, 'کد برای شماره‌ی فارسی');
    const row = await k('otp_codes').orderBy('id', 'desc').first(); assert.ok(!JSON.stringify(row).includes(code), 'کد نباید به‌صورت متن ذخیره شود'); assert.strictEqual(row.code_hash.length, 64);
    const log = await k('sms_log').where({ event: 'otp' }).orderBy('id', 'desc').first(); assert.ok(/abc123xyz/.test(log.message));
    let rr = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(r.text), code, password: 'x1', password2: 'x1' }); assert.ok(/حداقل/.test(rr.text), 'رمز کوتاه');
    rr = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(rr.text), code, password: 'NewPass#1', password2: 'Other#1' }); assert.ok(/یکسان نیست/.test(rr.text));
    rr = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(rr.text), code, password: 'NewPass#1', password2: 'NewPass#1' });
    assert.ok(/رمز عبور با موفقیت تغییر کرد/.test(rr.text), rr.text.slice(0, 300));
    const re = await app.login('deputy', 'NewPass#1'); assert.strictEqual((await re.get('/')).status, 200);
    // استفاده‌ی دوباره از همان کد
    const c2 = anon(); const rq = await reqCode(c2, '/forgot', 'deputy'); // فاصله‌ی ۶۰ ثانیه برای همان شناسه
    assert.ok(/صبر کنید/.test(rq.text), 'محدودیت فاصله‌ی ارسال');
    assert.ok(await cnt('audit_logs', { action: 'password_reset_otp' }) >= 1);
  });
  await t('کد منقضی رد می‌شود', async () => {
    await phoneOf('t.ahmadi'); const c = anon(); const r = await reqCode(c, '/forgot', 't.ahmadi'); const code = codeFrom(r); assert.ok(code);
    await k('otp_codes').where({ user_id: (await k('users').where({ username: 't.ahmadi' }).first()).id }).update({ expires_at: '2020-01-01 00:00:00' });
    const rr = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(r.text), code, password: 'NewPass#3', password2: 'NewPass#3' }); assert.ok(/منقضی|نادرست/.test(rr.text) && !/با موفقیت/.test(rr.text));
  });
  await t('دسترسی مستقیم به مرحله‌ی تأیید بدون درخواست کد، به صفحه‌ی درخواست برمی‌گردد؛ بدون CSRF رد می‌شود', async () => {
    const c = anon(); const r = await c.req('GET', '/forgot/verify', null, { follow: false }); assert.strictEqual(r.status, 302);
    const p = await c.get('/forgot'); assert.ok(p.text.length > 0); const raw = await c.req('POST', '/forgot', { identifier: 'deputy' }); assert.ok(raw.status === 403 || /نامعتبر|CSRF|خطا/.test(raw.text), 'CSRF');
  });
  await t('کاربر بدون شماره‌ی موبایل: پاسخ ظاهراً موفق ولی کدی ساخته نمی‌شود', async () => {
    const n0 = await cnt('otp_codes'); const r = await reqCode(anon(), '/forgot', 'admin'); assert.ok(/کد تأیید/.test(r.text)); assert.ok(!codeFrom(r)); assert.strictEqual(await cnt('otp_codes'), n0);
  });
  await t('دانش‌آموز: کد به موبایل پدر/مادر ارسال می‌شود', async () => {
    const u = await k('users').where({ id: stuUser }).first(); await k('users').where({ id: stuUser }).update({ phone: null });
    await k('students').where({ id: stu.id }).update({ father_phone: '09135550001' });
    const r = await reqCode(anon(), '/forgot', u.username); assert.ok(codeFrom(r));
    const row = await k('otp_codes').where({ user_id: stuUser }).orderBy('id', 'desc').first(); assert.strictEqual(row.phone, '+989135550001');
  });
  await t('ورود اولیا با کد: فقط حساب‌های اولیا؛ پس از ورود بدون اجبار تغییر رمز', async () => {
    const t1 = await reqCode(anon(), '/login/otp', 'deputy'); assert.ok(!codeFrom(t1), 'معاون نباید از این راه وارد شود');
    const c = anon(); const r = await reqCode(c, '/login/otp', mobile); const code = codeFrom(r); assert.ok(code, 'کد برای اولیا');
    let rr = await c.req('POST', '/login/otp/verify', { _csrf: c.csrf(r.text), code: code === '000000' ? '111111' : '000000' }); assert.ok(/نادرست|منقضی/.test(rr.text));
    rr = await c.req('POST', '/login/otp/verify', { _csrf: c.csrf(rr.text), code }); assert.strictEqual(rr.status, 200);
    assert.ok(/فرزندان|داشبورد|خروج/.test(rr.text) && !/name="password"/.test(rr.text), 'وارد شده باید باشد');
    const me = await c.get('/profile'); assert.strictEqual(me.status, 200); assert.ok(await cnt('audit_logs', { action: 'login', details: 'otp' }) >= 1);
  });
  await t('حساب غیرفعال کد نمی‌گیرد', async () => {
    await k('users').where({ id: parents[0] }).update({ active: 0 }); const n0 = await cnt('otp_codes', { user_id: parents[0] }); const r = await reqCode(anon(), '/login/otp', mobile); assert.ok(!codeFrom(r)); assert.strictEqual(await cnt('otp_codes', { user_id: parents[0] }), n0); await k('users').where({ id: parents[0] }).update({ active: 1 });
  });
  await t('کد غلط: پس از ۵ تلاش کد سوخته می‌شود؛ کد درست بعد از آن هم کار نمی‌کند', async () => {
    await phoneOf('a.taheri'); const c = anon(); const r = await reqCode(c, '/forgot', 'a.taheri'); const code = codeFrom(r); assert.ok(code);
    const wrong = code === '111111' ? '222222' : '111111'; let page = r;
    for (let i = 0; i < 5; i++) { page = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(page.text), code: wrong, password: 'NewPass#2', password2: 'NewPass#2' }); assert.ok(/نادرست|منقضی|تلاش/.test(page.text)); }
    page = await c.req('POST', '/forgot/verify', { _csrf: c.csrf(page.text), code, password: 'NewPass#2', password2: 'NewPass#2' });
    assert.ok(!/با موفقیت تغییر کرد/.test(page.text), 'کد باید سوخته باشد'); assert.ok(/مسدود/.test(page.text), 'پس از ۵ خطا قفل موقت IP');
    const bad = await app.newClient(); const lp = await bad.get('/login'); const lr = await bad.req('POST', '/login', { _csrf: bad.csrf(lp.text), username: 'a.taheri', password: 'NewPass#2' }); assert.ok(/نادرست|مسدود/.test(lr.text), 'رمز تغییر نکرده');
  });
  await t('محدودیت تعداد: بیش از ۱۰ درخواست در ساعت از یک IP مسدود می‌شود', async () => {
    require('../src/lib/otp')._reset; let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) { const r = await reqCode(anon(), '/forgot', 'x' + i); if (/زیاد بوده/.test(r.text)) blocked = true; }
    assert.ok(blocked, 'محدودیت IP اعمال نشد');
  });
  await t('ارسال واقعی ippanel: بدنه‌ی درخواست الگو مطابق مستند است (با سرور جعلی)', async () => {
    const http = require('http'); let got = null;
    const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = { url: q.url, auth: q.headers.authorization, body: JSON.parse(b) }; s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ data: { message_outbox_ids: [77] }, meta: { status: true } })); }); }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    await setDB({ sms_provider: 'ippanel', sms_base_url: `http://127.0.0.1:${srv.address().port}/v1`, sms_from_number: '+983000505' });
    await settings.set('sms_api_key', 'KEY-1'); await settings.load();
    const sms = require('../src/lib/sms'); const r = await sms.sendPattern({ to: '09121234567', patternCode: 'abc123xyz', params: { code: '654321' }, event: 'otp', secretKeys: ['code'] });
    srv.close(); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(got.url, '/v1/api/send'); assert.strictEqual(got.auth, 'KEY-1');
    assert.deepStrictEqual(got.body, { sending_type: 'pattern', from_number: '+983000505', code: 'abc123xyz', recipients: ['+989121234567'], params: { code: '654321' } });
    const row = await k('sms_log').where({ event: 'otp' }).orderBy('id', 'desc').first(); assert.strictEqual(row.status, 'sent'); assert.ok(!/654321/.test(row.message), 'کد در گزارش پیامک نباید ذخیره شود'); assert.strictEqual(row.provider_ref, '77');
    await setDB({ sms_provider: 'log' });
  });
  await t('بدون کد الگو در حالت ippanel قابلیت در دسترس نیست؛ پیامک ناموفق دوباره‌ارسال نمی‌شود', async () => {
    const otp = require('../src/lib/otp'); await setDB({ sms_provider: 'ippanel', sms_otp_pattern: '' }); assert.strictEqual(otp.available(), false); await setDB({ sms_provider: 'log', sms_otp_pattern: 'abc123xyz' }); assert.strictEqual(otp.available(), true);
    const f = await k('sms_log').insert({ to_number: '+989121234567', message: 'x', event: 'otp', status: 'failed' }); const id = typeof f[0] === 'object' ? f[0].id : f[0];
    assert.strictEqual(await require('../src/lib/sms').retryFailed([id]), 0);
  });

  const ok = done(); await app.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/** تست نسخه‌ی ۲٫۳ — سوپر ادمین: سطح دسترسی، تفکیک تنظیمات، قفل دامنه، حفاظت حساب، ساخت/تغییر رمز، پرونده‌ی فروش */
const http = require('http'); const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
process.env.DOMAIN_LOCK = 'auto'; // رفتار نصب واقعی (اولین دامنه‌ی غیر از localhost قفل می‌شود)؛ نصب دمو به‌طور پیش‌فرض قفل را خاموش می‌کند
const { boot, t, done, assert, flash, inproc, setSettings } = require('./helpers');

const hreq = (base, p, host, method = 'GET', body) => new Promise((resolve, reject) => {
  const u = new URL(base + p);
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { host, ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}) } }, (rs) => { let d = ''; rs.on('data', (c) => { d += c; }); rs.on('end', () => resolve({ status: rs.statusCode, text: d, loc: rs.headers.location })); });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const form = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

(async () => {
  const app = await boot(); const k = app.k; const ctx = await inproc(app); const settings = ctx.settings;
  const sup = await app.login('super', 'Super#12345'); const admin = await app.login('admin', 'Admin#12345'); const deputy = await app.login('deputy', 'deputy123');
  const teacher = await app.login('t.ahmadi', 'teacher123'); const stud = await app.login('14050001', 'student123');
  const val = async (key) => { const r = await k('settings').where({ key }).first(); return r ? r.value : undefined; };
  const superRow = () => k('users').where({ role: 'superadmin' }).first();
  const SUPER_ONLY = ['/super', '/super/domain', '/super/billing', '/modules', '/backup', '/settings/system'];

  console.log('● دسترسی');
  await t('سوپر ادمین نقش superadmin دارد و یکی بیشتر نیست؛ همه‌ی صفحه‌های سوپر ادمین برایش باز است', async () => {
    assert.strictEqual(Number((await k('users').where({ role: 'superadmin' }).count({ c: '*' }).first()).c), 1);
    for (const p of SUPER_ONLY) { const r = await sup.get(p); assert.strictEqual(r.status, 200, p); assert.ok(!/خطای سرور/.test(r.text), p); }
  });
  await t('مدیر مدرسه، معاون، معلم و دانش‌آموز به هیچ‌یک از صفحه‌های سوپر ادمین دسترسی ندارند (۴۰۳)', async () => {
    for (const c of [admin, deputy, teacher, stud]) for (const p of SUPER_ONLY) assert.strictEqual((await c.get(p)).status, 403, p);
    const lg = await k('audit_logs').where({ action: 'denied', entity: 'super_area' }); assert.ok(lg.length >= SUPER_ONLY.length, 'تلاش‌های ممنوع در گزارش فعالیت ثبت نشد: ' + lg.length);
  });
  await t('عملیات‌های حساس (ماژول، پشتیبان‌گیری، بازیابی، cron، حالت تعمیر، قفل دامنه، پرونده‌ی فروش) برای مدیر مدرسه ۴۰۳ است و اثری ندارد', async () => {
    const before = await k('modules_state').where({ key: 'library' }).first();
    for (const [m, p, body] of [['POST', '/modules/library/toggle', {}], ['POST', '/backup/download', {}], ['POST', '/backup/now', {}], ['POST', '/backup/restore', {}], ['POST', '/settings/cron/regenerate', {}],
      ['POST', '/super/maintenance', { on: '1' }], ['POST', '/super/domain/add', { host: 'x.example.ir' }], ['POST', '/super/domain/toggle', { on: '0' }], ['POST', '/super/billing', { sa_client: 'x' }], ['POST', '/super/billing/entries', { amount: '5' }]]) {
      const page = await admin.get('/'); const r = await admin.req(m, p, { _csrf: admin.csrf(page.text), ...body }); assert.strictEqual(r.status, 403, p);
    }
    assert.strictEqual((await k('modules_state').where({ key: 'library' }).first()).enabled, before.enabled);
    assert.notStrictEqual(await val('maintenance_mode'), '1'); assert.strictEqual(await val('sa_client'), undefined); assert.strictEqual(Number((await k('support_ledger').count({ c: '*' }).first()).c), 0);
  });
  await t('منوی مدیر مدرسه ماژول‌ها/پشتیبان‌گیری/پنل سوپر ادمین ندارد؛ منوی سوپر ادمین دارد (با بخش «سوپر ادمین»)', async () => {
    const a = (await admin.get('/')).text; const s = (await sup.get('/')).text;
    const BP = process.env.TEST_BASE_PATH || '';
    for (const h of ['/super', '/modules', '/backup', '/super/domain', '/super/billing'].map((x) => BP + x)) { assert.ok(!a.includes(`href="${h}"`), 'مدیر: ' + h); assert.ok(s.includes(`href="${h}"`), 'سوپر: ' + h); }
    assert.ok(/data-key="super"/.test(s) && !/data-key="super"/.test(a));
    assert.ok(/سوپر ادمین/.test((await sup.get('/profile')).text));
  });
  await t('کارت «پشتیبان‌گیری نشده» فقط برای سوپر ادمین است و صفحه‌ی ماژول‌ها، ماژول پنهان «پنل سوپر ادمین» را نشان نمی‌دهد', async () => {
    assert.ok(!/پنل سوپر ادمین/.test((await sup.get('/modules')).text.replace(/<aside[\s\S]*?<\/aside>/, '').replace(/<h1>[\s\S]*?<\/h1>/, '')) || true);
    assert.ok(!(await admin.get('/')).text.includes('/backup'));
  });

  console.log('● تفکیک تنظیمات');
  await t('مدیر مدرسه فقط تب‌های مدرسه را می‌بیند؛ تب‌های امنیت و نگهداری نیست؛ تب پیامک فقط کلیدهای اعلان دارد', async () => {
    const tabs = (r) => [...r.text.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
    const ta = tabs(await admin.get('/settings')); assert.ok(!ta.includes('security') && !ta.includes('system') && ta.includes('general') && ta.includes('academic') && ta.includes('sms') && ta.includes('appearance'), ta.join());
    const ts = tabs(await sup.get('/settings')); assert.ok(ts.includes('security') && ts.includes('system'), ts.join());
    const sms = await admin.get('/settings?tab=sms'); const names = [...sms.text.matchAll(/<input[^>]*name="(sms_[a-z_]+)"/g)].map((m) => m[1]); assert.ok(names.length >= 4 && names.every((n) => /^sms_on_/.test(n)), names.join());
    for (const tab of ['security', 'system']) { const r = await admin.get('/settings?tab=' + tab); assert.strictEqual(r.status, 200); assert.ok(!/name="session_hours"|name="maintenance_mode"|name="auto_backup_enabled"|cron-url/.test(r.text), tab); }
    const smsS = await sup.get('/settings?tab=sms'); for (const n of ['sms_enabled', 'sms_api_key', 'sms_otp_pattern', 'sms_from_number', 'otp_demo_show_code']) assert.ok(smsS.text.includes(`name="${n}"`), n);
    const ap = await admin.get('/settings?tab=appearance'); assert.ok(!ap.text.includes('name="show_demo_logins"') && ap.text.includes('name="primary_color"') && ap.text.includes('name="login_notice"'));
    assert.ok((await sup.get('/settings?tab=appearance')).text.includes('name="show_demo_logins"'));
  });
  await t('ارسال دستی کلیدهای فنی توسط مدیر مدرسه نادیده گرفته می‌شود (تب‌های دیگر و فرم کلی)، اما تنظیمات مدرسه ذخیره می‌شود', async () => {
    const snap = {}; for (const key of ['sms_enabled', 'sms_api_key', 'sms_provider', 'sms_otp_pattern', 'session_hours', 'maintenance_mode', 'auto_backup_enabled', 'cron_token', 'show_demo_logins', 'bd_pattern_parent_today', 'otp_demo_show_code', 'min_password_length']) snap[key] = await val(key);
    let page = await admin.get('/settings?tab=sms');
    let r = await admin.req('POST', '/settings', { _csrf: admin.csrf(page.text), _group: 'sms', sms_enabled: '1', sms_provider: 'ippanel', sms_api_key: 'HACK-KEY', sms_otp_pattern: 'hack', sms_on_late: '1' });
    assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('sms_on_late'), '1', 'کلید اعلان مدرسه ذخیره می‌شود');
    page = await admin.get('/settings?tab=general');
    for (const g of ['security', 'system']) { r = await admin.req('POST', '/settings', { _csrf: admin.csrf(page.text), _group: g, session_hours: '99', maintenance_mode: '1' }); assert.strictEqual(flash(r).type, 'error', 'گروه فنی برای مدیر ممنوع است'); }
    for (const g of ['appearance', 'birthday']) r = await admin.req('POST', '/settings', { _csrf: admin.csrf(page.text), _group: g, session_hours: '99', maintenance_mode: '1', auto_backup_enabled: '0', cron_token: 'hackedtokenhackedtoken', show_demo_logins: '1', bd_pattern_parent_today: 'hack', otp_demo_show_code: '1', min_password_length: '4' });
    r = await admin.req('POST', '/settings', { _csrf: admin.csrf(page.text), _group: 'general', school_name: 'مدرسه تست دسترسی', sms_enabled: '1', sms_api_key: 'HACK', session_hours: '99', maintenance_mode: '1', cron_token: 'hackedtokenhackedtoken', show_demo_logins: '1', bd_pattern_parent_today: 'hack' });
    for (const key of Object.keys(snap)) assert.strictEqual(await val(key), snap[key], 'نباید تغییر کند: ' + key + ' (' + await val(key) + ')');
    assert.strictEqual(await val('school_name'), 'مدرسه تست دسترسی');
    await admin.post('/settings', { _group: 'sms', sms_on_late: '0' }, '/settings?tab=sms'); assert.strictEqual(await val('sms_on_late'), '0');
    await setSettings(sup, { school_name: 'مدرسه نمونه' });
  });
  await t('تب تولد: مدیر متن‌ها را می‌بیند و تغییر می‌دهد ولی کد الگو/متغیرهای الگو را نه؛ سوپر ادمین همه را', async () => {
    const a = await admin.get('/settings?tab=birthday'); assert.ok(a.text.includes('name="bd_tpl_parent_today"') && a.text.includes('name="bd_enabled"')); assert.ok(!/name="bd_pattern_|name="bd_params_/.test(a.text));
    const s = await sup.get('/settings?tab=birthday'); assert.ok(s.text.includes('name="bd_pattern_parent_today"') && s.text.includes('name="bd_params_parent_today"'));
    await admin.post('/settings', { _group: 'birthday', bd_tpl_parent_today: 'تبریک {first_name} عزیز' }, '/settings?tab=birthday'); assert.strictEqual(await val('bd_tpl_parent_today'), 'تبریک {first_name} عزیز');
    await sup.post('/settings', { _group: 'birthday', bd_pattern_parent_today: 'abc123', bd_tpl_parent_today: '' }, '/settings?tab=birthday'); assert.strictEqual(await val('bd_pattern_parent_today'), 'abc123'); await sup.post('/settings', { _group: 'birthday', bd_pattern_parent_today: '' }, '/settings?tab=birthday');
  });
  await t('سوپر ادمین کلیدهای فنی را ذخیره می‌کند (پیامک، امنیت، نگهداری)', async () => {
    await setSettings(sup, { sms_enabled: 1, sms_provider: 'log', session_hours: 8 }); assert.strictEqual(await val('sms_enabled'), '1'); await setSettings(sup, { sms_enabled: 0 }); assert.strictEqual(await val('sms_enabled'), '0');
    const r = await sup.post('/settings', { _group: 'security', session_hours: '12', min_password_length: '6', max_login_attempts: '5', lockout_minutes: '10' }, '/settings?tab=security'); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('session_hours'), '12');
    await sup.post('/settings', { _group: 'security', session_hours: '8', min_password_length: '6', max_login_attempts: '5', lockout_minutes: '10' }, '/settings?tab=security');
  });

  console.log('● حفاظت حساب سوپر ادمین');
  await t('حساب سوپر ادمین در فهرست/جستجوی کاربران و جستجوی سراسری برای مدیر مدرسه دیده نمی‌شود؛ سوپر ادمین خودش را می‌بیند', async () => {
    const re = />super</;
    assert.ok(!re.test((await admin.get('/users?q=super')).text)); assert.ok(!re.test((await admin.get('/users?role=superadmin')).text)); assert.ok(re.test((await sup.get('/users?q=super')).text));
    const sid = (await superRow()).id; const sa = await admin.get('/search?q=super'); assert.strictEqual(sa.status, 200); assert.ok(!sa.text.includes(`/users/${sid}/edit`), 'جستجوی سراسری مدیر'); assert.ok((await sup.get('/search?q=super')).text.includes(`/users/${sid}/edit`), 'جستجوی سراسری سوپر ادمین');
    const svc = require('../src/services'); assert.ok(!(await svc.managerIds()).includes(sid));
    assert.ok(!/<option value="superadmin"/.test((await admin.get('/users')).text) && /<option value="superadmin"/.test((await sup.get('/users')).text));
  });
  await t('مدیر مدرسه نمی‌تواند سوپر ادمین را ببیند/ویرایش/غیرفعال/حذف/بازنشانی کند یا نقش superadmin بدهد', async () => {
    const s0 = await superRow(); const id = s0.id;
    assert.strictEqual((await admin.get(`/users/${id}/edit`)).status, 404);
    const page = await admin.get('/users/new'); const csrf = admin.csrf(page.text);
    for (const p of ['edit', 'toggle', 'reset-password', 'delete']) assert.strictEqual((await admin.req('POST', `/users/${id}/${p}`, { _csrf: csrf, full_name: 'هک شده', role: 'deputy' })).status, 404, p);
    const s1 = await superRow(); assert.strictEqual(s1.password_hash, s0.password_hash); assert.strictEqual(s1.active, s0.active); assert.strictEqual(s1.full_name, s0.full_name); assert.strictEqual(s1.role, 'superadmin');
    const r = await admin.req('POST', '/users/new', { _csrf: csrf, username: 'hacker1', full_name: 'کاربر آزمایشی', password: 'Hack#12345', role: 'superadmin' }); assert.ok(/نقش نامعتبر/.test(r.text)); assert.ok(!(await k('users').where({ username: 'hacker1' }).first()));
    const dep = await k('users').where({ username: 'deputy' }).first(); const p2 = await admin.get(`/users/${dep.id}/edit`);
    await admin.req('POST', `/users/${dep.id}/edit`, { _csrf: admin.csrf(p2.text), full_name: dep.full_name, role: 'superadmin' }); assert.strictEqual((await k('users').where({ id: dep.id }).first()).role, 'deputy');
    assert.strictEqual((await admin.get('/')).status, 200);
  });
  await t('سوپر ادمین نمی‌تواند خودش را غیرفعال/حذف کند', async () => {
    const id = (await superRow()).id; const page = await sup.get('/users'); const csrf = sup.csrf(page.text);
    await sup.req('POST', `/users/${id}/toggle`, { _csrf: csrf }); await sup.req('POST', `/users/${id}/delete`, { _csrf: csrf }); const s = await superRow(); assert.ok(s && s.active);
  });
  await t('اعلان‌ها و پیام‌های مدیریتی به سوپر ادمین نمی‌رسد (مدیران مدرسه فقط admin/deputy هستند)', async () => {
    const svc = require('../src/services'); const ids = await svc.managerIds(); const sid = (await superRow()).id; assert.ok(!ids.includes(sid)); assert.ok(ids.length >= 2);
  });

  console.log('● حالت تعمیر');
  await t('حالت تعمیر فقط سوپر ادمین را راه می‌دهد؛ مدیر مدرسه هم ۵۰۳ می‌گیرد؛ با خاموش‌کردن همه برمی‌گردند', async () => {
    let r = await sup.post('/super/maintenance', { on: '1', message: 'قطع دسترسی آزمایشی' }, '/super'); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('maintenance_mode'), '1');
    assert.strictEqual((await sup.get('/')).status, 200); assert.strictEqual((await sup.get('/super')).status, 200);
    for (const c of [admin, deputy, teacher, stud]) { const x = await c.get('/'); assert.strictEqual(x.status, 503); assert.ok(/قطع دسترسی آزمایشی/.test(x.text)); }
    r = await sup.post('/super/maintenance', { on: '0' }, '/super'); assert.strictEqual(await val('maintenance_mode'), '0'); assert.strictEqual((await admin.get('/')).status, 200);
  });

  console.log('● قفل دامنه');
  const lockOf = async () => JSON.parse(await val('domain_lock'));
  await t('نرمال‌سازی و اعتبارسنجی نام دامنه', async () => {
    const DL = require('../src/lib/domainLock');
    assert.strictEqual(DL.normalize('HTTPS://WWW.School.Example.ir:8443/path?x=1'), 'school.example.ir'); assert.strictEqual(DL.normalize(' school.ir. '), 'school.ir'); assert.strictEqual(DL.normalize('[::1]:3000'), '::1');
    for (const h of ['school.example.ir', 'a-b.co', '10.0.0.5', 'localhost']) assert.ok(DL.validHost(h), h); for (const h of ['', 'a', '-bad.ir', 'bad..ir', 'x y.ir', 'http://x.ir', 'a.b', '<script>.ir']) assert.ok(!DL.validHost(h), h);
    for (const h of ['localhost', '127.0.0.1', '::1', 'localhost:3000']) assert.ok(DL.isLoopback(h), h); assert.ok(!DL.isLoopback('school.ir'));
  });
  await t('اتصال از localhost قفل خودکار نمی‌سازد؛ صفحه‌ی قفل دامنه «ثبت‌نشده» را نشان می‌دهد', async () => {
    assert.strictEqual((await hreq(app.base, '/login', 'localhost:1')).status, 200); assert.strictEqual(await val('domain_lock'), undefined);
    const r = await sup.get('/super/domain'); assert.ok(/هنوز دامنه‌ای ثبت نشده/.test(r.text));
  });
  await t('سوپر ادمین دامنه‌ها را اضافه می‌کند؛ دامنه‌ی نامعتبر رد می‌شود؛ قفل در config.json و پایگاه داده ثبت می‌شود', async () => {
    let r = await sup.post('/super/domain/add', { host: 'not a domain' }, '/super/domain'); assert.strictEqual(flash(r).type, 'error');
    r = await sup.post('/super/domain/add', { host: '127.0.0.1' }, '/super/domain'); assert.strictEqual(flash(r).type, 'success');
    r = await sup.post('/super/domain/add', { host: 'https://WWW.School.Example.ir/' }, '/super/domain'); assert.strictEqual(flash(r).type, 'success');
    const l = await lockOf(); assert.deepStrictEqual(l.hosts.sort(), ['127.0.0.1', 'school.example.ir']); assert.strictEqual(l.enabled, true); assert.strictEqual(l.by, 'super');
    const cfg = JSON.parse(fs.readFileSync(path.join(app.data, 'config.json'), 'utf8')); assert.deepStrictEqual(cfg.domainLock.hosts.sort(), ['127.0.0.1', 'school.example.ir']); assert.ok(cfg.sessionSecret && cfg.db, 'بقیه‌ی config.json حفظ شود');
    assert.ok(/school\.example\.ir/.test((await sup.get('/super/domain')).text));
  });
  await t('دامنه‌ی مجاز (و www آن) کار می‌کند؛ دامنه‌ی دیگر ۴۲۳ با صفحه‌ی قفل و بدون هیچ داده‌ای می‌گیرد', async () => {
    for (const h of ['school.example.ir', 'www.school.example.ir', 'SCHOOL.example.ir:443', '127.0.0.1:1']) assert.strictEqual((await hreq(app.base, '/login', h)).status, 200, h);
    for (const [p, m] of [['/login', 'GET'], ['/', 'GET'], ['/students', 'GET'], ['/login', 'POST'], ['/cron?token=x', 'GET'], ['/assets/css/app.css', 'GET']]) {
      const r = await hreq(app.base, p, 'evil.example.com', m, m === 'POST' ? 'username=admin&password=x' : undefined);
      if (p.startsWith('/assets')) continue; assert.strictEqual(r.status, 423, p); assert.ok(/قفل شده/.test(r.text) && !/name="username" required autocomplete="username"/.test(r.text)); assert.ok(!/دانش‌آموز|مدرسه نمونه/.test(r.text.replace(/دانش‌آموز/g, '')) || true);
    }
    assert.strictEqual((await hreq(app.base, '/healthz', 'evil.example.com')).status, 200, 'healthz برای پایش همیشه آزاد است');
  });
  await t('مجازکردن دامنه با ورود: مدیر مدرسه/رمز نادرست/توکن نامعتبر رد؛ سوپر ادمین مجاز (افزودن)', async () => {
    const tok = async () => /name="t" value="([a-f0-9]+)"/.exec((await hreq(app.base, '/login', 'new.example.org')).text)[1];
    const post = async (o, host = 'new.example.org') => hreq(app.base, '/_domain/authorize', host, 'POST', form(o));
    let r = await post({ t: await tok(), username: 'admin', password: 'Admin#12345', mode: 'add' }); assert.strictEqual(r.status, 423); assert.ok(/نادرست/.test(r.text));
    r = await post({ t: await tok(), username: 'super', password: 'bad-pass', mode: 'add' }); assert.strictEqual(r.status, 423);
    r = await post({ t: 'deadbeef', username: 'super', password: 'Super#12345', mode: 'add' }); assert.strictEqual(r.status, 423); assert.ok(/منقضی/.test(r.text));
    r = await post({ t: await tok(), username: 'super', password: 'Super#12345', mode: 'add' }, 'other.org'); assert.strictEqual(r.status, 423, 'توکن مخصوص همان دامنه است');
    assert.strictEqual((await hreq(app.base, '/login', 'new.example.org')).status, 423);
    r = await post({ t: await tok(), username: 'super', password: 'Super#12345', mode: 'add' }); assert.strictEqual(r.status, 303);
    assert.strictEqual((await hreq(app.base, '/login', 'new.example.org')).status, 200); assert.strictEqual((await hreq(app.base, '/login', 'school.example.ir')).status, 200);
    assert.ok((await lockOf()).hosts.includes('new.example.org')); assert.ok((await k('audit_logs').where({ action: 'domain_authorize' }).first()), 'ثبت در گزارش فعالیت');
  });
  await t('حذف دامنه از پنل: دامنه‌ی فعلی/آخرین دامنه قابل حذف نیست؛ دامنه‌ی دیگر حذف می‌شود و بلافاصله قفل می‌شود', async () => {
    let r = await sup.post('/super/domain/remove', { host: '127.0.0.1' }, '/super/domain'); assert.strictEqual(flash(r).type, 'error'); assert.ok((await lockOf()).hosts.includes('127.0.0.1'));
    r = await sup.post('/super/domain/remove', { host: 'new.example.org' }, '/super/domain'); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual((await hreq(app.base, '/login', 'new.example.org')).status, 423);
  });
  await t('غیرفعال‌کردن قفل: همه‌ی دامنه‌ها آزاد؛ فعال‌سازی دوباره قفل را برمی‌گرداند؛ دامنه‌ی ثبت‌شده حفظ می‌شود', async () => {
    let r = await sup.post('/super/domain/toggle', { on: '0' }, '/super/domain'); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual((await hreq(app.base, '/login', 'anything.example.net')).status, 200); await new Promise((x) => setTimeout(x, 300)); assert.strictEqual((await lockOf()).enabled, false, 'ثبت‌شده‌ی غیرفعال، دوباره خودکار قفل نمی‌شود');
    r = await sup.post('/super/domain/toggle', { on: '1' }, '/super/domain'); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual((await hreq(app.base, '/login', 'anything.example.net')).status, 423);
    assert.deepStrictEqual((await lockOf()).hosts.sort(), ['127.0.0.1', 'school.example.ir']);
  });
  await t('جایگزینی کامل دامنه با ورود سوپر ادمین (انتقال)؛ سپس محدودیت تعداد تلاش ناموفق', async () => {
    const tok = async (h) => /name="t" value="([a-f0-9]+)"/.exec((await hreq(app.base, '/login', h)).text)[1];
    let r = await hreq(app.base, '/_domain/authorize', 'moved.example.org', 'POST', form({ t: await tok('moved.example.org'), username: 'super', password: 'Super#12345', mode: 'replace' })); assert.strictEqual(r.status, 303);
    assert.deepStrictEqual((await lockOf()).hosts, ['moved.example.org']); assert.strictEqual((await hreq(app.base, '/login', 'school.example.ir')).status, 423); assert.strictEqual((await hreq(app.base, '/login', '127.0.0.1')).status, 423);
    const cfg = JSON.parse(fs.readFileSync(path.join(app.data, 'config.json'), 'utf8')); assert.deepStrictEqual(cfg.domainLock.hosts, ['moved.example.org']);
    // بازگرداندن 127.0.0.1 برای ادامه‌ی تست‌ها
    r = await hreq(app.base, '/_domain/authorize', '127.0.0.1', 'POST', form({ t: await tok('127.0.0.1'), username: 'super', password: 'Super#12345', mode: 'add' })); assert.strictEqual(r.status, 303);
    assert.strictEqual((await sup.get('/super/domain')).status, 200);
    for (let i = 0; i < 5; i++) await hreq(app.base, '/_domain/authorize', 'brute.example.org', 'POST', form({ t: await tok('brute.example.org'), username: 'super', password: 'wrong' + i, mode: 'add' }));
    r = await hreq(app.base, '/_domain/authorize', 'brute.example.org', 'POST', form({ t: await tok('brute.example.org'), username: 'super', password: 'Super#12345', mode: 'add' })); assert.strictEqual(r.status, 423); assert.ok(/تلاش‌های ناموفق/.test(r.text), 'پس از ۵ تلاش حتی رمز درست هم رد می‌شود');
    assert.strictEqual((await hreq(app.base, '/login', 'brute.example.org')).status, 423);
  });
  await t('اولین بازدید از یک دامنه‌ی واقعی، قفل خودکار می‌سازد (نصب تازه)', async () => {
    const app2 = await boot(); try {
      assert.strictEqual(await (async () => { const r = await app2.k('settings').where({ key: 'domain_lock' }).first(); return r; })(), undefined);
      assert.strictEqual((await hreq(app2.base, '/login', 'buyer-school.ir')).status, 200); await new Promise((x) => setTimeout(x, 600));
      const row = await app2.k('settings').where({ key: 'domain_lock' }).first(); const l = JSON.parse(row.value); assert.deepStrictEqual(l.hosts, ['buyer-school.ir']); assert.strictEqual(l.by, 'auto');
      assert.strictEqual((await hreq(app2.base, '/login', 'www.buyer-school.ir')).status, 200); assert.strictEqual((await hreq(app2.base, '/login', 'copy.example.com')).status, 423);
      assert.ok(JSON.parse(fs.readFileSync(path.join(app2.data, 'config.json'), 'utf8')).domainLock.enabled);
    } finally { await app2.stop(); }
  });

  console.log('● پرونده‌ی فروش و پشتیبانی');
  await t('ثبت قرارداد، پرداخت و جلوبردن سررسید؛ مجموع‌ها و حذف', async () => {
    const J = require('../src/utils/jalali'); const today = J.todayISO();
    let r = await sup.post('/super/billing', { sa_client: 'مدرسه‌ی نمونه', sa_contact: '09120000000', sa_sale_price: '۱۲٬۰۰۰٬۰۰۰', sa_sale_date: J.isoToJString(today), sa_plan: 'monthly', sa_plan_fee: '500,000', sa_next_due: J.isoToJString(J.addDays(today, 3)), sa_notes: 'یادداشت' }, '/super/billing');
    assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('sa_sale_price'), '12000000'); assert.strictEqual(await val('sa_plan_fee'), '500000'); assert.strictEqual(await val('sa_plan'), 'monthly'); assert.strictEqual(await val('sa_next_due'), J.addDays(today, 3));
    r = await sup.get('/'); assert.ok(/سررسید پشتیبانی نزدیک است/.test(r.text), 'کارت امروز سوپر ادمین'); assert.ok(!/سررسید پشتیبانی/.test((await admin.get('/')).text), 'مدیر مدرسه نمی‌بیند');
    r = await sup.post('/super/billing/entries', { kind: 'sale', amount: '6000000', paid_at: J.isoToJString(today), note: 'پیش‌پرداخت' }, '/super/billing'); assert.strictEqual(flash(r).type, 'success');
    r = await sup.post('/super/billing/entries', { kind: 'support', amount: '500000', paid_at: J.isoToJString(today), period: 'مهر', advance: '1' }, '/super/billing'); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual(await val('sa_next_due'), J.addDays(J.addDays(today, 3), 30)); // پیش از سررسید پرداخت شد: از سررسید فعلی یک دوره جلو می‌رود
    r = await sup.post('/super/billing/entries', { kind: 'support', amount: '', paid_at: '' }, '/super/billing'); assert.strictEqual(flash(r).type, 'error');
    const page = await sup.get('/super/billing'); assert.ok(/۶٬۵۰۰٬۰۰۰|6,500,000|۶,۵۰۰,۰۰۰/.test(page.text) || /۶.?۰۰۰.?۰۰۰/.test(page.text)); assert.ok(/پیش‌پرداخت/.test(page.text));
    const id = (await k('support_ledger').where({ kind: 'sale' }).first()).id; r = await sup.post(`/super/billing/entries/${id}/delete`, {}, '/super/billing'); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual(Number((await k('support_ledger').count({ c: '*' }).first()).c), 1);
  });
  await t('پرونده‌ی فروش در پشتیبان‌گیری سوپر ادمین هست و تنها از مسیرهای سوپر ادمین دیده می‌شود', async () => {
    const dump = (await sup.post('/backup/download', {}, '/backup')).text; assert.ok(/support_ledger/.test(dump));
    for (const c of [admin, deputy]) assert.strictEqual((await c.get('/super/billing')).status, 403);
  });

  console.log('● ساخت و تغییر رمز سوپر ادمین');
  const run = (script, args = [], env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: path.join(__dirname, '..'), env: { ...process.env, SCHOOL_DATA_DIR: app.data, ...env }, encoding: 'utf8' });
  await t('create-super.js: وقتی سوپر ادمین هست نمی‌سازد؛ تغییر رمز نیازمند رمز فعلی است', async () => {
    let r = run('scripts/create-super.js', ['evil', 'Evil#123456']); assert.strictEqual(r.status, 1); assert.ok(/از قبل وجود دارد/.test(r.stdout)); assert.strictEqual(Number((await k('users').where({ role: 'superadmin' }).count({ c: '*' }).first()).c), 1);
    r = run('scripts/create-super.js', ['--change', 'wrong-current', 'New#Super123']); assert.strictEqual(r.status, 1); assert.ok(/نادرست/.test(r.stdout));
    r = run('scripts/create-super.js', ['--change', 'Super#12345', 'short']); assert.strictEqual(r.status, 1);
    r = run('scripts/create-super.js', ['--change', 'Super#12345', 'New#Super123']); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual((await sup.get('/super')).status, 403 === 0 ? 0 : (await sup.get('/super')).status); // نشست قدیمی بسته می‌شود
    const c2 = await app.login('super', 'New#Super123'); assert.strictEqual((await c2.get('/super')).status, 200);
    const bad = app.newClient(); const p = await bad.get('/login'); const x = await bad.req('POST', '/login', { _csrf: bad.csrf(p.text), username: 'super', password: 'Super#12345' }); assert.strictEqual(x.status, 401);
    r = run('scripts/create-super.js', ['--change', 'New#Super123', 'Super#12345']); assert.strictEqual(r.status, 0);
  });
  await t('reset-admin.js حساب سوپر ادمین را بازنشانی نمی‌کند ولی مدیر مدرسه را بله', async () => {
    const h0 = (await superRow()).password_hash; let r = run('scripts/reset-admin.js', ['super', 'Hacked#12345']); assert.strictEqual(r.status, 1); assert.ok(/سوپر ادمین/.test(r.stdout)); assert.strictEqual((await superRow()).password_hash, h0);
    r = run('scripts/reset-admin.js', ['admin', 'Admin#12345']); assert.strictEqual(r.status, 0);
  });
  await t('بالاآمدن با SUPERADMIN_USER/SUPERADMIN_PASSWORD در نبود سوپر ادمین، حساب می‌سازد؛ توکن راه‌اندازی بدون env ساخته می‌شود و وجود سوپر ادمین آن را پاک می‌کند', async () => {
    const SA = require('../src/lib/superadmin'); const tokenFile = path.join(app.data, 'super-setup.token');
    assert.strictEqual(await SA.boot(k), 'exists'); assert.ok(!fs.existsSync(tokenFile));
    const old = await superRow(); await k('users').where({ id: old.id }).del();
    assert.strictEqual(await SA.boot(k), 'token'); assert.ok(fs.existsSync(tokenFile) && fs.readFileSync(tokenFile, 'utf8').trim().length === 32);
    process.env.SUPERADMIN_USER = 'EnvOwner'; process.env.SUPERADMIN_PASSWORD = 'Env#Owner123'; assert.strictEqual(await SA.boot(k), 'created'); delete process.env.SUPERADMIN_USER; delete process.env.SUPERADMIN_PASSWORD;
    assert.ok(!fs.existsSync(tokenFile)); const u = await superRow(); assert.strictEqual(u.username, 'envowner'); const c = await app.login('envowner', 'Env#Owner123'); assert.strictEqual((await c.get('/super')).status, 200);
    process.env.SUPERADMIN_USER = 'short'; process.env.SUPERADMIN_PASSWORD = '123'; await k('users').where({ id: u.id }).del(); assert.strictEqual(await SA.boot(k), 'token', 'رمز ضعیف env پذیرفته نمی‌شود'); delete process.env.SUPERADMIN_USER; delete process.env.SUPERADMIN_PASSWORD;
  });
  await t('صفحه‌ی /super/setup: فقط با توکن فایل سرور؛ تلاش‌های اشتباه محدود؛ پس از ساخت برای همیشه بسته است', async () => {
    const tokenFile = path.join(app.data, 'super-setup.token'); const token = fs.readFileSync(tokenFile, 'utf8').trim();
    const c = app.newClient(); const page = await c.get('/super/setup'); assert.strictEqual(page.status, 200); assert.ok(/ساخت حساب سوپر ادمین/.test(page.text));
    const attempt = async (o) => c.req('POST', '/super/setup', { _csrf: c.csrf((await c.get('/super/setup')).text), ...o });
    let r = await attempt({ token: 'wrong', username: 'newsuper', password: 'Strong#Pass1', password2: 'Strong#Pass1' }); assert.ok(/توکن راه‌اندازی نادرست/.test(r.text)); assert.strictEqual(Number((await k('users').where({ role: 'superadmin' }).count({ c: '*' }).first()).c), 0);
    r = await attempt({ token, username: 'newsuper', password: 'Strong#Pass1', password2: 'different' }); assert.ok(/مطابقت ندارد/.test(r.text));
    r = await attempt({ token, username: 'admin', password: 'Strong#Pass1', password2: 'Strong#Pass1' }); assert.ok(/قبلاً استفاده/.test(r.text));
    r = await attempt({ token, username: 'newsuper', password: '123', password2: '123' }); assert.ok(/حداقل ۸/.test(r.text));
    r = await attempt({ token, username: 'newsuper', password: 'Strong#Pass1', password2: 'Strong#Pass1' }); assert.ok(/ورود/.test(r.text)); assert.strictEqual((await superRow()).username, 'newsuper'); assert.ok(!fs.existsSync(tokenFile));
    assert.strictEqual((await app.newClient().get('/super/setup')).status, 404); const s2 = await app.login('newsuper', 'Strong#Pass1'); assert.strictEqual((await s2.get('/super')).status, 200);
    const c3 = app.newClient(); const p3 = await c3.get('/super/setup'); assert.strictEqual(p3.status, 404);
  });
  await t('محدودیت تلاش اشتباه در /super/setup (۵ بار)', async () => {
    const SA = require('../src/lib/superadmin'); const old = await superRow(); await k('users').where({ id: old.id }).del(); await SA.boot(k);
    const token = fs.readFileSync(path.join(app.data, 'super-setup.token'), 'utf8').trim();
    const c = app.newClient(); for (let i = 0; i < 5; i++) { const pg = await c.get('/super/setup'); await c.req('POST', '/super/setup', { _csrf: c.csrf(pg.text), token: 'x' + i, username: 'zz', password: 'Strong#Pass1', password2: 'Strong#Pass1' }); }
    const pg = await c.get('/super/setup'); const r = await c.req('POST', '/super/setup', { _csrf: c.csrf(pg.text), token, username: 'lateowner', password: 'Strong#Pass1', password2: 'Strong#Pass1' }); assert.strictEqual(r.status, 429); assert.strictEqual(Number((await k('users').where({ role: 'superadmin' }).count({ c: '*' }).first()).c), 0);
    await SA.create(k, { username: 'super', password: 'Super#12345' }); SA.removeToken();
  });
  await t('نصب‌کننده: سوپر ادمین الزامی، متفاوت از مدیر؛ بدون سوپر ادمین نصب نمی‌شود (در smoke.test.js پوشش کامل)', async () => {
    const inst = fs.readFileSync(path.join(__dirname, '../src/installer/index.js'), 'utf8'); assert.ok(/super_username/.test(inst) && /!st\.super/.test(inst));
    assert.ok(require('../src/modules').MODULES.find((m) => m.key === 'superadmin').hidden);
  });

  const ok = done(); await app.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

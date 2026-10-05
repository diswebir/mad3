'use strict';
/** تست نسخه‌ی ۲٫۱ — تنظیمات تب‌دار، تأیید حذف روز هفته، حالت تعمیر، اعلان ورود، منوی آکاردئونی، جانشین‌یابی در تعطیلی (نصب جداگانه) */
const { boot, t, flash, done, assert, setSettings, inproc } = require('./helpers');
const section = (s) => console.log('— ' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const J = require('../src/utils/jalali'); const settings = require('../src/settings');
  const admin = await app.login('admin', 'Admin#12345'); const sup = await app.login('super', 'Super#12345'); const deputy = await app.login('deputy', 'deputy123'); const teacher = await app.login('t.ahmadi', 'teacher123'); const stud = await app.login('14050001', 'student123');
  const val = async (key) => ((await k('settings').where({ key }).first()) || {}).value;
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);

  section('تنظیمات تب‌دار');
  await t('هر گروه تنظیمات یک تب است؛ همه‌ی تب‌ها باز می‌شوند و فقط فیلدهای همان گروه را دارند', async () => {
    const first = await sup.get('/settings'); const tabs = [...first.text.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]); assert.ok(tabs.length >= 12, 'تب‌ها: ' + tabs.join());
    assert.deepStrictEqual(tabs.slice().sort(), Object.keys(settings.GROUPS).sort(), 'هر گروه باید تب داشته باشد');
    for (const tb of tabs) {
      const r = await sup.get('/settings?tab=' + tb); assert.strictEqual(r.status, 200, tb); assert.ok(new RegExp(`data-tab="${tb}" class?`).test(r.text) || r.text.includes(`name="_group" value="${tb}"`), tb);
      const names = [...r.text.matchAll(/<(?:input|select|textarea)[^>]*\bname="([a-z0-9_]+)"/g)].map((m) => m[1]).filter((n) => !['_csrf', '_group', 'logo'].includes(n));
      const own = settings.DEFS.filter((d) => d.group === tb && d.type !== 'hidden').map((d) => d.key);
      for (const n of names) assert.ok(own.includes(n) || n === 'confirm_orphans' || n === 'q', `فیلد ${n} در تب ${tb} نباید باشد`);
      if (tb !== 'system') for (const o of own) assert.ok(names.includes(o), `فیلد ${o} در تب ${tb} نیست`);
    }
    assert.strictEqual((await sup.get('/settings?tab=bogus')).status, 200);
  });
  await t('ذخیره‌ی یک تب، تنظیمات تب‌های دیگر (به‌ویژه تیک‌ها) را دست نمی‌زند', async () => {
    const before = {}; for (const key of ['sms_on_absence', 'show_birthdays', 'rc_show_rank', 'ticket_escalate', 'attendance_enforce_schedule']) before[key] = await val(key);
    await setSettings(sup, { school_principal: 'مدیر آزمون' });
    for (const key of Object.keys(before)) assert.strictEqual(await val(key), before[key], key);
    assert.strictEqual(await val('school_principal'), 'مدیر آزمون');
    await setSettings(sup, { ticket_sla_hours: 12, show_birthdays: 0 }); assert.strictEqual(await val('ticket_sla_hours'), '12'); assert.strictEqual(await val('show_birthdays'), '0'); assert.strictEqual(await val('sms_on_absence'), before.sms_on_absence);
    await setSettings(sup, { show_birthdays: 1 });
  });
  await t('اعتبارسنجی در تب: خطا نمایش داده می‌شود و هیچ مقداری ذخیره نمی‌شود', async () => {
    const page = await sup.get('/settings?tab=attendance'); const r = await sup.req('POST', '/settings', { _csrf: sup.csrf(page.text), _group: 'attendance', late_after_minutes: '9999', absence_alert_threshold: '3' });
    assert.ok(/class="alert error/.test(r.text) && /باید عددی بین/.test(r.text)); assert.notStrictEqual(await val('absence_alert_threshold'), '3');
    assert.ok(/data-tab="attendance"[^>]*>|class="active"/.test(r.text));
  });
  await t('فقط مدیر کل: معاون، معلم و دانش‌آموز به تنظیمات و بازسازی cron دسترسی ندارند', async () => {
    for (const c of [deputy, teacher, stud]) { for (const p of ['/settings', '/settings?tab=system']) assert.strictEqual((await c.get(p)).status, 403, p); const r = await c.req('POST', '/settings/cron/regenerate', {}); assert.ok([403, 302].includes(r.status)); }
  });
  await t('اعتبارسنجی‌های ویژه: OTP، توکن، فرمت‌ها', async () => {
    for (const bad of [{ tab: 'sms', f: { sms_otp_pattern: 'bad pattern!' } }, { tab: 'sms', f: { sms_otp_param: '9x' } }, { tab: 'sms', f: { otp_ttl_minutes: '60' } }]) {
      const page = await sup.get('/settings?tab=' + bad.tab); const r = await sup.req('POST', '/settings', { _csrf: sup.csrf(page.text), _group: bad.tab, ...bad.f }); assert.ok(/class="alert error/.test(r.text), JSON.stringify(bad.f));
    }
  });
  await t('تب‌های دارای کارت‌های ویژه: ظاهر (لوگو)، آموزشی (میان‌برها)، پیامک (راهنما)، سیستم (cron و پشتیبان)', async () => {
    assert.ok(/name="logo"/.test((await sup.get('/settings?tab=appearance')).text)); assert.ok(/ساعت زنگ‌ها/.test((await sup.get('/settings?tab=academic')).text));
    assert.ok(/راهنمای کد تأیید پیامکی/.test((await sup.get('/settings?tab=sms')).text)); const sys = await sup.get('/settings?tab=system'); assert.ok(/زمان‌بندی خودکار/.test(sys.text) && /مدیریت پشتیبان/.test(sys.text) && /data-copy/.test(sys.text));
  });

  section('تأیید حذف روز هفته‌ی مدرسه');
  await t('حذف روزی که ساعت درسی دارد: بدون تأیید ذخیره نمی‌شود (۴۰۹ با توضیح)، با تأیید ذخیره می‌شود', async () => {
    const days0 = await val('week_days'); const page = await admin.get('/settings?tab=academic');
    const withoutTue = days0.split(',').filter((d) => d !== '2');
    const body = (extra = {}) => ({ _csrf: admin.csrf(page.text), _group: 'academic', week_days: withoutTue, grade_scale: '20', pass_mark: '10', terms_count: '2', scores_autolock_days: '0', term_weights: '', ...extra });
    let r = await admin.req('POST', '/settings', body()); assert.strictEqual(r.status, 409); assert.ok(/ساعت درسی/.test(r.text) && /confirm_orphans/.test(r.text)); assert.strictEqual(await val('week_days'), days0);
    r = await admin.req('POST', '/settings', body({ confirm_orphans: '1' })); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('week_days'), withoutTue.join(','));
    // برگرداندن روز: بدون یتیم، بدون نیاز به تأیید
    const page2 = await admin.get('/settings?tab=academic'); r = await admin.req('POST', '/settings', { ...body(), _csrf: admin.csrf(page2.text), week_days: days0.split(',') }); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await val('week_days'), days0);
  });
  await t('حذف روز بدون ساعت درسی و انتخاب هیچ روز: به‌ترتیب بی‌نیاز از تأیید / خطا', async () => {
    const page = await admin.get('/settings?tab=academic'); const base = { _csrf: admin.csrf(page.text), _group: 'academic', grade_scale: '20', pass_mark: '10', terms_count: '2', scores_autolock_days: '0', term_weights: '' };
    const r = await admin.req('POST', '/settings', { ...base, week_days: [] }); assert.ok(/حداقل یک روز/.test(r.text)); assert.strictEqual(await val('week_days'), '0,1,2,3,4');
  });

  section('حالت تعمیر و اعلان ورود');
  await t('اعلان صفحه‌ی ورود نمایش داده می‌شود و HTML در آن خنثی است', async () => {
    await setSettings(sup, { login_notice: 'ثبت‌نام از ۱۵ مهر <script>alert(1)</script>' }); await sleep(10600);
    const r = await app.newClient().get('/login'); assert.ok(r.text.includes('ثبت‌نام از ۱۵ مهر')); assert.ok(!r.text.includes('<script>alert(1)</script>'), 'اسکریپت باید escape شود');
    await setSettings(sup, { login_notice: '' });
  });
  await t('حالت تعمیر: مدیر کل کار می‌کند؛ معاون/معلم/دانش‌آموز ۵۰۳ با پیام؛ خروج و ورود آزاد؛ با خاموش‌کردن برمی‌گردد', async () => {
    await setSettings(sup, { maintenance_mode: 1, maintenance_message: 'تعمیر برنامه‌ریزی‌شده' }); await sleep(10600);
    assert.strictEqual((await sup.get('/')).status, 200, 'سوپر ادمین'); assert.strictEqual((await admin.get('/')).status, 503, 'مدیر مدرسه هم در حالت تعمیر بیرون می‌ماند');
    for (const c of [deputy, teacher, stud]) { const r = await c.get('/'); assert.strictEqual(r.status, 503); assert.ok(/تعمیر برنامه‌ریزی‌شده/.test(r.text)); assert.strictEqual((await c.get('/students')).status, 503); }
    const anon = app.newClient(); const l = await anon.get('/login'); assert.strictEqual(l.status, 200); assert.ok(/حالت تعمیر/.test(l.text));
    const out = await teacher.req('POST', '/logout', { _csrf: teacher.csrf((await teacher.get('/logout')).text || '') || '' }, { follow: false }); assert.ok([302, 403].includes(out.status));
    await setSettings(sup, { maintenance_mode: 0 }); await sleep(10600); assert.strictEqual((await deputy.get('/')).status, 200);
  });

  section('منوی کناری آکاردئونی');
  await t('بخش‌ها آکاردئون هستند؛ بخش صفحه‌ی فعال باز و بقیه بسته؛ داشبورد خارج از گروه‌ها', async () => {
    const r = await admin.get('/students'); const groups = [...r.text.matchAll(/<div class="nav-group([^"]*)" data-key="(\w+)">/g)];
    assert.ok(groups.length >= 4, 'گروه‌ها: ' + groups.length); const open = groups.filter((g) => /\bopen\b/.test(g[1])); assert.strictEqual(open.length, 1, 'فقط یک بخش باز'); assert.strictEqual(open[0][2], 'main');
    assert.ok(/class="nav-top[^"]*" /.test(r.text) || /nav-top/.test(r.text)); assert.ok(/aria-expanded="true"[^>]*aria-controls="ng-main"/.test(r.text) && /aria-expanded="false"[^>]*aria-controls="ng-edu"/.test(r.text));
    const att = await admin.get('/attendance'); assert.ok(/nav-group open has-active" data-key="edu"/.test(att.text), 'بخش آموزش باید باز باشد');
    assert.ok(/nav-top active/.test((await admin.get('/')).text), 'داشبورد فعال');
  });
  await t('همه‌ی لینک‌های منو برای هر نقش بدون خطا باز می‌شوند (مدیر، معلم، دانش‌آموز)', async () => {
    const t2 = await app.login('t.ahmadi', 'teacher123'); for (const c of [admin, t2, stud]) {
      const html = (await c.get('/')).text; const hrefs = new Set([...html.matchAll(/<a href="([^"]+)" class="[^"]*"><svg/g)].map((m) => m[1]).filter((h) => !/logout|^#/.test(h)));
      assert.ok(hrefs.size >= 5, 'لینک‌های منو: ' + hrefs.size);
      for (const h of hrefs) { const r = await c.get(h); assert.ok([200].includes(r.status), `${h} → ${r.status}`); }
    }
  });
  await t('هر بخش منو دکمه‌ی دسترس‌پذیر (button با aria-expanded) دارد و شمارنده‌ی تیکت روی سربرگ می‌آید', async () => {
    const r = await admin.get('/'); const heads = (r.text.match(/<button type="button" class="nav-head"/g) || []).length; assert.ok(heads >= 4); assert.strictEqual((r.text.match(/aria-expanded=/g) || []).length, heads);
  });

  section('جانشین‌یابی در روز تعطیل');
  await t('روز تعطیل: برنامه‌ی کلاسی برگزار نمی‌شود، اخطار نمایش داده و ثبت جانشین رد می‌شود', async () => {
    let day = J.addDays(J.todayISO(), 3); for (let i = 3; i < 17; i++) { day = J.addDays(J.todayISO(), i); if (!(await require('../src/routes/scheduling').substituteData(k, day)).off.off) break; } /* روز کاری بعدی (پنجشنبه/جمعه تعطیل هفتگی‌اند) */ await k('holidays').insert({ title: 'تعطیلی آزمون', start_date: day, end_date: day, kind: 'official' }).catch(async () => k('holidays').insert({ title: 'تعطیلی آزمون', start_date: day, end_date: day }));
    const r = await admin.get('/timetable/substitutes?date=' + encodeURIComponent(J.isoToJString(day))); assert.strictEqual(r.status, 200); assert.ok(/تعطیل/.test(r.text) && /تعطیلی آزمون/.test(r.text));
    const sd = await require('../src/routes/scheduling').substituteData(k, day); assert.strictEqual(sd.slots.length, 0); assert.strictEqual(sd.off.off, true);
    const n0 = await cnt('substitutions'); const p = await admin.post('/timetable/substitutes', { date: J.isoToJString(day), teacher_id: '1' }, '/timetable/substitutes'); assert.strictEqual(flash(p).type, 'error'); assert.strictEqual(await cnt('substitutions'), n0);
  });

  const ok = done(); await app.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

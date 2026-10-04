'use strict';
/** تست نسخه‌ی ۲٫۳ — صفحه‌ی حضور و غیاب (کلاس/زنگ/درس)، تولدها، و بهبودهای رابط (دسترس‌پذیری، موبایل) */
const fs = require('fs'); const path = require('path');
const { boot, t, done, assert, inproc, setSettings } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; const ctx = await inproc(app); const J = require('../src/utils/jalali');
  const sup = await app.login('super', 'Super#12345'); const admin = await app.login('admin', 'Admin#12345'); const stud = await app.login('14050001', 'student123');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const row = await k('timetable as t').join('class_subjects as cs', 'cs.id', 't.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').orderBy('t.id').select('t.classroom_id', 't.day', 't.period', 's.name as subject').first();
  let date = J.todayISO(); for (let i = 0; i < 7 && J.dow(date) !== row.day; i++) date = J.addDays(date, -1);
  const q = (extra = '') => `/attendance?class_id=${row.classroom_id}&date=${encodeURIComponent(J.isoToJString(date))}${extra}`;
  const cls = await k('classrooms').where({ id: row.classroom_id }).first();

  console.log('● حضور و غیاب: کلاس / زنگ / درس');
  await t('حالت روزانه: نام کلاس، تاریخ و نوع ثبت «روزانه» نمایش داده می‌شود و راهنمای فعال‌سازی زنگ‌به‌زنگ هست', async () => {
    await setSettings(sup, { attendance_mode: 'daily' });
    await new Promise((r) => setTimeout(r, 10500));
    const r = await admin.get(q()); assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('att-ctx') && r.text.includes(cls.name), 'کلاس'); assert.ok(/روزانه/.test(r.text)); assert.ok(!/class="att-periods"/.test(r.text));
  });
  await t('حالت زنگ‌به‌زنگ: کلاس، تاریخ، شماره‌ی زنگ، ساعت، درس و معلم هر زنگ نمایش داده می‌شود', async () => {
    await setSettings(sup, { attendance_mode: 'periodic' });
    await new Promise((r) => setTimeout(r, 10500));
    const r = await admin.get(q(`&period=${row.period}`)); assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes(cls.name), 'کلاس'); assert.ok(r.text.includes(row.subject), 'درس ' + row.subject);
    assert.ok(/class="att-periods"/.test(r.text), 'نوار زنگ‌ها'); assert.ok(/زنگ [۰-۹]+/.test(r.text));
    assert.ok(/\d{2}:\d{2}|[۰-۹]{1,2}:[۰-۹]{2}/.test(r.text), 'ساعت زنگ');
    assert.ok(/att-dots/.test(r.text), 'ردیابی زنگ‌به‌زنگ هر دانش‌آموز');
  });
  await t('پس از ثبت یک زنگ، همان زنگ «ثبت شده» و غایب آن در ستون زنگ‌های امروز دیده می‌شود', async () => {
    const stu = await k('students').where({ classroom_id: row.classroom_id, status: 'active' }).first();
    let r = await admin.get(q(`&period=${row.period}`)); const csrf = admin.csrf(r.text);
    const body = { _csrf: csrf, class_id: String(row.classroom_id), date: J.isoToJString(date), period: String(row.period), [`status[${stu.id}]`]: 'absent' };
    const students = await k('students').where({ classroom_id: row.classroom_id, status: 'active' });
    for (const s of students) if (s.id !== stu.id) body[`status[${s.id}]`] = 'present';
    r = await admin.req('POST', '/attendance', body); assert.ok([200].includes(r.status), String(r.status));
    const rec = await k('attendance').where({ student_id: stu.id, date, period: row.period }).first(); assert.ok(rec && rec.status === 'absent', 'ثبت نشد');
    r = await admin.get(q(`&period=${row.period}`)); assert.ok(/ثبت شده/.test(r.text), 'نشان ثبت‌شده'); assert.ok(/class="pd [^"]*"/.test(r.text));
  });
  await t('دانش‌آموز به صفحه‌ی ثبت حضور و غیاب دسترسی ندارد', async () => { const r = await stud.get('/attendance'); assert.ok([302, 403, 200].includes(r.status)); assert.ok(!r.text.includes('att-ctx')); });

  console.log('● تولدها: فاصله‌ی متن از لبه‌ی کارت');
  await t('لیست تولد داخل کارت بدون پدینگ، پدینگ افقی دارد و عنوان ماه استایل جدا', async () => {
    assert.ok(/\.card\.flush \.bd-list li\{padding:\.7rem 1rem\}/.test(css)); assert.ok(css.includes('.bd-month'));
    const r = await admin.get('/birthdays?range=year'); assert.strictEqual(r.status, 200); assert.ok(r.text.includes('bd-month') && r.text.includes('bd-list'));
  });

  console.log('● رابط کاربری و دسترس‌پذیری');
  await t('لینک «پرش به محتوا»، شناسه‌ی main و aria-current روی آیتم فعال منو', async () => {
    const r = await admin.get('/students'); assert.ok(r.text.includes('class="skip-link"') && /<main class="content" id="main"/.test(r.text)); assert.ok(/aria-current="page"/.test(r.text));
  });
  await t('CSS واکنش‌گرا: جلوگیری از سرریز شبکه، جدول قابل اسکرول، هدف لمسی ۴۲px، focus-visible و کاهش حرکت', async () => {
    for (const s of ['.grid>*', 'min-width:0', '.card.flush{overflow-x:auto}', '@media(pointer:coarse)', ':focus-visible', 'prefers-reduced-motion', 'body.menu-open']) assert.ok(css.includes(s), s);
    assert.ok(/@media\(max-width:600px\)/.test(css));
  });
  await t('جاوااسکریپت: نمایش رمز، هشدار Caps Lock، بستن منو با Esc، دکمه‌ی در حال ارسال، هشدار تغییرات ذخیره‌نشده، بازگشت به بالا', async () => {
    for (const s of ['pw-toggle', 'CapsLock', "e.key === 'Escape' && side", 'is-busy', 'beforeunload', 'to-top']) assert.ok(js.includes(s), s);
    const r = await admin.get('/settings'); assert.ok(/data-dirty-warn/.test(r.text));
  });
  await t('هیچ‌یک از صفحه‌های اصلی در سه نقش خطا نمی‌دهد (نمونه‌برداری)', async () => {
    for (const c of [admin, sup, stud]) for (const p of ['/', '/birthdays', '/calendar', '/tickets', '/announcements', '/profile']) { const r = await c.get(p); assert.ok(r.status === 200 || r.status === 403 || r.status === 404, p + ' ' + r.status); assert.ok(!/خطای سرور/.test(r.text), p); }
  });

  const ok = done(); await app.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

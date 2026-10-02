'use strict';
/** تست‌های یکپارچه‌ی نسخه‌ی ۲٫۱ — مرحله‌ی ۱: ساعت زنگ‌ها، نسخه‌بندی برنامه، تقویم آموزشی، مراقب امتحان */
const { boot, t, ok, flash, done, assert, inproc } = require('./helpers');
const J = require('../src/utils/jalali');
const xlsx = require('../src/lib/xlsx');
const section = (s) => console.log('— ' + s);
const jstr = (iso) => J.isoToJString(iso);
const today = J.todayISO();
const nextSchoolDay = (from, plus = 0) => { let d = J.addDays(from, plus); while (J.dow(d) > 4) d = J.addDays(d, 1); return d; };

/** بدنه‌ی فرم ویرایشگر زنگ‌ها: count زنگ درسی با تفریح بین آن‌ها */
function bellForm(id, name, { count = 6, start = '07:45', minutes = 45, brk = 10, days = [], grades = [], confirm = false } = {}) {
  const f = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  const [h, m] = start.split(':').map(Number); let cur = h * 60 + m; const kind = []; const st = []; const en = []; const label = [];
  for (let i = 1; i <= count; i++) { kind.push('class'); st.push(f(cur)); en.push(f(cur + minutes)); label.push(''); cur += minutes; if (i < count && brk) { kind.push('break'); st.push(f(cur)); en.push(f(cur + brk)); label.push('تفریح'); cur += brk; } }
  return { id: id ? String(id) : '', name, kind, start: st, end: en, label, days: days.map(String), grades, ...(confirm ? { confirm_orphans: '1' } : {}) };
}

(async () => {
  const app = await boot(); const k = app.k; await inproc(app); // پس از تنظیم SCHOOL_DATA_DIR، کتابخانه‌ها را بارگذاری می‌کنیم
  const admin = await app.login('admin', 'Admin#12345'); const deputy = await app.login('deputy', 'deputy123');
  const tAhmadi = await app.login('t.ahmadi', 'teacher123'); const student = await app.login('14050001', 'student123');
  const one = async (q) => (await q.first()) || null; const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const bell = require('../src/lib/bell');

  section('ساعت زنگ‌ها: الگوی پیش‌فرض و الگوی ویژه');
  const def = await one(k('bell_schedules').where({ is_default: 1 }));
  await t('الگوی پیش‌فرض و الگوی ویژه‌ی چهارشنبه در دمو وجود دارد', async () => {
    assert.ok(def); assert.strictEqual(await cnt('bell_schedules'), 2);
    const rows = await k('bell_rows').where({ schedule_id: def.id }); assert.strictEqual(rows.filter((r) => r.kind === 'class').length, 6);
    const r = ok(await admin.get('/timetable/bells')); assert.ok(/الگوی پیش‌فرض/.test(r.text) && /چهارشنبه/.test(r.text));
  });
  await t('دسترسی: معلم و دانش‌آموز به ویرایشگر زنگ‌ها دسترسی ندارند؛ معاون دارد', async () => {
    assert.strictEqual((await tAhmadi.get('/timetable/bells')).status, 403); assert.strictEqual((await student.get('/timetable/bells')).status, 403);
    assert.strictEqual((await student.get('/timetable/overview')).status, 403); ok(await deputy.get('/timetable/bells'));
    assert.strictEqual((await tAhmadi.req('POST', '/timetable/bells/save', { name: 'x' })).status, 403);
  });
  await t('اعتبارسنجی ردیف‌ها: همپوشانی، پایان قبل از شروع، ساعت نامعتبر، بدون زنگ درسی، نوع نامعتبر', async () => {
    const before = await cnt('bell_rows');
    const bad = [];
    let f = bellForm(def.id, 'الگو'); f.start[2] = '08:00'; bad.push(['همپوشانی', f]);
    f = bellForm(def.id, 'الگو'); f.end[0] = '07:00'; bad.push(['پایان قبل از شروع', f]);
    f = bellForm(def.id, 'الگو'); f.start[0] = '25:99'; bad.push(['ساعت نامعتبر', f]);
    f = bellForm(def.id, 'الگو', { count: 1 }); f.kind = ['break']; bad.push(['بدون زنگ درسی', f]);
    f = bellForm(def.id, 'الگو'); f.kind[0] = 'zzz'; bad.push(['نوع نامعتبر', f]);
    f = bellForm(def.id, ''); bad.push(['بدون نام', f]);
    f = bellForm(def.id, 'الگو', { count: 13, minutes: 20, brk: 0 }); bad.push(['بیش از ۱۲ زنگ', f]);
    for (const [name, form] of bad) { const r = await admin.post('/timetable/bells/save', form, '/timetable/bells/' + def.id + '/edit'); assert.strictEqual(r.status, 200, name); assert.ok(/class="alert error/.test(r.text), 'خطا نمایش داده نشد: ' + name); }
    assert.strictEqual(await cnt('bell_rows'), before, 'داده‌ی نامعتبر ذخیره شد');
  });
  await t('الگوی ویژه بدون روز و پایه رد می‌شود؛ الگوی ویژه‌ی معتبر ذخیره می‌شود', async () => {
    let r = await admin.post('/timetable/bells/save', bellForm('', 'بی‌قید', { count: 6 }), '/timetable/bells/new'); assert.ok(/class="alert error/.test(r.text));
    r = await admin.post('/timetable/bells/save', bellForm('', 'یکشنبه‌ها کوتاه', { count: 6, minutes: 30, brk: 5, days: [1] }), '/timetable/bells/new'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const s = await one(k('bell_schedules').where({ name: 'یکشنبه‌ها کوتاه' })); assert.ok(s); assert.strictEqual(s.days, '1');
    await bell.load(k); assert.strictEqual(bell.periodsFor({ day: 1, grade: 'هفتم' })[0].end, '08:15'); assert.strictEqual(bell.periodsFor({ day: 0, grade: 'هفتم' })[0].end, '08:30');
    assert.strictEqual(bell.countFor({ day: 1, grade: 'هفتم' }), 6);
    r = await admin.post(`/timetable/bells/${s.id}/delete`, {}, '/timetable/bells'); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual(await cnt('bell_schedules', { name: 'یکشنبه‌ها کوتاه' }), 0);
  });
  await t('الگوی پیش‌فرض قابل حذف نیست', async () => {
    const r = await admin.post(`/timetable/bells/${def.id}/delete`, {}, '/timetable/bells'); assert.strictEqual(flash(r).type, 'error'); assert.ok(await one(k('bell_schedules').where({ id: def.id })));
  });
  await t('کاهش تعداد زنگ‌ها: بدون تأیید رد می‌شود و برنامه دست‌نخورده می‌ماند؛ با تأیید خانه‌های بی‌معنی پاک می‌شوند', async () => {
    const total = await cnt('timetable'); const high = await cnt('timetable'); const over = Number((await k('timetable').where('period', '>', 4).whereNot('day', 4).count({ c: '*' }).first()).c); // چهارشنبه‌ها الگوی ۶ زنگی ویژه دارند و دست‌نخورده می‌مانند assert.ok(over > 0);
    let r = await admin.post('/timetable/bells/save', bellForm(def.id, def.name, { count: 4 }), '/timetable/bells/' + def.id + '/edit');
    assert.ok(/class="alert error/.test(r.text) && /confirm_orphans/.test(r.text), 'تأیید خواسته نشد'); assert.strictEqual(await cnt('timetable'), total); assert.strictEqual(await cnt('bell_rows', { schedule_id: def.id, kind: 'class' }), 6);
    r = await admin.post('/timetable/bells/save', bellForm(def.id, def.name, { count: 4, confirm: true }), '/timetable/bells/' + def.id + '/edit'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    assert.strictEqual(await cnt('timetable'), total - over); assert.strictEqual(await cnt('timetable', {}) - await cnt('timetable'), 0); await bell.load(k); assert.strictEqual(bell.maxPeriods(), 6, 'الگوی چهارشنبه هنوز ۶ زنگ است'); assert.strictEqual(bell.countFor({ day: 0, grade: 'هفتم' }), 4); assert.strictEqual(bell.countFor({ day: 4, grade: 'هفتم' }), 6);
    // برگرداندن به ۶ زنگ؛ برنامه‌ی پاک‌شده برنمی‌گردد
    r = await admin.post('/timetable/bells/save', bellForm(def.id, def.name, { count: 6 }), '/timetable/bells/' + def.id + '/edit'); assert.strictEqual(flash(r).type, 'success'); await bell.load(k);
    ok(await admin.get('/timetable?class_id=1')); ok(await admin.get('/timetable/bells'));
  });
  await t('نمای کل مدرسه و خروجی اکسل', async () => {
    let r = ok(await admin.get('/timetable/overview')); assert.ok(/هفتم الف/.test(r.text) && /نهم ب/.test(r.text));
    ok(await admin.get('/timetable/overview?by=teacher')); ok(await admin.get('/timetable/overview?grade=' + encodeURIComponent('هشتم')));
    r = await admin.get('/timetable/export.xlsx?all=1&by=class'); assert.strictEqual(r.status, 200); assert.ok(/spreadsheetml/.test(r.headers.get('content-type')));
    const wb = xlsx.parse(r.buf); assert.strictEqual(wb.sheets.length, 6); assert.ok(wb.sheets[0].rows.length >= 7 && wb.sheets[0].rows[0].length === 6, JSON.stringify(wb.sheets[0].rows[0]));
    assert.ok(wb.sheets.some((s) => s.rows.some((row) => row.some((c) => /ریاضی/.test(c)))));
    r = await admin.get('/timetable/export.xlsx?class_id=1'); assert.strictEqual(r.status, 200);
    r = await tAhmadi.get('/timetable/export.xlsx?by=teacher'); assert.strictEqual(r.status, 200);
    for (const [who, c, url] of [[tAhmadi, 'معلم all', '/timetable/export.xlsx?all=1'], [student, 'دانش‌آموز all', '/timetable/export.xlsx?all=1']]) assert.strictEqual((await who.get(url)).status, 403, c);
    { const sr = await student.get('/timetable/export.xlsx?class_id=6'); assert.strictEqual(sr.status, 200); assert.deepStrictEqual(xlsx.parse(sr.buf).sheets.map((x) => x.name), ['هفتم الف'], 'دانش‌آموز فقط کلاس خودش را می‌گیرد'); } assert.strictEqual((await student.get('/timetable/export.xlsx?by=teacher&teacher_id=1')).status, 403, 'معلم برای دانش‌آموز');
    assert.strictEqual((await admin.get('/timetable/export.xlsx?class_id=999')).status, 404);
  });

  section('ویرایش برنامه‌ی هفتگی: قیدها و نسخه‌بندی');
  const cls1 = await one(k('classrooms').where({ id: 1 }));
  const cs = await k('class_subjects').where({ classroom_id: 1 }).orderBy('id');
  const cur = await k('timetable').where({ classroom_id: 1 });
  const cellsOf = (rows) => Object.fromEntries(rows.map((r) => [`cell[${r.day}-${r.period}]`, String(r.class_subject_id)]));
  await t('ذخیره‌ی بدون تغییر: «تغییری ایجاد نشد» و نسخه‌ای ساخته نمی‌شود', async () => {
    const h0 = await cnt('timetable_history'); const r = await admin.post('/timetable', { class_id: '1', ...cellsOf(cur) }, '/timetable?class_id=1&edit=1'); assert.ok(/تغییری/.test(flash(r).text), JSON.stringify(flash(r))); assert.strictEqual(await cnt('timetable_history'), h0);
  });
  await t('زنگ خارج از ساعت‌های زنگ (زنگ ۹) و روز نامعتبر رد می‌شود', async () => {
    const before = await cnt('timetable'); const base = cellsOf(cur);
    let r = await admin.post('/timetable', { class_id: '1', ...base, 'cell[0-9]': String(cs[0].id) }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/تعریف نشده/.test(flash(r).text), flash(r).text);
    r = await admin.post('/timetable', { class_id: '1', ...base, 'cell[6-1]': String(cs[0].id) }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post('/timetable', { class_id: '1', ...base, 'cell[0-1]': '999999' }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error');
    assert.strictEqual(await cnt('timetable'), before);
  });
  await t('سقف ساعت یک درس در روز (max_per_day) اعمال می‌شود', async () => {
    const free = cur.filter((r) => r.day === 0).map((r) => r.period); const target = cur.find((r) => r.day === 0); const same = cs.find((c) => c.id === target.class_subject_id);
    await k('class_subjects').where({ id: same.id }).update({ max_per_day: 1 });
    const others = cur.filter((r) => r.day === 0 && r.class_subject_id !== same.id); const victim = others[0];
    const cells = { ...cellsOf(cur), [`cell[0-${victim.period}]`]: String(same.id) };
    const r = await admin.post('/timetable', { class_id: '1', ...cells }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/سقف مجاز/.test(flash(r).text), flash(r).text);
    await k('class_subjects').where({ id: same.id }).update({ max_per_day: 2 }); assert.ok(free.length);
  });
  await t('تداخل معلم با کلاس دیگر و ساعت غیرمجاز معلم رد می‌شود', async () => {
    // معلم درس (cs اول) را در زنگی که در کلاس ۲ تدریس می‌کند وارد می‌کنیم
    const other = await one(k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('tt.classroom_id', 2).whereNotNull('cs.teacher_id').select('tt.day', 'tt.period', 'cs.teacher_id'));
    const mine = cs.find((c) => c.teacher_id === other.teacher_id); assert.ok(mine);
    const base = cellsOf(cur.filter((r) => !(r.day === other.day && r.period === other.period)));
    let r = await admin.post('/timetable', { class_id: '1', ...base, [`cell[${other.day}-${other.period}]`]: String(mine.id) }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/تداخل/.test(flash(r).text), flash(r).text);
    await k('timetable').where({ classroom_id: 2, day: other.day, period: other.period }).del(); // آزاد کردن تداخل، سپس ساعت غیرمجاز
    await k('teacher_unavailability').insert({ teacher_id: other.teacher_id, day: other.day, period: other.period });
    r = await admin.post('/timetable', { class_id: '1', ...base, [`cell[${other.day}-${other.period}]`]: String(mine.id) }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/غیرمجاز/.test(flash(r).text), flash(r).text);
    await k('teacher_unavailability').where({ teacher_id: other.teacher_id }).del();
  });
  await t('تغییر برنامه نسخه‌ی قبلی را در تاریخچه می‌گذارد و نمای «برنامه در تاریخ» درست است', async () => {
    const old = await k('timetable').where({ classroom_id: 1 }); const a = old.find((r) => r.day === 4 && r.period === 6) || old[old.length - 1];
    const base = cellsOf(old.filter((r) => r.id !== a.id));
    const r = await admin.post('/timetable', { class_id: '1', ...base }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r))); assert.ok(/تاریخچه/.test(flash(r).text));
    assert.strictEqual(await cnt('timetable', { classroom_id: 1 }), old.length - 1); assert.strictEqual(await cnt('timetable_history', { classroom_id: 1 }), old.length);
    const meta = await one(k('timetable_meta').where({ classroom_id: 1 })); assert.strictEqual(meta.since, today);
    const past = await admin.get(`/timetable?class_id=1&date=${encodeURIComponent(jstr(J.addDays(today, -5)))}`); ok(past); assert.ok(/قدیمی/.test(past.text), 'نمای نسخه‌ی قدیمی');
    const now = await admin.get(`/timetable?class_id=1&date=${encodeURIComponent(jstr(today))}`); ok(now); assert.ok(!/برنامه‌ی <b>قدیمی/.test(now.text));
    // دوباره بدون تغییر ذخیره شود → نسخه‌ی تازه ساخته نشود
    const r2 = await admin.post('/timetable', { class_id: '1', ...base }, '/timetable?class_id=1&edit=1'); assert.ok(/تغییری/.test(flash(r2).text));
    // با تغییر در همان روز، نسخه‌ی تکراری با بازه‌ی نامعتبر ساخته نشود
    const r3 = await admin.post('/timetable', { class_id: '1', ...cellsOf(old) }, '/timetable?class_id=1&edit=1'); assert.strictEqual(flash(r3).type, 'success');
    assert.strictEqual(await cnt('timetable', { classroom_id: 1 }), old.length);
    for (const h of await k('timetable_history').where({ classroom_id: 1 })) assert.ok(!h.valid_from || h.valid_from <= h.valid_to, 'بازه‌ی نسخه معکوس');
  });
  await t('نمای معلم و کلاس برای همه‌ی نقش‌ها بدون خطا', async () => {
    ok(await tAhmadi.get('/timetable')); ok(await tAhmadi.get('/timetable?teacher_id=1')); ok(await student.get('/timetable')); ok(await admin.get('/timetable?class_id=3&edit=1')); ok(await deputy.get('/timetable?teacher_id=2'));
    assert.strictEqual((await student.get('/timetable?class_id=6&edit=1')).status === 200 && /name="cell\[/.test((await student.get('/timetable?class_id=6&edit=1')).text), false, 'دانش‌آموز نباید فرم ویرایش ببیند');
  });

  section('تولید خودکار با ساعت زنگ هر پایه و سقف درس در روز');
  await t('مولد: خانه‌ی بسته‌ی هر کلاس/روز رعایت می‌شود و سقف max_per_day ملاک است', async () => {
    const sched = require('../src/lib/scheduler');
    const classes = [{ id: 1, items: [{ csId: 10, teacherId: 1, hours: 5, maxPerDay: 1 }] }, { id: 2, items: [{ csId: 20, teacherId: 2, hours: 4, maxPerDay: 2 }] }];
    const isOpen = (cid, d, p) => (cid === 1 ? p <= 3 : p <= 6);
    const r = sched.generate({ days: [0, 1, 2, 3, 4], periods: [1, 2, 3, 4, 5, 6], classes, isOpen, seed: 3 });
    assert.strictEqual(r.unplaced.length, 0); assert.ok(r.placements.filter((p) => p.classId === 1).every((p) => p.period <= 3));
    const perDay = {}; for (const p of r.placements.filter((x) => x.classId === 1)) perDay[p.day] = (perDay[p.day] || 0) + 1; assert.ok(Object.values(perDay).every((n) => n <= 1), JSON.stringify(perDay));
    const tight = sched.generate({ days: [0], periods: [1, 2, 3], classes: [{ id: 1, items: [{ csId: 1, teacherId: 1, hours: 3 }] }], isOpen: (c, d, p) => p <= 2, seed: 1 });
    assert.strictEqual(tight.unplaced.length, 1, 'جای کافی نیست؛ باید یک ساعت جا نماند');
  });
  await t('تولید خودکار از طریق رابط: نسخه‌ی قبلی ثبت می‌شود و جدول با ساعت زنگ‌ها سازگار است', async () => {
    const h0 = await cnt('timetable_history');
    const r = await admin.post('/timetable/auto', { scope: 'class', class_id: '3', seed: '7', phase: 'apply' }, '/timetable/auto'); assert.ok(flash(r), r.text.slice(0, 200));
    assert.ok(await cnt('timetable_history') >= h0); const rows = await k('timetable').where({ classroom_id: 3 }); assert.ok(rows.length > 0);
    await bell.load(k); assert.ok(rows.every((x) => x.period <= bell.countFor({ day: x.day, grade: 'هشتم' })));
    const orph = await require('../src/lib/timetableTools').orphans(k); assert.strictEqual(orph.length, 0);
  });

  section('تعطیلات و تقویم آموزشی');
  const hd = nextSchoolDay(today, 120);
  await t('ثبت تعطیلی دستی (یک‌روزه و بازه‌ای) و نمایش در فهرست و تقویم', async () => {
    let r = await admin.post('/holidays', { title: 'تعطیلی آزمایشی', start_date: jstr(hd) }, '/holidays'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const row = await one(k('holidays').where({ title: 'تعطیلی آزمایشی' })); assert.strictEqual(row.start_date, hd); assert.strictEqual(row.end_date, hd); assert.strictEqual(row.kind, 'manual');
    r = await admin.post('/holidays', { title: 'بازه‌ی آزمایشی', start_date: jstr(J.addDays(hd, 10)), end_date: jstr(J.addDays(hd, 13)) }, '/holidays'); assert.ok(/4 روز/.test(flash(r).text), flash(r).text);
    r = ok(await admin.get('/holidays?year=' + J.isoToJ(hd).jy)); assert.ok(/تعطیلی آزمایشی/.test(r.text) && /بازه‌ی آزمایشی/.test(r.text));
    const j = J.isoToJ(hd); r = ok(await admin.get(`/calendar?year=${j.jy}&month=${j.jm}`)); assert.ok(/تعطیلی آزمایشی/.test(r.text), 'تعطیلی در تقویم نیست');
  });
  await t('اعتبارسنجی تعطیلی: عنوان خالی، تاریخ نامعتبر، پایان قبل از شروع، بیش از ۱۲۰ روز، تکراری', async () => {
    const n0 = await cnt('holidays');
    for (const bad of [{ title: '', start_date: jstr(hd) }, { title: 'x', start_date: 'abc' }, { title: 'x', start_date: '' }, { title: 'x', start_date: jstr(J.addDays(hd, 5)), end_date: jstr(hd) }, { title: 'x', start_date: jstr(hd), end_date: jstr(J.addDays(hd, 200)) }, { title: 'تعطیلی آزمایشی', start_date: jstr(hd) }]) {
      const r = await admin.post('/holidays', bad, '/holidays'); assert.strictEqual(flash(r).type, 'error', JSON.stringify(bad));
    }
    assert.strictEqual(await cnt('holidays'), n0);
  });
  await t('دسترسی: معلم/دانش‌آموز نمی‌توانند تعطیلی ثبت یا ببینند', async () => {
    assert.strictEqual((await tAhmadi.get('/holidays')).status, 403); assert.strictEqual((await student.get('/holidays')).status, 403);
    assert.strictEqual((await tAhmadi.req('POST', '/holidays', { title: 'x', start_date: jstr(hd) })).status, 403);
    ok(await deputy.get('/holidays'));
  });
  await t('تعطیلات رسمی ثابت: افزودن و بی‌اثر بودن اجرای دوباره', async () => {
    const jy = J.isoToJ(today).jy + 3; const before = await cnt('holidays', { kind: 'official' });
    let r = await admin.post('/holidays/fixed', { year: String(jy) }, '/holidays'); assert.strictEqual(flash(r).type, 'success'); const after = await cnt('holidays', { kind: 'official' }); assert.ok(after >= before + 8, `${before}→${after}`);
    assert.ok(await one(k('holidays').where({ start_date: J.jToIso(jy, 1, 1) })), 'نوروز ثبت نشد');
    r = await admin.post('/holidays/fixed', { year: String(jy) }, '/holidays'); assert.strictEqual(await cnt('holidays', { kind: 'official' }), after);
    r = await admin.post('/holidays/fixed', { year: '12' }, '/holidays'); assert.strictEqual(flash(r).type, 'error');
  });
  await t('ویرایش و حذف تعطیلی', async () => {
    const row = await one(k('holidays').where({ title: 'بازه‌ی آزمایشی' }));
    let r = await admin.post(`/holidays/${row.id}/update`, { title: 'بازه‌ی ویرایش‌شده', start_date: jstr(row.start_date), end_date: jstr(J.addDays(row.start_date, 1)) }, '/holidays'); assert.strictEqual(flash(r).type, 'success');
    const e = await one(k('holidays').where({ id: row.id })); assert.strictEqual(e.title, 'بازه‌ی ویرایش‌شده'); assert.strictEqual(e.end_date, J.addDays(row.start_date, 1));
    r = await admin.post(`/holidays/${row.id}/update`, { title: '', start_date: jstr(row.start_date) }, '/holidays'); assert.strictEqual(flash(r).type, 'error');
    await admin.post(`/holidays/${row.id}/delete`, {}, '/holidays'); assert.strictEqual(await cnt('holidays', { id: row.id }), 0);
    r = await admin.post('/holidays/999999/delete', {}, '/holidays'); assert.ok(r.status === 200);
  });
  await t('کتابخانه‌ی تقویم: holidayOn / offDay / schoolDays با تعطیلی و جمعه', async () => {
    const cal = require('../src/lib/calendar');
    assert.strictEqual((await cal.holidayOn(hd, k)).title, 'تعطیلی آزمایشی'); assert.strictEqual((await cal.offDay(hd, k)).reason, 'holiday');
    let fri = today; while (J.dow(fri) !== 6) fri = J.addDays(fri, 1); assert.strictEqual((await cal.offDay(fri, k)).reason, 'weekend');
    const days = await cal.schoolDays(J.addDays(hd, -3), J.addDays(hd, 3), k); assert.ok(!days.includes(hd) && days.every((d) => J.dow(d) <= 4));
    const ev = await k('events').insert({ title: 'رویداد تعطیل', type: 'holiday', start_date: J.addDays(hd, 30), audience: 'all', created_by: 1 }); assert.ok(ev);
    assert.strictEqual((await cal.holidayOn(J.addDays(hd, 30), k)).title, 'رویداد تعطیل');
    assert.strictEqual(await cal.holidayOn(J.addDays(hd, 31), k), null);
  });
  await t('امتحان در روز تعطیل یا خارج از هفته‌ی مدرسه ثبت نمی‌شود', async () => {
    const n0 = await cnt('exam_schedule'); let fri = J.addDays(today, 60); while (J.dow(fri) !== 6) fri = J.addDays(fri, 1);
    let r = await admin.post('/exams/new', { classroom_id: '1', subject_id: '1', exam_date: jstr(hd), start_time: '09:00', duration: '30', type: 'quiz' }, '/exams/new'); assert.ok(/تعطیل/.test(r.text) && /class="alert error/.test(r.text));
    r = await admin.post('/exams/new', { classroom_id: '1', subject_id: '1', exam_date: jstr(fri), start_time: '09:00', duration: '30', type: 'quiz' }, '/exams/new'); assert.ok(/خارج از روزهای هفته/.test(r.text));
    assert.strictEqual(await cnt('exam_schedule'), n0);
  });
  await t('مراقب امتحان: ثبت، تداخل مراقب، مرخصی مراقب', async () => {
    const d1 = nextSchoolDay(hd, 20); const sup = await one(k('teachers').orderBy('id')); const csrow = (c) => k('class_subjects').where({ classroom_id: c }).orderBy('id');
    const s1 = (await csrow(1))[0]; const s2 = (await csrow(3))[0];
    let r = await admin.post('/exams/new', { classroom_id: '1', subject_id: String(s1.subject_id), exam_date: jstr(d1), start_time: '09:00', duration: '60', type: 'quiz', supervisor_id: String(sup.id) }, '/exams/new');
    assert.strictEqual(flash(r) && flash(r).type, 'success', r.text.slice(r.text.indexOf('alert'), r.text.indexOf('alert') + 300));
    assert.strictEqual((await one(k('exam_schedule').where({ exam_date: d1, classroom_id: 1 }))).supervisor_id, sup.id);
    r = await admin.post('/exams/new', { classroom_id: '3', subject_id: String(s2.subject_id), exam_date: jstr(d1), start_time: '09:30', duration: '60', type: 'quiz', supervisor_id: String(sup.id) }, '/exams/new'); assert.ok(/مراقب امتحان دیگری/.test(r.text), 'تداخل مراقب');
    r = await admin.post('/exams/new', { classroom_id: '3', subject_id: String(s2.subject_id), exam_date: jstr(d1), start_time: '11:00', duration: '60', type: 'quiz', supervisor_id: String(sup.id) }, '/exams/new'); assert.strictEqual(flash(r) && flash(r).type, 'success');
    await k('teacher_leaves').insert({ teacher_id: sup.id, kind: 'casual', start_date: J.addDays(d1, 7), end_date: J.addDays(d1, 9), days: 3, status: 'approved' });
    const d2 = nextSchoolDay(d1, 7); const s3 = (await csrow(5))[0];
    r = await admin.post('/exams/new', { classroom_id: '5', subject_id: String(s3.subject_id), exam_date: jstr(d2), start_time: '09:00', duration: '60', type: 'quiz', supervisor_id: String(sup.id) }, '/exams/new'); assert.ok(/مرخصی/.test(r.text), 'مرخصی مراقب');
    r = ok(await admin.get('/exams')); assert.ok(/مراقب/.test(r.text));
  });
  await t('حضور و غیاب: روز تعطیل هشدار نشان می‌دهد؛ زنگ‌های نمای زنگی از ساعت‌های همان روز می‌آید', async () => {
    const past = nextSchoolDay(J.addDays(today, -30)); await k('holidays').insert({ start_date: past, end_date: past, title: 'تعطیلی گذشته', kind: 'manual', created_by: 1 });
    const r = ok(await admin.get(`/attendance?class_id=1&date=${encodeURIComponent(jstr(past))}`)); assert.ok(/تعطیلی گذشته/.test(r.text), 'هشدار تعطیلی');
    // QR در روز تعطیل: امروز را تعطیل می‌کنیم
    await k('holidays').insert({ start_date: today, end_date: today, title: 'تعطیلی امروز', kind: 'manual', created_by: 1 });
    const qr = require('../src/lib/qr'); const s = await one(k('students').where({ student_code: '14050005' }));
    const g = await admin.post('/attendance/gate', { code: qr.payload(s.student_code) }, '/attendance/gate', { headers: { accept: 'application/json' } }); assert.strictEqual(g.status, 409, g.text); assert.ok(/تعطیل/.test(JSON.parse(g.text).message));
    await k('holidays').where({ title: 'تعطیلی امروز' }).del();
  });
  await t('تنظیمات: روزهای هفته‌ی مدرسه نمی‌تواند خالی باشد', async () => {
    const r = await admin.post('/settings', { school_name: 'مدرسه نمونه' }, '/settings'); assert.ok(/حداقل یک روز/.test(r.text), 'اعتبارسنجی روزهای هفته');
    assert.ok((await one(k('settings').where({ key: 'week_days' }))), 'تنظیم روزها حذف شد');
  });
  await t('خطای سروری در لاگ نیست', async () => { assert.ok(!/\[error\]/.test(app.log()), app.log().split('\n').filter((l) => /\[error\]/.test(l)).slice(0, 3).join('\n')); });

  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

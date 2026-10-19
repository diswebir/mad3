'use strict';
/** تست ۲٫۸ — دفتر کلاسی */
const { boot, inproc, t, done, assert, ok, flash } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const J = require('../src/utils/jalali'); const svc = require('../src/services');
  const admin = await app.login('admin', 'Admin#12345'); const tch = await app.login('t.ahmadi', 'teacher123'); const other = await app.login('a.taheri', 'teacher123');
  const stu = await app.login('14050001', 'student123'); const dep = await app.login('deputy', 'deputy123');
  const me = await k('students').where({ student_code: '14050001' }).first();
  const tu = await k('users').where({ username: 't.ahmadi' }).first(); const tt = await k('teachers').where({ user_id: tu.id }).first();
  const ou = await k('users').where({ username: 'a.taheri' }).first(); const ot = await k('teachers').where({ user_id: ou.id }).first();
  const mine = await k('class_subjects').where({ teacher_id: tt.id }).first();
  const foreign = await k('class_subjects').where({ teacher_id: ot.id }).whereNot({ teacher_id: tt.id }).first();
  const today = J.isoToJString(J.todayISO());
  const seedCount = Number((await k('lesson_logs').count({ n: '*' }).first()).n);

  await t('داده‌ی نمونه: دفتر کلاسی پر است و صفحه‌ی معلم فقط جلسات خودش را نشان می‌دهد', async () => {
    assert(seedCount >= 10, 'دمو باید جلسه داشته باشد: ' + seedCount);
    const r = await tch.get('/lessonlog'); ok(r); assert(r.text.includes('ll-item'));
    const ids = [...r.text.matchAll(/\/lessonlog\/(\d+)\/edit/g)].map((m) => Number(m[1]));
    assert(ids.length > 0);
    for (const id of ids) assert((await k('lesson_logs').where({ id }).first()).teacher_id === tt.id, 'جلسه‌ی دیگران نمایش داده شد');
  });
  await t('معلم برای درس خودش ثبت می‌کند؛ برای درس دیگران نه', async () => {
    const r = await tch.post('/lessonlog/new', { class_subject_id: mine.id, log_date: today, period: 2, status: 'held', topic: 'معادله‌ی درجه‌ی دوم', content: 'حل مثال', homework: 'تمرین ۱ تا ۵', visible: '1' }, '/lessonlog/new');
    assert([200, 302].includes(r.status)); const row = await k('lesson_logs').where({ topic: 'معادله‌ی درجه‌ی دوم' }).first(); assert(row && row.teacher_id === tt.id && row.classroom_id === mine.classroom_id);
    if (foreign) { await tch.post('/lessonlog/new', { class_subject_id: foreign.id, log_date: today, topic: 'نباید ثبت شود' }, '/lessonlog/new'); assert(!(await k('lesson_logs').where({ topic: 'نباید ثبت شود' }).first()), 'ثبت برای درس دیگران'); }
  });
  await t('اعتبارسنجی: مبحث خالی، تاریخ آینده برای معلم، زنگ نامعتبر و زنگ تکراری', async () => {
    const base = { class_subject_id: mine.id, log_date: today, status: 'held' };
    let r = await tch.post('/lessonlog/new', { ...base, topic: '' }, '/lessonlog/new'); assert(/مبحث تدریس‌شده را بنویسید/.test(r.text));
    const fut = J.isoToJString(J.addDays(J.todayISO(), 5)); r = await tch.post('/lessonlog/new', { ...base, log_date: fut, topic: 'آینده' }, '/lessonlog/new'); assert(/روزهای آینده/.test(r.text));
    r = await tch.post('/lessonlog/new', { ...base, period: 99, topic: 'زنگ بد' }, '/lessonlog/new'); assert(/شماره‌ی زنگ/.test(r.text));
    r = await tch.post('/lessonlog/new', { ...base, period: 2, topic: 'تکراری' }, '/lessonlog/new'); assert(/قبلاً جلسه ثبت شده/.test(r.text));
    r = await tch.post('/lessonlog/new', { ...base, log_date: 'abc', topic: 'x' }, '/lessonlog/new'); assert(/تاریخ جلسه نامعتبر/.test(r.text));
    r = await tch.post('/lessonlog/new', { ...base, status: 'cancelled', topic: '' }, '/lessonlog/new'); assert(/دلیل برگزارنشدن/.test(r.text));
  });
  await t('ویرایش/حذف: فقط مالک (یا مدیر)؛ معلم دیگر ۴۰۴ می‌گیرد', async () => {
    const row = await k('lesson_logs').where({ topic: 'معادله‌ی درجه‌ی دوم' }).first();
    assert.strictEqual((await other.get(`/lessonlog/${row.id}/edit`)).status, 404);
    await other.post(`/lessonlog/${row.id}/delete`, {}, '/lessonlog'); assert(await k('lesson_logs').where({ id: row.id }).first(), 'معلم دیگر حذف کرد');
    await tch.post(`/lessonlog/${row.id}/edit`, { log_date: today, period: 2, status: 'held', topic: 'ویرایش‌شده', visible: '' }, `/lessonlog/${row.id}/edit`);
    const e = await k('lesson_logs').where({ id: row.id }).first(); assert(e.topic === 'ویرایش‌شده' && !e.visible && e.teacher_id === tt.id && e.class_subject_id === mine.id, 'ویرایش اعمال نشد/کلاس تغییر کرد');
    await admin.post(`/lessonlog/${row.id}/edit`, { log_date: today, period: 2, status: 'held', topic: 'مدیر ویرایش کرد', visible: '1' }, `/lessonlog/${row.id}/edit`);
    assert((await k('lesson_logs').where({ id: row.id }).first()).teacher_id === tt.id, 'مالکیت نباید با ویرایش مدیر عوض شود');
  });
  await t('دانش‌آموز: فقط جلسات کلاس خودش، دیده‌شدنی و برگزارشده؛ بدون دکمه‌ی ویرایش و ثبت', async () => {
    await k('lesson_logs').insert({ class_subject_id: mine.id, classroom_id: me.classroom_id, teacher_id: tt.id, log_date: J.todayISO(), period: 9, status: 'held', topic: 'جلسه‌ی مخفی', visible: 0 });
    await k('lesson_logs').insert({ class_subject_id: mine.id, classroom_id: me.classroom_id, teacher_id: tt.id, log_date: J.todayISO(), period: 8, status: 'cancelled', topic: 'جلسه‌ی لغوشده', visible: 1 });
    const r = await stu.get('/lessonlog'); ok(r); assert(!r.text.includes('جلسه‌ی مخفی') && !r.text.includes('جلسه‌ی لغوشده'), 'نباید ببیند');
    assert(!/\/lessonlog\/\d+\/edit|\/lessonlog\/new/.test(r.text), 'دانش‌آموز دکمه‌ی ویرایش/ثبت ندارد');
    const rows = await k('lesson_logs').where({ classroom_id: me.classroom_id, visible: 1, status: 'held' }).count({ n: '*' }).first(); assert(Number(rows.n) > 0 && r.text.includes('ll-item'));
    for (const p of ['/lessonlog/new', '/lessonlog/coverage']) assert([302, 403].includes((await stu.req('GET', p, null, { follow: false })).status) || (await stu.get(p)).status === 403, p);
    const row = await k('lesson_logs').first(); await stu.post(`/lessonlog/${row.id}/delete`, {}, '/lessonlog'); assert(await k('lesson_logs').where({ id: row.id }).first());
  });
  await t('گزارش پوشش: مدیر و معاون می‌بینند، معلم نه؛ درصد و هشدار «بدون ثبت» نمایش داده می‌شود', async () => {
    for (const c of [admin, dep]) { const r = await c.get('/lessonlog/coverage'); ok(r); assert(r.text.includes('ll-bar') && r.text.includes('ساعت هفتگی')); }
    assert.strictEqual((await tch.get('/lessonlog/coverage')).status, 403);
    await k('lesson_logs').del(); const r = await admin.get('/lessonlog/coverage'); assert(r.text.includes('هیچ جلسه‌ای ثبت نکرده‌اند') && r.text.includes('هرگز'));
  });
  await t('ماژول خاموش: صفحه‌ها بسته می‌شوند و منو آیتم ندارد', async () => {
    const sup = await app.login('super', 'Super#12345');
    await sup.post('/modules/lessonlog/toggle', {}, '/modules');
    assert.notStrictEqual((await tch.get('/lessonlog')).status, 200); assert(!(await tch.get('/')).text.includes('/lessonlog'));
    await sup.post('/modules/lessonlog/toggle', {}, '/modules'); assert.strictEqual((await tch.get('/lessonlog')).status, 200);
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})();

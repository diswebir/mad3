'use strict';
/** تست پایان سال تحصیلی (ارتقا/تکرار پایه/فارغ‌التحصیلی). نصب جداگانه، چون این عملیات کل داده را جابه‌جا می‌کند. */
const { boot, t, ok, flash, done, assert } = require('./helpers');
const section = (s) => console.log('— ' + s);

(async () => {
  const app = await boot(); const k = app.k;
  const admin = await app.login('admin', 'Admin#12345');
  const deputy = await app.login('deputy', 'deputy123');
  const teacher = await app.login('t.ahmadi', 'teacher123');
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const form = (title, extra = {}) => ({ year_title: title, year_start: '1406/06/31', year_end: '1407/03/31', ...extra });

  section('دسترسی و اعتبارسنجی');
  await t('فقط مدیر ارشد؛ معاون و معلم ۴۰۳', async () => {
    for (const c of [deputy, teacher]) { assert.strictEqual((await c.get('/promotion')).status, 403); assert.strictEqual((await c.req('POST', '/promotion/plan', form('1406-1407'))).status, 403); }
    ok(await admin.get('/promotion')); ok(await admin.get('/promotion/archive'));
  });
  const snap = async () => ({ classes: await cnt('classrooms'), years: await cnt('academic_years'), recs: await cnt('student_year_records'), students: await cnt('students', { status: 'active' }) });
  await t('ورودی نامعتبر یا بدون تأیید، هیچ چیز را تغییر نمی‌دهد', async () => {
    const s0 = await snap();
    for (const bad of [form('abc'), form('1406-1407', { year_end: '1405/01/01' }), form('1405-1406'), form('1406-1407', { year_start: 'xx' })]) {
      const r = await admin.post('/promotion/plan', bad, '/promotion'); assert.strictEqual(flash(r) && flash(r).type, 'error', JSON.stringify(bad));
    }
    let r = await admin.post('/promotion/apply', form('1406-1407', { confirm: 'promote' }), '/promotion'); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post('/promotion/apply', form('1406-1407'), '/promotion'); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post('/promotion/apply', form('1405-1406', { confirm: 'PROMOTE' }), '/promotion'); assert.strictEqual(flash(r).type, 'error', 'عنوان تکراری');
    assert.deepStrictEqual(await snap(), s0);
  });
  await t('پیش‌نمایش برنامه‌ی ارتقا خطا ندارد و همه‌ی کلاس‌ها را نشان می‌دهد', async () => {
    const r = ok(await admin.post('/promotion/plan', form('1406-1407'), '/promotion'));
    for (const n of ['هفتم الف', 'هشتم ب', 'نهم ب']) assert.ok(r.text.includes(n), n);
    assert.ok(r.text.includes('PROMOTE') || r.text.includes('name="confirm"'));
    assert.deepStrictEqual(await snap(), { classes: 6, years: 1, recs: 0, students: 72 }, 'پیش‌نمایش نباید چیزی بنویسد');
  });

  section('اجرای ارتقا');
  const stu = async (code) => k('students').where({ student_code: code }).first();
  const ids = {}; const g7 = await k('students').where({ classroom_id: 1 }).orderBy('id'); const g9 = await k('students').where({ classroom_id: 5 }).orderBy('id'); const g8 = await k('students').where({ classroom_id: 3 }).orderBy('id');
  ids.retain = g7[0]; ids.grad = g9[0]; ids.promote = g8[0]; ids.defaultOne = g7[1];
  const before = { scores: await cnt('scores'), att: await cnt('attendance'), tickets: await cnt('tickets'), assess: await cnt('assessments'), cs: await cnt('class_subjects'), tt: await cnt('timetable'), pay: await cnt('payments') };
  const hr7 = await k('classrooms').where({ id: 1 }).first();
  await t('ارتقای دسته‌جمعی با استثناها: تکرار پایه، فارغ‌التحصیلی', async () => {
    const act = { [ids.retain.id]: 'retain', [ids.grad.id]: 'graduate' };
    const r = await admin.post('/promotion/apply', { ...form('1406-1407', { confirm: 'PROMOTE' }), ...Object.fromEntries(Object.entries(act).map(([i, v]) => [`act[${i}]`, v])) }, '/promotion');
    assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    assert.ok(/سال 1406-1407|۱۴۰۶-۱۴۰۷|1406-1407/.test(flash(r).text), flash(r).text);
  });
  await t('سال جدید تنها سال جاری است و کلاس‌های قدیم بایگانی شده‌اند', async () => {
    const ys = await k('academic_years').orderBy('id'); assert.strictEqual(ys.length, 2); assert.deepStrictEqual(ys.map((y) => y.is_current), [0, 1]); assert.strictEqual(ys[1].title, '1406-1407');
    assert.strictEqual(ys[1].start_date > '2027-09-01', true, ys[1].start_date);
    assert.strictEqual(await cnt('classrooms', { status: 'archived' }), 6); assert.ok((await cnt('classrooms')) >= 12);
    const old = await k('classrooms').where({ id: 1 }).first(); assert.ok(old.name.includes('(1405-1406)'), old.name); assert.strictEqual(old.homeroom_teacher_id, null);
    ok(await admin.get('/promotion/archive')); assert.ok((await admin.get('/promotion/archive')).text.includes('هفتم الف'));
    ok(await admin.get('/promotion'));
  });
  await t('سوابق سالانه برای تک‌تک دانش‌آموزان فعال ثبت شده و داده‌ی قدیمی دست‌نخورده است', async () => {
    assert.strictEqual(await cnt('student_year_records'), 72);
    for (const [tbl, key] of [['scores', 'scores'], ['attendance', 'att'], ['tickets', 'tickets'], ['assessments', 'assess'], ['payments', 'pay']]) assert.strictEqual(await cnt(tbl), before[key], tbl + ' نباید تغییر کند');
    const rec = await k('student_year_records').where({ student_id: ids.retain.id }).first(); assert.strictEqual(rec.year_title, '1405-1406'); assert.strictEqual(rec.classroom_name, 'هفتم الف'); assert.ok(rec.overall === null || Number(rec.overall) >= 0);
  });
  await t('جابه‌جایی دانش‌آموزان: ارتقا به پایه‌ی بعد با همان گروه، تکرار در همان پایه، دهم تازه ساخته می‌شود', async () => {
    const cls = async (s) => k('classrooms').where({ id: (await k('students').where({ id: s.id }).first()).classroom_id }).first();
    const p = await cls(ids.defaultOne); assert.strictEqual(p.grade_level, 'هشتم'); assert.strictEqual(p.section, 'الف'); assert.strictEqual(p.status, 'active'); assert.strictEqual(p.name, 'هشتم الف');
    const p8 = await cls(ids.promote); assert.strictEqual(p8.grade_level, 'نهم'); assert.strictEqual(p8.section, 'الف');
    const r = await cls(ids.retain); assert.strictEqual(r.grade_level, 'هفتم'); assert.strictEqual(r.status, 'active'); assert.strictEqual(r.name, 'هفتم الف');
    const g9b = await k('students').where({ classroom_id: 6 }).first(); assert.ok(!g9b, 'کلاس بایگانی خالی از دانش‌آموز');
    const nine = await k('students').where({ classroom_id: 5 }); assert.strictEqual(nine.length, 0);
    const tenth = await k('classrooms').where({ grade_level: 'دهم', status: 'active' }); assert.strictEqual(tenth.length, 2, 'دو کلاس دهم (الف و ب) ساخته شود');
    const inTenth = await k('students').whereIn('classroom_id', tenth.map((c) => c.id)); assert.strictEqual(inTenth.length, 23, 'دوازده‌تا از نهم‌ها منهای فارغ‌التحصیل');
    const total = await k('students').where({ status: 'active' }); assert.strictEqual(total.length, 71);
    for (const s of total) assert.ok(s.classroom_id, 'کلاسِ خالی نباید بماند');
    const gr = await k('students').where({ id: ids.grad.id }).first(); assert.strictEqual(gr.status, 'graduated'); assert.strictEqual(gr.classroom_id, null);
  });
  await t('کلاس‌های جدید: دروس، معلم‌ها، راهنما و برنامه‌ی هفتگی کپی شده‌اند', async () => {
    const act = await k('classrooms').where({ status: 'active' }).select('id'); const aid = act.map((c) => c.id);
    const newCs = await k('class_subjects').whereIn('classroom_id', aid).count({ c: '*' }).first(); assert.ok(Number(newCs.c) >= before.cs);
    assert.strictEqual(Number((await k('timetable').whereIn('classroom_id', aid).count({ c: '*' }).first()).c), before.tt);
    const nc = await k('classrooms').where({ name: 'هفتم الف', status: 'active' }).first(); assert.strictEqual(nc.homeroom_teacher_id, hr7.homeroom_teacher_id);
    const orphan = await k('timetable as t').leftJoin('class_subjects as cs', 'cs.id', 't.class_subject_id').whereNull('cs.id').count({ c: '*' }).first(); assert.strictEqual(Number(orphan.c), 0);
    const bad = await k('timetable as t').join('class_subjects as cs', 'cs.id', 't.class_subject_id').whereRaw('cs.classroom_id <> t.classroom_id').count({ c: '*' }).first(); assert.strictEqual(Number(bad.c), 0, 'برنامه‌ی هر کلاس فقط به دروس همان کلاس اشاره کند');
  });
  await t('فارغ‌التحصیل: حساب غیرفعال و ورود ناممکن؛ ارتقایافته همچنان وارد می‌شود', async () => {
    await assert.rejects(app.login(ids.grad.student_code, 'student123'), /login failed/);
    assert.strictEqual((await k('users').where({ id: ids.grad.user_id }).first()).active, 0);
    const c = await app.login(ids.promote.student_code, 'student123'); ok(await c.get('/')); ok(await c.get('/grades/my'));
  });
  await t('سوابق تحصیلی در پرونده، تاریخچه‌ی تغییر و گزارش‌ها بدون خطا', async () => {
    const h = ok(await admin.get(`/students/${ids.retain.id}?tab=history`)); assert.ok(h.text.includes('1405-1406') && h.text.includes('هفتم الف'));
    const c = ok(await admin.get(`/students/${ids.retain.id}?tab=changes`)); assert.ok(c.text.includes('تکرار پایه'));
    assert.ok(ok(await admin.get(`/students/${ids.grad.id}?tab=changes`)).text.includes('فارغ‌التحصیل'));
    for (const p of ['/', '/classes', '/students', '/students?status=graduated', '/reports', '/reports/risk', '/reports/compare', '/reports/trends', '/attendance', '/grades', '/timetable', '/finance', '/promotion', '/teachers', '/hr']) ok(await admin.get(p), p);
    const ex = await teacher.get('/'); ok(ex);
  });
  await t('اجرای دوباره با همان عنوان ممنوع و چیزی تغییر نمی‌کند', async () => {
    let r = await admin.post('/promotion/apply', form('1406-1407', { confirm: 'PROMOTE' }), '/promotion'); assert.strictEqual(flash(r).type, 'error');
    const n = await cnt('student_year_records'); const yrs = await cnt('academic_years'); assert.strictEqual(yrs, 2); assert.strictEqual(n, 72);
  });
  const log = app.log(); await t('هیچ خطای سروری ثبت نشده', async () => { assert.ok(!/Error|ERR_|Unhandled/.test(log.replace(/login failed/g, '')), log.slice(-500)); });
  await app.stop();
  process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

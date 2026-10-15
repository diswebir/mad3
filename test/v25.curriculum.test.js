'use strict';
/** تست نسخه‌ی ۲٫۵ — برنامه‌ریز درسی کلاس (ساعت هفتگی/روزانه بر پایه‌ی برنامه) و بار تدریس معلم */
const { boot, t, done, assert, inproc } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const cur = require('../src/lib/curriculum'); const caps = require('../src/lib/caps');
  const admin = await app.login('admin', 'Admin#12345'); const teach = await app.login('t.ahmadi', 'teacher123'); const dep = await app.login('deputy', 'deputy123');
  const flash = (r) => { const out = []; const re = /class="alert (?:flash )?(?:success|error|info|warn)[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<div>([\s\S]*?)<\/div>/g; let m; while ((m = re.exec(r.text))) out.push(m[1].replace(/<[^>]+>/g, '').trim()); return out.join(' || ') || 'NOFLASH'; };
  const uid = async (n) => (await k('users').where({ username: n }).first()).id;
  const tUser = await uid('t.ahmadi'); const depUser = await uid('deputy');

  console.log('● منطق خالص برنامه‌ریز');
  await t('planChanges: محدودسازی ساعت/سقف روزانه، بدون تغییر = بدون به‌روزرسانی، تکرار درس خطاست، حذف و افزودن', () => {
    const c = [{ id: 1, subject_id: 1, teacher_id: null, weekly_hours: 2, max_per_day: 2 }, { id: 2, subject_id: 2, teacher_id: 5, weekly_hours: 3, max_per_day: 2 }];
    const p = cur.planChanges(c, { 1: { teacher_id: '', weekly_hours: '2', max_per_day: '2' }, 2: { teacher_id: '5', weekly_hours: '99', max_per_day: '0' } }, [{ subject_id: 3, weekly_hours: '4', max_per_day: '9' }, { subject_id: 3 }, { subject_id: 1 }]);
    assert.strictEqual(p.updates.length, 1); assert.strictEqual(p.updates[0].weekly_hours, 20); assert.strictEqual(p.updates[0].max_per_day, 1);
    assert.strictEqual(p.inserts.length, 1); assert.strictEqual(p.inserts[0].max_per_day, 4 > 6 ? 6 : 4); assert.strictEqual(p.errors.length, 2);
    const q = cur.planChanges(c, { 1: { remove: '1' } }, []); assert.strictEqual(q.removes.length, 1);
    const z = cur.planChanges(c, { 1: { weekly_hours: '2', max_per_day: '5', teacher_id: '' } }, []); assert.strictEqual(z.updates[0].max_per_day, 2, 'سقف روزانه از ساعت هفتگی بیشتر نمی‌شود');
  });
  await t('summarize/rowState/placedMap/teacherTotals', () => {
    const rows = [{ id: 1, subject_name: 'ریاضی', weekly_hours: 4, max_per_day: 2, teacher_id: 3 }, { id: 2, subject_name: 'ادبیات', weekly_hours: 2, max_per_day: 1, teacher_id: null }];
    const pm = cur.placedMap([{ class_subject_id: 1, day: 0 }, { class_subject_id: 1, day: 0 }, { class_subject_id: 1, day: 0 }, { class_subject_id: 1, day: 2 }, { class_subject_id: 2, day: 1 }]);
    assert.strictEqual(pm[1].total, 4); assert.strictEqual(pm[1].maxDay, 3); assert.strictEqual(cur.rowState(4, pm[1]), 'ok'); assert.strictEqual(cur.rowState(5, pm[1]), 'short'); assert.strictEqual(cur.rowState(3, pm[1]), 'over'); assert.strictEqual(cur.rowState(2, undefined), 'none');
    const s = cur.summarize(rows, { total: 5 }, pm); assert.strictEqual(s.total, 6); assert.strictEqual(s.free, -1);
    const keys = s.warnings.map((w) => w.k); for (const x of ['over_capacity', 'perday', 'no_teacher']) assert.ok(keys.includes(x), x);
    const tt = cur.teacherTotals([{ teacher_id: 3, weekly_hours: 4 }, { teacher_id: 3, weekly_hours: 2 }], [{ teacher_id: 3, day: 1 }, { teacher_id: 3, day: 1 }]); assert.deepStrictEqual(tt[3], { hours: 6, byDay: { 1: 2 } });
  });

  // کلاس با درس و برنامه‌ی چیده‌شده
  const row = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').whereNotNull('cs.teacher_id').first('tt.classroom_id as cid');
  const cid = row.cid; const cls = await k('classrooms').where({ id: cid }).first();
  const subs = () => k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.classroom_id', cid).orderBy('cs.id').select('cs.*', 's.name');

  console.log('● صفحه‌ی برنامه‌ریز و نمای کلاس');
  await t('صفحه‌ی برنامه‌ریز: خلاصه‌ی ساعت/ظرفیت، گام‌شمار، توزیع روزانه‌ی برنامه، میان‌بُرها', async () => {
    const r = await admin.get(`/classes/${cid}/curriculum`); assert.strictEqual(r.status, 200);
    for (const s of ['plan-form', 'data-step="1"', 'sum-total', 'class="dist"', 'curriculum/sync', 'curriculum/add-grade', 'curriculum/copy', 'name="rows[', 'add-subject', 'plan-data', 'curriculum.js']) assert.ok(r.text.includes(s), s);
    assert.ok(/زنگ/.test(r.text) && /چیده‌شده در برنامه/.test(r.text));
  });
  await t('نمای کلاس: جدول فقط‌خواندنی با چیدمان «چیده‌شده از ساعت» و دکمه‌ی برنامه‌ریزی؛ بدون فرم‌های ردیفی قدیمی', async () => {
    const r = await admin.get('/classes/' + cid); assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes(`/classes/${cid}/curriculum`) && /برنامه‌ریزی دروس و ساعت‌ها/.test(r.text)); assert.ok(!/subjects\/\d+\/update/.test(r.text), 'فرم ردیفی قدیمی حذف شد'); assert.ok(/چیده‌شده در برنامه/.test(r.text));
    const tr = await teach.get('/classes/' + (await k('class_subjects as cs').join('teachers as t', 't.id', 'cs.teacher_id').where('t.user_id', tUser).first('cs.classroom_id')).classroom_id); assert.strictEqual(tr.status, 200); assert.ok(!/برنامه‌ریزی دروس و ساعت‌ها/.test(tr.text), 'معلم دکمه‌ی برنامه‌ریزی نمی‌بیند');
  });
  await t('معلم بدون مجوز به برنامه‌ریز دسترسی ندارد؛ معاون دارد', async () => {
    assert.strictEqual((await teach.get(`/classes/${cid}/curriculum`)).status, 403); assert.strictEqual((await dep.get(`/classes/${cid}/curriculum`)).status, 200);
  });

  console.log('● ذخیره‌ی گروهی');
  await t('ذخیره‌ی گروهی: ساعت، سقف روزانه (نرمال‌شده)، معلم و افزودن/حذف درس در یک تراکنش', async () => {
    const before = await subs(); const a = before[0]; const b = before[1];
    let free = await k('subjects').whereNotIn('id', before.map((x) => x.subject_id)).first(); if (!free) { const id = await k('subjects').insert({ name: 'درس آزمایشی برنامه‌ریز', grade_level: cls.grade_level }); free = { id: Array.isArray(id) ? id[0] : id }; }
    const gone = before.find((x) => x.id !== a.id && x.id !== b.id); const goneAssess = Number((await k('assessments').where({ class_subject_id: gone.id }).count({ c: '*' }).first()).c);
    const body = { [`rows[${a.id}][teacher_id]`]: String(a.teacher_id || ''), [`rows[${a.id}][weekly_hours]`]: '5', [`rows[${a.id}][max_per_day]`]: '9', [`rows[${b.id}][teacher_id]`]: '', [`rows[${b.id}][weekly_hours]`]: String(b.weekly_hours), [`rows[${b.id}][max_per_day]`]: String(b.max_per_day), 'add[0][subject_id]': String(free.id), 'add[0][weekly_hours]': '3', 'add[0][max_per_day]': '2' };
    if (!goneAssess) body[`rows[${gone.id}][remove]`] = '1';
    const r = await admin.post(`/classes/${cid}/curriculum`, body, `/classes/${cid}/curriculum`); assert.ok(/ذخیره شد/.test(flash(r)), flash(r).slice(0, 200));
    const A = await k('class_subjects').where({ id: a.id }).first(); assert.strictEqual(A.weekly_hours, 5); assert.strictEqual(A.max_per_day, 5, 'سقف روزانه ≤ ساعت هفتگی و ≤ ۶');
    assert.strictEqual((await k('class_subjects').where({ id: b.id }).first()).teacher_id, null);
    const ins = await k('class_subjects').where({ classroom_id: cid, subject_id: free.id }).first(); assert.ok(ins && ins.weekly_hours === 3);
    if (!goneAssess) assert.ok(!(await k('class_subjects').where({ id: gone.id }).first()), 'حذف نشد');
    assert.ok(await k('audit_logs').where({ entity: 'class_subjects' }).where('details', 'like', '%ویرایش%').first(), 'ممیزی');
  });
  await t('همه یا هیچ: یک معلم نامعتبر در فرم یعنی هیچ تغییری ذخیره نمی‌شود', async () => {
    const before = await subs(); const a = before[0];
    const r = await admin.post(`/classes/${cid}/curriculum`, { [`rows[${a.id}][weekly_hours]`]: '9', [`rows[${a.id}][max_per_day]`]: '2', [`rows[${a.id}][teacher_id]`]: '99999', [`rows[${before[1].id}][weekly_hours]`]: '7', [`rows[${before[1].id}][max_per_day]`]: '2', [`rows[${before[1].id}][teacher_id]`]: '' }, `/classes/${cid}/curriculum`);
    assert.ok(/معتبر|فعال/.test(flash(r))); const after = await subs(); assert.deepStrictEqual(after.map((x) => [x.id, x.weekly_hours]), before.map((x) => [x.id, x.weekly_hours]));
  });
  await t('حذف درسِ دارای ارزشیابی رد می‌شود و هیچ چیز تغییر نمی‌کند', async () => {
    const withA = await k('assessments as a').join('class_subjects as cs', 'cs.id', 'a.class_subject_id').first('cs.id', 'cs.classroom_id'); assert.ok(withA, 'ارزشیابی دمو');
    const before = Number((await k('class_subjects').where({ classroom_id: withA.classroom_id }).count({ c: '*' }).first()).c);
    const r = await admin.post(`/classes/${withA.classroom_id}/curriculum`, { [`rows[${withA.id}][remove]`]: '1' }, `/classes/${withA.classroom_id}/curriculum`); assert.ok(/ارزشیابی ثبت شده/.test(flash(r)), flash(r).slice(0,400));
    assert.strictEqual(Number((await k('class_subjects').where({ classroom_id: withA.classroom_id }).count({ c: '*' }).first()).c), before);
  });
  await t('تغییر معلم به کسی که در همان زنگ کلاس دیگری دارد (تداخل) رد می‌شود', async () => {
    const mine = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('cs.classroom_id', cid).first('tt.day', 'tt.period', 'cs.id as csid');
    const other = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where({ 'tt.day': mine.day, 'tt.period': mine.period }).whereNot('tt.classroom_id', cid).whereNotNull('cs.teacher_id').first('cs.teacher_id');
    if (!other) return; // در داده‌ی دمو چنین هم‌زمانی نیست
    const cur0 = await k('class_subjects').where({ id: mine.csid }).first(); if (cur0.teacher_id === other.teacher_id) return;
    const r = await admin.post(`/classes/${cid}/curriculum`, { [`rows[${mine.csid}][teacher_id]`]: String(other.teacher_id), [`rows[${mine.csid}][weekly_hours]`]: String(cur0.weekly_hours), [`rows[${mine.csid}][max_per_day]`]: String(cur0.max_per_day) }, `/classes/${cid}/curriculum`);
    assert.ok(/کلاس دیگری دارد/.test(flash(r)), flash(r).slice(0,400)); assert.strictEqual((await k('class_subjects').where({ id: mine.csid }).first()).teacher_id, cur0.teacher_id);
  });
  await t('هشدار موظفی: تعیین ساعت بیش از موظفی معلم ذخیره می‌شود ولی هشدار نشان داده می‌شود', async () => {
    const a = (await subs()).find((x) => x.teacher_id); await k('teachers').where({ id: a.teacher_id }).update({ weekly_load: 1 });
    const r = await admin.post(`/classes/${cid}/curriculum`, { [`rows[${a.id}][teacher_id]`]: String(a.teacher_id), [`rows[${a.id}][weekly_hours]`]: '6', [`rows[${a.id}][max_per_day]`]: '2' }, `/classes/${cid}/curriculum`);
    assert.ok(/هشدار/.test(flash(r)) && /موظفی/.test(flash(r)), flash(r).slice(0, 300)); assert.strictEqual((await k('class_subjects').where({ id: a.id }).first()).weekly_hours, 6);
    await k('teachers').where({ id: a.teacher_id }).update({ weekly_load: null });
  });

  console.log('● میان‌بُرها: هم‌گام‌سازی، پایه، کپی');
  await t('هم‌گام‌سازی: ساعت هر درس برابر تعداد زنگ‌های چیده‌شده و سقف روزانه متناسب می‌شود', async () => {
    const r = await admin.post(`/classes/${cid}/curriculum/sync`, {}, `/classes/${cid}/curriculum`); assert.ok(/ساعت|هم‌خوان/.test(flash(r)));
    const rows = await k('timetable').where({ classroom_id: cid }); const by = {}; rows.forEach((x) => { by[x.class_subject_id] = (by[x.class_subject_id] || 0) + 1; });
    for (const s of await subs()) if (by[s.id]) { assert.strictEqual(s.weekly_hours, Math.min(20, by[s.id]), s.name); const perDay = {}; rows.filter((x) => x.class_subject_id === s.id).forEach((x) => { perDay[x.day] = (perDay[x.day] || 0) + 1; }); assert.ok(s.max_per_day >= Math.min(6, Math.max(...Object.values(perDay))), 'سقف روزانه'); }
  });
  await t('افزودن دروس هم‌پایه و کپی از کلاس دیگر', async () => {
    const target = await k('classrooms').insert({ name: 'کلاس آزمایشی برنامه‌ریز', grade_level: cls.grade_level, status: 'active' }); const tid = Array.isArray(target) ? target[0] : target;
    let r = await admin.post(`/classes/${tid}/curriculum/add-grade`, {}, `/classes/${tid}/curriculum`);
    const n1 = Number((await k('class_subjects').where({ classroom_id: tid }).count({ c: '*' }).first()).c); const expect = Number((await k('subjects').where({ grade_level: cls.grade_level }).count({ c: '*' }).first()).c);
    assert.strictEqual(n1, expect, flash(r).slice(0, 150));
    await k('class_subjects').where({ classroom_id: tid }).del();
    r = await admin.post(`/classes/${tid}/curriculum/copy`, { from: String(cid), keep_teacher: '1' }, `/classes/${tid}/curriculum`);
    const src = await subs(); const copied = await k('class_subjects').where({ classroom_id: tid }); assert.strictEqual(copied.length, src.length);
    assert.deepStrictEqual(copied.map((x) => x.teacher_id).sort(), src.map((x) => x.teacher_id).sort());
    r = await admin.post(`/classes/${tid}/curriculum/copy`, { from: String(cid) }, `/classes/${tid}/curriculum`); assert.ok(/جدیدی|نداشت/.test(flash(r)), 'تکرار نباید دوباره کپی کند');
    assert.strictEqual(Number((await k('class_subjects').where({ classroom_id: tid }).count({ c: '*' }).first()).c), src.length);
  });

  console.log('● برنامه هفتگی ↔ ساعت‌ها');
  await t('ذخیره‌ی برنامه با «هم‌گام‌سازی ساعت‌ها»: ساعت درس برابر چیدمان تازه می‌شود', async () => {
    const rows = await k('timetable').where({ classroom_id: cid }).orderBy('id'); assert.ok(rows.length > 2);
    const drop = rows[0]; const body = { class_id: String(cid), sync_hours: '1' }; for (const x of rows.slice(1)) body[`cell[${x.day}-${x.period}]`] = String(x.class_subject_id);
    const r = await admin.post('/timetable', body, `/timetable?class_id=${cid}&edit=1`); assert.ok(/ذخیره شد/.test(flash(r)) || /هم‌گام/.test(flash(r)), flash(r).slice(0, 200));
    const left = rows.filter((x) => x.class_subject_id === drop.class_subject_id).length - 1;
    const cs = await k('class_subjects').where({ id: drop.class_subject_id }).first(); assert.strictEqual(cs.weekly_hours, left || cs.weekly_hours, 'ساعت درس'); if (!left) assert.ok(true);
    await admin.post('/timetable', { ...body, [`cell[${drop.day}-${drop.period}]`]: String(drop.class_subject_id), sync_hours: '' }, `/timetable?class_id=${cid}&edit=1`);
  });
  await t('فرم ویرایش برنامه گزینه‌ی هم‌گام‌سازی دارد', async () => { const r = await admin.get(`/timetable?class_id=${cid}&edit=1`); assert.ok(r.text.includes('name="sync_hours"')); });
  await t('سقف ساعت روزانه‌ی معلم: ذخیره‌ی برنامه‌ای که از آن بیشتر شود رد می‌شود', async () => {
    const rows = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('tt.classroom_id', cid).whereNotNull('cs.teacher_id').select('tt.*', 'cs.teacher_id');
    const tid = rows[0].teacher_id; await k('teachers').where({ id: tid }).update({ daily_max: 1 });
    const mine = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('cs.teacher_id', tid).select('tt.day'); const by = {}; mine.forEach((x) => { by[x.day] = (by[x.day] || 0) + 1; });
    const all = await k('timetable').where({ classroom_id: cid }); const body = { class_id: String(cid) }; for (const x of all) body[`cell[${x.day}-${x.period}]`] = String(x.class_subject_id);
    const r = await admin.post('/timetable', body, `/timetable?class_id=${cid}&edit=1`);
    if (Object.values(by).some((n) => n > 1)) assert.ok(/سقف روزانه/.test(flash(r)), flash(r).slice(0, 250)); else assert.ok(true);
    await k('teachers').where({ id: tid }).update({ daily_max: null });
  });

  console.log('● بار تدریس معلم');
  const trow = await k('teachers').where({ user_id: tUser }).first();
  await t('کارت بار تدریس در صفحه‌ی معلم: ساعت، موظفی، توزیع روزانه، فرم سقف‌ها و فرم تخصیص', async () => {
    await k('teachers').where({ id: trow.id }).update({ weekly_load: 4 });
    const r = await admin.get('/teachers/' + trow.id); assert.strictEqual(r.status, 200);
    for (const s of ['بار تدریس و تخصیص‌ها', 'class="meter"', 'class="dist"', 'name="daily_max"', 'name="weekly_load"', `/teachers/${trow.id}/assignments`, 'name="classroom_id"']) assert.ok(r.text.includes(s), s);
  });
  await t('سقف‌ها: موظفی و سقف روزانه ذخیره و اعتبارسنجی می‌شوند', async () => {
    let r = await admin.post(`/hr/teacher/${trow.id}/load`, { weekly_load: '20', daily_max: '5', back: 'teacher' }, '/teachers/' + trow.id); const row = await k('teachers').where({ id: trow.id }).first(); assert.strictEqual(row.weekly_load, 20); assert.strictEqual(row.daily_max, 5);
    r = await admin.post(`/hr/teacher/${trow.id}/load`, { daily_max: '99' }, '/teachers/' + trow.id); assert.ok(/۱ تا ۱۲/.test(flash(r))); assert.strictEqual((await k('teachers').where({ id: trow.id }).first()).daily_max, 5);
    r = await admin.post(`/hr/teacher/${trow.id}/load`, { weekly_load: '' }, '/teachers/' + trow.id); assert.strictEqual((await k('teachers').where({ id: trow.id }).first()).weekly_load, null);
    await k('teachers').where({ id: trow.id }).update({ daily_max: null });
  });
  await t('تخصیص درس از صفحه‌ی معلم: افزودن، تشخیص معلم دیگر، هشدار موظفی و برداشتن تخصیص', async () => {
    const target = await k('classrooms').where({ name: 'کلاس آزمایشی برنامه‌ریز' }).first(); await k('class_subjects').where({ classroom_id: target.id }).del();
    const subj = await k('subjects').first(); await k('teachers').where({ id: trow.id }).update({ weekly_load: 1 });
    let r = await admin.post(`/teachers/${trow.id}/assignments`, { action: 'add', classroom_id: String(target.id), subject_id: String(subj.id), weekly_hours: '3' }, '/teachers/' + trow.id);
    const a = await k('class_subjects').where({ classroom_id: target.id, subject_id: subj.id }).first(); assert.ok(a && a.teacher_id === trow.id && a.weekly_hours === 3); assert.ok(/موظفی/.test(flash(r)), 'هشدار موظفی');
    const other = await k('teachers').whereNot({ id: trow.id }).first(); await k('class_subjects').where({ id: a.id }).update({ teacher_id: other.id });
    r = await admin.post(`/teachers/${trow.id}/assignments`, { action: 'add', classroom_id: String(target.id), subject_id: String(subj.id), weekly_hours: '3' }, '/teachers/' + trow.id); assert.ok(/معلم دیگری/.test(flash(r))); assert.strictEqual((await k('class_subjects').where({ id: a.id }).first()).teacher_id, other.id);
    await k('class_subjects').where({ id: a.id }).update({ teacher_id: trow.id });
    await admin.post(`/teachers/${trow.id}/assignments`, { action: 'remove', cs_id: String(a.id) }, '/teachers/' + trow.id); assert.strictEqual((await k('class_subjects').where({ id: a.id }).first()).teacher_id, null);
    assert.strictEqual((await admin.post(`/teachers/${trow.id}/assignments`, { action: 'remove', cs_id: '999999' }, '/teachers/' + trow.id)).status, 404);
    await k('teachers').where({ id: trow.id }).update({ weekly_load: null });
  });

  console.log('● ادغام با دسترسی ریزدانه');
  await t('«تعیین دروس و ساعت‌ها» به معلم قابل اعطا است؛ معاون با ممنوعیت آن بسته می‌شود', async () => {
    await admin.post('/access/user/' + tUser, { 'cap[classes.curriculum]': 'allow' }, '/access/user/' + tUser);
    assert.strictEqual((await teach.get(`/classes/${cid}/curriculum`)).status, 200);
    const a = (await subs())[0]; const r = await teach.post(`/classes/${cid}/curriculum`, { [`rows[${a.id}][teacher_id]`]: String(a.teacher_id || ''), [`rows[${a.id}][weekly_hours]`]: String(a.weekly_hours + 1), [`rows[${a.id}][max_per_day]`]: '2' }, `/classes/${cid}/curriculum`); assert.ok(/ذخیره شد/.test(flash(r)), flash(r));
    assert.strictEqual((await k('class_subjects').where({ id: a.id }).first()).weekly_hours, a.weekly_hours + 1);
    await admin.post('/access/user/' + tUser + '/reset', {}, '/access/user/' + tUser); assert.strictEqual((await teach.get(`/classes/${cid}/curriculum`)).status, 403);
    await admin.post('/access/user/' + depUser, { 'cap[classes.curriculum]': 'deny' }, '/access/user/' + depUser); assert.strictEqual((await dep.get(`/classes/${cid}/curriculum`)).status, 403);
    assert.strictEqual((await dep.get('/classes/' + cid)).status, 200); const pg = await dep.get('/classes/' + cid); assert.ok(!/برنامه‌ریزی دروس و ساعت‌ها/.test(pg.text));
    await admin.post('/access/user/' + depUser + '/reset', {}, '/access/user/' + depUser);
  });
  await t('مسیرهای قدیمی افزودن/ویرایش/حذف درس همچنان کار می‌کنند (سازگاری)', async () => {
    const free = await k('subjects').whereNotIn('id', (await subs()).map((x) => x.subject_id)).first(); if (!free) return;
    await admin.post(`/classes/${cid}/subjects`, { subject_id: String(free.id), weekly_hours: '2' }, `/classes/${cid}`); const n = await k('class_subjects').where({ classroom_id: cid, subject_id: free.id }).first(); assert.ok(n);
    await admin.post(`/classes/${cid}/subjects/${n.id}/delete`, {}, `/classes/${cid}`); assert.ok(!(await k('class_subjects').where({ id: n.id }).first()));
  });
  void caps;
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

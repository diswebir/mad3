'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { requireRole, isManager } = require('../middleware');
const { classResults } = require('../lib/gradesCalc');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const router = express.Router();
/** حذف تکالیف درس‌ها همراه با پاسخ‌ها و فایل‌های پیوست (بدون رکورد یتیم) */
async function purgeHomework(k, csIds) {
  if (!csIds.length) return;
  const hws = await k('homework').whereIn('class_subject_id', csIds);
  const ids = hws.map((h) => h.id);
  if (ids.length) {
    const subs = await k('homework_submissions').whereIn('homework_id', ids);
    const rm = (f) => f && fs.unlink(path.join(config.UPLOAD_DIR, 'homework', f), () => {});
    subs.forEach((x) => rm(x.file)); hws.forEach((h) => rm(h.attachment));
    await k('homework_submissions').whereIn('homework_id', ids).del();
  }
  await k('homework').whereIn('class_subject_id', csIds).del();
}
const M = modules.isEnabled;
const mgr = requireRole('admin', 'deputy');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'کلاس مورد نظر یافت نشد یا به آن دسترسی ندارید.' });

async function getClass(req, id) {
  const k = db.get();
  const c = await k('classrooms as c').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as u', 'u.id', 't.user_id').leftJoin('academic_years as y', 'y.id', 'c.academic_year_id').where('c.id', id).first('c.*', 'u.full_name as homeroom_name', 'u.phone as homeroom_phone', 'y.title as year_title');
  if (!c) return null;
  if (isManager(req.user)) return c;
  const ids = await svc.accessibleClassIds(req.user);
  return ids && ids.includes(c.id) ? c : null;
}

router.get('/classes', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const ids = await svc.accessibleClassIds(req.user);
    const qb = k('classrooms as c').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as u', 'u.id', 't.user_id');
    if (ids) qb.whereIn('c.id', ids.length ? ids : [0]);
    if (!(req.query.archived === '1' && ['admin', 'deputy'].includes(req.user.role))) qb.where('c.status', '<>', 'archived');
    if (req.query.grade) qb.where('c.grade_level', req.query.grade);
    const rows = await qb.orderBy('c.grade_level').orderBy('c.name').select('c.*', 'u.full_name as homeroom_name', k.raw("(select count(*) from students s where s.classroom_id = c.id and s.status = 'active') as student_count"), k.raw('(select count(*) from class_subjects cs where cs.classroom_id = c.id) as subject_count'));
    const grades = (await k('classrooms').where('status', '<>', 'archived').distinct('grade_level').whereNotNull('grade_level')).map((x) => x.grade_level);
    res.view('classes/index', { title: 'کلاس‌ها', rows, grades, grade: req.query.grade || '' });
  } catch (e) { next(e); }
});

async function formData(k, row) {
  return {
    years: (await k('academic_years').orderBy('id', 'desc').select('id', 'title')).map((y) => [y.id, y.title]),
    teachers: (await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name')).map((t) => [t.id, t.full_name]),
  };
}
const FIELDS = (o) => [
  { name: 'name', label: 'نام کلاس', type: 'text', required: true, hint: 'مثلاً هفتم الف' },
  { name: 'grade_level', label: 'پایه', type: 'select', required: true, opts: require('../labels').L.gradeLevels.map((x) => [x, x]) },
  { name: 'section', label: 'گروه/شعبه', type: 'text' }, { name: 'capacity', label: 'ظرفیت', type: 'number', min: 1, max: 100 },
  { name: 'room_no', label: 'شماره اتاق', type: 'text' }, { name: 'academic_year_id', label: 'سال تحصیلی', type: 'select', opts: o.years },
  { name: 'homeroom_teacher_id', label: 'معلم راهنما (مسئول کلاس)', type: 'select', opts: o.teachers, hint: 'هر معلم فقط می‌تواند راهنمای یک کلاس باشد.' },
  { name: 'notes', label: 'توضیحات', type: 'textarea', full: true },
];
async function renderForm(res, row, errors, vals) {
  const o = await formData(db.get(), row);
  res.view('classes/form', { title: row ? 'ویرایش کلاس' : 'افزودن کلاس', row, errors: errors || [], vals: vals || row || { capacity: 30 }, fields: FIELDS(o) });
}
router.get('/classes/new', mgr, (req, res, next) => renderForm(res, null).catch(next));
async function collect(req, existing) {
  const k = db.get(); const b = req.body; const errors = []; const data = {};
  if (!b.name) errors.push('نام کلاس الزامی است.'); else data.name = b.name;
  data.grade_level = b.grade_level || null; data.section = b.section || null; data.room_no = b.room_no || null; data.notes = b.notes || null;
  data.capacity = b.capacity ? Number(b.capacity) : 30;
  if (isNaN(data.capacity) || data.capacity < 1 || data.capacity > 100) errors.push('ظرفیت باید بین ۱ تا ۱۰۰ باشد.');
  data.academic_year_id = b.academic_year_id ? Number(b.academic_year_id) : null;
  data.homeroom_teacher_id = b.homeroom_teacher_id ? Number(b.homeroom_teacher_id) : null;
  if (b.name) { const dup = await k('classrooms').where({ name: b.name }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first(); if (dup) errors.push('کلاسی با این نام وجود دارد.'); }
  if (data.homeroom_teacher_id) {
    const other = await k('classrooms').where({ homeroom_teacher_id: data.homeroom_teacher_id }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first();
    if (other) errors.push(`این معلم قبلاً راهنمای کلاس «${other.name}» است.`);
  }
  if (existing && data.capacity) { const cnt = Number((await k('students').where({ classroom_id: existing.id, status: 'active' }).count({ c: '*' }).first()).c); if (cnt > data.capacity) errors.push(`تعداد دانش‌آموزان فعلی (${cnt}) بیش از ظرفیت جدید است.`); }
  return { errors, data };
}
router.post('/classes/new', mgr, async (req, res, next) => {
  try {
    const { errors, data } = await collect(req, null); if (errors.length) return renderForm(res, null, errors, req.body);
    if (!data.academic_year_id) { const y = await db.get()('academic_years').where({ is_current: 1 }).first(); if (y) data.academic_year_id = y.id; }
    const r = await db.get()('classrooms').insert(data); const id = Array.isArray(r) ? r[0] : r;
    await svc.audit(req, 'create', 'classrooms', id, data.name);
    req.flash('success', 'کلاس ایجاد شد. اکنون دروس و معلمان را تخصیص دهید.'); res.redirect('/classes/' + id);
  } catch (e) { next(e); }
});
router.get('/classes/:id(\\d+)/edit', mgr, async (req, res, next) => { try { const c = await getClass(req, req.params.id); if (!c) return nf(res); await renderForm(res, c); } catch (e) { next(e); } });
router.post('/classes/:id(\\d+)/edit', mgr, async (req, res, next) => {
  try {
    const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const { errors, data } = await collect(req, c); if (errors.length) return renderForm(res, c, errors, { ...c, ...req.body });
    await db.get()('classrooms').where({ id: c.id }).update(data);
    await svc.audit(req, 'update', 'classrooms', c.id, data.name);
    req.flash('success', 'کلاس ذخیره شد.'); res.redirect('/classes/' + c.id);
  } catch (e) { next(e); }
});
router.post('/classes/:id(\\d+)/delete', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const n = Number((await k('students').where({ classroom_id: c.id }).count({ c: '*' }).first()).c);
    if (n) { req.flash('error', 'کلاس دارای دانش‌آموز است. ابتدا دانش‌آموزان را به کلاس دیگری منتقل کنید.'); return res.redirect('/classes/' + c.id); }
    const cs = (await k('class_subjects').where({ classroom_id: c.id }).select('id')).map((x) => x.id);
    if (cs.length) { const a = Number((await k('assessments').whereIn('class_subject_id', cs).count({ c: '*' }).first()).c); if (a) { req.flash('error', 'برای دروس این کلاس ارزشیابی ثبت شده است؛ حذف ممکن نیست.'); return res.redirect('/classes/' + c.id); } await purgeHomework(k, cs); }
    await k('timetable').where({ classroom_id: c.id }).del(); await k('exam_schedule').where({ classroom_id: c.id }).del(); await k('class_subjects').where({ classroom_id: c.id }).del(); await k('classrooms').where({ id: c.id }).del();
    await svc.audit(req, 'delete', 'classrooms', c.id, c.name); req.flash('success', 'کلاس حذف شد.'); res.redirect('/classes');
  } catch (e) { next(e); }
});

router.get('/classes/:id(\\d+)', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const students = await k('students').where({ classroom_id: c.id }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code', 'gender', 'status', 'father_phone', 'mother_phone');
    const subjects = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').where('cs.classroom_id', c.id).orderBy('s.name').select('cs.id', 'cs.weekly_hours', 'cs.max_per_day', 'cs.teacher_id', 's.id as subject_id', 's.name as subject_name', 'u.full_name as teacher_name');
    const data = { title: c.name, c, students, subjects, mgrFlag: isManager(req.user), canCurriculum: require('../lib/caps').has(req.user, 'classes.curriculum'), canStudents: require('../lib/caps').has(req.user, 'classes.students'), canEditClass: require('../lib/caps').has(req.user, 'classes.edit'), canDeleteClass: require('../lib/caps').has(req.user, 'classes.delete') };
    data.plan = await loadPlan(k, c);
    if (data.mgrFlag) {
      data.unassigned = await k('students').whereNull('classroom_id').where({ status: 'active' }).orderBy('last_name').select('id', 'first_name', 'last_name', 'student_code');
    }
    if (M('attendance')) {
      const rows = await k('attendance').where({ classroom_id: c.id }).groupBy('status').select('status').count({ c: '*' });
      const m = Object.fromEntries(rows.map((r) => [r.status, Number(r.c)])); const tot = Object.values(m).reduce((a, b) => a + b, 0);
      data.attRate = tot ? Math.round(((m.present || 0) + (m.late || 0)) * 100 / tot) : null;
    }
    if (M('grades') && !(await svc.gradeScope(req.user, c.id)).onlyTeacherId) { const r = await classResults(k, c.id, {}); const v = r.students.filter((x) => x.overall !== null); data.avg = v.length ? Math.round(v.reduce((a, b) => a + b.overall, 0) / v.length * 100) / 100 : null; data.topStudents = v.sort((a, b) => b.overall - a.overall).slice(0, 3); }
    res.view('classes/show', data);
  } catch (e) { next(e); }
});
router.get('/classes/:id(\\d+)/print', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const students = await k('students').where({ classroom_id: c.id, status: 'active' }).orderBy('last_name').orderBy('first_name');
    res.view('classes/print', { title: 'لیست کلاس ' + c.name, c, students });
  } catch (e) { next(e); }
});

/* تخصیص درس و معلم به کلاس */
router.post('/classes/:id(\\d+)/subjects', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const subject = await k('subjects').where({ id: req.body.subject_id }).first();
    if (!subject) { req.flash('error', 'درس را انتخاب کنید.'); return res.redirect('/classes/' + c.id); }
    if (await k('class_subjects').where({ classroom_id: c.id, subject_id: subject.id }).first()) { req.flash('error', 'این درس قبلاً به کلاس اضافه شده است.'); return res.redirect('/classes/' + c.id); }
    const hours = Math.max(1, Math.min(20, Number(req.body.weekly_hours) || subject.weekly_hours || 2));
    const tid = req.body.teacher_id ? Number(req.body.teacher_id) : null;
    if (tid && !(await k('teachers').where({ id: tid, status: 'active' }).first())) { req.flash('error', 'معلم انتخاب‌شده معتبر یا فعال نیست.'); return res.redirect('/classes/' + c.id); }
    await k('class_subjects').insert({ classroom_id: c.id, subject_id: subject.id, teacher_id: tid, weekly_hours: hours });
    await svc.audit(req, 'assign', 'class_subjects', c.id, `${subject.name} → ${c.name}`);
    req.flash('success', 'درس به کلاس اضافه شد.'); res.redirect('/classes/' + c.id);
  } catch (e) { next(e); }
});
router.post('/classes/:id(\\d+)/subjects/:csid/update', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const teacher_id = req.body.teacher_id ? Number(req.body.teacher_id) : null;
    const hours = Math.max(1, Math.min(20, Number(req.body.weekly_hours) || 2));
    if (teacher_id && !(await k('teachers').where({ id: teacher_id, status: 'active' }).first())) { req.flash('error', 'معلم انتخاب‌شده معتبر یا فعال نیست.'); return res.redirect('/classes/' + c.id); }
    const old = await k('class_subjects').where({ id: req.params.csid, classroom_id: c.id }).first();
    if (!old) return nf(res);
    if (teacher_id && old.teacher_id !== teacher_id && M('timetable')) { // بررسی تداخل در برنامه هفتگی
      const mine = await k('timetable').where({ class_subject_id: old.id }).select('day', 'period');
      for (const s of mine) {
        const clash = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where({ 'cs.teacher_id': teacher_id, 'tt.day': s.day, 'tt.period': s.period }).whereNot('tt.class_subject_id', old.id).first();
        if (clash) { req.flash('error', `معلم انتخاب‌شده در ${J.WEEKDAYS[s.day]} زنگ ${s.period} کلاس دیگری دارد؛ ابتدا برنامه هفتگی را اصلاح کنید.`); return res.redirect('/classes/' + c.id); }
      }
    }
    const mpd = req.body.max_per_day !== undefined ? Math.max(1, Math.min(6, Number(req.body.max_per_day) || 2)) : old.max_per_day;
    await k('class_subjects').where({ id: old.id }).update({ teacher_id, weekly_hours: hours, max_per_day: mpd });
    await svc.audit(req, 'update', 'class_subjects', old.id, '');
    req.flash('success', 'تخصیص بروزرسانی شد.'); res.redirect('/classes/' + c.id);
  } catch (e) { next(e); }
});
router.post('/classes/:id(\\d+)/subjects/:csid/delete', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const cs = await k('class_subjects').where({ id: req.params.csid, classroom_id: c.id }).first(); if (!cs) return nf(res);
    const a = Number((await k('assessments').where({ class_subject_id: cs.id }).count({ c: '*' }).first()).c);
    if (a) { req.flash('error', 'برای این درس ارزشیابی ثبت شده است؛ ابتدا ارزشیابی‌ها را حذف کنید.'); return res.redirect('/classes/' + c.id); }
    await k('timetable').where({ class_subject_id: cs.id }).del(); await purgeHomework(k, [cs.id]); await k('class_subjects').where({ id: cs.id }).del();
    req.flash('success', 'درس از کلاس حذف شد.'); res.redirect('/classes/' + c.id);
  } catch (e) { next(e); }
});

/* ===== برنامه‌ریز درسی کلاس (v2.5): ساعت هفتگی و سقف روزانه‌ی هر درس بر پایه‌ی برنامه هفتگی ===== */
const cur = require('../lib/curriculum');
const settingsLib = require('../settings');
async function loadPlan(k, c) {
  const days = settingsLib.weekDays();
  const rows = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.classroom_id', c.id).orderBy('s.name').select('cs.id', 'cs.subject_id', 'cs.teacher_id', 'cs.weekly_hours', 'cs.max_per_day', 's.name as subject_name', 's.code as subject_code');
  const cap = cur.capacity(days, c.grade_level);
  const ttRows = M('timetable') ? await k('timetable').where({ classroom_id: c.id }).select('class_subject_id', 'day', 'period') : [];
  const valid = ttRows.filter((r) => days.includes(r.day) && bellOk(r, c));
  const placed = cur.placedMap(valid);
  return { days, rows, slots: cap, placed, summary: cur.summarize(rows, cap, placed) };
}
const bell = require('../lib/bell');
const bellOk = (r, c) => bell.periodsFor({ day: r.day, grade: c.grade_level }).some((p) => p.n === r.period);
async function teacherLoads(k, ids) {
  const cs = await k('class_subjects as cs').join('classrooms as c', 'c.id', 'cs.classroom_id').where('c.status', '<>', 'archived').whereNotNull('cs.teacher_id').select('cs.teacher_id', 'cs.weekly_hours');
  const tt = M('timetable') ? await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where('c.status', '<>', 'archived').whereNotNull('cs.teacher_id').select('cs.teacher_id', 'tt.day') : [];
  const tot = cur.teacherTotals(cs, tt); const out = {};
  const ts = await k('teachers').whereIn('id', ids.length ? ids : [0]).select('id', 'weekly_load', 'daily_max');
  for (const t of ts) out[t.id] = { hours: (tot[t.id] || { hours: 0 }).hours, byDay: (tot[t.id] || { byDay: {} }).byDay, load: t.weekly_load || null, dailyMax: t.daily_max || null };
  return out;
}
/** هشدارهای بار کاری معلمان درگیر در تغییر (موظفی هفتگی و سقف روزانه) */
async function loadWarnings(k, teacherIds) {
  const ids = [...new Set(teacherIds.filter(Boolean))]; if (!ids.length) return [];
  const loads = await teacherLoads(k, ids); const names = Object.fromEntries((await k('teachers as t').join('users as u', 'u.id', 't.user_id').whereIn('t.id', ids).select('t.id', 'u.full_name')).map((x) => [x.id, x.full_name]));
  const out = [];
  for (const id of ids) {
    const l = loads[id]; if (!l) continue;
    if (l.load && l.hours > l.load) out.push(`${names[id]}: ${l.hours} ساعت تعریف شده و از موظفی (${l.load}) بیشتر است.`);
    if (l.dailyMax) for (const [d, n] of Object.entries(l.byDay)) if (n > l.dailyMax) out.push(`${names[id]}: در ${J.WEEKDAYS[d]} ${n} ساعت در برنامه دارد (سقف روزانه ${l.dailyMax}).`);
  }
  return out;
}
router.get('/classes/:id(\\d+)/curriculum', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const plan = await loadPlan(k, c);
    const used = plan.rows.map((r) => r.subject_id);
    const subjects = (await k('subjects').orderBy('name').select('id', 'name', 'weekly_hours', 'grade_level')).filter((s) => !used.includes(s.id));
    const teachers = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name', 't.specialty');
    const loads = await teacherLoads(k, teachers.map((t) => t.id));
    const others = await k('classrooms').where('status', '<>', 'archived').whereNot({ id: c.id }).orderBy('name').select('id', 'name');
    const gradeMatch = subjects.filter((s) => c.grade_level && s.grade_level === c.grade_level).length;
    res.view('classes/curriculum', { title: 'برنامه‌ریزی دروس — ' + c.name, c, ...plan, subjects, teachers, loads, others, gradeMatch, WEEKDAYS: J.WEEKDAYS, canEdit: require('../lib/caps').has(req.user, 'classes.curriculum'), hasTimetable: M('timetable') });
  } catch (e) { next(e); }
});
/** ذخیره‌ی گروهی: همه یا هیچ؛ سپس هشدارهای موظفی/ظرفیت */
router.post('/classes/:id(\\d+)/curriculum', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const back = '/classes/' + c.id + '/curriculum';
    const current = await k('class_subjects').where({ classroom_id: c.id });
    const form = cur.parseForm(req.body);
    const plan = cur.planChanges(current, form.rows, form.add);
    const errors = plan.errors.slice();
    const tids = [...plan.updates.map((u) => u.teacher_id), ...plan.inserts.map((i) => i.teacher_id)].filter(Boolean);
    if (tids.length) { const ok = new Set((await k('teachers').whereIn('id', tids).where({ status: 'active' }).select('id')).map((x) => x.id)); if (tids.some((t) => !ok.has(t))) errors.push('معلم انتخاب‌شده معتبر یا فعال نیست.'); }
    if (plan.inserts.length) { const ok = new Set((await k('subjects').whereIn('id', plan.inserts.map((i) => i.subject_id)).select('id')).map((x) => x.id)); if (plan.inserts.some((i) => !ok.has(i.subject_id))) errors.push('درس انتخاب‌شده نامعتبر است.'); }
    for (const r of plan.removes) {
      const a = Number((await k('assessments').where({ class_subject_id: r.id }).count({ c: '*' }).first()).c);
      if (a) { const nm = (await k('subjects').where({ id: r.subject_id }).first('name')).name; errors.push(`برای «${nm}» ارزشیابی ثبت شده است؛ ابتدا ارزشیابی‌ها را حذف کنید.`); }
    }
    if (M('timetable')) for (const u of plan.updates) { // تغییر معلم نباید تداخل برنامه بسازد
      if (!u.teacher_id || u.teacher_id === u.cur.teacher_id) continue;
      for (const s of await k('timetable').where({ class_subject_id: u.cur.id }).select('day', 'period')) {
        const clash = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where({ 'cs.teacher_id': u.teacher_id, 'tt.day': s.day, 'tt.period': s.period }).whereNot('tt.class_subject_id', u.cur.id).first();
        if (clash) { errors.push(`معلم انتخاب‌شده در ${J.WEEKDAYS[s.day]} زنگ ${s.period} کلاس دیگری دارد؛ ابتدا برنامه هفتگی را اصلاح کنید.`); break; }
      }
    }
    if (errors.length) { req.flash('error', [...new Set(errors)].slice(0, 4).join(' | ')); return res.redirect(back); }
    await k.transaction(async (t) => {
      for (const u of plan.updates) await t('class_subjects').where({ id: u.cur.id }).update({ teacher_id: u.teacher_id, weekly_hours: u.weekly_hours, max_per_day: u.max_per_day });
      for (const i of plan.inserts) await t('class_subjects').insert({ classroom_id: c.id, ...i });
      for (const r of plan.removes) { await t('timetable').where({ class_subject_id: r.id }).del(); await purgeHomework(t, [r.id]); await t('class_subjects').where({ id: r.id }).del(); }
    });
    const n = plan.updates.length + plan.inserts.length + plan.removes.length;
    if (n) await svc.audit(req, 'update', 'class_subjects', c.id, `${c.name}: ${plan.updates.length} ویرایش، ${plan.inserts.length} افزودن، ${plan.removes.length} حذف`);
    req.flash('success', n ? `برنامه‌ی دروس ذخیره شد (${plan.updates.length} ویرایش، ${plan.inserts.length} افزودن، ${plan.removes.length} حذف).` : 'تغییری وجود نداشت.');
    const fresh = await loadPlan(k, c); const w = fresh.summary.warnings.filter((x) => x.k !== 'no_teacher').map((x) => x.text);
    w.push(...await loadWarnings(k, [...plan.updates.map((u) => u.teacher_id), ...plan.inserts.map((i) => i.teacher_id)]));
    if (w.length) req.flash('info', 'هشدار: ' + [...new Set(w)].slice(0, 3).join(' | '));
    res.redirect(back);
  } catch (e) { next(e); }
});
/** هم‌گام‌سازی ساعت‌های هفتگی با چیدمان فعلی برنامه هفتگی */
router.post('/classes/:id(\\d+)/curriculum/sync', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res); const back = '/classes/' + c.id + '/curriculum';
    const plan = await loadPlan(k, c); let n = 0;
    await k.transaction(async (t) => {
      for (const r of plan.rows) {
        const p = plan.placed[r.id]; if (!p || !p.total) continue;
        const hours = Math.min(cur.HOURS_MAX, p.total); const mpd = Math.min(cur.PERDAY_MAX, Math.max(r.max_per_day || 1, p.maxDay));
        if (hours !== r.weekly_hours || mpd !== r.max_per_day) { await t('class_subjects').where({ id: r.id }).update({ weekly_hours: hours, max_per_day: mpd }); n++; }
      }
    });
    if (n) await svc.audit(req, 'update', 'class_subjects', c.id, `${c.name}: هم‌گام‌سازی ساعت‌ها با برنامه هفتگی (${n} درس)`);
    req.flash('success', n ? `ساعت ${n} درس بر اساس برنامه هفتگی به‌روز شد.` : 'ساعت‌ها از قبل با برنامه هفتگی هم‌خوان بود.'); res.redirect(back);
  } catch (e) { next(e); }
});
/** افزودن همه‌ی دروس هم‌پایه */
router.post('/classes/:id(\\d+)/curriculum/add-grade', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res); const back = '/classes/' + c.id + '/curriculum';
    if (!c.grade_level) { req.flash('error', 'پایه‌ی این کلاس تعیین نشده است.'); return res.redirect(back); }
    const have = new Set((await k('class_subjects').where({ classroom_id: c.id }).select('subject_id')).map((x) => x.subject_id));
    const list = (await k('subjects').where({ grade_level: c.grade_level }).select('id', 'weekly_hours')).filter((s) => !have.has(s.id));
    for (const s of list) { const h = cur.clamp(s.weekly_hours, 1, cur.HOURS_MAX, 2); await k('class_subjects').insert({ classroom_id: c.id, subject_id: s.id, weekly_hours: h, max_per_day: Math.min(2, h) }); }
    if (list.length) await svc.audit(req, 'assign', 'class_subjects', c.id, `${c.name}: افزودن ${list.length} درس پایه «${c.grade_level}»`);
    req.flash(list.length ? 'success' : 'info', list.length ? `${list.length} درس پایه‌ی «${c.grade_level}» افزوده شد؛ حالا معلم هر درس را تعیین کنید.` : 'درس جدیدی برای این پایه پیدا نشد.'); res.redirect(back);
  } catch (e) { next(e); }
});
/** کپی دروس، ساعت‌ها و معلم‌ها از کلاس دیگر (فقط دروسی که هنوز در این کلاس نیست) */
router.post('/classes/:id(\\d+)/curriculum/copy', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res); const back = '/classes/' + c.id + '/curriculum';
    const src = await k('classrooms').where({ id: Number(req.body.from) || 0 }).first(); if (!src || src.id === c.id) { req.flash('error', 'کلاس مبدأ را انتخاب کنید.'); return res.redirect(back); }
    const keepTeacher = req.body.keep_teacher === '1';
    const have = new Set((await k('class_subjects').where({ classroom_id: c.id }).select('subject_id')).map((x) => x.subject_id));
    const list = (await k('class_subjects').where({ classroom_id: src.id })).filter((r) => !have.has(r.subject_id));
    for (const r of list) await k('class_subjects').insert({ classroom_id: c.id, subject_id: r.subject_id, teacher_id: keepTeacher ? r.teacher_id : null, weekly_hours: r.weekly_hours, max_per_day: r.max_per_day });
    if (list.length) await svc.audit(req, 'assign', 'class_subjects', c.id, `${c.name}: کپی ${list.length} درس از ${src.name}`);
    req.flash(list.length ? 'success' : 'info', list.length ? `${list.length} درس از «${src.name}» کپی شد${keepTeacher ? '' : '؛ معلم‌ها را تعیین کنید'}.` : 'درس جدیدی برای کپی وجود نداشت.'); res.redirect(back);
  } catch (e) { next(e); }
});

/* مدیریت اعضای کلاس */
router.post('/classes/:id(\\d+)/add-students', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const c = await getClass(req, req.params.id); if (!c) return nf(res);
    const wanted = [].concat(req.body.ids || []).map(Number).filter(Boolean);
    if (!wanted.length) { req.flash('error', 'هیچ دانش‌آموزی انتخاب نشده است.'); return res.redirect('/classes/' + c.id); }
    const ids = (await k('students').whereIn('id', wanted).whereNull('classroom_id').where({ status: 'active' }).select('id')).map((x) => x.id);
    const cnt = Number((await k('students').where({ classroom_id: c.id, status: 'active' }).count({ c: '*' }).first()).c);
    if (c.capacity && cnt + ids.length > c.capacity) { req.flash('error', `ظرفیت کلاس (${c.capacity}) کافی نیست؛ ${cnt} نفر عضو هستند.`); return res.redirect('/classes/' + c.id); }
    if (ids.length) await k('students').whereIn('id', ids).update({ classroom_id: c.id });
    await svc.audit(req, 'add_students', 'classrooms', c.id, `${ids.length} نفر`); req.flash('success', `${ids.length} دانش‌آموز به کلاس اضافه شد.`); res.redirect('/classes/' + c.id);
  } catch (e) { next(e); }
});
router.post('/classes/:id(\\d+)/remove-student/:sid', mgr, async (req, res, next) => {
  try { const c = await getClass(req, req.params.id); if (!c) return nf(res); await db.get()('students').where({ id: req.params.sid, classroom_id: c.id }).update({ classroom_id: null }); req.flash('success', 'دانش‌آموز از کلاس خارج شد.'); res.redirect('/classes/' + c.id); } catch (e) { next(e); }
});
module.exports = router;

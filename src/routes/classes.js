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
    const subjects = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').where('cs.classroom_id', c.id).orderBy('s.name').select('cs.id', 'cs.weekly_hours', 'cs.teacher_id', 's.id as subject_id', 's.name as subject_name', 'u.full_name as teacher_name');
    const data = { title: c.name, c, students, subjects, mgrFlag: isManager(req.user) };
    if (data.mgrFlag) {
      const used = subjects.map((s) => s.subject_id);
      data.availableSubjects = (await k('subjects').orderBy('name').select('id', 'name', 'weekly_hours')).filter((s) => !used.includes(s.id));
      data.teachers = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name');
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
    await k('class_subjects').where({ id: old.id }).update({ teacher_id, weekly_hours: hours });
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

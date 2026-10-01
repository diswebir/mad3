'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { requireRole, uploader, isManager } = require('../middleware');
const router = express.Router();
router.use('/homework', modules.guard('homework'));
const staff = requireRole('admin', 'deputy', 'teacher');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'تکلیف مورد نظر یافت نشد یا به آن دسترسی ندارید.' });

async function csOptions(req) {
  const k = db.get();
  const q = k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').orderBy('c.name').orderBy('s.name').select('cs.id', 's.name as sname', 'c.name as cname');
  if (req.user.role === 'teacher') q.where('cs.teacher_id', req.user.teacher ? req.user.teacher.id : 0);
  return (await q).map((x) => [x.id, `${x.cname} — ${x.sname}`]);
}
async function loadHw(req, id) {
  const k = db.get(); const u = req.user;
  const h = await k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').where('h.id', id).first('h.*', 'cs.classroom_id', 'cs.teacher_id', 's.name as subject_name', 'c.name as class_name');
  if (!h) return null;
  if (isManager(u)) return h;
  if (u.role === 'teacher') return u.teacher && h.teacher_id === u.teacher.id ? h : null;
  return u.student && u.student.classroom_id === h.classroom_id ? h : null;
}
const canEdit = (req, h) => isManager(req.user) || (req.user.role === 'teacher' && req.user.teacher && h.teacher_id === req.user.teacher.id);

router.get('/homework', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const today = J.todayISO();
    const q = k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id')
      .orderBy('h.due_date', 'desc').orderBy('h.id', 'desc').limit(100).select('h.*', 's.name as subject_name', 'c.name as class_name');
    if (u.role === 'teacher') q.where('cs.teacher_id', u.teacher ? u.teacher.id : 0);
    if (u.role === 'student') {
      q.where('cs.classroom_id', u.student ? u.student.classroom_id || 0 : 0).leftJoin('homework_submissions as x', function () { this.on('x.homework_id', 'h.id').andOn('x.student_id', k.raw('?', [u.student ? u.student.id : 0])); }).select('x.id as sub_id', 'x.score as my_score', 'x.late as my_late');
    } else {
      q.select(k.raw('(select count(*) from homework_submissions x where x.homework_id = h.id) as sub_count'), k.raw("(select count(*) from students st where st.classroom_id = cs.classroom_id and st.status = 'active') as stu_count"));
      if (req.query.class_id) q.where('cs.classroom_id', req.query.class_id);
    }
    const classes = u.role === 'student' ? [] : await k('classrooms').orderBy('name').select('id', 'name');
    res.view('homework/index', { title: 'تکالیف', rows: await q, today, classes, classId: req.query.class_id || '' });
  } catch (e) { next(e); }
});

async function renderForm(req, res, row, errors, vals) {
  res.view('homework/form', { title: row ? 'ویرایش تکلیف' : 'تکلیف جدید', row, errors: errors || [], opts: await csOptions(req), vals: vals || (row ? { ...row, due_date: J.isoToJString(row.due_date) } : { class_subject_id: req.query.cs || '', due_date: J.isoToJString(J.addDays(J.todayISO(), 7)), max_score: 20 }) });
}
router.get('/homework/new', staff, (req, res, next) => renderForm(req, res, null).catch(next));
async function collect(req, existing) {
  const b = req.body; const errors = []; const opts = await csOptions(req);
  const csId = existing ? existing.class_subject_id : Number(b.class_subject_id);
  if (!opts.find((o) => o[0] === csId)) errors.push('درس/کلاس را انتخاب کنید.');
  if (!b.title || b.title.length < 3) errors.push('عنوان تکلیف را وارد کنید.');
  const due = b.due_date ? J.parseJalali(b.due_date) : null; if (b.due_date && !due) errors.push('مهلت تحویل نامعتبر است.');
  if (due && !existing && due < J.todayISO()) errors.push('مهلت تحویل نمی‌تواند قبل از امروز باشد.');
  const max = Number(b.max_score || 20); if (isNaN(max) || max < 1 || max > 100) errors.push('بیشینه نمره نامعتبر است.');
  if (existing && !isNaN(max)) { const mx = await db.get()('homework_submissions').where({ homework_id: existing.id }).max({ m: 'score' }).first(); if (mx && mx.m !== null && Number(mx.m) > max) errors.push(`بیشینه نمره نمی‌تواند کمتر از بالاترین نمره ثبت‌شده (${mx.m}) باشد.`); }
  return { errors, data: { class_subject_id: csId, title: b.title, description: b.description || null, due_date: due, max_score: max } };
}
router.post('/homework/new', staff, uploader('homework', 'attachment', { maxMB: 5 }), async (req, res, next) => {
  try {
    const k = db.get(); const { errors, data } = await collect(req, null); if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return renderForm(req, res, null, errors, req.body); }
    if (req.file) { data.attachment = req.file.filename; data.attachment_name = req.file.originalname.slice(0, 200); }
    const r = await k('homework').insert({ ...data, created_by: req.user.id }); const id = Array.isArray(r) ? r[0] : r;
    const cs = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.id', data.class_subject_id).first('cs.classroom_id', 's.name');
    const us = await k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).select('user_id');
    await svc.notify(us.map((x) => x.user_id), `تکلیف جدید ${cs.name}`, data.title + (data.due_date ? ' — مهلت: ' + J.isoToJString(data.due_date) : ''), '/homework/' + id);
    await svc.audit(req, 'create', 'homework', id, data.title); req.flash('success', 'تکلیف ثبت شد و به دانش‌آموزان اطلاع داده شد.'); res.redirect('/homework/' + id);
  } catch (e) { next(e); }
});
router.get('/homework/:id(\\d+)/edit', staff, async (req, res, next) => { try { const h = await loadHw(req, req.params.id); if (!h || !canEdit(req, h)) return nf(res); await renderForm(req, res, h); } catch (e) { next(e); } });
router.post('/homework/:id(\\d+)/edit', staff, uploader('homework', 'attachment', { maxMB: 5 }), async (req, res, next) => {
  try {
    const k = db.get(); const h = await loadHw(req, req.params.id); if (!h || !canEdit(req, h)) return nf(res);
    const { errors, data } = await collect(req, h); if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return renderForm(req, res, h, errors, { ...h, ...req.body }); }
    if (req.file) { if (h.attachment) fs.unlink(path.join(config.UPLOAD_DIR, 'homework', h.attachment), () => {}); data.attachment = req.file.filename; data.attachment_name = req.file.originalname.slice(0, 200); }
    await k('homework').where({ id: h.id }).update(data); req.flash('success', 'تکلیف ذخیره شد.'); res.redirect('/homework/' + h.id);
  } catch (e) { next(e); }
});
router.post('/homework/:id(\\d+)/delete', staff, async (req, res, next) => {
  try {
    const k = db.get(); const h = await loadHw(req, req.params.id); if (!h || !canEdit(req, h)) return nf(res);
    const subs = await k('homework_submissions').where({ homework_id: h.id }); subs.forEach((s) => s.file && fs.unlink(path.join(config.UPLOAD_DIR, 'homework', s.file), () => {}));
    if (h.attachment) fs.unlink(path.join(config.UPLOAD_DIR, 'homework', h.attachment), () => {});
    await k('homework_submissions').where({ homework_id: h.id }).del(); await k('homework').where({ id: h.id }).del();
    await svc.audit(req, 'delete', 'homework', h.id, h.title); req.flash('success', 'تکلیف حذف شد.'); res.redirect('/homework');
  } catch (e) { next(e); }
});
router.get('/homework/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const h = await loadHw(req, req.params.id); if (!h) return nf(res);
    const data = { title: h.title, h, today: J.todayISO(), canEdit: canEdit(req, h) };
    if (u.role === 'student') data.mine = await k('homework_submissions').where({ homework_id: h.id, student_id: u.student.id }).first();
    else {
      data.rows = await k('students as s').leftJoin('homework_submissions as x', function () { this.on('x.student_id', 's.id').andOn('x.homework_id', k.raw('?', [h.id])); }).where({ 's.classroom_id': h.classroom_id, 's.status': 'active' }).orderBy('s.last_name').orderBy('s.first_name').select('s.id as sid', 's.first_name', 's.last_name', 'x.*');
    }
    res.view('homework/show', data);
  } catch (e) { next(e); }
});
router.post('/homework/:id(\\d+)/submit', requireRole('student'), uploader('homework', 'file', { maxMB: 5 }), async (req, res, next) => {
  try {
    const k = db.get(); const h = await loadHw(req, req.params.id); if (!h) return nf(res); const sid = req.user.student.id;
    const ex = await k('homework_submissions').where({ homework_id: h.id, student_id: sid }).first();
    if (ex && ex.score !== null) { if (req.file) fs.unlink(req.file.path, () => {}); req.flash('error', 'تکلیف شما نمره‌دهی شده و قابل ویرایش نیست.'); return res.redirect('/homework/' + h.id); }
    if (req.uploadError || (!req.body.answer && !req.file && !(ex && ex.file))) { if (req.file) fs.unlink(req.file.path, () => {}); req.flash('error', req.uploadError || 'متن پاسخ یا فایل را ارسال کنید.'); return res.redirect('/homework/' + h.id); }
    const data = { answer: (req.body.answer || '').slice(0, 5000) || null, submitted_at: svc.nowStr(), late: h.due_date && J.todayISO() > h.due_date ? 1 : 0 };
    if (req.file) { if (ex && ex.file) fs.unlink(path.join(config.UPLOAD_DIR, 'homework', ex.file), () => {}); data.file = req.file.filename; data.file_name = req.file.originalname.slice(0, 200); }
    if (ex) await k('homework_submissions').where({ id: ex.id }).update(data); else await k('homework_submissions').insert({ ...data, homework_id: h.id, student_id: sid });
    const t = await k('teachers').where({ id: h.teacher_id }).first(); if (t) await svc.notify(t.user_id, `تحویل تکلیف: ${h.title}`, req.user.full_name + (data.late ? ' (با تأخیر)' : ''), '/homework/' + h.id);
    req.flash('success', data.late ? 'تکلیف با تأخیر ثبت شد.' : 'تکلیف شما ثبت شد.'); res.redirect('/homework/' + h.id);
  } catch (e) { next(e); }
});
router.post('/homework/:id(\\d+)/grade', staff, async (req, res, next) => {
  try {
    const k = db.get(); const h = await loadHw(req, req.params.id); if (!h || !canEdit(req, h)) return nf(res);
    const sc = req.body.score || {}; const fb = req.body.feedback || {}; const subs = await k('homework_submissions').where({ homework_id: h.id }); let n = 0; const notify = []; let invalid = 0;
    for (const s of subs) {
      const raw = String(sc[s.student_id] === undefined ? '' : sc[s.student_id]).replace(',', '.').replace('٫', '.'); const val = raw === '' ? null : Number(raw);
      if (val !== null && (isNaN(val) || val < 0 || val > h.max_score)) { invalid++; continue; }
      const feedback = (fb[s.student_id] || '').slice(0, 1000) || null;
      if ((s.score === null ? null : Number(s.score)) !== val || (s.feedback || null) !== feedback) { await k('homework_submissions').where({ id: s.id }).update({ score: val, feedback }); n++; if (val !== null && s.score === null) notify.push(s.student_id); }
    }
    if (notify.length) { const us = await k('students').whereIn('id', notify).select('user_id'); await svc.notify(us.map((x) => x.user_id), `نمره تکلیف ${h.title} ثبت شد`, '', '/homework/' + h.id, 'success'); }
    if (invalid) req.flash('error', `${invalid} نمره نامعتبر بود (باید بین ۰ و ${h.max_score} باشد) و ثبت نشد.`);
    req.flash('success', `${n} مورد بروزرسانی شد.`); res.redirect('/homework/' + h.id);
  } catch (e) { next(e); }
});
module.exports = router;

'use strict';
/** دفتر کلاسی: ثبت درس/مبحث تدریس‌شده‌ی هر جلسه، تکلیف و یادداشت + گزارش پوشش برای مدیر */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const settings = require('../settings');
const J = require('../utils/jalali');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/lessonlog', modules.guard('lessonlog'));
const staff = requireRole('admin', 'deputy', 'teacher');
const mgr = requireRole('admin', 'deputy');
const notFound = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'این مورد یافت نشد یا به آن دسترسی ندارید.' });
const myTid = (u) => (u.teacher ? u.teacher.id : 0);

/** واحدهای (کلاس–درس) قابل‌ثبت برای کاربر */
async function csOptions(req) {
  const q = db.get()('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').where('c.status', '<>', 'archived')
    .orderBy('c.name').orderBy('s.name').select('cs.id', 'cs.classroom_id', 'cs.teacher_id', 's.name as sname', 'c.name as cname');
  if (req.user.role === 'teacher') q.where('cs.teacher_id', myTid(req.user));
  return q;
}
const baseQuery = () => db.get()('lesson_logs as l').join('class_subjects as cs', 'cs.id', 'l.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'l.classroom_id')
  .leftJoin('teachers as t', 't.id', 'l.teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id')
  .select('l.*', 's.name as subject_name', 'c.name as class_name', 'tu.full_name as teacher_name');
const canEdit = (req, l) => isManager(req.user) || (req.user.role === 'teacher' && l.teacher_id === myTid(req.user));

router.get('/lessonlog', async (req, res, next) => {
  try {
    const u = req.user; const q = baseQuery().orderBy('l.log_date', 'desc').orderBy('l.period', 'desc').orderBy('l.id', 'desc');
    const f = { cs: Number(req.query.cs) || '', from: req.query.from || '', to: req.query.to || '', q: String(req.query.q || '').trim() };
    if (u.role === 'student') { q.where('l.classroom_id', u.student ? u.student.classroom_id || 0 : 0).where('l.visible', true).where('l.status', 'held'); }
    else if (u.role === 'teacher') q.where('l.teacher_id', myTid(u));
    if (f.cs) q.where('l.class_subject_id', f.cs);
    const from = f.from ? J.parseJalali(f.from) : null; const to = f.to ? J.parseJalali(f.to) : null;
    if (from) q.where('l.log_date', '>=', from); if (to) q.where('l.log_date', '<=', to);
    if (f.q) q.where((b) => b.where('l.topic', 'like', `%${f.q}%`).orWhere('l.content', 'like', `%${f.q}%`).orWhere('l.homework', 'like', `%${f.q}%`));
    const pg = await require('../utils/paginate').paginate(q, req, 20);
    const opts = u.role === 'student' ? [] : await csOptions(req);
    res.view('lessonlog/index', { title: 'دفتر کلاسی', rows: pg.rows, total: pg.total, page: pg.page, pages: pg.pages, opts, f, canWrite: u.role !== 'student', canEditRow: (l) => u.role !== 'student' && canEdit(req, l) });
  } catch (e) { next(e); }
});

router.get('/lessonlog/coverage', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const today = J.todayISO();
    const to = (req.query.to && J.parseJalali(req.query.to)) || today; const from = (req.query.from && J.parseJalali(req.query.from)) || J.addDays(to, -29);
    const weeks = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000 / 7 + 0.4));
    const cs = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id')
      .where('c.status', '<>', 'archived').orderBy('c.name').orderBy('s.name').select('cs.id', 'cs.weekly_hours', 'cs.teacher_id', 's.name as sname', 'c.name as cname', 'tu.full_name as tname');
    const agg = await k('lesson_logs').where('log_date', '>=', from).where('log_date', '<=', to).groupBy('class_subject_id', 'status').select('class_subject_id', 'status').count({ n: '*' });
    const last = await k('lesson_logs').groupBy('class_subject_id').select('class_subject_id').max({ d: 'log_date' });
    const held = {}; const canc = {}; for (const a of agg) (a.status === 'held' ? held : canc)[a.class_subject_id] = Number(a.n);
    const lastBy = Object.fromEntries(last.map((x) => [x.class_subject_id, x.d]));
    const rows = cs.map((c) => { const exp = Math.round((c.weekly_hours || 0) * weeks); const h = held[c.id] || 0; const pct = exp ? Math.min(100, Math.round((h / exp) * 100)) : 0; return { ...c, expected: exp, held: h, cancelled: canc[c.id] || 0, pct, last: lastBy[c.id] || null, stale: !lastBy[c.id] || J.addDays(lastBy[c.id], 14) < today }; });
    const silent = [...new Map(rows.filter((r) => r.teacher_id && !r.held).map((r) => [r.teacher_id, r.tname])).entries()].filter(([tid]) => !rows.some((r) => r.teacher_id === tid && r.held));
    res.view('lessonlog/coverage', { title: 'پوشش دفتر کلاسی', rows, silent, from: J.isoToJString(from), to: J.isoToJString(to), weeks });
  } catch (e) { next(e); }
});

async function renderForm(req, res, row, errors, vals) {
  const opts = await csOptions(req); const count = Math.min(12, Math.max(1, settings.num('periods_count') || 6));
  res.view('lessonlog/form', { title: row ? 'ویرایش جلسه' : 'ثبت جلسه‌ی جدید', row, errors: errors || [], opts, count, vals: vals || (row ? { ...row, log_date: J.isoToJString(row.log_date) } : { class_subject_id: req.query.cs || '', log_date: J.isoToJString(J.todayISO()), status: 'held', visible: 1 }) });
}
router.get('/lessonlog/new', staff, (req, res, next) => renderForm(req, res, null).catch(next));
async function collect(req, existing) {
  const b = req.body; const errors = []; const opts = await csOptions(req);
  const csId = existing ? existing.class_subject_id : Number(b.class_subject_id) || 0; const cs = opts.find((o) => o.id === csId);
  if (!cs) errors.push('درس و کلاس را انتخاب کنید.');
  const date = J.parseJalali(b.log_date); if (!date) errors.push('تاریخ جلسه نامعتبر است.'); else if (date > J.addDays(J.todayISO(), 0) && req.user.role === 'teacher') errors.push('ثبت دفتر کلاسی برای روزهای آینده ممکن نیست.');
  const period = b.period ? Number(b.period) : null; if (b.period && (!Number.isInteger(period) || period < 1 || period > 12)) errors.push('شماره‌ی زنگ نامعتبر است.');
  const status = b.status === 'cancelled' ? 'cancelled' : 'held';
  const topic = String(b.topic || '').trim(); if (topic.length < 2) errors.push(status === 'cancelled' ? 'دلیل برگزارنشدن کلاس را بنویسید.' : 'مبحث تدریس‌شده را بنویسید.');
  if (cs && date && period) { const dup = await db.get()('lesson_logs').where({ class_subject_id: cs.id, log_date: date, period }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first(); if (dup) errors.push('برای این درس در همین تاریخ و زنگ قبلاً جلسه ثبت شده است.'); }
  return { errors, data: cs ? { class_subject_id: cs.id, classroom_id: cs.classroom_id, teacher_id: cs.teacher_id || null, log_date: date, period, status, topic: topic.slice(0, 200), content: String(b.content || '').trim().slice(0, 4000) || null, homework: String(b.homework || '').trim().slice(0, 2000) || null, visible: b.visible ? 1 : 0 } : {} };
}
router.post('/lessonlog/new', staff, async (req, res, next) => {
  try {
    const { errors, data } = await collect(req, null); if (errors.length) return renderForm(req, res, null, errors, req.body);
    const r = await db.get()('lesson_logs').insert({ ...data, created_by: req.user.id }); const id = Array.isArray(r) ? r[0] : r;
    await svc.audit(req, 'create', 'lesson_logs', id, data.topic); req.flash('success', 'جلسه در دفتر کلاسی ثبت شد.'); res.redirect('/lessonlog' + (req.body.again ? '/new?cs=' + data.class_subject_id : ''));
  } catch (e) { next(e); }
});
async function load(req, id) { const l = await db.get()('lesson_logs').where({ id: Number(id) || 0 }).first(); return l && canEdit(req, l) ? l : null; }
router.get('/lessonlog/:id(\\d+)/edit', staff, async (req, res, next) => { try { const l = await load(req, req.params.id); if (!l) return notFound(res); await renderForm(req, res, l); } catch (e) { next(e); } });
router.post('/lessonlog/:id(\\d+)/edit', staff, async (req, res, next) => {
  try {
    const l = await load(req, req.params.id); if (!l) return notFound(res);
    const { errors, data } = await collect(req, l); if (errors.length) return renderForm(req, res, l, errors, req.body);
    delete data.teacher_id; delete data.classroom_id; delete data.class_subject_id;
    await db.get()('lesson_logs').where({ id: l.id }).update({ ...data, updated_at: svc.nowStr() });
    await svc.audit(req, 'update', 'lesson_logs', l.id, data.topic); req.flash('success', 'جلسه ویرایش شد.'); res.redirect('/lessonlog');
  } catch (e) { next(e); }
});
router.post('/lessonlog/:id(\\d+)/delete', staff, async (req, res, next) => {
  try {
    const l = await load(req, req.params.id); if (!l) return notFound(res);
    await db.get()('lesson_logs').where({ id: l.id }).del(); await svc.audit(req, 'delete', 'lesson_logs', l.id, l.topic); req.flash('success', 'جلسه حذف شد.'); res.redirect('/lessonlog');
  } catch (e) { next(e); }
});
module.exports = router;

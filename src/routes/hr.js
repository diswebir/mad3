'use strict';
/** منابع انسانی معلمان (مورد ۱۳): مرخصی، موظفی، ارزشیابی */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const settings = require('../settings');
const J = require('../utils/jalali');
const hr = require('../lib/hr');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/hr', modules.guard('hr'), requireRole('admin', 'deputy', 'teacher'));
const mgr = requireRole('admin', 'deputy');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد یافت نشد.' });
const noAccess = (res) => res.status(403).view('error', { code: 403, title: 'دسترسی ندارید', message: 'این بخش برای شما در دسترس نیست.' });

/** بازه‌ی سال تحصیلی جاری؛ در نبود آن سال میلادی جاری */
async function yearSpan(k) { const y = await k('academic_years').where({ is_current: 1 }).first(); if (y && y.start_date && y.end_date) return [y.start_date, y.end_date]; const yr = J.todayISO().slice(0, 4); return [`${yr}-01-01`, `${yr}-12-31`]; }
async function leaveSummary(k, teacherIds) {
  const [from, to] = await yearSpan(k); const quota = settings.num('hr_annual_leave_days'); const out = {};
  const rows = await k('teacher_leaves').whereIn('teacher_id', teacherIds.concat([0])).where('status', 'approved').where('start_date', '<=', to).where('end_date', '>=', from);
  for (const id of teacherIds) out[id] = { casual: 0, other: 0, quota, left: quota };
  for (const l of rows) { const d = hr.daysWithin(l, from, to) || 0; const o = out[l.teacher_id]; if (l.kind === 'casual') o.casual += d; else o.other += d; }
  for (const id of teacherIds) out[id].left = Math.max(0, quota - out[id].casual);
  return out;
}
const teacherBase = (k) => k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', '<>', 'inactive');

router.get('/hr', async (req, res, next) => {
  try {
    const k = db.get();
    if (req.user.role === 'teacher') { if (!req.user.teacher) return noAccess(res); return res.redirect('/hr/teacher/' + req.user.teacher.id); }
    const ts = await teacherBase(k).orderBy('u.full_name').select('t.id', 'u.full_name', 't.weekly_load', 't.specialty', 't.status',
      k.raw('(select coalesce(sum(weekly_hours),0) from class_subjects cs where cs.teacher_id = t.id) as hours'));
    const ids = ts.map((t) => t.id); const ls = await leaveSummary(k, ids);
    const ev = {}; for (const e of await k('teacher_evaluations').whereIn('teacher_id', ids.concat([0])).orderBy('eval_date')) ev[e.teacher_id] = e;
    const subs = {}; for (const r of await k('substitutions').groupBy('substitute_teacher_id').select('substitute_teacher_id as id').count({ n: '*' })) subs[r.id] = Number(r.n);
    const rows = ts.map((t) => ({ ...t, hours: Number(t.hours), load: hr.loadStatus(t.hours, t.weekly_load), leave: ls[t.id], lastEval: ev[t.id] || null, subs: subs[t.id] || 0 }));
    const pending = Number((await k('teacher_leaves').where({ status: 'pending' }).count({ c: '*' }).first()).c);
    const today = J.todayISO(); const onLeave = await k('teacher_leaves as l').join('teachers as t', 't.id', 'l.teacher_id').join('users as u', 'u.id', 't.user_id').where('l.status', 'approved').where('l.start_date', '<=', today).where('l.end_date', '>=', today).select('u.full_name', 'l.kind', 'l.end_date');
    res.view('hr/index', { title: 'منابع انسانی معلمان', rows, pending, onLeave });
  } catch (e) { next(e); }
});

router.get('/hr/leaves', async (req, res, next) => {
  try {
    const k = db.get(); const isM = isManager(req.user); if (!isM && !req.user.teacher) return noAccess(res);
    const status = Object.keys(hr.LEAVE_STATUS).includes(req.query.status) ? req.query.status : '';
    const q = k('teacher_leaves as l').join('teachers as t', 't.id', 'l.teacher_id').join('users as u', 'u.id', 't.user_id').orderByRaw("case l.status when 'pending' then 0 else 1 end").orderBy('l.start_date', 'desc').select('l.*', 'u.full_name');
    if (!isM) q.where('l.teacher_id', req.user.teacher.id); if (status) q.where('l.status', status);
    const pg = await require('../utils/paginate').paginate(q, req, 25);
    res.view('hr/leaves', { title: 'مرخصی معلمان', rows: pg.rows, page: pg.page, pages: pg.pages, total: pg.total, status, isM, LK: hr.LEAVE_KINDS, LS: hr.LEAVE_STATUS });
  } catch (e) { next(e); }
});
router.get('/hr/leaves/new', async (req, res, next) => {
  try {
    const k = db.get(); const isM = isManager(req.user); if (!isM && !req.user.teacher) return noAccess(res);
    const teachers = isM ? await teacherBase(k).orderBy('u.full_name').select('t.id', 'u.full_name') : [];
    res.view('hr/leave-form', { title: 'ثبت مرخصی', teachers, isM, LK: hr.LEAVE_KINDS, form: {} });
  } catch (e) { next(e); }
});
router.post('/hr/leaves', async (req, res, next) => {
  try {
    const k = db.get(); const isM = isManager(req.user); const b = req.body; if (!isM && !req.user.teacher) return noAccess(res);
    const tid = isM ? Number(b.teacher_id) : req.user.teacher.id; const t = tid ? await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.id', tid).select('t.id', 'u.full_name', 'u.id as user_id').first() : null;
    const s = J.parseJalali(b.start_date); const e = J.parseJalali(b.end_date || b.start_date); const errors = [];
    if (!t) errors.push('معلم را انتخاب کنید.');
    if (!hr.LEAVE_KINDS[b.kind]) errors.push('نوع مرخصی نامعتبر است.');
    if (!s || !e) errors.push('تاریخ شروع و پایان را درست وارد کنید.'); else if (e < s) errors.push('تاریخ پایان نباید قبل از شروع باشد.');
    const days = s && e && e >= s ? hr.daysBetween(s, e) : NaN; if (days > 120) errors.push('بازه‌ی مرخصی بیش از حد طولانی است.');
    if (!errors.length) {
      const clash = await k('teacher_leaves').where({ teacher_id: t.id }).whereIn('status', ['pending', 'approved']).where('start_date', '<=', e).where('end_date', '>=', s).first();
      if (clash) errors.push('در این بازه مرخصی دیگری (در انتظار یا تأییدشده) ثبت شده است.');
    }
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/hr/leaves/new'); }
    const status = isM ? 'approved' : 'pending';
    const [id] = await k('teacher_leaves').insert({ teacher_id: t.id, kind: b.kind, start_date: s, end_date: e, days, reason: (b.reason || '').slice(0, 1000) || null, status, decided_by: isM ? req.user.id : null, decided_at: isM ? svc.nowStr() : null });
    await svc.audit(req, 'create', 'teacher_leaves', Array.isArray(id) ? id[0] : id, `${t.full_name} ${s}→${e}`);
    if (!isM) { const ms = await k('users').whereIn('role', ['admin', 'deputy']).where({ active: 1 }).select('id'); await svc.notify(ms.map((x) => x.id), 'درخواست مرخصی معلم', `${t.full_name}: ${days} روز`, '/hr/leaves?status=pending', 'warn'); }
    else await svc.notify(t.user_id, 'مرخصی برای شما ثبت شد', `${days} روز`, '/hr/leaves', 'info');
    req.flash('success', isM ? 'مرخصی ثبت و تأیید شد. در صورت نیاز جانشین تعیین کنید.' : 'درخواست مرخصی ثبت شد و پس از بررسی اعلام می‌شود.'); res.redirect('/hr/leaves');
  } catch (e) { next(e); }
});
router.post('/hr/leaves/:id(\\d+)/decide', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const l = await k('teacher_leaves').where({ id: req.params.id }).first(); if (!l) return nf(res);
    const st = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
    if (!st) { req.flash('error', 'تصمیم نامعتبر است.'); return res.redirect('/hr/leaves'); }
    if (l.status !== 'pending') { req.flash('error', 'این درخواست قبلاً بررسی شده است.'); return res.redirect('/hr/leaves'); }
    if (st === 'rejected' && !(req.body.note || '').trim()) { req.flash('error', 'برای رد درخواست دلیل را بنویسید.'); return res.redirect('/hr/leaves'); }
    await k('teacher_leaves').where({ id: l.id }).update({ status: st, decided_by: req.user.id, decided_at: svc.nowStr(), decision_note: (req.body.note || '').slice(0, 250) || null });
    const t = await k('teachers').where({ id: l.teacher_id }).first();
    await svc.notify(t.user_id, st === 'approved' ? 'مرخصی شما تأیید شد' : 'درخواست مرخصی شما رد شد', (req.body.note || '').slice(0, 250) || `${J.isoToJString(l.start_date)} تا ${J.isoToJString(l.end_date)}`, '/hr/leaves', st === 'approved' ? 'success' : 'warn');
    await svc.audit(req, st === 'approved' ? 'approve' : 'reject', 'teacher_leaves', l.id, 'teacher ' + l.teacher_id);
    req.flash('success', st === 'approved' ? 'مرخصی تأیید شد. برای تعیین جانشین به «جانشینی» بروید.' : 'درخواست رد شد.'); res.redirect('/hr/leaves');
  } catch (e) { next(e); }
});
router.post('/hr/leaves/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const k = db.get(); const l = await k('teacher_leaves').where({ id: req.params.id }).first(); if (!l) return nf(res);
    const own = req.user.teacher && l.teacher_id === req.user.teacher.id;
    if (isManager(req.user)) { if (req.user.role !== 'admin' && l.status !== 'pending') return noAccess(res); } else if (!own || l.status !== 'pending') return noAccess(res);
    await k('teacher_leaves').where({ id: l.id }).del(); await svc.audit(req, 'delete', 'teacher_leaves', l.id, 'teacher ' + l.teacher_id);
    req.flash('success', 'حذف شد.'); res.redirect('/hr/leaves');
  } catch (e) { next(e); }
});

router.get('/hr/teacher/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const isM = isManager(req.user); const t = await teacherBase(k).where('t.id', req.params.id).select('t.*', 'u.full_name', 'u.phone', 'u.email').first(); if (!t) return nf(res);
    if (!isM && !(req.user.teacher && req.user.teacher.id === t.id)) return noAccess(res);
    const hours = Number((await k('class_subjects').where({ teacher_id: t.id }).sum({ h: 'weekly_hours' }).first()).h || 0);
    const classes = await k('class_subjects as cs').join('classrooms as c', 'c.id', 'cs.classroom_id').join('subjects as s', 's.id', 'cs.subject_id').where('cs.teacher_id', t.id).where('c.status', '<>', 'archived').select('c.name as class_name', 's.name as subject_name', 'cs.weekly_hours');
    const leaves = await k('teacher_leaves').where({ teacher_id: t.id }).orderBy('start_date', 'desc').limit(50);
    const evals = await k('teacher_evaluations as e').leftJoin('users as u', 'u.id', 'e.evaluator_id').where('e.teacher_id', t.id).orderBy('e.eval_date', 'desc').select('e.*', 'u.full_name as evaluator');
    evals.forEach((e) => { try { e.sc = JSON.parse(e.scores || '{}'); } catch (_) { e.sc = {}; } });
    const given = Number((await k('substitutions').where({ substitute_teacher_id: t.id }).count({ c: '*' }).first()).c);
    const missed = Number((await k('substitutions').where({ absent_teacher_id: t.id }).count({ c: '*' }).first()).c);
    const ls = (await leaveSummary(k, [t.id]))[t.id];
    res.view('hr/teacher', { title: t.full_name + ' — منابع انسانی', t, hours, load: hr.loadStatus(hours, t.weekly_load), classes, leaves, evals, given, missed, ls, isM, LK: hr.LEAVE_KINDS, LS: hr.LEAVE_STATUS, CR: hr.CRITERIA });
  } catch (e) { next(e); }
});
router.post('/hr/teacher/:id(\\d+)/load', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const t = await k('teachers').where({ id: req.params.id }).first(); if (!t) return nf(res);
    const v = req.body.weekly_load === '' ? null : Number(req.body.weekly_load);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 60)) { req.flash('error', 'ساعت موظفی باید عددی بین ۰ تا ۶۰ باشد.'); return res.redirect('/hr/teacher/' + t.id); }
    await k('teachers').where({ id: t.id }).update({ weekly_load: v }); await svc.audit(req, 'update', 'teachers', t.id, 'weekly_load=' + v);
    req.flash('success', 'موظفی ذخیره شد.'); res.redirect('/hr/teacher/' + t.id);
  } catch (e) { next(e); }
});

router.get('/hr/evaluations/new', mgr, async (req, res, next) => {
  try { const k = db.get(); res.view('hr/eval-form', { title: 'ارزشیابی معلم', teachers: await teacherBase(k).orderBy('u.full_name').select('t.id', 'u.full_name'), teacherId: Number(req.query.teacher_id) || null, CR: hr.CRITERIA }); } catch (e) { next(e); }
});
router.post('/hr/evaluations', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const t = await k('teachers').where({ id: Number(b.teacher_id) || 0 }).first(); const errors = [];
    if (!t) errors.push('معلم را انتخاب کنید.');
    const scores = {}; for (const c of hr.CRITERIA) { const v = Number(b['s_' + c.key]); if (!(v >= 1 && v <= 5) || !Number.isInteger(v)) errors.push(`امتیاز «${c.label}» باید ۱ تا ۵ باشد.`); else scores[c.key] = v; }
    const d = J.parseJalali(b.eval_date) || J.todayISO(); const term = Math.min(4, Math.max(1, Number(b.term) || 1));
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/hr/evaluations/new' + (t ? '?teacher_id=' + t.id : '')); }
    const total = hr.evalTotal(scores);
    const [id] = await k('teacher_evaluations').insert({ teacher_id: t.id, eval_date: d, term, scores: JSON.stringify(scores), total, comment: (b.comment || '').slice(0, 2000) || null, evaluator_id: req.user.id });
    await svc.audit(req, 'create', 'teacher_evaluations', Array.isArray(id) ? id[0] : id, `teacher ${t.id} total ${total}`);
    req.flash('success', 'ارزشیابی ثبت شد.'); res.redirect('/hr/teacher/' + t.id);
  } catch (e) { next(e); }
});
router.post('/hr/evaluations/:id(\\d+)/delete', requireRole('admin'), async (req, res, next) => {
  try { const k = db.get(); const e = await k('teacher_evaluations').where({ id: req.params.id }).first(); if (!e) return nf(res); await k('teacher_evaluations').where({ id: e.id }).del(); await svc.audit(req, 'delete', 'teacher_evaluations', e.id, 'teacher ' + e.teacher_id); req.flash('success', 'حذف شد.'); res.redirect('/hr/teacher/' + e.teacher_id); } catch (e) { next(e); }
});
module.exports = router;

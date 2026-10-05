'use strict';
/** اولیای مجاز به تحویل + برگه‌های خروج زودهنگام و ورود با تأخیر */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const sms = require('../lib/sms');
const J = require('../utils/jalali');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');

/* ---------- افراد مجاز ---------- */
router.post('/students/:id(\\d+)/guardians', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const s = await k('students').where({ id: req.params.id }).first(); if (!s) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'دانش‌آموز یافت نشد.' });
    const b = req.body; const errors = [];
    if (!b.name || b.name.trim().length < 3) errors.push('نام فرد را وارد کنید.');
    if (b.phone && !svc.validPhone(b.phone)) errors.push('تلفن معتبر نیست.');
    if (b.national_id && !svc.validNationalId(b.national_id)) errors.push('کد ملی معتبر نیست.');
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect(`/students/${s.id}?tab=guardians`); }
    await k('student_guardians').insert({ student_id: s.id, name: b.name.trim().slice(0, 120), relation: (b.relation || '').slice(0, 40) || null, phone: b.phone || null, national_id: b.national_id || null, can_pickup: b.can_pickup ? 1 : 0, is_legal: b.is_legal ? 1 : 0, notes: (b.notes || '').slice(0, 250) || null });
    await svc.audit(req, 'create', 'student_guardians', s.id, b.name);
    req.flash('success', 'فرد مجاز ثبت شد.'); res.redirect(`/students/${s.id}?tab=guardians`);
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/guardians/:gid(\\d+)/delete', mgr, async (req, res, next) => {
  try {
    await db.get()('student_guardians').where({ id: req.params.gid, student_id: req.params.id }).del();
    await svc.audit(req, 'delete', 'student_guardians', Number(req.params.gid), 'student ' + req.params.id);
    req.flash('success', 'حذف شد.'); res.redirect(`/students/${req.params.id}?tab=guardians`);
  } catch (e) { next(e); }
});

/* ---------- برگه‌های خروج ---------- */
const guard = [requireRole('admin', 'deputy', 'teacher'), modules.guard('exits')];
router.get('/exits', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const ids = await svc.accessibleClassIds(req.user);
    const date = (req.query.date && J.parseJalali(req.query.date)) || J.todayISO();
    const q = k('exit_permits as e').join('students as s', 's.id', 'e.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('e.permit_date', date).orderBy('e.id', 'desc').select('e.*', 's.first_name', 's.last_name', 'c.name as class_name');
    if (ids) q.whereIn('s.classroom_id', ids.length ? ids : [0]);
    const rows = await q; const data = { title: 'برگه‌های خروج', date, rows, student: null, guardians: [], classes: [], students: [], canIssue: isManager(req.user) };
    if (data.canIssue) {
      const sid = Number(req.query.student_id) || null;
      if (sid) {
        data.student = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.id', sid).first('s.*', 'c.name as class_name');
        if (data.student) data.guardians = await k('student_guardians').where({ student_id: sid, can_pickup: 1 }).orderBy('id');
      }
      if (!data.student) { data.classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'); const cid = Number(req.query.class_id) || null; if (cid) data.students = await k('students').where({ classroom_id: cid, status: 'active' }).orderBy('last_name').select('id', 'first_name', 'last_name'); data.classId = cid; }
    }
    res.view('exits/index', data);
  } catch (e) { next(e); }
});
router.post('/exits', mgr, modules.guard('exits'), async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const s = await k('students').where({ id: Number(b.student_id), status: 'active' }).first();
    const errors = []; if (!s) errors.push('دانش‌آموز نامعتبر است.');
    const kind = b.kind === 'late' ? 'late' : 'exit'; const date = J.parseJalali(b.permit_date) || J.todayISO();
    if (b.permit_time && !svc.validTime(b.permit_time)) errors.push('ساعت معتبر نیست.');
    if (!b.reason || b.reason.trim().length < 3) errors.push('علت را وارد کنید.');
    if (kind === 'exit' && !(b.picked_up_by || '').trim()) errors.push('نام تحویل‌گیرنده را وارد کنید.');
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/exits' + (s ? '?student_id=' + s.id : '')); }
    const time = b.permit_time || J.nowHM(); const by = (b.picked_up_by || '').trim().slice(0, 120) || null;
    let warn = '';
    if (kind === 'exit' && by) { // تحویل‌گیرنده باید پدر/مادر/سرپرست یا فرد ثبت‌شده باشد
      const known = [s.father_name, s.mother_name, s.guardian_name, ...(await k('student_guardians').where({ student_id: s.id, can_pickup: 1 }).select('name')).map((g) => g.name)].filter(Boolean);
      if (!known.includes(by)) warn = ' (توجه: این فرد در فهرست افراد مجاز ثبت نشده است)';
    }
    await k('exit_permits').insert({ student_id: s.id, kind, permit_date: date, permit_time: time, reason: b.reason.trim().slice(0, 250), picked_up_by: by, approved_by: req.user.id, approved_name: req.user.full_name });
    const tpl = kind === 'exit' ? 'اولیای گرامی، {student} امروز ساعت {time} با {by} از مدرسه خارج شد. {school}' : 'اولیای گرامی، برای {student} مجوز ورود با تأخیر (ساعت {time}) صادر شد. {school}';
    await sms.notifyParents([s], (x) => sms.render(tpl, { student: `${x.first_name} ${x.last_name}`, time, by: by || '' }), 'exit', req.user.id);
    await svc.audit(req, 'create', 'exit_permits', s.id, `${kind} ${s.first_name} ${s.last_name}`);
    req.flash('success', 'برگه صادر شد' + warn + '.'); res.redirect('/exits');
  } catch (e) { next(e); }
});
router.post('/exits/:id(\\d+)/delete', requireRole('admin'), modules.guard('exits'), async (req, res, next) => {
  try { await db.get()('exit_permits').where({ id: req.params.id }).del(); await svc.audit(req, 'delete', 'exit_permits', Number(req.params.id), ''); req.flash('success', 'برگه حذف شد.'); res.redirect('/exits'); } catch (e) { next(e); }
});
module.exports = router;

'use strict';
/** پیام گروهی (اعلان درون‌برنامه‌ای و/یا پیامک) و گزارش پیامک‌ها */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const sms = require('../lib/sms');
const J = require('../utils/jalali');
const settings = require('../settings');
const { requireRole } = require('../middleware');
const router = express.Router();
const guard = [requireRole('admin', 'deputy'), modules.guard('sms')];

/** مخاطبان: all_parents | class:ID | grade:NAME | debtors | teachers | students_all */
async function resolveAudience(spec) {
  const k = db.get(); const [type, val] = String(spec || '').split(':');
  const base = () => k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').select('s.*', 'c.name as class_name');
  if (type === 'teachers') {
    const t = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').where('u.active', 1).select('u.id as user_id', 'u.full_name', 'u.phone');
    return { type, label: 'همه معلمان فعال', teachers: t, students: [] };
  }
  let qb = base();
  let label = 'اولیای همه دانش‌آموزان';
  if (type === 'class') { const c = await k('classrooms').where({ id: Number(val) }).first(); if (!c) return null; qb = qb.where('s.classroom_id', c.id); label = 'اولیای کلاس ' + c.name; }
  else if (type === 'grade') { qb = qb.where('c.grade_level', val); label = 'اولیای پایه ' + val; }
  else if (type === 'students_all') label = 'همه دانش‌آموزان (درون‌برنامه‌ای)';
  else if (type === 'debtors') label = 'اولیای دانش‌آموزان بدهکار';
  else if (type !== 'all_parents') return null;
  let students = await qb.orderBy('s.last_name');
  if (type === 'debtors') {
    const rows = await k('fees as f').leftJoin(k('payments').where('voided', 0).select('fee_id').sum({ paid: 'amount' }).groupBy('fee_id').as('p'), 'p.fee_id', 'f.id').select('f.student_id', k.raw('sum(f.amount - coalesce(f.discount,0) - coalesce(p.paid,0)) as due')).groupBy('f.student_id');
    const due = Object.fromEntries(rows.filter((r) => Number(r.due) > 0).map((r) => [r.student_id, Number(r.due)]));
    students = students.filter((s) => due[s.id]).map((s) => ({ ...s, due: due[s.id] }));
  }
  return { type, label, students, teachers: [] };
}

router.get('/messages', ...guard, async (req, res, next) => {
  try {
    const k = db.get();
    const [classes, grades, templates, history] = await Promise.all([
      k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'),
      k('classrooms').where('status', '<>', 'archived').whereNotNull('grade_level').distinct('grade_level'),
      k('message_templates').orderBy('title'),
      k('group_messages as g').leftJoin('users as u', 'u.id', 'g.sent_by').orderBy('g.id', 'desc').limit(15).select('g.*', 'u.full_name as sender'),
    ]);
    res.view('messages/index', { title: 'پیام گروهی', classes, grades: grades.map((g) => g.grade_level).filter(Boolean), templates, history, smsOn: sms.config().enabled, provider: sms.config().provider, errors: [], vals: { channels: 'app', audience: 'all_parents' } });
  } catch (e) { next(e); }
});
router.post('/messages/send', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const errors = [];
    const channels = ['app', 'sms', 'both'].includes(b.channels) ? b.channels : 'app';
    if (!b.title || b.title.length < 2) errors.push('عنوان پیام را وارد کنید.');
    if (!b.body || b.body.length < 3) errors.push('متن پیام را وارد کنید.');
    if (b.body && b.body.length > 600) errors.push('متن پیام حداکثر ۶۰۰ نویسه باشد.');
    const aud = await resolveAudience(b.audience); if (!aud) errors.push('مخاطب نامعتبر است.');
    if (channels !== 'app' && !sms.config().enabled) errors.push('ارسال پیامک در تنظیمات فعال نیست؛ فقط پیام درون‌برنامه‌ای ممکن است.');
    if (errors.length) {
      const [classes, grades, templates, history] = await Promise.all([k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'), k('classrooms').where('status', '<>', 'archived').whereNotNull('grade_level').distinct('grade_level'), k('message_templates').orderBy('title'), k('group_messages as g').leftJoin('users as u', 'u.id', 'g.sent_by').orderBy('g.id', 'desc').limit(15).select('g.*', 'u.full_name as sender')]);
      return res.view('messages/index', { title: 'پیام گروهی', classes, grades: grades.map((g) => g.grade_level).filter(Boolean), templates, history, smsOn: sms.config().enabled, provider: sms.config().provider, errors, vals: b });
    }
    const today = J.isoToJString(J.todayISO()); let recipients = 0; let smsCount = 0; const items = [];
    if (aud.type === 'teachers') {
      recipients = aud.teachers.length;
      if (channels !== 'sms') await svc.notify(aud.teachers.map((t) => t.user_id), b.title, b.body, '/notifications', 'info');
      if (channels !== 'app') for (const t of aud.teachers) items.push({ to: t.phone, message: sms.render(b.body, { student: '', date: today }) });
    } else {
      recipients = aud.students.length;
      for (const s of aud.students) {
        const msg = sms.render(b.body, { student: `${s.first_name} ${s.last_name}`, class: s.class_name || '', date: today, amount: s.due ? require('../utils/fa').money(s.due) : '' });
        if (channels !== 'sms') await svc.notify([s.user_id], b.title, msg, '/notifications', 'info');
        if (channels !== 'app' && aud.type !== 'students_all') for (const n of sms.parentNumbers(s)) items.push({ to: n, message: msg, studentId: s.id });
        if (channels !== 'app' && aud.type === 'students_all') for (const n of [s.mobile].filter(Boolean)) items.push({ to: n, message: msg, studentId: s.id });
      }
    }
    if (items.length) smsCount = await sms.enqueue(items, { event: 'group', userId: req.user.id });
    await k('group_messages').insert({ title: b.title.slice(0, 200), body: b.body, audience: String(b.audience).slice(0, 30), audience_label: aud.label, channels, recipients, sms_count: smsCount, sent_by: req.user.id });
    await svc.audit(req, 'group_message', 'messages', null, `${aud.label}: ${recipients} مخاطب، ${smsCount} پیامک`);
    req.flash('success', `پیام برای ${recipients} مخاطب ثبت شد${channels !== 'app' ? ` (${smsCount} پیامک در صف ارسال)` : ''}.`); res.redirect('/messages');
  } catch (e) { next(e); }
});

router.get('/sms/log', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 30; const q = (req.query.q || '').trim();
    const qb = k('sms_log as l').leftJoin('students as s', 's.id', 'l.student_id');
    if (req.query.status) qb.where('l.status', req.query.status);
    if (req.query.event) qb.where('l.event', req.query.event);
    if (q) qb.where((b) => b.where('l.to_number', 'like', `%${q.replace(/^0/, '')}%`).orWhere('l.message', 'like', `%${q}%`));
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderBy('l.id', 'desc').limit(per).offset((page - 1) * per).select('l.*', 's.first_name', 's.last_name');
    const stats = Object.fromEntries((await k('sms_log').groupBy('status').select('status').count({ n: '*' })).map((r) => [r.status, Number(r.n)]));
    res.view('messages/sms-log', { title: 'گزارش پیامک‌ها', rows, total, page, pages: Math.max(1, Math.ceil(total / per)), stats, status: req.query.status || '', event: req.query.event || '', q, cfg: sms.config(), display: sms.display });
  } catch (e) { next(e); }
});
router.post('/sms/retry', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const ids = req.body.id ? [].concat(req.body.id).map(Number) : (await k('sms_log').where({ status: 'failed' }).limit(500).select('id')).map((x) => x.id);
    const n = await sms.retryFailed(ids); req.flash('success', `${n} پیامک دوباره ارسال شد.`); res.redirect('/sms/log');
  } catch (e) { next(e); }
});
router.post('/sms/test', ...guard, async (req, res, next) => {
  try {
    const to = req.body.to; if (!sms.isMobile(to)) { req.flash('error', 'شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹).'); return res.redirect('/sms/log'); }
    const n = await sms.enqueue([{ to, message: `پیامک آزمایشی از سامانه ${settings.get('school_name')}` }], { event: 'test', userId: req.user.id, wait: true, force: true });
    const last = await db.get()('sms_log').where({ event: 'test' }).orderBy('id', 'desc').first();
    req.flash(last && last.status === 'failed' ? 'error' : 'success', last && last.status === 'failed' ? 'ارسال ناموفق: ' + last.error : `پیامک آزمایشی ثبت شد (وضعیت: ${last ? last.status : '—'}).`);
    res.redirect('/sms/log');
  } catch (e) { next(e); }
});
module.exports = router;
module.exports.resolveAudience = resolveAudience;

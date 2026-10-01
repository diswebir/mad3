'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const sla = require('../lib/sla');
const { L } = require('../labels');
const { uploader, isManager, invalidateBadges } = require('../middleware');
const router = express.Router();
router.use('/tickets', modules.guard('tickets'));

const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'تیکت مورد نظر یافت نشد یا به آن دسترسی ندارید.' });
const staffLike = (u) => u.role !== 'student';

async function getTicket(req, id) {
  const k = db.get();
  const t = await k('tickets as t').join('users as c', 'c.id', 't.created_by').leftJoin('users as r', 'r.id', 't.recipient_user_id').leftJoin('students as s', 's.id', 't.student_id').leftJoin('classrooms as cl', 'cl.id', 's.classroom_id')
    .where('t.id', id).first('t.*', 'c.full_name as creator_name', 'c.role as creator_role', 'r.full_name as recipient_name', 'r.role as recipient_role_actual', 's.first_name', 's.last_name', 'cl.name as class_name');
  if (!t || !svc.canViewTicket(req.user, t)) return null;
  return t;
}

/** گزینه‌های گیرنده بر اساس نقش کاربر */
async function recipientOptions(req) {
  const k = db.get(); const u = req.user; const groups = [];
  if (u.role === 'student') {
    groups.push({ label: 'مدیریت', opts: [['admin', 'مدیریت مدرسه (مدیر/معاون)']] });
    if (settings.bool('ticket_student_to_teacher') && u.student && u.student.classroom_id) {
      const c = await k('classrooms as c').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').where('c.id', u.student.classroom_id).first('t.user_id', 'c.homeroom_teacher_id');
      const hu = c && c.homeroom_teacher_id ? await k('users').where({ id: c.user_id, active: 1 }).first() : null;
      const subj = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('teachers as t', 't.id', 'cs.teacher_id').join('users as x', 'x.id', 't.user_id').where('cs.classroom_id', u.student.classroom_id).where('x.active', 1).orderBy('s.name').select('x.id', 'x.full_name', 's.name as subject');
      const opts = []; if (hu) opts.push(['u:' + hu.id, `معلم راهنما — ${hu.full_name}`]);
      subj.forEach((s) => { if (!hu || s.id !== hu.id) opts.push(['u:' + s.id, `${s.subject} — ${s.full_name}`]); });
      if (opts.length) groups.push({ label: 'معلمان من', opts });
    }
  } else {
    groups.push({ label: 'مدیریت', opts: u.role === 'teacher' ? [['admin', 'مدیریت مدرسه (مدیر/معاون)']] : [] });
    const stuQ = k('students as s').join('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname');
    if (u.role === 'teacher') { const ids = await svc.accessibleClassIds(u); stuQ.whereIn('s.classroom_id', ids.length ? ids : [0]); }
    const stu = await stuQ;
    if (stu.length) groups.push({ label: 'دانش‌آموزان', opts: stu.map((s) => ['s:' + s.id, `${s.last_name} ${s.first_name} — ${s.cname}`]) });
    if (isManager(u)) {
      const tt = await k('users').whereIn('role', ['teacher', 'deputy', 'admin']).whereNot('id', u.id).where({ active: 1 }).orderBy('role').orderBy('full_name').select('id', 'full_name', 'role');
      groups.push({ label: 'معلمان و همکاران', opts: tt.map((x) => ['u:' + x.id, `${x.full_name} (${L.roles[x.role]})`]) });
    } else {
      const deputy = await k('users').where({ role: 'deputy', active: 1 }).first();
      if (deputy) groups[0].opts.push(['u:' + deputy.id, `${deputy.full_name} (معاون)`]);
    }
  }
  return groups.filter((g) => g.opts.length);
}
async function resolveRecipient(req, val) {
  const k = db.get(); const u = req.user;
  const groups = await recipientOptions(req);
  if (!groups.some((g) => g.opts.some((o) => o[0] === val))) return null;
  if (val === 'admin') return { role: 'admin', user: null, student: u.role === 'student' && u.student ? u.student.id : null };
  const [type, id] = val.split(':');
  if (type === 'u') { const r = await k('users').where({ id }).first(); return r ? { role: null, user: r.id, student: u.role === 'student' && u.student ? u.student.id : null } : null; }
  if (type === 's') { const s = await k('students').where({ id }).first(); return s ? { role: null, user: s.user_id, student: s.id } : null; }
  return null;
}
async function notifyOther(t, req, msg) {
  let ids = [];
  if (req.user.id === t.created_by) ids = t.recipient_user_id ? [t.recipient_user_id] : await svc.managerIds();
  else ids = [t.created_by, ...(t.recipient_user_id && t.recipient_user_id !== req.user.id ? [t.recipient_user_id] : [])];
  ids = ids.filter((i) => i !== req.user.id);
  await svc.notify(ids, msg, t.subject, '/tickets/' + t.id);
}
const stamp = (extra = {}) => ({ updated_at: svc.nowStr(), ...extra });

/* ---------- لیست ---------- */
router.get('/tickets', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 20;
    const qb = k('tickets as t').join('users as c', 'c.id', 't.created_by').leftJoin('users as r', 'r.id', 't.recipient_user_id');
    if (!isManager(u)) qb.where((b) => b.where('t.created_by', u.id).orWhere('t.recipient_user_id', u.id));
    const q = (req.query.q || '').trim(); if (q) qb.where((b) => b.where('t.subject', 'like', `%${q}%`).orWhere('c.full_name', 'like', `%${q}%`));
    for (const f of ['status', 'category', 'priority']) if (req.query[f]) qb.where('t.' + f, req.query[f]);
    const slaBase = settings.num('ticket_sla_hours');
    const overdueWhere = (b) => { for (const [p, f] of Object.entries(sla.PRIORITY_FACTOR)) { const cut = sla.fmtUTC(Date.now() - sla.limitHours(p, slaBase) * 3600000); b.orWhere((c) => (p === 'normal' ? c.where((x) => x.where('t.priority', 'normal').orWhereNotIn('t.priority', ['urgent', 'high', 'low'])) : c.where('t.priority', p)).where('t.updated_at', '<', cut)); } };
    if (req.query.view === 'overdue' && slaBase > 0) qb.whereIn('t.status', ['open', 'pending']).where(overdueWhere);
    if (req.query.view === 'mine') qb.where((b) => b.where('t.created_by', u.id));
    if (req.query.view === 'todo') {
      if (isManager(u)) qb.whereIn('t.status', ['open', 'pending']).where((b) => b.where('t.recipient_role', 'admin').orWhere('t.recipient_user_id', u.id));
      else qb.where((b) => b.where({ 't.created_by': u.id, 't.status': 'answered' }).orWhere((c) => c.where('t.recipient_user_id', u.id).whereIn('t.status', ['open', 'pending'])));
    }
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderByRaw("case t.status when 'closed' then 1 else 0 end").orderBy('t.updated_at', 'desc').orderBy('t.id', 'desc').limit(per).offset((page - 1) * per)
      .select('t.*', 'c.full_name as creator_name', 'r.full_name as recipient_name', k.raw(`(select count(*) from ticket_messages m where m.ticket_id = t.id${staffLike(u) ? '' : ' and m.internal = 0'}) as msg_count`));
    rows.forEach((t) => { t.sla = sla.status(t, slaBase); });
    let overdueCount = 0; if (slaBase > 0 && isManager(u)) overdueCount = Number((await k('tickets as t').whereIn('t.status', ['open', 'pending']).where(overdueWhere).count({ c: '*' }).first()).c);
    res.view('tickets/index', { title: 'تیکت‌ها', slaBase, overdueCount, rows, total, page, pages: Math.max(1, Math.ceil(total / per)), f: req.query, uid: u.id });
  } catch (e) { next(e); }
});

/* ---------- ایجاد ---------- */
async function renderNew(req, res, errors, vals) {
  res.view('tickets/new', { title: 'تیکت جدید', errors: errors || [], vals: vals || { category: L.ticketCategory[req.query.category] ? req.query.category : 'general', priority: 'normal', related_date: req.query.date ? J.isoToJString(req.query.date) : '' }, groups: await recipientOptions(req) });
}
router.get('/tickets/new', async (req, res, next) => { try { await renderNew(req, res); } catch (e) { next(e); } });
router.post('/tickets/new', uploader('tickets', 'attachment', { maxMB: 5 }), async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const b = req.body; const errors = [];
    if (req.uploadError) errors.push(req.uploadError);
    if (!b.subject || b.subject.length < 3) errors.push('موضوع تیکت را وارد کنید (حداقل ۳ حرف).');
    if (!b.body || b.body.length < 3) errors.push('متن پیام را وارد کنید.');
    if (!L.ticketCategory[b.category]) errors.push('دسته‌بندی نامعتبر است.');
    if (!L.priority[b.priority]) b.priority = 'normal';
    const rec = await resolveRecipient(req, b.recipient || '');
    if (!rec) errors.push('گیرنده را انتخاب کنید.');
    if (rec && u.role !== 'student' && b.student_id) { // پیوند دادن تیکت به یک دانش‌آموز (معلم → مدیر یا هر مخاطب دیگر)
      const sid = Number(b.student_id); const st = sid ? await k('students').where({ id: sid }).first() : null;
      if (!st) errors.push('دانش‌آموز انتخاب‌شده یافت نشد.');
      else if (u.role === 'teacher' && !(await svc.accessibleClassIds(u)).includes(st.classroom_id)) errors.push('این دانش‌آموز در کلاس‌های شما نیست.');
      else if (!rec.student) rec.student = st.id;
    }
    let related = null;
    if (b.category === 'absence') {
      related = J.parseJalali(b.related_date);
      if (!related) errors.push('برای توجیه غیبت، تاریخ غیبت را وارد کنید.');
      else if (related > J.todayISO()) errors.push('تاریخ غیبت نمی‌تواند در آینده باشد.');
      else if (related < J.addDays(J.todayISO(), -90)) errors.push('توجیه غیبت فقط برای ۹۰ روز اخیر ممکن است.');
      else if (u.role === 'student') {
        const dup = await k('tickets').where({ created_by: u.id, category: 'absence', related_date: related }).whereNot('status', 'closed').first();
        if (dup) errors.push(`برای این تاریخ قبلاً درخواست توجیه ثبت کرده‌اید (تیکت شماره ${dup.id}).`);
      }
    }
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return renderNew(req, res, errors, b); }
    const r = await k('tickets').insert({ subject: b.subject.slice(0, 200), category: b.category, priority: b.priority, status: 'open', created_by: u.id, recipient_user_id: rec.user, recipient_role: rec.role, student_id: rec.student, related_date: related, updated_at: svc.nowStr() });
    const id = Array.isArray(r) ? r[0] : r;
    await k('ticket_messages').insert({ ticket_id: id, user_id: u.id, body: b.body.slice(0, 5000), attachment: req.file ? req.file.filename : null, attachment_name: req.file ? req.file.originalname.slice(0, 200) : null });
    const targets = rec.user ? [rec.user] : await svc.managerIds();
    await svc.notify(targets.filter((x) => x !== u.id), `تیکت جدید از ${u.full_name}`, b.subject, '/tickets/' + id);
    await svc.audit(req, 'create', 'tickets', id, b.subject);
    req.flash('success', 'تیکت شما ثبت شد.'); res.redirect('/tickets/' + id);
  } catch (e) { next(e); }
});

/* ---------- نمایش ---------- */
router.get('/tickets/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const t = await getTicket(req, req.params.id); if (!t) return nf(res);
    const msgs = await k('ticket_messages as m').join('users as x', 'x.id', 'm.user_id').where('m.ticket_id', t.id).modify((q) => { if (!staffLike(u)) q.where('m.internal', 0); }).orderBy('m.id').select('m.*', 'x.full_name', 'x.role', 'x.avatar');
    await k('notifications').where({ user_id: u.id, is_read: 0, link: '/tickets/' + t.id }).update({ is_read: 1 }); invalidateBadges(u.id);
    const canManage = isManager(u) || t.recipient_user_id === u.id;
    let att = null;
    if (t.category === 'absence' && t.related_date && t.student_id) att = await k('attendance').where({ student_id: t.student_id, date: t.related_date }).select('status', 'period').first();
    let reassign = [];
    if (isManager(u)) reassign = await k('users').whereIn('role', ['teacher', 'deputy', 'admin']).where({ active: 1 }).orderBy('role').orderBy('full_name').select('id', 'full_name', 'role');
    res.view('tickets/show', { title: t.subject, slaInfo: sla.status(t, settings.num('ticket_sla_hours')), t, msgs, canManage, att, reassign, isCreator: t.created_by === u.id, canReply: t.status !== 'closed' });
  } catch (e) { next(e); }
});

router.post('/tickets/:id(\\d+)/reply', uploader('tickets', 'attachment', { maxMB: 5 }), async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const t = await getTicket(req, req.params.id); if (!t) return nf(res);
    if (t.status === 'closed') { req.flash('error', 'این تیکت بسته شده است؛ ابتدا آن را بازگشایی کنید.'); return res.redirect('/tickets/' + t.id); }
    if (req.uploadError || !req.body.body || req.body.body.length < 1) { if (req.file) fs.unlink(req.file.path, () => {}); req.flash('error', req.uploadError || 'متن پیام را وارد کنید.'); return res.redirect('/tickets/' + t.id); }
    const internal = staffLike(u) && req.body.internal === '1' ? 1 : 0;
    await k('ticket_messages').insert({ ticket_id: t.id, user_id: u.id, body: req.body.body.slice(0, 5000), attachment: req.file ? req.file.filename : null, attachment_name: req.file ? req.file.originalname.slice(0, 200) : null, internal });
    if (!internal) {
      const status = u.id === t.created_by ? 'pending' : 'answered';
      await k('tickets').where({ id: t.id }).update(stamp({ status, escalated_at: null }));
      await notifyOther(t, req, 'پاسخ جدید در تیکت');
    } // یادداشت داخلی، ساعت مهلت پاسخ (SLA) را تغییر نمی‌دهد
    invalidateBadges();
    req.flash('success', internal ? 'یادداشت داخلی ثبت شد.' : 'پیام ارسال شد.'); res.redirect('/tickets/' + t.id + '#last');
  } catch (e) { next(e); }
});
const canAct = (req, t) => isManager(req.user) || t.created_by === req.user.id || t.recipient_user_id === req.user.id;
router.post('/tickets/:id(\\d+)/close', async (req, res, next) => {
  try {
    const t = await getTicket(req, req.params.id); if (!t || !canAct(req, t)) return nf(res);
    await db.get()('tickets').where({ id: t.id }).update(stamp({ status: 'closed', closed_at: svc.nowStr() }));
    await notifyOther(t, req, 'تیکت بسته شد'); invalidateBadges();
    await svc.audit(req, 'close', 'tickets', t.id, t.subject); req.flash('success', 'تیکت بسته شد.'); res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
router.post('/tickets/:id(\\d+)/reopen', async (req, res, next) => {
  try {
    const t = await getTicket(req, req.params.id); if (!t || !canAct(req, t)) return nf(res);
    await db.get()('tickets').where({ id: t.id }).update(stamp({ status: 'open', closed_at: null })); invalidateBadges();
    await notifyOther(t, req, 'تیکت بازگشایی شد'); req.flash('success', 'تیکت بازگشایی شد.'); res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
router.post('/tickets/:id(\\d+)/priority', async (req, res, next) => {
  try {
    const t = await getTicket(req, req.params.id); if (!t || !(isManager(req.user) || t.recipient_user_id === req.user.id)) return nf(res);
    if (L.priority[req.body.priority]) await db.get()('tickets').where({ id: t.id }).update({ priority: req.body.priority });
    res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
router.post('/tickets/:id(\\d+)/assign', async (req, res, next) => {
  try {
    const k = db.get(); const t = await getTicket(req, req.params.id); if (!t || !isManager(req.user)) return nf(res);
    if (req.body.to === 'admin') await k('tickets').where({ id: t.id }).update(stamp({ recipient_user_id: null, recipient_role: 'admin' }));
    else { const target = await k('users').where({ id: req.body.to, active: 1 }).first(); if (!target || target.role === 'student') { req.flash('error', 'گیرنده نامعتبر است.'); return res.redirect('/tickets/' + t.id); } await k('tickets').where({ id: t.id }).update(stamp({ recipient_user_id: target.id, recipient_role: null })); await svc.notify([target.id], 'تیکتی به شما ارجاع شد', t.subject, '/tickets/' + t.id); }
    await k('ticket_messages').insert({ ticket_id: t.id, user_id: req.user.id, body: 'تیکت ارجاع داده شد.', internal: 1 });
    invalidateBadges(); req.flash('success', 'تیکت ارجاع داده شد.'); res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
/* تأیید/رد توجیه غیبت: وضعیت حضور و غیاب به «غیبت موجه» تغییر می‌کند */
router.post('/tickets/:id(\\d+)/justify', async (req, res, next) => {
  try {
    const k = db.get(); const t = await getTicket(req, req.params.id);
    if (!t || t.category !== 'absence' || !t.related_date || !t.student_id || !(isManager(req.user) || t.recipient_user_id === req.user.id)) return nf(res);
    const approve = req.body.decision === 'approve'; const date = J.isoToJString(t.related_date);
    if (approve) {
      const n = await k('attendance').where({ student_id: t.student_id, date: t.related_date }).whereIn('status', ['absent', 'late']).update({ status: 'excused', note: 'موجه از طریق تیکت #' + t.id, updated_at: svc.nowStr() });
      await k('tickets').where({ id: t.id }).update(stamp({ justified: 1, status: 'answered' }));
      await k('ticket_messages').insert({ ticket_id: t.id, user_id: req.user.id, body: `غیبت تاریخ ${date} موجه شد.` + (n ? '' : ' (رکورد غیبتی برای آن روز یافت نشد؛ فقط وضعیت تیکت ثبت شد.)') });
    } else {
      await k('tickets').where({ id: t.id }).update(stamp({ justified: 0, status: 'answered' }));
      await k('ticket_messages').insert({ ticket_id: t.id, user_id: req.user.id, body: `توجیه غیبت تاریخ ${date} پذیرفته نشد.${req.body.reason ? ' دلیل: ' + req.body.reason.slice(0, 500) : ''}` });
    }
    await svc.notify([t.created_by], approve ? 'غیبت شما موجه شد' : 'توجیه غیبت پذیرفته نشد', t.subject, '/tickets/' + t.id, approve ? 'success' : 'warn');
    await svc.audit(req, approve ? 'justify' : 'reject_justify', 'tickets', t.id, date); invalidateBadges();
    req.flash('success', approve ? 'غیبت موجه شد و در حضور و غیاب اعمال گردید.' : 'درخواست رد شد.'); res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
router.post('/tickets/:id(\\d+)/rate', async (req, res, next) => {
  try {
    const t = await getTicket(req, req.params.id); if (!t || t.created_by !== req.user.id || t.status !== 'closed' || t.rating) return nf(res);
    const r = Math.min(5, Math.max(1, parseInt(req.body.rating, 10) || 0)); if (!r) return res.redirect('/tickets/' + t.id);
    await db.get()('tickets').where({ id: t.id }).update({ rating: r, rating_comment: (req.body.comment || '').slice(0, 500) || null });
    req.flash('success', 'از بازخورد شما سپاسگزاریم.'); res.redirect('/tickets/' + t.id);
  } catch (e) { next(e); }
});
module.exports = router;

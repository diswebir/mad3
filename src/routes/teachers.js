'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { L } = require('../labels');
const { requireRole } = require('../middleware');
const modules = require('../modules');
const router = express.Router();
router.use('/teachers', requireRole('admin', 'deputy'));

const FIELDS = [
  { name: 'full_name', label: 'نام و نام خانوادگی', type: 'text', required: true }, { name: 'personnel_code', label: 'کد پرسنلی', type: 'text', ltr: true },
  { name: 'username', label: 'نام کاربری (خالی = کد پرسنلی)', type: 'text', ltr: true, createOnly: true }, { name: 'national_id', label: 'کد ملی', type: 'text', ltr: true, maxlength: 10 },
  { name: 'gender', label: 'جنسیت', type: 'select', opts: Object.entries(L.genderAdult) }, { name: 'birth_date', label: 'تاریخ تولد', type: 'date' },
  { name: 'phone', label: 'موبایل', type: 'tel', user: true }, { name: 'email', label: 'ایمیل', type: 'text', ltr: true, user: true },
  { name: 'specialty', label: 'تخصص / رشته', type: 'text' }, { name: 'degree', label: 'مدرک تحصیلی', type: 'text' },
  { name: 'hire_date', label: 'تاریخ استخدام', type: 'date' }, { name: 'employment_type', label: 'نوع استخدام', type: 'select', opts: ['رسمی', 'پیمانی', 'حق‌التدریس', 'قراردادی'].map((x) => [x, x]) },
  { name: 'emergency_phone', label: 'تلفن اضطراری', type: 'tel' }, { name: 'status', label: 'وضعیت', type: 'select', required: true, opts: Object.entries(L.teacherStatus) },
  { name: 'address', label: 'نشانی', type: 'textarea', full: true }, { name: 'bio', label: 'توضیحات / سوابق', type: 'textarea', full: true },
];
const TFIELDS = FIELDS.filter((f) => !f.user && f.name !== 'full_name' && f.name !== 'username');

async function load(id) {
  return db.get()('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.id', id).first('t.*', 'u.full_name', 'u.username', 'u.phone', 'u.email', 'u.active', 'u.last_login');
}
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'معلم مورد نظر یافت نشد.' });

router.get('/teachers', async (req, res, next) => {
  try {
    const k = db.get(); const q = (req.query.q || '').trim(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 25;
    const qb = k('teachers as t').join('users as u', 'u.id', 't.user_id');
    if (q) qb.where((b) => b.where('u.full_name', 'like', `%${q}%`).orWhere('t.personnel_code', 'like', `%${q}%`).orWhere('t.specialty', 'like', `%${q}%`).orWhere('u.phone', 'like', `%${q}%`));
    if (req.query.status) qb.where('t.status', req.query.status);
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderBy('u.full_name').limit(per).offset((page - 1) * per).select('t.id', 't.personnel_code', 't.specialty', 't.status', 'u.full_name', 'u.phone', 'u.avatar',
      k.raw('(select count(*) from classrooms c where c.homeroom_teacher_id = t.id) as homeroom_count'), k.raw('(select count(distinct classroom_id) from class_subjects cs where cs.teacher_id = t.id) as class_count'), k.raw('(select coalesce(sum(weekly_hours),0) from class_subjects cs where cs.teacher_id = t.id) as hours'));
    const homerooms = await k('classrooms').whereNotNull('homeroom_teacher_id').select('id', 'name', 'homeroom_teacher_id');
    res.view('teachers/index', { title: 'معلمان', rows, total, q, status: req.query.status || '', page, pages: Math.max(1, Math.ceil(total / per)), homerooms });
  } catch (e) { next(e); }
});
router.get('/teachers/export.csv', async (req, res, next) => {
  try {
    const rows = await db.get()('teachers as t').join('users as u', 'u.id', 't.user_id').orderBy('u.full_name').select('t.*', 'u.full_name', 'u.phone', 'u.email');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="teachers-${J.todayISO()}.csv"`).send(toCSV(['نام', 'کد پرسنلی', 'کد ملی', 'تخصص', 'مدرک', 'موبایل', 'ایمیل', 'نوع استخدام', 'وضعیت'], rows.map((r) => [r.full_name, r.personnel_code, r.national_id, r.specialty, r.degree, r.phone, r.email, r.employment_type, L.teacherStatus[r.status]])));
  } catch (e) { next(e); }
});
const form = (res, row, errors, vals) => res.view('teachers/form', { title: row ? 'ویرایش معلم' : 'افزودن معلم', row, errors: errors || [], vals: vals || (row ? { ...row, birth_date: J.isoToJString(row.birth_date), hire_date: J.isoToJString(row.hire_date) } : { status: 'active', employment_type: 'رسمی' }), fields: FIELDS });
router.get('/teachers/new', (req, res) => form(res, null));

async function collect(req, existing) {
  const k = db.get(); const b = req.body; const errors = []; const data = {}; const user = {};
  for (const f of FIELDS) {
    if (f.createOnly && existing) continue;
    let v = b[f.name]; if (v === '' || v === undefined) v = null;
    if (f.required && v === null) { errors.push(`«${f.label}» الزامی است.`); continue; }
    if (v !== null && f.type === 'date') { const iso = J.parseJalali(v); if (!iso) { errors.push(`«${f.label}» نامعتبر است.`); continue; } v = iso; }
    if (v !== null && f.type === 'tel' && !svc.validPhone(v)) { errors.push(`«${f.label}» معتبر نیست.`); continue; }
    if (v !== null && f.name === 'email' && !/^\S+@\S+\.\S+$/.test(v)) { errors.push('ایمیل معتبر نیست.'); continue; }
    if (v !== null && f.name === 'status' && !L.teacherStatus[v]) { errors.push('وضعیت نامعتبر است.'); continue; }
    if (v !== null && f.name === 'gender' && !L.genderAdult[v]) { errors.push('جنسیت نامعتبر است.'); continue; }
    if (f.user || f.name === 'full_name') user[f.name] = v; else if (f.name !== 'username') data[f.name] = v; else data._username = v;
  }
  if (data.national_id && !svc.validNationalId(data.national_id)) errors.push('کد ملی معتبر نیست.');
  if (data.personnel_code) { const dup = await k('teachers').where({ personnel_code: data.personnel_code }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first(); if (dup) errors.push('کد پرسنلی تکراری است.'); }
  return { errors, data, user };
}
router.post('/teachers/new', async (req, res, next) => {
  try {
    const k = db.get(); const { errors, data, user } = await collect(req, null);
    let username = (data._username || data.personnel_code || '').toLowerCase(); delete data._username;
    if (!username) errors.push('نام کاربری یا کد پرسنلی را وارد کنید.');
    else if (!/^[a-z0-9._-]{3,30}$/.test(username)) errors.push('نام کاربری باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
    else if (await k('users').whereRaw('lower(username) = ?', [username]).first()) errors.push('این نام کاربری قبلاً استفاده شده است.');
    if (errors.length) return form(res, null, errors, req.body);
    const pw = svc.randomPassword(8);
    const ur = await k('users').insert({ username, password_hash: svc.hash(pw), role: 'teacher', full_name: user.full_name, email: user.email, phone: user.phone, active: data.status === 'inactive' ? 0 : 1, must_change_password: 1 });
    const uid = Array.isArray(ur) ? ur[0] : ur;
    const tr = await k('teachers').insert({ ...data, user_id: uid });
    const tid = Array.isArray(tr) ? tr[0] : tr;
    await svc.audit(req, 'create', 'teachers', tid, user.full_name);
    req.flash('success', `معلم ثبت شد. نام کاربری: ${username} — رمز اولیه: ${pw} (فقط یک‌بار نمایش داده می‌شود؛ در اولین ورود باید تغییر کند.)`);
    res.redirect('/teachers/' + tid);
  } catch (e) { next(e); }
});
router.get('/teachers/:id(\\d+)/edit', async (req, res, next) => { try { const t = await load(req.params.id); if (!t) return nf(res); form(res, t); } catch (e) { next(e); } });
router.post('/teachers/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const k = db.get(); const t = await load(req.params.id); if (!t) return nf(res);
    const { errors, data, user } = await collect(req, t); delete data._username;
    if (errors.length) return form(res, t, errors, { ...t, ...req.body });
    await k('teachers').where({ id: t.id }).update(data);
    await k('users').where({ id: t.user_id }).update({ full_name: user.full_name, email: user.email, phone: user.phone, active: data.status === 'inactive' ? 0 : 1 });
    await svc.audit(req, 'update', 'teachers', t.id, user.full_name);
    if (data.status === 'inactive') {
      await svc.killSessions(t.user_id);
      const used = Number((await k('classrooms').where({ homeroom_teacher_id: t.id }).count({ c: '*' }).first()).c) + Number((await k('class_subjects').where({ teacher_id: t.id }).count({ c: '*' }).first()).c);
      if (used) req.flash('error', 'توجه: این معلم غیرفعال شد ولی هنوز به کلاس/درس اختصاص دارد؛ تخصیص‌ها را به معلم دیگری بدهید.');
    }
    req.flash('success', 'اطلاعات معلم ذخیره شد.'); res.redirect('/teachers/' + t.id);
  } catch (e) { next(e); }
});
router.post('/teachers/:id(\\d+)/reset-password', async (req, res, next) => {
  try {
    const t = await load(req.params.id); if (!t) return nf(res); const pw = svc.randomPassword(8);
    await db.get()('users').where({ id: t.user_id }).update({ password_hash: svc.hash(pw), must_change_password: 1 });
    await svc.killSessions(t.user_id);
    await svc.audit(req, 'reset_password', 'teachers', t.id, t.username);
    req.flash('success', `رمز جدید «${t.full_name}»: ${pw} (فقط یک‌بار نمایش داده می‌شود)`); res.redirect('/teachers/' + t.id);
  } catch (e) { next(e); }
});
router.post('/teachers/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const k = db.get(); const t = await load(req.params.id); if (!t) return nf(res);
    const used = Number((await k('classrooms').where({ homeroom_teacher_id: t.id }).count({ c: '*' }).first()).c) + Number((await k('class_subjects').where({ teacher_id: t.id }).count({ c: '*' }).first()).c);
    if (used) { req.flash('error', 'این معلم هنوز به کلاس یا درسی اختصاص دارد. ابتدا تخصیص‌ها را بردارید یا وضعیت او را «غیرفعال» کنید.'); return res.redirect('/teachers/' + t.id); }
    const tk = Number((await k('tickets').where((b) => b.where('created_by', t.user_id).orWhere('recipient_user_id', t.user_id)).count({ c: '*' }).first()).c) + Number((await k('ticket_messages').where({ user_id: t.user_id }).count({ c: '*' }).first()).c);
    if (tk) { req.flash('error', 'این معلم در تیکت‌ها سابقه دارد؛ برای حفظ سوابق، وضعیت او را «غیرفعال» کنید.'); return res.redirect('/teachers/' + t.id); }
    const loans = Number((await k('book_loans').where({ teacher_id: t.id }).whereNull('returned_at').count({ c: '*' }).first()).c);
    if (loans) { req.flash('error', 'این معلم کتاب امانت‌گرفته‌شده بازنگردانده دارد.'); return res.redirect('/teachers/' + t.id); }
    await k.transaction(async (x) => { await x('book_loans').where({ teacher_id: t.id }).del(); await x('teachers').where({ id: t.id }).del(); await x('notifications').where({ user_id: t.user_id }).del(); await x('users').where({ id: t.user_id }).del(); });
    await svc.killSessions(t.user_id);
    await svc.audit(req, 'delete', 'teachers', t.id, t.full_name);
    req.flash('success', 'معلم حذف شد.'); res.redirect('/teachers');
  } catch (e) { next(e); }
});
router.get('/teachers/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const t = await load(req.params.id); if (!t) return nf(res);
    const homerooms = await k('classrooms').where({ homeroom_teacher_id: t.id }).select('id', 'name');
    const assigned = await k('class_subjects as cs').join('classrooms as c', 'c.id', 'cs.classroom_id').join('subjects as s', 's.id', 'cs.subject_id').where('cs.teacher_id', t.id).where('c.status', '<>', 'archived').orderBy('c.name').select('cs.id', 'cs.weekly_hours', 'c.id as classroom_id', 'c.name as class_name', 's.name as subject_name');
    const students = homerooms.length ? Number((await k('students').whereIn('classroom_id', homerooms.map((h) => h.id)).where({ status: 'active' }).count({ c: '*' }).first()).c) : 0;
    let tickets = 0; if (modules.isEnabled('tickets')) tickets = Number((await k('tickets').where({ recipient_user_id: t.user_id }).whereIn('status', ['open', 'pending']).count({ c: '*' }).first()).c);
    res.view('teachers/show', { title: t.full_name, t, homerooms, assigned, hours: assigned.reduce((a, b) => a + (b.weekly_hours || 0), 0), students, tickets, tfields: TFIELDS });
  } catch (e) { next(e); }
});
module.exports = router;

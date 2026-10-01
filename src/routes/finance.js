'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { L } = require('../labels');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/finance', modules.guard('finance'));
const mgr = requireRole('admin', 'deputy');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد یافت نشد یا دسترسی ندارید.' });

const feeQuery = (k) => k('fees as f').join('students as s', 's.id', 'f.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id')
  .leftJoin(k('payments').select('fee_id').sum({ paid: 'amount' }).groupBy('fee_id').as('p'), 'p.fee_id', 'f.id')
  .select('f.*', 's.first_name', 's.last_name', 's.student_code', 's.father_phone', 's.mother_phone', 'c.name as class_name', k.raw('coalesce(p.paid, 0) as paid'));
const net = (f) => Number(f.amount) - Number(f.discount || 0);

router.get('/finance', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const today = J.todayISO();
    const q = feeQuery(k);
    if (u.role === 'student') q.where('f.student_id', u.student ? u.student.id : 0);
    else if (!isManager(u)) return res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'دسترسی ندارید.' });
    if (req.query.class_id) q.where('s.classroom_id', req.query.class_id);
    if (req.query.q) q.where((b) => b.where('s.first_name', 'like', `%${req.query.q}%`).orWhere('s.last_name', 'like', `%${req.query.q}%`).orWhere('f.title', 'like', `%${req.query.q}%`));
    let rows = await q.orderBy('f.due_date', 'desc').orderBy('f.id', 'desc').limit(1000);
    rows.forEach((f) => { f.net = net(f); f.remaining = Math.max(0, f.net - Number(f.paid)); f.state = f.remaining === 0 ? 'paid' : Number(f.paid) > 0 ? 'partial' : 'unpaid'; f.overdue = f.remaining > 0 && f.due_date && f.due_date < today; });
    if (req.query.state) rows = rows.filter((f) => f.state === req.query.state);
    const sum = rows.reduce((a, f) => ({ billed: a.billed + f.net, paid: a.paid + Number(f.paid) }), { billed: 0, paid: 0 });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 25;
    res.view('finance/index', { title: 'امور مالی', rows: rows.slice((page - 1) * per, page * per), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / per)), sum, f: req.query, classes: u.role === 'student' ? [] : await k('classrooms').orderBy('name').select('id', 'name'), isStudent: u.role === 'student' });
  } catch (e) { next(e); }
});
router.get('/finance/debtors', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const rows = await feeQuery(k);
    const by = {};
    for (const f of rows) { const rem = Math.max(0, net(f) - Number(f.paid)); if (!rem) continue; const o = (by[f.student_id] = by[f.student_id] || { id: f.student_id, name: `${f.first_name} ${f.last_name}`, class_name: f.class_name, phone: f.father_phone || f.mother_phone, remaining: 0, overdue: 0, items: 0 }); o.remaining += rem; o.items++; if (f.due_date && f.due_date < J.todayISO()) o.overdue += rem; }
    const list = Object.values(by).sort((a, b) => b.remaining - a.remaining);
    if (req.query.format === 'csv') return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="debtors.csv"').send(toCSV(['دانش‌آموز', 'کلاس', 'تلفن اولیا', 'تعداد صورت‌حساب', 'مانده', 'سررسید گذشته'], list.map((x) => [x.name, x.class_name, x.phone, x.items, x.remaining, x.overdue])));
    res.view('finance/debtors', { title: 'بدهکاران', list, total: list.reduce((a, b) => a + b.remaining, 0) });
  } catch (e) { next(e); }
});
const FIELDS_DEF = () => ({ categories: Object.entries(L.feeCategory) });
router.get('/finance/fees/new', mgr, async (req, res, next) => {
  try {
    const k = db.get();
    res.view('finance/form', { title: 'صورت‌حساب جدید', errors: [], vals: { category: 'tuition', student_id: req.query.student_id || '', due_date: J.isoToJString(J.addDays(J.todayISO(), 30)) }, classes: await k('classrooms').orderBy('name').select('id', 'name'), students: await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname'), ...FIELDS_DEF() });
  } catch (e) { next(e); }
});
router.post('/finance/fees/new', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const errors = [];
    const amount = Number(String(b.amount || '').replace(/[,٬]/g, '')); const discount = Number(String(b.discount || '0').replace(/[,٬]/g, ''));
    if (!b.title) errors.push('عنوان را وارد کنید.'); if (isNaN(amount) || amount <= 0) errors.push('مبلغ نامعتبر است.'); if (isNaN(discount) || discount < 0 || discount > amount) errors.push('تخفیف نامعتبر است.');
    const due = b.due_date ? J.parseJalali(b.due_date) : null; if (b.due_date && !due) errors.push('سررسید نامعتبر است.');
    if (!L.feeCategory[b.category]) errors.push('دسته نامعتبر است.');
    let students = [];
    if (b.target === 'class') { if (!b.classroom_id) errors.push('کلاس را انتخاب کنید.'); else students = await k('students').where({ classroom_id: b.classroom_id, status: 'active' }).select('id', 'user_id'); if (b.classroom_id && !students.length) errors.push('کلاس دانش‌آموز فعال ندارد.'); }
    else { const s = b.student_id ? await k('students').where({ id: b.student_id }).first() : null; if (!s) errors.push('دانش‌آموز را انتخاب کنید.'); else students = [s]; }
    if (errors.length) {
      return res.view('finance/form', { title: 'صورت‌حساب جدید', errors, vals: b, classes: await k('classrooms').orderBy('name').select('id', 'name'), students: await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname'), ...FIELDS_DEF() });
    }
    const year = await k('academic_years').where({ is_current: 1 }).first();
    await k.batchInsert('fees', students.map((s) => ({ student_id: s.id, title: b.title, amount, discount, due_date: due, category: b.category, academic_year_id: year ? year.id : null, notes: b.notes || null })), 100);
    await svc.notify(students.map((s) => s.user_id), 'صورت‌حساب جدید ثبت شد', `${b.title} — ${amount.toLocaleString('en-US')}`, '/finance');
    await svc.audit(req, 'create', 'fees', null, `${b.title} برای ${students.length} نفر`);
    req.flash('success', `صورت‌حساب برای ${students.length} دانش‌آموز ثبت شد.`); res.redirect('/finance');
  } catch (e) { next(e); }
});
async function loadFee(req, id) {
  const k = db.get(); const f = await feeQuery(k).where('f.id', id).first(); if (!f) return null;
  if (req.user.role === 'student' && f.student_id !== (req.user.student && req.user.student.id)) return null;
  if (req.user.role === 'teacher') return null;
  f.net = net(f); f.remaining = Math.max(0, f.net - Number(f.paid)); return f;
}
router.get('/finance/fees/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const f = await loadFee(req, req.params.id); if (!f) return nf(res);
    res.view('finance/show', { title: f.title, f, payments: await k('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').where('p.fee_id', f.id).orderBy('p.id').select('p.*', 'u.full_name as recorder'), today: J.isoToJString(J.todayISO()) });
  } catch (e) { next(e); }
});
router.post('/finance/fees/:id(\\d+)/pay', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const f = await loadFee(req, req.params.id); if (!f) return nf(res);
    const amount = Number(String(req.body.amount || '').replace(/[,٬]/g, '')); const date = J.parseJalali(req.body.paid_at) || J.todayISO();
    if (isNaN(amount) || amount <= 0) { req.flash('error', 'مبلغ نامعتبر است.'); return res.redirect('/finance/fees/' + f.id); }
    if (amount > f.remaining) { req.flash('error', 'مبلغ پرداخت بیشتر از مانده صورت‌حساب است.'); return res.redirect('/finance/fees/' + f.id); }
    const r = await k('payments').insert({ fee_id: f.id, amount, paid_at: date, method: L.payMethod[req.body.method] ? req.body.method : 'cash', reference: (req.body.reference || '').slice(0, 60) || null, recorded_by: req.user.id });
    const s = await k('students').where({ id: f.student_id }).first(); await svc.notify(s.user_id, 'پرداخت شما ثبت شد', `${f.title} — ${amount.toLocaleString('en-US')}`, '/finance', 'success');
    await svc.audit(req, 'payment', 'payments', Array.isArray(r) ? r[0] : r, `${f.title} — ${amount}`); req.flash('success', 'پرداخت ثبت شد.'); res.redirect('/finance/fees/' + f.id);
  } catch (e) { next(e); }
});
router.post('/finance/payments/:id(\\d+)/delete', mgr, async (req, res, next) => {
  try { const k = db.get(); const p = await k('payments').where({ id: req.params.id }).first(); if (!p) return nf(res); await k('payments').where({ id: p.id }).del(); await svc.audit(req, 'delete', 'payments', p.id, String(p.amount)); req.flash('success', 'پرداخت حذف شد.'); res.redirect('/finance/fees/' + p.fee_id); } catch (e) { next(e); }
});
router.post('/finance/fees/:id(\\d+)/delete', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const f = await loadFee(req, req.params.id); if (!f) return nf(res);
    if (Number(f.paid) > 0) { req.flash('error', 'برای این صورت‌حساب پرداخت ثبت شده است؛ ابتدا پرداخت‌ها را حذف کنید.'); return res.redirect('/finance/fees/' + f.id); }
    await k('fees').where({ id: f.id }).del(); await svc.audit(req, 'delete', 'fees', f.id, f.title); req.flash('success', 'صورت‌حساب حذف شد.'); res.redirect('/finance');
  } catch (e) { next(e); }
});
router.get('/finance/receipt/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const p = await k('payments').where({ id: req.params.id }).first(); if (!p) return nf(res);
    const f = await loadFee(req, p.fee_id); if (!f) return nf(res);
    res.view('finance/receipt', { title: 'رسید پرداخت', p, f });
  } catch (e) { next(e); }
});
module.exports = router;

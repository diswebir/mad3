'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { L } = require('../labels');
const fin = require('../lib/finance');
const sms = require('../lib/sms');
const settings = require('../settings');
const xlsx = require('../lib/xlsx');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/finance', modules.guard('finance'));
const mgr = requireRole('admin', 'deputy');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد یافت نشد یا دسترسی ندارید.' });

const feeQuery = (k) => k('fees as f').join('students as s', 's.id', 'f.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id')
  .leftJoin(fin.paidSub(k), 'p.fee_id', 'f.id')
  .select('f.*', 's.first_name', 's.last_name', 's.student_code', 's.father_phone', 's.mother_phone', 'c.name as class_name', k.raw('coalesce(p.paid, 0) as paid'));
const net = (f) => Number(f.amount) - Number(f.discount || 0);
async function loadInstallments(k, feeIds) {
  const map = {}; if (!feeIds.length) return map;
  for (let i = 0; i < feeIds.length; i += 500) for (const r of await k('fee_installments').whereIn('fee_id', feeIds.slice(i, i + 500)).orderBy('seq')) (map[r.fee_id] = map[r.fee_id] || []).push(r);
  return map;
}

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
    const instMap = await loadInstallments(k, rows.map((f) => f.id));
    rows.forEach((f) => { f.insts = instMap[f.id] || []; if (f.insts.length) f.overdue = fin.overdueAmount(f, f.insts, today) > 0; });
    if (req.query.state) rows = rows.filter((f) => f.state === req.query.state);
    const sum = rows.reduce((a, f) => ({ billed: a.billed + f.net, paid: a.paid + Number(f.paid) }), { billed: 0, paid: 0 });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 25;
    res.view('finance/index', { title: 'امور مالی', rows: rows.slice((page - 1) * per, page * per), total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / per)), sum, f: req.query, classes: u.role === 'student' ? [] : await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'), isStudent: u.role === 'student' });
  } catch (e) { next(e); }
});
router.get('/finance/debtors', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const rows = await feeQuery(k); const instMap = await loadInstallments(k, rows.map((f) => f.id));
    const by = {};
    for (const f of rows) { const rem = Math.max(0, net(f) - Number(f.paid)); if (!rem) continue; const o = (by[f.student_id] = by[f.student_id] || { id: f.student_id, name: `${f.first_name} ${f.last_name}`, class_name: f.class_name, phone: f.father_phone || f.mother_phone, remaining: 0, overdue: 0, items: 0 }); o.remaining += rem; o.items++; o.overdue += fin.overdueAmount(f, instMap[f.id]); }
    const list = Object.values(by).sort((a, b) => b.remaining - a.remaining);
    if (req.query.format === 'csv') return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="debtors.csv"').send(toCSV(['دانش‌آموز', 'کلاس', 'تلفن اولیا', 'تعداد صورت‌حساب', 'مانده', 'سررسید گذشته'], list.map((x) => [x.name, x.class_name, x.phone, x.items, x.remaining, x.overdue])));
    res.view('finance/debtors', { title: 'بدهکاران', list, total: list.reduce((a, b) => a + b.remaining, 0) });
  } catch (e) { next(e); }
});
const FIELDS_DEF = () => ({ categories: Object.entries(L.feeCategory) });
router.get('/finance/fees/new', mgr, async (req, res, next) => {
  try {
    const k = db.get();
    res.view('finance/form', { title: 'صورت‌حساب جدید', errors: [], vals: { category: 'tuition', student_id: req.query.student_id || '', due_date: J.isoToJString(J.addDays(J.todayISO(), 30)) }, classes: await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'), students: await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname'), ...FIELDS_DEF() });
  } catch (e) { next(e); }
});
router.post('/finance/fees/new', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const errors = [];
    const amount = Number(String(b.amount || '').replace(/[,٬]/g, '')); const discount = Number(String(b.discount || '0').replace(/[,٬]/g, ''));
    if (!b.title) errors.push('عنوان را وارد کنید.'); if (isNaN(amount) || amount <= 0) errors.push('مبلغ نامعتبر است.'); if (isNaN(discount) || discount < 0 || discount > amount) errors.push('تخفیف نامعتبر است.');
    const due = b.due_date ? J.parseJalali(b.due_date) : null; if (b.due_date && !due) errors.push('سررسید نامعتبر است.');
    if (parseInt(b.installments, 10) > 1 && !due) errors.push('برای اقساط، تاریخ سررسید قسط اول لازم است.');
    if (!L.feeCategory[b.category]) errors.push('دسته نامعتبر است.');
    let students = [];
    if (b.target === 'class') { if (!b.classroom_id) errors.push('کلاس را انتخاب کنید.'); else students = await k('students').where({ classroom_id: b.classroom_id, status: 'active' }).select('id', 'user_id', 'father_national_id', 'father_phone'); if (b.classroom_id && !students.length) errors.push('کلاس دانش‌آموز فعال ندارد.'); }
    else { const s = b.student_id ? await k('students').where({ id: b.student_id }).first() : null; if (!s) errors.push('دانش‌آموز را انتخاب کنید.'); else students = [s]; }
    if (errors.length) {
      return res.view('finance/form', { title: 'صورت‌حساب جدید', errors, vals: b, classes: await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'), students: await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname'), ...FIELDS_DEF() });
    }
    const year = await k('academic_years').where({ is_current: 1 }).first();
    const n = Math.max(1, Math.min(24, parseInt(b.installments, 10) || 1)); const step = Math.max(1, Math.min(12, parseInt(b.installment_step, 10) || 1));
    const percent = b.sibling === '1' && b.category === 'tuition' ? settings.num('sibling_discount_percent') : 0; const ranks = percent ? await fin.siblingRanks(k) : {};
    let sib = 0;
    await k.transaction(async (t) => {
      for (const s of students) {
        const sd = fin.siblingDiscount(amount, percent, ranks[s.id] || 0); if (sd) sib++;
        const disc = Math.min(amount, discount + sd);
        const [id0] = await t('fees').insert({ student_id: s.id, title: b.title, amount, discount: disc, due_date: due, category: b.category, academic_year_id: year ? year.id : null, notes: b.notes || null, discount_note: sd ? `تخفیف خواهر/برادر ${percent}٪` : null });
        const feeId = typeof id0 === 'object' ? id0.id : id0;
        if (n > 1) await t('fee_installments').insert(fin.splitInstallments(amount - disc, n, due, step).map((i) => ({ ...i, fee_id: feeId })));
      }
    });
    await svc.notify(students.map((s) => s.user_id), 'صورت‌حساب جدید ثبت شد', `${b.title} — ${amount.toLocaleString('en-US')}`, '/finance');
    await svc.audit(req, 'create', 'fees', null, `${b.title} برای ${students.length} نفر${n > 1 ? ' در ' + n + ' قسط' : ''}${sib ? '، ' + sib + ' تخفیف خواهر/برادر' : ''}`);
    req.flash('success', `صورت‌حساب برای ${students.length} دانش‌آموز ثبت شد${n > 1 ? ' (' + n + ' قسط)' : ''}${sib ? ` — تخفیف خواهر/برادر برای ${sib} نفر اعمال شد` : ''}.`); res.redirect('/finance');
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
    const insts = fin.installmentStatus(await k('fee_installments').where({ fee_id: f.id }).orderBy('seq'), f.paid);
    res.view('finance/show', { title: f.title, f, insts, payments: await k('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').where('p.fee_id', f.id).orderBy('p.id').select('p.*', 'u.full_name as recorder'), today: J.isoToJString(J.todayISO()) });
  } catch (e) { next(e); }
});
router.post('/finance/fees/:id(\\d+)/pay', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const f = await loadFee(req, req.params.id); if (!f) return nf(res);
    const amount = Number(String(req.body.amount || '').replace(/[,٬]/g, '')); const date = J.parseJalali(req.body.paid_at) || J.todayISO();
    if (isNaN(amount) || amount <= 0) { req.flash('error', 'مبلغ نامعتبر است.'); return res.redirect('/finance/fees/' + f.id); }
    if (amount > f.remaining) { req.flash('error', 'مبلغ پرداخت بیشتر از مانده صورت‌حساب است.'); return res.redirect('/finance/fees/' + f.id); }
    let docNo; let pid;
    await k.transaction(async (t) => { docNo = await fin.nextDocNo(t, date); const [r] = await t('payments').insert({ fee_id: f.id, amount, paid_at: date, method: L.payMethod[req.body.method] ? req.body.method : 'cash', reference: (req.body.reference || '').slice(0, 60) || null, recorded_by: req.user.id, doc_no: docNo }); pid = typeof r === 'object' ? r.id : r; });
    const r = [pid];
    const s = await k('students').where({ id: f.student_id }).first(); await svc.notify(s.user_id, 'پرداخت شما ثبت شد', `${f.title} — ${amount.toLocaleString('en-US')}`, '/finance', 'success');
    await svc.audit(req, 'payment', 'payments', Array.isArray(r) ? r[0] : r, `${f.title} — ${amount}`); req.flash('success', `پرداخت ثبت شد (سند ${docNo}).`); res.redirect('/finance/fees/' + f.id);
  } catch (e) { next(e); }
});
/** ابطال پرداخت (به‌جای حذف): شماره سند حفظ می‌شود و دلیل ثبت می‌گردد */
router.post('/finance/payments/:id(\\d+)/void', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const p = await k('payments').where({ id: req.params.id }).first(); if (!p) return nf(res);
    const reason = String(req.body.reason || '').trim();
    if (p.voided) { req.flash('error', 'این پرداخت قبلاً باطل شده است.'); return res.redirect('/finance/fees/' + p.fee_id); }
    if (reason.length < 3) { req.flash('error', 'دلیل ابطال را بنویسید.'); return res.redirect('/finance/fees/' + p.fee_id); }
    await k('payments').where({ id: p.id }).update({ voided: 1, void_reason: reason.slice(0, 250) });
    await svc.audit(req, 'void', 'payments', p.id, `${p.doc_no || p.id}: ${reason}`); req.flash('success', 'پرداخت باطل شد.'); res.redirect('/finance/fees/' + p.fee_id);
  } catch (e) { next(e); }
});
router.post('/finance/payments/:id(\\d+)/delete', requireRole('admin'), async (req, res, next) => {
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

/* ---------- گزارش درآمد ماهانه ---------- */
async function incomeData(k, jy, jm) {
  const { start, end } = J.monthRange(jy, jm);
  const pays = await k('payments as p').join('fees as f', 'f.id', 'p.fee_id').where('p.voided', 0).whereBetween('p.paid_at', [start, end]).select('p.id', 'p.amount', 'p.paid_at', 'p.method', 'p.doc_no', 'f.category', 'f.title', 'f.student_id');
  const byMethod = {}; const byCategory = {}; const byDay = {}; let total = 0;
  for (const p of pays) { const a = Number(p.amount); total += a; byMethod[p.method] = (byMethod[p.method] || 0) + a; byCategory[p.category] = (byCategory[p.category] || 0) + a; byDay[p.paid_at] = (byDay[p.paid_at] || 0) + a; }
  const voided = Number((await k('payments').where('voided', 1).whereBetween('paid_at', [start, end]).count({ c: '*' }).first()).c);
  return { start, end, pays, byMethod, byCategory, byDay, total, count: pays.length, voided };
}
router.get('/finance/income', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const t0 = J.isoToJ(J.todayISO());
    const jy = Number(req.query.year) || t0.jy; const jm = Math.min(12, Math.max(1, Number(req.query.month) || t0.jm));
    const d = await incomeData(k, jy, jm);
    // خلاصه‌ی ۱۲ ماه سال
    const months = [];
    for (let m = 1; m <= 12; m++) { const r = J.monthRange(jy, m); const row = await k('payments').where('voided', 0).whereBetween('paid_at', [r.start, r.end]).sum({ a: 'amount' }).count({ c: '*' }).first(); months.push({ m, total: Number(row.a || 0), count: Number(row.c || 0) }); }
    if (req.query.format === 'xlsx') {
      const rows = [['شماره سند', 'تاریخ', 'مبلغ', 'روش', 'دسته', 'عنوان'], ...d.pays.sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1)).map((p) => [p.doc_no || '', J.isoToJString(p.paid_at), Number(p.amount), L.payMethod[p.method] || p.method, L.feeCategory[p.category] || p.category, p.title])];
      const buf = xlsx.build([{ name: 'درآمد ' + jy + '-' + jm, rows }, { name: 'خلاصه سال ' + jy, rows: [['ماه', 'تعداد پرداخت', 'جمع'], ...months.map((x) => [J.MONTHS[x.m - 1], x.count, x.total])] }]);
      return res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="income-${jy}-${jm}.xlsx"`).send(buf);
    }
    res.view('finance/income', { title: 'گزارش درآمد ماهانه', jy, jm, d, months, MONTHS: J.MONTHS, charts: require('../lib/charts') });
  } catch (e) { next(e); }
});

/* ---------- یادآوری پیامکی بدهی ---------- */
router.post('/finance/debtors/remind', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const rows = await feeQuery(k); const instMap = await loadInstallments(k, rows.map((f) => f.id));
    const only = req.body.only === 'overdue'; const by = {};
    for (const f of rows) { const rem = Math.max(0, net(f) - Number(f.paid)); if (!rem) continue; const od = fin.overdueAmount(f, instMap[f.id]); if (only && !od) continue; const o = (by[f.student_id] = by[f.student_id] || { id: f.student_id, rem: 0 }); o.rem += only ? od : rem; }
    const ids = Object.keys(by).map(Number); if (!ids.length) { req.flash('info', 'بدهکاری برای ارسال یادآوری وجود ندارد.'); return res.redirect('/finance/debtors'); }
    const stu = await k('students').whereIn('id', ids).select('id', 'user_id', 'first_name', 'last_name', 'father_phone', 'mother_phone', 'guardian_phone');
    const F = require('../utils/fa');
    const msg = (s) => sms.render('اولیای گرامی، مانده‌ی حساب {student} مبلغ {amount} ریال است. لطفاً نسبت به پرداخت اقدام فرمایید. {school}', { student: `${s.first_name} ${s.last_name}`, amount: F.toFa(by[s.id].rem.toLocaleString('en-US')) });
    await svc.notify(stu.map((s) => s.user_id), 'یادآوری مانده‌ی حساب', 'لطفاً صورت‌حساب‌های پرداخت‌نشده را بررسی کنید.', '/finance', 'warn');
    let smsN = 0;
    if (sms.config().enabled) { const items = []; for (const s of stu) for (const n of sms.parentNumbers(s)) items.push({ to: n, message: msg(s), studentId: s.id }); smsN = await sms.enqueue(items, { event: 'debt', userId: req.user.id }); }
    await svc.audit(req, 'debt_reminder', 'fees', null, `${stu.length} دانش‌آموز، ${smsN} پیامک`);
    req.flash('success', `یادآوری برای ${stu.length} دانش‌آموز ارسال شد${sms.config().enabled ? ` (${smsN} پیامک)` : ' (پیامک غیرفعال است؛ فقط اعلان درون‌برنامه‌ای)'}.`); res.redirect('/finance/debtors');
  } catch (e) { next(e); }
});
module.exports = router;

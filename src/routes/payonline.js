'use strict';
/**
 * پرداخت اینترنتی شهریه:
 *  - دانش‌آموز/اولیا: POST /finance/fees/:id/online  → انتقال به درگاه
 *  - بازگشت از درگاه (عمومی، بدون نیاز به نشست): GET /pay/callback/:token  → تأیید سرور‌به‌سرور و ثبت سند
 *  - مدیر/معاون: فهرست تراکنش‌ها و «بررسی وضعیت» برای تراکنش‌های نیمه‌کاره
 * ثبت پرداخت idempotent است: هر تراکنش حداکثر یک‌بار سند می‌خورد.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const svc = require('../services');
const J = require('../utils/jalali');
const config = require('../config');
const settings = require('../settings');
const fin = require('../lib/finance');
const gw = require('../lib/gateway');
const { requireRole } = require('../middleware');
const router = express.Router(); const publicRouter = express.Router();
const mgr = requireRole('admin', 'deputy');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد یافت نشد یا دسترسی ندارید.' });
const base = () => (config.load().basePath || '').replace(/\/$/, '');

/** مانده‌ی صورت‌حساب (پرداخت‌های باطل‌نشده کسر می‌شود) */
async function remainingOf(k, feeId) {
  const f = await k('fees').where({ id: feeId }).first(); if (!f) return null;
  const p = await k('payments').where({ fee_id: feeId, voided: 0 }).sum({ s: 'amount' }).first();
  return { fee: f, remaining: Math.max(0, Number(f.amount) - Number(f.discount || 0) - Number((p && p.s) || 0)) };
}

/** ثبت قطعی پرداخت موفق (idempotent). خروجی: { done, docNo } */
async function settle(k, tx, info) {
  let docNo = null; let done = false;
  await k.transaction(async (t) => {
    const n = await t('online_payments').where({ id: tx.id, status: 'pending' }).update({ status: 'paid', ref_id: info.refId || null, card_pan: info.card || null, paid_at: svc.nowStr(), error: null });
    if (!n) return; // قبلاً نهایی شده
    const today = J.todayISO(); docNo = await fin.nextDocNo(t, today);
    const r = await t('payments').insert({ fee_id: tx.fee_id, amount: tx.amount, paid_at: today, method: 'online', reference: (info.refId ? String(info.refId) : 'ONLINE-' + tx.id).slice(0, 60), recorded_by: null, doc_no: docNo });
    await t('online_payments').where({ id: tx.id }).update({ payment_id: Array.isArray(r) ? r[0] : r });
    done = true;
  });
  if (done) {
    try {
      const f = await k('fees').where({ id: tx.fee_id }).first(); const s = await k('students').where({ id: tx.student_id }).first();
      if (s && s.user_id) await svc.notify(s.user_id, 'پرداخت آنلاین موفق', `${f ? f.title : 'شهریه'} — ${Number(tx.amount).toLocaleString('en-US')} (سند ${docNo})`, '/finance', 'success');
      await svc.notify(await svc.managerIds(), 'پرداخت آنلاین جدید', `${s ? s.first_name + ' ' + s.last_name : ''} — ${f ? f.title : ''} — ${Number(tx.amount).toLocaleString('en-US')}`, '/finance/online', 'info');
      await svc.audit({ user: null, ip: null }, 'online_payment', 'payments', tx.id, `${f ? f.title : ''} — ${tx.amount} — سند ${docNo}`);
    } catch (_) { /* اعلان نباید ثبت سند را خراب کند */ }
  }
  return { done, docNo };
}
async function fail(k, tx, error, status = 'failed') { await k('online_payments').where({ id: tx.id, status: 'pending' }).update({ status, error: String(error || '').slice(0, 250) }); }

/** نتیجه‌ی بازگشت از درگاه را نهایی می‌کند → { state: paid|failed|pending, msg } */
async function finalize(k, tx, gatewayStatus) {
  if (tx.status === 'paid') return { state: 'paid' };
  if (tx.status !== 'pending') return { state: tx.status, msg: tx.error };
  if (gatewayStatus && String(gatewayStatus).toUpperCase() !== 'OK') { await fail(k, tx, 'پرداخت توسط پرداخت‌کننده لغو شد یا ناموفق بود.', 'cancelled'); return { state: 'cancelled' }; }
  let v;
  if (tx.provider === 'demo') v = tx.demo_ok ? { ok: true, refId: 'DEMO-' + tx.id } : { ok: false, error: 'پرداخت آزمایشی تأیید نشد.' };
  else v = await gw.verify({ authority: tx.authority, amount: tx.amount });
  if (v.ok) { await settle(k, tx, v); return { state: 'paid' }; }
  if (v.unreachable) return { state: 'pending', msg: v.error };
  await fail(k, tx, v.error); return { state: 'failed', msg: v.error };
}

/* ---------- شروع پرداخت ---------- */
router.post('/finance/fees/:id(\\d+)/online', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const back = '/finance/fees/' + Number(req.params.id);
    if (u.role !== 'student' || !u.student) { req.flash('error', 'پرداخت آنلاین فقط برای دانش‌آموز/اولیا فعال است.'); return res.redirect(back); }
    if (!gw.ready()) { req.flash('error', 'پرداخت آنلاین فعال نیست.'); return res.redirect(back); }
    const rf = await remainingOf(k, Number(req.params.id)); if (!rf || rf.fee.student_id !== u.student.id) return nf(res);
    if (rf.remaining <= 0) { req.flash('info', 'این صورت‌حساب تسویه شده است.'); return res.redirect(back); }
    let amount = rf.remaining;
    if (settings.bool('pay_allow_partial') && req.body.amount !== undefined && String(req.body.amount).trim() !== '') {
      amount = Math.round(Number(String(req.body.amount).replace(/[,٬\s]/g, '')));
      if (!Number.isFinite(amount) || amount < 1) { req.flash('error', 'مبلغ نامعتبر است.'); return res.redirect(back); }
      if (amount > rf.remaining) { req.flash('error', 'مبلغ بیشتر از مانده‌ی صورت‌حساب است.'); return res.redirect(back); }
    }
    const token = crypto.randomBytes(20).toString('hex'); const c = gw.cfg();
    const callback = `${req.protocol}://${req.get('host')}${base()}/pay/callback/${token}`;
    const ins = await k('online_payments').insert({ token, fee_id: rf.fee.id, student_id: u.student.id, amount, provider: c.provider, status: 'pending', initiated_by: u.id });
    const id = Array.isArray(ins) ? ins[0] : ins;
    const r = await gw.request({ amount, callbackUrl: callback, description: `${rf.fee.title} — ${u.student.first_name || ''} ${u.student.last_name || ''}`.trim(), mobile: (u.student.father_phone || u.student.mother_phone || u.phone || '').replace(/\D/g, '').replace(/^98/, '0'), token });
    if (!r.ok) { await k('online_payments').where({ id }).update({ status: 'failed', error: String(r.error).slice(0, 250) }); req.flash('error', 'اتصال به درگاه ناموفق بود: ' + r.error); return res.redirect(back); }
    await k('online_payments').where({ id }).update({ authority: r.authority });
    await svc.audit(req, 'online_start', 'online_payments', id, `${rf.fee.title} — ${amount}`);
    res.redirect(r.demo ? '/pay/demo/' + token : r.payUrl);
  } catch (e) { next(e); }
});

/* ---------- درگاه آزمایشی داخلی (فقط وقتی ارائه‌دهنده demo است و پرداخت‌کننده وارد شده است) ---------- */
router.get('/pay/demo/:token([a-f0-9]{40})', async (req, res, next) => {
  try {
    const k = db.get(); const tx = await k('online_payments').where({ token: req.params.token, provider: 'demo', status: 'pending' }).first(); if (!tx) return nf(res);
    if (!(req.user.role === 'admin' || (req.user.student && req.user.student.id === tx.student_id))) return nf(res);
    const f = await k('fees').where({ id: tx.fee_id }).first();
    res.view('finance/demo_gateway', { title: 'درگاه پرداخت آزمایشی', tx, fee: f }, 'bare');
  } catch (e) { next(e); }
});
router.post('/pay/demo/:token([a-f0-9]{40})', async (req, res, next) => {
  try {
    const k = db.get(); const tx = await k('online_payments').where({ token: req.params.token, provider: 'demo', status: 'pending' }).first(); if (!tx) return nf(res);
    if (!(req.user.role === 'admin' || (req.user.student && req.user.student.id === tx.student_id))) return nf(res);
    const ok = req.body.result === 'ok'; if (ok) await k('online_payments').where({ id: tx.id }).update({ demo_ok: 1 });
    res.redirect(`/pay/callback/${tx.token}?Authority=${encodeURIComponent(tx.authority)}&Status=${ok ? 'OK' : 'NOK'}`);
  } catch (e) { next(e); }
});

/* ---------- بازگشت از درگاه (عمومی) ---------- */
publicRouter.get('/pay/callback/:token([a-f0-9]{40})', async (req, res, next) => {
  try {
    const k = db.get(); const tx = await k('online_payments').where({ token: req.params.token }).first(); if (!tx) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'تراکنش یافت نشد.' }, 'bare');
    if (req.query.Authority && tx.authority && String(req.query.Authority) !== tx.authority) return res.status(400).view('error', { code: 400, title: 'درخواست نامعتبر', message: 'شناسه‌ی تراکنش با درخواست مطابقت ندارد.' }, 'bare');
    const out = await finalize(k, tx, req.query.Status);
    const fresh = await k('online_payments as o').join('fees as f', 'f.id', 'o.fee_id').leftJoin('payments as p', 'p.id', 'o.payment_id').where('o.id', tx.id).first('o.amount', 'o.ref_id', 'f.title', 'p.doc_no', 'o.fee_id');
    res.view('finance/pay_result', { title: 'نتیجه‌ی پرداخت', out, tx: fresh, payerHome: base() + '/finance/fees/' + tx.fee_id }, 'bare');
  } catch (e) { next(e); }
});

/* ---------- مدیریت ---------- */
router.get('/finance/online', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const st = ['pending', 'paid', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : '';
    const q = k('online_payments as o').join('fees as f', 'f.id', 'o.fee_id').join('students as s', 's.id', 'o.student_id').leftJoin('payments as p', 'p.id', 'o.payment_id').orderBy('o.id', 'desc')
      .select('o.*', 'f.title', 's.first_name', 's.last_name', 's.student_code', 'p.doc_no'); if (st) q.where('o.status', st);
    const pg = await require('../utils/paginate').paginate(q, req, 25);
    const sum = await k('online_payments').where({ status: 'paid' }).sum({ s: 'amount' }).count({ n: '*' }).first();
    res.view('finance/online', { title: 'پرداخت‌های آنلاین', rows: pg.rows, page: pg.page, pages: pg.pages, st, total: Number((sum && sum.s) || 0), count: Number((sum && sum.n) || 0), ready: gw.ready(), provider: gw.cfg().provider });
  } catch (e) { next(e); }
});
router.post('/finance/online/:id(\\d+)/check', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const tx = await k('online_payments').where({ id: req.params.id }).first(); if (!tx) return nf(res);
    if (tx.status !== 'pending') { req.flash('info', 'این تراکنش قبلاً نهایی شده است.'); return res.redirect('/finance/online'); }
    if (tx.provider === 'demo') { await fail(k, tx, 'پرداخت آزمایشی ناتمام ماند.', 'cancelled'); req.flash('info', 'تراکنش آزمایشی لغو شد.'); return res.redirect('/finance/online'); }
    const out = await finalize(k, tx, 'OK'); await svc.audit(req, 'online_check', 'online_payments', tx.id, out.state);
    req.flash(out.state === 'paid' ? 'success' : out.state === 'pending' ? 'info' : 'error', out.state === 'paid' ? 'پرداخت در درگاه تأیید و سند ثبت شد.' : out.state === 'pending' ? (out.msg || 'درگاه در دسترس نیست؛ بعداً دوباره بررسی کنید.') : 'درگاه این پرداخت را تأیید نکرد: ' + (out.msg || ''));
    res.redirect('/finance/online');
  } catch (e) { next(e); }
});

module.exports = router; module.exports.publicRouter = publicRouter; module.exports.finalize = finalize;

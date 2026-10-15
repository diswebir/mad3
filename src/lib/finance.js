'use strict';
/** منطق مالی: اقساط، تخفیف هم‌شهریه‌ای (فرزند دوم به بعد)، شماره سند */
const J = require('../utils/jalali');

/** زیرپرسش مجموع پرداخت‌های معتبر (باطل‌شده‌ها حساب نمی‌شوند) */
const paidSub = (k) => k('payments').where('voided', 0).select('fee_id').sum({ paid: 'amount' }).groupBy('fee_id').as('p');

/** تقسیم مبلغ به n قسط (باقی‌مانده به قسط آخر) با فاصله‌ی ماهانه از اولین سررسید (ISO) */
function splitInstallments(total, n, firstDueISO, stepMonths = 1) {
  n = Math.max(1, Math.min(24, Math.floor(n))); total = Math.round(total);
  const base = Math.floor(total / n); const out = [];
  const j = firstDueISO ? J.isoToJ(firstDueISO) : null;
  for (let i = 0; i < n; i++) {
    let due = null;
    if (j) { let m = j.jm - 1 + i * stepMonths; const y = j.jy + Math.floor(m / 12); m = (m % 12) + 1; due = J.jToIso(y, m, Math.min(j.jd, J.monthLength(y, m))); }
    out.push({ seq: i + 1, due_date: due, amount: i === n - 1 ? total - base * (n - 1) : base });
  }
  return out;
}

/** وضعیت اقساط با تخصیص پرداخت‌ها به‌ترتیب قسط (FIFO). خروجی: [{...installment, paid, state, overdue}] */
function installmentStatus(insts, paid, today = J.todayISO()) {
  let left = Number(paid) || 0;
  return insts.slice().sort((a, b) => a.seq - b.seq).map((i) => {
    const amt = Number(i.amount); const p = Math.min(left, amt); left -= p;
    const state = p >= amt ? 'paid' : p > 0 ? 'partial' : 'unpaid';
    return { ...i, amount: amt, paid: p, state, overdue: state !== 'paid' && !!i.due_date && i.due_date < today };
  });
}
/** مبلغ سررسیدگذشته‌ی پرداخت‌نشده برای یک صورت‌حساب (با یا بدون اقساط) */
function overdueAmount(fee, insts, today = J.todayISO()) {
  const net = Number(fee.amount) - Number(fee.discount || 0); const paid = Number(fee.paid || 0);
  if (insts && insts.length) return installmentStatus(insts, paid, today).filter((i) => i.overdue).reduce((a, i) => a + (i.amount - i.paid), 0);
  return fee.due_date && fee.due_date < today ? Math.max(0, net - paid) : 0;
}

/** رتبه‌ی هر دانش‌آموز در خانواده: 0 = فرزند اول (کوچک‌ترین id) ... کلید خانواده: کد ملی پدر، وگرنه موبایل پدر */
async function siblingRanks(k) {
  const rows = await k('students').where('status', 'active').select('id', 'father_national_id', 'father_phone');
  const groups = {};
  for (const s of rows) { const key = (s.father_national_id && 'n' + s.father_national_id) || (s.father_phone && 'p' + String(s.father_phone).replace(/\D/g, '').replace(/^98|^0/, '')) || null; if (key) (groups[key] = groups[key] || []).push(s.id); }
  const rank = {};
  for (const ids of Object.values(groups)) { ids.sort((a, b) => a - b); ids.forEach((id, i) => { rank[id] = i; }); }
  return rank;
}
/** تخفیف خواهر/برادری: درصدی از مبلغ برای فرزند دوم به بعد */
const siblingDiscount = (amount, percent, rank) => (rank > 0 && percent > 0 ? Math.round((Number(amount) * Math.min(percent, 100)) / 100) : 0);

/** شماره سند پرداخت: «سال-شماره‌ی ترتیبی ۵ رقمی». باید داخل تراکنش صدا زده شود */
async function nextDocNo(t, dateISO = J.todayISO()) {
  const y = J.isoToJ(dateISO).jy; const prefix = `${y}-`;
  const last = await t('payments').where('doc_no', 'like', prefix + '%').orderBy('doc_no', 'desc').first('doc_no');
  const n = last ? parseInt(last.doc_no.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(5, '0');
}
/** شماره‌گذاری پرداخت‌های قدیمیِ بدون شماره (هنگام ارتقا) به ترتیب شناسه */
async function backfillDocNos(k) {
  const rows = await k('payments').whereNull('doc_no').orderBy('id');
  if (!rows.length) return 0;
  await k.transaction(async (t) => {
    const seqs = {};
    const existing = await t('payments').whereNotNull('doc_no').select('doc_no');
    for (const e of existing) { const [y, n] = e.doc_no.split('-'); seqs[y] = Math.max(seqs[y] || 0, parseInt(n, 10) || 0); }
    for (const r of rows) {
      const y = String(J.isoToJ(String(r.paid_at || J.todayISO()).slice(0, 10)).jy); seqs[y] = (seqs[y] || 0) + 1;
      await t('payments').where({ id: r.id }).update({ doc_no: `${y}-${String(seqs[y]).padStart(5, '0')}` });
    }
  });
  return rows.length;
}
module.exports = { paidSub, splitInstallments, installmentStatus, overdueAmount, siblingRanks, siblingDiscount, nextDocNo, backfillDocNos };

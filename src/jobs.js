'use strict';
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const { KnexStore } = require('./middleware');
const sla = require('./lib/sla');
const svc = require('./services');

const J = require('./utils/jalali');
const fin = require('./lib/finance');
const sms = require('./lib/sms');

/** یادآوری اقساط نزدیک به سررسید: N روز قبل (fee_reminder_days)، هر قسط فقط یک‌بار، فقط اقساط پرداخت‌نشده */
async function remindInstallments(today = J.todayISO()) {
  const days = settings.num('fee_reminder_days'); if (!(days > 0) || !modules.isEnabled('finance')) return 0;
  const k = db.get(); const until = J.addDays(today, days);
  const due = await k('fee_installments').whereNull('reminded_at').whereNotNull('due_date').where('due_date', '>=', today).where('due_date', '<=', until).orderBy('id').limit(500);
  let n = 0;
  for (const ins of due) {
    const fee = await k('fees').where({ id: ins.fee_id }).first(); if (!fee) { await k('fee_installments').where({ id: ins.id }).update({ reminded_at: today }); continue; }
    const paid = Number((await k('payments').where({ fee_id: fee.id, voided: 0 }).sum({ s: 'amount' }).first()).s || 0);
    const st = fin.installmentStatus(await k('fee_installments').where({ fee_id: fee.id }).orderBy('seq'), paid, today).find((x) => x.id === ins.id);
    await k('fee_installments').where({ id: ins.id }).update({ reminded_at: today });
    if (!st || st.state === 'paid') continue;
    const stu = await k('students').where({ id: fee.student_id, status: 'active' }).first(); if (!stu) continue;
    const left = st.amount - st.paid; const F = require('./utils/fa');
    await svc.notify([stu.user_id], 'یادآوری سررسید قسط', `قسط ${F.toFa(ins.seq)} «${fee.title}» به مبلغ ${F.money(left)} ریال در تاریخ ${F.toFa(J.isoToJString(ins.due_date))} سررسید می‌شود.`, '/finance', 'warn');
    if (sms.config().enabled) await sms.enqueue(sms.parentNumbers(stu).map((to) => ({ to, studentId: stu.id, message: sms.render('اولیای گرامی، قسط {seq} «{fee}» {student} به مبلغ {amount} ریال تا تاریخ {date} سررسید دارد. {school}', { student: `${stu.first_name} ${stu.last_name}`, seq: F.toFa(ins.seq), fee: fee.title, amount: F.money(left), date: F.toFa(J.isoToJString(ins.due_date)) }) })), { event: 'debt' });
    n++;
  }
  return n;
}

/** کارهای دوره‌ای: هم هر ۳۰ دقیقه از داخل برنامه و هم با فراخوانی cron (آدرس /cron). نتیجه‌ی هر کار برمی‌گردد. */
async function run() {
  const out = {};
  const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'error: ' + e.message; console.error('[jobs]', name, e.message); } };
  await step('sessions', async () => { await KnexStore.cleanup(); return true; });
  await step('otp_cleanup', async () => require('./lib/otp').cleanup());
  if (modules.isEnabled('tickets')) {
    await step('tickets_autoclose', async () => {
      const days = settings.num('ticket_auto_close_days'); if (!(days > 0)) return 0;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      return db.get()('tickets').where({ status: 'answered' }).where('updated_at', '<', cutoff).update({ status: 'closed', closed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    });
    await step('tickets_escalated', () => escalate());
  }
  if (modules.isEnabled('grades')) await step('scores_autolock', () => require('./lib/scoreLock').autoLock());
  if (modules.isEnabled('backup')) await step('backup', async () => { const r = await require('./lib/backupTools').dailyJob(); return r ? r.name : null; });
  if (modules.isEnabled('backup')) await step('offsite', async () => { const r = await require('./lib/offsite').syncPending(); return r.skipped ? 'off' : `${r.sent} ارسال، ${r.failed} ناموفق`; });
  await step('ratelimit', () => require('./lib/ratelimit').purge());
  await step('fee_reminders', () => remindInstallments());
  if (modules.isEnabled('birthdays')) await step('birthdays', async () => { const r = await require('./lib/birthdays').run(); return r.skipped || r.sent; });
  return out;
}

/** ارجاع تیکت‌های سررسیدگذشته (SLA) به مدیران؛ هر تیکت فقط یک‌بار */
async function escalate(nowMs = Date.now()) {
  const base = settings.num('ticket_sla_hours'); if (!(base > 0) || !settings.bool('ticket_escalate')) return 0;
  const k = db.get(); const rows = await k('tickets').whereIn('status', ['open', 'pending']).whereNull('escalated_at').limit(500);
  const late = rows.filter((t) => sla.status(t, base, nowMs).state === 'overdue'); if (!late.length) return 0;
  const mgrs = await svc.managerIds();
  for (const t of late) {
    await k('tickets').where({ id: t.id }).update({ escalated_at: sla.fmtUTC(nowMs) });
    await svc.notify([...new Set([...mgrs, ...(t.recipient_user_id ? [t.recipient_user_id] : [])])], 'تیکت بی‌پاسخ (فراتر از مهلت)', t.subject, '/tickets/' + t.id, 'warn');
  }
  return late.length;
}
module.exports = { run, escalate, remindInstallments };

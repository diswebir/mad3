'use strict';
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const { KnexStore } = require('./middleware');
const sla = require('./lib/sla');
const svc = require('./services');

/** کارهای دوره‌ای سبک: پاک‌سازی نشست‌ها، بستن خودکار تیکت‌ها */
async function run() {
  try {
    await KnexStore.cleanup();
    if (modules.isEnabled('tickets')) {
      const days = settings.num('ticket_auto_close_days');
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
        await db.get()('tickets').where({ status: 'answered' }).where('updated_at', '<', cutoff).update({ status: 'closed', closed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
      }
      await escalate();
    }
  } catch (e) { console.error('[jobs]', e.message); }
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
module.exports = { run, escalate };

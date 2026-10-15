'use strict';
/** مهلت پاسخ‌گویی به تیکت (SLA). مبنا: آخرین بروزرسانی تیکتی که منتظر پاسخ است (open/pending). */
const PRIORITY_FACTOR = { urgent: 0.25, high: 0.5, normal: 1, low: 2 };
const parseUTC = (s) => { if (!s) return NaN; const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN; };
/** مهلت (ساعت) این تیکت با ضریب اولویت؛ 0 = غیرفعال */
const limitHours = (priority, baseHours) => (baseHours > 0 ? Math.max(1, Math.round(baseHours * (PRIORITY_FACTOR[priority] || 1))) : 0);
/**
 * وضعیت SLA: { state: 'na'|'ok'|'soon'|'overdue', dueAt, remainingH }
 * soon = کمتر از ۲۵٪ مهلت باقی مانده.
 */
function status(t, baseHours, nowMs = Date.now()) {
  if (!baseHours || baseHours <= 0 || !t || !['open', 'pending'].includes(t.status)) return { state: 'na', dueAt: null, remainingH: null };
  const since = parseUTC(t.updated_at || t.created_at); if (isNaN(since)) return { state: 'na', dueAt: null, remainingH: null };
  const lim = limitHours(t.priority, baseHours); const due = since + lim * 3600000; const rem = (due - nowMs) / 3600000;
  return { state: rem < 0 ? 'overdue' : rem < lim * 0.25 ? 'soon' : 'ok', dueAt: due, remainingH: Math.round(rem * 10) / 10, limit: lim };
}
const fmtUTC = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
module.exports = { PRIORITY_FACTOR, parseUTC, limitHours, status, fmtUTC };

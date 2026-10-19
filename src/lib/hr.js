'use strict';
/** منطق خالص منابع انسانی معلمان: مرخصی، موظفی، ارزشیابی */
const LEAVE_KINDS = { casual: 'مرخصی استحقاقی', sick: 'استعلاجی', mission: 'مأموریت', unpaid: 'بدون حقوق', other: 'سایر' };
const LEAVE_STATUS = { pending: 'در انتظار', approved: 'تأیید شده', rejected: 'رد شده' };
const CRITERIA = [
  { key: 'discipline', label: 'نظم و انضباط (حضور به‌موقع)' }, { key: 'method', label: 'روش تدریس و تسلط علمی' },
  { key: 'students', label: 'ارتباط با دانش‌آموزان' }, { key: 'parents', label: 'ارتباط با اولیا' },
  { key: 'records', label: 'ثبت به‌موقع نمرات و حضور و غیاب' }, { key: 'team', label: 'همکاری با همکاران و مدیریت' },
];
const toUTC = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
/** تعداد روزهای بازه (شامل دو سر)؛ NaN اگر نامعتبر یا معکوس باشد */
function daysBetween(a, b) { const x = toUTC(a); const y = toUTC(b); if (isNaN(x) || isNaN(y) || y < x) return NaN; return Math.round((y - x) / 86400000) + 1; }
const overlaps = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
/** برش بازه‌ی مرخصی با بازه‌ی سال (برای محاسبه‌ی روزهای مصرف‌شده در سال) */
function daysWithin(l, from, to) { const s = l.start_date > from ? l.start_date : from; const e = l.end_date < to ? l.end_date : to; return s > e ? 0 : daysBetween(s, e); }
/** مجموع نمره (از ۲۰) از امتیازهای ۱ تا ۵ هر معیار */
function evalTotal(scores) { const v = CRITERIA.map((c) => Number(scores[c.key])).filter((n) => n >= 1 && n <= 5); if (!v.length) return null; return Math.round((v.reduce((a, b) => a + b, 0) / (v.length * 5)) * 2000) / 100; }
/** وضعیت موظفی: ساعت تدریس واقعی در برابر ساعت موظف */
function loadStatus(hours, target) { const h = Number(hours) || 0; const t = Number(target) || 0; if (!t) return { state: 'none', diff: 0 }; const diff = h - t; return { state: diff > 0 ? 'over' : diff < 0 ? 'under' : 'ok', diff }; }
module.exports = { LEAVE_KINDS, LEAVE_STATUS, CRITERIA, daysBetween, overlaps, daysWithin, evalTotal, loadStatus };

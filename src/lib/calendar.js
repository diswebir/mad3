'use strict';
/** تقویم آموزشی: روزهای غیرتحصیلی = جمعه‌ها/روزهای خارج از هفته‌ی مدرسه + تعطیلی‌هایی که مدیر ثبت کرده */
const db = require('../db');
const settings = require('../settings');
const J = require('../utils/jalali');

/** تعطیلی‌های رسمیِ تاریخ ثابت شمسی (تعطیلی‌های قمری هر سال متفاوت‌اند و باید دستی ثبت شوند) */
const FIXED_SOLAR = [
  [1, 1, 'جشن نوروز'], [1, 2, 'عید نوروز'], [1, 3, 'عید نوروز'], [1, 4, 'عید نوروز'],
  [1, 12, 'روز جمهوری اسلامی'], [1, 13, 'روز طبیعت (سیزده‌به‌در)'], [3, 14, 'رحلت امام خمینی'], [3, 15, 'قیام ۱۵ خرداد'],
  [11, 22, 'پیروزی انقلاب اسلامی'], [12, 29, 'روز ملی شدن صنعت نفت'],
];

async function holidayOn(date, k = db.get()) {
  const h = await k('holidays').where('start_date', '<=', date).where('end_date', '>=', date).first();
  if (h) return { title: h.title, id: h.id, source: 'holidays' };
  const e = await k('events').where({ type: 'holiday' }).where('start_date', '<=', date).where((b) => b.where('end_date', '>=', date).orWhere((c) => c.whereNull('end_date').where('start_date', date))).first();
  return e ? { title: e.title, id: e.id, source: 'events' } : null;
}
/** { off, reason: 'weekend'|'holiday', title } */
async function offDay(date, k = db.get()) {
  if (!settings.weekDays().includes(J.dow(date))) return { off: true, reason: 'weekend', title: 'روز غیر از هفته‌ی مدرسه' };
  const h = await holidayOn(date, k);
  return h ? { off: true, reason: 'holiday', title: h.title } : { off: false };
}
/** مجموعه‌ی تاریخ‌های تعطیل (ISO) در بازه‌ی [from, to] از جدول تعطیلی‌ها و رویدادهای تعطیل */
async function holidaySet(from, to, k = db.get()) {
  const set = new Map();
  const rows = await k('holidays').where('start_date', '<=', to).where('end_date', '>=', from);
  const ev = await k('events').where({ type: 'holiday' }).where('start_date', '<=', to).where((b) => b.where('end_date', '>=', from).orWhere((c) => c.whereNull('end_date').where('start_date', '>=', from)));
  for (const r of [...rows.map((x) => ({ s: x.start_date, e: x.end_date, t: x.title })), ...ev.map((x) => ({ s: x.start_date, e: x.end_date || x.start_date, t: x.title }))]) {
    for (let d = r.s < from ? from : r.s, n = 0; d <= r.e && d <= to && n < 400; d = J.addDays(d, 1), n++) set.set(d, r.t);
  }
  return set;
}
/** روزهای تحصیلی بین دو تاریخ (شامل دو سر) */
async function schoolDays(from, to, k = db.get()) {
  const hol = await holidaySet(from, to, k); const wd = settings.weekDays(); const out = [];
  for (let d = from, n = 0; d <= to && n < 800; d = J.addDays(d, 1), n++) if (wd.includes(J.dow(d)) && !hol.has(d)) out.push(d);
  return out;
}
function fixedSolarFor(jy) {
  return FIXED_SOLAR.map(([m, d, t]) => ({ start_date: J.jToIso(jy, m, d), end_date: J.jToIso(jy, m, d), title: t }));
}
module.exports = { holidayOn, offDay, holidaySet, schoolDays, fixedSolarFor, FIXED_SOLAR };

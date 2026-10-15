'use strict';
/** قواعد ثبت حضور و غیاب: قفل زمانی، فقط معلم برنامه‌ی زنگ، تأخیر ورود */
const db = require('../db');
const settings = require('../settings');
const J = require('../utils/jalali');

const daysBetween = (a, b) => Math.round((Date.UTC(...b.slice(0, 10).split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.slice(0, 10).split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000);
const isMgr = (u) => u && (u.role === 'admin' || u.role === 'deputy');
const toMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

/** آیا ویرایش حضور و غیابِ این تاریخ قفل است؟ (مدیر و معاون مستثنا) */
function lockInfo(user, date, today = J.todayISO()) {
  const n = settings.num('attendance_lock_days');
  if (!n || isMgr(user)) return { locked: false };
  const age = daysBetween(date, today);
  return age > n ? { locked: true, reason: `ویرایش حضور و غیاب پس از ${n} روز قفل می‌شود؛ برای اصلاح با مدیر یا معاون تماس بگیرید.` } : { locked: false };
}

/** معلم برنامه‌ی یک زنگ (با احتساب جانشین). خروجی: { teacherId, substituted, slot } یا null اگر برنامه‌ای نیست */
async function scheduledTeacher(classId, date, period) {
  const k = db.get();
  const sub = await k('substitutions').where({ date, classroom_id: classId, period }).first();
  const slot = await require('./timetableTools').slotAt(k, classId, date, period); // با احتساب نسخه‌های قدیمی برنامه
  if (sub) return { teacherId: sub.substitute_teacher_id, substituted: true, originalId: slot ? slot.teacher_id : sub.absent_teacher_id };
  return slot ? { teacherId: slot.teacher_id, substituted: false } : null;
}

/** آیا کاربر می‌تواند حضور و غیابِ این کلاس/تاریخ/زنگ را ثبت کند؟ */
async function canRecord(user, cls, date, period, { homeroomIds } = {}) {
  const lock = lockInfo(user, date);
  if (lock.locked) return { ok: false, reason: lock.reason };
  if (user.role === 'teacher' && period > 0 && settings.bool('attendance_enforce_schedule')) {
    const t = await db.get()('teachers').where({ user_id: user.id }).first();
    const sch = await scheduledTeacher(cls.id, date, period);
    if (sch) { if (!t || sch.teacherId !== t.id) return { ok: false, reason: 'ثبت این زنگ فقط برای معلمِ برنامه‌ی همین زنگ (یا جانشین ثبت‌شده) مجاز است.' }; }
    else if (!(homeroomIds || []).includes(cls.id)) return { ok: false, reason: 'برای این زنگ در برنامه‌ی هفتگی معلمی ثبت نشده و شما معلم راهنمای کلاس نیستید.' };
  }
  return { ok: true };
}

/** وضعیت ورود در ساعت مشخص: present | late */
function arrivalStatus(hm, o = {}) {
  // مبنا: ساعت شروع زنگ اول همان روز/پایه در «ساعت زنگ‌ها» (یک منبع واحد)
  const start = toMin(require('./bell').schoolStart({ day: o.day === undefined ? J.dow(J.todayISO()) : o.day, grade: o.grade })); const grace = settings.num('late_after_minutes');
  return toMin(hm) > start + grace ? 'late' : 'present';
}
module.exports = { daysBetween, lockInfo, scheduledTeacher, canRecord, arrivalStatus, toMin };

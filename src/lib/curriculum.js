'use strict';
/**
 * برنامه‌ریز درسی کلاس: ساعت هفتگی و سقف روزانه‌ی هر درس، بر پایه‌ی برنامه‌ی هفتگی و ساعت زنگ‌ها.
 * توابع «خالص» (بدون پایگاه داده) برای تست‌پذیری جدا نگه داشته شده‌اند.
 */
const bell = require('./bell');

const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const HOURS_MAX = 20; const PERDAY_MAX = 6;

/** ظرفیت زنگ‌های یک پایه در هفته: {total, byDay:{d:n}} */
function capacity(days, grade) {
  const byDay = {}; let total = 0;
  for (const d of days) { const n = bell.periodsFor({ day: d, grade }).length; byDay[d] = n; total += n; }
  return { total, byDay };
}
/** placedRows: [{class_subject_id, day}] → {csId:{total, byDay:{d:n}, maxDay}} */
function placedMap(placedRows) {
  const out = {};
  for (const r of placedRows) { const o = (out[r.class_subject_id] = out[r.class_subject_id] || { total: 0, byDay: {}, maxDay: 0 }); o.total++; o.byDay[r.day] = (o.byDay[r.day] || 0) + 1; o.maxDay = Math.max(o.maxDay, o.byDay[r.day]); }
  return out;
}
/** وضعیت یک درس نسبت به برنامه: ok | short (کمتر از نیاز) | over (بیش از نیاز) | none (هنوز نچیده‌اند) */
function rowState(hours, placed) { const p = placed ? placed.total : 0; if (p === 0) return hours > 0 ? 'none' : 'ok'; if (p === hours) return 'ok'; return p < hours ? 'short' : 'over'; }
/** خلاصه‌ی کلاس: جمع ساعت‌ها، ظرفیت، چیده‌شده، هشدارها */
function summarize(rows, cap, placed) {
  const total = rows.reduce((a, r) => a + (Number(r.weekly_hours) || 0), 0);
  const placedTotal = rows.reduce((a, r) => a + ((placed[r.id] || { total: 0 }).total), 0);
  const warnings = [];
  if (cap.total && total > cap.total) warnings.push({ k: 'over_capacity', text: `جمع ساعت‌های درسی (${total}) از زنگ‌های هفته (${cap.total}) بیشتر است.` });
  for (const r of rows) {
    const p = placed[r.id]; const st = rowState(Number(r.weekly_hours) || 0, p);
    if (st === 'over') warnings.push({ k: 'placed_over', text: `«${r.subject_name}»: ${p.total} ساعت در برنامه چیده شده ولی ${r.weekly_hours} ساعت تعریف شده است.` });
    if (p && r.max_per_day > 0 && p.maxDay > r.max_per_day) warnings.push({ k: 'perday', text: `«${r.subject_name}»: در یک روز ${p.maxDay} ساعت چیده شده ولی سقف ${r.max_per_day} است.` });
    if (!r.teacher_id) warnings.push({ k: 'no_teacher', text: `«${r.subject_name}» معلم ندارد.` });
  }
  return { total, placedTotal, free: cap.total ? cap.total - total : null, capacity: cap.total, warnings };
}
/**
 * اعتبارسنجی و نرمال‌سازی ورودی فرم ذخیره‌ی گروهی.
 * cur: ردیف‌های فعلی class_subjects؛ rows: {csid:{teacher_id,weekly_hours,max_per_day,remove}}؛ add: [{subject_id,teacher_id,weekly_hours,max_per_day}]
 */
function planChanges(cur, rows, add, opts = {}) {
  const errors = []; const updates = []; const removes = []; const inserts = []; const seen = new Set(cur.map((c) => c.subject_id));
  for (const c of cur) {
    const r = rows && rows[c.id]; if (!r) continue;
    if (r.remove === '1' || r.remove === 'on') { removes.push(c); continue; }
    const hours = clamp(r.weekly_hours, 1, HOURS_MAX, c.weekly_hours); const mpd = clamp(r.max_per_day, 1, PERDAY_MAX, c.max_per_day || 2);
    const tid = r.teacher_id ? Number(r.teacher_id) : null;
    if (mpd > hours) { updates.push({ cur: c, teacher_id: tid, weekly_hours: hours, max_per_day: hours }); continue; }
    if (tid !== (c.teacher_id || null) || hours !== c.weekly_hours || mpd !== c.max_per_day) updates.push({ cur: c, teacher_id: tid, weekly_hours: hours, max_per_day: mpd });
  }
  for (const a of add || []) {
    if (!a || !a.subject_id) continue; const sid = Number(a.subject_id);
    if (seen.has(sid)) { errors.push('یک درس بیش از یک‌بار افزوده شده است.'); continue; }
    seen.add(sid);
    const hours = clamp(a.weekly_hours, 1, HOURS_MAX, 2);
    inserts.push({ subject_id: sid, teacher_id: a.teacher_id ? Number(a.teacher_id) : null, weekly_hours: hours, max_per_day: Math.min(clamp(a.max_per_day, 1, PERDAY_MAX, 2), hours) });
  }
  return { errors, updates, removes, inserts };
}
/** ساعت‌های هر معلم: {teacherId:{hours, byDay:{d:n}}} از class_subjects و timetable */
function teacherTotals(csRows, ttRows) {
  const out = {};
  for (const r of csRows) if (r.teacher_id) { const o = (out[r.teacher_id] = out[r.teacher_id] || { hours: 0, byDay: {} }); o.hours += Number(r.weekly_hours) || 0; }
  for (const r of ttRows) if (r.teacher_id) { const o = (out[r.teacher_id] = out[r.teacher_id] || { hours: 0, byDay: {} }); o.byDay[r.day] = (o.byDay[r.day] || 0) + 1; }
  return out;
}
/** بدنه‌ی urlencoded ساده (extended:false) کلیدهای rows[12][weekly_hours] و add[0][subject_id] را تو در تو نمی‌کند */
function parseForm(body) {
  const rows = {}; const add = {};
  for (const [key, val] of Object.entries(body || {})) {
    const m = /^(rows|add)\[(\d{1,9})\]\[(teacher_id|weekly_hours|max_per_day|remove|subject_id)\]$/.exec(key); if (!m) continue;
    const dst = m[1] === 'rows' ? rows : add; (dst[m[2]] = dst[m[2]] || {})[m[3]] = Array.isArray(val) ? val[val.length - 1] : val;
  }
  return { rows, add: Object.keys(add).sort((a, b) => a - b).map((i) => add[i]) };
}
module.exports = { parseForm, clamp, capacity, placedMap, rowState, summarize, planChanges, teacherTotals, HOURS_MAX, PERDAY_MAX };

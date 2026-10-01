'use strict';
/**
 * تولید خودکار برنامه‌ی هفتگی (کاملاً مستقل از پایگاه داده و قابل آزمون).
 * قیدهای سخت: عدم تداخل کلاس، عدم تداخل معلم، ساعت‌های غیرمجاز معلم، ثابت‌ماندن خانه‌های قفل‌شده.
 * قیدهای نرم: پخش درس در روزها (حداکثر ۲ ساعت از یک درس در روز)، تعادل بار روزانه.
 * الگوریتم: حریصانه‌ی مرتب‌شده بر اساس سخت‌ترین واحدها + چند بار شروع تصادفی (با دانه‌ی ثابت: نتیجه تکرارپذیر است).
 */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * @param {object} o
 * @param {number[]} o.days            روزهای فعال هفته (۰ = شنبه)
 * @param {number[]} o.periods         شماره زنگ‌ها
 * @param {{id:number, items:{csId:number, teacherId:number|null, hours:number}[]}[]} o.classes کلاس‌هایی که باید چیده شوند
 * @param {{classId:number, day:number, period:number, csId:number, teacherId:number|null}[]} [o.fixed] خانه‌های ثابت (کلاس‌های دیگر یا قفل‌شده)
 * @param {Object<number, string[]>} [o.unavailable] teacherId → ['day-period', ...]
 * @param {number} [o.seed]
 * @param {number} [o.attempts]
 * @param {number} [o.maxPerDay]
 */
function generate({ days, periods, classes, fixed = [], unavailable = {}, seed = 1, attempts = 80, maxPerDay = 2 }) {
  const slots = []; for (const d of days) for (const p of periods) slots.push([d, p]);
  const unav = {}; for (const [t, list] of Object.entries(unavailable)) unav[t] = new Set(list);
  // بار هر معلم و تعداد ساعت‌های در دسترس او برای مرتب‌سازی سخت‌ترین‌ها
  const load = {}; for (const c of classes) for (const it of c.items) if (it.teacherId) load[it.teacherId] = (load[it.teacherId] || 0) + it.hours;
  const freeSlots = (t) => slots.filter(([d, p]) => !(unav[t] && unav[t].has(`${d}-${p}`))).length;
  const difficulty = (it) => (it.teacherId ? (load[it.teacherId] || 0) / Math.max(1, freeSlots(it.teacherId)) : 0);

  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rnd = prng(seed * 1000003 + attempt);
    const classBusy = {}; const teacherBusy = {}; const placements = []; const unplaced = [];
    const dayCount = {}; // classId|cs|day → n
    const dayLoad = {};  // classId|day → n
    for (const c of classes) classBusy[c.id] = new Set();
    for (const f of fixed) { (classBusy[f.classId] = classBusy[f.classId] || new Set()).add(`${f.day}-${f.period}`); if (f.teacherId) (teacherBusy[f.teacherId] = teacherBusy[f.teacherId] || new Set()).add(`${f.day}-${f.period}`); }
    const units = [];
    for (const c of classes) for (const it of c.items) for (let h = 0; h < it.hours; h++) units.push({ classId: c.id, ...it, key: rnd() });
    units.sort((a, b) => (difficulty(b) - difficulty(a)) || (b.hours - a.hours) || (a.key - b.key));
    for (const u of units) {
      let bestSlot = null; let bestScore = Infinity;
      for (const [d, p] of slots) {
        const k = `${d}-${p}`;
        if (classBusy[u.classId].has(k)) continue;
        if (u.teacherId && ((teacherBusy[u.teacherId] && teacherBusy[u.teacherId].has(k)) || (unav[u.teacherId] && unav[u.teacherId].has(k)))) continue;
        const same = dayCount[`${u.classId}|${u.csId}|${d}`] || 0;
        const score = (same >= maxPerDay ? 1000 : 0) + same * 40 + (dayLoad[`${u.classId}|${d}`] || 0) * 3 + p * 0.05 + rnd() * 1.5;
        if (score < bestScore) { bestScore = score; bestSlot = [d, p]; }
      }
      if (!bestSlot) { unplaced.push({ classId: u.classId, csId: u.csId, teacherId: u.teacherId }); continue; }
      const [d, p] = bestSlot; const k = `${d}-${p}`;
      classBusy[u.classId].add(k); if (u.teacherId) (teacherBusy[u.teacherId] = teacherBusy[u.teacherId] || new Set()).add(k);
      dayCount[`${u.classId}|${u.csId}|${d}`] = (dayCount[`${u.classId}|${u.csId}|${d}`] || 0) + 1; dayLoad[`${u.classId}|${d}`] = (dayLoad[`${u.classId}|${d}`] || 0) + 1;
      placements.push({ classId: u.classId, day: d, period: p, csId: u.csId, teacherId: u.teacherId });
    }
    const spreadPenalty = Object.values(dayCount).filter((n) => n > maxPerDay).length;
    const cand = { placements, unplaced, spreadPenalty, attempt };
    if (!best || unplaced.length < best.unplaced.length || (unplaced.length === best.unplaced.length && spreadPenalty < best.spreadPenalty)) best = cand;
    if (!best.unplaced.length && !best.spreadPenalty) break;
  }
  return best || { placements: [], unplaced: [], spreadPenalty: 0, attempt: 0 };
}

/** بررسی صحت یک برنامه (برای آزمون و اعتبارسنجی): فهرست تداخل‌ها */
function validate(placements, fixed = [], unavailable = {}) {
  const errors = []; const seenClass = {}; const seenTeacher = {};
  for (const x of [...fixed, ...placements]) {
    const k = `${x.day}-${x.period}`; const ck = `${x.classId}|${k}`;
    if (seenClass[ck]) errors.push(`class ${x.classId} double at ${k}`); seenClass[ck] = 1;
    if (x.teacherId) { const tk = `${x.teacherId}|${k}`; if (seenTeacher[tk]) errors.push(`teacher ${x.teacherId} double at ${k}`); seenTeacher[tk] = 1; if ((unavailable[x.teacherId] || []).includes(k)) errors.push(`teacher ${x.teacherId} unavailable at ${k}`); }
  }
  return errors;
}
module.exports = { generate, validate, prng };

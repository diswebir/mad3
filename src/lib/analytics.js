'use strict';
/** گزارش‌های مدیریتی: دانش‌آموزان در معرض خطر، روندها، مقایسه‌ی کلاس‌ها */
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const { classResults } = require('./gradesCalc');
const fin = require('./finance');

const round2 = (n) => Math.round(n * 100) / 100;

/** بازه‌ی سال تحصیلی جاری برای شمارش غیبت (اگر تعریف نشده باشد: بدون محدودیت) */
async function yearRange(k) { const y = await k('academic_years').where({ is_current: 1 }).first(); return y && y.start_date && y.end_date ? [y.start_date, y.end_date] : null; }

/**
 * فهرست دانش‌آموزان در معرض خطر. امتیاز ریسک:
 *  - معدل زیر حد قبولی: ۳ ؛ تا ۲ نمره بالاتر از حد قبولی: ۱
 *  - غیبت غیرموجه ≥ آستانه‌ی هشدار: ۲ ؛ ≥ ۱.۵ برابر آستانه: ۳
 *  - تأخیر ≥ ۵ بار: ۱
 *  - نمره‌ی منفی انضباطی مجموع ≤ −۵: ۱
 *  - بدهی سررسیدگذشته: ۱
 *  سطح: ≥۴ زیاد، ۲–۳ متوسط
 */
async function riskList(k, { classId = null } = {}) {
  const pass = settings.num('pass_mark') || 10; const thr = settings.num('absence_alert_threshold') || 5; const range = await yearRange(k);
  const classes = await k('classrooms').where('status', '<>', 'archived').modify((q) => { if (classId) q.where('id', classId); }).select('id', 'name');
  const students = await k('students').whereIn('classroom_id', classes.map((c) => c.id).concat([0])).where('status', 'active').select('id', 'first_name', 'last_name', 'student_code', 'classroom_id', 'father_phone', 'mother_phone');
  const ids = students.map((s) => s.id).concat([0]); const cname = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  const overall = {};
  if (modules.isEnabled('grades')) for (const c of classes) { const r = await classResults(k, c.id, {}); for (const s of r.students) overall[s.id] = s.overall; }
  const att = {}; if (modules.isEnabled('attendance')) {
    const q = k('attendance').whereIn('student_id', ids).whereIn('status', ['absent', 'late']); if (range) q.whereBetween('date', range);
    for (const r of await q.groupBy('student_id', 'status').select('student_id', 'status').count({ n: '*' })) (att[r.student_id] = att[r.student_id] || {})[r.status] = Number(r.n);
  }
  const disc = {}; if (modules.isEnabled('discipline')) for (const r of await k('discipline_records').whereIn('student_id', ids).groupBy('student_id').select('student_id').sum({ p: 'points' })) disc[r.student_id] = Number(r.p) || 0;
  const od = {}; if (modules.isEnabled('finance')) {
    const fees = await k('fees as f').leftJoin(fin.paidSub(k), 'p.fee_id', 'f.id').whereIn('f.student_id', ids).select('f.*', k.raw('coalesce(p.paid, 0) as paid'));
    const insts = {}; if (fees.length) for (const r of await k('fee_installments').whereIn('fee_id', fees.map((f) => f.id)).orderBy('seq')) (insts[r.fee_id] = insts[r.fee_id] || []).push(r);
    for (const f of fees) { const a = fin.overdueAmount(f, insts[f.id]); if (a > 0) od[f.student_id] = (od[f.student_id] || 0) + a; }
  }
  const out = [];
  for (const s of students) {
    const reasons = []; let score = 0; const o = overall[s.id];
    if (o !== null && o !== undefined) { if (o < pass) { score += 3; reasons.push(`معدل ${round2(o)} (زیر حد قبولی)`); } else if (o < pass + 2) { score += 1; reasons.push(`معدل ${round2(o)} (نزدیک حد قبولی)`); } }
    const a = att[s.id] || {};
    if ((a.absent || 0) >= thr * 1.5) { score += 3; reasons.push(`${a.absent} روز غیبت غیرموجه`); } else if ((a.absent || 0) >= thr) { score += 2; reasons.push(`${a.absent} روز غیبت غیرموجه`); }
    if ((a.late || 0) >= 5) { score += 1; reasons.push(`${a.late} بار تأخیر`); }
    if ((disc[s.id] || 0) <= -5) { score += 1; reasons.push('امتیاز انضباطی منفی'); }
    if (od[s.id]) { score += 1; reasons.push('بدهی سررسیدگذشته'); }
    if (score >= 2) out.push({ ...s, class_name: cname[s.classroom_id], overall: o === undefined ? null : o, absent: a.absent || 0, late: a.late || 0, overdue: od[s.id] || 0, score, level: score >= 4 ? 'high' : 'medium', reasons });
  }
  return out.sort((x, y) => y.score - x.score || x.last_name.localeCompare(y.last_name, 'fa'));
}

/** مقایسه‌ی کلاس‌ها */
async function classComparison(k) {
  const pass = settings.num('pass_mark') || 10; const range = await yearRange(k);
  const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('grade_level').orderBy('name').select('id', 'name', 'grade_level');
  const rows = [];
  for (const c of classes) {
    const students = Number((await k('students').where({ classroom_id: c.id, status: 'active' }).count({ c: '*' }).first()).c);
    const row = { id: c.id, name: c.name, grade: c.grade_level, students, avg: null, passRate: null, attendance: null, due: null };
    if (modules.isEnabled('grades')) { const r = await classResults(k, c.id, {}); const v = r.students.filter((s) => s.overall !== null); if (v.length) { row.avg = round2(v.reduce((a, b) => a + b.overall, 0) / v.length); row.passRate = Math.round((v.filter((s) => s.overall >= pass).length * 100) / v.length); } }
    if (modules.isEnabled('attendance')) { const q = k('attendance').where({ classroom_id: c.id }); if (range) q.whereBetween('date', range); const r = await q.select(k.raw("sum(case when status in ('present','late','excused') then 1 else 0 end) as ok"), k.raw('count(*) as n')).first(); if (Number(r.n)) row.attendance = Math.round((Number(r.ok) * 100) / Number(r.n)); }
    if (modules.isEnabled('finance')) { const f = await k('fees as f').join('students as s', 's.id', 'f.student_id').leftJoin(fin.paidSub(k), 'p.fee_id', 'f.id').where('s.classroom_id', c.id).select(k.raw('coalesce(sum(f.amount - coalesce(f.discount,0)),0) as billed'), k.raw('coalesce(sum(coalesce(p.paid,0)),0) as paid')).first(); const billed = Number(f.billed); row.due = billed ? Math.round(((billed - Number(f.paid)) * 100) / billed) : null; }
    rows.push(row);
  }
  return rows;
}

/** روندها: حضور ماهانه (۱۲ ماه اخیر)، میانگین نوبت‌ها به‌تفکیک کلاس، درآمد ماهانه */
async function trends(k, months = 8) {
  const t = J.isoToJ(J.todayISO()); const list = [];
  for (let i = months - 1; i >= 0; i--) { let m = t.jm - i; let y = t.jy; while (m < 1) { m += 12; y--; } list.push({ y, m }); }
  const out = { attendance: [], income: [], terms: [] };
  for (const { y, m } of list) {
    const { start, end } = J.monthRange(y, m); const label = J.MONTHS[m - 1];
    if (modules.isEnabled('attendance')) { const r = await k('attendance').whereBetween('date', [start, end]).select(k.raw("sum(case when status in ('present','late','excused') then 1 else 0 end) as ok"), k.raw('count(*) as n')).first(); out.attendance.push({ label, value: Number(r.n) ? round2((Number(r.ok) * 100) / Number(r.n)) : null }); }
    if (modules.isEnabled('finance')) { const r = await k('payments').where('voided', 0).whereBetween('paid_at', [start, end]).sum({ a: 'amount' }).first(); out.income.push({ label, value: Number(r.a || 0) }); }
  }
  if (modules.isEnabled('grades')) {
    const nTerms = settings.num('terms_count') || 2; const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    for (const c of classes) { const pts = []; for (let term = 1; term <= nTerms; term++) { const r = await classResults(k, c.id, { term }); const v = r.students.filter((s) => s.overall !== null); pts.push({ label: 'نوبت ' + term, value: v.length ? round2(v.reduce((a, b) => a + b.overall, 0) / v.length) : null }); } out.terms.push({ name: c.name, points: pts }); }
  }
  return out;
}
module.exports = { riskList, classComparison, trends };

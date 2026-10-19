'use strict';
const settings = require('../settings');
const round2 = (n) => Math.round(n * 100) / 100;
/** «۱,۲» → [1,2]؛ خالی/نامعتبر → null (ادغام ساده‌ی همه‌ی ارزشیابی‌ها) */
function parseWeights(raw) {
  const a = String(raw || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean).map(Number);
  return a.length && a.every((n) => Number.isFinite(n) && n >= 0) && a.some((n) => n > 0) ? a : null;
}
/** میانگین درس از ارزشیابی‌ها: o = { num, den, terms: {1:{num,den}} }؛ با ضرایب نوبت، میانگین هر نوبت جدا محاسبه و وزنی ترکیب می‌شود */
function subjectAverage(o, weights, scale, annual) {
  if (annual && weights) {
    let wn = 0; let wd = 0;
    for (const [t, v] of Object.entries(o.terms)) { const w = weights[Number(t) - 1]; if (v.den > 0 && w > 0) { wn += (v.num / v.den) * w; wd += w; } }
    if (wd > 0) return round2((wn / wd) * scale);
  }
  return o.den > 0 ? round2((o.num / o.den) * scale) : null;
}

/**
 * محاسبه میانگین دروس، معدل و رتبه دانش‌آموزان یک کلاس.
 * میانگین درس = Σ(نمره/بیشینه × وزن) / Σ وزن × مقیاس کارنامه (فقط ارزشیابی‌هایی که نمره دارند)
 * معدل کل = میانگین وزنی دروس بر اساس ضریب درس
 */
async function classResults(k, classroomId, { term = null, publishedOnly = false, onlyTeacherId = null } = {}) {
  const scale = settings.num('grade_scale') || 20; const pass = settings.num('pass_mark') || 10;
  const csQ = k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').where('cs.classroom_id', classroomId).orderBy('s.name').select('cs.id', 's.name', 's.coefficient', 'u.full_name as teacher_name', 'cs.teacher_id');
  // معلم غیر راهنما فقط دروس خودش را می‌بیند (بدون معدل کل و رتبه)
  if (onlyTeacherId) csQ.where('cs.teacher_id', onlyTeacherId);
  const cs = await csQ;
  const students = await k('students').where({ classroom_id: classroomId }).where('status', 'active').orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code');
  const csIds = cs.map((x) => x.id);
  const partial = !!onlyTeacherId;
  const res = { scale, pass, subjects: cs, students: students.map((s) => ({ ...s, subjects: {}, overall: null, rank: null })), term, partial, rankedCount: 0 };
  if (!csIds.length || !students.length) return res;
  const aq = k('assessments').whereIn('class_subject_id', csIds);
  if (term) aq.where({ term });
  if (publishedOnly) aq.where({ published: 1 });
  const assessments = await aq.select('id', 'class_subject_id', 'max_score', 'weight', 'term');
  const weights = parseWeights(settings.get('term_weights'));
  const aMap = Object.fromEntries(assessments.map((a) => [a.id, a]));
  const scores = assessments.length ? await k('scores').whereIn('assessment_id', assessments.map((a) => a.id)).whereNotNull('score').select('assessment_id', 'student_id', 'score') : [];
  const acc = {}; // studentId -> csId -> {num, den, count}
  for (const sc of scores) {
    const a = aMap[sc.assessment_id]; if (!a || Number(a.max_score) <= 0) continue;
    const o = ((acc[sc.student_id] = acc[sc.student_id] || {})[a.class_subject_id] = acc[sc.student_id][a.class_subject_id] || { num: 0, den: 0, count: 0, terms: {} });
    const part = (Number(sc.score) / Number(a.max_score)) * Number(a.weight); const tt = (o.terms[a.term || 1] = o.terms[a.term || 1] || { num: 0, den: 0 });
    o.num += part; o.den += Number(a.weight); o.count++; tt.num += part; tt.den += Number(a.weight);
  }
  const idx = {};
  for (const s of res.students) {
    idx[s.id] = s; let wsum = 0; let csum = 0;
    for (const c of cs) {
      const o = acc[s.id] && acc[s.id][c.id];
      if (o && o.den > 0) { const avg = subjectAverage(o, weights, scale, !term); s.subjects[c.id] = { avg, count: o.count, passed: avg >= pass }; wsum += avg * (c.coefficient || 1); csum += c.coefficient || 1; }
    }
    s.overall = csum && !partial ? round2(wsum / csum) : null;
  }
  const ranked = res.students.filter((s) => s.overall !== null).sort((a, b) => b.overall - a.overall);
  let rank = 0; let prev = null; let i = 0;
  for (const s of ranked) { i++; if (s.overall !== prev) { rank = i; prev = s.overall; } s.rank = rank; }
  res.rankedCount = ranked.length;
  return res;
}
module.exports = { classResults, parseWeights, subjectAverage };

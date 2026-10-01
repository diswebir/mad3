'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { L } = require('../labels');
const { requireRole, isManager } = require('../middleware');
const { classResults } = require('../lib/gradesCalc');
const reportcard = require('../lib/reportcard');
const sms = require('../lib/sms');
const router = express.Router();
router.use('/grades', modules.guard('grades'));
const staff = requireRole('admin', 'deputy', 'teacher');
const nf = (res, m) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: m || 'مورد درخواستی یافت نشد یا دسترسی ندارید.' });
const round2 = (n) => Math.round(n * 100) / 100;

async function loadCS(req, id) {
  const k = db.get();
  const cs = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').where('cs.id', id).first('cs.*', 's.name as subject_name', 'c.name as class_name', 'u.full_name as teacher_name');
  if (!cs) return null;
  if (isManager(req.user)) return cs;
  if (req.user.role === 'teacher' && req.user.teacher && cs.teacher_id === req.user.teacher.id) return cs;
  return null;
}
async function loadAssessment(req, id) {
  const a = await db.get()('assessments').where({ id }).first(); if (!a) return null;
  const cs = await loadCS(req, a.class_subject_id); return cs ? { a, cs } : null;
}

router.get('/grades', staff, async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user;
    const q = k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').where('c.status', '<>', 'archived').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as x', 'x.id', 't.user_id')
      .orderBy('c.name').orderBy('s.name').select('cs.id', 's.name as subject_name', 'c.id as classroom_id', 'c.name as class_name', 'x.full_name as teacher_name', k.raw('(select count(*) from assessments a where a.class_subject_id = cs.id) as a_count'));
    if (u.role === 'teacher') q.where('cs.teacher_id', u.teacher ? u.teacher.id : 0);
    if (req.query.class_id) q.where('cs.classroom_id', req.query.class_id);
    const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    res.view('grades/index', { title: 'نمرات', rows: await q, classes, classId: req.query.class_id || '' });
  } catch (e) { next(e); }
});
router.get('/grades/cs/:id(\\d+)', staff, async (req, res, next) => {
  try {
    const k = db.get(); const cs = await loadCS(req, req.params.id); if (!cs) return nf(res);
    const as = await k('assessments as a').where('a.class_subject_id', cs.id).orderBy('a.date', 'desc').orderBy('a.id', 'desc').select('a.*', k.raw('(select count(*) from scores s where s.assessment_id = a.id and s.score is not null) as scored'), k.raw('(select avg(s.score) from scores s where s.assessment_id = a.id and s.score is not null) as avg_score'));
    const students = Number((await k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).count({ c: '*' }).first()).c);
    res.view('grades/subject', { title: `${cs.subject_name} — ${cs.class_name}`, cs, as, students, terms: settings.num('terms_count') || 2, vals: { type: 'quiz', max_score: settings.num('grade_scale') || 20, weight: 1, term: 1, date: J.isoToJString(J.todayISO()) }, errors: [] });
  } catch (e) { next(e); }
});
function parseAssessment(b, errors) {
  const max = Number(String(b.max_score).replace(',', '.')); const weight = Number(String(b.weight).replace(',', '.')); const term = parseInt(b.term, 10) || 1;
  if (!b.title) errors.push('عنوان ارزشیابی الزامی است.');
  if (!L.assessmentType[b.type]) errors.push('نوع ارزشیابی نامعتبر است.');
  if (isNaN(max) || max <= 0 || max > 1000) errors.push('بیشینه نمره نامعتبر است.');
  if (isNaN(weight) || weight <= 0 || weight > 100) errors.push('وزن (ضریب) باید بین ۰ و ۱۰۰ باشد.');
  const date = b.date ? J.parseJalali(b.date) : null; if (b.date && !date) errors.push('تاریخ نامعتبر است.');
  return { title: b.title, type: b.type, max_score: max, weight, term: Math.min(Math.max(term, 1), 4), date, published: b.published === '1' ? 1 : 0 };
}
router.post('/grades/cs/:id(\\d+)/assessments', staff, async (req, res, next) => {
  try {
    const k = db.get(); const cs = await loadCS(req, req.params.id); if (!cs) return nf(res);
    const errors = []; const data = parseAssessment(req.body, errors);
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/grades/cs/' + cs.id); }
    const r = await k('assessments').insert({ ...data, class_subject_id: cs.id, created_by: req.user.id }); const id = Array.isArray(r) ? r[0] : r;
    await svc.audit(req, 'create', 'assessments', id, `${data.title} — ${cs.subject_name} ${cs.class_name}`);
    req.flash('success', 'ارزشیابی ایجاد شد؛ اکنون نمرات را وارد کنید.'); res.redirect('/grades/assessments/' + id);
  } catch (e) { next(e); }
});
router.get('/grades/assessments/:id(\\d+)', staff, async (req, res, next) => {
  try {
    const k = db.get(); const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const { a, cs } = r;
    const students = await k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code');
    const scores = Object.fromEntries((await k('scores').where({ assessment_id: a.id })).map((s) => [s.student_id, s]));
    const vals = Object.values(scores).filter((s) => s.score !== null).map((s) => Number(s.score));
    const pass = settings.num('pass_mark') / (settings.num('grade_scale') || 20) * Number(a.max_score);
    const stats = vals.length ? { n: vals.length, avg: round2(vals.reduce((x, y) => x + y, 0) / vals.length), min: Math.min(...vals), max: Math.max(...vals), passed: vals.filter((v) => v >= pass).length, bins: [0, 0, 0, 0] } : null;
    if (stats) vals.forEach((v) => { stats.bins[Math.min(3, Math.floor(v / Number(a.max_score) * 4))]++; });
    res.view('grades/assessment', { title: a.title, a, cs, students, scores, stats, assessmentVals: { ...a, date: J.isoToJString(a.date) }, terms: settings.num('terms_count') || 2 });
  } catch (e) { next(e); }
});
router.post('/grades/assessments/:id(\\d+)/scores', staff, async (req, res, next) => {
  try {
    const k = db.get(); const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const { a, cs } = r;
    const students = await k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).select('id', 'first_name', 'last_name');
    const existing = Object.fromEntries((await k('scores').where({ assessment_id: a.id })).map((s) => [s.student_id, s]));
    const sc = req.body.score || {}; const notes = req.body.note || {}; const errors = []; const ops = [];
    for (const s of students) {
      const raw = String(sc[s.id] === undefined ? '' : sc[s.id]).replace(',', '.').replace('٫', '.').trim(); const note = (notes[s.id] || '').slice(0, 250) || null;
      let val = null;
      if (raw !== '') { val = Number(raw); if (isNaN(val) || val < 0 || val > Number(a.max_score)) { errors.push(`نمره «${s.last_name} ${s.first_name}» باید بین ۰ و ${a.max_score} باشد.`); continue; } val = Math.round(val * 100) / 100; }
      ops.push([s.id, val, note]);
    }
    if (errors.length) { req.flash('error', errors.slice(0, 3).join(' ')); return res.redirect('/grades/assessments/' + a.id); }
    await k.transaction(async (t) => {
      for (const [sid, val, note] of ops) {
        const ex = existing[sid];
        if (ex) await t('scores').where({ id: ex.id }).update({ score: val, note }); else if (val !== null || note) await t('scores').insert({ assessment_id: a.id, student_id: sid, score: val, note });
      }
    });
    await svc.audit(req, 'scores', 'assessments', a.id, `${a.title} — ${cs.class_name}`);
    req.flash('success', 'نمرات ذخیره شد.'); res.redirect('/grades/assessments/' + a.id);
  } catch (e) { next(e); }
});
router.post('/grades/assessments/:id(\\d+)/update', staff, async (req, res, next) => {
  try {
    const r = await loadAssessment(req, req.params.id); if (!r) return nf(res);
    const errors = []; const data = parseAssessment(req.body, errors);
    if (!errors.length) { const mx = await db.get()('scores').where({ assessment_id: r.a.id }).max({ m: 'score' }).first(); if (mx && mx.m !== null && Number(mx.m) > data.max_score) errors.push(`بیشینه نمره نمی‌تواند کمتر از بالاترین نمره ثبت‌شده (${mx.m}) باشد.`); }
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/grades/assessments/' + r.a.id); }
    await db.get()('assessments').where({ id: r.a.id }).update(data); req.flash('success', 'مشخصات ارزشیابی ذخیره شد.'); res.redirect('/grades/assessments/' + r.a.id);
  } catch (e) { next(e); }
});
router.post('/grades/assessments/:id(\\d+)/publish', staff, async (req, res, next) => {
  try {
    const k = db.get(); const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const pub = r.a.published ? 0 : 1;
    await k('assessments').where({ id: r.a.id }).update({ published: pub });
    const already = pub ? await k('notifications').where({ title: `نمره ${r.cs.subject_name} منتشر شد`, body: r.a.title, link: '/grades/my' }).first() : null; // انتشار مجدد، اعلان تکراری نمی‌سازد
    if (pub && !already) { const us = await k('students').where({ classroom_id: r.cs.classroom_id, status: 'active' }).select('user_id'); await svc.notify(us.map((x) => x.user_id), `نمره ${r.cs.subject_name} منتشر شد`, r.a.title, '/grades/my', 'success');
      if (sms.eventOn('grades')) { // پیامک نمره به اولیا (فقط دانش‌آموزانی که نمره دارند)
        const sc = await k('scores as sc').join('students as s', 's.id', 'sc.student_id').where('sc.assessment_id', r.a.id).whereNotNull('sc.score').select('s.id', 's.first_name', 's.last_name', 's.father_phone', 's.mother_phone', 's.guardian_phone', 'sc.score');
        const byId = Object.fromEntries(sc.map((x) => [x.id, x]));
        await sms.notifyParents(sc, (x) => sms.render('اولیای گرامی، نمره‌ی «{title}» درس {subject} برای {student}: {score} از {max} ثبت شد. {school}', { title: r.a.title, subject: r.cs.subject_name, student: `${x.first_name} ${x.last_name}`, score: Number(byId[x.id].score), max: Number(r.a.max_score) }), 'grades', req.user.id);
      } }
    await svc.audit(req, pub ? 'publish' : 'unpublish', 'assessments', r.a.id, r.a.title);
    req.flash('success', pub ? 'نمرات برای دانش‌آموزان منتشر شد.' : 'انتشار نمرات لغو شد.'); res.redirect('/grades/assessments/' + r.a.id);
  } catch (e) { next(e); }
});
router.post('/grades/assessments/:id(\\d+)/delete', staff, async (req, res, next) => {
  try {
    const k = db.get(); const r = await loadAssessment(req, req.params.id); if (!r) return nf(res);
    await k('scores').where({ assessment_id: r.a.id }).del(); await k('assessments').where({ id: r.a.id }).del();
    await svc.audit(req, 'delete', 'assessments', r.a.id, r.a.title); req.flash('success', 'ارزشیابی و نمرات آن حذف شد.'); res.redirect('/grades/cs/' + r.cs.id);
  } catch (e) { next(e); }
});

/* کارنامه کلاس */
router.get('/grades/class/:id(\\d+)', staff, async (req, res, next) => {
  try {
    const k = db.get(); const c = await k('classrooms').where({ id: req.params.id }).first(); if (!c) return nf(res);
    if (!isManager(req.user)) { const ids = await svc.accessibleClassIds(req.user); if (!ids.includes(c.id)) return nf(res); }
    const term = parseInt(req.query.term, 10) || null; const r = await classResults(k, c.id, { term, ...(await svc.gradeScope(req.user, c.id)) });
    if (req.query.format === 'csv') {
      const head = ['رتبه', 'شماره', 'نام', ...r.subjects.map((s) => s.name), 'معدل'];
      const rows = [...r.students].sort((a, b) => (a.rank || 999) - (b.rank || 999)).map((s) => [s.rank || '', s.student_code, `${s.first_name} ${s.last_name}`, ...r.subjects.map((x) => (s.subjects[x.id] ? s.subjects[x.id].avg : '')), s.overall === null ? '' : s.overall]);
      return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="class-${c.id}-grades.csv"`).send(toCSV(head, rows));
    }
    res.view('grades/class', { title: 'کارنامه کلاس ' + c.name, c, r, term, terms: settings.num('terms_count') || 2 });
  } catch (e) { next(e); }
});

/* کارنامه دانش‌آموز */
router.get('/grades/my', requireRole('student'), (req, res) => (req.user.student ? res.redirect('/grades/report-card/' + req.user.student.id) : res.redirect('/')));
/** داده‌های یک کارنامه. r (نتایج کلاس) برای چاپ گروهی یک‌بار محاسبه و پاس داده می‌شود */
async function cardData(k, u, s, term, r, att) {
  const publishedOnly = u.role === 'student';
  if (r === undefined) r = s.classroom_id ? await classResults(k, s.classroom_id, { term, publishedOnly, ...(await svc.gradeScope(u, s.classroom_id)) }) : null;
  const me = r ? r.students.find((x) => x.id === s.id) : null;
  const cfg = reportcard.config();
  const data = { s, r, me, term, terms: settings.num('terms_count') || 2, year: await k('academic_years').where({ is_current: 1 }).first(), cfg, describe: reportcard.describe, showRank: u.role !== 'student' || settings.bool('show_rank_to_students') };
  const cm = await k('report_comments').where({ student_id: s.id, term: term || 0 }).first(); data.comment = cm ? cm.comment : '';
  if (modules.isEnabled('attendance')) { const rows = await k('attendance').where({ student_id: s.id }).groupBy('status').select('status').count({ c: '*' }); data.att = Object.fromEntries(rows.map((x) => [x.status, Number(x.c)])); }
  if (modules.isEnabled('discipline')) { const d = await k('discipline_records').where({ student_id: s.id }).sum({ p: 'points' }).first(); data.behavior = Math.max(0, Math.min(20, 20 + (Number(d.p) || 0))); }
  data.classAvg = null; data.subjectAvg = {};
  if (r && me) { const v = r.students.filter((x) => x.overall !== null); data.classAvg = v.length ? round2(v.reduce((a, b) => a + b.overall, 0) / v.length) : null; for (const c of r.subjects) { const xs = r.students.map((st) => st.subjects[c.id]).filter(Boolean); data.subjectAvg[c.id] = xs.length ? round2(xs.reduce((a, b) => a + b.avg, 0) / xs.length) : null; } }
  return data;
}
const studentRow = (k, id) => k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as x', 'x.id', 't.user_id').where('s.id', id).first('s.*', 'c.name as class_name', 'x.full_name as homeroom_name');
router.get('/grades/report-card/:sid(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const s = await studentRow(k, req.params.sid);
    if (!s) return nf(res);
    if (u.role === 'student' && !(u.student && u.student.id === s.id)) return nf(res); // دانش‌آموز یا اولیای او (فرزند انتخاب‌شده)
    if (u.role === 'teacher') { const ids = await svc.accessibleClassIds(u); if (!ids.includes(s.classroom_id)) return nf(res); }
    const term = parseInt(req.query.term, 10) || null;
    res.view('grades/report-card', { title: 'کارنامه ' + s.first_name + ' ' + s.last_name, ...(await cardData(k, u, s, term)) });
  } catch (e) { next(e); }
});

/** چاپ گروهی کارنامه‌ی یک کلاس (مدیر/معاون یا معلم راهنما) */
async function classForCards(req, id) {
  const k = db.get(); const c = await k('classrooms').where({ id }).first(); if (!c) return null;
  if (isManager(req.user)) return c;
  return req.user.role === 'teacher' && (await svc.homeroomClassIds(req.user)).includes(c.id) ? c : null;
}
router.get('/grades/class/:id(\\d+)/cards', staff, async (req, res, next) => {
  try {
    const k = db.get(); const c = await classForCards(req, req.params.id); if (!c) return nf(res);
    const term = parseInt(req.query.term, 10) || null; const r = await classResults(k, c.id, { term });
    const studs = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as x', 'x.id', 't.user_id').where({ 's.classroom_id': c.id, 's.status': 'active' }).orderBy('s.last_name').orderBy('s.first_name').select('s.*', 'c.name as class_name', 'x.full_name as homeroom_name');
    const cards = []; for (const s of studs) cards.push(await cardData(k, req.user, s, term, r));
    res.view('grades/cards', { title: 'کارنامه‌های کلاس ' + c.name, c, term, terms: settings.num('terms_count') || 2, cards });
  } catch (e) { next(e); }
});

/** توصیف معلم راهنما برای کارنامه */
router.get('/grades/class/:id(\\d+)/comments', staff, async (req, res, next) => {
  try {
    const k = db.get(); const c = await classForCards(req, req.params.id); if (!c) return nf(res);
    const term = parseInt(req.query.term, 10) || 0;
    const students = await k('students').where({ classroom_id: c.id, status: 'active' }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code');
    const cm = Object.fromEntries((await k('report_comments').where({ term }).whereIn('student_id', students.map((s) => s.id).concat([0]))).map((x) => [x.student_id, x.comment]));
    res.view('grades/comments', { title: 'توصیف کارنامه — ' + c.name, c, term, terms: settings.num('terms_count') || 2, students, cm });
  } catch (e) { next(e); }
});
router.post('/grades/class/:id(\\d+)/comments', staff, async (req, res, next) => {
  try {
    const k = db.get(); const c = await classForCards(req, req.params.id); if (!c) return nf(res);
    const term = Math.max(0, Math.min(settings.num('terms_count') || 2, parseInt(req.body.term, 10) || 0));
    const ids = new Set((await k('students').where({ classroom_id: c.id }).select('id')).map((s) => s.id)); const cm = req.body.comment || {}; let n = 0;
    await k.transaction(async (t) => {
      for (const [sid, text] of Object.entries(cm)) {
        const id = Number(sid); if (!ids.has(id)) continue; const val = String(text || '').trim().slice(0, 600);
        const ex = await t('report_comments').where({ student_id: id, term }).first();
        if (!val) { if (ex) { await t('report_comments').where({ id: ex.id }).del(); n++; } continue; }
        if (ex) { if (ex.comment !== val) { await t('report_comments').where({ id: ex.id }).update({ comment: val, author_id: req.user.id }); n++; } } else { await t('report_comments').insert({ student_id: id, term, comment: val, author_id: req.user.id }); n++; }
      }
    });
    await svc.audit(req, 'update', 'report_comments', c.id, `${c.name}: ${n} توصیف`);
    req.flash('success', 'توصیف‌ها ذخیره شد.'); res.redirect(`/grades/class/${c.id}/comments?term=${term}`);
  } catch (e) { next(e); }
});
module.exports = router;
module.exports.loadAssessment = loadAssessment;

'use strict';
/** بانک سؤال و ساخت برگه‌ی امتحانی قابل چاپ (با کلید پاسخ) */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { L } = require('../labels');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
const staff = requireRole('admin', 'deputy', 'teacher');
router.use(['/questions', '/papers'], modules.guard('questionbank'));
const TYPES = { mcq: 'چندگزینه‌ای', tf: 'صحیح/غلط', short: 'کوتاه‌پاسخ', descriptive: 'تشریحی' };
const DIFF = { 1: 'آسان', 2: 'متوسط', 3: 'دشوار' };
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد یافت نشد یا دسترسی ندارید.' });

/** درس‌هایی که کاربر اجازه‌ی کار با آن‌ها را دارد (معلم: دروس خودش) */
async function subjectsFor(req) {
  const k = db.get();
  if (isManager(req.user)) return k('subjects').orderBy('name').select('id', 'name');
  return k('subjects as s').join('class_subjects as cs', 'cs.subject_id', 's.id').where('cs.teacher_id', req.user.teacher ? req.user.teacher.id : 0).distinct('s.id', 's.name').orderBy('s.name');
}
const optionsOf = (q) => { try { return JSON.parse(q.options || '[]'); } catch (_) { return []; } };

router.get('/questions', staff, async (req, res, next) => {
  try {
    const k = db.get(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 20; const subjects = await subjectsFor(req);
    const allowed = subjects.map((s) => s.id);
    const qb = k('questions as q').join('subjects as s', 's.id', 'q.subject_id').whereIn('q.subject_id', allowed.length ? allowed : [0]);
    if (req.query.subject_id) qb.where('q.subject_id', Number(req.query.subject_id) || 0);
    if (TYPES[req.query.type]) qb.where('q.type', req.query.type);
    if (DIFF[req.query.difficulty]) qb.where('q.difficulty', Number(req.query.difficulty));
    if (req.query.q) qb.where('q.text', 'like', `%${req.query.q}%`);
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderBy('q.id', 'desc').limit(per).offset((page - 1) * per).select('q.*', 's.name as subject_name');
    res.view('questions/index', { title: 'بانک سؤال', rows, total, page, pages: Math.max(1, Math.ceil(total / per)), subjects, TYPES, DIFF, f: req.query, optionsOf });
  } catch (e) { next(e); }
});
const blank = { type: 'mcq', difficulty: 2, score: 1 };
router.get('/questions/new', staff, async (req, res, next) => { try { res.view('questions/form', { title: 'سؤال جدید', row: null, vals: { ...blank, subject_id: req.query.subject_id || '' }, opts: ['', '', '', ''], errors: [], subjects: await subjectsFor(req), TYPES, DIFF, grades: L.gradeLevels }); } catch (e) { next(e); } });
async function loadQ(req, id) { const q = await db.get()('questions').where({ id }).first(); if (!q) return null; if (isManager(req.user)) return q; const ok = (await subjectsFor(req)).some((s) => s.id === q.subject_id); return ok && (q.created_by === req.user.id || true) ? q : null; }
function parseQ(b, allowedIds) {
  const errors = []; const type = TYPES[b.type] ? b.type : 'descriptive'; const out = { type };
  out.subject_id = Number(b.subject_id); if (!allowedIds.includes(out.subject_id)) errors.push('درس نامعتبر است.');
  out.text = String(b.text || '').trim(); if (out.text.length < 5) errors.push('متن سؤال را وارد کنید (حداقل ۵ نویسه).'); if (out.text.length > 3000) errors.push('متن سؤال بسیار طولانی است.');
  out.grade_level = L.gradeLevels.includes(b.grade_level) ? b.grade_level : null;
  out.difficulty = [1, 2, 3].includes(Number(b.difficulty)) ? Number(b.difficulty) : 2;
  out.score = Number(String(b.score || '1').replace(',', '.')); if (!(out.score > 0 && out.score <= 100)) { errors.push('بارم باید بین ۰ و ۱۰۰ باشد.'); out.score = 1; }
  let opts = [];
  if (type === 'mcq') {
    opts = [].concat(b.opt || []).map((x) => String(x || '').trim());
    const filled = opts.filter(Boolean); if (filled.length < 2) errors.push('حداقل دو گزینه لازم است.');
    const ans = Number(b.answer_index); if (!(ans >= 0 && ans < opts.length && opts[ans])) errors.push('گزینه‌ی صحیح را مشخص کنید.');
    out.options = JSON.stringify(opts.filter(Boolean).length === opts.length ? opts : opts.filter(Boolean)); out.answer = String(opts[ans] ? opts.filter(Boolean).indexOf(opts[ans]) : '');
  } else if (type === 'tf') { out.options = null; out.answer = b.answer_tf === 'false' ? 'false' : 'true'; }
  else { out.options = null; out.answer = String(b.answer_text || '').trim().slice(0, 2000) || null; }
  return { errors, data: out, opts };
}
router.post('/questions/new', staff, async (req, res, next) => {
  try {
    const subjects = await subjectsFor(req); const { errors, data, opts } = parseQ(req.body, subjects.map((s) => s.id));
    if (errors.length) return res.view('questions/form', { title: 'سؤال جدید', row: null, vals: req.body, opts: opts.length ? opts : ['', '', '', ''], errors, subjects, TYPES, DIFF, grades: L.gradeLevels });
    const r = await db.get()('questions').insert({ ...data, created_by: req.user.id }); await svc.audit(req, 'create', 'questions', Array.isArray(r) ? r[0] : r, data.text.slice(0, 40));
    req.flash('success', 'سؤال ثبت شد.'); res.redirect('/questions');
  } catch (e) { next(e); }
});
router.get('/questions/:id(\\d+)/edit', staff, async (req, res, next) => {
  try { const q = await loadQ(req, req.params.id); if (!q) return nf(res); const o = optionsOf(q); res.view('questions/form', { title: 'ویرایش سؤال', row: q, vals: { ...q, answer_index: q.type === 'mcq' ? q.answer : '', answer_tf: q.answer, answer_text: q.answer }, opts: o.length ? o : ['', '', '', ''], errors: [], subjects: await subjectsFor(req), TYPES, DIFF, grades: L.gradeLevels }); } catch (e) { next(e); }
});
router.post('/questions/:id(\\d+)/edit', staff, async (req, res, next) => {
  try {
    const q = await loadQ(req, req.params.id); if (!q) return nf(res); const subjects = await subjectsFor(req); const { errors, data, opts } = parseQ(req.body, subjects.map((s) => s.id));
    if (errors.length) return res.view('questions/form', { title: 'ویرایش سؤال', row: q, vals: req.body, opts: opts.length ? opts : ['', '', '', ''], errors, subjects, TYPES, DIFF, grades: L.gradeLevels });
    await db.get()('questions').where({ id: q.id }).update(data); await svc.audit(req, 'update', 'questions', q.id, data.text.slice(0, 40)); req.flash('success', 'سؤال ذخیره شد.'); res.redirect('/questions');
  } catch (e) { next(e); }
});
router.post('/questions/:id(\\d+)/delete', staff, async (req, res, next) => {
  try {
    const q = await loadQ(req, req.params.id); if (!q) return nf(res);
    if (!isManager(req.user) && q.created_by !== req.user.id) { req.flash('error', 'فقط سازنده‌ی سؤال یا مدیر می‌تواند آن را حذف کند.'); return res.redirect('/questions'); }
    await db.get()('questions').where({ id: q.id }).del(); await svc.audit(req, 'delete', 'questions', q.id, ''); req.flash('success', 'سؤال حذف شد.'); res.redirect('/questions');
  } catch (e) { next(e); }
});

/* ---------- برگه‌ی امتحانی ---------- */
async function csFor(req) {
  const k = db.get();
  const q = k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').where('c.status', '<>', 'archived').orderBy('c.name').orderBy('s.name').select('cs.id', 'cs.subject_id', 's.name as subject_name', 'c.name as class_name', 'c.grade_level');
  if (!isManager(req.user)) q.where('cs.teacher_id', req.user.teacher ? req.user.teacher.id : 0);
  return q;
}
router.get('/papers', staff, async (req, res, next) => {
  try {
    const k = db.get(); const css = await csFor(req); const ids = css.map((c) => c.id);
    const rows = await k('exam_papers as p').join('class_subjects as cs', 'cs.id', 'p.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'cs.classroom_id').whereIn('p.class_subject_id', ids.length ? ids : [0]).orderBy('p.id', 'desc').select('p.*', 's.name as subject_name', 'c.name as class_name');
    rows.forEach((r) => { try { r.count = JSON.parse(r.items || '[]').length; } catch (_) { r.count = 0; } });
    res.view('questions/papers', { title: 'برگه‌های امتحانی', rows });
  } catch (e) { next(e); }
});
router.get('/papers/new', staff, async (req, res, next) => {
  try {
    const k = db.get(); const css = await csFor(req); const csId = Number(req.query.cs) || (css[0] && css[0].id); const cs = css.find((c) => c.id === csId);
    const questions = cs ? await k('questions').where({ subject_id: cs.subject_id }).orderBy('type').orderBy('id') : [];
    const stat = {}; questions.forEach((q) => { stat[q.type] = (stat[q.type] || 0) + 1; });
    res.view('questions/paper-form', { title: 'برگه‌ی امتحانی جدید', css, cs, questions, stat, TYPES, DIFF, optionsOf, errors: [], vals: { duration: 60, exam_date: J.isoToJString(J.todayISO()) } });
  } catch (e) { next(e); }
});
router.post('/papers', staff, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const css = await csFor(req); const cs = css.find((c) => c.id === Number(b.class_subject_id)); const errors = [];
    if (!cs) errors.push('درس/کلاس نامعتبر است.');
    if (!b.title || b.title.trim().length < 3) errors.push('عنوان برگه را وارد کنید.');
    const date = b.exam_date ? J.parseJalali(b.exam_date) : null; if (b.exam_date && !date) errors.push('تاریخ نامعتبر است.');
    const duration = Math.min(300, Math.max(5, parseInt(b.duration, 10) || 60));
    let items = [];
    if (cs) {
      const pool = await k('questions').where({ subject_id: cs.subject_id });
      if (b.mode === 'auto') { // انتخاب تصادفی بر اساس تعداد هر نوع
        const rnd = require('../lib/scheduler').prng(Date.now() % 1000003);
        for (const type of Object.keys(TYPES)) { const n = Math.max(0, Math.min(100, parseInt(b['n_' + type], 10) || 0)); if (!n) continue; const cand = pool.filter((q) => q.type === type).map((q) => ({ q, r: rnd() })).sort((x, y) => x.r - y.r).slice(0, n).map((x) => x.q); if (cand.length < n) errors.push(`از نوع «${TYPES[type]}» فقط ${cand.length} سؤال در بانک هست (${n} درخواست شد).`); items.push(...cand.map((q) => ({ id: q.id, score: Number(q.score) }))); }
      } else {
        const picked = [].concat(b.q || []).map(Number); const byId = Object.fromEntries(pool.map((q) => [q.id, q]));
        items = picked.filter((id) => byId[id]).map((id) => ({ id, score: Number(byId[id].score) }));
      }
      if (!items.length && !errors.length) errors.push('حداقل یک سؤال انتخاب کنید.');
    }
    if (errors.length) { const questions = cs ? await k('questions').where({ subject_id: cs.subject_id }).orderBy('type').orderBy('id') : []; const stat = {}; questions.forEach((q) => { stat[q.type] = (stat[q.type] || 0) + 1; }); return res.view('questions/paper-form', { title: 'برگه‌ی امتحانی جدید', css, cs, questions, stat, TYPES, DIFF, optionsOf, errors, vals: b }); }
    const order = Object.keys(TYPES); items.sort((x, y) => 0); // ترتیب: ابتدا انواع به ترتیب TYPES
    const types = Object.fromEntries((await k('questions').whereIn('id', items.map((i) => i.id)).select('id', 'type')).map((q) => [q.id, q.type]));
    items.sort((x, y) => order.indexOf(types[x.id]) - order.indexOf(types[y.id]));
    const r = await k('exam_papers').insert({ title: b.title.trim().slice(0, 200), class_subject_id: cs.id, exam_date: date, duration, instructions: (b.instructions || '').slice(0, 1500) || null, items: JSON.stringify(items), created_by: req.user.id });
    const id = Array.isArray(r) ? r[0] : r; await svc.audit(req, 'create', 'exam_papers', id, b.title);
    req.flash('success', `برگه با ${items.length} سؤال ساخته شد.`); res.redirect('/papers/' + id);
  } catch (e) { next(e); }
});
async function loadPaper(req, id) {
  const k = db.get(); const p = await k('exam_papers').where({ id }).first(); if (!p) return null;
  const css = await csFor(req); const cs = css.find((c) => c.id === p.class_subject_id); if (!cs) return null;
  const items = JSON.parse(p.items || '[]'); const qs = items.length ? await k('questions').whereIn('id', items.map((i) => i.id)) : []; const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const list = items.filter((i) => byId[i.id]).map((i) => ({ ...byId[i.id], paperScore: i.score, opts: optionsOf(byId[i.id]) }));
  return { p, cs, list, total: list.reduce((a, q) => a + Number(q.paperScore), 0) };
}
router.get('/papers/:id(\\d+)', staff, async (req, res, next) => {
  try { const r = await loadPaper(req, req.params.id); if (!r) return nf(res); res.view('questions/paper', { title: r.p.title, ...r, key: req.query.key === '1', TYPES, school: null }); } catch (e) { next(e); }
});
router.post('/papers/:id(\\d+)/delete', staff, async (req, res, next) => {
  try { const r = await loadPaper(req, req.params.id); if (!r) return nf(res); await db.get()('exam_papers').where({ id: r.p.id }).del(); await svc.audit(req, 'delete', 'exam_papers', r.p.id, r.p.title); req.flash('success', 'برگه حذف شد.'); res.redirect('/papers'); } catch (e) { next(e); }
});
module.exports = router;

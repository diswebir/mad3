'use strict';
/** درون‌ریزی نمرات از CSV/Excel با پیش‌نمایش و تأیید */
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const xlsx = require('../lib/xlsx');
const { toCSV, parseCSV } = require('../utils/csv');
const { analyze } = require('../lib/scoreImport');
const { requireRole } = require('../middleware');
const { normalizeInput } = require('../utils/fa');
const { loadAssessment } = require('./grades');
const router = express.Router();
const staff = requireRole('admin', 'deputy', 'teacher');
router.use('/grades', modules.guard('grades'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('file');
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'ارزشیابی یافت نشد یا دسترسی ندارید.' });

const classStudents = (k, cs) => k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code');

router.get('/grades/assessments/:id(\\d+)/template.:fmt(csv|xlsx)', staff, async (req, res, next) => {
  try {
    const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const { a, cs } = r; const k = db.get();
    const sc = Object.fromEntries((await k('scores').where({ assessment_id: a.id })).map((s) => [s.student_id, s.score]));
    const rows = (await classStudents(k, cs)).map((s) => [s.student_code, `${s.first_name} ${s.last_name}`, sc[s.id] === undefined || sc[s.id] === null ? '' : Number(sc[s.id])]);
    const head = ['کد دانش‌آموزی', 'نام', `نمره (از ${Number(a.max_score)})`];
    if (req.params.fmt === 'xlsx') return xlsx.send(res, `scores-${a.id}.xlsx`, [{ name: 'نمرات', rows: [head, ...rows] }]);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="scores-${a.id}.csv"`).send(toCSV(head, rows));
  } catch (e) { next(e); }
});

router.post('/grades/assessments/:id(\\d+)/import', staff, (req, res, next) => upload(req, res, (err) => { req.uploadError = err ? (err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از ۲ مگابایت است.' : err.message) : null; next(); }), async (req, res, next) => {
  try {
    const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const { a, cs } = r; const k = db.get();
    const back = '/grades/assessments/' + a.id;
    if (req.uploadError || !req.file) { req.flash('error', req.uploadError || 'فایلی انتخاب نشده است.'); return res.redirect(back); }
    const ext = path.extname(req.file.originalname || '').toLowerCase(); let rows;
    try {
      if (ext === '.xlsx') { const p = xlsx.parse(req.file.buffer); rows = p.sheets[0] ? p.sheets[0].rows : []; }
      else if (ext === '.csv' || ext === '.txt') rows = parseCSV(req.file.buffer.toString('utf8'));
      else { req.flash('error', 'فقط فایل‌های xlsx و csv پذیرفته می‌شود.'); return res.redirect(back); }
    } catch (e) { req.flash('error', 'خواندن فایل ممکن نشد: ' + e.message); return res.redirect(back); }
    const result = analyze(rows, await classStudents(k, cs), a.max_score);
    if (!result.entries.length) { req.flash('error', 'فایل داده‌ای ندارد.'); return res.redirect(back); }
    res.view('grades/import', { title: 'پیش‌نمایش درون‌ریزی نمرات', a, cs, result, payload: JSON.stringify(result.valid.map((e) => [e.student.id, e.score])) });
  } catch (e) { next(e); }
});

router.post('/grades/assessments/:id(\\d+)/import/commit', staff, async (req, res, next) => {
  try {
    const r = await loadAssessment(req, req.params.id); if (!r) return nf(res); const { a, cs } = r; const k = db.get();
    let list; try { list = JSON.parse(req.body.payload); } catch (_) { list = null; }
    if (!Array.isArray(list)) { req.flash('error', 'داده‌ی درون‌ریزی نامعتبر است.'); return res.redirect('/grades/assessments/' + a.id); }
    const ids = new Set((await classStudents(k, cs)).map((s) => s.id)); let n = 0;
    await k.transaction(async (t) => {
      for (const [sid, score] of list) {
        if (!ids.has(Number(sid))) continue; // هرگز نمره‌ی دانش‌آموز خارج از کلاس ثبت نمی‌شود
        const v = score === null ? null : Number(score);
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > Number(a.max_score))) continue;
        const ex = await t('scores').where({ assessment_id: a.id, student_id: sid }).first();
        if (ex) await t('scores').where({ id: ex.id }).update({ score: v }); else if (v !== null) await t('scores').insert({ assessment_id: a.id, student_id: sid, score: v });
        n++;
      }
    });
    await svc.audit(req, 'scores_import', 'assessments', a.id, `${a.title} — ${cs.class_name}: ${n} نمره`);
    req.flash('success', `${n} نمره از فایل ثبت شد.`); res.redirect('/grades/assessments/' + a.id);
  } catch (e) { next(e); }
});
module.exports = router;

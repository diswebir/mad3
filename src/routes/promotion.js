'use strict';
/** پایان سال تحصیلی: ارتقای پایه، تکرار پایه، فارغ‌التحصیلی و بایگانی سوابق */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const P = require('../lib/promotion');
const { requireRole } = require('../middleware');
const router = express.Router();
const guard = [requireRole('admin'), modules.guard('promotion')];

const parseYear = (b) => {
  const errors = []; const title = String(b.year_title || '').trim();
  const start = b.year_start ? J.parseJalali(b.year_start) : null; const end = b.year_end ? J.parseJalali(b.year_end) : null;
  if (!/^\d{4}\s*[-–/]\s*\d{4}$/.test(title)) errors.push('عنوان سال باید مثل ۱۴۰۵-۱۴۰۶ باشد.');
  if (b.year_start && !start) errors.push('تاریخ شروع سال معتبر نیست.');
  if (b.year_end && !end) errors.push('تاریخ پایان سال معتبر نیست.');
  if (start && end && end <= start) errors.push('پایان سال باید پس از شروع آن باشد.');
  return { errors, year: { title: title.replace(/\s+/g, '').replace('–', '-').replace('/', '-'), start_date: start, end_date: end } };
};

router.get('/promotion', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const cur = await k('academic_years').where({ is_current: 1 }).first();
    const sug = P.suggestNextYear(cur);
    const archived = Number((await k('classrooms').where({ status: 'archived' }).count({ c: '*' }).first()).c);
    const activeClasses = Number((await k('classrooms').where('status', '<>', 'archived').count({ c: '*' }).first()).c);
    const students = Number((await k('students').where({ status: 'active' }).count({ c: '*' }).first()).c);
    const closed = cur ? Number((await k('student_year_records').where({ academic_year_id: cur.id }).count({ c: '*' }).first()).c) > 0 : false;
    const years = await k('academic_years').orderBy('id', 'desc');
    const yearStats = await k('student_year_records').groupBy('academic_year_id').select('academic_year_id').count({ n: '*' });
    res.view('promotion/index', { title: 'پایان سال تحصیلی', cur, sug, archived, activeClasses, students, closed, years, yearStats: Object.fromEntries(yearStats.map((r) => [r.academic_year_id, Number(r.n)])), errors: [], vals: { year_title: sug.title, year_start: J.isoToJString(sug.start_date), year_end: J.isoToJString(sug.end_date) } });
  } catch (e) { next(e); }
});

router.post('/promotion/plan', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const { errors, year } = parseYear(req.body);
    if (!errors.length && await k('academic_years').where({ title: year.title }).first()) errors.push('سالی با این عنوان وجود دارد.');
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/promotion'); }
    const { pass, plan } = await P.buildPlan(k);
    res.view('promotion/plan', { title: 'برنامه‌ی ارتقا', year, yearForm: { year_title: year.title, year_start: year.start_date ? J.isoToJString(year.start_date) : '', year_end: year.end_date ? J.isoToJString(year.end_date) : '' }, pass, plan, total: plan.reduce((a, c) => a + c.rows.length, 0) });
  } catch (e) { next(e); }
});

router.post('/promotion/apply', ...guard, async (req, res, next) => {
  try {
    const { errors, year } = parseYear(req.body);
    if (req.body.confirm !== 'PROMOTE') errors.push('برای تأیید نهایی باید دقیقاً عبارت PROMOTE را تایپ کنید.');
    if (errors.length) { req.flash('error', errors.join(' ')); return res.redirect('/promotion'); }
    const actions = {}; const act = req.body.act || {};
    for (const [id, v] of Object.entries(act)) if (P.ACTIONS.includes(v)) actions[Number(id)] = v;
    let summary;
    try { summary = await P.apply(db.get(), { year, actions, userId: req.user.id }); } catch (e) { req.flash('error', e.message); return res.redirect('/promotion'); }
    await svc.audit(req, 'year_end', 'academic_years', null, `${summary.year}: ارتقا ${summary.promoted}، تکرار ${summary.retained}، فارغ‌التحصیل ${summary.graduated}`);
    req.flash('success', `سال ${summary.year} آغاز شد: ${summary.promoted} ارتقا، ${summary.retained} تکرار پایه، ${summary.graduated} فارغ‌التحصیل${summary.newClasses ? '، ' + summary.newClasses + ' کلاس تازه ساخته شد (دروس آن را تعریف کنید)' : ''}.`);
    res.redirect('/promotion/archive');
  } catch (e) { next(e); }
});

router.get('/promotion/archive', ...guard, async (req, res, next) => {
  try {
    const k = db.get();
    const rows = await k('classrooms as c').leftJoin('academic_years as y', 'y.id', 'c.academic_year_id').where('c.status', 'archived').orderBy('c.id', 'desc').select('c.*', 'y.title as year_title', k.raw('(select count(*) from student_year_records r where r.classroom_name = c.name) as snap_count'));
    res.view('promotion/archive', { title: 'کلاس‌های بایگانی‌شده', rows });
  } catch (e) { next(e); }
});
module.exports = router;

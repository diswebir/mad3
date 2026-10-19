'use strict';
/** پایان سال تحصیلی: ارتقای پایه، تکرار پایه، فارغ‌التحصیلی و بایگانی سوابق */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const P = require('../lib/promotion');
const B = require('../lib/backupTools');
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
    const runs = await k('promotion_runs').orderBy('id', 'desc').limit(5); const lastRun = runs.find((r) => !r.undone_at && r.id === (runs[0] && runs[0].id)) || null;
    res.view('promotion/index', { title: 'پایان سال تحصیلی', runs, lastRun, cur, sug, archived, activeClasses, students, closed, years, yearStats: Object.fromEntries(yearStats.map((r) => [r.academic_year_id, Number(r.n)])), errors: [], vals: { year_title: sug.title, year_start: J.isoToJString(sug.start_date), year_end: J.isoToJString(sug.end_date) } });
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
    let summary; let backup = null; const k = db.get();
    try {
      backup = await B.save(k, 'pre-promotion'); // پشتیبان خودکار پیش از هر تغییری
      summary = await P.apply(k, { year, actions, userId: req.user.id });
    } catch (e) { req.flash('error', e.message); return res.redirect('/promotion'); }
    const { undo, ...pub } = summary;
    const cur = await k('academic_years').where({ title: summary.year }).first();
    await k('promotion_runs').insert({ old_year_id: undo.prevYearId, new_year_id: cur ? cur.id : null, new_year_title: summary.year, payload: JSON.stringify({ ...undo, summary: pub }), backup_file: backup && backup.name, user_id: req.user.id });
    summary = pub;
    await svc.audit(req, 'year_end', 'academic_years', null, `${summary.year}: ارتقا ${summary.promoted}، تکرار ${summary.retained}، فارغ‌التحصیل ${summary.graduated}`);
    req.flash('success', `سال ${summary.year} آغاز شد: ${summary.promoted} ارتقا، ${summary.retained} تکرار پایه، ${summary.graduated} فارغ‌التحصیل${summary.newClasses ? '، ' + summary.newClasses + ' کلاس تازه ساخته شد (دروس آن را تعریف کنید)' : ''}.`);
    res.redirect('/promotion/archive');
  } catch (e) { next(e); }
});

router.post('/promotion/undo/:id(\\d+)', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const run = await k('promotion_runs').where({ id: req.params.id }).first();
    if (!run) { req.flash('error', 'ارتقای موردنظر پیدا نشد.'); return res.redirect('/promotion'); }
    if (req.body.confirm !== 'UNDO') { req.flash('error', 'برای تأیید، عبارت UNDO را تایپ کنید.'); return res.redirect('/promotion'); }
    let out; try { out = await P.undo(k, run); } catch (e) { req.flash('error', e.message); return res.redirect('/promotion'); }
    await svc.audit(req, 'year_end_undo', 'academic_years', run.new_year_id, `بازگردانی ارتقای ${run.new_year_title}: ${out.students} دانش‌آموز، ${out.classes} کلاس جدید حذف شد`);
    req.flash('success', `ارتقای ${run.new_year_title} بازگردانده شد: وضعیت ${out.students} دانش‌آموز و کلاس‌های قبلی به حالت اول برگشت.`); res.redirect('/promotion');
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

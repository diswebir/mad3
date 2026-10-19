'use strict';
/** گزارش‌های مدیریتی (مورد ۱۲): دانش‌آموزان در معرض خطر، روندها، مقایسه‌ی کلاس‌ها + خروجی اکسل */
const express = require('express');
const db = require('../db');
const modules = require('../modules');
const xlsx = require('../lib/xlsx');
const charts = require('../lib/charts');
const analytics = require('../lib/analytics');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/reports', modules.guard('reports'), requireRole('admin', 'deputy'));

const num = (v) => (v === null || v === undefined ? '' : v);

router.get('/reports/risk', async (req, res, next) => {
  try {
    const k = db.get(); const classId = Number(req.query.class_id) || null;
    const list = await analytics.riskList(k, { classId });
    if (req.query.format === 'xlsx') return xlsx.send(res, 'at-risk-students.xlsx', [{ name: 'دانش‌آموزان در معرض خطر', rows: [['نام', 'کد', 'کلاس', 'سطح', 'امتیاز ریسک', 'معدل', 'غیبت', 'تأخیر', 'دلایل'], ...list.map((s) => [`${s.first_name} ${s.last_name}`, s.student_code, s.class_name, s.level === 'high' ? 'زیاد' : 'متوسط', s.score, num(s.overall), s.absent, s.late, s.reasons.join('، ')])] }]);
    const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    res.view('analytics/risk', { title: 'دانش‌آموزان در معرض خطر', list, classes, classId });
  } catch (e) { next(e); }
});

router.get('/reports/compare', async (req, res, next) => {
  try {
    const rows = await analytics.classComparison(db.get());
    if (req.query.format === 'xlsx') return xlsx.send(res, 'class-comparison.xlsx', [{ name: 'مقایسه کلاس‌ها', rows: [['کلاس', 'پایه', 'تعداد', 'میانگین', 'درصد قبولی', 'درصد حضور', 'درصد مانده بدهی'], ...rows.map((r) => [r.name, r.grade, r.students, num(r.avg), num(r.passRate), num(r.attendance), num(r.due)])] }]);
    const withAvg = rows.filter((r) => r.avg !== null);
    const chart = charts.barChart(withAvg.map((r) => ({ label: r.name, value: r.avg })), { max: 20 });
    res.view('analytics/compare', { title: 'مقایسه‌ی کلاس‌ها', rows, chart });
  } catch (e) { next(e); }
});

router.get('/reports/trends', async (req, res, next) => {
  try {
    const months = Math.min(12, Math.max(3, Number(req.query.months) || 8)); const t = await analytics.trends(db.get(), months);
    if (req.query.format === 'xlsx') {
      const sheets = [];
      if (t.attendance.length) sheets.push({ name: 'حضور ماهانه', rows: [['ماه', 'درصد حضور'], ...t.attendance.map((p) => [p.label, num(p.value)])] });
      if (t.income.length) sheets.push({ name: 'درآمد ماهانه', rows: [['ماه', 'مبلغ'], ...t.income.map((p) => [p.label, p.value])] });
      if (t.terms.length) sheets.push({ name: 'میانگین نوبت‌ها', rows: [['کلاس', ...t.terms[0].points.map((p) => p.label)], ...t.terms.map((c) => [c.name, ...c.points.map((p) => num(p.value))])] });
      if (!sheets.length) sheets.push({ name: 'خالی', rows: [['داده‌ای نیست']] });
      return xlsx.send(res, 'trends.xlsx', sheets);
    }
    const c = {
      attendance: t.attendance.length ? charts.lineChart(t.attendance, { min: 0, max: 100, unit: '٪' }) : '',
      income: t.income.length ? charts.lineChart(t.income, { min: 0, max: Math.max(1, ...t.income.map((p) => p.value)) }) : '',
      terms: t.terms.length ? charts.lineChart(t.terms.slice(0, 6).map((x) => ({ name: x.name, points: x.points })), { min: 0, max: 20 }) : '',
    };
    res.view('analytics/trends', { title: 'روند و نمودارها', t, c, months });
  } catch (e) { next(e); }
});
module.exports = router;

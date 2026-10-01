'use strict';
const express = require('express');
const db = require('../db');
const modules = require('../modules');
const settings = require('../settings');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { requireRole } = require('../middleware');
const { classResults } = require('../lib/gradesCalc');
const router = express.Router();
router.use('/reports', modules.guard('reports'), requireRole('admin', 'deputy'));
const M = modules.isEnabled;

router.get('/reports', async (req, res, next) => {
  try {
    const k = db.get(); const d = { title: 'گزارش‌ها و آمار' };
    d.classes = await k('classrooms as c').where('c.status', '<>', 'archived').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as u', 'u.id', 't.user_id').orderBy('c.name').select('c.id', 'c.name', 'c.capacity', 'u.full_name as homeroom', k.raw("(select count(*) from students s where s.classroom_id = c.id and s.status = 'active') as cnt"));
    d.gender = Object.fromEntries((await k('students').where({ status: 'active' }).groupBy('gender').select('gender').count({ c: '*' })).map((x) => [x.gender || '-', Number(x.c)]));
    d.status = Object.fromEntries((await k('students').groupBy('status').select('status').count({ c: '*' })).map((x) => [x.status, Number(x.c)]));
    d.workload = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('u.full_name', k.raw('(select coalesce(sum(weekly_hours),0) from class_subjects cs where cs.teacher_id = t.id) as hours'), k.raw('(select count(distinct classroom_id) from class_subjects cs where cs.teacher_id = t.id) as classes'));
    if (M('attendance')) {
      const t = J.isoToJ(J.todayISO()); const { start, end } = J.monthRange(t.jy, t.jm);
      d.att = await k('attendance as a').join('classrooms as c', 'c.id', 'a.classroom_id').whereBetween('a.date', [start, end]).groupBy('c.id', 'c.name').orderBy('c.name').select('c.name').count({ total: '*' }).sum({ present: k.raw("case when a.status in ('present','late','excused','leave') then 1 else 0 end") }).sum({ absent: k.raw("case when a.status = 'absent' then 1 else 0 end") });
      d.monthLabel = `${J.MONTHS[t.jm - 1]} ${t.jy}`;
      d.topAbsent = await k('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classrooms as c', 'c.id', 'a.classroom_id').where('a.status', 'absent').groupBy('s.id', 's.first_name', 's.last_name', 'c.name').orderBy('n', 'desc').limit(10).select('s.id', 's.first_name', 's.last_name', 'c.name as cname').count({ n: '*' });
      d.threshold = settings.num('absence_alert_threshold');
    }
    if (M('grades')) {
      d.grades = []; d.top = [];
      for (const c of d.classes) { const r = await classResults(k, c.id, {}); const v = r.students.filter((s) => s.overall !== null); if (v.length) { d.grades.push({ name: c.name, avg: Math.round(v.reduce((a, b) => a + b.overall, 0) / v.length * 100) / 100, n: v.length, failing: v.filter((s) => s.overall < r.pass).length }); v.forEach((s) => d.top.push({ id: s.id, name: `${s.first_name} ${s.last_name}`, cname: c.name, overall: s.overall })); } }
      d.top.sort((a, b) => b.overall - a.overall); d.top = d.top.slice(0, 10);
    }
    if (M('tickets')) {
      d.tickets = {
        status: Object.fromEntries((await k('tickets').groupBy('status').select('status').count({ c: '*' })).map((x) => [x.status, Number(x.c)])),
        category: (await k('tickets').groupBy('category').select('category').count({ c: '*' })),
        rating: (await k('tickets').whereNotNull('rating').avg({ a: 'rating' }).first()).a,
      };
    }
    if (M('finance')) {
      d.fin = await k('fees as f').join('students as s', 's.id', 'f.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id').groupBy('c.name').orderBy('c.name').select('c.name').sum({ billed: k.raw('f.amount - coalesce(f.discount,0)') });
      const paid = await k('payments as p').where('p.voided', 0).join('fees as f', 'f.id', 'p.fee_id').join('students as s', 's.id', 'f.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id').groupBy('c.name').select('c.name').sum({ paid: 'p.amount' });
      const pm = Object.fromEntries(paid.map((x) => [x.name, Number(x.paid)])); d.fin = d.fin.map((x) => ({ name: x.name || 'بدون کلاس', billed: Number(x.billed), paid: pm[x.name] || 0 }));
    }
    res.view('reports/index', d);
  } catch (e) { next(e); }
});
router.get('/reports/students.csv', async (req, res, next) => {
  try {
    const rows = await db.get()('classrooms as c').where('c.status', '<>', 'archived').leftJoin('students as s', function () { this.on('s.classroom_id', 'c.id').andOn('s.status', db.get().raw('?', ['active'])); }).groupBy('c.id', 'c.name', 'c.capacity').orderBy('c.name').select('c.name', 'c.capacity').count({ n: 's.id' });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="class-summary.csv"').send(toCSV(['کلاس', 'ظرفیت', 'تعداد دانش‌آموز'], rows.map((r) => [r.name, r.capacity, r.n])));
  } catch (e) { next(e); }
});
module.exports = router;

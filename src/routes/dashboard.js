'use strict';
const express = require('express');
const db = require('../db');
const modules = require('../modules');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');
const router = express.Router();

async function birthdays(classIds) {
  const t = J.isoToJ(J.todayISO());
  const q = db.get()('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').whereNotNull('s.birth_date').select('s.id', 's.first_name', 's.last_name', 's.birth_date', 'c.name as class_name');
  if (classIds) q.whereIn('s.classroom_id', classIds.length ? classIds : [0]);
  return (await q).filter((s) => { const j = J.isoToJ(s.birth_date); return j && j.jm === t.jm && j.jd === t.jd; });
}
async function latestAnnouncements(user, classIds, n = 4) {
  const today = J.todayISO();
  const q = db.get()('announcements as t').where((b) => b.whereNull('t.expires_on').orWhere('t.expires_on', '>=', today));
  svc.audienceFilter(q, user, classIds);
  return q.orderBy([{ column: 't.pinned', order: 'desc' }, { column: 't.id', order: 'desc' }]).limit(n).select('t.*');
}
const M = modules.isEnabled;

router.get('/', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const today = J.todayISO(); const dow = J.dow(today);
    const isSchoolDay = settings.weekDays().includes(dow);
    const data = { title: 'داشبورد', today, isSchoolDay, dow };
    const classIds = await svc.accessibleClassIds(u);
    if (M('announcements')) data.announcements = await latestAnnouncements(u, classIds);
    if (M('calendar')) {
      const q = k('events as t').where('t.start_date', '>=', today).orderBy('t.start_date').limit(5).select('t.*');
      svc.audienceFilter(q, u, classIds, 't', false); data.events = await q;
    }
    if (M('exams') && !(u.role === 'teacher' && !classIds.length)) {
      const q = k('exam_schedule as e').join('subjects as s', 's.id', 'e.subject_id').join('classrooms as c', 'c.id', 'e.classroom_id').where('e.exam_date', '>=', today).orderBy('e.exam_date').limit(5).select('e.*', 's.name as subject_name', 'c.name as class_name');
      if (classIds) q.whereIn('e.classroom_id', classIds.length ? classIds : [0]);
      data.exams = await q;
    }
    if (settings.bool('show_birthdays') && u.role !== 'student') data.birthdays = await birthdays(classIds);

    if (u.role === 'admin' || u.role === 'deputy') {
      data.counts = {
        students: Number((await k('students').where({ status: 'active' }).count({ c: '*' }).first()).c),
        teachers: Number((await k('teachers').where({ status: 'active' }).count({ c: '*' }).first()).c),
        classes: Number((await k('classrooms').count({ c: '*' }).first()).c),
        subjects: Number((await k('subjects').count({ c: '*' }).first()).c),
      };
      if (M('attendance')) {
        const rows = await k('attendance').where({ date: today }).groupBy('status').select('status').count({ c: '*' });
        const m = Object.fromEntries(rows.map((x) => [x.status, Number(x.c)]));
        const total = Object.values(m).reduce((a, b) => a + b, 0);
        data.att = { total, absent: m.absent || 0, late: m.late || 0, present: m.present || 0, rate: total ? Math.round(((m.present || 0) + (m.late || 0)) * 100 / total) : null };
        const recorded = await k('attendance').where({ date: today }).countDistinct({ c: 'classroom_id' }).first();
        data.att.classesRecorded = Number(recorded.c); data.att.classesTotal = data.counts.classes;
        data.absentees = await k('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classrooms as c', 'c.id', 'a.classroom_id').where({ 'a.date': today, 'a.status': 'absent' }).orderBy('c.name').limit(10).select('s.id', 's.first_name', 's.last_name', 'c.name as class_name');
        const days = await k('attendance').where('date', '<=', today).groupBy('date').orderBy('date', 'desc').limit(7).select('date').count({ total: '*' }).sum({ present: k.raw("case when status in ('present','late') then 1 else 0 end") });
        data.trend = days.reverse().map((x) => ({ date: x.date, rate: x.total ? Math.round(Number(x.present) * 100 / Number(x.total)) : 0 }));
      }
      if (M('tickets')) {
        data.ticketCount = Number((await k('tickets').whereIn('status', ['open', 'pending']).count({ c: '*' }).first()).c);
        data.tickets = await k('tickets as t').join('users as u', 'u.id', 't.created_by').whereIn('t.status', ['open', 'pending']).orderBy('t.id', 'desc').limit(5).select('t.*', 'u.full_name as creator');
      }
      if (M('finance')) {
        const billed = await k('fees').sum({ a: k.raw('amount - coalesce(discount,0)') }).first();
        const paid = await k('payments').sum({ a: 'amount' }).first();
        data.fin = { billed: Number(billed.a) || 0, paid: Number(paid.a) || 0 };
      }
      if (M('library')) data.overdueLoans = Number((await k('book_loans').whereNull('returned_at').where('due_date', '<', today).count({ c: '*' }).first()).c);
      return res.view('dashboard/admin', data);
    }

    if (u.role === 'teacher') {
      const t = u.teacher;
      data.classes = classIds.length ? await k('classrooms as c').whereIn('c.id', classIds).orderBy('c.name').select('c.*', k.raw('(select count(*) from students s where s.classroom_id = c.id and s.status = ?) as student_count', ['active'])) : [];
      if (t) data.homeroomIds = (await svc.homeroomClassIds(u));
      if (M('timetable') && isSchoolDay && t) {
        data.schedule = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where({ 'cs.teacher_id': t.id, 'tt.day': dow }).orderBy('tt.period').select('tt.period', 's.name as subject_name', 'c.name as class_name', 'c.id as classroom_id');
        data.periods = settings.periods();
      }
      if (M('attendance') && isSchoolDay && data.homeroomIds && data.homeroomIds.length) {
        const rec = (await k('attendance').where({ date: today }).whereIn('classroom_id', data.homeroomIds).distinct('classroom_id')).map((x) => x.classroom_id);
        data.pendingAttendance = data.classes.filter((c) => data.homeroomIds.includes(c.id) && !rec.includes(c.id));
      }
      if (M('tickets')) {
        data.ticketCount = Number((await k('tickets').where('recipient_user_id', u.id).whereIn('status', ['open', 'pending']).count({ c: '*' }).first()).c);
        data.tickets = await k('tickets as t').join('users as x', 'x.id', 't.created_by').where('t.recipient_user_id', u.id).whereIn('t.status', ['open', 'pending']).orderBy('t.id', 'desc').limit(5).select('t.*', 'x.full_name as creator');
      }
      if (M('homework') && t) {
        data.toGrade = Number((await k('homework_submissions as x').join('homework as h', 'h.id', 'x.homework_id').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').where('cs.teacher_id', t.id).whereNull('x.score').count({ c: '*' }).first()).c);
      }
      return res.view('dashboard/teacher', data);
    }

    // دانش‌آموز
    const s = u.student;
    data.student = s;
    if (s) {
      data.klass = s.classroom_id ? await k('classrooms as c').leftJoin('teachers as t', 't.id', 'c.homeroom_teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id').where('c.id', s.classroom_id).select('c.*', 'tu.full_name as homeroom_name').first() : null;
      if (M('timetable') && isSchoolDay && s.classroom_id) {
        data.schedule = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as sub', 'sub.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id').where({ 'tt.classroom_id': s.classroom_id, 'tt.day': dow }).orderBy('tt.period').select('tt.period', 'sub.name as subject_name', 'tu.full_name as teacher_name');
        data.periods = settings.periods();
      }
      if (M('homework') && s.classroom_id) {
        data.homework = await k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').join('subjects as sub', 'sub.id', 'cs.subject_id').leftJoin('homework_submissions as x', function () { this.on('x.homework_id', 'h.id').andOn('x.student_id', k.raw('?', [s.id])); }).where('cs.classroom_id', s.classroom_id).where((b) => b.where('h.due_date', '>=', J.addDays(today, -7)).orWhereNull('h.due_date')).orderBy('h.due_date').limit(6).select('h.id', 'h.title', 'h.due_date', 'sub.name as subject_name', 'x.id as sub_id', 'x.score');
      }
      if (M('attendance')) {
        const rows = await k('attendance').where({ student_id: s.id }).groupBy('status').select('status').count({ c: '*' });
        const m = Object.fromEntries(rows.map((x) => [x.status, Number(x.c)])); const total = Object.values(m).reduce((a, b) => a + b, 0);
        data.att = { ...m, total, rate: total ? Math.round(((m.present || 0) + (m.late || 0)) * 100 / total) : null };
        data.recentAbsences = await k('attendance').where({ student_id: s.id }).whereIn('status', ['absent']).orderBy('date', 'desc').limit(3);
      }
      if (M('grades')) data.scores = await k('scores as sc').join('assessments as a', 'a.id', 'sc.assessment_id').join('class_subjects as cs', 'cs.id', 'a.class_subject_id').join('subjects as sub', 'sub.id', 'cs.subject_id').where({ 'sc.student_id': s.id, 'a.published': 1 }).whereNotNull('sc.score').orderBy('a.date', 'desc').limit(5).select('sc.score', 'a.title', 'a.max_score', 'a.date', 'sub.name as subject_name');
      if (M('tickets')) data.tickets = await k('tickets').where({ created_by: u.id }).whereNot('status', 'closed').orderBy('id', 'desc').limit(4);
      if (M('finance')) {
        const f = await k('fees').where({ student_id: s.id }).sum({ a: k.raw('amount - coalesce(discount,0)') }).first();
        const p = await k('payments as p').join('fees as f', 'f.id', 'p.fee_id').where('f.student_id', s.id).sum({ a: 'p.amount' }).first();
        data.debt = Math.max(0, (Number(f.a) || 0) - (Number(p.a) || 0));
      }
      if (M('library')) data.loans = await k('book_loans as l').join('books as b', 'b.id', 'l.book_id').where({ 'l.student_id': s.id }).whereNull('l.returned_at').select('l.*', 'b.title');
    }
    return res.view('dashboard/student', data);
  } catch (e) { next(e); }
});
module.exports = router;

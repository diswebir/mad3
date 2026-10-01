'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/timetable', modules.guard('timetable'));

async function classList(req) {
  const ids = await svc.accessibleClassIds(req.user);
  const q = db.get()('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'); if (ids) q.whereIn('id', ids.length ? ids : [0]); return q;
}
const cellQuery = (k) => k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
  .select('tt.*', 's.name as subject_name', 'c.name as class_name', 'u.full_name as teacher_name', 'cs.teacher_id');

router.get('/timetable', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const periods = settings.periods(); const days = settings.weekDays();
    const data = { title: 'برنامه هفتگی', periods, days, mode: 'class', cells: {}, edit: false, WEEKDAYS: J.WEEKDAYS, subject: '', classes: [], hours: [], placed: {}, options: [] };
    if (u.role === 'teacher' && req.query.mode !== 'class' && !req.query.class_id) {
      data.mode = 'teacher'; data.subject = u.full_name;
      const rows = await cellQuery(k).where('cs.teacher_id', u.teacher ? u.teacher.id : 0);
      rows.forEach((r) => { data.cells[r.day + '-' + r.period] = r; }); data.classes = await classList(req);
      data.subs = await k('substitutions as s').join('classrooms as c', 'c.id', 's.classroom_id').where('s.substitute_teacher_id', u.teacher ? u.teacher.id : 0).where('s.date', '>=', J.todayISO()).orderBy('s.date').orderBy('s.period').select('s.date', 's.period', 'c.name as class_name');
      return res.view('timetable/index', data);
    }
    if (isManager(u) && req.query.teacher_id) {
      data.mode = 'teacher'; const t = await k('teachers as t').join('users as x', 'x.id', 't.user_id').where('t.id', req.query.teacher_id).first('t.id', 'x.full_name');
      data.subject = t ? t.full_name : ''; data.teacherId = t ? t.id : null;
      const rows = t ? await cellQuery(k).where('cs.teacher_id', t.id) : []; rows.forEach((r) => { data.cells[r.day + '-' + r.period] = r; });
    } else {
      data.classes = await classList(req);
      const cid = u.role === 'student' ? (u.student && u.student.classroom_id) : (Number(req.query.class_id) || (data.classes[0] && data.classes[0].id));
      data.cls = u.role === 'student' ? await k('classrooms').where({ id: cid }).first() : data.classes.find((c) => c.id === cid);
      if (data.cls) {
        const rows = await cellQuery(k).where('tt.classroom_id', data.cls.id); rows.forEach((r) => { data.cells[r.day + '-' + r.period] = r; });
        data.subject = data.cls.name;
        data.hours = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.classroom_id', data.cls.id).select('cs.id', 's.name', 'cs.weekly_hours');
        data.placed = {}; rows.forEach((r) => { data.placed[r.class_subject_id] = (data.placed[r.class_subject_id] || 0) + 1; });
        if (isManager(u) && req.query.edit === '1') { data.edit = true; data.options = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as x', 'x.id', 't.user_id').where('cs.classroom_id', data.cls.id).orderBy('s.name').select('cs.id', 's.name', 'x.full_name'); }
      }
    }
    res.view('timetable/index', data);
  } catch (e) { next(e); }
});

router.post('/timetable', requireRole('admin', 'deputy'), async (req, res, next) => {
  try {
    const k = db.get(); const cid = Number(req.body.class_id); const cls = await k('classrooms').where({ id: cid }).first();
    if (!cls) { req.flash('error', 'کلاس نامعتبر است.'); return res.redirect('/timetable'); }
    const cs = await k('class_subjects').where({ classroom_id: cid }).select('id', 'teacher_id'); const csMap = Object.fromEntries(cs.map((c) => [String(c.id), c]));
    const periods = settings.periods(); const days = settings.weekDays(); const cell = req.body.cell || {}; const rows = []; const errors = [];
    for (const d of days) for (const p of periods) {
      const v = cell[`${d}-${p.n}`]; if (!v) continue;
      if (!csMap[v]) { errors.push('درس انتخاب‌شده متعلق به این کلاس نیست.'); continue; }
      rows.push({ classroom_id: cid, day: d, period: p.n, class_subject_id: Number(v), _t: csMap[v].teacher_id });
    }
    const unav = await k('teacher_unavailability').select('teacher_id', 'day', 'period');
    for (const r of rows) {
      if (!r._t) continue;
      if (unav.some((u) => u.teacher_id === r._t && u.day === r.day && u.period === r.period)) errors.push(`معلم این درس در ${J.WEEKDAYS[r.day]} زنگ ${r.period} حضور ندارد (ساعت غیرمجاز).`);
      const clash = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where({ 'cs.teacher_id': r._t, 'tt.day': r.day, 'tt.period': r.period }).whereNot('tt.classroom_id', cid).first('c.name');
      if (clash) errors.push(`تداخل: معلم این درس در ${J.WEEKDAYS[r.day]} زنگ ${r.period} در کلاس «${clash.name}» حضور دارد.`);
      const dup = rows.filter((x) => x._t === r._t && x.day === r.day && x.period === r.period).length; if (dup > 1) errors.push('یک معلم نمی‌تواند هم‌زمان دو درس داشته باشد.');
    }
    if (errors.length) { req.flash('error', [...new Set(errors)].slice(0, 4).join(' | ')); return res.redirect(`/timetable?class_id=${cid}&edit=1`); }
    await k.transaction(async (t) => { await t('timetable').where({ classroom_id: cid }).del(); if (rows.length) await t('timetable').insert(rows.map(({ _t, ...r }) => r)); });
    await svc.audit(req, 'update', 'timetable', cid, cls.name); req.flash('success', 'برنامه هفتگی ذخیره شد.'); res.redirect('/timetable?class_id=' + cid);
  } catch (e) { next(e); }
});

/* تقویم ماهانه */
router.get('/calendar', modules.guard('calendar'), async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const t = J.isoToJ(J.todayISO());
    let jy = Number(req.query.year) || t.jy; let jm = Number(req.query.month) || t.jm; if (jm < 1) { jm = 12; jy--; } if (jm > 12) { jm = 1; jy++; }
    const { start, end, length } = J.monthRange(jy, jm); const classIds = await svc.accessibleClassIds(u);
    const items = {}; const add = (iso, o) => { (items[iso] = items[iso] || []).push(o); };
    const ev = k('events as t').where('t.start_date', '<=', end).where((b) => b.where('t.end_date', '>=', start).orWhere((c) => c.whereNull('t.end_date').where('t.start_date', '>=', start)));
    svc.audienceFilter(ev, u, classIds, 't', false);
    for (const e of await ev.select('t.*')) { const last = e.end_date || e.start_date; for (let d = e.start_date < start ? start : e.start_date; d <= last && d <= end; d = J.addDays(d, 1)) add(d, { t: e.title, c: e.type === 'holiday' ? 'holiday' : e.type === 'exam' ? 'exam' : '' }); }
    if (modules.isEnabled('exams')) {
      const ex = k('exam_schedule as e').join('subjects as s', 's.id', 'e.subject_id').join('classrooms as c', 'c.id', 'e.classroom_id').whereBetween('e.exam_date', [start, end]);
      if (classIds) ex.whereIn('e.classroom_id', classIds.length ? classIds : [0]);
      for (const e of await ex.select('e.exam_date', 's.name as sn', 'c.name as cn')) add(e.exam_date, { t: `امتحان ${e.sn} (${e.cn})`, c: 'exam' });
    }
    if (u.role !== 'student') {
      const q = k('students').where({ status: 'active' }).whereNotNull('birth_date'); if (classIds) q.whereIn('classroom_id', classIds.length ? classIds : [0]);
      for (const s of await q.select('first_name', 'last_name', 'birth_date')) { const j = J.isoToJ(s.birth_date); if (j && j.jm === jm) add(J.jToIso(jy, jm, Math.min(j.jd, length)), { t: `🎂 ${s.first_name} ${s.last_name}`, c: 'bday' }); }
    }
    const firstDow = J.dow(start); const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= length; d++) { const iso = J.jToIso(jy, jm, d); cells.push({ d, iso, today: iso === J.todayISO(), off: !settings.weekDays().includes(J.dow(iso)), items: items[iso] || [] }); }
    const py = jm === 1 ? jy - 1 : jy; const pm = jm === 1 ? 12 : jm - 1; const ny = jm === 12 ? jy + 1 : jy; const nm = jm === 12 ? 1 : jm + 1;
    res.view('calendar/index', { title: 'تقویم', jy, jm, cells, prev: `?year=${py}&month=${pm}`, next: `?year=${ny}&month=${nm}`, WEEKDAYS: J.WEEKDAYS, MONTHS: J.MONTHS });
  } catch (e) { next(e); }
});
module.exports = router;

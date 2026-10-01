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
const rules = require('../lib/attendanceRules');
const sms = require('../lib/sms');
const qr = require('../lib/qr');
const router = express.Router();
router.use('/attendance', modules.guard('attendance'));
const staff = requireRole('admin', 'deputy', 'teacher');
const STATUSES = Object.keys(L.attendance);

/** forRecording: در حالت «روزانه» فقط معلم راهنما حق ثبت دارد؛ در حالت «به‌تفکیک زنگ» هر معلمِ کلاس */
async function accessibleClasses(req, forRecording = false) {
  const ids = forRecording && req.user.role === 'teacher' && settings.get('attendance_mode') !== 'periodic' ? await svc.homeroomClassIds(req.user) : await svc.accessibleClassIds(req.user);
  const q = db.get()('classrooms').where('status', '<>', 'archived').orderBy('grade_level').orderBy('name').select('id', 'name', 'grade_level');
  if (ids) q.whereIn('id', ids.length ? ids : [0]);
  return q;
}
const parseDate = (s) => (s ? (J.parseJalali(s) || null) : null);

router.get('/attendance', staff, async (req, res, next) => {
  try {
    const k = db.get(); const classes = await accessibleClasses(req, true);
    const date = parseDate(req.query.date) || J.todayISO(); const mode = settings.get('attendance_mode'); const periods = settings.periods();
    const period = mode === 'periodic' ? Math.min(Math.max(parseInt(req.query.period, 10) || 1, 1), periods.length) : 0;
    const classId = Number(req.query.class_id) || (classes[0] && classes[0].id);
    const cls = classes.find((c) => c.id === classId);
    const data = { title: 'ثبت حضور و غیاب', classes, cls, date, mode, periods, period, STATUSES, today: J.todayISO() };
    if (cls) {
      data.students = await k('students').where({ classroom_id: cls.id, status: 'active' }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code', 'father_phone', 'mother_phone');
      const ex = await k('attendance').where({ classroom_id: cls.id, date, period });
      data.existing = Object.fromEntries(ex.map((a) => [a.student_id, a]));
      data.recorded = ex.length > 0;
      data.offDay = !settings.weekDays().includes(J.dow(date));
      data.future = date > J.todayISO();
      const perm = await rules.canRecord(req.user, cls, date, period, { homeroomIds: req.user.role === 'teacher' ? await svc.homeroomClassIds(req.user) : [] });
      data.blocked = perm.ok ? null : perm.reason;
    } else if (classes.length === 0) data.students = [];
    // وضعیت ثبت امروز برای انتخاب سریع کلاس
    if (!cls || classes.length > 1) {
      const rec = await k('attendance').where({ date, period }).whereIn('classroom_id', classes.map((c) => c.id)).distinct('classroom_id');
      data.recordedIds = rec.map((r) => r.classroom_id);
    }
    res.view('attendance/index', data);
  } catch (e) { next(e); }
});

router.post('/attendance', staff, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const classes = await accessibleClasses(req, true);
    const cls = classes.find((c) => c.id === Number(b.class_id)); const date = parseDate(b.date);
    const mode = settings.get('attendance_mode'); const period = mode === 'periodic' ? Math.min(Math.max(parseInt(b.period, 10) || 1, 1), settings.num('periods_count') || 12) : 0;
    const back = `/attendance?class_id=${b.class_id}&date=${encodeURIComponent(J.isoToJString(date || J.todayISO()))}${mode === 'periodic' ? '&period=' + period : ''}`;
    if (!cls || !date) { req.flash('error', 'کلاس یا تاریخ نامعتبر است.'); return res.redirect('/attendance'); }
    if (date > J.todayISO()) { req.flash('error', 'ثبت حضور و غیاب برای روزهای آینده ممکن نیست.'); return res.redirect(back); }
    const perm = await rules.canRecord(req.user, cls, date, period, { homeroomIds: req.user.role === 'teacher' ? await svc.homeroomClassIds(req.user) : [] });
    if (!perm.ok) { req.flash('error', perm.reason); return res.redirect(back); }
    const students = await k('students').where({ classroom_id: cls.id, status: 'active' }).select('id', 'user_id', 'first_name', 'last_name', 'father_phone', 'mother_phone', 'guardian_phone');
    const existing = Object.fromEntries((await k('attendance').where({ classroom_id: cls.id, date, period })).map((a) => [a.student_id, a]));
    const st = b.status || {}; const notes = b.note || {}; const newAbsent = []; const newAbsentRows = []; const newLateRows = []; let n = 0;
    await k.transaction(async (t) => {
      for (const s of students) {
        const status = STATUSES.includes(st[s.id]) ? st[s.id] : 'present'; const note = (notes[s.id] || '').slice(0, 250) || null;
        const old = existing[s.id];
        if (old) { if (old.status !== status || (old.note || null) !== note) { await t('attendance').where({ id: old.id }).update({ status, note, recorded_by: req.user.id, updated_at: svc.nowStr() }); n++; } } else { await t('attendance').insert({ student_id: s.id, classroom_id: cls.id, date, period, status, note, recorded_by: req.user.id, updated_at: svc.nowStr() }); n++; }
        if (status === 'absent' && (!old || old.status !== 'absent')) { newAbsent.push(s.user_id); newAbsentRows.push(s); }
        if (status === 'late' && (!old || old.status !== 'late')) newLateRows.push(s);
      }
    });
    if (settings.bool('notify_on_absence') && newAbsent.length) {
      const ticketsOn = modules.isEnabled('tickets');
      await svc.notify(newAbsent, 'غیبت شما ثبت شد', `غیبت شما در تاریخ ${J.isoToJString(date)} ثبت شد.${ticketsOn ? ' در صورت داشتن عذر موجه از طریق تیکت اقدام کنید.' : ''}`, ticketsOn ? `/tickets/new?category=absence&date=${date}` : '/attendance/my', 'warn');
    }
    const when = J.isoToJString(date);
    if (period === 0 || period === 1 || mode !== 'periodic') {
      await sms.notifyParents(newAbsentRows, (x) => sms.render('اولیای گرامی، {student} در تاریخ {date} غایب ثبت شد. {school}', { student: `${x.first_name} ${x.last_name}`, date: when }), 'absence', req.user.id);
      await sms.notifyParents(newLateRows, (x) => sms.render('اولیای گرامی، {student} در تاریخ {date} با تأخیر وارد مدرسه شد. {school}', { student: `${x.first_name} ${x.last_name}`, date: when }), 'late', req.user.id);
    }
    await svc.audit(req, 'attendance', 'attendance', cls.id, `${cls.name} — ${J.isoToJString(date)} — ${n} تغییر`);
    req.flash('success', `حضور و غیاب کلاس ${cls.name} ثبت شد.`); res.redirect(back);
  } catch (e) { next(e); }
});

async function monthData(req, classId, jy, jm) {
  const k = db.get(); const { start, end, length } = J.monthRange(jy, jm);
  const students = await k('students').where({ classroom_id: classId, status: 'active' }).orderBy('last_name').orderBy('first_name').select('id', 'first_name', 'last_name', 'student_code');
  const rows = await k('attendance').where({ classroom_id: classId, period: 0 }).whereBetween('date', [start, end]);
  const periodic = settings.get('attendance_mode') === 'periodic';
  const rows2 = periodic ? await k('attendance').where({ classroom_id: classId }).where('period', '>', 0).whereBetween('date', [start, end]) : [];
  const map = {}; for (const r of [...rows, ...rows2]) { const key = r.student_id + '|' + r.date; if (!map[key] || r.status === 'absent') map[key] = r.status; }
  const wd = settings.weekDays(); const days = [];
  for (let d = 1; d <= length; d++) { const iso = J.jToIso(jy, jm, d); if (wd.includes(J.dow(iso)) && iso <= J.todayISO()) days.push({ d, iso }); }
  const stats = {}; for (const s of students) { const o = { present: 0, absent: 0, late: 0, excused: 0, leave: 0 }; for (const day of days) { const st = map[s.id + '|' + day.iso]; if (st) o[st]++; } stats[s.id] = o; }
  return { students, days, map, stats };
}

router.get('/attendance/report', staff, async (req, res, next) => {
  try {
    const classes = await accessibleClasses(req); const classId = Number(req.query.class_id) || (classes[0] && classes[0].id);
    const cls = classes.find((c) => c.id === classId); const t = J.isoToJ(J.todayISO());
    const jy = Number(req.query.year) || t.jy; const jm = Math.min(12, Math.max(1, Number(req.query.month) || t.jm));
    const data = { title: 'گزارش حضور و غیاب', classes, cls, jy, jm, threshold: settings.num('absence_alert_threshold'), STATUSES };
    if (cls) Object.assign(data, await monthData(req, cls.id, jy, jm));
    if (cls && req.query.format === 'csv') {
      const head = ['شماره', 'نام', ...data.days.map((d) => String(d.d)), 'حاضر', 'غایب', 'تأخیر', 'موجه', 'مرخصی'];
      const rows = data.students.map((s) => [s.student_code, `${s.first_name} ${s.last_name}`, ...data.days.map((d) => L.attendanceShort[data.map[s.id + '|' + d.iso]] || ''), data.stats[s.id].present, data.stats[s.id].absent, data.stats[s.id].late, data.stats[s.id].excused, data.stats[s.id].leave]);
      return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="attendance-${cls.id}-${jy}-${jm}.csv"`).send(toCSV(head, rows));
    }
    res.view('attendance/report', data);
  } catch (e) { next(e); }
});

router.get('/attendance/absentees', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const date = parseDate(req.query.date) || J.todayISO(); const ids = await svc.accessibleClassIds(req.user);
    const q = k('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classrooms as c', 'c.id', 'a.classroom_id').where('a.date', date).whereIn('a.status', ['absent', 'late']).orderBy('c.name').orderBy('a.status').orderBy('s.last_name').select('a.status', 'a.note', 's.id', 's.first_name', 's.last_name', 's.father_phone', 's.mother_phone', 's.guardian_phone', 'c.name as class_name');
    if (ids) q.whereIn('a.classroom_id', ids.length ? ids : [0]);
    res.view('attendance/absentees', { title: 'غایبین روز', date, rows: await q });
  } catch (e) { next(e); }
});

/** گزارش تأخیرها: رتبه‌بندی دانش‌آموزان، توزیع روز هفته و جزئیات */
router.get('/attendance/late', staff, async (req, res, next) => {
  try {
    const k = db.get(); const ids = await svc.accessibleClassIds(req.user);
    const to = parseDate(req.query.to) || J.todayISO(); const from = parseDate(req.query.from) || J.addDays(to, -30);
    const classId = Number(req.query.class_id) || null;
    const base = () => { const q = k('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classrooms as c', 'c.id', 'a.classroom_id').where('a.status', 'late').whereBetween('a.date', [from, to]); if (ids) q.whereIn('a.classroom_id', ids.length ? ids : [0]); if (classId) q.where('a.classroom_id', classId); return q; };
    const ranking = await base().groupBy('s.id', 's.first_name', 's.last_name', 'c.name').select('s.id', 's.first_name', 's.last_name', 'c.name as class_name').count({ n: '*' }).orderBy('n', 'desc').limit(30);
    const all = await base().select('a.date', 'a.arrival_time', 'a.student_id');
    const byDow = [0, 0, 0, 0, 0, 0, 0]; for (const r of all) byDow[J.dow(r.date)]++;
    const timed = all.filter((r) => r.arrival_time); const avgMin = timed.length ? Math.round(timed.reduce((a, r) => a + Math.max(0, rules.toMin(r.arrival_time) - rules.toMin(settings.get('school_start_time') || '07:30')), 0) / timed.length) : null;
    const classes = await accessibleClasses(req);
    if (req.query.format === 'csv') return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="late-report.csv"').send(toCSV(['نام', 'کلاس', 'تعداد تأخیر'], ranking.map((r) => [`${r.first_name} ${r.last_name}`, r.class_name, r.n])));
    res.view('attendance/late', { title: 'گزارش تأخیرها', from, to, classId, classes, ranking, byDow, total: all.length, avgMin });
  } catch (e) { next(e); }
});

/** ثبت ورود با اسکن QR/بارکد کارت دانش‌آموزی (دستگاه اسکنر USB مثل صفحه‌کلید عمل می‌کند) */
const gateRoles = requireRole('admin', 'deputy');
router.get('/attendance/gate', gateRoles, async (req, res, next) => {
  try {
    const k = db.get(); const today = J.todayISO();
    const recent = await k('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classrooms as c', 'c.id', 'a.classroom_id').where('a.date', today).whereNotNull('a.arrival_time').orderBy('a.arrival_time', 'desc').limit(15).select('a.arrival_time', 'a.status', 's.first_name', 's.last_name', 'c.name as class_name');
    const count = Number((await k('attendance').where({ date: today }).whereNotNull('arrival_time').count({ c: '*' }).first()).c);
    res.view('attendance/gate', { title: 'ثبت ورود با QR', recent, count, startTime: settings.get('school_start_time'), grace: settings.num('late_after_minutes') });
  } catch (e) { next(e); }
});
router.post('/attendance/gate', gateRoles, async (req, res, next) => {
  const wantsJson = /json/.test(req.get('accept') || '');
  const reply = (code, body) => (wantsJson ? res.status(code).json(body) : (req.flash(body.ok ? 'success' : 'error', body.message), res.redirect('/attendance/gate')));
  try {
    const k = db.get(); const code = qr.parse(req.body.code);
    if (!code) return reply(400, { ok: false, message: 'کد خوانده‌شده معتبر نیست.' });
    const s = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.student_code', code).select('s.*', 'c.name as class_name').first();
    if (!s || s.status !== 'active' || !s.classroom_id) return reply(404, { ok: false, message: 'دانش‌آموز فعالِ دارای کلاس با این کد یافت نشد.' });
    const date = J.todayISO(); const hm = J.nowHM(); const periodic = settings.get('attendance_mode') === 'periodic'; const period = periodic ? 1 : 0;
    if (!settings.weekDays().includes(J.dow(date))) return reply(409, { ok: false, message: 'امروز روز تعطیل مدرسه است.' });
    const old = await k('attendance').where({ student_id: s.id, date, period }).first();
    if (old && old.arrival_time) return reply(200, { ok: true, duplicate: true, message: `${s.first_name} ${s.last_name}: ورود قبلاً در ساعت ${old.arrival_time} ثبت شده است.`, student: `${s.first_name} ${s.last_name}`, class: s.class_name, status: old.status, time: old.arrival_time });
    const status = rules.arrivalStatus(hm);
    if (old) await k('attendance').where({ id: old.id }).update({ status: old.status === 'excused' || old.status === 'leave' ? old.status : status, arrival_time: hm, recorded_by: req.user.id, updated_at: svc.nowStr() });
    else await k('attendance').insert({ student_id: s.id, classroom_id: s.classroom_id, date, period, status, arrival_time: hm, recorded_by: req.user.id });
    if (status === 'late') await sms.notifyParents([s], (x) => sms.render('اولیای گرامی، {student} امروز ساعت {time} وارد مدرسه شد (تأخیر). {school}', { student: `${x.first_name} ${x.last_name}`, time: hm }), 'late', req.user.id);
    return reply(200, { ok: true, message: `${s.first_name} ${s.last_name} — ${status === 'late' ? 'ورود با تأخیر' : 'ورود به‌موقع'} (${hm})`, student: `${s.first_name} ${s.last_name}`, class: s.class_name, status, time: hm });
  } catch (e) { next(e); }
});

router.get('/attendance/my', requireRole('student'), async (req, res, next) => {
  try {
    const k = db.get(); const s = req.user.student; if (!s) return res.redirect('/');
    const t = J.isoToJ(J.todayISO()); const jy = Number(req.query.year) || t.jy; const jm = Math.min(12, Math.max(1, Number(req.query.month) || t.jm));
    const { start, end } = J.monthRange(jy, jm);
    const rows = await k('attendance').where({ student_id: s.id }).whereBetween('date', [start, end]).orderBy('date', 'desc');
    const tot = await k('attendance').where({ student_id: s.id }).groupBy('status').select('status').count({ c: '*' });
    const totals = Object.fromEntries(tot.map((x) => [x.status, Number(x.c)])); const all = Object.values(totals).reduce((a, b) => a + b, 0);
    const justified = modules.isEnabled('tickets') ? (await k('tickets').where({ created_by: req.user.id, category: 'absence' }).select('related_date', 'id', 'justified')).reduce((m, x) => { m[x.related_date] = x; return m; }, {}) : {};
    res.view('attendance/my', { title: 'حضور و غیاب من', rows, jy, jm, totals, rate: all ? Math.round(((totals.present || 0) + (totals.late || 0)) * 100 / all) : null, justified });
  } catch (e) { next(e); }
});
module.exports = router;

'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const bell = require('../lib/bell');
const tt = require('../lib/timetableTools');
const cal = require('../lib/calendar');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/timetable', modules.guard('timetable'));

async function classList(req) {
  const ids = await svc.accessibleClassIds(req.user);
  const q = db.get()('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name', 'grade_level'); if (ids) q.whereIn('id', ids.length ? ids : [0]); return q;
}
const cellQuery = (k) => k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
  .select('tt.*', 's.name as subject_name', 'c.name as class_name', 'c.grade_level', 'u.full_name as teacher_name', 'cs.teacher_id', 'cs.max_per_day');

/** شبکه‌ی زنگ‌ها برای یک پایه: slots[day][n] = {start,end} یا undefined (آن روز چنین زنگی ندارد) */
function buildGrid(days, grade) {
  const slots = {}; for (const d of days) { const m = {}; for (const p of bell.periodsFor({ day: d, grade })) m[p.n] = p; slots[d] = m; }
  return { max: bell.maxPeriods(), slots, def: bell.defaultPeriods() };
}
/** ادغام زنگ‌های پیوسته‌ی یک درس/معلم در یک روز: span[d-n] = تعداد؛ skip[d-n] = پوشیده‌شده */
function mergeCells(cells, days, max, keyFn) {
  const span = {}; const skip = {};
  for (const d of days) for (let n = 1; n <= max; n++) {
    const c = cells[`${d}-${n}`]; if (!c || skip[`${d}-${n}`]) continue;
    let len = 1; while (n + len <= max && cells[`${d}-${n + len}`] && keyFn(cells[`${d}-${n + len}`]) === keyFn(c)) { skip[`${d}-${n + len}`] = true; len++; }
    span[`${d}-${n}`] = len;
  }
  return { span, skip };
}

router.get('/timetable', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const days = settings.weekDays();
    const data = { title: 'برنامه هفتگی', days, mode: 'class', cells: {}, edit: false, WEEKDAYS: J.WEEKDAYS, subject: '', classes: [], hours: [], placed: {}, options: [], span: {}, skip: {}, grid: buildGrid(days, null), versionInfo: null, daySummary: null, editData: null, cls: null, dateStr: '', teacherId: null, versions: [], hiddenRows: 0, weekTotal: 0, subs: [] };
    const finish = () => { const keyFn = data.mode === 'teacher' ? (c) => `${c.class_subject_id}` : (c) => `${c.class_subject_id}`; const m = data.versionInfo && !data.versionInfo.current ? mergeCells(data.cells, days, data.grid.max, keyFn) : mergeCells(data.cells, days, data.grid.max, keyFn); if (!data.edit) { data.span = m.span; data.skip = m.skip; } return res.view('timetable/index', data); };
    const teacherView = async (tid, name) => {
      data.mode = 'teacher'; data.subject = name; data.teacherId = tid;
      const rows = await cellQuery(k).where('cs.teacher_id', tid || 0); rows.forEach((r) => { data.cells[r.day + '-' + r.period] = r; });
      // خلاصه‌ی هر روز: جمع زنگ‌ها، تعداد هر کلاس، زنگ‌های پیوسته، زنگ‌های خالی
      data.daySummary = days.map((d) => {
        const list = rows.filter((r) => r.day === d).sort((a, b) => a.period - b.period); const by = {};
        for (const r of list) by[r.class_name] = (by[r.class_name] || 0) + 1;
        const avail = Math.max(0, ...rows.map(() => 0), bell.maxPeriods() && (bell.periodsFor({ day: d }).length));
        return { day: d, total: list.length, classes: Object.entries(by).map(([name, n]) => ({ name, n })), free: Math.max(0, avail - list.length) };
      });
      data.weekTotal = rows.length;
    };
    if (u.role === 'teacher' && req.query.mode !== 'class' && !req.query.class_id) {
      await teacherView(u.teacher ? u.teacher.id : 0, u.full_name); data.classes = await classList(req);
      data.subs = await k('substitutions as s').join('classrooms as c', 'c.id', 's.classroom_id').where('s.substitute_teacher_id', u.teacher ? u.teacher.id : 0).where('s.date', '>=', J.todayISO()).orderBy('s.date').orderBy('s.period').select('s.date', 's.period', 'c.name as class_name');
      return finish();
    }
    if (isManager(u) && req.query.teacher_id) {
      const t = await k('teachers as t').join('users as x', 'x.id', 't.user_id').where('t.id', req.query.teacher_id).first('t.id', 'x.full_name');
      await teacherView(t ? t.id : null, t ? t.full_name : ''); return finish();
    }
    data.classes = await classList(req);
    const cid = u.role === 'student' ? (u.student && u.student.classroom_id) : (Number(req.query.class_id) || (data.classes[0] && data.classes[0].id));
    data.cls = u.role === 'student' ? await k('classrooms').where({ id: cid }).first() : data.classes.find((c) => c.id === cid);
    if (data.cls) {
      data.grid = buildGrid(days, data.cls.grade_level);
      const date = req.query.date ? J.parseJalali(req.query.date) : null;
      data.versions = await tt.versions(k, data.cls.id); data.dateStr = date ? J.isoToJString(date) : '';
      const ver = date ? await tt.rowsAt(k, data.cls.id, date) : { current: true };
      data.versionInfo = date ? { ...ver, date } : null;
      if (date && !ver.current) {
        ver.rows.forEach((r) => { data.cells[r.day + '-' + r.period] = { ...r, subject_name: r.subject_name, teacher_name: r.teacher_name, class_name: data.cls.name }; });
        data.subject = data.cls.name; return finish();
      }
      const rows = await cellQuery(k).where('tt.classroom_id', data.cls.id); rows.forEach((r) => { data.cells[r.day + '-' + r.period] = r; });
      data.subject = data.cls.name;
      data.hours = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.classroom_id', data.cls.id).select('cs.id', 's.name', 'cs.weekly_hours', 'cs.max_per_day');
      // فقط خانه‌های معتبرِ امروز شمرده می‌شوند (خانه‌ی خارج از زنگ‌ها/روزها شمرده نمی‌شود)
      data.placed = {}; rows.filter((r) => days.includes(r.day) && data.grid.slots[r.day] && data.grid.slots[r.day][r.period]).forEach((r) => { data.placed[r.class_subject_id] = (data.placed[r.class_subject_id] || 0) + 1; });
      data.hiddenRows = rows.length - Object.values(data.placed).reduce((a, b) => a + b, 0);
      if (isManager(u) && req.query.edit === '1') {
        data.edit = true;
        data.options = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as x', 'x.id', 't.user_id').where('cs.classroom_id', data.cls.id).orderBy('s.name').select('cs.id', 's.name', 'x.full_name as teacher', 'cs.teacher_id', 'cs.weekly_hours', 'cs.max_per_day');
        // داده‌ی تشخیص تداخل لحظه‌ای در مرورگر: ساعت‌های درگیر هر معلم در کلاس‌های دیگر + ساعت‌های غیرمجاز
        const others = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').whereNot('tt.classroom_id', data.cls.id).whereNotNull('cs.teacher_id').select('cs.teacher_id', 'tt.day', 'tt.period', 'c.name');
        const busy = {}; for (const r of others) (busy[r.teacher_id] = busy[r.teacher_id] || {})[`${r.day}-${r.period}`] = r.name;
        const unav = {}; for (const r of await k('teacher_unavailability')) (unav[r.teacher_id] = unav[r.teacher_id] || []).push(`${r.day}-${r.period}`);
        const leaves = await k('teacher_leaves').where({ status: 'approved' }).where('end_date', '>=', J.todayISO()).select('teacher_id', 'start_date', 'end_date');
        data.editData = { subjects: Object.fromEntries(data.options.map((o) => [o.id, { name: o.name, teacher: o.teacher || '', teacherId: o.teacher_id || 0, hours: o.weekly_hours, max: o.max_per_day }])), busy, unav, days, periods: data.grid.max, valid: Object.fromEntries(days.map((d) => [d, Object.keys(data.grid.slots[d]).map(Number)])), weekdays: J.WEEKDAYS, leaves: leaves.length };
      }
    }
    return finish();
  } catch (e) { next(e); }
});

router.post('/timetable', requireRole('admin', 'deputy'), async (req, res, next) => {
  try {
    const k = db.get(); const cid = Number(req.body.class_id); const cls = await k('classrooms').where({ id: cid }).first();
    if (!cls) { req.flash('error', 'کلاس نامعتبر است.'); return res.redirect('/timetable'); }
    const cs = await k('class_subjects').where({ classroom_id: cid }).select('id', 'teacher_id', 'max_per_day', 'subject_id'); const csMap = Object.fromEntries(cs.map((c) => [String(c.id), c]));
    const subjName = Object.fromEntries((await k('subjects').select('id', 'name')).map((x) => [x.id, x.name]));
    const days = settings.weekDays(); const cell = req.body.cell || {}; const rows = []; const errors = [];
    for (const d of days) for (const p of bell.periodsFor({ day: d, grade: cls.grade_level })) {
      const v = cell[`${d}-${p.n}`]; if (!v) continue;
      if (!csMap[v]) { errors.push('درس انتخاب‌شده متعلق به این کلاس نیست.'); continue; }
      rows.push({ classroom_id: cid, day: d, period: p.n, class_subject_id: Number(v), _t: csMap[v].teacher_id });
    }
    for (const key of Object.keys(cell)) { // خانه‌ی ارسالی برای زنگ/روزی که در ساعت‌های زنگ این پایه وجود ندارد
      if (!cell[key]) continue; const [d, n] = key.split('-').map(Number);
      if (!rows.some((r) => r.day === d && r.period === n)) errors.push(`${J.WEEKDAYS[d] || 'روز نامعتبر'} زنگ ${n}: در ساعت زنگ‌های این پایه تعریف نشده است.`);
    }
    // سقف ساعت یک درس در روز
    const perDay = {}; for (const r of rows) { const key = `${r.class_subject_id}|${r.day}`; perDay[key] = (perDay[key] || 0) + 1; }
    for (const [key, n] of Object.entries(perDay)) { const [csId, d] = key.split('|'); const c = csMap[csId]; if (c && c.max_per_day > 0 && n > c.max_per_day) errors.push(`«${subjName[c.subject_id]}» در ${J.WEEKDAYS[d]} ${n} ساعت چیده شده؛ سقف مجاز ${c.max_per_day} ساعت در روز است (در صفحه‌ی کلاس قابل تغییر است).`); }
    const unav = await k('teacher_unavailability').select('teacher_id', 'day', 'period');
    for (const r of rows) {
      if (!r._t) continue;
      if (unav.some((u) => u.teacher_id === r._t && u.day === r.day && u.period === r.period)) errors.push(`معلم این درس در ${J.WEEKDAYS[r.day]} زنگ ${r.period} حضور ندارد (ساعت غیرمجاز).`);
      const clash = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where({ 'cs.teacher_id': r._t, 'tt.day': r.day, 'tt.period': r.period }).whereNot('tt.classroom_id', cid).first('c.name');
      if (clash) errors.push(`تداخل: معلم این درس در ${J.WEEKDAYS[r.day]} زنگ ${r.period} در کلاس «${clash.name}» حضور دارد.`);
    }
    if (errors.length) { req.flash('error', [...new Set(errors)].slice(0, 4).join(' | ')); return res.redirect(`/timetable?class_id=${cid}&edit=1`); }
    const out = await k.transaction((t) => tt.replaceClass(t, cid, rows.map(({ _t, ...r }) => r), { userId: req.user.id }));
    await svc.audit(req, 'update', 'timetable', cid, cls.name + (out.versioned ? ' (نسخه‌ی قبلی در تاریخچه ثبت شد)' : ''));
    req.flash('success', out.changed ? `برنامه هفتگی ذخیره شد${out.versioned ? ' و نسخه‌ی قبلی در تاریخچه‌ی برنامه نگه‌داری شد' : ''}.` : 'تغییری در برنامه ایجاد نشد.'); res.redirect('/timetable?class_id=' + cid);
  } catch (e) { next(e); }
});

/* تقویم: نمای ماهانه و نمای هفتگی (هفته‌ی جاری + هفته‌ی بعد، مخصوص دیدن تولدها) */
/** رویدادها، امتحان‌ها و (برای مدیر/معلم) تولدهای بازه‌ی [start, end] به‌صورت نقشه‌ی تاریخ → موارد */
async function calendarItems(k, u, classIds, start, end) {
  const items = {}; const add = (iso, o) => { (items[iso] = items[iso] || []).push(o); };
  const ev = k('events as t').where('t.start_date', '<=', end).where((b) => b.where('t.end_date', '>=', start).orWhere((c) => c.whereNull('t.end_date').where('t.start_date', '>=', start)));
  svc.audienceFilter(ev, u, classIds, 't', false);
    for (const e of await ev.select('t.*')) { const last = e.end_date || e.start_date; for (let d = e.start_date < start ? start : e.start_date; d <= last && d <= end; d = J.addDays(d, 1)) add(d, { t: e.title, c: e.type === 'holiday' ? 'holiday' : e.type === 'exam' ? 'exam' : '' }); }
  if (modules.isEnabled('exams')) {
    const ex = k('exam_schedule as e').join('subjects as s', 's.id', 'e.subject_id').join('classrooms as c', 'c.id', 'e.classroom_id').whereBetween('e.exam_date', [start, end]);
    if (classIds) ex.whereIn('e.classroom_id', classIds.length ? classIds : [0]);
    for (const e of await ex.select('e.exam_date', 's.name as sn', 'c.name as cn')) add(e.exam_date, { t: `امتحان ${e.sn} (${e.cn})`, c: 'exam' });
  }
  if (u.role !== 'student' && modules.isEnabled('birthdays')) {
    for (const b of await require('../lib/birthdays').between(start, end, { classIds, k })) add(b.date, { t: `🎂 ${b.name}`, c: 'bday', href: '/students/' + b.id, tip: `${b.name} — ${b.class_name || 'بدون کلاس'} — ${b.age} ساله می‌شود` });
  }
  return items;
}
router.get('/calendar', modules.guard('calendar'), async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const todayIso = J.todayISO(); const t = J.isoToJ(todayIso); const classIds = await svc.accessibleClassIds(u);
    if (req.query.view === 'week') {
      const B = require('../lib/birthdays'); const offset = Math.max(-52, Math.min(52, parseInt(req.query.w, 10) || 0));
      const ws = J.addDays(B.weekStart(todayIso), offset * 7); const we = J.addDays(ws, 13);
      const items = await calendarItems(k, u, classIds, ws, we); const hol = await cal.holidaySet(ws, we, k);
      const days = []; for (let i = 0; i < 14; i++) { const iso = J.addDays(ws, i); const j = J.isoToJ(iso); days.push({ iso, d: j.jd, m: j.jm, week: i < 7 ? 0 : 1, today: iso === todayIso, off: !settings.weekDays().includes(J.dow(iso)) || hol.has(iso), holiday: hol.get(iso) || '', items: items[iso] || [] }); }
      let bd = null;
      if (u.role !== 'student' && modules.isEnabled('birthdays')) { const o = await B.overview({ classIds, weekOf: ws, k }); bd = { thisWeek: o.thisWeek, nextWeek: o.nextWeek }; }
      return res.view('calendar/week', { title: 'تقویم هفتگی', ws, we, days, bd, offset, WEEKDAYS: J.WEEKDAYS, MONTHS: J.MONTHS, todayIso });
    }
    let jy = Number(req.query.year) || t.jy; let jm = Number(req.query.month) || t.jm; if (jm < 1) { jm = 12; jy--; } if (jm > 12) { jm = 1; jy++; }
    const { start, end, length } = J.monthRange(jy, jm);
    const items = await calendarItems(k, u, classIds, start, end);
    const hol = await cal.holidaySet(start, end, k);
    const firstDow = J.dow(start); const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= length; d++) { const iso = J.jToIso(jy, jm, d); cells.push({ d, iso, today: iso === todayIso, off: !settings.weekDays().includes(J.dow(iso)) || hol.has(iso), holiday: hol.get(iso) || '', items: items[iso] || [] }); }
    const py = jm === 1 ? jy - 1 : jy; const pm = jm === 1 ? 12 : jm - 1; const ny = jm === 12 ? jy + 1 : jy; const nm = jm === 12 ? 1 : jm + 1;
    res.view('calendar/index', { title: 'تقویم', jy, jm, cells, prev: `?year=${py}&month=${pm}`, next: `?year=${ny}&month=${nm}`, WEEKDAYS: J.WEEKDAYS, MONTHS: J.MONTHS });
  } catch (e) { next(e); }
});
module.exports = router;

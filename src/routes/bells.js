'use strict';
/** ساعت زنگ‌ها (الگوی پیش‌فرض + الگوهای ویژه روز/پایه)، نمای کل مدرسه و خروجی اکسل برنامه */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const bell = require('../lib/bell');
const tt = require('../lib/timetableTools');
const xlsx = require('../lib/xlsx');
const { L } = require('../labels');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');
router.use('/timetable', modules.guard('timetable'));

const rowsFromBody = (b) => {
  const kinds = [].concat(b.kind || []); const starts = [].concat(b.start || []); const ends = [].concat(b.end || []); const labels = [].concat(b.label || []);
  return kinds.map((kind, i) => ({ kind, start: starts[i], end: ends[i], label: labels[i] }));
};

router.get('/timetable/bells', mgr, async (req, res, next) => {
  try {
    const list = bell.all(); const k = db.get();
    const orph = await tt.orphans(k);
    res.view('timetable/bells', { title: 'ساعت زنگ‌ها', list, WEEKDAYS: J.WEEKDAYS, KINDS: bell.KINDS, orphans: orph.length });
  } catch (e) { next(e); }
});
const formView = (res, o) => res.view('timetable/bell_form', { title: o.sched && o.sched.id ? 'ویرایش الگوی زنگ' : 'الگوی زنگ جدید', WEEKDAYS: J.WEEKDAYS, KINDS: bell.KINDS, grades: L.gradeLevels, activeDays: settings.weekDays(), errors: [], orphanList: null, ...o });
router.get('/timetable/bells/new', mgr, (req, res) => formView(res, { sched: { name: '', days: [], grades: [], isDefault: false, rows: bell.fromTemplate({}) } }));
router.get('/timetable/bells/:id(\\d+)/edit', mgr, (req, res) => {
  const s = bell.all().find((x) => x.id === Number(req.params.id)); if (!s) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'الگو یافت نشد.' });
  formView(res, { sched: s });
});
router.post('/timetable/bells/save', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const id = Number(b.id) || 0; const cur = id ? bell.all().find((x) => x.id === id) : null;
    if (id && !cur) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'الگو یافت نشد.' });
    const isDefault = cur ? cur.isDefault : false; const name = String(b.name || '').trim().slice(0, 100);
    const days = isDefault ? [] : [].concat(b.days || []).map(Number).filter((d) => d >= 0 && d <= 6); const grades = isDefault ? [] : [].concat(b.grades || []).filter((g) => L.gradeLevels.includes(g));
    const v = bell.validateRows(rowsFromBody(b)); const errors = [...v.errors];
    if (!name) errors.push('نام الگو الزامی است.');
    if (!isDefault && !days.length && !grades.length) errors.push('برای الگوی ویژه حداقل یک روز یا یک پایه انتخاب کنید (وگرنه همان الگوی پیش‌فرض است).');
    const sched = { id, name, days, grades, isDefault, rows: v.rows.length ? v.rows : rowsFromBody(b).map((r, i) => ({ ...r, seq: i + 1, n: null, start: r.start || '', end: r.end || '' })) };
    if (errors.length) return formView(res, { sched, errors });
    // خانه‌های برنامه‌ی هفتگی که با این تغییر بی‌معنی می‌شوند (مثلاً زنگ ششم حذف شد)
    const cand = bell.all().filter((x) => x.id !== id).concat([{ id: id || 0, name, days, grades, isDefault, rows: v.rows }]);
    const orph = await tt.orphans(k, { countFor: (grade, day) => bell.countForIn(cand, { grade, day }) });
    if (orph.length && b.confirm_orphans !== '1') return formView(res, { sched, errors: [`با این تغییر ${orph.length} خانه از برنامه‌ی هفتگی بی‌اعتبار می‌شود (${tt.describeOrphans(orph)}).`], orphanList: orph.length });
    await k.transaction(async (t) => {
      if (orph.length) await t('timetable').whereIn('id', orph.map((o) => o.id)).del();
      await bell.saveSchedule(t, { id: id || undefined, name, days, grades, isDefault, rows: v.rows });
    });
    await bell.load(k);
    await svc.audit(req, id ? 'update' : 'create', 'bell_schedules', id || null, `${name}: ${v.rows.filter((r) => r.kind === 'class').length} زنگ${orph.length ? `، ${orph.length} خانه‌ی برنامه حذف شد` : ''}`);
    req.flash('success', orph.length ? `ساعت زنگ‌ها ذخیره شد و ${orph.length} خانه‌ی نامعتبر از برنامه حذف شد.` : 'ساعت زنگ‌ها ذخیره شد.'); res.redirect('/timetable/bells');
  } catch (e) { next(e); }
});
router.post('/timetable/bells/:id(\\d+)/delete', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const s = bell.all().find((x) => x.id === Number(req.params.id));
    if (!s || s.isDefault) { req.flash('error', 'الگوی پیش‌فرض قابل حذف نیست.'); return res.redirect('/timetable/bells'); }
    const cand = bell.all().filter((x) => x.id !== s.id); const orph = await tt.orphans(k, { countFor: (grade, day) => bell.countForIn(cand, { grade, day }) });
    if (orph.length && req.body.confirm_orphans !== '1') { req.flash('error', `با حذف این الگو ${orph.length} خانه‌ی برنامه بی‌اعتبار می‌شود (${tt.describeOrphans(orph)}). ابتدا برنامه را اصلاح کنید یا حذف را تأیید کنید.`); return res.redirect('/timetable/bells'); }
    await k.transaction(async (t) => { if (orph.length) await t('timetable').whereIn('id', orph.map((o) => o.id)).del(); await bell.deleteSchedule(t, s.id); });
    await bell.load(k); await svc.audit(req, 'delete', 'bell_schedules', s.id, s.name);
    req.flash('success', 'الگو حذف شد.'); res.redirect('/timetable/bells');
  } catch (e) { next(e); }
});
router.post('/timetable/bells/cleanup', mgr, async (req, res, next) => {
  try { const k = db.get(); const orph = await tt.orphans(k); if (orph.length) await k('timetable').whereIn('id', orph.map((o) => o.id)).del(); await svc.audit(req, 'cleanup', 'timetable', null, `${orph.length} خانه‌ی نامعتبر`); req.flash('success', `${orph.length} خانه‌ی نامعتبر پاک شد.`); res.redirect('/timetable/bells'); } catch (e) { next(e); }
});

/* ---------- نمای کل مدرسه ---------- */
async function overviewData(k, by, gradeFilter) {
  const days = settings.weekDays();
  const rows = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .where('c.status', '<>', 'archived').select('tt.classroom_id', 'tt.day', 'tt.period', 'c.name as class_name', 'c.grade_level', 's.name as subject', 'u.full_name as teacher', 'cs.teacher_id');
  const groups = {};
  if (by === 'teacher') {
    const ts = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name');
    for (const t of ts) groups[t.id] = { title: t.full_name, cells: {}, total: 0 };
    for (const r of rows) if (r.teacher_id && groups[r.teacher_id]) { groups[r.teacher_id].cells[`${r.day}-${r.period}`] = { a: r.subject, b: r.class_name }; groups[r.teacher_id].total++; }
  } else {
    const cs = await k('classrooms').where('status', '<>', 'archived').orderBy('grade_level').orderBy('name').select('id', 'name', 'grade_level');
    for (const c of cs) if (!gradeFilter || c.grade_level === gradeFilter) groups[c.id] = { title: c.name, grade: c.grade_level, cells: {}, total: 0 };
    for (const r of rows) if (groups[r.classroom_id]) { groups[r.classroom_id].cells[`${r.day}-${r.period}`] = { a: r.subject, b: r.teacher || '' }; groups[r.classroom_id].total++; }
  }
  return { days, groups: Object.values(groups), max: bell.maxPeriods(), def: bell.defaultPeriods() };
}
router.get('/timetable/overview', mgr, async (req, res, next) => {
  try {
    const by = req.query.by === 'teacher' ? 'teacher' : 'class'; const grade = L.gradeLevels.includes(req.query.grade) ? req.query.grade : '';
    const d = await overviewData(db.get(), by, grade);
    res.view('timetable/overview', { title: 'نمای کل مدرسه', by, grade, grades: L.gradeLevels, WEEKDAYS: J.WEEKDAYS, ...d });
  } catch (e) { next(e); }
});

/* ---------- خروجی اکسل ---------- */
router.get('/timetable/export.xlsx', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const days = settings.weekDays(); const max = bell.maxPeriods();
    const grid = (cells) => { const head = ['زنگ', ...days.map((d) => J.WEEKDAYS[d])]; const rows = [head]; for (let n = 1; n <= max; n++) { const def = bell.defaultPeriods().find((x) => x.n === n); rows.push([`${n}${def ? ` (${def.start}-${def.end})` : ''}`, ...days.map((d) => { const c = cells[`${d}-${n}`]; return c ? `${c.a}${c.b ? ' — ' + c.b : ''}` : ''; })]); } return rows; };
    const safe = (n) => String(n).replace(/[\\/?*[\]:]/g, ' ').slice(0, 30);
    const send = (name, sheets) => xlsx.send(res, name, sheets);
    if (req.query.all === '1') {
      if (!isManager(u)) return res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'فقط مدیر/معاون.' });
      const by = req.query.by === 'teacher' ? 'teacher' : 'class'; const d = await overviewData(k, by, '');
      return send(`timetable-${by}.xlsx`, d.groups.map((g, i) => ({ name: safe(`${i + 1}-${g.title}`), rows: grid(g.cells) })));
    }
    const o = await overviewData(k, req.query.by === 'teacher' ? 'teacher' : 'class', '');
    let g;
    if (req.query.by === 'teacher') {
      const tid = u.role === 'teacher' ? (u.teacher && u.teacher.id) : Number(req.query.teacher_id); if (u.role === 'student') return res.status(403).end();
      const t = await k('teachers as t').join('users as x', 'x.id', 't.user_id').where('t.id', tid || 0).first('x.full_name'); if (!t) return res.status(404).end();
      g = o.groups.find((x) => x.title === t.full_name);
    } else {
      const ids = await svc.accessibleClassIds(u); const cid = u.role === 'student' ? (u.student && u.student.classroom_id) : Number(req.query.class_id);
      if (ids && !ids.includes(cid)) return res.status(403).end();
      const c = await k('classrooms').where({ id: cid || 0 }).first(); if (!c) return res.status(404).end();
      g = o.groups.find((x) => x.title === c.name);
    }
    if (!g) return res.status(404).end();
    send('timetable.xlsx', [{ name: safe(g.title), rows: grid(g.cells) }]);
  } catch (e) { next(e); }
});
module.exports = router;

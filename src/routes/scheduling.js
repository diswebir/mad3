'use strict';
/** ساعت‌های غیرمجاز معلم، تولید خودکار برنامه‌ی هفتگی و جانشین‌یابی معلم غایب */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const settings = require('../settings');
const modules = require('../modules');
const J = require('../utils/jalali');
const sched = require('../lib/scheduler');
const bell = require('../lib/bell');
const tt = require('../lib/timetableTools');
const cal = require('../lib/calendar');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');
router.use('/timetable', modules.guard('timetable'));

const teacherList = (k) => k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name', 'u.id as user_id');

/* ---------- ساعت‌های غیرمجاز معلم ---------- */
router.get('/timetable/availability', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const own = req.user.role === 'teacher';
    const teachers = own ? [] : await teacherList(k);
    const tid = own ? (req.user.teacher && req.user.teacher.id) : (Number(req.query.teacher_id) || (teachers[0] && teachers[0].id));
    const off = tid ? new Set((await k('teacher_unavailability').where({ teacher_id: tid })).map((r) => `${r.day}-${r.period}`)) : new Set();
    res.view('timetable/availability', { title: 'ساعت‌های غیرمجاز معلمان', teachers, tid, off, periods: bell.defaultPeriods().concat(bell.maxPeriods() > bell.defaultPeriods().length ? Array.from({ length: bell.maxPeriods() - bell.defaultPeriods().length }, (_, i) => ({ n: bell.defaultPeriods().length + i + 1, start: '', end: '' })) : []), days: settings.weekDays(), WEEKDAYS: J.WEEKDAYS, readOnly: own });
  } catch (e) { next(e); }
});
router.post('/timetable/availability', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const tid = Number(req.body.teacher_id); const t = await k('teachers').where({ id: tid }).first();
    if (!t) { req.flash('error', 'معلم نامعتبر است.'); return res.redirect('/timetable/availability'); }
    const valid = new Set(); for (const d of settings.weekDays()) for (const p of Array.from({ length: bell.maxPeriods() }, (_, i) => ({ n: i + 1 }))) valid.add(`${d}-${p.n}`);
    const off = [].concat(req.body.off || []).filter((x) => valid.has(x));
    // اگر معلم در خانه‌ای برنامه دارد نمی‌توان آن را غیرمجاز کرد
    const busy = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where('cs.teacher_id', tid).select('tt.day', 'tt.period', 'c.name');
    const clash = busy.filter((b) => off.includes(`${b.day}-${b.period}`));
    if (clash.length) { req.flash('error', `معلم در این ساعت‌ها برنامه دارد: ${clash.slice(0, 3).map((c) => `${J.WEEKDAYS[c.day]} زنگ ${c.period} (${c.name})`).join('، ')}. ابتدا برنامه را اصلاح کنید.`); return res.redirect('/timetable/availability?teacher_id=' + tid); }
    await k.transaction(async (tr) => { await tr('teacher_unavailability').where({ teacher_id: tid }).del(); if (off.length) await tr('teacher_unavailability').insert(off.map((x) => { const [d, p] = x.split('-').map(Number); return { teacher_id: tid, day: d, period: p }; })); });
    await svc.audit(req, 'update', 'teacher_unavailability', tid, `${off.length} ساعت`);
    req.flash('success', 'ساعت‌های غیرمجاز ذخیره شد.'); res.redirect('/timetable/availability?teacher_id=' + tid);
  } catch (e) { next(e); }
});

/* ---------- تولید خودکار ---------- */
async function buildInput(k, scopeClassId) {
  const days = settings.weekDays(); const periods = Array.from({ length: bell.maxPeriods() }, (_, i) => i + 1);
  const allClasses = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name', 'grade_level');
  const inScope = scopeClassId ? allClasses.filter((c) => c.id === scopeClassId) : allClasses;
  const scopeIds = inScope.map((c) => c.id);
  const cs = await k('class_subjects').whereIn('classroom_id', scopeIds.length ? scopeIds : [0]).select('id', 'classroom_id', 'teacher_id', 'weekly_hours', 'subject_id', 'max_per_day');
  const classes = inScope.map((c) => ({ id: c.id, name: c.name, items: cs.filter((x) => x.classroom_id === c.id && x.weekly_hours > 0).map((x) => ({ csId: x.id, teacherId: x.teacher_id || null, hours: x.weekly_hours, maxPerDay: x.max_per_day || 2 })) }));
  const fixedRows = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').whereNotIn('tt.classroom_id', scopeIds.length ? scopeIds : [0]).select('tt.classroom_id', 'tt.day', 'tt.period', 'tt.class_subject_id', 'cs.teacher_id');
  const fixed = fixedRows.map((r) => ({ classId: r.classroom_id, day: r.day, period: r.period, csId: r.class_subject_id, teacherId: r.teacher_id || null }));
  const unavailable = {}; for (const r of await k('teacher_unavailability')) (unavailable[r.teacher_id] = unavailable[r.teacher_id] || []).push(`${r.day}-${r.period}`);
  const grade = Object.fromEntries(allClasses.map((c) => [c.id, c.grade_level]));
  const isOpen = (cid, d, p) => p <= bell.countFor({ day: d, grade: grade[cid] });
  return { days, periods, classes, fixed, unavailable, allClasses, isOpen };
}
router.get('/timetable/auto', mgr, async (req, res, next) => {
  try { const k = db.get(); res.view('timetable/auto', { title: 'تولید خودکار برنامه', classes: await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name'), result: null, f: {} }); } catch (e) { next(e); }
});
router.post('/timetable/auto', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const scope = b.scope === 'class' ? Number(b.class_id) || 0 : 0;
    if (b.scope === 'class' && !scope) { req.flash('error', 'کلاس را انتخاب کنید.'); return res.redirect('/timetable/auto'); }
    const seed = Math.max(1, parseInt(b.seed, 10) || 1);
    const inp = await buildInput(k, scope);
    if (!inp.classes.some((c) => c.items.length)) { req.flash('error', 'درسی با ساعت هفتگی برای چیدن وجود ندارد؛ ابتدا دروس کلاس‌ها را تعریف کنید.'); return res.redirect('/timetable/auto'); }
    const r = sched.generate({ days: inp.days, periods: inp.periods, classes: inp.classes, fixed: inp.fixed, unavailable: inp.unavailable, seed, attempts: 120, isOpen: inp.isOpen });
    const errors = sched.validate(r.placements, inp.fixed, inp.unavailable);
    if (errors.length) throw new Error('خطای داخلی مولد برنامه: ' + errors[0]); // نباید رخ دهد؛ برنامه‌ی ناسازگار هرگز ذخیره نمی‌شود
    if (b.phase === 'apply') {
      await k.transaction(async (t) => {
        const ids = inp.classes.map((c) => c.id);
        for (const cid of ids) await tt.replaceClass(t, cid, r.placements.filter((p) => p.classId === cid).map((p) => ({ day: p.day, period: p.period, class_subject_id: p.csId })), { userId: req.user.id });
      });
      await svc.audit(req, 'auto_generate', 'timetable', scope || null, `${r.placements.length} خانه، ${r.unplaced.length} چیده‌نشده (seed ${seed})`);
      req.flash(r.unplaced.length ? 'info' : 'success', `برنامه ذخیره شد: ${r.placements.length} ساعت چیده شد${r.unplaced.length ? ` و ${r.unplaced.length} ساعت جا نشد` : ''}.`);
      return res.redirect('/timetable' + (scope ? '?class_id=' + scope : ''));
    }
    const names = Object.fromEntries(inp.allClasses.map((c) => [c.id, c.name]));
    const csInfo = Object.fromEntries((await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('cs.id', 's.name as subject', 'u.full_name as teacher')).map((x) => [x.id, x]));
    const unplaced = {}; for (const u of r.unplaced) { const key = u.classId + '|' + u.csId; unplaced[key] = unplaced[key] || { ...u, n: 0 }; unplaced[key].n++; }
    res.view('timetable/auto', { title: 'تولید خودکار برنامه', classes: inp.allClasses, f: b, result: { placed: r.placements.length, unplaced: Object.values(unplaced).map((u) => ({ cls: names[u.classId], subject: csInfo[u.csId] && csInfo[u.csId].subject, teacher: csInfo[u.csId] && csInfo[u.csId].teacher, n: u.n })), seed, total: r.placements.length + r.unplaced.length, existing: inp.fixed.length } });
  } catch (e) { next(e); }
});

/* ---------- جانشین‌یابی ---------- */
async function substituteData(k, date) {
  const dow = J.dow(date);
  const slots = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classrooms as c', 'c.id', 'tt.classroom_id').where('tt.day', dow).where('c.status', '<>', 'archived').whereNotNull('cs.teacher_id')
    .select('tt.classroom_id', 'tt.period', 'tt.class_subject_id', 'cs.teacher_id', 's.name as subject', 'c.name as class_name');
  const subs = await k('substitutions').where({ date });
  const unav = await k('teacher_unavailability').where({ day: dow });
  const leaves = await k('teacher_leaves').where({ status: 'approved' }).where('start_date', '<=', date).where('end_date', '>=', date).select('teacher_id', 'kind');
  const teachers = await teacherList(k);
  const busy = {}; // teacherId → Set(period): تدریس عادی (به‌جز اگر خودش جایگزین شده) یا جانشینی
  const subKey = (cid, p) => `${cid}-${p}`; const subMap = Object.fromEntries(subs.map((s) => [subKey(s.classroom_id, s.period), s]));
  for (const sl of slots) { const sub = subMap[subKey(sl.classroom_id, sl.period)]; if (!sub) (busy[sl.teacher_id] = busy[sl.teacher_id] || new Set()).add(sl.period); }
  for (const s of subs) (busy[s.substitute_teacher_id] = busy[s.substitute_teacher_id] || new Set()).add(s.period);
  for (const u of unav) (busy[u.teacher_id] = busy[u.teacher_id] || new Set()).add(u.period);
  const onLeave = new Set(leaves.map((l) => l.teacher_id));
  return { slots, subs, subMap, teachers, busy, onLeave, leaves };
}
const freeFor = (d, period, excludeId) => d.teachers.filter((t) => t.id !== excludeId && !d.onLeave.has(t.id) && !(d.busy[t.id] && d.busy[t.id].has(period)));

router.get('/timetable/substitutes', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const date = (req.query.date && J.parseJalali(req.query.date)) || J.todayISO();
    const d = await substituteData(k, date);
    const teachersToday = d.teachers.filter((t) => d.slots.some((s) => s.teacher_id === t.id));
    const tid = Number(req.query.teacher_id) || (teachersToday.find((t) => d.onLeave.has(t.id)) || {}).id || null;
    const mine = tid ? d.slots.filter((s) => s.teacher_id === tid).sort((a, b) => a.period - b.period).map((s) => ({ ...s, current: d.subMap[`${s.classroom_id}-${s.period}`] || null, options: freeFor(d, s.period, tid) })) : [];
    const list = await k('substitutions as s').join('classrooms as c', 'c.id', 's.classroom_id').leftJoin('teachers as a', 'a.id', 's.absent_teacher_id').leftJoin('users as au', 'au.id', 'a.user_id').join('teachers as t', 't.id', 's.substitute_teacher_id').join('users as tu', 'tu.id', 't.user_id').where('s.date', date).orderBy('s.period').select('s.*', 'c.name as class_name', 'au.full_name as absent_name', 'tu.full_name as sub_name');
    res.view('timetable/substitutes', { title: 'جانشین‌یابی معلم', date, teachers: teachersToday, tid, mine, list, onLeave: [...d.onLeave] });
  } catch (e) { next(e); }
});
router.post('/timetable/substitutes', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const date = J.parseJalali(req.body.date); const tid = Number(req.body.teacher_id);
    if (!date) { req.flash('error', 'تاریخ نامعتبر است.'); return res.redirect('/timetable/substitutes'); }
    const d = await substituteData(k, date); const choice = req.body.sub || {}; let n = 0; const notify = []; const errors = [];
    await k.transaction(async (t) => {
      for (const s of d.slots.filter((x) => x.teacher_id === tid)) {
        const key = `${s.classroom_id}-${s.period}`; const v = Number(choice[key]) || 0; const cur = d.subMap[key];
        if (!v) { if (cur) { await t('substitutions').where({ id: cur.id }).del(); n++; } continue; }
        if (cur && cur.substitute_teacher_id === v) continue;
        // جانشین باید همان زنگ آزاد باشد (در محاسبه‌ی busy همین ردیفِ قبلی را نادیده می‌گیریم)
        const ok = freeFor({ ...d, busy: Object.fromEntries(Object.entries(d.busy).map(([a, b]) => [a, new Set([...b])])) }, s.period, tid).some((x) => x.id === v) || (cur && cur.substitute_teacher_id === v);
        if (!ok) { errors.push(`معلم انتخابی برای زنگ ${s.period} آزاد نیست.`); continue; }
        if (cur) await t('substitutions').where({ id: cur.id }).del();
        await t('substitutions').insert({ date, classroom_id: s.classroom_id, period: s.period, class_subject_id: s.class_subject_id, absent_teacher_id: tid, substitute_teacher_id: v, note: (req.body.note || '').slice(0, 200) || null, created_by: req.user.id });
        d.busy[v] = d.busy[v] || new Set(); d.busy[v].add(s.period); n++;
        notify.push({ teacherId: v, text: `جانشین زنگ ${s.period} کلاس ${s.class_name} (${s.subject}) در ${J.isoToJString(date)}` });
      }
    });
    for (const x of notify) { const tt = await k('teachers').where({ id: x.teacherId }).first('user_id'); if (tt) await svc.notify(tt.user_id, 'جانشینی تدریس', x.text, '/timetable', 'warn'); }
    await svc.audit(req, 'substitute', 'substitutions', tid, `${J.isoToJString(date)}: ${n} تغییر`);
    if (errors.length) req.flash('error', errors.join(' ')); else req.flash('success', n ? 'جانشین‌ها ذخیره شد و به معلمان اعلان رفت.' : 'تغییری انجام نشد.');
    res.redirect(`/timetable/substitutes?date=${encodeURIComponent(J.isoToJString(date))}&teacher_id=${tid}`);
  } catch (e) { next(e); }
});
module.exports = router;
module.exports.substituteData = substituteData;

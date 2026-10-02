'use strict';
/** ابزارهای برنامه‌ی هفتگی: خانه‌های یتیم، ذخیره با نسخه‌بندی (تاریخچه) و جستجوی برنامه در یک تاریخ */
const bell = require('./bell');
const J = require('../utils/jalali');
const settings = require('../settings');
const svc = require('../services');

/** خانه‌هایی که با تنظیمات (روزها/زنگ‌ها) سازگار نیستند: روزِ خارج از هفته‌ی مدرسه یا زنگی که در الگوی آن روز/پایه وجود ندارد */
async function orphans(k, { days = settings.weekDays(), countFor = (grade, day) => bell.countFor({ grade, day }) } = {}) {
  const rows = await k('timetable as t').join('classrooms as c', 'c.id', 't.classroom_id').where('c.status', '<>', 'archived').select('t.id', 't.classroom_id', 't.day', 't.period', 'c.name as class_name', 'c.grade_level');
  return rows.filter((r) => !days.includes(r.day) || r.period > countFor(r.grade_level, r.day));
}
const describeOrphans = (list) => {
  const by = {}; for (const o of list) by[o.class_name] = (by[o.class_name] || 0) + 1;
  return Object.entries(by).slice(0, 6).map(([n, c]) => `${n}: ${c} ساعت`).join('، ') + (Object.keys(by).length > 6 ? ' و …' : '');
};

const keyOf = (r) => `${r.day}-${r.period}-${r.class_subject_id}`;
async function currentRows(k, classId) { return k('timetable').where({ classroom_id: classId }); }

/** جایگزینی برنامه‌ی یک کلاس با نسخه‌بندی. rows: [{day, period, class_subject_id}] */
async function replaceClass(t, classId, rows, { userId = null, today = J.todayISO() } = {}) {
  const old = await t('timetable as tt').leftJoin('class_subjects as cs', 'cs.id', 'tt.class_subject_id').leftJoin('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as th', 'th.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 'th.user_id')
    .where('tt.classroom_id', classId).select('tt.day', 'tt.period', 'tt.class_subject_id', 'cs.teacher_id', 's.name as subject_name', 'u.full_name as teacher_name');
  const same = old.length === rows.length && old.map(keyOf).sort().join('|') === rows.map(keyOf).sort().join('|');
  if (same) return { changed: false, versioned: false };
  let versioned = false;
  if (old.length) {
    const meta = await t('timetable_meta').where({ classroom_id: classId }).first(); const from = meta ? meta.since : null; const to = J.addDays(today, -1);
    if (!from || to >= from) {
      await t('timetable_history').insert(old.map((r) => ({ classroom_id: classId, valid_from: from, valid_to: to, day: r.day, period: r.period, class_subject_id: r.class_subject_id, teacher_id: r.teacher_id || null, subject_name: r.subject_name, teacher_name: r.teacher_name, saved_by: userId, saved_at: svc.nowStr() })));
      versioned = true;
      if (meta) await t('timetable_meta').where({ classroom_id: classId }).update({ since: today, updated_at: svc.nowStr() }); else await t('timetable_meta').insert({ classroom_id: classId, since: today, updated_at: svc.nowStr() });
    }
  }
  await t('timetable').where({ classroom_id: classId }).del();
  if (rows.length) await t('timetable').insert(rows.map((r) => ({ classroom_id: classId, day: r.day, period: r.period, class_subject_id: r.class_subject_id })));
  return { changed: true, versioned };
}

/** برنامه‌ی کلاس در یک تاریخ: { rows:[{day,period,class_subject_id,teacher_id,subject_name,teacher_name}], current:boolean, from, to } */
async function rowsAt(k, classId, date) {
  const meta = await k('timetable_meta').where({ classroom_id: classId }).first();
  if (!meta || !meta.since || !date || date >= meta.since) return { current: true, from: meta && meta.since || null, to: null };
  const rows = await k('timetable_history').where({ classroom_id: classId }).where('valid_to', '>=', date).where((b) => b.whereNull('valid_from').orWhere('valid_from', '<=', date));
  const from = rows.length ? rows[0].valid_from : null; const to = rows.length ? rows[0].valid_to : null;
  return { current: false, rows, from, to };
}
/** معلم/درس یک زنگ در تاریخ مشخص (با توجه به نسخه‌های قدیمی برنامه) */
async function slotAt(k, classId, date, period) {
  const v = await rowsAt(k, classId, date); const day = J.dow(date);
  if (v.current) return k('timetable as t').join('class_subjects as cs', 'cs.id', 't.class_subject_id').where({ 't.classroom_id': classId, 't.day': day, 't.period': period }).select('cs.teacher_id', 'cs.id as cs_id').first();
  const r = v.rows.find((x) => x.day === day && x.period === period); return r ? { teacher_id: r.teacher_id, cs_id: r.class_subject_id } : null;
}
/** فهرست نسخه‌ها (جدید → قدیم): هر نسخه بازه‌ی اعتبار و تعداد خانه */
async function versions(k, classId) {
  const meta = await k('timetable_meta').where({ classroom_id: classId }).first();
  const hist = await k('timetable_history').where({ classroom_id: classId }).select('valid_from', 'valid_to').count({ n: '*' }).groupBy('valid_from', 'valid_to').orderBy('valid_to', 'desc');
  const cur = await k('timetable').where({ classroom_id: classId }).count({ n: '*' }).first();
  return [{ current: true, from: meta ? meta.since : null, to: null, n: Number(cur.n) }, ...hist.map((h) => ({ current: false, from: h.valid_from, to: h.valid_to, n: Number(h.n) }))];
}
module.exports = { orphans, describeOrphans, replaceClass, rowsAt, slotAt, versions, currentRows };

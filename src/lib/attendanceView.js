'use strict';
/** اطلاعات نمایشی صفحه‌ی حضور و غیاب: هر زنگ کدام درس/معلم/ساعت دارد و آیا ثبت شده است */
const tt = require('./timetableTools');
const ar = require('./attendanceRules');

/**
 * خروجی: [{ n, start, end, subject, teacher, substituted, recorded, counts:{present,absent,...} }]
 * subject/teacher برای زنگ بدون برنامه خالی است.
 */
async function slots(k, cls, date, periods) {
  const rows = await k('attendance').where({ classroom_id: cls.id, date }).where('period', '>', 0).select('period', 'status');
  const by = {}; for (const r of rows) { const o = (by[r.period] = by[r.period] || { total: 0 }); o.total++; o[r.status] = (o[r.status] || 0) + 1; }
  const names = {}; const out = [];
  const nameOfTeacher = async (id) => { if (!id) return ''; if (!(id in names)) { const t = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.id', id).select('u.full_name').first(); names[id] = t ? t.full_name : ''; } return names[id]; };
  for (const p of periods) {
    const sch = await ar.scheduledTeacher(cls.id, date, p.n); const slot = await tt.slotAt(k, cls.id, date, p.n);
    let subject = '';
    if (slot && slot.cs_id) { const s = await k('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').where('cs.id', slot.cs_id).select('s.name').first(); subject = s ? s.name : ''; }
    const c = by[p.n];
    out.push({ n: p.n, start: p.start, end: p.end, subject, teacher: sch ? await nameOfTeacher(sch.teacherId) : '', substituted: !!(sch && sch.substituted), recorded: !!c, counts: c || null });
  }
  return out;
}
module.exports = { slots };

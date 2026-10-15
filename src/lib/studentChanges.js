'use strict';
/** ثبت تاریخچه‌ی تغییرات پرونده‌ی دانش‌آموز (چه‌کسی، چه‌چیز، از چه مقداری به چه مقداری) */
const IGNORE = new Set(['photo', 'updated_at', 'created_at', 'user_id']);
const norm = (v) => (v === null || v === undefined ? '' : String(v));

async function diffAndLog(k, before, after, user, extraNames = {}) {
  const rows = [];
  const classNames = {};
  const nameOf = async (id) => { if (!id) return ''; if (classNames[id] === undefined) { const c = await k('classrooms').where({ id }).first('name'); classNames[id] = c ? c.name : String(id); } return classNames[id]; };
  for (const key of Object.keys(after)) {
    if (IGNORE.has(key) || !(key in before)) continue;
    if (norm(before[key]) === norm(after[key])) continue;
    const isClass = key === 'classroom_id';
    rows.push({ student_id: before.id, field: key, old_value: (isClass ? await nameOf(before[key]) : norm(before[key])).slice(0, 500) || null, new_value: (isClass ? await nameOf(after[key]) : norm(after[key])).slice(0, 500) || null, user_id: user ? user.id : null, user_name: user ? user.full_name : null });
  }
  if (rows.length) await k('student_changes').insert(rows);
  return rows.length;
}
module.exports = { diffAndLog };

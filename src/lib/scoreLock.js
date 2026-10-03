'use strict';
/** قفل نمرات و تاریخچه‌ی تغییر نمره */
const db = require('../db');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');

const isLocked = (a) => !!a && !!Number(a.locked);

/**
 * آیا کاربر می‌تواند نمره‌ی این ارزشیابی را تغییر دهد؟
 * @returns {{ok:boolean, needReason?:boolean, reason?:string}}
 */
function gate(user, a, body = {}) {
  if (!isLocked(a)) return { ok: true };
  if (!user || (user.role !== 'admin' && user.role !== 'deputy')) return { ok: false, reason: 'نمرات این ارزشیابی قفل شده است؛ فقط مدیر/معاون می‌تواند آن را اصلاح کند.' };
  if (!String(body.reason || '').trim()) return { ok: false, needReason: true, reason: 'نمرات قفل است؛ برای اصلاح، «دلیل اصلاح» را بنویسید.' };
  return { ok: true, needReason: true };
}

/**
 * اعمال تغییرات نمره در تراکنش t و ثبت تاریخچه برای هر تغییر واقعی.
 * ops: [[studentId, value|null, note]]؛ existing: {studentId: row}
 * @returns {Promise<number>} تعداد نمره‌های تغییر کرده
 */
async function apply(t, a, ops, existing, { user, source = 'manual', reason = null } = {}) {
  const hist = []; let changed = 0;
  for (const [sid, val, note] of ops) {
    const ex = existing[sid]; const old = ex && ex.score !== null && ex.score !== undefined ? Number(ex.score) : null;
    const same = (old === null && val === null) || (old !== null && val !== null && old === Number(val));
    if (ex) { const noteChanged = note !== undefined && (ex.note || null) !== (note || null); if (!same || noteChanged) await t('scores').where({ id: ex.id }).update(note === undefined ? { score: val } : { score: val, note }); }
    else if (val !== null || note) await t('scores').insert({ assessment_id: a.id, student_id: sid, score: val, note: note || null });
    if (!same) { changed++; hist.push({ assessment_id: a.id, student_id: sid, old_value: old, new_value: val, action: val === null ? 'clear' : old === null ? 'set' : 'edit', reason: reason ? String(reason).slice(0, 250) : null, user_id: user ? user.id : null, user_name: user ? user.full_name : null, source, created_at: svc.nowStr() }); }
  }
  if (hist.length) await t('scores_history').insert(hist);
  return changed;
}

async function log(t, a, action, user, reason) {
  await t('scores_history').insert({ assessment_id: a.id, student_id: 0, old_value: null, new_value: null, action, reason: reason ? String(reason).slice(0, 250) : null, user_id: user ? user.id : null, user_name: user ? user.full_name : 'سامانه', source: 'system', created_at: svc.nowStr() });
}

/** قفل خودکار ارزشیابی‌های منتشرشده‌ی قدیمی‌تر از N روز (به‌جز آن‌هایی که مدیر قفلشان را باز کرده) */
async function autoLock(k = db.get(), today = J.todayISO()) {
  const n = settings.num('scores_autolock_days'); if (!(n > 0)) return 0;
  const cutoff = J.addDays(today, -n);
  const rows = await k('assessments').where({ published: 1, locked: 0 }).where('date', '<=', cutoff).select('id', 'title');
  if (!rows.length) return 0;
  const unlocked = new Set((await k('scores_history').where({ action: 'unlock' }).distinct('assessment_id')).map((r) => r.assessment_id));
  let c = 0;
  for (const a of rows) { if (unlocked.has(a.id)) continue; await k('assessments').where({ id: a.id }).update({ locked: 1 }); await log(k, a, 'lock', null, `قفل خودکار (بیش از ${n} روز از ارزشیابی)`); c++; }
  return c;
}
module.exports = { isLocked, gate, apply, log, autoLock };

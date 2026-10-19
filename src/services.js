'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const { invalidateBadges } = require('./middleware');

/**
 * هش رمز عبور: scrypt (کتابخانه‌ی داخلی Node، اجرای بومی در thread pool؛ حلقه‌ی رویداد را قفل نمی‌کند).
 * قالب: $s1$N$r$salt$hash. هش‌های قدیمی bcrypt ($2a/$2b) هنوز تأیید می‌شوند و با اولین ورود موفق به‌صورت خودکار ارتقا می‌یابند.
 */
const crypto0 = require('crypto'); const { promisify } = require('util'); const scryptAsync = promisify(crypto0.scrypt);
const SC = { N: 16384, r: 8, p: 1, keylen: 32 };
const sopts = (N, r) => ({ N, r, p: SC.p, maxmem: 128 * N * r * 2 });
const legacy = (h) => /^\$2[aby]\$/.test(String(h || ''));
function hash(p) { const salt = crypto0.randomBytes(16); const dk = crypto0.scryptSync(String(p), salt, SC.keylen, sopts(SC.N, SC.r)); return `$s1$${SC.N}$${SC.r}$${salt.toString('base64')}$${dk.toString('base64')}`; }
async function hashAsync(p) { const salt = crypto0.randomBytes(16); const dk = await scryptAsync(String(p), salt, SC.keylen, sopts(SC.N, SC.r)); return `$s1$${SC.N}$${SC.r}$${salt.toString('base64')}$${dk.toString('base64')}`; }
const parse = (h) => { const m = /^\$s1\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(h || '')); return m ? { N: Number(m[1]), r: Number(m[2]), salt: Buffer.from(m[3], 'base64'), dk: Buffer.from(m[4], 'base64') } : null; };
function verify(p, h) {
  if (legacy(h)) return bcrypt.compareSync(String(p || ''), h);
  const x = parse(h); if (!x) return false;
  const dk = crypto0.scryptSync(String(p || ''), x.salt, x.dk.length, sopts(x.N, x.r)); return dk.length === x.dk.length && crypto0.timingSafeEqual(dk, x.dk);
}
// نسخه‌ی ناهمگام (برای ورود): بدون قفل‌کردن حلقه‌ی رویداد. برای نام کاربری ناموجود/بدون هش هم یک بررسی کامل انجام می‌شود تا زمان پاسخ وجود حساب را لو ندهد.
async function verifyAsync(p, h) {
  p = String(p || '');
  if (legacy(h)) return bcrypt.compare(p, h);
  const x = parse(h) || parse(DUMMY); const dk = await scryptAsync(p, x.salt, x.dk.length, sopts(x.N, x.r));
  return !!parse(h) && dk.length === x.dk.length && crypto0.timingSafeEqual(dk, x.dk);
}
const needsRehash = (h) => legacy(h);
const DUMMY = hash('dummy-password-for-timing');
function randomPassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ23456789';
  let s = ''; const b = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[b[i] % chars.length];
  return s;
}
const randomDigits = (len = 8) => Array.from(crypto.randomBytes(len), (b) => b % 10).join('');

async function audit(req, action, entity, entityId, details) {
  try {
    const u = req && req.user;
    await db.get()('audit_logs').insert({
      user_id: u ? u.id : null, user_name: u ? u.full_name : null, action, entity: entity || null,
      entity_id: entityId !== undefined && entityId !== null ? String(entityId) : null,
      details: details ? String(details).slice(0, 1000) : null, ip: req ? req.ip : null,
    });
  } catch (_) { /* لاگ نباید جریان اصلی را مختل کند */ }
}
async function notify(userIds, title, body, link, type = 'info') {
  let ids = [...new Set([].concat(userIds).filter(Boolean))];
  if (!ids.length) return;
  // اعلان‌های دانش‌آموز برای اولیای متصل به او هم ارسال می‌شود
  try {
    const parents = await db.get()('parent_students as ps').join('students as s', 's.id', 'ps.student_id').whereIn('s.user_id', ids).select('ps.user_id');
    if (parents.length) ids = [...new Set([...ids, ...parents.map((p) => p.user_id)])];
  } catch (_) { /* جدول در نصب‌های خیلی قدیمی ممکن است نباشد */ }
  await db.get()('notifications').insert(ids.map((user_id) => ({ user_id, title: String(title).slice(0, 200), body: body ? String(body).slice(0, 1000) : null, link: link || null, type })));
  ids.forEach(invalidateBadges);
}
/** پایان‌دادن به تمام نشست‌های یک کاربر (به‌جز نشست فعلی در صورت ارسال exceptSid) */
async function killSessions(userId, exceptSid) {
  try {
    const q = db.get()('sessions').where((b) => b.where('sess', 'like', `%"uid":${Number(userId)},%`).orWhere('sess', 'like', `%"uid":${Number(userId)}}%`));
    if (exceptSid) q.whereNot('sid', exceptSid);
    await q.del();
  } catch (_) { /* ignore */ }
}
async function managerIds() {
  return (await db.get()('users').whereIn('role', ['admin', 'deputy']).where({ active: 1 }).select('id')).map((r) => r.id);
}

/** شناسه کلاس‌هایی که کاربر به آن‌ها دسترسی دارد؛ null = همه کلاس‌ها */
async function accessibleClassIds(user) {
  if (user.role === 'admin' || user.role === 'deputy') return null;
  const k = db.get();
  if (user.role === 'student') return user.student && user.student.classroom_id ? [user.student.classroom_id] : [];
  if (user.role === 'teacher' && user.teacher && require('./lib/caps').has(user, 'scope.all_classes')) { // مجوز «همه‌ی کلاس‌ها» (v2.5)
    return (await k('classrooms').where('status', '<>', 'archived').select('id')).map((r) => r.id);
  }
  if (user.role === 'teacher' && user.teacher) {
    const a = await k('classrooms').where({ homeroom_teacher_id: user.teacher.id }).where('status', '<>', 'archived').select('id');
    const b = await k('class_subjects as cs').join('classrooms as c', 'c.id', 'cs.classroom_id').where({ 'cs.teacher_id': user.teacher.id }).where('c.status', '<>', 'archived').distinct('cs.classroom_id as id');
    return [...new Set([...a, ...b].map((r) => r.id))];
  }
  return [];
}
/** کلاس‌هایی که معلم مسئول (راهنما) آن‌هاست */
async function homeroomClassIds(user) {
  if (user.role !== 'teacher' || !user.teacher) return [];
  return (await db.get()('classrooms').where({ homeroom_teacher_id: user.teacher.id }).select('id')).map((r) => r.id);
}
/** گزینه‌های classResults برای کاربر: معلم غیر راهنما فقط دروس خودش را می‌بیند */
async function gradeScope(user, classroomId) {
  if (user.role !== 'teacher') return {};
  if (require('./lib/caps').has(user, 'scope.all_classes')) return {};
  const home = await homeroomClassIds(user);
  return home.includes(classroomId) ? {} : { onlyTeacherId: user.teacher ? user.teacher.id : -1 };
}
async function nextStudentCode() {
  const prefix = String(settings.get('student_code_prefix') || '');
  const rows = await db.get()('students').where('student_code', 'like', prefix + '%').select('student_code');
  let max = 0;
  for (const r of rows) { const n = parseInt(r.student_code.slice(prefix.length), 10); if (!isNaN(n) && n > max) max = n; }
  return prefix + String(max + 1).padStart(4, '0');
}
async function uniqueUsername(base) {
  let name = base, i = 1;
  while (await db.get()('users').where({ username: name }).first()) name = base + '.' + (++i);
  return name;
}
const validNationalId = (code) => {
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const c = +code[9]; let s = 0;
  for (let i = 0; i < 9; i++) s += +code[i] * (10 - i);
  const r = s % 11;
  return r < 2 ? c === r : c === 11 - r;
};
const validPhone = (p) => !p || /^(0|\+98)?\d{8,11}$/.test(String(p).replace(/[\s-]/g, ''));
const validTime = (t) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

function canViewTicket(user, t) {
  if (user.role === 'admin' || user.role === 'deputy') return true;
  return t.created_by === user.id || t.recipient_user_id === user.id;
}
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** فیلتر مخاطب برای اطلاعیه‌ها/رویدادها؛ classIds = کلاس‌های قابل دسترس کاربر */
function audienceFilter(qb, user, classIds, alias = 't', hasClass = true) {
  if (user.role === 'admin' || user.role === 'deputy') return qb;
  return qb.where((b) => {
    b.where(`${alias}.audience`, 'all');
    if (user.role === 'teacher') b.orWhere(`${alias}.audience`, 'teachers');
    if (user.role === 'student') b.orWhere(`${alias}.audience`, 'students');
    if (hasClass && classIds && classIds.length) b.orWhere((c) => c.where(`${alias}.audience`, 'class').whereIn(`${alias}.classroom_id`, classIds));
  });
}

module.exports = { verifyAsync, hashAsync, needsRehash, gradeScope, killSessions, audienceFilter, canViewTicket, nowStr, hash, verify, randomPassword, randomDigits, audit, notify, managerIds, accessibleClassIds, homeroomClassIds, nextStudentCode, uniqueUsername, validNationalId, validPhone, validTime };

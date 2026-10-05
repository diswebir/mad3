'use strict';
/**
 * تولد دانش‌آموزان: محاسبه‌ی تاریخ بعدی تولد (شمسی)، فهرست بازه‌ای، شمارش معکوس و ارسال اعلان/پیامک.
 * تاریخ تولد در پایگاه داده به‌صورت میلادی ISO ذخیره می‌شود و همیشه بر پایه‌ی تقویم شمسی جشن گرفته می‌شود.
 */
const db = require('../db');
const settings = require('../settings');
const sms = require('./sms');
const J = require('../utils/jalali');
const F = require('../utils/fa');
const K = require('./birthdayKinds');

const utc = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
/** شنبه‌ی هفته‌ای که iso در آن است */
const weekStart = (iso) => J.addDays(iso, -J.dow(iso));

/** روزِ جشن در سال شمسی y (۳۰ اسفند در سال غیرکبیسه → ۲۹ اسفند) */
function dayIn(y, jm, jd) { return J.jToIso(y, jm, Math.min(jd, J.monthRange(y, jm).length)); }
/**
 * نخستین تولد در تاریخ fromISO یا پس از آن. خروجی: { date, jy, days (از fromISO), age (سنِ جدید) } یا null.
 */
function occurrence(birthISO, fromISO) {
  const b = J.isoToJ(birthISO); const f = J.isoToJ(fromISO); if (!b || !f) return null;
  for (let y = f.jy; y <= f.jy + 1; y++) {
    const date = dayIn(y, b.jm, b.jd);
    if (date >= fromISO.slice(0, 10)) return { date, jy: y, days: daysBetween(fromISO, date), age: y - b.jy };
  }
  return null;
}
/** آخرین تولد در تاریخ iso یا پیش از آن */
function lastOccurrence(birthISO, iso) {
  const b = J.isoToJ(birthISO); const f = J.isoToJ(iso); if (!b || !f) return null;
  for (let y = f.jy; y >= f.jy - 1; y--) { const date = dayIn(y, b.jm, b.jd); if (date <= iso.slice(0, 10)) return { date, jy: y }; }
  return null;
}

const fullName = (s) => `${s.first_name || ''} ${s.last_name || ''}`.trim();
function decorate(s, occ, today) {
  return {
    id: s.id, user_id: s.user_id, first_name: s.first_name, last_name: s.last_name, name: fullName(s), class_id: s.classroom_id, class_name: s.class_name || '',
    birth_date: s.birth_date, mobile: s.mobile, father_phone: s.father_phone, mother_phone: s.mother_phone, guardian_phone: s.guardian_phone,
    date: occ.date, jy: occ.jy, age: occ.age, days: daysBetween(today, occ.date), weekday: J.WEEKDAYS[J.dow(occ.date)], today: occ.date === today,
  };
}
async function activeStudents(k, classIds) {
  const q = k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').whereNotNull('s.birth_date')
    .select('s.id', 's.user_id', 's.first_name', 's.last_name', 's.birth_date', 's.classroom_id', 's.mobile', 's.father_phone', 's.mother_phone', 's.guardian_phone', 'c.name as class_name');
  if (classIds) q.whereIn('s.classroom_id', classIds.length ? classIds : [0]);
  return q;
}
/** تولدهای بازه‌ی [from, to] (حداکثر یک سال) به‌ترتیب تاریخ. days نسبت به today (می‌تواند منفی باشد). */
async function between(from, to, { classIds = null, today = J.todayISO(), k = db.get() } = {}) {
  const out = [];
  for (const s of await activeStudents(k, classIds)) {
    const occ = occurrence(s.birth_date, from); if (!occ || occ.date > to || occ.age < 1) continue;
    out.push(decorate(s, occ, today));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.name < b.name ? -1 : 1));
}
/** نمای کلی برای مدیر/معلم: امروز، این هفته و هفته‌ی بعد (هفته از شنبه) */
async function overview({ classIds = null, today = J.todayISO(), weekOf = null, k = db.get() } = {}) {
  const ws = weekStart(weekOf || today); const we = J.addDays(ws, 6); const ns = J.addDays(ws, 7); const ne = J.addDays(ws, 13);
  const all = await between(ws, ne, { classIds, today, k });
  return {
    today, thisWeek: { start: ws, end: we, list: all.filter((x) => x.date <= we) }, nextWeek: { start: ns, end: ne, list: all.filter((x) => x.date >= ns) },
    todayList: all.filter((x) => x.today), upcoming: all.filter((x) => x.days >= 0),
  };
}
/** شمارش معکوس تولد برای ویجت دانش‌آموز */
function countdown(s, today = J.todayISO()) {
  if (!s || !s.birth_date) return null;
  const next = occurrence(s.birth_date, today); if (!next || next.age < 1) return null;
  const prev = lastOccurrence(s.birth_date, today);
  const span = prev ? Math.max(1, daysBetween(prev.date, next.date)) : 365;
  const passed = next.days === 0 ? span : (prev ? daysBetween(prev.date, today) : 0);
  return { days: next.days, today: next.days === 0, date: next.date, age: next.age, weekday: J.WEEKDAYS[J.dow(next.date)], pct: Math.max(0, Math.min(100, Math.round((passed / span) * 100))) };
}

/* ───────── تنظیمات و قالب پیام ───────── */
const cfg = (key) => settings.get(key);
const kindOn = (kind) => settings.bool('bd_on_' + kind);
function variables(item, days) {
  return {
    name: item.name, first_name: item.first_name || '', last_name: item.last_name || '', class: item.class_name || '—', age: F.toFa(item.age),
    days: F.toFa(days === undefined ? item.days : days), date: F.toFa(J.longDate(item.date)), weekday: item.weekday, school: settings.get('school_name') || '',
  };
}
const renderTpl = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : ''));
const templateOf = (kind) => (String(cfg('bd_tpl_' + kind) || '').trim() || K.KINDS[kind].tpl);
const messageFor = (kind, item) => renderTpl(templateOf(kind), variables(item));
/** پارامترهای الگوی ippanel برای یک نوع پیام: { placeholder: value } */
function patternParams(kind, item) {
  const p = K.parseParams(cfg('bd_params_' + kind) || K.KINDS[kind].params); const vars = variables(item);
  const map = p.ok && p.map.length ? p.map : K.parseParams(K.KINDS[kind].params).map;
  return Object.fromEntries(map.map(([ph, v]) => [ph, vars[v]]));
}

/* ───────── ارسال ───────── */
async function claim(k, studentId, jy, kind) {
  try { await k('birthday_log').insert({ student_id: studentId, jy, kind, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }); return true; } catch (e) {
    if (/unique|duplicate|constraint/i.test(String(e.message) + String(e.code))) return false;
    throw e;
  }
}
async function push(userIds, title, body, link, type) {
  const ids = [...new Set(userIds.filter(Boolean))]; if (!ids.length) return 0;
  await db.get()('notifications').insert(ids.map((user_id) => ({ user_id, title: String(title).slice(0, 200), body: String(body).slice(0, 1000), link: link || null, type })));
  const { invalidateBadges } = require('../middleware'); ids.forEach(invalidateBadges);
  return ids.length;
}
/** پیامک یک مخاطب: اگر کد الگو ثبت شده باشد با الگو، وگرنه متن ساده با قالب */
async function smsTo(kind, item, numbers) {
  if (!sms.config().enabled || !numbers.length) return 0;
  const code = String(cfg('bd_pattern_' + kind) || '').trim(); let n = 0;
  if (code) {
    const params = patternParams(kind, item);
    for (const to of numbers) { const r = await sms.sendPattern({ to, patternCode: code, params, event: 'birthday', studentId: item.id }); if (r.ok) n++; }
    return n;
  }
  return sms.enqueue(numbers.map((to) => ({ to, message: messageFor(kind, item), studentId: item.id })), { event: 'birthday' });
}
const mobileOf = (v) => { const e = sms.toE164(v); return e ? [e] : []; };

/** مخاطبین هر گروه برای یک دانش‌آموز: { users: [userId], numbers: [e164] } */
async function audience(k, aud, item, cache) {
  if (aud === 'student') return { users: [item.user_id], numbers: mobileOf(item.mobile) };
  if (aud === 'parent') {
    const users = (await k('parent_students').where({ student_id: item.id }).select('user_id')).map((r) => r.user_id);
    return { users, numbers: sms.parentNumbers(item) };
  }
  if (!cache.admin) {
    const rows = await k('users').whereIn('role', ['admin', 'deputy']).where({ active: 1 }).select('id', 'phone');
    cache.admin = { users: rows.map((r) => r.id), numbers: [...new Set(rows.flatMap((r) => mobileOf(r.phone)))] };
  }
  return cache.admin;
}

/**
 * اجرای روزانه. فقط پس از ساعت ارسال (bd_send_time) کار می‌کند، هر پیام برای هر دانش‌آموز در هر سال فقط یک‌بار ارسال می‌شود
 * و اگر cron یک روز اجرا نشده باشد، در اجرای بعدی (تا همان روز تولد) جبران می‌شود.
 * خروجی: { skipped?, sent: {kind: count}, sms }
 */
async function run({ today = J.todayISO(), nowHM = J.nowHM(), force = false } = {}) {
  const out = { sent: {}, sms: 0 };
  if (!settings.bool('bd_enabled')) return { skipped: 'disabled', ...out };
  if (!force && nowHM < (cfg('bd_send_time') || '07:30')) return { skipped: 'too-early', ...out };
  const k = db.get(); const before = Math.max(0, Math.min(14, Number(cfg('bd_before_days')) || 0)); const cache = {};
  const items = (await between(today, J.addDays(today, before), { today, k }));
  const digest = { admin_before: [], admin_today: [] };
  for (const it of items) {
    const phases = it.days === 0 ? ['today'] : (before > 0 && it.days >= 1 && it.days <= before ? ['before'] : []);
    for (const when of phases) {
      for (const kind of K.ORDER.filter((x) => K.KINDS[x].when === when)) {
        if (!kindOn(kind)) continue;
        const meta = K.KINDS[kind]; const a = await audience(k, meta.aud, it, cache);
        if (!(await claim(k, it.id, it.jy, kind))) continue;
        out.sent[kind] = (out.sent[kind] || 0) + 1;
        if (meta.aud === 'admin') { digest[kind].push(it); continue; }
        await push(a.users, meta.inapp, messageFor(kind, it), '/', when === 'today' ? 'success' : 'info');
        if (settings.bool('bd_sms_' + meta.aud)) out.sms += await smsTo(kind, it, a.numbers);
      }
      // رونوشت درون‌برنامه‌ای برای معلم راهنمای کلاس (در همان یک‌بار)
      const hk = 'homeroom_' + when;
      if (settings.bool('bd_notify_homeroom') && it.class_id && (await claim(k, it.id, it.jy, hk))) {
        const t = await k('classrooms as c').join('teachers as t', 't.id', 'c.homeroom_teacher_id').where('c.id', it.class_id).select('t.user_id').first();
        if (t) { out.sent[hk] = (out.sent[hk] || 0) + 1; await push([t.user_id], K.KINDS['admin_' + when].inapp, messageFor('admin_' + when, it), '/birthdays', when === 'today' ? 'success' : 'info'); }
      }
    }
  }
  for (const kind of ['admin_before', 'admin_today']) {
    const list = digest[kind]; if (!list.length) continue;
    const a = await audience(k, 'admin', list[0], cache); const meta = K.KINDS[kind];
    const title = list.length === 1 ? meta.inapp : `${meta.inapp} (${F.toFa(list.length)} نفر)`;
    await push(a.users, title, list.map((it) => messageFor(kind, it)).join('\n'), '/birthdays', kind === 'admin_today' ? 'success' : 'info');
    if (settings.bool('bd_sms_admin')) for (const it of list) out.sms += await smsTo(kind, it, a.numbers);
  }
  return out;
}

/** تبریک دستی (فوری، بدون ثبت در birthday_log): نوع «روز تولد» برای اولیا و دانش‌آموز */
async function greetNow(item) {
  const k = db.get(); const cache = {}; const r = { inapp: 0, sms: 0 };
  for (const kind of ['parent_today', 'student_today']) {
    const meta = K.KINDS[kind]; const a = await audience(k, meta.aud, item, cache);
    r.inapp += await push(a.users, meta.inapp, messageFor(kind, { ...item, days: 0 }), '/', 'success');
    if (settings.bool('bd_sms_' + meta.aud)) r.sms += await smsTo(kind, item, a.numbers);
  }
  return r;
}

module.exports = { daysBetween, weekStart, occurrence, lastOccurrence, between, overview, countdown, run, greetNow, messageFor, patternParams, variables, renderTpl, templateOf, KINDS: K.KINDS, VARS: K.VARS };

'use strict';
/**
 * ساعت زنگ‌ها (زنگ‌کشی مدرسه): یک «الگوی پیش‌فرض» و هر تعداد «الگوی ویژه» برای روزها یا پایه‌های مشخص
 * (مثلاً پنجشنبه‌های کوتاه یا شیفت عصر). هر الگو فهرست ردیف‌هاست: زنگ درسی، تفریح، نماز، ناهار.
 * شماره‌ی زنگ‌های درسی در هر الگو از ۱ پشت‌سرهم است و همان شماره در برنامه‌ی هفتگی ذخیره می‌شود.
 */
const KINDS = { class: 'زنگ درسی', break: 'تفریح', prayer: 'نماز', lunch: 'ناهار' };
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMin = (hm) => { const m = HM.exec(String(hm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const fmt = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;

let cache = { schedules: [], byId: {} };

async function load(k) {
  const schedules = await k('bell_schedules').orderBy('id');
  const rows = await k('bell_rows').orderBy('schedule_id').orderBy('seq');
  const by = {};
  for (const r of rows) (by[r.schedule_id] = by[r.schedule_id] || []).push(r);
  const out = schedules.map((s) => ({
    id: s.id, name: s.name, isDefault: !!s.is_default,
    days: String(s.days || '').split(',').filter((x) => x !== '').map(Number), grades: String(s.grades || '').split(',').map((x) => x.trim()).filter(Boolean),
    rows: (by[s.id] || []).map((r) => ({ seq: r.seq, kind: r.kind, label: r.label || '', start: r.start_time, end: r.end_time, n: r.period_no })),
  }));
  cache = { schedules: out, byId: Object.fromEntries(out.map((s) => [s.id, s])) };
  return cache;
}

/** ردیف‌های یک الگوی ساده: count زنگ، شروع، مدت، تنفس + (اختیاری) یک تفریح بلند پس از زنگ longAfter */
function fromTemplate({ count = 6, start = '07:45', minutes = 45, brk = 10, longAfter = 0, longMinutes = 20, longKind = 'break' } = {}) {
  let cur = toMin(start); if (isNaN(cur)) cur = 7 * 60 + 45;
  const rows = []; let seq = 1;
  for (let i = 1; i <= count; i++) {
    rows.push({ seq: seq++, kind: 'class', label: '', start: fmt(cur), end: fmt(cur + minutes), n: i }); cur += minutes;
    if (i < count) {
      if (longAfter && i === longAfter) { rows.push({ seq: seq++, kind: longKind, label: KINDS[longKind], start: fmt(cur), end: fmt(cur + longMinutes), n: null }); cur += longMinutes; }
      else if (brk > 0) { rows.push({ seq: seq++, kind: 'break', label: KINDS.break, start: fmt(cur), end: fmt(cur + brk), n: null }); cur += brk; }
    }
  }
  return rows;
}

/** ایجاد الگوی پیش‌فرض از تنظیمات قدیمی (periods_count/period_start/...) در اولین اجرا */
async function ensureDefault(k) {
  if (!(await k('bell_schedules').first())) {
    const st = Object.fromEntries((await k('settings').whereIn('key', ['periods_count', 'period_start', 'period_minutes', 'break_minutes']).select('key', 'value')).map((r) => [r.key, r.value]));
    const rows = fromTemplate({ count: Math.min(12, Math.max(1, Number(st.periods_count) || 6)), start: HM.test(st.period_start || '') ? st.period_start : '07:45', minutes: Number(st.period_minutes) || 45, brk: st.break_minutes === undefined || st.break_minutes === '' ? 10 : Number(st.break_minutes) });
    await saveSchedule(k, { name: 'الگوی پیش‌فرض', days: [], grades: [], isDefault: true, rows });
  }
  return load(k);
}

/** اعتبارسنجی و نرمال‌سازی ردیف‌ها. خروجی: { errors, rows } */
function validateRows(input) {
  const errors = []; const rows = [];
  const list = (input || []).filter((r) => r && (r.start || r.end || r.kind));
  if (!list.length) return { errors: ['حداقل یک زنگ درسی لازم است.'], rows };
  let prevEnd = -1; let n = 0; let seq = 1;
  list.forEach((r, i) => {
    const kind = r.kind; const a = toMin(r.start); const b = toMin(r.end); const at = `ردیف ${i + 1}`;
    if (!KINDS[kind]) { errors.push(`${at}: نوع ردیف نامعتبر است.`); return; }
    if (isNaN(a) || isNaN(b)) { errors.push(`${at}: ساعت شروع/پایان نامعتبر است (مثل ۰۷:۴۵).`); return; }
    if (b <= a) { errors.push(`${at}: پایان باید پس از شروع باشد.`); return; }
    if (a < prevEnd) { errors.push(`${at}: با ردیف قبل هم‌پوشانی دارد.`); return; }
    if (b - a > 240) { errors.push(`${at}: مدت بیش از ۴ ساعت است.`); return; }
    prevEnd = b;
    rows.push({ seq: seq++, kind, label: String(r.label || (kind === 'class' ? '' : KINDS[kind])).slice(0, 60), start: fmt(a), end: fmt(b), n: kind === 'class' ? ++n : null });
  });
  if (!errors.length) { if (!n) errors.push('حداقل یک زنگ درسی لازم است.'); if (n > 12) errors.push('حداکثر ۱۲ زنگ درسی مجاز است.'); }
  return { errors, rows };
}

async function saveSchedule(k, { id, name, days, grades, isDefault, rows }) {
  return k.transaction(async (t) => {
    const rec = { name: String(name || 'الگو').slice(0, 100), days: (days || []).join(','), grades: (grades || []).join(','), is_default: isDefault ? 1 : 0 };
    let sid = id;
    if (sid) await t('bell_schedules').where({ id: sid }).update(rec);
    else { const r = await t('bell_schedules').insert(rec); sid = Array.isArray(r) ? r[0] : r; }
    await t('bell_rows').where({ schedule_id: sid }).del();
    if (rows.length) await t('bell_rows').insert(rows.map((r) => ({ schedule_id: sid, seq: r.seq, kind: r.kind, label: r.label || null, start_time: r.start, end_time: r.end, period_no: r.n })));
    return sid;
  });
}
async function deleteSchedule(k, id) { await k('bell_rows').where({ schedule_id: id }).del(); await k('bell_schedules').where({ id }).del(); }

const defaultOf = (list) => list.find((s) => s.isDefault) || list[0] || null;
const defaultSchedule = () => defaultOf(cache.schedules);
/** الگوی مؤثر برای یک روز و پایه از میان list: ویژه‌ترین الگوی منطبق، وگرنه پیش‌فرض */
function pick(list, { day, grade } = {}) {
  let best = null; let bestScore = 0;
  for (const s of list) {
    if (s.isDefault) continue;
    if (s.days.length && (day === undefined || !s.days.includes(Number(day)))) continue;
    if (s.grades.length && (!grade || !s.grades.includes(grade))) continue;
    const score = (s.days.length ? 2 : 0) + (s.grades.length ? 1 : 0) + 0.001 * (1000 - (s.id || 0));
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best && (best.days.length || best.grades.length) ? best : defaultOf(list);
}
const scheduleFor = (o) => pick(cache.schedules, o);
const classRows = (s) => (s ? s.rows.filter((r) => r.kind === 'class').map((r) => ({ n: r.n, start: r.start, end: r.end })) : []);
const periodsFor = (o) => classRows(scheduleFor(o));
const rowsFor = (o) => { const s = scheduleFor(o); return s ? s.rows : []; };
const defaultPeriods = () => classRows(defaultSchedule());
const countFor = (o) => periodsFor(o).length;
/** شبیه‌سازی: تعداد زنگ‌های درسی اگر فهرست الگوها list می‌بود */
const countForIn = (list, o) => classRows(pick(list, o)).length;
const maxPeriods = () => Math.max(1, ...cache.schedules.map((s) => classRows(s).length));
/** ساعت شروع زنگ اول (مبنای محاسبه‌ی تأخیر ورود) */
function schoolStart(o) { const p = periodsFor(o); return p.length ? p[0].start : '07:30'; }
/** زنگ جاری/بعدی در لحظه‌ی hm برای یک روز و پایه */
function currentPeriod(hm, o) {
  const now = toMin(hm); const ps = periodsFor(o);
  const cur = ps.find((p) => now >= toMin(p.start) && now < toMin(p.end));
  const next = ps.find((p) => toMin(p.start) > now);
  return { current: cur || null, next: next || null };
}

module.exports = { countForIn, pick, KINDS, toMin, fmt, load, ensureDefault, fromTemplate, validateRows, saveSchedule, deleteSchedule, scheduleFor, periodsFor, rowsFor, defaultPeriods, countFor, maxPeriods, schoolStart, currentPeriod, all: () => cache.schedules };

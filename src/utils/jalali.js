'use strict';
const jl = require('jalaali-js');

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const TZ = 'Asia/Tehran';
const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function parts(date) {
  const o = {};
  for (const p of tzFmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}
const todayISO = () => { const p = parts(new Date()); return `${p.year}-${p.month}-${p.day}`; };
const nowHM = () => { const p = parts(new Date()); return `${p.hour}:${p.minute}`; };
const pad = (n) => String(n).padStart(2, '0');

function isoToJ(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return jl.toJalaali(+m[1], +m[2], +m[3]);
}
function jToIso(jy, jm, jd) {
  const g = jl.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}
/** ورودی شمسی مانند 1405/07/09 را به ISO میلادی تبدیل می‌کند؛ خروجی null یعنی نامعتبر */
function parseJalali(str) {
  if (!str) return null;
  str = String(str).trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); // ارقام فارسی/عربی
  if (/^\d{4}-\d{2}-\d{2}$/.test(str) && +str.slice(0, 4) > 1700) return str; // میلادی
  const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(str);
  if (!m) return null;
  const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
  if (!jl.isValidJalaaliDate(jy, jm, jd)) return null;
  return jToIso(jy, jm, jd);
}
function isoToJString(iso) {
  const j = isoToJ(iso);
  return j ? `${j.jy}/${pad(j.jm)}/${pad(j.jd)}` : '';
}
function longDate(iso) {
  const j = isoToJ(iso);
  return j ? `${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}` : '';
}
/** روز هفته با شروع شنبه = ۰ */
function dow(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
}
function addDays(iso, n) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function monthRange(jy, jm) {
  const len = jl.jalaaliMonthLength(jy, jm);
  return { start: jToIso(jy, jm, 1), end: jToIso(jy, jm, len), length: len };
}
function dbDateTimeToDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const t = String(s).replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z');
}
function dateTimeString(s) {
  const d = dbDateTimeToDate(s);
  if (!d || isNaN(d)) return '';
  const p = parts(d);
  const j = jl.toJalaali(+p.year, +p.month, +p.day);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)} ${p.hour}:${p.minute}`;
}
function currentJalaliYear() { return isoToJ(todayISO()).jy; }
function ageFrom(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = todayISO().split('-').map(Number);
  let a = t[0] - y;
  if (t[1] < m || (t[1] === m && t[2] < d)) a--;
  return a;
}
module.exports = { MONTHS, WEEKDAYS, TZ, todayISO, nowHM, isoToJ, jToIso, parseJalali, isoToJString, longDate, dow, addDays, monthRange, dateTimeString, dbDateTimeToDate, currentJalaliYear, ageFrom, isValid: jl.isValidJalaaliDate, monthLength: jl.jalaaliMonthLength };

'use strict';
const db = require('./db');

/** تعریف تنظیمات سامانه؛ مقدار پیش‌فرض و گروه‌بندی برای صفحه تنظیمات */
const DEFS = [
  // عمومی
  { key: 'school_name', group: 'general', label: 'نام مدرسه', type: 'text', def: 'مدرسه نمونه' },
  { key: 'school_type', group: 'general', label: 'مقطع تحصیلی', type: 'select', def: 'متوسطه اول', options: ['دبستان', 'متوسطه اول', 'متوسطه دوم', 'هنرستان', 'پیش‌دبستانی'] },
  { key: 'school_code', group: 'general', label: 'کد مدرسه', type: 'text', def: '' },
  { key: 'school_principal', group: 'general', label: 'نام مدیر', type: 'text', def: '' },
  { key: 'school_phone', group: 'general', label: 'تلفن مدرسه', type: 'text', def: '' },
  { key: 'school_email', group: 'general', label: 'ایمیل', type: 'text', def: '' },
  { key: 'school_address', group: 'general', label: 'نشانی', type: 'textarea', def: '' },
  // آموزشی
  { key: 'week_days', group: 'academic', label: 'روزهای هفته مدرسه', type: 'days', def: '0,1,2,3,4' },
  { key: 'periods_count', group: 'academic', label: 'تعداد زنگ‌های روزانه', type: 'number', def: '6', min: 1, max: 10 },
  { key: 'period_start', group: 'academic', label: 'ساعت شروع زنگ اول', type: 'time', def: '07:45' },
  { key: 'period_minutes', group: 'academic', label: 'مدت هر زنگ (دقیقه)', type: 'number', def: '45', min: 20, max: 120 },
  { key: 'break_minutes', group: 'academic', label: 'مدت تنفس بین زنگ‌ها (دقیقه)', type: 'number', def: '10', min: 0, max: 60 },
  { key: 'grade_scale', group: 'academic', label: 'بیشینه نمره کارنامه', type: 'number', def: '20', min: 4, max: 100 },
  { key: 'pass_mark', group: 'academic', label: 'حدنصاب قبولی', type: 'number', def: '10', min: 1, max: 100 },
  { key: 'show_rank_to_students', group: 'academic', label: 'نمایش رتبه و میانگین کلاس به دانش‌آموز در کارنامه', type: 'checkbox', def: '1' },
  { key: 'terms_count', group: 'academic', label: 'تعداد نوبت‌های ارزشیابی', type: 'number', def: '2', min: 1, max: 4 },
  // حضور و غیاب
  { key: 'attendance_mode', group: 'attendance', label: 'نوع ثبت حضور و غیاب', type: 'select', def: 'daily', options: [['daily', 'روزانه (یک‌بار در روز)'], ['periodic', 'به‌تفکیک زنگ']] },
  { key: 'absence_alert_threshold', group: 'attendance', label: 'آستانه هشدار غیبت (روز)', type: 'number', def: '5', min: 1, max: 60 },
  { key: 'notify_on_absence', group: 'attendance', label: 'ارسال اعلان غیبت به دانش‌آموز', type: 'checkbox', def: '1' },
  // تیکت
  { key: 'ticket_student_to_teacher', group: 'tickets', label: 'اجازه ارسال تیکت دانش‌آموز به معلم', type: 'checkbox', def: '1' },
  { key: 'ticket_auto_close_days', group: 'tickets', label: 'بستن خودکار تیکت پاسخ‌داده‌شده بعد از (روز، ۰ = غیرفعال)', type: 'number', def: '7', min: 0, max: 90 },
  // دانش‌آموز
  { key: 'student_code_prefix', group: 'students', label: 'پیشوند شماره دانش‌آموزی', type: 'text', def: '1405' },
  { key: 'student_password_mode', group: 'students', label: 'رمز اولیه دانش‌آموز', type: 'select', def: 'national_id', options: [['national_id', 'کد ملی (در نبود آن رمز تصادفی)'], ['random', 'همیشه رمز تصادفی']] },
  { key: 'show_birthdays', group: 'students', label: 'نمایش تولدهای امروز در داشبورد', type: 'checkbox', def: '1' },
  // مالی
  { key: 'currency_label', group: 'finance', label: 'واحد پول', type: 'select', def: 'تومان', options: ['تومان', 'ریال'] },
  // امنیت
  { key: 'session_hours', group: 'security', label: 'مدت اعتبار نشست (ساعت)', type: 'number', def: '8', min: 1, max: 168 },
  { key: 'min_password_length', group: 'security', label: 'حداقل طول رمز عبور', type: 'number', def: '6', min: 4, max: 32 },
  { key: 'max_login_attempts', group: 'security', label: 'حداکثر تلاش ناموفق ورود', type: 'number', def: '5', min: 3, max: 20 },
  { key: 'lockout_minutes', group: 'security', label: 'مدت قفل موقت ورود (دقیقه)', type: 'number', def: '10', min: 1, max: 1440 },
  // ظاهر
  { key: 'primary_color', group: 'appearance', label: 'رنگ اصلی سامانه', type: 'color', def: '#2563eb' },
  { key: 'show_demo_logins', group: 'appearance', label: 'نمایش حساب‌های دمو در صفحه ورود', type: 'checkbox', def: '0' },
  { key: 'logo', group: 'appearance', label: 'لوگو', type: 'hidden', def: '' },
];
const GROUPS = { general: 'اطلاعات مدرسه', academic: 'تنظیمات آموزشی', attendance: 'حضور و غیاب', tickets: 'تیکت‌ها', students: 'دانش‌آموزان', finance: 'مالی', security: 'امنیت', appearance: 'ظاهر' };

let cache = null;
async function load() {
  const rows = await db.get()('settings').select('key', 'value');
  const m = {};
  for (const d of DEFS) m[d.key] = d.def;
  for (const r of rows) m[r.key] = r.value === null ? '' : r.value;
  cache = m;
  return m;
}
function all() { return cache || {}; }
function get(key) { return cache && key in cache ? cache[key] : (DEFS.find((d) => d.key === key) || {}).def; }
function num(key) { return Number(get(key)) || 0; }
function bool(key) { return get(key) === '1' || get(key) === 1 || get(key) === true; }
async function set(key, value) {
  const knex = db.get();
  value = String(value === undefined || value === null ? '' : value);
  const exists = await knex('settings').where({ key }).first();
  if (exists) await knex('settings').where({ key }).update({ value }); else await knex('settings').insert({ key, value });
  if (cache) cache[key] = value;
}
async function setMany(obj) { for (const k of Object.keys(obj)) await set(k, obj[k]); }

/** زمان‌بندی زنگ‌ها بر اساس تنظیمات */
function periods() {
  const n = num('periods_count') || 6; const len = num('period_minutes') || 45; const br = num('break_minutes');
  const [h, m] = String(get('period_start') || '07:45').split(':').map(Number);
  let cur = h * 60 + m; const out = [];
  const f = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  for (let i = 1; i <= n; i++) { out.push({ n: i, start: f(cur), end: f(cur + len) }); cur += len + br; }
  return out;
}
function weekDays() { return String(get('week_days') || '0,1,2,3,4').split(',').filter((x) => x !== '').map(Number); }

module.exports = { DEFS, GROUPS, load, all, get, num, bool, set, setMany, periods, weekDays };

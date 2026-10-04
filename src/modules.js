'use strict';
const db = require('./db');

const STAFF = ['admin', 'deputy'];
const ALL = ['admin', 'deputy', 'teacher', 'student'];
const STAFF_T = ['admin', 'deputy', 'teacher'];

/**
 * ثبت ماژول‌ها. ماژول‌های core غیرقابل غیرفعال‌سازی‌اند؛ بقیه از صفحه «ماژول‌ها» روشن/خاموش می‌شوند.
 * خاموش‌کردن ماژول: مسیرها 404/پیام غیرفعال، منو، ویجت‌های داشبورد و بخش‌های پرونده دانش‌آموز حذف می‌شوند.
 */
const MODULES = [
  { key: 'core', title: 'هسته سامانه', icon: 'layout-dashboard', core: true, desc: 'داشبورد، پروفایل، اعلان‌ها، جستجوی سراسری', nav: [
    { label: 'داشبورد', href: '/', icon: 'layout-dashboard', roles: ALL, section: 'main' }] },
  { key: 'students', title: 'دانش‌آموزان و پرونده', icon: 'graduation-cap', core: true, desc: 'ثبت‌نام، پرونده کامل دانش‌آموزی، اطلاعات اولیا، پنل کاربری دانش‌آموز', nav: [
    { label: 'دانش‌آموزان', href: '/students', icon: 'graduation-cap', roles: STAFF_T, section: 'main' },
    { label: 'پرونده من', href: '/students/me', icon: 'id-card', roles: ['student'], section: 'main' }] },
  { key: 'teachers', title: 'معلمان', icon: 'briefcase', core: true, desc: 'مدیریت معلمان، تخصیص کلاس و دروس', nav: [
    { label: 'معلمان', href: '/teachers', icon: 'briefcase', roles: STAFF, section: 'main' }] },
  { key: 'classes', title: 'کلاس‌ها و دروس', icon: 'school', core: true, desc: 'کلاس‌ها، دروس، سال تحصیلی، تخصیص معلم به کلاس', nav: [
    { label: 'کلاس‌ها', href: '/classes', icon: 'school', roles: STAFF_T, section: 'main' },
    { label: 'دروس', href: '/subjects', icon: 'book-open', roles: STAFF, section: 'main' },
    { label: 'سال‌های تحصیلی', href: '/academic-years', icon: 'calendar-days', roles: STAFF, section: 'main' }] },
  { key: 'attendance', title: 'حضور و غیاب', icon: 'calendar-check', desc: 'ثبت روزانه/به‌تفکیک زنگ، گزارش ماهانه، هشدار غیبت، توجیه غیبت از طریق تیکت', nav: [
    { label: 'ثبت حضور و غیاب', href: '/attendance', icon: 'calendar-check', roles: STAFF_T, section: 'edu' , perm: 'attendance' },
    { label: 'گزارش حضور و غیاب', href: '/attendance/report', icon: 'list-checks', roles: STAFF_T, section: 'edu' , perm: 'attendance' },
    { label: 'گزارش تأخیرها', href: '/attendance/late', icon: 'clock', roles: STAFF_T, section: 'edu', perm: 'attendance' },
    { label: 'ثبت ورود با QR', href: '/attendance/gate', icon: 'qr-code', roles: ['admin', 'deputy'], section: 'edu', perm: 'attendance' },
    { label: 'حضور و غیاب من', href: '/attendance/my', icon: 'calendar-check', roles: ['student'], section: 'edu' }] },
  { key: 'timetable', title: 'برنامه هفتگی', icon: 'clock', desc: 'برنامه هفتگی کلاس‌ها با تشخیص تداخل معلم', nav: [
    { label: 'برنامه هفتگی', href: '/timetable', icon: 'clock', roles: ALL, section: 'edu' },
    { label: 'ساعت زنگ‌ها', href: '/timetable/bells', icon: 'bell', roles: STAFF, section: 'edu', perm: 'timetable' }] },
  { key: 'grades', title: 'نمرات و کارنامه', icon: 'award', desc: 'ارزشیابی‌ها، ثبت نمره، کارنامه، رتبه‌بندی و انتشار نمرات', nav: [
    { label: 'نمرات', href: '/grades', icon: 'award', roles: STAFF_T, section: 'edu' , perm: 'grades' },
    { label: 'کارنامه من', href: '/grades/my', icon: 'award', roles: ['student'], section: 'edu' }] },
  { key: 'homework', title: 'تکالیف', icon: 'notebook-pen', desc: 'تعریف تکلیف، تحویل آنلاین با فایل، نمره‌دهی و بازخورد', nav: [
    { label: 'تکالیف', href: '/homework', icon: 'notebook-pen', roles: ALL, section: 'edu' }] },
  { key: 'exams', title: 'برنامه امتحانات', icon: 'clipboard-list', desc: 'زمان‌بندی امتحانات هر کلاس', nav: [
    { label: 'برنامه امتحانات', href: '/exams', icon: 'clipboard-list', roles: ALL, section: 'edu' , perm: 'exams' }] },
  { key: 'discipline', title: 'انضباطی و رفتار', icon: 'gavel', desc: 'ثبت موارد تشویقی/انضباطی و نمره رفتار', nav: [
    { label: 'انضباطی و رفتار', href: '/discipline', icon: 'gavel', roles: ALL, section: 'edu' , perm: 'discipline' }] },
  { key: 'tickets', title: 'تیکت و ارتباطات', icon: 'life-buoy', desc: 'ارتباط دانش‌آموز، معلم و مدیر از طریق تیکت، پیوست، رتبه‌دهی و توجیه غیبت', nav: [
    { label: 'تیکت‌ها', href: '/tickets', icon: 'life-buoy', roles: ALL, section: 'comm', badge: 'tickets' }] },
  { key: 'announcements', title: 'اطلاعیه‌ها', icon: 'megaphone', desc: 'اطلاعیه برای همه، معلمان، دانش‌آموزان یا یک کلاس', nav: [
    { label: 'اطلاعیه‌ها', href: '/announcements', icon: 'megaphone', roles: ALL, section: 'comm' }] },
  { key: 'calendar', title: 'تقویم و رویدادها', icon: 'calendar-days', desc: 'تقویم شمسی مدرسه با رویدادها، امتحانات و تولدها', nav: [
    { label: 'تقویم', href: '/calendar', icon: 'calendar-days', roles: ALL, section: 'comm' },
    { label: 'مدیریت رویدادها', href: '/events', icon: 'flag', roles: STAFF, section: 'comm' },
    { label: 'تعطیلات و تقویم آموزشی', href: '/holidays', icon: 'calendar-off', roles: STAFF, section: 'comm', perm: 'timetable' }] },
  { key: 'birthdays', title: 'تولد و تبریک', icon: 'cake', desc: 'تولدهای هفته‌ی جاری و بعد، شمارش معکوس تولد دانش‌آموز و اعلان/پیامک تبریک به مدیر، اولیا و دانش‌آموز', nav: [
    { label: 'تولدها', href: '/birthdays', icon: 'cake', roles: STAFF_T, section: 'comm' }] },
  { key: 'meetings', title: 'جلسات اولیا', icon: 'users-round', desc: 'برنامه‌ریزی و ثبت صورت‌جلسه ملاقات با اولیا', nav: [
    { label: 'جلسات اولیا', href: '/meetings', icon: 'users-round', roles: ALL, section: 'comm' }] },
  { key: 'documents', title: 'مدارک و فایل‌های پرونده', icon: 'folder-open', desc: 'بارگذاری مدارک در پرونده دانش‌آموز (شناسنامه، عکس، ...)', nav: [] },
  { key: 'health', title: 'بهداشت و سلامت', icon: 'stethoscope', desc: 'سوابق مراجعه به بهداشت مدرسه', nav: [
    { label: 'بهداشت و سلامت', href: '/health', icon: 'heart-pulse', roles: STAFF, section: 'services' , perm: 'health' }] },
  { key: 'finance', title: 'امور مالی', icon: 'wallet', desc: 'شهریه، پرداخت‌ها، بدهکاران و رسید', nav: [
    { label: 'امور مالی', href: '/finance', icon: 'wallet', roles: ['admin', 'deputy', 'student'], section: 'services' , perm: 'finance' },
    { label: 'گزارش درآمد', href: '/finance/income', icon: 'banknote', roles: ['admin', 'deputy'], section: 'services', perm: 'finance' }] },
  { key: 'library', title: 'کتابخانه', icon: 'library-big', desc: 'فهرست کتاب، امانت و بازگشت، دیرکرد', nav: [
    { label: 'کتابخانه', href: '/library', icon: 'library-big', roles: ALL, section: 'services' , perm: 'library' }] },
  { key: 'transport', title: 'سرویس مدرسه', icon: 'bus', desc: 'مسیرهای سرویس و تخصیص دانش‌آموز', nav: [
    { label: 'سرویس مدرسه', href: '/transport', icon: 'bus', roles: STAFF, section: 'services' , perm: 'transport' }] },
  { key: 'parents', title: 'پورتال اولیا', icon: 'baby', desc: 'حساب کاربری برای والدین؛ مشاهده حضور و غیاب، نمرات، تکالیف، مالی و مکاتبه با مدرسه برای هر فرزند', nav: [
    { label: 'فرزندان من', href: '/parent/children', icon: 'baby', roles: ['student'], parentOnly: true, section: 'main' },
    { label: 'حساب‌های اولیا', href: '/parents', icon: 'users-round', roles: STAFF, section: 'main', perm: 'parents' }] },
  { key: 'sms', title: 'پیامک و پیام گروهی', icon: 'send', desc: 'ارسال پیامک (ippanel)، پیام گروهی به اولیا/کلاس/معلمان، قالب پیام و گزارش ارسال', nav: [
    { label: 'پیام گروهی', href: '/messages', icon: 'send', roles: STAFF, section: 'comm', perm: 'messaging' },
    { label: 'گزارش پیامک‌ها', href: '/sms/log', icon: 'smartphone', roles: STAFF, section: 'comm', perm: 'messaging' }] },
  { key: 'promotion', title: 'ارتقای پایان سال', icon: 'trending-up', desc: 'جادوگر پایان سال: ارتقا/مردودی/فارغ‌التحصیلی، ساخت کلاس‌های سال جدید و بایگانی سوابق', nav: [
    { label: 'ارتقای پایان سال', href: '/promotion', icon: 'trending-up', roles: STAFF, section: 'main', perm: 'promotion' }] },
  { key: 'exits', title: 'خروج و دیرکرد', icon: 'door-open', desc: 'برگه خروج دانش‌آموز، ورود با تأخیر و تحویل به اولیای مجاز', nav: [
    { label: 'خروج و دیرکرد', href: '/exits', icon: 'door-open', roles: ['admin', 'deputy', 'teacher'], section: 'edu', perm: 'exits' }] },
  { key: 'questionbank', title: 'بانک سؤال و برگه امتحانی', icon: 'clipboard-pen', desc: 'بانک سؤال هر درس، ساخت برگه امتحانی قابل چاپ', nav: [
    { label: 'بانک سؤال', href: '/questions', icon: 'circle-help', roles: STAFF_T, section: 'edu', perm: 'exams' },
    { label: 'برگه‌های امتحانی', href: '/papers', icon: 'clipboard-pen', roles: STAFF_T, section: 'edu', perm: 'exams' }] },
  { key: 'hr', title: 'منابع انسانی معلمان', icon: 'user-cog', desc: 'مرخصی، موظفی (بار تدریس)، ارزشیابی معلمان و جانشینی', nav: [
    { label: 'منابع انسانی', href: '/hr', icon: 'user-cog', roles: ['admin', 'deputy', 'teacher'], section: 'main', perm: 'hr' }] },
  { key: 'reports', title: 'گزارش‌ها و آمار', icon: 'chart-bar', desc: 'آمار کلی، حضور و غیاب، نمرات، تیکت‌ها و مالی', nav: [
    { label: 'گزارش‌ها', href: '/reports', icon: 'chart-bar', roles: STAFF, section: 'system' , perm: 'reports' }] },
  { key: 'audit', title: 'گزارش فعالیت‌ها', icon: 'history', desc: 'ثبت تمام تغییرات مهم و ورودها', nav: [
    { label: 'گزارش فعالیت‌ها', href: '/audit', icon: 'history', roles: ['admin'], section: 'system' }] },
  { key: 'backup', title: 'پشتیبان‌گیری', icon: 'database-backup', desc: 'خروجی کامل داده‌ها و فایل پایگاه داده', nav: [
    { label: 'پشتیبان‌گیری', href: '/backup', icon: 'database-backup', roles: ['admin'], section: 'super', super: true }] },
  { key: 'settings', title: 'تنظیمات و کاربران', icon: 'settings', core: true, desc: 'تنظیمات مدرسه، کاربران، ماژول‌ها', nav: [
    { label: 'کاربران', href: '/users', icon: 'users', roles: ['admin'], section: 'system' },
    { label: 'تنظیمات', href: '/settings', icon: 'settings', roles: ['admin'], section: 'system' },
    { label: 'امنیت و قفل‌ها', href: '/security', icon: 'shield-check', roles: ['admin'], section: 'system' },
    ] },
  { key: 'superadmin', title: 'پنل سوپر ادمین', icon: 'shield-check', core: true, hidden: true, desc: 'قفل دامنه، ماژول‌ها، پیامک و تنظیمات فنی (فقط سوپر ادمین)', nav: [
    { label: 'پنل سوپر ادمین', href: '/super', icon: 'shield-check', roles: ['admin'], section: 'super', super: true },
    { label: 'ماژول‌ها', href: '/modules', icon: 'puzzle', roles: ['admin'], section: 'super', super: true },
    { label: 'قفل دامنه', href: '/super/domain', icon: 'lock', roles: ['admin'], section: 'super', super: true },
    { label: 'پشتیبان بیرونی', href: '/super/offsite', icon: 'cloud-upload', roles: ['admin'], section: 'super', super: true },
    { label: 'سلامت و کارایی', href: '/super/health', icon: 'activity', roles: ['admin'], section: 'super', super: true },
    { label: 'تنظیمات فنی و پیامک', href: '/settings?tab=sms', icon: 'smartphone', roles: ['admin'], section: 'super', super: true },
    { label: 'پرونده‌ی فروش و پشتیبانی', href: '/super/billing', icon: 'wallet', roles: ['admin'], section: 'super', super: true }] },
];
const SECTIONS = { main: 'مدیریت پایه', edu: 'آموزش', comm: 'ارتباطات', services: 'خدمات', system: 'سامانه', super: 'سوپر ادمین' };
const byKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));

let state = {};
async function load() {
  const rows = await db.get()('modules_state').select('key', 'enabled');
  state = {};
  for (const m of MODULES) state[m.key] = true;
  for (const r of rows) if (r.key in byKey) state[r.key] = !!r.enabled;
  for (const m of MODULES) if (m.core) state[m.key] = true;
  return state;
}
const isEnabled = (key) => !!state[key];
const enabledList = () => MODULES.filter((m) => state[m.key]).map((m) => m.key);
async function setEnabled(key, enabled) {
  const m = byKey[key];
  if (!m || m.core) return false;
  const knex = db.get();
  const ex = await knex('modules_state').where({ key }).first();
  if (ex) await knex('modules_state').where({ key }).update({ enabled: enabled ? 1 : 0 });
  else await knex('modules_state').insert({ key, enabled: enabled ? 1 : 0 });
  state[key] = !!enabled;
  return true;
}
function navFor(role, badges = {}, user = null) {
  const sections = {};
  const perms = require('./permissions');
  for (const m of MODULES) {
    if (!state[m.key]) continue;
    for (const n of m.nav) {
      if (!n.roles.includes(role)) continue;
      if (n.super && !(user && user.isSuper)) continue;
      if (n.parentOnly && !(user && user.realRole === 'parent')) continue;
      if (n.perm && user && user.role === 'deputy' && !perms.can(user, n.perm)) continue;
      (sections[n.section] = sections[n.section] || []).push({ ...n, badgeCount: n.badge ? badges[n.badge] || 0 : 0 });
    }
  }
  return Object.keys(SECTIONS).filter((s) => sections[s]).map((s) => ({ key: s, title: SECTIONS[s], items: sections[s] }));
}
/** میدلور محافظ مسیر ماژول */
function guard(key) {
  return (req, res, next) => {
    if (state[key]) return next();
    res.status(404).view('error', { code: 404, title: 'ماژول غیرفعال است', message: `ماژول «${byKey[key].title}» توسط مدیر غیرفعال شده است.` });
  };
}
module.exports = { MODULES, SECTIONS, byKey, load, isEnabled, enabledList, setEnabled, navFor, guard, STAFF, ALL, STAFF_T };

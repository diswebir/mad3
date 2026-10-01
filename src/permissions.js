'use strict';
/**
 * سطح دسترسی دقیق برای کاربران «کارمند/معاون» (نقش deputy).
 * مدیر (admin) همه‌چیز را دارد. کارمندی که فیلد permissions او خالی باشد (سازگار با نسخه ۱) دسترسی کامل دارد.
 */
const PERMS = {
  attendance: 'حضور و غیاب', grades: 'نمرات و کارنامه', exams: 'امتحانات و بانک سؤال', timetable: 'برنامه هفتگی و جانشینی',
  discipline: 'انضباطی', health: 'بهداشت و سلامت', finance: 'امور مالی', library: 'کتابخانه', transport: 'سرویس مدرسه',
  reports: 'گزارش‌ها', messaging: 'پیام گروهی و پیامک', hr: 'منابع انسانی معلمان', promotion: 'ارتقای پایان سال', exits: 'خروج و دیرکرد', parents: 'حساب اولیا',
};
const PRESETS = {
  full: { label: 'دسترسی کامل (معاون)', perms: Object.keys(PERMS) },
  academic: { label: 'معاون آموزشی', perms: ['attendance', 'grades', 'exams', 'timetable', 'reports', 'promotion', 'hr', 'messaging', 'exits'] },
  discipline: { label: 'معاون پرورشی/انضباطی', perms: ['attendance', 'discipline', 'health', 'reports', 'messaging', 'exits', 'parents'] },
  accountant: { label: 'حسابدار', perms: ['finance', 'transport', 'reports'] },
  librarian: { label: 'کتابدار', perms: ['library'] },
  office: { label: 'مسئول دفتر', perms: ['attendance', 'messaging', 'exits', 'parents', 'transport', 'library'] },
};
/** پیشوند مسیر → مجوز لازم (برای نقش deputy) */
const PATHS = [
  ['/attendance', 'attendance'], ['/grades', 'grades'], ['/exams', 'exams'], ['/questions', 'exams'], ['/papers', 'exams'],
  ['/discipline', 'discipline'], ['/health', 'health'], ['/finance', 'finance'], ['/library', 'library'], ['/transport', 'transport'],
  ['/reports', 'reports'], ['/messages', 'messaging'], ['/message-templates', 'messaging'], ['/sms', 'messaging'], ['/hr', 'hr'], ['/promotion', 'promotion'], ['/exits', 'exits'], ['/parents', 'parents'],
];
/** مسیرهای مدیریتی برنامه هفتگی (مشاهده برای همه آزاد است) */
const TIMETABLE_ADMIN = ['/timetable/auto', '/timetable/substitutes', '/timetable/availability'];

function parse(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((x) => PERMS[x]) : null; } catch (_) { return null; }
}
/** آیا کاربر مجوز perm را دارد؟ */
function can(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'deputy') return false;
  const list = user.permList === undefined ? parse(user.permissions) : user.permList;
  return list === null ? true : list.includes(perm);
}
function required(method, path) {
  for (const p of TIMETABLE_ADMIN) if (path === p || path.startsWith(p + '/')) return 'timetable';
  if (method !== 'GET' && (path === '/timetable' || path.startsWith('/timetable/'))) return 'timetable';
  for (const [prefix, perm] of PATHS) if (path === prefix || path.startsWith(prefix + '/')) return perm;
  return null;
}
function guard(req, res, next) {
  const u = req.user;
  if (u && u.role === 'deputy') {
    if (u.permList === undefined) u.permList = parse(u.permissions);
    const need = required(req.method, req.path);
    if (need && !can(u, need)) return res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: `دسترسی «${PERMS[need]}» برای حساب شما فعال نیست. با مدیر سامانه هماهنگ کنید.` });
  }
  next();
}
module.exports = { PERMS, PRESETS, can, parse, guard, required };

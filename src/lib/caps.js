'use strict';
/**
 * سامانه‌ی دسترسی دقیق (RBAC) — «قابلیت‌ها»ی ریزدانه برای مدیر/معاون/معلم.
 *
 * مدل:
 *  - هر «قابلیت» (capability) یک کار مشخص است؛ مثل events.create یا grades.enter.
 *  - هر قابلیت یک پیش‌فرض بر اساس نقش دارد (همان رفتار نسخه‌های قبل؛ هیچ چیز بدون اراده‌ی مدیر تغییر نمی‌کند).
 *  - مدیر می‌تواند برای هر نفر، جداگانه «مجاز / ممنوع / پیش‌فرض» تعیین کند و الگوی آماده (پروفایل) نیز تخصیص دهد.
 *  - اولویت (از قوی به ضعیف): تنظیم شخصی ← الگوی دسترسی ← پیش‌فرض نقش.
 *  - مدیر (admin) و سوپر ادمین همیشه همه‌چیز دارند و قابل محدودسازی نیستند.
 *  - دانش‌آموز و اولیا هرگز مشمول این سیستم نیستند (نقش آن‌ها ثابت است).
 *
 * اعمال: میدلور guard مسیر درخواست را با جدول مسیر→قابلیت تطبیق می‌دهد؛ اگر قابلیت خاموش باشد 403 می‌دهد.
 * اگر روشن باشد اما نقش کاربر به‌طور پیش‌فرض اجازه‌ی آن مسیر را نداشته باشد (مثلاً معلم + ایجاد رویداد)، فقط
 * برای همان درخواست «ارتقای موقت نقش» انجام می‌شود تا بقیه‌ی منطق برنامه بدون تغییر کار کند.
 */
const db = require('../db');

const S = ['deputy']; const T = ['deputy', 'teacher']; const A = [];
const GROUPS = {
  attendance: 'حضور و غیاب', timetable: 'برنامه هفتگی و زنگ‌ها', calendar: 'تقویم و رویدادها', classes: 'کلاس‌ها و دروس',
  students: 'دانش‌آموزان و پرونده', teachers: 'معلمان', grades: 'نمرات و ارزشیابی', homework: 'تکالیف', exams: 'امتحانات و بانک سؤال',
  discipline: 'انضباطی و جلسات', tickets: 'تیکت‌ها', messaging: 'پیام‌رسانی و اطلاعیه', finance: 'امور مالی', services: 'کتابخانه، بهداشت و سرویس',
  hr: 'منابع انسانی معلمان', parents: 'حساب اولیا', exits: 'خروج و دیرکرد', reports: 'گزارش‌ها', admin: 'مدیریتی و حساس', scope: 'دامنه‌ی دسترسی',
};

const REG = []; const BY = {};
/** افزودن قابلیت. roles = نقش‌هایی که به‌طور پیش‌فرض دارند (admin همیشه دارد). gate:'admin' یعنی مسیر فعلاً فقط برای مدیر باز است */
function add(group, key, label, roles, routes, o = {}) {
  if (BY[key]) throw new Error('capability duplicate: ' + key);
  const e = { key, group, label, roles, routes: routes || [], area: o.area || null, risk: o.risk || 'normal', gate: o.gate || null, hint: o.hint || '' };
  REG.push(e); BY[key] = e;
}

/* ---------- حضور و غیاب ---------- */
add('attendance', 'attendance.view', 'مشاهده‌ی صفحه‌ی حضور و غیاب و گزارش‌ها', T, ['GET /attendance', 'GET /attendance/report', 'GET /attendance/absentees', 'GET /attendance/late'], { area: 'attendance' });
add('attendance', 'attendance.record', 'ثبت و ویرایش حضور و غیاب', T, ['POST /attendance'], { area: 'attendance' });
add('attendance', 'attendance.gate', 'ثبت ورود با QR (درگاه ورود)', S, ['GET /attendance/gate', 'POST /attendance/gate'], { area: 'attendance' });
/* ---------- برنامه هفتگی ---------- */
add('timetable', 'timetable.view', 'مشاهده و خروجی برنامه هفتگی', T, ['GET /timetable', 'GET /timetable/export.xlsx']);
add('timetable', 'timetable.overview', 'نمای کلی برنامه (همه‌ی کلاس‌ها)', S, ['GET /timetable/overview'], { area: 'timetable' });
add('timetable', 'timetable.edit', 'ویرایش برنامه‌ی هفتگی کلاس‌ها', S, ['GET /timetable?edit=1', 'POST /timetable'], { area: 'timetable', risk: 'high' });
add('timetable', 'timetable.bells', 'مدیریت ساعت زنگ‌ها', S, ['GET /timetable/bells', 'GET /timetable/bells/new', 'GET /timetable/bells/:n/edit', 'POST /timetable/bells/save', 'POST /timetable/bells/:n/delete', 'POST /timetable/bells/cleanup'], { area: 'timetable' });
add('timetable', 'timetable.availability', 'ثبت محدودیت زمانی معلمان', S, ['GET /timetable/availability', 'POST /timetable/availability'], { area: 'timetable' });
add('timetable', 'timetable.auto', 'چیدمان خودکار برنامه', S, ['GET /timetable/auto', 'POST /timetable/auto'], { area: 'timetable', risk: 'high' });
add('timetable', 'timetable.substitutes', 'جانشینی معلم', S, ['GET /timetable/substitutes', 'POST /timetable/substitutes'], { area: 'timetable' });
add('timetable', 'holidays.view', 'مشاهده‌ی تعطیلات و تقویم آموزشی', S, ['GET /holidays'], { area: 'timetable' });
add('timetable', 'holidays.manage', 'افزودن/ویرایش/حذف تعطیلات', S, ['POST /holidays', 'POST /holidays/fixed', 'POST /holidays/:n/update', 'POST /holidays/:n/delete'], { area: 'timetable' });
/* ---------- تقویم ---------- */
add('calendar', 'calendar.view', 'مشاهده‌ی تقویم مدرسه', T, ['GET /calendar']);
/* ---------- کلاس‌ها ---------- */
add('classes', 'classes.view', 'مشاهده‌ی کلاس‌ها و جزئیات', T, ['GET /classes', 'GET /classes/:n', 'GET /classes/:n/print']);
add('classes', 'classes.create', 'ایجاد کلاس', S, ['GET /classes/new', 'POST /classes/new']);
add('classes', 'classes.edit', 'ویرایش کلاس', S, ['GET /classes/:n/edit', 'POST /classes/:n/edit']);
add('classes', 'classes.delete', 'حذف کلاس', S, ['POST /classes/:n/delete'], { risk: 'high' });
add('classes', 'classes.curriculum', 'تعیین دروس، معلم و ساعت‌های هفتگی کلاس', S, ['POST /classes/:n/subjects', 'POST /classes/:n/subjects/:n/update', 'POST /classes/:n/subjects/:n/delete', 'GET /classes/:n/curriculum', 'POST /classes/:n/curriculum', 'POST /classes/:n/curriculum/:s', 'POST /teachers/:n/assignments'], { hint: 'برنامه‌ریز درسی' });
add('classes', 'classes.students', 'افزودن/حذف دانش‌آموز از کلاس', S, ['POST /classes/:n/add-students', 'POST /classes/:n/remove-student/:n']);
/* ---------- دانش‌آموزان ---------- */
add('students', 'students.view', 'مشاهده‌ی لیست و پرونده‌ی دانش‌آموزان', T, ['GET /students', 'GET /students/:n', 'GET /students/:n/print']);
add('students', 'students.export', 'خروجی CSV دانش‌آموزان', T, ['GET /students/export.csv'], { risk: 'high' });
add('students', 'students.create', 'ثبت‌نام دانش‌آموز جدید', S, ['GET /students/new', 'POST /students/new']);
add('students', 'students.import', 'ورود گروهی دانش‌آموزان (اکسل/CSV)', S, ['GET /students/import', 'GET /students/import/template.csv', 'POST /students/import']);
add('students', 'students.edit', 'ویرایش مشخصات دانش‌آموز', S, ['GET /students/:n/edit', 'POST /students/:n/edit']);
add('students', 'students.status', 'تغییر وضعیت دانش‌آموز (فعال/انتقالی/…)', S, ['POST /students/:n/status']);
add('students', 'students.bulk', 'عملیات گروهی روی دانش‌آموزان', S, ['POST /students/bulk'], { risk: 'high' });
add('students', 'students.delete', 'حذف دانش‌آموز', S, ['POST /students/:n/delete'], { risk: 'high' });
add('students', 'students.reset_password', 'بازنشانی رمز دانش‌آموز', S, ['POST /students/:n/reset-password'], { risk: 'high' });
add('students', 'students.notes', 'ثبت و حذف یادداشت پرونده', T, ['POST /students/:n/notes', 'POST /students/:n/notes/:n/delete']);
add('students', 'students.documents', 'بارگذاری و حذف مدارک پرونده', S, ['POST /students/:n/documents', 'POST /students/:n/documents/:n/delete']);
add('students', 'students.guardians', 'مدیریت اولیای مجاز (تحویل‌گیرنده)', S, ['POST /students/:n/guardians', 'POST /students/:n/guardians/:n/delete']);
add('students', 'students.cards', 'چاپ کارت دانش‌آموزی', S, ['GET /students/:n/card', 'GET /classes/:n/cards']);
/* ---------- معلمان ---------- */
add('teachers', 'teachers.view', 'مشاهده‌ی معلمان و بار کاری', S, ['GET /teachers', 'GET /teachers/:n']);
add('teachers', 'teachers.export', 'خروجی CSV معلمان', S, ['GET /teachers/export.csv'], { risk: 'high' });
add('teachers', 'teachers.create', 'افزودن معلم', S, ['GET /teachers/new', 'POST /teachers/new']);
add('teachers', 'teachers.edit', 'ویرایش مشخصات معلم', S, ['GET /teachers/:n/edit', 'POST /teachers/:n/edit']);
add('teachers', 'teachers.reset_password', 'بازنشانی رمز معلم', S, ['POST /teachers/:n/reset-password'], { risk: 'high' });
add('teachers', 'teachers.delete', 'حذف معلم', S, ['POST /teachers/:n/delete'], { risk: 'high' });
/* ---------- نمرات ---------- */
add('grades', 'grades.view', 'مشاهده‌ی ارزشیابی‌ها و نمرات', T, ['GET /grades', 'GET /grades/cs/:n', 'GET /grades/assessments/:n', 'GET /grades/class/:n'], { area: 'grades' });
add('grades', 'grades.assessment.create', 'تعریف ارزشیابی (آزمون/تکلیف/پروژه…)', T, ['POST /grades/cs/:n/assessments'], { area: 'grades' });
add('grades', 'grades.assessment.edit', 'ویرایش مشخصات ارزشیابی (بارم، ضریب، تاریخ)', T, ['POST /grades/assessments/:n/update'], { area: 'grades' });
add('grades', 'grades.assessment.delete', 'حذف ارزشیابی و نمره‌های آن', T, ['POST /grades/assessments/:n/delete'], { area: 'grades', risk: 'high' });
add('grades', 'grades.enter', 'ثبت و ویرایش نمره‌ی دانش‌آموزان', T, ['POST /grades/assessments/:n/scores'], { area: 'grades', risk: 'high' });
add('grades', 'grades.import', 'ورود نمره از فایل اکسل/CSV', T, ['GET /grades/assessments/:n/template.*', 'POST /grades/assessments/:n/import', 'POST /grades/assessments/:n/import/commit'], { area: 'grades' });
add('grades', 'grades.publish', 'انتشار نمرات برای دانش‌آموز/اولیا', T, ['POST /grades/assessments/:n/publish'], { area: 'grades', risk: 'high' });
add('grades', 'grades.lock', 'قفل کردن نمرات', T, ['POST /grades/assessments/:n/lock'], { area: 'grades' });
add('grades', 'grades.unlock', 'باز کردن قفل نمرات', S, [], { area: 'grades', risk: 'high', hint: 'بدون مسیر مستقل؛ داخل عملیات قفل بررسی می‌شود' });
add('grades', 'grades.edit_locked', 'اصلاح نمره‌ی قفل‌شده (با ثبت دلیل)', S, [], { area: 'grades', risk: 'high', hint: 'بدون مسیر مستقل؛ داخل ثبت نمره بررسی می‌شود' });
add('grades', 'grades.history', 'مشاهده‌ی تاریخچه‌ی تغییر نمره', T, ['GET /grades/assessments/:n/history'], { area: 'grades' });
add('grades', 'grades.reportcard', 'مشاهده/چاپ کارنامه', T, ['GET /grades/report-card/:n', 'GET /grades/class/:n/cards'], { area: 'grades' });
add('grades', 'grades.comments', 'ثبت توصیف و نظر کارنامه (معلم راهنما)', T, ['GET /grades/class/:n/comments', 'POST /grades/class/:n/comments'], { area: 'grades' });
/* ---------- تکالیف ---------- */
add('homework', 'homework.view', 'مشاهده‌ی تکالیف', T, ['GET /homework', 'GET /homework/:n']);
add('homework', 'homework.create', 'تعریف تکلیف', T, ['GET /homework/new', 'POST /homework/new']);
add('homework', 'homework.edit', 'ویرایش تکلیف', T, ['GET /homework/:n/edit', 'POST /homework/:n/edit']);
add('homework', 'homework.delete', 'حذف تکلیف', T, ['POST /homework/:n/delete']);
add('homework', 'homework.grade', 'نمره‌دهی به تحویل‌ها', T, ['POST /homework/:n/grade']);
/* ---------- امتحانات و سؤال ---------- */
add('exams', 'exams.view', 'مشاهده‌ی برنامه‌ی امتحانات', T, ['GET /exams'], { area: 'exams' });
add('exams', 'exams.create', 'ثبت امتحان جدید', S, ['GET /exams/new', 'POST /exams/new'], { area: 'exams' });
add('exams', 'exams.edit', 'ویرایش امتحان', S, ['GET /exams/:n/edit', 'POST /exams/:n/edit'], { area: 'exams' });
add('exams', 'exams.delete', 'حذف امتحان', S, ['POST /exams/:n/delete'], { area: 'exams' });
add('exams', 'questions.view', 'مشاهده‌ی بانک سؤال', T, ['GET /questions', 'GET /papers', 'GET /papers/:n'], { area: 'exams' });
add('exams', 'questions.manage', 'ایجاد/ویرایش/حذف سؤال', T, ['GET /questions/new', 'POST /questions/new', 'GET /questions/:n/edit', 'POST /questions/:n/edit', 'POST /questions/:n/delete'], { area: 'exams' });
add('exams', 'papers.manage', 'ساخت و حذف برگه‌ی امتحانی', T, ['GET /papers/new', 'POST /papers', 'POST /papers/:n/delete'], { area: 'exams' });
/* ---------- انضباطی و جلسات ---------- */
add('discipline', 'discipline.view', 'مشاهده‌ی موارد انضباطی', T, ['GET /discipline', 'GET /discipline/export.csv'], { area: 'discipline' });
add('discipline', 'discipline.create', 'ثبت مورد تشویقی/انضباطی', T, ['GET /discipline/new', 'POST /discipline/new'], { area: 'discipline' });
add('discipline', 'discipline.edit', 'ویرایش مورد انضباطی', T, ['GET /discipline/:n/edit', 'POST /discipline/:n/edit'], { area: 'discipline' });
add('discipline', 'discipline.delete', 'حذف مورد انضباطی', T, ['POST /discipline/:n/delete'], { area: 'discipline', risk: 'high' });
add('discipline', 'meetings.view', 'مشاهده‌ی جلسات اولیا', T, ['GET /meetings', 'GET /meetings/export.csv']);
add('discipline', 'meetings.create', 'ثبت جلسه‌ی اولیا', T, ['GET /meetings/new', 'POST /meetings/new']);
add('discipline', 'meetings.edit', 'ویرایش جلسه', T, ['GET /meetings/:n/edit', 'POST /meetings/:n/edit']);
add('discipline', 'meetings.delete', 'حذف جلسه', T, ['POST /meetings/:n/delete']);
/* ---------- تیکت‌ها ---------- */
add('tickets', 'tickets.view', 'مشاهده‌ی تیکت‌ها', T, ['GET /tickets', 'GET /tickets/:n']);
add('tickets', 'tickets.create', 'ایجاد تیکت', T, ['GET /tickets/new', 'POST /tickets/new']);
add('tickets', 'tickets.reply', 'پاسخ به تیکت', T, ['POST /tickets/:n/reply']);
add('tickets', 'tickets.close', 'بستن و بازگشایی تیکت', T, ['POST /tickets/:n/close', 'POST /tickets/:n/reopen']);
add('tickets', 'tickets.priority', 'تغییر اولویت تیکت', S, ['POST /tickets/:n/priority']);
add('tickets', 'tickets.assign', 'ارجاع تیکت به شخص دیگر', S, ['POST /tickets/:n/assign']);
add('tickets', 'tickets.justify', 'تأیید/رد توجیه غیبت', T, ['POST /tickets/:n/justify']);
/* ---------- پیام‌رسانی ---------- */
add('messaging', 'announcements.view', 'مشاهده‌ی اطلاعیه‌ها', T, ['GET /announcements']);
add('messaging', 'announcements.create', 'انتشار اطلاعیه', T, ['GET /announcements/new', 'POST /announcements/new']);
add('messaging', 'announcements.edit', 'ویرایش اطلاعیه', T, ['GET /announcements/:n/edit', 'POST /announcements/:n/edit']);
add('messaging', 'announcements.delete', 'حذف اطلاعیه', T, ['POST /announcements/:n/delete']);
add('messaging', 'messaging.view', 'مشاهده‌ی پیام گروهی و گزارش پیامک', S, ['GET /messages', 'GET /sms/log'], { area: 'messaging' });
add('messaging', 'messaging.send', 'ارسال پیام/پیامک گروهی', S, ['POST /messages/send'], { area: 'messaging', risk: 'high' });
add('messaging', 'messaging.test', 'ارسال پیامک آزمایشی', S, ['POST /sms/test'], { area: 'messaging' });
add('messaging', 'messaging.retry', 'ارسال مجدد پیامک‌های ناموفق', S, ['POST /sms/retry'], { area: 'messaging' });
add('messaging', 'templates.view', 'مشاهده‌ی قالب‌های پیام', S, ['GET /message-templates'], { area: 'messaging' });
add('messaging', 'templates.manage', 'مدیریت قالب‌های پیام', S, ['GET /message-templates/new', 'POST /message-templates/new', 'GET /message-templates/:n/edit', 'POST /message-templates/:n/edit', 'POST /message-templates/:n/delete'], { area: 'messaging' });
add('messaging', 'birthdays.view', 'مشاهده‌ی تولدها', T, ['GET /birthdays', 'GET /birthdays/export.csv']);
add('messaging', 'birthdays.greet', 'ارسال تبریک تولد', S, ['POST /birthdays/run', 'POST /birthdays/:n/greet']);
/* ---------- تقویم/رویداد (منابع) ---------- */
add('calendar', 'events.view', 'مشاهده‌ی لیست مدیریت رویدادها', S, ['GET /events', 'GET /events/export.csv']);
add('calendar', 'events.create', 'افزودن رویداد به تقویم', S, ['GET /events/new', 'POST /events/new'], { hint: 'مثلاً اجازه‌ی معلم برای افزودن رویداد به تقویم' });
add('calendar', 'events.edit', 'ویرایش رویداد تقویم', S, ['GET /events/:n/edit', 'POST /events/:n/edit']);
add('calendar', 'events.delete', 'حذف رویداد تقویم', S, ['POST /events/:n/delete']);
/* ---------- مالی ---------- */
add('finance', 'finance.view', 'مشاهده‌ی شهریه‌ها، بدهکاران و رسید', S, ['GET /finance', 'GET /finance/debtors', 'GET /finance/fees/:n', 'GET /finance/receipt/:n'], { area: 'finance' });
add('finance', 'finance.income', 'گزارش درآمد', S, ['GET /finance/income'], { area: 'finance', risk: 'high' });
add('finance', 'finance.fee.create', 'صدور شهریه', S, ['GET /finance/fees/new', 'POST /finance/fees/new'], { area: 'finance' });
add('finance', 'finance.pay', 'ثبت پرداخت', S, ['POST /finance/fees/:n/pay'], { area: 'finance', risk: 'high' });
add('finance', 'finance.void', 'ابطال پرداخت', S, ['POST /finance/payments/:n/void'], { area: 'finance', risk: 'high' });
add('finance', 'finance.fee.delete', 'حذف شهریه', S, ['POST /finance/fees/:n/delete'], { area: 'finance', risk: 'high' });
add('finance', 'finance.payment.delete', 'حذف قطعی پرداخت', A, ['POST /finance/payments/:n/delete'], { area: 'finance', risk: 'high', gate: 'admin' });
add('finance', 'finance.remind', 'یادآوری گروهی بدهکاران', S, ['POST /finance/debtors/remind'], { area: 'finance', risk: 'high' });
/* ---------- کتابخانه، بهداشت، سرویس ---------- */
add('services', 'books.view', 'مشاهده‌ی کتاب‌ها و امانت‌ها', T, ['GET /library', 'GET /library/loans', 'GET /library/books', 'GET /library/books/export.csv'], { area: 'library' });
add('services', 'books.manage', 'افزودن/ویرایش/حذف کتاب', S, ['GET /library/books/new', 'POST /library/books/new', 'GET /library/books/:n/edit', 'POST /library/books/:n/edit', 'POST /library/books/:n/delete'], { area: 'library' });
add('services', 'library.loan', 'ثبت امانت کتاب', S, ['POST /library/loans'], { area: 'library' });
add('services', 'library.return', 'ثبت بازگشت کتاب', S, ['POST /library/loans/:n/return'], { area: 'library' });
add('services', 'health.view', 'مشاهده‌ی سوابق بهداشت و سلامت', S, ['GET /health', 'GET /health/export.csv'], { area: 'health', risk: 'high' });
add('services', 'health.manage', 'ثبت/ویرایش/حذف سابقه‌ی سلامت', S, ['GET /health/new', 'POST /health/new', 'GET /health/:n/edit', 'POST /health/:n/edit', 'POST /health/:n/delete'], { area: 'health', risk: 'high' });
add('services', 'transport.view', 'مشاهده‌ی مسیرهای سرویس', S, ['GET /transport', 'GET /transport/export.csv'], { area: 'transport' });
add('services', 'transport.manage', 'مدیریت مسیرهای سرویس', S, ['GET /transport/new', 'POST /transport/new', 'GET /transport/:n/edit', 'POST /transport/:n/edit', 'POST /transport/:n/delete'], { area: 'transport' });
/* ---------- منابع انسانی ---------- */
add('hr', 'hr.view', 'مشاهده‌ی منابع انسانی (موظفی، مرخصی، ارزشیابی)', T, ['GET /hr', 'GET /hr/leaves', 'GET /hr/leaves/new', 'GET /hr/teacher/:n'], { area: 'hr' });
add('hr', 'hr.leave.request', 'ثبت درخواست مرخصی', T, ['POST /hr/leaves'], { area: 'hr' });
add('hr', 'hr.leave.decide', 'تأیید/رد مرخصی', S, ['POST /hr/leaves/:n/decide'], { area: 'hr', risk: 'high' });
add('hr', 'hr.leave.delete', 'حذف مرخصی (معلم: فقط لغو درخواست در انتظارِ خودش)', T, ['POST /hr/leaves/:n/delete'], { area: 'hr' });
add('hr', 'hr.load.edit', 'تعیین موظفی (ساعت هفتگی) معلم', S, ['POST /hr/teacher/:n/load'], { area: 'hr' });
add('hr', 'hr.evaluate', 'ثبت ارزشیابی معلم', S, ['GET /hr/evaluations/new', 'POST /hr/evaluations'], { area: 'hr', risk: 'high' });
add('hr', 'hr.evaluation.delete', 'حذف ارزشیابی معلم', A, ['POST /hr/evaluations/:n/delete'], { area: 'hr', gate: 'admin', risk: 'high' });
/* ---------- اولیا، خروج ---------- */
add('parents', 'parents.view', 'مشاهده‌ی حساب‌های اولیا', S, ['GET /parents'], { area: 'parents' });
add('parents', 'parents.create', 'ایجاد حساب اولیا (تکی/گروهی)', S, ['POST /parents/create', 'POST /parents/bulk', 'POST /parents/credentials.xlsx'], { area: 'parents', risk: 'high' });
add('parents', 'parents.manage', 'بازنشانی رمز، قطع ارتباط و حذف حساب اولیا', S, ['POST /parents/:n/reset-password', 'POST /parents/:n/unlink/:n', 'POST /parents/:n/delete'], { area: 'parents', risk: 'high' });
add('exits', 'exits.view', 'مشاهده‌ی برگه‌های خروج و دیرکرد', T, ['GET /exits'], { area: 'exits' });
add('exits', 'exits.create', 'ثبت خروج/ورود با تأخیر', S, ['POST /exits'], { area: 'exits' });
add('exits', 'exits.delete', 'حذف برگه‌ی خروج', A, ['POST /exits/:n/delete'], { area: 'exits', gate: 'admin' });
/* ---------- گزارش‌ها ---------- */
add('reports', 'reports.view', 'مشاهده‌ی گزارش‌ها و تحلیل‌ها', S, ['GET /reports', 'GET /reports/risk', 'GET /reports/compare', 'GET /reports/trends'], { area: 'reports' });
add('reports', 'reports.export', 'خروجی CSV گزارش دانش‌آموزان', S, ['GET /reports/students.csv'], { area: 'reports', risk: 'high' });
/* ---------- مدیریتی ---------- */
add('admin', 'subjects.view', 'مشاهده‌ی فهرست دروس', S, ['GET /subjects', 'GET /subjects/export.csv']);
add('admin', 'subjects.manage', 'افزودن/ویرایش/حذف درس', S, ['GET /subjects/new', 'POST /subjects/new', 'GET /subjects/:n/edit', 'POST /subjects/:n/edit', 'POST /subjects/:n/delete']);
add('admin', 'years.manage', 'مدیریت سال‌های تحصیلی', S, ['GET /academic-years', 'GET /academic-years/new', 'POST /academic-years/new', 'GET /academic-years/:n/edit', 'POST /academic-years/:n/edit', 'POST /academic-years/:n/delete'], { risk: 'high' });
add('admin', 'promotion.view', 'مشاهده‌ی ارتقای پایان سال و بایگانی', A, ['GET /promotion', 'GET /promotion/archive'], { area: 'promotion', gate: 'admin' });
add('admin', 'promotion.run', 'اجرای ارتقا/برگشت ارتقای پایان سال', A, ['POST /promotion/plan', 'POST /promotion/apply', 'POST /promotion/undo/:n'], { area: 'promotion', gate: 'admin', risk: 'high' });
add('admin', 'audit.view', 'مشاهده‌ی گزارش فعالیت‌ها (ممیزی)', A, ['GET /audit'], { gate: 'admin', risk: 'high' });
/* ---------- دامنه ---------- */
add('scope', 'scope.all_classes', 'دسترسی به همه‌ی کلاس‌ها (نه فقط کلاس‌های خود معلم)', S, [], { risk: 'high', hint: 'معلم با این مجوز، قابلیت‌های روشن خود را روی همه‌ی کلاس‌ها اعمال می‌کند' });

/* ---------- مسیریابی ---------- */
const escRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
function compile(spec) {
  const m = /^(GET|POST) (\/[^?]*)(?:\?(\w+)=(\w+))?$/.exec(spec);
  if (!m) throw new Error('bad route spec ' + spec);
  const path = m[2];
  const rx = '^' + path.split('/').map((seg) => {
    if (seg === ':n') return '\\d+';
    if (seg === ':s') return '[^/]+';
    if (seg.endsWith('.*')) return escRe(seg.slice(0, -2)) + '\\.[a-z0-9]+';
    return escRe(seg);
  }).join('/') + '/?$';
  const lit = path.replace(/:[ns]/g, '').length;
  return { method: m[1], re: new RegExp(rx), q: m[3] ? [m[3], m[4]] : null, score: lit + (m[3] ? 1000 : 0), spec };
}
const TABLE = []; // {method, re, q, score, cap}
for (const e of REG) for (const r of e.routes) TABLE.push({ ...compile(r), cap: e });
TABLE.sort((a, b) => b.score - a.score);

/** مسیر + متد → قابلیتی که برای اجرا لازم است (یا null) */
function match(method, path, query = {}) {
  const meth = method === 'HEAD' ? 'GET' : method;
  for (const r of TABLE) {
    if (r.method !== meth || !r.re.test(path)) continue;
    if (r.q && String(query[r.q[0]]) !== r.q[1]) continue;
    return r.cap;
  }
  return null;
}

/* ---------- ارزیابی ---------- */
const STAFF_ROLES = ['admin', 'deputy', 'teacher'];
const baseRoleOf = (u) => (u && (u.baseRole || u.role)) || null;
const toSet = (a) => new Set(Array.isArray(a) ? a.filter((k) => BY[k]) : []);
function parseOv(raw) {
  if (!raw) return { allow: [], deny: [] };
  try { const o = typeof raw === 'string' ? JSON.parse(raw) : raw; return { allow: [].concat(o.allow || []).filter((k) => BY[k]), deny: [].concat(o.deny || []).filter((k) => BY[k]) }; } catch (_) { return { allow: [], deny: [] }; }
}
/** بارگذاری تنظیمات دسترسی کاربر (یک‌بار در هر درخواست؛ همیشه از پایگاه داده تا تغییر مجوز فوری اعمال شود) */
async function hydrate(u) {
  if (!u) return u;
  if (!STAFF_ROLES.includes(u.role)) return u;
  u.baseRole = u.role;
  const ov = parseOv(u.caps);
  let prof = null;
  if (u.profile_id) {
    const p = await db.get()('access_profiles').where({ id: u.profile_id }).first();
    if (p) { const po = parseOv(p.caps); prof = { id: p.id, name: p.name, allow: toSet(po.allow), deny: toSet(po.deny) }; }
  }
  u._caps = { ov: { allow: toSet(ov.allow), deny: toSet(ov.deny) }, prof };
  return u;
}
function areaOk(u, area) {
  if (!area) return true;
  const list = require('../permissions').parse(u.permissions);
  return list === null ? true : list.includes(area);
}
/** وضعیت یک قابلیت برای کاربر: {on, src} — src یکی از admin | user-allow | user-deny | profile-allow | profile-deny | role | none */
function stateOf(u, key) {
  const e = BY[key]; if (!u || !e) return { on: false, src: 'none' };
  const role = baseRoleOf(u);
  if (role === 'admin') return { on: true, src: 'admin' };
  if (!STAFF_ROLES.includes(role) || !u._caps) return { on: false, src: 'none' };
  const { ov, prof } = u._caps;
  if (ov.deny.has(key)) return { on: false, src: 'user-deny' };
  if (ov.allow.has(key)) return { on: true, src: 'user-allow' };
  if (prof) { if (prof.deny.has(key)) return { on: false, src: 'profile-deny' }; if (prof.allow.has(key)) return { on: true, src: 'profile-allow' }; }
  const def = e.roles.includes(role) && (role !== 'deputy' || areaOk(u, e.area));
  return { on: !!def, src: 'role' };
}
const has = (u, key) => stateOf(u, key).on;
/** آیا کاربر حداقل یکی از قابلیت‌های این بخش (area) را دارد؟ (برای سازگاری با مجوزهای کلی معاون) */
const hasArea = (u, area) => REG.some((e) => e.area === area && has(u, e.key));
const isGrant = (src) => src === 'user-allow' || src === 'profile-allow';

/** پیش‌فرض نقش برای نمایش در ماتریس */
function roleDefault(role, key, areas) {
  const e = BY[key]; if (!e) return false;
  if (role === 'admin') return true;
  if (!e.roles.includes(role)) return false;
  if (role === 'deputy' && e.area && Array.isArray(areas) && !areas.includes(e.area)) return false;
  return true;
}

/* ---------- نگهبان مسیر ---------- */
const deniedSeen = new Map();
function deny(req, res, e, why) {
  const u = req.user; const k = (u ? u.id : 0) + ':' + e.key; const now = Date.now();
  if (!deniedSeen.has(k) || now - deniedSeen.get(k) > 60000) {
    deniedSeen.set(k, now); if (deniedSeen.size > 2000) deniedSeen.clear();
    try { db.get()('audit_logs').insert({ user_id: u ? u.id : null, user_name: u ? u.full_name : null, action: 'denied', entity: 'capability', entity_id: e.key, details: `${req.method} ${String(req.originalUrl || '').slice(0, 150)}${why ? ' — ' + why : ''}`, ip: req.ip }).catch(() => {}); } catch (_) { /* */ }
  }
  const msg = `مجوز «${e.label}» برای حساب شما فعال نیست. در صورت نیاز با مدیر مدرسه هماهنگ کنید.`;
  if ((req.get('accept') || '').includes('application/json')) return res.status(403).json({ error: 'forbidden', capability: e.key });
  return res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: msg });
}
function elevate(req, res, e) {
  const u = req.user; const role = u.baseRole || u.role;
  if (role === 'admin') return;
  const natives = e.gate === 'admin' ? ['admin'] : ['admin'].concat(e.roles);
  if (natives.includes(role)) return; // نقش خودش به‌طور طبیعی از دروازه‌ی مسیر رد می‌شود
  u.realRole = u.realRole || role;
  u.role = e.gate === 'admin' ? 'admin' : 'deputy';
  u.elevated = true;
  res.locals.isManager = true;
}
function guard(req, res, next) {
  const u = req.user;
  if (!u || !u._caps) return u && u.role === 'deputy' ? require('../permissions').guard(req, res, next) : next();
  const e = match(req.method, req.path, req.query);
  if (!e) return require('../permissions').guard(req, res, next); // مسیر بدون قابلیت: رفتار قبلی
  const st = stateOf(u, e.key);
  if (!st.on) return deny(req, res, e, st.src);
  req.capKey = e.key;
  try { elevate(req, res, e); } catch (err) { return next(err); }
  next();
}

/** آیا آیتم منو برای این کاربر دیده شود؟ (true/false) — null یعنی نظری ندارد */
function navVisible(u, n) {
  if (!u || !u._caps) return null;
  const p = String(n.href || '').split('?')[0]; const q = {};
  const qs = String(n.href || '').split('?')[1]; if (qs) for (const kv of qs.split('&')) { const [a, b] = kv.split('='); q[a] = b; }
  const e = match('GET', p, q); if (!e) return null;
  const st = stateOf(u, e.key); if (!st.on) return false;
  const role = baseRoleOf(u);
  return n.roles.includes(role) || isGrant(st.src);
}

/** رکوردهای ماتریس برای رابط کاربری */
function matrixFor(row, profile) {
  const ov = parseOv(row.caps); const pr = profile ? parseOv(profile.caps) : { allow: [], deny: [] };
  const areas = require('../permissions').parse(row.permissions);
  const areasAll = areas === null ? Object.keys(require('../permissions').PERMS) : areas;
  const fake = { id: row.id, role: row.role, baseRole: row.role, permissions: row.permissions, _caps: { ov: { allow: toSet(ov.allow), deny: toSet(ov.deny) }, prof: profile ? { id: profile.id, name: profile.name, allow: toSet(pr.allow), deny: toSet(pr.deny) } : null } };
  return Object.keys(GROUPS).map((g) => ({
    key: g, title: GROUPS[g],
    items: REG.filter((e) => e.group === g).map((e) => {
      const st = stateOf(fake, e.key);
      return { ...e, def: roleDefault(row.role, e.key, areasAll), mine: ov.allow.includes(e.key) ? 'allow' : ov.deny.includes(e.key) ? 'deny' : 'inherit', prof: pr.allow.includes(e.key) ? 'allow' : pr.deny.includes(e.key) ? 'deny' : '', on: st.on, src: st.src };
    }),
  })).filter((g) => g.items.length);
}
/** ورودی فرم (cap[key]=allow|deny|inherit) → {allow, deny} پاک‌سازی‌شده */
function fromForm(body) {
  const out = { allow: [], deny: [] }; const m = body.cap || {};
  for (const k of Object.keys(m)) { if (!BY[k]) continue; if (m[k] === 'allow') out.allow.push(k); else if (m[k] === 'deny') out.deny.push(k); }
  return out;
}
const stringify = (o) => (o && (o.allow.length || o.deny.length) ? JSON.stringify({ allow: o.allow, deny: o.deny }) : null);
function diff(before, after) {
  const st = (o) => { const m = {}; o.allow.forEach((k) => { m[k] = 'allow'; }); o.deny.forEach((k) => { m[k] = 'deny'; }); return m; };
  const a = st(before); const b = st(after); const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 'inherit') !== (b[k] || 'inherit')) out.push({ key: k, from: a[k] || 'inherit', to: b[k] || 'inherit' });
  return out;
}

/** الگوهای آماده‌ی پیشنهادی (در نصب تازه ساخته می‌شوند) */
const DEFAULT_PROFILES = [
  { name: 'معلم + مدیریت تقویم', base_role: 'teacher', description: 'معلم می‌تواند رویدادهای تقویم مدرسه را ببیند، اضافه و ویرایش کند.', allow: ['events.view', 'events.create', 'events.edit'], deny: [] },
  { name: 'معلم راهنما (ارزشیابی کامل)', base_role: 'teacher', description: 'تعریف ارزشیابی، ثبت و انتشار نمره، ورود از اکسل و ثبت توصیف کارنامه.', allow: ['grades.view', 'grades.assessment.create', 'grades.assessment.edit', 'grades.enter', 'grades.import', 'grades.publish', 'grades.lock', 'grades.reportcard', 'grades.comments'], deny: [] },
  { name: 'معلم فقط‌مشاهده‌گر نمرات', base_role: 'teacher', description: 'نمرات را می‌بیند اما نمی‌تواند ثبت یا منتشر کند.', allow: [], deny: ['grades.enter', 'grades.assessment.create', 'grades.assessment.edit', 'grades.assessment.delete', 'grades.import', 'grades.publish'] },
  { name: 'برنامه‌ریز آموزشی', base_role: 'teacher', description: 'ویرایش برنامه هفتگی، دروس و معلم هر کلاس.', allow: ['timetable.overview', 'timetable.edit', 'timetable.availability', 'timetable.substitutes', 'classes.curriculum', 'subjects.view'], deny: [] },
  { name: 'معاون ناظر (فقط مشاهده)', base_role: 'deputy', description: 'همه‌ی بخش‌ها را می‌بیند اما ثبت، ویرایش و حذف ندارد.', allow: [], deny: REG.filter((e) => e.roles.includes('deputy') && !e.key.startsWith('scope.') && !/\.(view|overview|history|reportcard)$/.test(e.key)).map((e) => e.key) },
];
async function ensureDefaults(k = db.get()) {
  const n = Number((await k('access_profiles').count({ c: '*' }).first()).c);
  if (n) return 0;
  for (const p of DEFAULT_PROFILES) await k('access_profiles').insert({ name: p.name, description: p.description, base_role: p.base_role, caps: JSON.stringify({ allow: p.allow, deny: p.deny }) });
  return DEFAULT_PROFILES.length;
}

module.exports = { REG, BY, GROUPS, match, hydrate, stateOf, has, hasArea, isGrant, guard, navVisible, matrixFor, fromForm, stringify, parseOv, diff, roleDefault, ensureDefaults, DEFAULT_PROFILES, STAFF_ROLES };

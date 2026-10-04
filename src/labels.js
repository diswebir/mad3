'use strict';
/** برچسب‌های فارسی وضعیت‌ها و دسته‌بندی‌ها (مشترک بین ویوها و کنترلرها) */
const L = {
  roles: { superadmin: 'سوپر ادمین', admin: 'مدیر', deputy: 'معاون', teacher: 'معلم', student: 'دانش‌آموز', parent: 'اولیا' },
  gender: { male: 'پسر', female: 'دختر' },
  genderAdult: { male: 'مرد', female: 'زن' },
  studentStatus: { active: 'مشغول به تحصیل', graduated: 'فارغ‌التحصیل', transferred: 'منتقل‌شده', suspended: 'تعلیق', dropped: 'ترک تحصیل' },
  teacherStatus: { active: 'فعال', leave: 'مرخصی', inactive: 'غیرفعال' },
  attendance: { present: 'حاضر', absent: 'غایب', late: 'تأخیر', excused: 'غیبت موجه', leave: 'مرخصی' },
  attendanceShort: { present: 'ح', absent: 'غ', late: 'ت', excused: 'م', leave: 'ر' },
  ticketStatus: { open: 'باز', answered: 'پاسخ داده شده', pending: 'در انتظار پاسخ', closed: 'بسته' },
  ticketCategory: { general: 'عمومی', absence: 'توجیه غیبت', academic: 'آموزشی', discipline: 'انضباطی', finance: 'مالی', technical: 'فنی', suggestion: 'پیشنهاد و انتقاد', other: 'سایر' },
  priority: { low: 'کم', normal: 'عادی', high: 'مهم', urgent: 'فوری' },
  assessmentType: { quiz: 'کوئیز', continuous: 'مستمر', midterm: 'میان‌نوبت', final: 'پایان‌نوبت', project: 'پروژه', oral: 'شفاهی' },
  audience: { all: 'همه', teachers: 'معلمان', students: 'دانش‌آموزان', class: 'یک کلاس' },
  eventType: { event: 'رویداد', holiday: 'تعطیلی', exam: 'امتحان', meeting: 'جلسه', trip: 'اردو', ceremony: 'مراسم' },
  examType: { midterm: 'میان‌نوبت', final: 'پایان‌نوبت', quiz: 'کوئیز', makeup: 'جبرانی' },
  disciplineType: { positive: 'تشویق', negative: 'انضباطی' },
  meetingStatus: { scheduled: 'برنامه‌ریزی شده', held: 'برگزار شد', cancelled: 'لغو شد', missed: 'عدم حضور' },
  feeCategory: { tuition: 'شهریه', registration: 'ثبت‌نام', transport: 'سرویس', books: 'کتاب و لوازم', activity: 'فعالیت‌های فوق‌برنامه', other: 'سایر' },
  payMethod: { cash: 'نقدی', card: 'کارت‌خوان', transfer: 'کارت‌به‌کارت', cheque: 'چک', online: 'آنلاین' },
  docCategory: { id: 'شناسنامه / کارت ملی', photo: 'عکس', transcript: 'کارنامه سال قبل', medical: 'مدرک پزشکی', contract: 'تعهدنامه / قرارداد', other: 'سایر' },
  healthType: { visit: 'مراجعه', injury: 'حادثه', illness: 'بیماری', checkup: 'معاینه دوره‌ای', vaccine: 'واکسن', other: 'سایر' },
  bloodTypes: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  gradeLevels: ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم', 'یازدهم', 'دوازدهم'],
  leaveTypes: {},
};
const badge = {
  attendance: { present: 'green', absent: 'red', late: 'amber', excused: 'blue', leave: 'gray' },
  ticketStatus: { open: 'blue', answered: 'green', pending: 'amber', closed: 'gray' },
  priority: { low: 'gray', normal: 'blue', high: 'amber', urgent: 'red' },
  studentStatus: { active: 'green', graduated: 'blue', transferred: 'gray', suspended: 'amber', dropped: 'red' },
};
module.exports = { L, badge };

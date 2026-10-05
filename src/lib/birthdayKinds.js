'use strict';
/**
 * تعریف انواع پیام تولد (داده‌ی خالص؛ هم در تنظیمات و هم در سرویس ارسال استفاده می‌شود).
 * هر نوع = «مخاطب × زمان» و الگو/قالب/متغیرهای مخصوص خود را دارد.
 */
const VARS = {
  name: 'نام و نام خانوادگی', first_name: 'نام', last_name: 'نام خانوادگی', class: 'کلاس', age: 'سنِ جدید',
  days: 'روزهای مانده', date: 'تاریخ تولد (امسال)', weekday: 'روز هفته', school: 'نام مدرسه',
};
const AUDIENCES = { admin: 'مدیر و معاونان', parent: 'اولیا', student: 'دانش‌آموز' };
const KINDS = {
  admin_before: {
    aud: 'admin', when: 'before', label: 'مدیر و معاونان — چند روز قبل', inapp: 'تولد دانش‌آموز در راه است', params: 'name,days',
    tpl: 'یادآوری: تولد {name} ({class}) {days} روز دیگر، {date}، است و {age} ساله می‌شود.',
  },
  admin_today: {
    aud: 'admin', when: 'today', label: 'مدیر و معاونان — روز تولد', inapp: 'امروز تولد دانش‌آموز است', params: 'name,class',
    tpl: 'امروز تولد {name} ({class}) است؛ {age} ساله می‌شود.',
  },
  parent_before: {
    aud: 'parent', when: 'before', label: 'اولیا — چند روز قبل', inapp: 'تولد فرزندتان نزدیک است', params: 'first_name,days',
    tpl: 'اولیای گرامی، {days} روز دیگر تولد {first_name} است. {school}',
  },
  parent_today: {
    aud: 'parent', when: 'today', label: 'اولیا — روز تولد', inapp: 'تولد فرزندتان مبارک 🎂', params: 'first_name,school',
    tpl: 'اولیای گرامی، تولد {first_name} مبارک! خانواده‌ی {school} برای او سلامتی و موفقیت آرزو می‌کند.',
  },
  student_before: {
    aud: 'student', when: 'before', label: 'دانش‌آموز — چند روز قبل', inapp: 'تولدت نزدیک است 🎈', params: 'first_name,days',
    tpl: '{first_name} عزیز، فقط {days} روز تا تولدت مانده! {school}',
  },
  student_today: {
    aud: 'student', when: 'today', label: 'دانش‌آموز — روز تولد', inapp: 'تولدت مبارک 🎂', params: 'first_name,school',
    tpl: '{first_name} عزیز، تولدت مبارک! امروز {age} ساله شدی؛ آرزوی بهترین‌ها برایت داریم. {school}',
  },
};
const ORDER = Object.keys(KINDS);

/**
 * تبدیل «نام متغیر الگو» به نقشه‌ی پارامترها. فرمت: «placeholder» یا «placeholder:variable» با ویرگول جداشده.
 * خروجی: { ok, map: [[placeholder, variable]], error }
 */
function parseParams(text) {
  const map = []; const seen = new Set();
  for (const raw of String(text || '').split(/[,،]/)) {
    const part = raw.trim(); if (!part) continue;
    const m = /^([A-Za-z_]\w{0,30})(?::(\w+))?$/.exec(part);
    if (!m) return { ok: false, error: `«${part}» نامعتبر است (فقط حروف لاتین، مثل name یا code:name).` };
    const variable = m[2] || m[1];
    if (!(variable in VARS)) return { ok: false, error: `متغیر «${variable}» وجود ندارد. متغیرهای مجاز: ${Object.keys(VARS).join('، ')}` };
    if (seen.has(m[1])) return { ok: false, error: `نام «${m[1]}» تکراری است.` };
    seen.add(m[1]); map.push([m[1], variable]);
  }
  return { ok: true, map };
}
module.exports = { VARS, AUDIENCES, KINDS, ORDER, parseParams };

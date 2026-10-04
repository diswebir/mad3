'use strict';
const db = require('./db');
const BK = require('./lib/birthdayKinds');

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
  { key: 'periods_count', group: 'academic', label: 'تعداد زنگ‌های روزانه', type: 'hidden', was: 'number', def: '6', min: 1, max: 10 },
  { key: 'period_start', group: 'academic', label: 'ساعت شروع زنگ اول', type: 'hidden', was: 'time', def: '07:45' },
  { key: 'period_minutes', group: 'academic', label: 'مدت هر زنگ (دقیقه)', type: 'hidden', was: 'number', def: '45', min: 20, max: 120 },
  { key: 'break_minutes', group: 'academic', label: 'مدت تنفس بین زنگ‌ها (دقیقه)', type: 'hidden', was: 'number', def: '10', min: 0, max: 60 },
  { key: 'grade_scale', group: 'academic', label: 'بیشینه نمره کارنامه', type: 'number', def: '20', min: 4, max: 100 },
  { key: 'scores_autolock_days', group: 'academic', label: 'قفل خودکار نمرات منتشرشده پس از چند روز (۰ = غیرفعال)', type: 'number', def: '0', min: 0, max: 365, hint: 'نمرات منتشرشده پس از این مدت قفل می‌شوند؛ ویرایش بعدی فقط با دلیل و توسط مدیر.' },
  { key: 'pass_mark', group: 'academic', label: 'حدنصاب قبولی', type: 'number', def: '10', min: 1, max: 100 },
  { key: 'show_rank_to_students', group: 'academic', label: 'نمایش رتبه و میانگین کلاس به دانش‌آموز در کارنامه', type: 'checkbox', def: '1' },
  { key: 'terms_count', group: 'academic', label: 'تعداد نوبت‌های ارزشیابی', type: 'number', def: '2', min: 1, max: 4 },
  { key: 'term_weights', group: 'academic', label: 'ضریب نوبت‌ها در معدل سالانه (مثلاً ۱,۲ ؛ خالی = ادغام ساده)', type: 'text', def: '' },
  // کارنامه
  { key: 'rc_title', group: 'reportcard', label: 'عنوان کارنامه', type: 'text', def: 'کارنامه تحصیلی' },
  { key: 'rc_ministry_line', group: 'reportcard', label: 'سطر بالای کارنامه', type: 'text', def: 'جمهوری اسلامی ایران — وزارت آموزش و پرورش' },
  { key: 'rc_region', group: 'reportcard', label: 'نام اداره/ناحیه (زیر عنوان)', type: 'text', def: '' },
  { key: 'rc_layout', group: 'reportcard', label: 'نوع نمایش نمرات', type: 'select', def: 'numeric', options: [['numeric', 'عددی'], ['descriptive', 'توصیفی (عالی/خوب/...)'], ['both', 'عددی و توصیفی']] },
  { key: 'rc_levels', group: 'reportcard', label: 'سطوح توصیفی (هر سطر: حداقل درصد|عنوان)', type: 'textarea', def: '90|عالی\n75|خیلی خوب\n60|خوب\n50|قابل قبول\n0|نیاز به تلاش بیشتر' },
  { key: 'rc_show_attendance', group: 'reportcard', label: 'نمایش غیبت و تأخیر در کارنامه', type: 'checkbox', def: '1' },
  { key: 'rc_show_behavior', group: 'reportcard', label: 'نمایش نمره رفتار در کارنامه', type: 'checkbox', def: '1' },
  { key: 'rc_show_rank', group: 'reportcard', label: 'نمایش رتبه و معدل کلاس در کارنامه چاپی', type: 'checkbox', def: '1' },
  { key: 'rc_show_comment', group: 'reportcard', label: 'نمایش توصیف معلم راهنما در کارنامه', type: 'checkbox', def: '1' },
  { key: 'rc_sign_left', group: 'reportcard', label: 'عنوان امضای سمت راست', type: 'text', def: 'امضای معلم راهنما' },
  { key: 'rc_sign_right', group: 'reportcard', label: 'عنوان امضای سمت چپ', type: 'text', def: 'مهر و امضای مدیر' },
  { key: 'rc_footer_note', group: 'reportcard', label: 'یادداشت پایین کارنامه', type: 'textarea', def: '' },
  // حضور و غیاب
  { key: 'attendance_mode', group: 'attendance', label: 'نوع ثبت حضور و غیاب', type: 'select', def: 'daily', options: [['daily', 'روزانه (یک‌بار در روز)'], ['periodic', 'به‌تفکیک زنگ']] },
  { key: 'absence_alert_threshold', group: 'attendance', label: 'آستانه هشدار غیبت (روز)', type: 'number', def: '5', min: 1, max: 60 },
  { key: 'notify_on_absence', group: 'attendance', label: 'ارسال اعلان غیبت به دانش‌آموز', type: 'checkbox', def: '1' },
  { key: 'attendance_lock_days', group: 'attendance', label: 'قفل ویرایش حضور و غیاب پس از (روز، ۰ = بدون قفل؛ مدیر همیشه می‌تواند)', type: 'number', def: '7', min: 0, max: 365 },
  { key: 'attendance_enforce_schedule', group: 'attendance', label: 'در حالت زنگ‌به‌زنگ فقط معلمِ برنامه (یا جانشین) آن زنگ حق ثبت داشته باشد', type: 'checkbox', def: '0' },
  { key: 'school_start_time', group: 'attendance', label: 'ساعت شروع مدرسه (برای ثبت ورود با کارت/QR)', type: 'hidden', was: 'time', def: '07:30' },
  { key: 'late_after_minutes', group: 'attendance', label: 'ورود پس از چند دقیقه «تأخیر» محسوب شود', type: 'number', def: '10', min: 0, max: 120 },
  // تیکت
  { key: 'ticket_student_to_teacher', group: 'tickets', label: 'اجازه ارسال تیکت دانش‌آموز به معلم', type: 'checkbox', def: '1' },
  { key: 'ticket_auto_close_days', group: 'tickets', label: 'بستن خودکار تیکت پاسخ‌داده‌شده بعد از (روز، ۰ = غیرفعال)', type: 'number', def: '7', min: 0, max: 90 },
  { key: 'ticket_sla_hours', group: 'tickets', label: 'مهلت پاسخ‌گویی به تیکت (ساعت، ۰ = غیرفعال)', type: 'number', def: '48', min: 0, max: 720 },
  { key: 'ticket_escalate', group: 'tickets', label: 'در صورت تأخیر، تیکتِ بی‌پاسخ به مدیر ارجاع/یادآوری شود', type: 'checkbox', def: '1' },
  // دانش‌آموز
  { key: 'student_code_prefix', group: 'students', label: 'پیشوند شماره دانش‌آموزی', type: 'text', def: '1405' },
  { key: 'student_password_mode', group: 'students', label: 'رمز اولیه دانش‌آموز', type: 'select', def: 'national_id', options: [['national_id', 'کد ملی (در نبود آن رمز تصادفی)'], ['random', 'همیشه رمز تصادفی']] },
  // مالی
  { key: 'currency_label', group: 'finance', label: 'واحد پول', type: 'select', def: 'تومان', options: ['تومان', 'ریال'] },
  { key: 'sibling_discount_percent', group: 'finance', label: 'تخفیف برادر/خواهر (درصد برای فرزند دوم به بعد، ۰ = غیرفعال)', type: 'number', def: '0', min: 0, max: 100 },
  { key: 'hr_annual_leave_days', group: 'hr', label: 'سقف مرخصی استحقاقی سالانه معلم (روز)', type: 'number', def: '26', min: 0, max: 100 },
  // امنیت
  { key: 'maintenance_mode', group: 'system', label: 'حالت تعمیر و نگهداری (فقط مدیر کل می‌تواند وارد شود)', type: 'checkbox', def: '0', hint: 'هنگام بازیابی پشتیبان یا به‌روزرسانی روشن کنید؛ بقیه‌ی کاربران پیام زیر را می‌بینند.' },
  { key: 'maintenance_message', group: 'system', label: 'پیام حالت تعمیر', type: 'textarea', def: 'سامانه در حال به‌روزرسانی است. لطفاً کمی بعد دوباره مراجعه کنید.' },
  { key: 'cron_token', group: 'system', label: 'توکن فراخوانی cron (خالی = بدون تغییر؛ حداقل ۱۶ نویسه)', type: 'secret', def: '' },
  { key: 'auto_backup_enabled', group: 'system', label: 'پشتیبان‌گیری خودکار روزانه', type: 'checkbox', def: '1' },
  { key: 'auto_backup_keep', group: 'system', label: 'تعداد نسخه‌های خودکارِ نگه‌داری‌شده', type: 'number', def: '7', min: 1, max: 60, hint: 'قدیمی‌ترین نسخه‌های خودکار به‌صورت خودکار پاک می‌شوند.' },
  { key: 'fee_reminder_days', group: 'finance', label: 'یادآوری خودکار قسط: چند روز قبل از سررسید (۰ = غیرفعال)', type: 'number', def: '0', min: 0, max: 60, hint: 'نیازمند اجرای cron (تب «نگهداری، پشتیبان و cron») و ثبت اقساط؛ هر قسط فقط یک‌بار یادآوری می‌شود.' },
  { key: 'session_hours', group: 'security', label: 'مدت اعتبار نشست (ساعت)', type: 'number', def: '8', min: 1, max: 168 },
  { key: 'min_password_length', group: 'security', label: 'حداقل طول رمز عبور', type: 'number', def: '6', min: 4, max: 32 },
  { key: 'max_login_attempts', group: 'security', label: 'حداکثر تلاش ناموفق ورود', type: 'number', def: '5', min: 3, max: 20 },
  { key: 'lockout_minutes', group: 'security', label: 'مدت قفل موقت ورود (دقیقه)', type: 'number', def: '10', min: 1, max: 1440 },
  { key: 'lock_window_minutes', group: 'security', label: 'پنجره‌ی شمارش تلاش‌های ناموفق (دقیقه)', type: 'number', def: '15', min: 1, max: 1440, hint: 'تلاش‌های ناموفق فقط در این بازه با هم شمرده می‌شوند.' },
  { key: 'lock_ip_multiplier', group: 'security', label: 'ضریب قفل کل IP', type: 'number', def: '5', min: 1, max: 50, hint: 'کل یک IP پس از «حداکثر تلاش × این ضریب» خطای ناموفق (با نام‌های کاربری مختلف) قفل می‌شود.' },
  { key: 'lock_progressive', group: 'security', label: 'قفل پلکانی (هر بار تکرار، مدت قفل دو برابر)', type: 'checkbox', def: '1' },
  { key: 'lock_max_minutes', group: 'security', label: 'سقف مدت قفل پلکانی (دقیقه)', type: 'number', def: '1440', min: 1, max: 10080 },
  { key: 'lock_strike_reset_hours', group: 'security', label: 'آرامش لازم برای صفرشدن پلکان (ساعت)', type: 'number', def: '24', min: 1, max: 720 },
  { key: 'lock_trusted_ips', group: 'security', label: 'IPهای مورداعتماد (هرگز قفل نمی‌شوند؛ با ویرگول یا سطر جدا)', type: 'textarea', def: '', hint: 'مثلاً IP ثابت مدرسه. اگر چند کاربر پشت یک IP هستند، این گزینه را با احتیاط استفاده کنید.' },
  { key: 'lock_notify_admin', group: 'security', label: 'اعلان درون‌برنامه‌ای به مدیر و سوپر ادمین هنگام قفل‌شدن یک حساب/IP', type: 'checkbox', def: '1' },
  { key: 'otp_max_attempts', group: 'security', label: 'حداکثر حدس کد پیامکی برای هر کد', type: 'number', def: '5', min: 3, max: 10 },
  { key: 'otp_cooldown_seconds', group: 'security', label: 'فاصله‌ی ارسال دوباره‌ی کد (ثانیه)', type: 'number', def: '60', min: 30, max: 600 },
  { key: 'otp_per_user_hour', group: 'security', label: 'حداکثر کد در ساعت برای هر کاربر', type: 'number', def: '5', min: 1, max: 20 },
  { key: 'otp_per_ip_hour', group: 'security', label: 'حداکثر درخواست کد در ساعت برای هر IP', type: 'number', def: '30', min: 5, max: 500 },
  // پشتیبان بیرون از هاست (فقط سوپر ادمین)
  { key: 'offsite_enabled', group: 'offsite', section: 'عمومی', label: 'ارسال پشتیبان به مقصد بیرون از هاست', type: 'checkbox', def: '0', hint: 'نسخه‌های پشتیبان (data/backups) به یک مقصد دیگر هم کپی می‌شوند تا با خرابی هاست از بین نروند.' },
  { key: 'offsite_type', group: 'offsite', label: 'نوع مقصد', type: 'select', def: 's3', options: [['s3', 'S3 و سازگارها (آروان، لیارا، Wasabi، Backblaze، MinIO، AWS)'], ['webdav', 'WebDAV (نکست‌کلود، ownCloud و …)'], ['folder', 'پوشه‌ی دیگر روی همین سرور (مثلاً دیسک متصل)']] },
  { key: 'offsite_kinds', group: 'offsite', label: 'کدام نسخه‌ها ارسال شوند؟', type: 'select', def: 'auto_manual', options: [['auto', 'فقط پشتیبان خودکار روزانه'], ['auto_manual', 'خودکار و دستی'], ['all', 'همه (شامل پیش از ارتقا و پیش از بازیابی)']] },
  { key: 'offsite_keep', group: 'offsite', label: 'تعداد نسخه‌ی نگه‌داری‌شده در مقصد (برای هر نوع؛ ۰ = هرگز حذف نشود)', type: 'number', def: '14', min: 0, max: 365 },
  { key: 'offsite_prefix', group: 'offsite', label: 'پوشه/پیشوند در مقصد', type: 'text', def: 'school-backups', hint: 'فقط حروف لاتین، عدد، - و _ و /' },
  { key: 'offsite_encrypt', group: 'offsite', label: 'رمزنگاری نسخه‌ها پیش از ارسال (AES-256)', type: 'checkbox', def: '1', hint: 'قویاً پیشنهاد می‌شود؛ چون پشتیبان شامل اطلاعات شخصی دانش‌آموزان است.' },
  { key: 'offsite_passphrase', group: 'offsite', label: 'عبارت رمز (خالی = بدون تغییر؛ حداقل ۸ نویسه)', type: 'secret', def: '', hint: 'این عبارت در پشتیبان ذخیره نمی‌شود. آن را جای امن دیگری هم نگه دارید؛ بدون آن، نسخه‌های رمزنگاری‌شده قابل بازیابی نیستند.' },
  { key: 'offsite_alert', group: 'offsite', label: 'اعلان به سوپر ادمین هنگام شکست ارسال (حداکثر روزی یک بار)', type: 'checkbox', def: '1' },
  { key: 'offsite_s3_endpoint', group: 'offsite', section: 'S3 و سازگارها', label: 'نشانی سرویس (Endpoint)', type: 'text', def: '', hint: 'مثال: https://s3.ir-thr-at1.arvanstorage.ir  یا  https://s3.amazonaws.com' },
  { key: 'offsite_s3_region', group: 'offsite', label: 'ناحیه (Region)', type: 'text', def: 'us-east-1', hint: 'آروان: ir-thr-at1 · AWS: مثل eu-central-1 · MinIO: us-east-1' },
  { key: 'offsite_s3_bucket', group: 'offsite', label: 'نام Bucket', type: 'text', def: '' },
  { key: 'offsite_s3_key', group: 'offsite', label: 'کلید دسترسی (Access Key)', type: 'text', def: '' },
  { key: 'offsite_s3_secret', group: 'offsite', label: 'کلید محرمانه (Secret Key؛ خالی = بدون تغییر)', type: 'secret', def: '' },
  { key: 'offsite_s3_pathstyle', group: 'offsite', label: 'نشانی به‌صورت مسیر (Path-style)', type: 'checkbox', def: '1', hint: 'برای MinIO و بیشتر سرویس‌های ایرانی روشن بماند. برای AWS با دامنه‌ی bucket خاموش کنید.' },
  { key: 'offsite_dav_url', group: 'offsite', section: 'WebDAV', label: 'نشانی WebDAV', type: 'text', def: '', hint: 'مثال نکست‌کلود: https://cloud.example.ir/remote.php/dav/files/USER' },
  { key: 'offsite_dav_user', group: 'offsite', label: 'نام کاربری', type: 'text', def: '' },
  { key: 'offsite_dav_pass', group: 'offsite', label: 'رمز عبور (خالی = بدون تغییر؛ بهتر است رمز برنامه باشد)', type: 'secret', def: '' },
  { key: 'offsite_dir', group: 'offsite', section: 'پوشه‌ی دیگر', label: 'مسیر کامل پوشه', type: 'text', def: '', hint: 'مثال: /home/CPANELUSER/offsite-backups — خارج از public_html و بیرون از پوشه‌ی data.' },
  { key: 'offsite_state', group: 'offsite', label: 'وضعیت ارسال', type: 'hidden', def: '' },
  // پیامک (ippanel)
  { key: 'sms_enabled', group: 'sms', label: 'فعال‌سازی ارسال پیامک', type: 'checkbox', def: '0' },
  { key: 'sms_provider', group: 'sms', label: 'سرویس‌دهنده پیامک', type: 'select', def: 'log', options: [['log', 'آزمایشی (فقط ثبت در گزارش، بدون ارسال)'], ['ippanel', 'ippanel (edge.ippanel.com)']], hint: 'در حالت آزمایشی هیچ پیامکی ارسال نمی‌شود و فقط در گزارش پیامک‌ها ثبت می‌شود.' },
  { key: 'sms_api_key', group: 'sms', label: 'کلید API (Access Key پنل ippanel)', type: 'secret', def: '' },
  { key: 'sms_from_number', group: 'sms', label: 'شماره ارسال‌کننده (مثلاً +983000505)', type: 'text', def: '' },
  { key: 'sms_base_url', group: 'sms', label: 'نشانی پایه API (معمولاً تغییر ندهید)', type: 'text', def: 'https://edge.ippanel.com/v1' },
  { key: 'sms_otp_enabled', group: 'sms', label: 'کد یکبارمصرف پیامکی (فراموشی رمز و ورود اولیا) — نیازمند فعال‌بودن ارسال پیامک', type: 'checkbox', def: '0' },
  { key: 'sms_otp_pattern', group: 'sms', label: 'کد الگوی (Pattern) ippanel برای کد تأیید', type: 'text', def: '', hint: 'در پنل ippanel یک الگو (Pattern) بسازید که فقط یک متغیر برای کد داشته باشد و کد آن را اینجا بنویسید.' },
  { key: 'sms_otp_param', group: 'sms', label: 'نام متغیر کد در الگو (مثلاً code)', type: 'text', def: 'code' },
  { key: 'sms_otp_parent_login', group: 'sms', label: 'ورود اولیا با کد پیامکی (بدون رمز)', type: 'checkbox', def: '1' },
  { key: 'otp_ttl_minutes', group: 'sms', label: 'اعتبار کد پیامکی (دقیقه)', type: 'number', def: '5', min: 2, max: 15 },
  { key: 'otp_demo_show_code', group: 'sms', label: 'نمایش کد روی صفحه در حالت آزمایشی (فقط برای دمو؛ در محیط واقعی خاموش بماند)', type: 'checkbox', def: '0' },
  { key: 'sms_on_absence', group: 'sms', label: 'پیامک غیبت به اولیا هنگام ثبت غیبت', type: 'checkbox', def: '1' },
  { key: 'sms_on_late', group: 'sms', label: 'پیامک تأخیر ورود به اولیا', type: 'checkbox', def: '0' },
  { key: 'sms_on_exit', group: 'sms', label: 'پیامک صدور برگه خروج/دیرکرد به اولیا', type: 'checkbox', def: '1' },
  { key: 'sms_on_grades', group: 'sms', label: 'پیامک انتشار نمره به اولیا', type: 'checkbox', def: '0' },
  { key: 'sms_on_credentials', group: 'sms', label: 'ارسال نام کاربری/رمز حساب اولیا با پیامک', type: 'checkbox', def: '1' },
  // ظاهر
  { key: 'primary_color', group: 'appearance', label: 'رنگ اصلی سامانه', type: 'color', def: '#2563eb' },
  { key: 'login_notice', group: 'appearance', label: 'اعلان صفحه‌ی ورود (اختیاری)', type: 'textarea', def: '', hint: 'برای همه‌ی بازدیدکنندگان بالای فرم ورود نمایش داده می‌شود؛ مثلاً زمان ثبت‌نام یا تعطیلی.' },
  { key: 'show_demo_logins', group: 'appearance', label: 'نمایش حساب‌های دمو در صفحه ورود', type: 'checkbox', def: '0' },
  { key: 'logo', group: 'appearance', label: 'لوگو', type: 'hidden', def: '' },
];
/** تنظیمات تولد: بخش‌بندی‌شده بر پایه‌ی مخاطب؛ هر نوع پیام کد الگو، متغیرهای الگو و قالب متن خودش را دارد */
function birthdayDefs() {
  const d = [
    { key: 'bd_enabled', group: 'birthday', section: 'عمومی', label: 'ارسال خودکار اعلان تولد (درون‌برنامه‌ای و پیامک)', type: 'checkbox', def: '1' },
    { key: 'bd_before_days', group: 'birthday', label: 'اطلاع‌رسانی چند روز قبل از تولد (۰ = فقط روز تولد)', type: 'number', def: '3', min: 0, max: 14 },
    { key: 'bd_send_time', group: 'birthday', label: 'ساعت ارسال روزانه', type: 'time', def: '07:30', hint: 'اجرای کارها هر ۳۰ دقیقه (و با cron) انجام می‌شود؛ اعلان‌ها پس از این ساعت و فقط یک‌بار برای هر دانش‌آموز در هر سال ارسال می‌شوند.' },
    { key: 'bd_notify_homeroom', group: 'birthday', label: 'رونوشت درون‌برنامه‌ای برای معلم راهنمای کلاس', type: 'checkbox', def: '1' },
    { key: 'show_birthdays', group: 'birthday', label: 'نمایش تولدها در داشبورد مدیر و معلم', type: 'checkbox', def: '1' },
    { key: 'bd_student_widget', group: 'birthday', label: 'نمایش شمارش معکوس تولد در داشبورد دانش‌آموز و اولیا', type: 'checkbox', def: '1' },
  ];
  for (const aud of Object.keys(BK.AUDIENCES)) {
    let first = true;
    d.push({ key: 'bd_sms_' + aud, group: 'birthday', section: 'مخاطب: ' + BK.AUDIENCES[aud], label: `ارسال پیامک به ${BK.AUDIENCES[aud]} (نیازمند فعال‌بودن پیامک؛ اعلان درون‌برنامه‌ای همیشه ارسال می‌شود)`, type: 'checkbox', def: aud === 'admin' ? '0' : '1', full: true,
      hint: aud === 'admin' ? 'شماره‌ی موبایل از «پروفایل» حساب مدیر/معاون خوانده می‌شود.' : aud === 'parent' ? 'به شماره‌های پدر، مادر و سرپرست در پرونده.' : 'به شماره‌ی موبایل دانش‌آموز در پرونده.' });
    for (const [kind, m] of Object.entries(BK.KINDS)) {
      if (m.aud !== aud) continue; first = false;
      const when = m.when === 'before' ? 'چند روز قبل' : 'روز تولد';
      d.push({ key: 'bd_on_' + kind, group: 'birthday', label: `«${when}» — ارسال شود`, type: 'checkbox', def: '1', full: true });
      d.push({ key: 'bd_tpl_' + kind, group: 'birthday', label: `متن پیام (${when}) — خالی = متن پیش‌فرض`, type: 'textarea', def: m.tpl });
      d.push({ key: 'bd_pattern_' + kind, group: 'birthday', label: `کد الگوی ippanel (${when}) — خالی = پیامک متنی با قالب بالا`, type: 'text', def: '' });
      d.push({ key: 'bd_params_' + kind, group: 'birthday', label: `متغیرهای الگو (${when})`, type: 'text', def: m.params, hint: 'نام هر متغیر را همان‌طور که در الگوی ippanel ساخته‌اید بنویسید، با ویرگول؛ اگر نام با متغیر سامانه فرق دارد به‌شکل «نام‌در_الگو:متغیر» (مثلاً fname:first_name).' });
    }
  }
  return d;
}

DEFS.push(...birthdayDefs());

/**
 * سطح دسترسی تنظیمات: کلیدهای دارای super:true فقط برای «سوپر ادمین» (فروشنده/پشتیبان فنی) قابل مشاهده و ویرایش‌اند.
 * مدیر مدرسه فقط تنظیمات «مدیریت مدرسه» را می‌بیند (اطلاعات مدرسه، آموزشی، کارنامه، ظاهر، متن پیام‌ها و کلیدهای اعلان).
 */
const SUPER_KEYS = new Set(['show_demo_logins', 'otp_demo_show_code']);
for (const d of DEFS) {
  d.super = d.group === 'security' || d.group === 'system' || d.group === 'offsite' || SUPER_KEYS.has(d.key)
    || (d.group === 'sms' && !/^sms_on_/.test(d.key)) || /^bd_(pattern|params)_/.test(d.key);
}
const isSuperKey = (key) => { const d = DEFS.find((x) => x.key === key); return !!(d && d.super); };
const GROUPS = { general: 'اطلاعات مدرسه', academic: 'تنظیمات آموزشی', reportcard: 'کارنامه و قالب چاپ', attendance: 'حضور و غیاب', tickets: 'تیکت‌ها', students: 'دانش‌آموزان', birthday: 'تولد و تبریک', finance: 'مالی', hr: 'منابع انسانی', sms: 'پیامک (ippanel)', security: 'امنیت', appearance: 'ظاهر', system: 'نگهداری و پشتیبان', offsite: 'پشتیبان بیرونی' };

let cache = null;
async function load() {
  const rows = await db.get()('settings').select('key', 'value');
  const m = {};
  for (const d of DEFS) m[d.key] = d.def;
  for (const r of rows) m[r.key] = r.value === null ? '' : r.value;
  cache = m;
  try { await require('./lib/bell').load(db.get()); } catch (_) { /* جدول زنگ‌ها هنوز ساخته نشده (نصب‌کننده) */ }
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

/** زنگ‌های درسی الگوی پیش‌فرضِ ساعت زنگ‌ها (صفحه‌ی «ساعت زنگ‌ها») */
function periods() {
  const bell = require('./lib/bell'); const p = bell.defaultPeriods();
  if (p.length) return p;
  // پیش از ساخت جدول زنگ‌ها (نصب‌کننده / تست واحد): الگوی ساده از تنظیمات
  return bell.fromTemplate({ count: num('periods_count') || 6, start: get('period_start') || '07:45', minutes: num('period_minutes') || 45, brk: num('break_minutes') }).filter((r) => r.kind === 'class').map((r) => ({ n: r.n, start: r.start, end: r.end }));
}
function weekDays() { return String(get('week_days') || '0,1,2,3,4').split(',').filter((x) => x !== '').map(Number); }

module.exports = { DEFS, GROUPS, isSuperKey, load, all, get, num, bool, set, setMany, periods, weekDays };

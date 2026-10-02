'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');
const modulesReg = require('./modules');
const J = require('./utils/jalali');
const svc = require('./services');
const { toFa } = require('./utils/fa');

async function seedBase(k, { school, admin, modules }) {
  const vals = {};
  for (const d of settings.DEFS) vals[d.key] = d.def;
  Object.assign(vals, school || {});
  await k.batchInsert('settings', Object.entries(vals).map(([key, value]) => ({ key, value: String(value) })), 50);
  { // الگوی پیش‌فرض ساعت زنگ‌ها بر اساس انتخاب ویزارد (تعداد زنگ، شروع، مدت، تنفس)
    const bell = require('./lib/bell'); const cnt = Math.min(12, Math.max(1, Number(vals.periods_count) || 6));
    const rows = bell.fromTemplate({ count: cnt, start: /^\d{1,2}:\d{2}$/.test(vals.period_start || '') ? vals.period_start : '07:45', minutes: Number(vals.period_minutes) || 45, brk: vals.break_minutes === '' || vals.break_minutes === undefined ? 10 : Number(vals.break_minutes) });
    const ex = await k('bell_schedules').where({ is_default: 1 }).first();
    await bell.saveSchedule(k, { id: ex ? ex.id : undefined, name: 'الگوی پیش‌فرض', days: [], grades: [], isDefault: true, rows });
  }
  const chosen = new Set(modules || modulesReg.MODULES.map((m) => m.key));
  await k.batchInsert('modules_state', modulesReg.MODULES.map((m) => ({ key: m.key, enabled: m.core || chosen.has(m.key) ? 1 : 0 })), 50);
  await k('users').insert({ username: admin.username, password_hash: admin.password_hash || svc.hash(admin.password), role: 'admin', full_name: admin.full_name, email: admin.email || null, active: 1 });
  const jy = J.isoToJ(J.todayISO());
  const y0 = jy.jm >= 6 ? jy.jy : jy.jy - 1;
  await k('academic_years').insert({ title: `${y0}-${y0 + 1}`, start_date: J.jToIso(y0, 6, 31), end_date: J.jToIso(y0 + 1, 3, 31), is_current: 1 });
}

/* ---------- داده‌ی نمونه ---------- */
function rng(seed) { // mulberry32 برای تکرارپذیری
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const nid = (r) => { const d = Array.from({ length: 9 }, () => Math.floor(r() * 10)); let s = 0; d.forEach((x, i) => { s += x * (10 - i); }); const m = s % 11; d.push(m < 2 ? m : 11 - m); return d.join(''); };
const phone = (r) => '09' + ['12', '13', '35', '19', '36', '21'][Math.floor(r() * 6)] + String(Math.floor(r() * 9000000) + 1000000);

async function bulk(k, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]).length;
  await k.batchInsert(table, rows, Math.max(1, Math.floor(800 / cols)));
}

async function seedDemo(k) {
  const r = rng(1405);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const today = J.todayISO();
  const D = (m, d, y = 1405) => J.jToIso(y, m, d);
  const mod = (key) => modulesReg.isEnabled(key);
  const demoHash = { teacher: svc.hash('teacher123'), student: svc.hash('student123'), deputy: svc.hash('deputy123') };
  const year = await k('academic_years').where({ is_current: 1 }).first();

  const maleFirst = ['علی', 'محمد', 'رضا', 'امیر', 'حسین', 'مهدی', 'سجاد', 'آرین', 'پارسا', 'امیرحسین', 'محمدرضا', 'یاسین', 'آرمان', 'کیان', 'بردیا', 'سینا', 'ماهان', 'نیما', 'آراد', 'متین'];
  const femaleFirst = ['زهرا', 'فاطمه', 'مریم', 'سارا', 'نازنین', 'الهه', 'مهسا', 'ریحانه', 'ستایش', 'یاسمن', 'هستی', 'نرگس', 'آیدا', 'پریسا', 'کیانا', 'النا', 'باران', 'ملیکا', 'آرزو', 'نگار'];
  const lastNames = ['احمدی', 'محمدی', 'حسینی', 'رضایی', 'کریمی', 'موسوی', 'جعفری', 'صادقی', 'نوری', 'مرادی', 'کاظمی', 'رحیمی', 'قاسمی', 'فرهادی', 'اکبری', 'حیدری', 'عباسی', 'یوسفی', 'سلطانی', 'هاشمی', 'طاهری', 'زارعی', 'شریفی', 'بهرامی', 'ملکی'];
  const jobs = ['کارمند', 'معلم', 'پزشک', 'مهندس', 'کاسب', 'راننده', 'بازنشسته', 'پرستار', 'آزاد', 'کارگر ماهر', 'حسابدار'];
  const mothersJobs = ['خانه‌دار', 'معلم', 'پرستار', 'کارمند', 'پزشک', 'خانه‌دار', 'خانه‌دار', 'مهندس', 'خیاط'];
  const edu = ['دیپلم', 'کاردانی', 'کارشناسی', 'کارشناسی ارشد', 'زیر دیپلم'];
  const places = ['تهران', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'کرج', 'قم', 'اهواز', 'رشت'];
  const streets = ['خیابان ولیعصر، کوچه گلها', 'بلوار کشاورز، پلاک ۱۲', 'خیابان شریعتی، کوچه ۱۴', 'میدان آزادی، خیابان بهار', 'خیابان انقلاب، کوچه سرو', 'بلوار امام رضا، پلاک ۴۵'];

  /* --- کاربران: معاون و معلمان --- */
  await k('users').insert({ username: 'deputy', password_hash: demoHash.deputy, role: 'deputy', full_name: 'سیما حسینی', phone: '09121110022', email: 'deputy@example.com', active: 1 });
  const teachersDef = [
    ['t.ahmadi', 'احمد احمدی', 'ریاضی', 'male', 'کارشناسی ارشد ریاضی'], ['m.kazemi', 'مریم کاظمی', 'علوم تجربی', 'female', 'کارشناسی ارشد فیزیک'],
    ['r.mousavi', 'رضا موسوی', 'ادبیات فارسی', 'male', 'کارشناسی ادبیات'], ['z.nouri', 'زهرا نوری', 'عربی', 'female', 'کارشناسی علوم قرآنی'],
    ['s.jafari', 'سعید جعفری', 'زبان انگلیسی', 'male', 'کارشناسی زبان انگلیسی'], ['f.rahimi', 'فاطمه رحیمی', 'مطالعات اجتماعی', 'female', 'کارشناسی جغرافیا'],
    ['h.ghasemi', 'حسن قاسمی', 'دینی و قرآن', 'male', 'کارشناسی الهیات'], ['m.sadeghi', 'مهدی صادقی', 'تربیت بدنی', 'male', 'کارشناسی تربیت بدنی'],
    ['s.karimi', 'سمیرا کریمی', 'هنر', 'female', 'کارشناسی نقاشی'], ['a.taheri', 'علیرضا طاهری', 'کار و فناوری', 'male', 'کارشناسی مهندسی کامپیوتر'],
    ['a.hosseini', 'آزاده حسینی', 'ریاضی', 'female', 'کارشناسی ارشد آموزش ریاضی'], ['n.bagheri', 'نسرین باقری', 'علوم تجربی', 'female', 'کارشناسی زیست‌شناسی'],
    ['l.rostami', 'لیلا رستمی', 'ادبیات فارسی', 'female', 'کارشناسی زبان و ادبیات فارسی'], ['p.mohebi', 'پیمان محبی', 'زبان انگلیسی', 'male', 'کارشناسی مترجمی زبان'],
  ];
  // معلم دوم برای دروس پرساعت: کلاس‌های نهم و هشتم ب به معلم دوم سپرده می‌شود تا هر معلم فقط چند کلاس داشته باشد
  const altTeacher = { MATH: 'a.hosseini', SCI: 'n.bagheri', FA: 'l.rostami', EN: 'p.mohebi' };
  await bulk(k, 'users', teachersDef.map((t, i) => ({ username: t[0], password_hash: demoHash.teacher, role: 'teacher', full_name: t[1], phone: '0912' + (3000000 + i * 1111), email: t[0].replace('.', '') + '@example.com', active: 1 })));
  const tUsers = await k('users').where({ role: 'teacher' }).select('id', 'username');
  const tUid = Object.fromEntries(tUsers.map((u) => [u.username, u.id]));
  await bulk(k, 'teachers', teachersDef.map((t, i) => ({ user_id: tUid[t[0]], personnel_code: String(7001 + i), national_id: nid(r), gender: t[3], birth_date: D(1 + (i % 12), 5 + i, 1360 + i), specialty: t[2], degree: t[4], hire_date: D(6, 15 + i, 1385 + i), employment_type: i < 7 ? 'رسمی' : 'پیمانی', emergency_phone: phone(r), address: pick(streets), bio: `${t[1]} با سابقه تدریس ${5 + i} سال در مقطع متوسطه.`, status: 'active' })));
  const teachers = await k('teachers').select('id', 'user_id');
  const tIdByUser = Object.fromEntries(teachers.map((t) => [t.user_id, t.id]));
  const tid = (username) => tIdByUser[tUid[username]];

  /* --- دروس --- */
  const subjDef = [['ریاضی', 'MATH', 4, 't.ahmadi'], ['علوم تجربی', 'SCI', 3, 'm.kazemi'], ['فارسی', 'FA', 4, 'r.mousavi'], ['عربی', 'AR', 2, 'z.nouri'], ['زبان انگلیسی', 'EN', 2, 's.jafari'], ['مطالعات اجتماعی', 'SOC', 2, 'f.rahimi'], ['دینی و قرآن', 'REL', 2, 'h.ghasemi'], ['تربیت بدنی', 'PE', 1, 'm.sadeghi'], ['هنر', 'ART', 1, 's.karimi'], ['کار و فناوری', 'TECH', 1, 'a.taheri']];
  await bulk(k, 'subjects', subjDef.map((s) => ({ name: s[0], code: s[1], grade_level: 'متوسطه اول', weekly_hours: s[2], coefficient: s[2] >= 3 ? 3 : s[2] === 2 ? 2 : 1, description: '' })));
  const subjects = await k('subjects').select('id', 'code');
  const sId = Object.fromEntries(subjects.map((s) => [s.code, s.id]));

  /* --- کلاس‌ها --- */
  const classDef = [['هفتم الف', 'هفتم', 'الف', 't.ahmadi', 'male'], ['هفتم ب', 'هفتم', 'ب', 'm.kazemi', 'female'], ['هشتم الف', 'هشتم', 'الف', 'r.mousavi', 'male'], ['هشتم ب', 'هشتم', 'ب', 'z.nouri', 'female'], ['نهم الف', 'نهم', 'الف', 's.jafari', 'male'], ['نهم ب', 'نهم', 'ب', 'f.rahimi', 'female']];
  await bulk(k, 'classrooms', classDef.map((c, i) => ({ name: c[0], grade_level: c[1], section: c[2], capacity: 30, room_no: String(101 + i), academic_year_id: year.id, homeroom_teacher_id: tid(c[3]), notes: '' })));
  const classes = await k('classrooms').orderBy('id');
  const csRows = [];
  classes.forEach((c, ci) => { for (const s of subjDef) csRows.push({ classroom_id: c.id, subject_id: sId[s[1]], teacher_id: tid(ci >= 3 && altTeacher[s[1]] ? altTeacher[s[1]] : s[3]), weekly_hours: s[2] }); });
  await bulk(k, 'class_subjects', csRows);
  const classSubjects = await k('class_subjects').orderBy('id');

  /* --- مسیرهای سرویس --- */
  let routeIds = [];
  if (mod('transport')) {
    await bulk(k, 'bus_routes', [
      { name: 'مسیر شمال', driver_name: 'اکبر رضایی', driver_phone: '09123334455', plate: '۱۲ ب ۳۴۵ ایران ۶۷', capacity: 20, monthly_fee: 1200000, stops: 'میدان ونک، پارک ملت، بلوار نیایش' },
      { name: 'مسیر جنوب', driver_name: 'کریم صالحی', driver_phone: '09124445566', plate: '۲۳ ج ۴۵۶ ایران ۱۱', capacity: 18, monthly_fee: 1100000, stops: 'میدان شوش، خیابان مولوی' },
      { name: 'مسیر غرب', driver_name: 'منصور اکبری', driver_phone: '09125556677', plate: '۳۴ د ۱۲۳ ایران ۲۲', capacity: 22, monthly_fee: 1300000, stops: 'شهرک غرب، بلوار فرحزادی' },
    ]);
    routeIds = (await k('bus_routes').orderBy('id')).map((x) => x.id);
  }

  /* --- دانش‌آموزان --- */
  const prefix = String(settings.get('student_code_prefix') || '1405');
  const userRows = []; const studentMeta = [];
  let counter = 0;
  for (const c of classes) {
    const def = classDef[classes.indexOf(c)];
    for (let i = 0; i < 12; i++) {
      counter++;
      const gender = def[4];
      const first = pick(gender === 'male' ? maleFirst : femaleFirst);
      const last = pick(lastNames);
      const code = prefix + String(counter).padStart(4, '0');
      userRows.push({ username: code, password_hash: demoHash.student, role: 'student', full_name: `${first} ${last}`, active: 1 });
      studentMeta.push({ code, first, last, gender, classroom: c, grade: def[1], ability: 0.55 + r() * 0.45 });
    }
  }
  await bulk(k, 'users', userRows);
  const sUsers = await k('users').where({ role: 'student' }).select('id', 'username');
  const sUid = Object.fromEntries(sUsers.map((u) => [u.username, u.id]));
  const byGrade = { هفتم: 1391, هشتم: 1390, نهم: 1389 };
  const students = studentMeta.map((m, i) => {
    const fatherFirst = pick(maleFirst); const motherFirst = pick(femaleFirst);
    const mobileGuardian = phone(r);
    return {
      user_id: sUid[m.code], student_code: m.code, first_name: m.first, last_name: m.last, national_id: nid(r), gender: m.gender,
      birth_date: D(1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28), byGrade[m.grade] + (r() > 0.8 ? 1 : 0)), birth_place: pick(places), religion: 'اسلام', nationality: 'ایرانی',
      blood_type: pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'A-']), classroom_id: m.classroom.id, route_id: routeIds.length && r() > 0.7 ? pick(routeIds) : null,
      enrollment_date: D(6, 20, 1405 - (byGrade[m.grade] - 1390 === 2 ? 0 : 0)), previous_school: r() > 0.5 ? 'دبستان ' + pick(['شهید بهشتی', 'فرهنگ', 'امید', 'نیلوفر', 'سپیده']) : null, status: 'active',
      address: pick(streets), postal_code: String(1000000000 + Math.floor(r() * 899999999)), home_phone: '021' + String(20000000 + Math.floor(r() * 9999999)), mobile: null,
      father_name: `${fatherFirst} ${m.last}`, father_job: pick(jobs), father_phone: mobileGuardian, father_national_id: nid(r), father_education: pick(edu),
      mother_name: `${motherFirst} ${pick(lastNames)}`, mother_job: pick(mothersJobs), mother_phone: phone(r), mother_national_id: nid(r), mother_education: pick(edu),
      guardian_name: null, guardian_relation: null, guardian_phone: null,
      emergency_contact: r() > 0.5 ? `${pick(maleFirst)} ${m.last} (عمو/دایی)` : `${motherFirst} (مادر)`, emergency_phone: phone(r), siblings_count: Math.floor(r() * 4), family_status: 'زندگی با والدین',
      allergies: r() > 0.88 ? pick(['حساسیت به بادام‌زمینی', 'حساسیت به گرده گل', 'حساسیت به لبنیات']) : null,
      chronic_disease: r() > 0.95 ? 'آسم خفیف' : null, medications: null, insurance: pick(['تأمین اجتماعی', 'خدمات درمانی', 'بیمه تکمیلی', 'نیروهای مسلح']), special_needs: null,
      notes: i % 17 === 0 ? 'دانش‌آموز مستعد در المپیاد ریاضی؛ پیگیری ثبت‌نام در دوره تقویتی.' : null,
    };
  });
  await bulk(k, 'students', students);
  const stuRows = await k('students').orderBy('id');
  const abilityById = {}; stuRows.forEach((s, i) => { abilityById[s.id] = studentMeta[i].ability; });
  const stuByClass = {}; stuRows.forEach((s) => { (stuByClass[s.classroom_id] = stuByClass[s.classroom_id] || []).push(s); });

  /* --- برنامه هفتگی (بدون تداخل معلمان) --- */
  if (mod('timetable')) {
    const busy = new Set(); const rows = [];
    const days = [0, 1, 2, 3, 4]; const P = settings.periods().length || 6;
    for (const c of classes) {
      let placed = null;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const slots = []; for (const d of days) for (let p = 1; p <= P; p++) slots.push([d, p]);
        slots.sort(() => r() - 0.5);
        const local = []; const mine = new Set(); let ok = true;
        const css = classSubjects.filter((x) => x.classroom_id === c.id);
        const queue = []; css.forEach((cs) => { for (let h = 0; h < cs.weekly_hours; h++) queue.push(cs); });
        queue.sort(() => r() - 0.5);
        const subjDayCount = {};
        for (const cs of queue) {
          const slot = slots.find(([d, p]) => !mine.has(d + '-' + p) && !busy.has(`${cs.teacher_id}-${d}-${p}`) && (subjDayCount[cs.id + '-' + d] || 0) < 2);
          if (!slot) { ok = false; break; }
          mine.add(slot[0] + '-' + slot[1]); subjDayCount[cs.id + '-' + slot[0]] = (subjDayCount[cs.id + '-' + slot[0]] || 0) + 1;
          local.push({ classroom_id: c.id, day: slot[0], period: slot[1], class_subject_id: cs.id, _t: cs.teacher_id });
        }
        if (ok) placed = local;
      }
      if (placed) placed.forEach((x) => { busy.add(`${x._t}-${x.day}-${x.period}`); rows.push({ classroom_id: x.classroom_id, day: x.day, period: x.period, class_subject_id: x.class_subject_id }); });
    }
    await bulk(k, 'timetable', rows);
  }

  /* --- حضور و غیاب روزهای مدرسه از شروع سال تا امروز --- */
  /* تعطیلات نمونه: رسمی‌های ثابت سال‌های جاری + یک تعطیلی دستی (مدیر می‌تواند آن‌ها را ویرایش کند) */
  const cal = require('./lib/calendar'); const bellLib = require('./lib/bell');
  const holRows = []; const jy0 = J.isoToJ(year.start_date).jy;
  for (const jy of [jy0, jy0 + 1]) for (const h of cal.fixedSolarFor(jy)) if (h.start_date >= year.start_date && Math.abs(Date.parse(h.start_date) - Date.parse(today)) > 4 * 86400000) holRows.push({ ...h, kind: 'official', created_by: 1 });
  holRows.push({ start_date: J.addDays(today, -12), end_date: J.addDays(today, -11), title: 'تعطیلی به‌دلیل آلودگی هوا', kind: 'manual', created_by: 1 });
  await bulk(k, 'holidays', holRows);
  /* الگوی ویژه‌ی زنگ: چهارشنبه‌ها زنگ‌های کوتاه‌تر (تعداد زنگ‌ها برابر، پس برنامه‌ی هفتگی دست‌نخورده می‌ماند) */
  await bellLib.saveSchedule(k, { name: 'چهارشنبه‌ها (زنگ‌های کوتاه)', days: [4], grades: [], isDefault: false, rows: bellLib.fromTemplate({ count: 6, minutes: 35, brk: 5 }) });
  await bellLib.load(k);
  const holSet = new Set(); for (const h of holRows) for (let d = h.start_date; d <= h.end_date; d = J.addDays(d, 1)) holSet.add(d);
  const attRows = []; const absences = [];
  if (mod('attendance')) {
    const start = year.start_date; const wd = settings.weekDays();
    for (let dte = start; dte <= today; dte = J.addDays(dte, 1)) {
      if (!wd.includes(J.dow(dte)) || holSet.has(dte)) continue;
      for (const s of stuRows) {
        const x = r();
        const status = x < 0.915 ? 'present' : x < 0.955 ? 'absent' : x < 0.985 ? 'late' : x < 0.993 ? 'excused' : 'leave';
        attRows.push({ student_id: s.id, classroom_id: s.classroom_id, date: dte, period: 0, status, note: status === 'late' ? 'تأخیر ۱۰ دقیقه‌ای' : null, recorded_by: tUid['t.ahmadi'] });
        if (status === 'absent') absences.push({ s, date: dte });
      }
    }
    await bulk(k, 'attendance', attRows);
  }

  /* --- ارزشیابی و نمرات --- */
  if (mod('grades')) {
    const aDefs = [['کوئیز اول', 'quiz', 10, 1, D(7, 2), 1], ['ارزشیابی مستمر ۱', 'continuous', 20, 2, D(7, 6), 1], ['فعالیت کلاسی', 'continuous', 20, 1, D(7, 8), 0]];
    const aRows = [];
    for (const cs of classSubjects) for (const a of aDefs) aRows.push({ class_subject_id: cs.id, title: a[0], type: a[1], max_score: a[2], weight: a[3], date: a[4], term: 1, published: a[5], created_by: null });
    await bulk(k, 'assessments', aRows);
    const assessments = await k('assessments').select('id', 'class_subject_id', 'max_score');
    const csClass = Object.fromEntries(classSubjects.map((c) => [c.id, c.classroom_id]));
    const sc = [];
    for (const a of assessments) {
      for (const s of stuByClass[csClass[a.class_subject_id]] || []) {
        if (r() < 0.025) { sc.push({ assessment_id: a.id, student_id: s.id, score: null, note: 'غایب' }); continue; }
        const v = Math.max(0, Math.min(a.max_score, (abilityById[s.id] + (r() - 0.5) * 0.35) * a.max_score * 1.02));
        sc.push({ assessment_id: a.id, student_id: s.id, score: Math.round(v * 4) / 4, note: null });
      }
    }
    await bulk(k, 'scores', sc);
  }

  /* --- تکالیف --- */
  if (mod('homework')) {
    const hwDefs = [['SOC', 'جمع‌آوری مقاله درباره تمدن ایران باستان', 'یک مقاله یک‌صفحه‌ای درباره یکی از دستاوردهای تمدن ایران باستان بنویسید.', -2], ['MATH', 'تمرین‌های فصل اول (اعداد صحیح)', 'تمرین‌های صفحه ۱۲ تا ۱۵ کتاب را حل کنید و راه‌حل کامل بنویسید.', 3], ['FA', 'نوشتن انشا: «روزی که ...»', 'انشایی با موضوع «روزی که هرگز فراموش نمی‌کنم» در حداقل ۲۰ سطر بنویسید.', 5], ['SCI', 'گزارش آزمایش اندازه‌گیری حجم', 'گزارش آزمایش کلاسی را با عکس و نتیجه‌گیری تحویل دهید.', 1]];
    const rows = [];
    for (const cs of classSubjects) { const code = Object.keys(sId).find((c) => sId[c] === cs.subject_id); const h = hwDefs.find((x) => x[0] === code); if (h) rows.push({ class_subject_id: cs.id, title: h[1], description: h[2], due_date: J.addDays(today, h[3]), max_score: 20, created_by: null }); }
    await bulk(k, 'homework', rows);
    const hws = await k('homework'); const csClass = Object.fromEntries(classSubjects.map((c) => [c.id, c.classroom_id]));
    const subs = [];
    for (const h of hws) for (const s of stuByClass[csClass[h.class_subject_id]] || []) {
      if (r() < 0.62) { const graded = h.due_date < today; subs.push({ homework_id: h.id, student_id: s.id, answer: 'پاسخ تکلیف پیوست است. با تشکر.', submitted_at: J.addDays(today, -1) + ' 10:30:00', late: 0, score: graded ? Math.round(abilityById[s.id] * 20 * 2) / 2 : null, feedback: graded ? pick(['آفرین، ادامه بده.', 'خوب بود؛ به نکات نگارشی دقت کن.', 'عالی!', 'نیاز به تلاش بیشتر دارد.']) : null }); }
    }
    await bulk(k, 'homework_submissions', subs);
  }

  /* --- اطلاعیه‌ها و رویدادها --- */
  if (mod('announcements')) {
    await bulk(k, 'announcements', [
      { title: 'آغاز سال تحصیلی جدید مبارک', body: 'سال تحصیلی جدید را به همه دانش‌آموزان، همکاران و اولیای گرامی تبریک می‌گوییم. حضور به‌موقع در ساعت ۷:۴۵ الزامی است.', audience: 'all', pinned: 1, created_by: 1 },
      { title: 'جلسه انجمن اولیا و مربیان', body: 'جلسه انجمن اولیا و مربیان روز سه‌شنبه ساعت ۱۶ در سالن اجتماعات برگزار می‌شود. حضور اولیا مورد انتظار است.', audience: 'all', pinned: 0, expires_on: J.addDays(today, 14), created_by: 1 },
      { title: 'برنامه امتحانات میان‌نوبت اول', body: 'برنامه امتحانات میان‌نوبت اول در بخش «برنامه امتحانات» منتشر شد. لطفاً مطالعه کنید.', audience: 'students', pinned: 0, created_by: 1 },
      { title: 'جلسه شورای معلمان', body: 'جلسه شورای معلمان یکشنبه ساعت ۱۴ در دفتر مدیریت برگزار می‌شود. دستور جلسه: ارزشیابی توصیفی و برنامه امتحانات.', audience: 'teachers', pinned: 0, created_by: 1 },
      { title: 'اردوی علمی کلاس هشتم الف', body: 'اردوی بازدید از موزه علوم در هفته آینده برگزار می‌شود. رضایت‌نامه اولیا تا پنجشنبه تحویل داده شود.', audience: 'class', classroom_id: classes[2].id, pinned: 0, created_by: 1 },
    ]);
  }
  if (mod('calendar')) {
    await bulk(k, 'events', [
      { title: 'آغاز سال تحصیلی', description: 'مراسم جشن شکوفه‌ها و آغاز سال تحصیلی', start_date: D(6, 31), type: 'ceremony', audience: 'all', location: 'حیاط مدرسه', created_by: 1 },
      { title: 'روز جهانی معلم', description: 'تجلیل از همکاران', start_date: D(7, 13), type: 'ceremony', audience: 'all', start_time: '10:00', location: 'سالن اجتماعات', created_by: 1 },
      { title: 'جلسه انجمن اولیا و مربیان', start_date: D(7, 16), type: 'meeting', audience: 'all', start_time: '16:00', location: 'سالن اجتماعات', created_by: 1 },
      { title: 'مسابقات ورزشی بین کلاسی', description: 'فوتسال و والیبال', start_date: D(7, 20), end_date: D(7, 22), type: 'event', audience: 'students', location: 'سالن ورزش', created_by: 1 },
      { title: 'اردوی علمی - موزه علوم', start_date: D(7, 24), type: 'trip', audience: 'students', start_time: '08:00', created_by: 1 },
      { title: 'امتحانات میان‌نوبت اول', start_date: D(8, 20), end_date: D(8, 25), type: 'exam', audience: 'all', created_by: 1 },
      { title: 'نمایشگاه کتاب مدرسه', start_date: D(8, 10), type: 'event', audience: 'all', location: 'کتابخانه', created_by: 1 },
      { title: 'جشنواره علوم و فناوری', start_date: D(9, 6), type: 'event', audience: 'all', created_by: 1 },
    ]);
  }
  if (mod('exams')) {
    const rows = []; const start = [D(8, 20), D(8, 21), D(8, 22), D(8, 23), D(8, 24)];
    const order = ['MATH', 'FA', 'SCI', 'EN', 'REL'];
    for (const c of classes) order.forEach((code, i) => rows.push({ classroom_id: c.id, subject_id: sId[code], exam_date: start[i], start_time: '08:30', duration: code === 'MATH' || code === 'SCI' ? 90 : 60, location: 'کلاس ' + (101 + classes.indexOf(c)), type: 'midterm', notes: i === 0 ? 'همراه داشتن کارت ورود به جلسه الزامی است.' : null }));
    await bulk(k, 'exam_schedule', rows);
  }

  /* --- انضباطی، بهداشت، جلسات --- */
  if (mod('discipline')) {
    const s = stuRows; const rows = [
      [0, 'positive', 'کسب مقام در مسابقه ریاضی منطقه', 3, 'تشویق در جمع'], [1, 'positive', 'کمک به همکلاسی‌ها در تدریس', 2, 'ثبت در پرونده'], [5, 'positive', 'رعایت نظم و پاکیزگی کلاس', 1, ''],
      [3, 'negative', 'تأخیر مکرر در ورود به مدرسه', -1, 'تذکر شفاهی'], [8, 'negative', 'عدم رعایت یونیفرم مدرسه', -1, 'تذکر کتبی به اولیا'], [14, 'negative', 'اخلال در نظم کلاس', -2, 'احضار اولیا'],
      [20, 'positive', 'شرکت فعال در برنامه صبحگاه', 1, ''], [25, 'negative', 'فراموشی مکرر تکلیف', -1, 'تذکر'], [30, 'positive', 'مسئولیت‌پذیری در اردو', 2, ''], [40, 'positive', 'اهدای کتاب به کتابخانه مدرسه', 2, 'تقدیرنامه'],
    ].map((x, i) => ({ student_id: s[x[0]].id, type: x[1], title: x[2], description: '', points: x[3], record_date: J.addDays(today, -(i + 1)), action_taken: x[4], recorded_by: tUid['t.ahmadi'] }));
    await bulk(k, 'discipline_records', rows);
  }
  if (mod('health')) {
    await bulk(k, 'health_records', [
      { student_id: stuRows[2].id, record_date: J.addDays(today, -3), type: 'visit', description: 'سردرد و تب خفیف', action_taken: 'استراحت و اطلاع به اولیا', parent_informed: 1, recorded_by: 1 },
      { student_id: stuRows[11].id, record_date: J.addDays(today, -5), type: 'injury', description: 'زخم سطحی زانو هنگام ورزش', action_taken: 'پانسمان و ضدعفونی', parent_informed: 1, recorded_by: 1 },
      { student_id: stuRows[30].id, record_date: J.addDays(today, -1), type: 'checkup', description: 'معاینه دوره‌ای بینایی', action_taken: 'توصیه به مراجعه به چشم‌پزشک', parent_informed: 1, recorded_by: 1 },
      { student_id: stuRows[44].id, record_date: J.addDays(today, -2), type: 'illness', description: 'دل‌درد', action_taken: 'استراحت و تماس با اولیا', parent_informed: 1, recorded_by: 1 },
      { student_id: stuRows[55].id, record_date: J.addDays(today, -6), type: 'vaccine', description: 'واکسن یادآور (دوگانه)', action_taken: 'انجام شد', parent_informed: 0, recorded_by: 1 },
    ]);
  }
  if (mod('meetings')) {
    await bulk(k, 'meetings', [
      { student_id: stuRows[3].id, meeting_date: J.addDays(today, 2), meeting_time: '10:00', with_whom: 'سیما حسینی (معاون)', purpose: 'بررسی تأخیرهای مکرر', status: 'scheduled', created_by: 1 },
      { student_id: stuRows[14].id, meeting_date: J.addDays(today, 3), meeting_time: '11:30', with_whom: 'احمد احمدی', purpose: 'گفتگو درباره وضعیت درسی', status: 'scheduled', created_by: 1 },
      { student_id: stuRows[8].id, meeting_date: J.addDays(today, -2), meeting_time: '09:00', with_whom: 'سیما حسینی (معاون)', purpose: 'یونیفرم و انضباط', minutes: 'اولیا متعهد شدند یونیفرم کامل تهیه شود.', status: 'held', created_by: 1 },
      { student_id: stuRows[40].id, meeting_date: J.addDays(today, 5), meeting_time: '12:00', with_whom: 'مدیر مدرسه', purpose: 'مشاوره تحصیلی و انتخاب رشته', status: 'scheduled', created_by: 1 },
    ]);
  }

  /* --- مالی --- */
  if (mod('finance')) {
    const fees = stuRows.map((s) => ({ student_id: s.id, title: 'شهریه نوبت اول', amount: 12000000, discount: r() > 0.85 ? 1200000 : 0, due_date: D(7, 30), category: 'tuition', academic_year_id: year.id }));
    const reg = stuRows.map((s) => ({ student_id: s.id, title: 'ثبت‌نام و بیمه حوادث', amount: 2000000, discount: 0, due_date: D(6, 25), category: 'registration', academic_year_id: year.id }));
    await bulk(k, 'fees', [...reg, ...fees]);
    const all = await k('fees').select('id', 'amount', 'discount', 'category');
    const pays = [];
    for (const f of all) {
      const net = f.amount - f.discount; const x = r();
      if (f.category === 'registration') { if (x < 0.95) pays.push({ fee_id: f.id, amount: net, paid_at: D(6, 24 - Math.floor(r() * 5)), method: pick(['card', 'transfer', 'online']), reference: String(100000 + Math.floor(r() * 899999)), recorded_by: 1 }); } else if (x < 0.55) pays.push({ fee_id: f.id, amount: net, paid_at: J.addDays(today, -Math.floor(r() * 6)), method: pick(['card', 'transfer', 'cash', 'cheque']), reference: String(100000 + Math.floor(r() * 899999)), recorded_by: 1 });
      else if (x < 0.8) pays.push({ fee_id: f.id, amount: Math.round(net / 2), paid_at: J.addDays(today, -Math.floor(r() * 6)), method: 'transfer', reference: String(100000 + Math.floor(r() * 899999)), recorded_by: 1 });
    }
    await bulk(k, 'payments', pays);
  }

  /* --- کتابخانه --- */
  if (mod('library')) {
    const books = [['ماهی سیاه کوچولو', 'صمد بهرنگی', 'داستان'], ['دا', 'سیده زهرا حسینی', 'خاطرات'], ['شازده کوچولو', 'آنتوان دو سنت‌اگزوپری', 'داستان'], ['قصه‌های مجید', 'هوشنگ مرادی کرمانی', 'داستان'], ['گلستان سعدی', 'سعدی', 'ادبیات'], ['کلیله و دمنه', 'نصرالله منشی', 'ادبیات'], ['شاهنامه برای نوجوانان', 'فردوسی', 'ادبیات'], ['هری پاتر و سنگ جادو', 'جی. کی. رولینگ', 'داستان'], ['ریاضیات برای همه', 'نویسندگان مختلف', 'علمی'], ['اسرار سیارات', 'کارل ساگان', 'علمی'], ['خوارزمی، پدر جبر', 'مجموعه آموزشی', 'زندگی‌نامه'], ['دایرةالمعارف علوم نوجوانان', 'گروه مؤلفان', 'مرجع'], ['من یک دانشمندم', 'گروه مؤلفان', 'علمی'], ['پیامبر', 'جبران خلیل جبران', 'ادبیات'], ['آموزش خلاقیت به کودکان', 'گروه مؤلفان', 'آموزشی'], ['جزیره گنج', 'رابرت لویی استیونسن', 'داستان'], ['دور دنیا در هشتاد روز', 'ژول ورن', 'داستان'], ['سفر به مرکز زمین', 'ژول ورن', 'داستان'], ['ققنوس', 'گروه مؤلفان', 'شعر'], ['فرهنگ لغت فارسی عمید', 'حسن عمید', 'مرجع']];
    await bulk(k, 'books', books.map((b, i) => ({ title: b[0], author: b[1], category: b[2], isbn: '978-600-' + String(10000 + i * 37), publisher: 'نشر نمونه', copies: 2 + (i % 4), shelf: String.fromCharCode(65 + (i % 5)) + '-' + (1 + (i % 7)), description: '' })));
    const bk = await k('books').orderBy('id');
    await bulk(k, 'book_loans', [
      { book_id: bk[0].id, student_id: stuRows[1].id, loan_date: J.addDays(today, -4), due_date: J.addDays(today, 10), recorded_by: 1 },
      { book_id: bk[2].id, student_id: stuRows[9].id, loan_date: J.addDays(today, -20), due_date: J.addDays(today, -6), recorded_by: 1 },
      { book_id: bk[7].id, student_id: stuRows[22].id, loan_date: J.addDays(today, -3), due_date: J.addDays(today, 11), recorded_by: 1 },
      { book_id: bk[3].id, student_id: stuRows[35].id, loan_date: J.addDays(today, -25), due_date: J.addDays(today, -11), recorded_by: 1 },
      { book_id: bk[1].id, student_id: stuRows[40].id, loan_date: J.addDays(today, -9), due_date: J.addDays(today, 5), returned_at: J.addDays(today, -1), recorded_by: 1 },
      { book_id: bk[9].id, student_id: stuRows[50].id, loan_date: J.addDays(today, -7), due_date: J.addDays(today, 7), recorded_by: 1 },
      { book_id: bk[4].id, teacher_id: tid('r.mousavi'), loan_date: J.addDays(today, -2), due_date: J.addDays(today, 28), recorded_by: 1 },
    ]);
  }

  /* --- تیکت‌ها --- */
  if (mod('tickets')) {
    const adminId = 1; const deputyId = (await k('users').where({ username: 'deputy' }).first()).id;
    const now = (mins) => new Date(Date.now() - mins * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const homeroomUser = (stu) => { const c = classes.find((x) => x.id === stu.classroom_id); const t = teachers.find((x) => x.id === c.homeroom_teacher_id); return t.user_id; };
    const mk = async (t, msgs) => {
      const created = now(t.ago);
      const res = await k('tickets').insert({ subject: t.subject, category: t.category, priority: t.priority || 'normal', status: t.status, created_by: t.by, recipient_user_id: t.to || null, recipient_role: t.role || null, student_id: t.student || null, related_date: t.related || null, rating: t.rating || null, rating_comment: t.rc || null, justified: t.justified ? 1 : 0, created_at: created, updated_at: now(t.ago - (msgs.length - 1) * 20), closed_at: t.status === 'closed' ? now(t.ago - 100) : null });
      const id = Array.isArray(res) ? res[0] : res;
      let i = 0;
      for (const m of msgs) await k('ticket_messages').insert({ ticket_id: id, user_id: m[0], body: m[1], internal: m[2] ? 1 : 0, created_at: now(t.ago - i++ * 20) });
    };
    const A = absences;
    const abs1 = A[0], abs2 = A[Math.min(7, A.length - 1)], abs3 = A[Math.min(15, A.length - 1)];
    if (abs1) await mk({ subject: 'توجیه غیبت روز ' + toFa(J.isoToJString(abs1.date)), category: 'absence', status: 'open', by: abs1.s.user_id, to: homeroomUser(abs1.s), student: abs1.s.id, related: abs1.date, ago: 300, priority: 'normal' }, [[abs1.s.user_id, 'سلام. بنده به دلیل بیماری (سرماخوردگی) در تاریخ مذکور نتوانستم در مدرسه حاضر شوم. گواهی پزشک را نیز پیوست می‌کنم. لطفاً غیبت را موجه کنید.']]);
    if (abs2) await mk({ subject: 'توجیه غیبت روز ' + toFa(J.isoToJString(abs2.date)), category: 'absence', status: 'closed', by: abs2.s.user_id, to: homeroomUser(abs2.s), student: abs2.s.id, related: abs2.date, ago: 2000, justified: 1, rating: 5, rc: 'سریع رسیدگی شد.' }, [[abs2.s.user_id, 'سلام، به دلیل مراجعه به پزشک غایب بودم.'], [homeroomUser(abs2.s), 'سلام. غیبت شما موجه ثبت شد. سلامت باشید.'], [abs2.s.user_id, 'ممنون از شما.']]);
    if (abs3) await mk({ subject: 'سؤال درباره غیبت', category: 'absence', status: 'answered', by: abs3.s.user_id, role: 'admin', student: abs3.s.id, related: abs3.date, ago: 700 }, [[abs3.s.user_id, 'آیا غیبت اینجانب در تاریخ مذکور به‌عنوان غیرموجه ثبت شده است؟'], [adminId, 'سلام. بله، تا زمانی که مدرک ارائه نشود غیرموجه است. لطفاً گواهی را ارسال کنید.']]);
    const s0 = stuRows[0], s10 = stuRows[10], s30 = stuRows[30], s50 = stuRows[50];
    await mk({ subject: 'درخواست راهنمایی برای تکلیف ریاضی', category: 'academic', status: 'answered', by: s0.user_id, to: tUid['t.ahmadi'], student: s0.id, ago: 900 }, [[s0.user_id, 'سلام استاد. در تمرین شماره ۵ فصل اول مشکل دارم. می‌توانید راهنمایی کنید؟'], [tUid['t.ahmadi'], 'سلام. ابتدا قاعده جمع اعداد هم‌علامت را مرور کنید؛ در جلسه آینده نمونه مشابه را حل می‌کنم.']]);
    await mk({ subject: 'تغییر شماره تماس اولیا', category: 'general', status: 'open', by: s10.user_id, role: 'admin', student: s10.id, ago: 200, priority: 'low' }, [[s10.user_id, 'شماره تماس مادرم تغییر کرده است. شماره جدید: ۰۹۱۲۱۲۳۴۵۶۷. لطفاً در پرونده اصلاح کنید.']]);
    await mk({ subject: 'پیشنهاد برگزاری کلاس تقویتی', category: 'suggestion', status: 'pending', by: s30.user_id, role: 'admin', student: s30.id, ago: 1500, priority: 'normal' }, [[s30.user_id, 'پیشنهاد می‌کنم برای درس علوم کلاس تقویتی بعد از ظهر برگزار شود.'], [deputyId, 'پیشنهاد شما ثبت شد. در شورای معلمان بررسی خواهد شد.'], [s30.user_id, 'ممنون. منتظر نتیجه هستم.']]);
    await mk({ subject: 'مشکل در ورود به پنل', category: 'technical', status: 'closed', by: s50.user_id, role: 'admin', student: s50.id, ago: 4000, rating: 4 }, [[s50.user_id, 'نمی‌توانم رمز عبورم را تغییر دهم.'], [adminId, 'رمز شما بازنشانی شد. لطفاً با رمز جدید وارد شوید.']]);
    await mk({ subject: 'درخواست مرخصی برای شرکت در المپیاد', category: 'general', status: 'open', by: tUid['m.kazemi'], role: 'admin', ago: 400, priority: 'high' }, [[tUid['m.kazemi'], 'سلام. برای همراهی دانش‌آموزان در المپیاد علوم هفته آینده به یک روز مرخصی نیاز دارم.']]);
    await mk({ subject: 'عدم رعایت یونیفرم دانش‌آموز', category: 'discipline', status: 'answered', by: tUid['t.ahmadi'], to: deputyId, student: stuRows[8].id, ago: 1200, priority: 'high' }, [[tUid['t.ahmadi'], 'دانش‌آموز مذکور بار سوم است که بدون یونیفرم حاضر می‌شود.'], [deputyId, 'با اولیا تماس گرفته شد و جلسه حضوری تنظیم شد.', 0], [deputyId, 'یادداشت داخلی: در صورت تکرار، تذکر کتبی صادر شود.', 1]]);
    await mk({ subject: 'موضوع شهریه', category: 'finance', status: 'pending', by: stuRows[12].user_id, role: 'admin', student: stuRows[12].id, ago: 600 }, [[stuRows[12].user_id, 'امکان پرداخت شهریه به‌صورت اقساطی وجود دارد؟'], [adminId, 'لطفاً با مسئول مالی هماهنگ کنید؛ درخواست شما ثبت شد.']]);
  }

  /* --- یادداشت‌ها و اعلان‌ها --- */
  await bulk(k, 'student_notes', [
    { student_id: stuRows[3].id, author_id: tUid['t.ahmadi'], body: 'نیاز به پیگیری در مورد تأخیر صبح‌ها؛ با اولیا هماهنگ شود.', private: 1 },
    { student_id: stuRows[0].id, author_id: tUid['t.ahmadi'], body: 'علاقه‌مند به شرکت در المپیاد ریاضی.', private: 1 },
    { student_id: stuRows[14].id, author_id: 1, body: 'سابقه ضعف در درس علوم در سال قبل؛ پیشنهاد کلاس تقویتی.', private: 1 },
  ]);
  const nots = [];
  for (const s of stuRows.slice(0, 12)) nots.push({ user_id: s.user_id, title: 'اطلاعیه جدید: آغاز سال تحصیلی', body: 'اطلاعیه جدیدی برای شما منتشر شده است.', link: '/announcements', type: 'info' });
  for (const t of teachers) nots.push({ user_id: t.user_id, title: 'جلسه شورای معلمان', body: 'یکشنبه ساعت ۱۴ در دفتر مدیریت.', link: '/announcements', type: 'info' });
  await bulk(k, 'notifications', nots);

  /* --- فایل‌های نمونه پرونده --- */
  if (mod('documents')) {
    config.ensureDirs();
    const docs = [];
    for (const [i, s] of stuRows.slice(0, 6).entries()) {
      const name = `demo-doc-${s.student_code}.txt`;
      fs.writeFileSync(path.join(config.UPLOAD_DIR, 'documents', name), `نمونه مدرک دانش‌آموز ${s.first_name} ${s.last_name}\nاین فایل برای نمایش قابلیت مدارک پرونده در داده‌ی دمو ساخته شده است.\n`);
      docs.push({ student_id: s.id, title: i % 2 ? 'تصویر کارت ملی' : 'کارنامه سال قبل', category: i % 2 ? 'id' : 'transcript', file_name: name, original_name: name, size: 120, uploaded_by: 1 });
    }
    await bulk(k, 'student_documents', docs);
  }
  await require('./seedV2').seedV2(k);
  await settings.set('show_demo_logins', '1');
  await settings.set('otp_demo_show_code', '1');
  await k('audit_logs').insert({ user_id: 1, user_name: 'سامانه', action: 'install', entity: 'system', details: 'نصب سامانه و بارگذاری داده نمونه' });
}

module.exports = { seedBase, seedDemo };

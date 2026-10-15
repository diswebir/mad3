'use strict';
/** داده‌ی نمونه‌ی قابلیت‌های نسخه‌ی ۲ (حساب اولیا، اقساط، بانک سؤال، منابع انسانی، ...). پس از seedDemo اجرا می‌شود. */
const J = require('./utils/jalali');
const svc = require('./services');
const modules = require('./modules');
const fin = require('./lib/finance');
const hr = require('./lib/hr');

async function seedV2(k) {
  const mod = (key) => modules.isEnabled(key);
  const today = J.todayISO(); const now = svc.nowStr();
  const students = await k('students').orderBy('id'); const teachers = await k('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 't.user_id', 'u.username', 'u.full_name');
  const tByName = Object.fromEntries(teachers.map((t) => [t.username, t]));
  const subjects = await k('subjects').orderBy('id');

  /* --- حساب اولیا --- */
  if (mod('parents')) {
    const { ensureParent } = require('./routes/parents');
    for (const s of students.slice(0, 6)) { const r = await ensureParent(k, s, 'father', null); if (s === students[0] && r.user) { await k('users').where({ id: r.user.id }).update({ password_hash: svc.hash('parent123'), must_change_password: 0 }); } }
    for (const s of students.slice(2, 4)) await ensureParent(k, s, 'mother', null);
  }
  /* --- افراد مجاز تحویل + برگه‌ی خروج --- */
  if (students.length > 3) {
    await k('student_guardians').insert([
      { student_id: students[0].id, name: 'علی‌اکبر ' + students[0].last_name, relation: 'عمو', phone: '09121234567', can_pickup: 1, is_legal: 0, notes: 'در صورت نبودن والدین' },
      { student_id: students[1].id, name: 'فرزانه ' + students[1].last_name, relation: 'خاله', phone: '09351234567', can_pickup: 1, is_legal: 0 },
    ]);
    if (mod('exits')) await k('exit_permits').insert([{ student_id: students[1].id, kind: 'exit', permit_date: today, permit_time: '10:30', reason: 'نوبت پزشک', picked_up_by: 'فرزانه ' + students[1].last_name, approved_by: 1, approved_name: 'مدیر سامانه' }, { student_id: students[3].id, kind: 'late', permit_date: J.addDays(today, -1), permit_time: '08:40', reason: 'مشکل ترافیکی', approved_by: 1, approved_name: 'مدیر سامانه' }]);
  }
  /* --- اقساط شهریه --- */
  if (mod('finance')) {
    const fees = await k('fees').where({ title: 'شهریه نوبت اول' }).orderBy('id').limit(8);
    for (const f of fees) {
      const parts = fin.splitInstallments(Number(f.amount) - Number(f.discount || 0), 3, f.due_date || J.addDays(today, 30), 1);
      await k('fee_installments').insert(parts.map((p, i) => ({ fee_id: f.id, seq: i + 1, due_date: p.due_date, amount: p.amount })));
    }
    await fin.backfillDocNos(k);
  }
  /* --- بانک سؤال و برگه‌ی امتحانی --- */
  if (mod('questionbank') && subjects.length) {
    const sMath = subjects.find((s) => /ریاضی/.test(s.name)) || subjects[0]; const sSci = subjects.find((s) => /علوم/.test(s.name)) || subjects[1] || subjects[0];
    const Q = (subject, type, text, extra = {}) => ({ subject_id: subject.id, grade_level: 'هفتم', type, text, options: null, answer: null, difficulty: 2, score: 1, created_by: 1, ...extra });
    const mcq = (opts, ans) => ({ options: JSON.stringify(opts), answer: String(ans) });
    const qs = [
      Q(sMath, 'mcq', 'حاصل ۳ + ۴ × ۲ کدام است؟', { ...mcq(['۱۴', '۱۱', '۹', '۱۰'], 1), difficulty: 1 }),
      Q(sMath, 'mcq', 'کوچک‌ترین عدد اول کدام است؟', { ...mcq(['۰', '۱', '۲', '۳'], 2), difficulty: 1 }),
      Q(sMath, 'mcq', 'ب.م.م دو عدد ۱۲ و ۱۸ برابر است با:', { ...mcq(['۳', '۶', '۹', '۱۲'], 1), difficulty: 2 }),
      Q(sMath, 'tf', 'هر عدد زوج بر ۴ بخش‌پذیر است.', { answer: 'false', difficulty: 1 }),
      Q(sMath, 'tf', 'مجموع زاویه‌های داخلی هر مثلث ۱۸۰ درجه است.', { answer: 'true', difficulty: 1 }),
      Q(sMath, 'short', 'مساحت مربعی به ضلع ۷ را بنویسید.', { answer: '۴۹', difficulty: 2 }),
      Q(sMath, 'descriptive', 'ثابت کنید مجموع سه عدد متوالی همواره بر ۳ بخش‌پذیر است.', { answer: 'اگر عددها n-1 و n و n+1 باشند مجموع ۳n می‌شود.', difficulty: 3, score: 2 }),
      Q(sSci, 'mcq', 'کدام یک از اجزای سلول گیاهی است که در سلول جانوری وجود ندارد؟', { ...mcq(['هسته', 'دیواره سلولی', 'میتوکندری', 'غشا'], 1), difficulty: 2 }),
      Q(sSci, 'tf', 'آب در دمای صفر درجه‌ی سانتی‌گراد یخ می‌زند.', { answer: 'true', difficulty: 1 }),
      Q(sSci, 'short', 'گیاهان در فتوسنتز کدام گاز را جذب می‌کنند؟', { answer: 'کربن دی‌اکسید', difficulty: 1 }),
      Q(sSci, 'descriptive', 'تفاوت ماده‌ی خالص و مخلوط را با مثال شرح دهید.', { difficulty: 3, score: 2 }),
    ];
    await k.batchInsert('questions', qs, 20);
    const cs = await k('class_subjects').where({ subject_id: sMath.id }).orderBy('id').first();
    if (cs) {
      const ids = await k('questions').where({ subject_id: sMath.id }).orderBy('id').select('id', 'score');
      await k('exam_papers').insert({ title: 'آزمون میان‌نوبت ریاضی', class_subject_id: cs.id, exam_date: J.addDays(today, 10), duration: 60, instructions: 'به همه‌ی سؤالات پاسخ دهید. استفاده از ماشین‌حساب مجاز نیست.', items: JSON.stringify(ids.map((q) => ({ id: q.id, score: Number(q.score) }))), created_by: 1 });
    }
  }
  /* --- منابع انسانی --- */
  if (mod('hr')) {
    const kz = tByName['m.kazemi']; const ah = tByName['t.ahmadi']; const tr = tByName['a.taheri'];
    if (kz) await k('teacher_leaves').insert({ teacher_id: kz.id, kind: 'casual', start_date: J.addDays(today, 5), end_date: J.addDays(today, 6), days: 2, reason: 'شرکت در دوره‌ی آموزشی', status: 'pending' });
    if (ah) await k('teacher_leaves').insert({ teacher_id: ah.id, kind: 'sick', start_date: J.addDays(today, -20), end_date: J.addDays(today, -18), days: 3, reason: 'استعلاجی', status: 'approved', decided_by: 1, decided_at: now });
    if (tr) await k('teacher_leaves').insert({ teacher_id: tr.id, kind: 'casual', start_date: J.addDays(today, -40), end_date: J.addDays(today, -39), days: 2, reason: 'امور شخصی', status: 'approved', decided_by: 1, decided_at: now });
    if (ah) await k('teachers').where({ id: ah.id }).update({ weekly_load: 24 });
    for (const [t, sc, c] of [[ah, [5, 4, 5, 4, 4, 5], 'تعامل بسیار خوب با دانش‌آموزان و اولیا.'], [tr, [4, 4, 3, 4, 5, 4], 'پیشنهاد: ثبت نمرات با سرعت بیشتر.']]) {
      if (!t) continue; const scores = Object.fromEntries(hr.CRITERIA.map((x, i) => [x.key, sc[i]]));
      await k('teacher_evaluations').insert({ teacher_id: t.id, eval_date: J.addDays(today, -30), term: 1, scores: JSON.stringify(scores), total: hr.evalTotal(scores), comment: c, evaluator_id: 1 });
    }
  }
  /* --- توصیف کارنامه --- */
  if (mod('grades') && students.length) {
    await k('report_comments').insert(students.slice(0, 4).map((s, i) => ({ student_id: s.id, term: 0, comment: ['تلاش و پشتکار ایشان قابل تقدیر است.', 'با برنامه‌ریزی بهتر می‌تواند نتیجه‌ی بهتری بگیرد.', 'رفتار و مشارکت کلاسی عالی.', 'در درس ریاضی نیاز به تمرین بیشتر دارد.'][i], author_id: 1 })));
  }
  /* --- قالب‌های پیام --- */
  if (mod('sms')) {
    await k('message_templates').insert([
      { title: 'یادآوری جلسه‌ی اولیا', body: 'اولیای گرامی، جلسه‌ی اولیا و مربیان روز یکشنبه ساعت ۱۶ در مدرسه برگزار می‌شود. حضور شما موجب سپاس است.', category: 'meeting' },
      { title: 'تعطیلی مدرسه', body: 'به اطلاع می‌رساند به‌دلیل شرایط جوی، مدرسه فردا تعطیل است.', category: 'general' },
      { title: 'یادآوری شهریه', body: 'اولیای گرامی، لطفاً نسبت به تسویه‌ی اقساط معوق شهریه اقدام فرمایید.', category: 'finance' },
    ]);
  }
  /* --- در دسترس نبودن معلم (برای زمان‌بندی) --- */
  if (mod('timetable')) { const tr = tByName['a.taheri']; if (tr) await k('teacher_unavailability').insert([{ teacher_id: tr.id, day: 3, period: 1, note: 'جلسه‌ی دانشگاه' }, { teacher_id: tr.id, day: 3, period: 2, note: 'جلسه‌ی دانشگاه' }]); }
  /* --- تولدهای نزدیک به امروز (برای نمایش شمارش معکوس، تقویم هفتگی و اعلان‌ها) --- */
  if (mod('birthdays')) {
    const today = J.todayISO(); const ids = (await k('students').where({ status: 'active' }).orderBy('id').limit(8).select('id', 'birth_date'));
    const plan = [[0, 11], [1, 0], [2, 2], [3, 3], [4, 5], [5, 9]];
    for (const [i, off] of plan) {
      const st = ids[i]; if (!st) continue;
      const j = J.isoToJ(J.addDays(today, off)); const old = J.isoToJ(st.birth_date); const age = old ? Math.max(11, Math.min(17, J.isoToJ(today).jy - old.jy)) : 13;
      const y = j.jy - age; await k('students').where({ id: st.id }).update({ birth_date: J.jToIso(y, j.jm, Math.min(j.jd, J.monthRange(y, j.jm).length)) });
    }
  }
}
module.exports = { seedV2 };

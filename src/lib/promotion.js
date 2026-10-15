'use strict';
/** منطق «پایان سال تحصیلی»: پیشنهاد ارتقا، ثبت سوابق سالانه، ساخت سال جدید و جابه‌جایی دانش‌آموزان */
const { L } = require('../labels');
const { classResults } = require('./gradesCalc');
const settings = require('../settings');
const J = require('../utils/jalali');

const GRADES = L.gradeLevels;
const nextGrade = (g) => { const i = GRADES.indexOf(g); return i >= 0 && i < GRADES.length - 1 ? GRADES[i + 1] : null; };
const ACTIONS = ['promote', 'retain', 'graduate'];

/** پیشنهاد نام و بازه‌ی سال بعد از روی سال جاری: «۱۴۰۴-۱۴۰۵» → «۱۴۰۵-۱۴۰۶» */
function suggestNextYear(cur) {
  const m = cur && /^(\d{4})\s*[-–/]\s*(\d{4})$/.exec(cur.title || '');
  const y1 = m ? Number(m[1]) + 1 : J.currentJalaliYear(); const y2 = m ? Number(m[2]) + 1 : y1 + 1;
  return { title: `${y1}-${y2}`, start_date: J.jToIso(y1, 6, 31), end_date: J.jToIso(y2, 3, 31) };
}

/** مقصد پیش‌فرض ارتقا برای کلاسی از پایه‌ی g و گروه section: کلاسِ پایه‌ی بعد با همان گروه، وگرنه کم‌جمعیت‌ترین کلاس همان پایه */
function findTarget(classes, counts, src) {
  const ng = nextGrade(src.grade_level); if (!ng) return null;
  const cands = classes.filter((c) => c.grade_level === ng);
  if (!cands.length) return null;
  return cands.find((c) => (c.section || '') === (src.section || '')) || cands.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0))[0];
}

/** طرح پیشنهادی برای تمام کلاس‌های فعال */
async function buildPlan(k) {
  const pass = settings.num('pass_mark') || 10;
  const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('grade_level').orderBy('name');
  const counts = {}; (await k('students').where('status', 'active').groupBy('classroom_id').select('classroom_id').count({ n: '*' })).forEach((r) => { counts[r.classroom_id] = Number(r.n); });
  const plan = [];
  for (const c of classes) {
    const res = await classResults(k, c.id);
    const target = findTarget(classes, counts, c);
    const abs = Object.fromEntries((await k('attendance').where({ classroom_id: c.id, status: 'absent' }).groupBy('student_id').select('student_id').count({ n: '*' })).map((r) => [r.student_id, Number(r.n)]));
    plan.push({
      cls: c, target, nextGrade: nextGrade(c.grade_level), rows: res.students.map((s) => ({
        id: s.id, name: `${s.first_name} ${s.last_name}`, code: s.student_code, overall: s.overall, rank: s.rank, absent: abs[s.id] || 0,
        suggested: s.overall !== null && s.overall < pass ? 'retain' : (target ? 'promote' : 'graduate'),
      })),
    });
  }
  return { pass, plan };
}

/** اجرای ارتقا. actions: { [studentId]: 'promote'|'retain'|'graduate' } — همه در یک تراکنش */
async function apply(k, { year, actions, userId }) {
  return k.transaction(async (t) => {
    const cur = await t('academic_years').where({ is_current: 1 }).first();
    if (cur && Number((await t('student_year_records').where({ academic_year_id: cur.id }).count({ c: '*' }).first()).c) > 0) throw new Error('سوابق این سال تحصیلی قبلاً بایگانی شده است؛ پایان سال برای آن دوباره قابل اجرا نیست.');
    if (!year || !year.title) throw new Error('عنوان سال تحصیلی جدید لازم است.');
    if (await t('academic_years').where({ title: year.title }).first()) throw new Error('سالی با این عنوان وجود دارد.');
    const classes = await t('classrooms').where('status', '<>', 'archived').orderBy('id');
    const counts = {}; const cmap = Object.fromEntries(classes.map((c) => [c.id, c]));
    const yearRange = cur && cur.start_date && cur.end_date ? [cur.start_date, cur.end_date] : null;
    const pass = settings.num('pass_mark') || 10;
    // ۱) نتایج و سوابق پیش از هر تغییری محاسبه می‌شوند
    const results = {}; for (const c of classes) results[c.id] = await classResults(t, c.id);
    const students = await t('students').where('status', 'active').whereIn('classroom_id', classes.map((c) => c.id).concat([0]));
    for (const s of students) counts[s.classroom_id] = (counts[s.classroom_id] || 0) + 1;
    // عکس لحظه‌ی پیش از ارتقا برای «بازگردانی»
    const uRows = students.filter((s) => s.user_id).length ? await t('users').whereIn('id', students.filter((s) => s.user_id).map((s) => s.user_id)).select('id', 'active') : [];
    const undo = { prevYearId: cur ? cur.id : null, students: students.map((s) => ({ id: s.id, classroom_id: s.classroom_id, status: s.status, user_id: s.user_id || null })), users: uRows.map((u) => ({ id: u.id, active: u.active ? 1 : 0 })),
      oldClasses: classes.map((c) => ({ id: c.id, name: c.name, status: c.status, homeroom_teacher_id: c.homeroom_teacher_id || null })), created: { classrooms: [], class_subjects: [], year: null, records: [], changes: [] }, after: {} };
    // ۲) سال جدید
    await t('academic_years').update({ is_current: 0 });
    const [yid0] = await t('academic_years').insert({ title: year.title, start_date: year.start_date || null, end_date: year.end_date || null, is_current: 1, notes: 'ایجاد شده با پایان سال تحصیلی' });
    const newYearId = typeof yid0 === 'object' ? yid0.id : yid0;
    undo.created.year = newYearId;
    // ۳) کلون کلاس‌ها (جایگاه کلاس/پایه حفظ می‌شود: دروس، معلمان، راهنما و برنامه هفتگی)
    const newOf = {}; const csMap = {};
    for (const c of classes) {
      const [r] = await t('classrooms').insert({ name: c.name, grade_level: c.grade_level, section: c.section, capacity: c.capacity, room_no: c.room_no, academic_year_id: newYearId, homeroom_teacher_id: c.homeroom_teacher_id, notes: c.notes, status: 'active' });
      newOf[c.id] = typeof r === 'object' ? r.id : r;
      undo.created.classrooms.push(newOf[c.id]);
      for (const cs of await t('class_subjects').where({ classroom_id: c.id })) {
        const [x] = await t('class_subjects').insert({ classroom_id: newOf[c.id], subject_id: cs.subject_id, teacher_id: cs.teacher_id, weekly_hours: cs.weekly_hours });
        csMap[cs.id] = typeof x === 'object' ? x.id : x;
        undo.created.class_subjects.push(csMap[cs.id]);
      }
      const tt = await t('timetable').where({ classroom_id: c.id });
      if (tt.length) await t('timetable').insert(tt.filter((x) => csMap[x.class_subject_id]).map((x) => ({ classroom_id: newOf[c.id], day: x.day, period: x.period, class_subject_id: csMap[x.class_subject_id] })));
    }
    // ۴) سوابق و جابه‌جایی
    const summary = { promoted: 0, retained: 0, graduated: 0, newClasses: 0, year: year.title };
    const created = {};
    for (const s of students) {
      const src = cmap[s.classroom_id]; const rs = results[s.classroom_id].students.find((x) => x.id === s.id) || {};
      let act = ACTIONS.includes(actions[s.id]) ? actions[s.id] : (rs.overall !== null && rs.overall !== undefined && rs.overall < pass ? 'retain' : 'promote');
      let dest = null;
      if (act === 'promote') {
        const tg = findTarget(classes, counts, src);
        if (tg) dest = newOf[tg.id];
        else {
          const ng = nextGrade(src.grade_level);
          if (!ng) act = 'graduate';
          else { // پایه‌ی بعد کلاسی ندارد؛ کلاس تازه با همان گروه ساخته می‌شود
            const key = ng + '|' + (src.section || '');
            if (!created[key]) {
              const nm = src.name.startsWith(src.grade_level) ? ng + src.name.slice(src.grade_level.length) : `${ng} ${src.section || ''}`.trim();
              const [r] = await t('classrooms').insert({ name: nm, grade_level: ng, section: src.section, capacity: src.capacity, academic_year_id: newYearId, status: 'active' });
              created[key] = typeof r === 'object' ? r.id : r; summary.newClasses++;
              undo.created.classrooms.push(created[key]);
            }
            dest = created[key];
          }
        }
      }
      if (act === 'retain') dest = newOf[s.classroom_id];
      const absent = Number((await t('attendance').where({ student_id: s.id, status: 'absent' }).modify((q) => { if (yearRange) q.whereBetween('date', yearRange); }).count({ c: '*' }).first()).c);
      const late = Number((await t('attendance').where({ student_id: s.id, status: 'late' }).modify((q) => { if (yearRange) q.whereBetween('date', yearRange); }).count({ c: '*' }).first()).c);
      const [syr] = await t('student_year_records').insert({ student_id: s.id, academic_year_id: cur ? cur.id : null, year_title: cur ? cur.title : 'سال قبل', classroom_name: src.name, grade_level: src.grade_level, overall: rs.overall === undefined ? null : rs.overall, rank_no: rs.rank || null, ranked_count: results[s.classroom_id].rankedCount, result: act === 'graduate' ? 'graduated' : act === 'retain' ? 'retained' : 'promoted', absent_days: absent, late_count: late });
      undo.created.records.push(typeof syr === 'object' ? syr.id : syr);
      if (act === 'graduate') { await t('students').where({ id: s.id }).update({ classroom_id: null, status: 'graduated' }); if (s.user_id) await t('users').where({ id: s.user_id }).update({ active: 0 }); summary.graduated++; }
      else { await t('students').where({ id: s.id }).update({ classroom_id: dest }); act === 'promote' ? summary.promoted++ : summary.retained++; }
      const [chg] = await t('student_changes').insert({ student_id: s.id, field: 'classroom', old_value: src.name, new_value: (act === 'graduate' ? 'فارغ‌التحصیل' : act === 'retain' ? 'تکرار پایه' : 'ارتقا') + ` (${year.title})`, user_id: userId || null, user_name: 'پایان سال تحصیلی' });
      undo.created.changes.push(typeof chg === 'object' ? chg.id : chg); undo.after[s.id] = act === 'graduate' ? { classroom_id: null, status: 'graduated' } : { classroom_id: dest, status: s.status };
    }
    // ۵) بایگانی کلاس‌های قدیم (نام با سال تحصیلی متمایز می‌شود تا با کلاس جدید تداخل نکند)
    for (const c of classes) await t('classrooms').where({ id: c.id }).update({ status: 'archived', homeroom_teacher_id: null, name: `${c.name} (${cur ? cur.title : 'قبل'})`.slice(0, 100) });
    summary.undo = undo;
    return summary;
  });
}

/** بازگردانی آخرین ارتقا: فقط اگر بعد از آن در کلاس‌های جدید داده‌ی تازه‌ای ثبت نشده و دانش‌آموزان جابه‌جا نشده باشند */
async function undo(k, run) {
  const u = typeof run.payload === 'string' ? JSON.parse(run.payload) : run.payload;
  if (!u || !u.created) throw new Error('اطلاعات بازگردانی این ارتقا موجود نیست.');
  if (run.undone_at) throw new Error('این ارتقا قبلاً بازگردانده شده است.');
  const later = await k('promotion_runs').where('id', '>', run.id).whereNull('undone_at').first();
  if (later) throw new Error('پس از این ارتقا، ارتقای دیگری انجام شده؛ ابتدا همان را بازگردانید.');
  const newCls = u.created.classrooms; const newCs = u.created.class_subjects;
  const blockers = [];
  const att = Number((await k('attendance').whereIn('classroom_id', newCls.concat([0])).count({ c: '*' }).first()).c); if (att) blockers.push(`${att} رکورد حضور و غیاب در کلاس‌های جدید ثبت شده`);
  const asm = Number((await k('assessments').whereIn('class_subject_id', newCs.concat([0])).count({ c: '*' }).first()).c); if (asm) blockers.push(`${asm} ارزشیابی در کلاس‌های جدید تعریف شده`);
  const known = new Set(u.students.map((s) => s.id));
  const now = await k('students').whereIn('id', [...known].concat([0])).select('id', 'classroom_id', 'status');
  const moved = now.filter((s) => { const a = u.after[s.id]; return a && (a.classroom_id !== s.classroom_id || a.status !== s.status); }).length; if (moved) blockers.push(`${moved} دانش‌آموز پس از ارتقا جابه‌جا یا تغییر وضعیت داده‌اند`);
  const extra = Number((await k('students').whereIn('classroom_id', newCls.concat([0])).whereNotIn('id', [...known].concat([0])).count({ c: '*' }).first()).c); if (extra) blockers.push(`${extra} دانش‌آموز تازه در کلاس‌های جدید ثبت شده`);
  if (blockers.length) throw new Error('بازگردانی ممکن نیست: ' + blockers.join('؛ ') + '. در صورت نیاز از پشتیبان «پیش از ارتقا» بازیابی کنید.');
  await k.transaction(async (t) => {
    for (const s of u.students) await t('students').where({ id: s.id }).update({ classroom_id: s.classroom_id, status: s.status });
    for (const x of u.users) await t('users').where({ id: x.id }).update({ active: x.active });
    if (u.created.changes.length) await t('student_changes').whereIn('id', u.created.changes).del();
    if (u.created.records.length) await t('student_year_records').whereIn('id', u.created.records).del();
    if (newCls.length) { await t('timetable').whereIn('classroom_id', newCls).del(); await t('timetable_meta').whereIn('classroom_id', newCls).del(); await t('timetable_history').whereIn('classroom_id', newCls).del(); }
    if (newCs.length) await t('class_subjects').whereIn('id', newCs).del();
    if (newCls.length) await t('classrooms').whereIn('id', newCls).del();
    for (const c of u.oldClasses) await t('classrooms').where({ id: c.id }).update({ name: c.name, status: c.status, homeroom_teacher_id: c.homeroom_teacher_id });
    if (u.created.year) await t('academic_years').where({ id: u.created.year }).del();
    await t('academic_years').update({ is_current: 0 }); if (u.prevYearId) await t('academic_years').where({ id: u.prevYearId }).update({ is_current: 1 });
    await t('promotion_runs').where({ id: run.id }).update({ undone_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  });
  return { students: u.students.length, classes: newCls.length };
}
module.exports = { undo, buildPlan, apply, nextGrade, suggestNextYear, findTarget, ACTIONS };

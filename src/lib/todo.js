'use strict';
/** «کارهای امروز»: فهرست کارهای نیازمند اقدام برای هر نقش؛ هر مورد به صفحه‌ی مربوط پیوند دارد. فقط موردهای دارای تعداد > 0 */
const db = require('../db');
const modules = require('../modules');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');
const calendar = require('./calendar');
const sla = require('./sla');
const backupTools = require('./backupTools');

const M = modules.isEnabled;
const n = async (q) => Number((await q.count({ c: '*' }).first()).c) || 0;

async function forManager(u, today, school) {
  const k = db.get(); const out = [];
  const add = (key, icon, label, count, url, level = 'warn') => { if (count > 0) out.push({ key, icon, label, count, url, level }); };
  if (M('attendance') && school) {
    const total = await n(k('classrooms').where('status', '<>', 'archived').whereExists(k('students').whereRaw('students.classroom_id = classrooms.id').where('status', 'active')));
    const rec = Number((await k('attendance').where({ date: today }).countDistinct({ c: 'classroom_id' }).first()).c) || 0;
    add('att', 'calendar-check', 'کلاس بدون حضور و غیاب امروز', Math.max(0, total - rec), '/attendance', 'danger');
  }
  if (M('tickets')) {
    const base = settings.num('ticket_sla_hours');
    if (base > 0) { const rows = await k('tickets').whereIn('status', ['open', 'pending']).limit(500); add('sla', 'clock', 'تیکت فراتر از مهلت پاسخ', rows.filter((t) => sla.status(t, base).state === 'overdue').length, '/tickets?view=overdue', 'danger'); }
    add('abs', 'file-text', 'درخواست توجیه غیبت در انتظار تصمیم', await n(k('tickets').where({ category: 'absence' }).whereIn('status', ['open', 'pending'])), '/tickets?category=absence');
    add('tk', 'life-buoy', 'تیکت منتظر پاسخ', await n(k('tickets').whereIn('status', ['open', 'pending'])), '/tickets', 'info');
  }
  if (M('hr')) {
    add('leave', 'user-cog', 'درخواست مرخصی معلم در انتظار تأیید', await n(k('teacher_leaves').where({ status: 'pending' })), '/hr/leaves');
    add('onleave', 'user-round', 'معلم در مرخصی امروز (نیازمند جانشین)', await n(k('teacher_leaves').where({ status: 'approved' }).where('start_date', '<=', today).where('end_date', '>=', today)), '/timetable/substitutes', 'info');
  }
  if (M('finance')) {
    const r = await k.raw('select count(*) as c from fees f left join (select fee_id, sum(amount) as p from payments where voided = 0 group by fee_id) pp on pp.fee_id = f.id where f.due_date < ? and f.amount - coalesce(f.discount, 0) > coalesce(pp.p, 0)', [today]);
    const rows = r.rows || r; add('debt', 'wallet', 'صورت‌حساب سررسیدگذشته‌ی پرداخت‌نشده', Number((Array.isArray(rows) ? rows[0] : rows[0][0] || rows[0]).c) || 0, '/finance/debtors');
  }
  if (M('library')) add('loan', 'library-big', 'کتاب با دیرکرد در امانت', await n(k('book_loans').whereNull('returned_at').where('due_date', '<', today)), '/library/loans');
  if (M('grades')) add('unpub', 'award', 'ارزیابی منتشرنشده', await n(k('assessments').where({ published: 0 })), '/grades', 'info');
  if (M('exams')) add('exam', 'clipboard-list', 'امتحان در ۳ روز آینده', await n(k('exam_schedule').where('exam_date', '>=', today).where('exam_date', '<=', J.addDays(today, 3))), '/exams', 'info');
  if (M('parents')) add('noparent', 'users-round', 'دانش‌آموز بدون حساب اولیا', await n(k('students').where('status', 'active').whereNotIn('id', k('parent_students').select('student_id'))), '/parents', 'info');
  if (M('backup') && u.isSuper) {
    const list = backupTools.list(); const last = list.reduce((m, f) => Math.max(m, f.mtime || 0), 0); const old = !last || (Date.now() - last) > 7 * 86400000;
    add('backup', 'database-backup', 'پشتیبان‌گیری از سامانه (بیش از ۷ روز گذشته یا وجود ندارد)', old ? 1 : 0, '/backup', 'danger');
  }
  if (u.isSuper) { // یادآوری سررسید پشتیبانی (فقط سوپر ادمین)
    const st = settings.all(); const plan = st.sa_plan; const due = st.sa_next_due;
    if ((plan === 'monthly' || plan === 'yearly') && due) {
      const days = Math.round((new Date(due + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
      if (days <= 14) add('support', 'wallet', days < 0 ? 'سررسید پشتیبانی گذشته است' : 'سررسید پشتیبانی نزدیک است', 1, '/super/billing', days < 0 ? 'danger' : 'warn');
    }
  }
  return out;
}

async function forTeacher(u, today, school) {
  const k = db.get(); const out = []; const t = u.teacher;
  const add = (key, icon, label, count, url, level = 'warn') => { if (count > 0) out.push({ key, icon, label, count, url, level }); };
  const classIds = await svc.accessibleClassIds(u);
  if (M('attendance') && school) {
    const home = await svc.homeroomClassIds(u);
    if (home && home.length) { const rec = (await k('attendance').where({ date: today }).whereIn('classroom_id', home).distinct('classroom_id')).map((x) => x.classroom_id); const pend = home.filter((id) => !rec.includes(id)); add('att', 'calendar-check', 'کلاس راهنما بدون حضور و غیاب امروز', pend.length, '/attendance?class_id=' + (pend[0] || ''), 'danger'); }
  }
  if (M('tickets')) add('tk', 'life-buoy', 'تیکت منتظر پاسخ شما', await n(k('tickets').where('recipient_user_id', u.id).whereIn('status', ['open', 'pending'])), '/tickets', 'warn');
  if (M('homework') && t) add('hw', 'notebook-pen', 'پاسخ تکلیف بدون نمره', await n(k('homework_submissions as x').join('homework as h', 'h.id', 'x.homework_id').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').where('cs.teacher_id', t.id).whereNull('x.score')), '/homework');
  if (M('exams') && classIds.length) add('exam', 'clipboard-list', 'امتحان کلاس‌های شما در ۳ روز آینده', await n(k('exam_schedule').whereIn('classroom_id', classIds).where('exam_date', '>=', today).where('exam_date', '<=', J.addDays(today, 3))), '/exams', 'info');
  if (M('timetable') && school && t) {
    const rows = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where({ 'cs.teacher_id': t.id, 'tt.day': J.dow(today) });
    add('classes', 'clock', 'کلاس در برنامه‌ی امروز شما', rows.length, '/timetable', 'info');
  }
  if (M('grades') && t) add('unpub', 'award', 'ارزیابی منتشرنشده‌ی شما', await n(k('assessments as a').join('class_subjects as cs', 'cs.id', 'a.class_subject_id').where({ 'cs.teacher_id': t.id, 'a.published': 0 })), '/grades', 'info');
  return out;
}

async function forStudent(u, today) {
  const k = db.get(); const out = []; const s = u.student; if (!s) return out;
  const add = (key, icon, label, count, url, level = 'warn') => { if (count > 0) out.push({ key, icon, label, count, url, level }); };
  if (M('homework') && s.classroom_id) {
    add('hw', 'notebook-pen', 'تکلیف با مهلت ۳ روز آینده و بدون ارسال', await n(k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').where('cs.classroom_id', s.classroom_id).where('h.due_date', '>=', today).where('h.due_date', '<=', J.addDays(today, 3)).whereNotExists(k('homework_submissions as x').whereRaw('x.homework_id = h.id').where('x.student_id', s.id))), '/homework', 'danger');
  }
  if (M('exams') && s.classroom_id) add('exam', 'clipboard-list', 'امتحان در ۷ روز آینده', await n(k('exam_schedule').where('classroom_id', s.classroom_id).where('exam_date', '>=', today).where('exam_date', '<=', J.addDays(today, 7))), '/exams', 'warn');
  if (M('finance')) {
    const r = await k.raw('select count(*) as c from fees f left join (select fee_id, sum(amount) as p from payments where voided = 0 group by fee_id) pp on pp.fee_id = f.id where f.student_id = ? and f.due_date < ? and f.amount - coalesce(f.discount, 0) > coalesce(pp.p, 0)', [s.id, today]);
    const rows = r.rows || r; add('debt', 'wallet', 'صورت‌حساب سررسیدگذشته', Number((Array.isArray(rows) ? rows[0] : rows[0][0] || rows[0]).c) || 0, '/finance');
  }
  if (M('library')) add('loan', 'library-big', 'کتاب با دیرکرد بازگشت', await n(k('book_loans').where({ student_id: s.id }).whereNull('returned_at').where('due_date', '<', today)), '/library/loans');
  if (M('tickets')) add('tk', 'life-buoy', 'تیکت دارای پاسخ جدید', await n(k('tickets').where({ created_by: u.id, status: 'answered' })), '/tickets', 'info');
  if (M('attendance')) add('abs', 'calendar-check', 'غیبت در ۱۴ روز اخیر', await n(k('attendance').where({ student_id: s.id, status: 'absent' }).where('date', '>=', J.addDays(today, -14))), '/attendance/my', 'warn');
  return out;
}

async function forUser(u) {
  const today = J.todayISO(); const school = !(await calendar.offDay(today)).off;
  const items = u.role === 'admin' || u.role === 'deputy' ? await forManager(u, today, school) : u.role === 'teacher' ? await forTeacher(u, today, school) : await forStudent(u, today);
  const rank = { danger: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level]);
  return { items, school };
}
module.exports = { forUser };

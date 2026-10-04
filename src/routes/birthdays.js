'use strict';
/** تولدها: فهرست امروز / این هفته / هفته‌ی بعد / ماه / ۳۰ روز آینده / کل سال، خروجی CSV، اجرای دستی و تبریک دستی */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const settings = require('../settings');
const sms = require('../lib/sms');
const B = require('../lib/birthdays');
const J = require('../utils/jalali');
const { toCSV } = require('../utils/csv');
const { requireRole } = require('../middleware');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');
router.use('/birthdays', modules.guard('birthdays'));

const RANGES = [['today', 'امروز'], ['week', 'این هفته'], ['next', 'هفته‌ی بعد'], ['month', 'این ماه'], ['30', '۳۰ روز آینده'], ['year', 'کل سال']];
function rangeOf(key, today) {
  const ws = B.weekStart(today); const t = J.isoToJ(today);
  switch (key) {
    case 'today': return [today, today];
    case 'next': return [J.addDays(ws, 7), J.addDays(ws, 13)];
    case 'month': { const m = J.monthRange(t.jy, t.jm); return [m.start, m.end]; }
    case '30': return [today, J.addDays(today, 29)];
    case 'year': return [today, J.addDays(today, 364)];
    default: return [ws, J.addDays(ws, 6)];
  }
}
async function load(req) {
  const today = J.todayISO(); const key = RANGES.some((r) => r[0] === req.query.range) ? req.query.range : 'week';
  const [from, to] = rangeOf(key, today); let classIds = await svc.accessibleClassIds(req.user);
  const cid = Number(req.query.class) || 0;
  if (cid) classIds = classIds ? classIds.filter((x) => x === cid) : [cid];
  const list = await B.between(from, to, { classIds, today });
  return { today, key, from, to, list, cid };
}

router.get('/birthdays', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const d = await load(req); const classIds = await svc.accessibleClassIds(req.user);
    const classes = await k('classrooms').where('status', '<>', 'archived').modify((q) => { if (classIds) q.whereIn('id', classIds.length ? classIds : [0]); }).orderBy('name').select('id', 'name');
    const total = Number((await k('students').where({ status: 'active' }).whereNotNull('birth_date').count({ c: '*' }).first()).c);
    const missing = Number((await k('students').where({ status: 'active' }).where((b) => b.whereNull('birth_date').orWhere('birth_date', '')).count({ c: '*' }).first()).c);
    let recent = [];
    if (req.user.role !== 'teacher') recent = await k('birthday_log as l').join('students as s', 's.id', 'l.student_id').orderBy('l.id', 'desc').limit(15).select('l.*', 's.first_name', 's.last_name');
    const byMonth = d.key === 'year' ? d.list.reduce((m, b) => { const mo = J.isoToJ(b.date).jm; (m[mo] = m[mo] || []).push(b); return m; }, {}) : null;
    res.view('birthdays/index', { title: 'تولدها', ...d, curM: J.isoToJ(d.today).jm, RANGES, classes, total, missing, recent, byMonth, MONTHS: J.MONTHS, kinds: require('../lib/birthdayKinds').KINDS, smsOn: sms.config().enabled, botOn: settings.bool('bd_enabled'), before: settings.num('bd_before_days'), at: settings.get('bd_send_time') });
  } catch (e) { next(e); }
});
router.get('/birthdays/export.csv', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const d = await load(req);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="birthdays-${d.today}.csv"`)
      .send(toCSV(['نام', 'کلاس', 'تاریخ تولد (اصلی)', 'تاریخ جشن امسال', 'روز هفته', 'سنِ جدید', 'روزهای مانده'], d.list.map((b) => [b.name, b.class_name, J.isoToJString(b.birth_date), J.isoToJString(b.date), b.weekday, b.age, b.days])));
  } catch (e) { next(e); }
});
/** اجرای فوری کار روزانه (بدون توجه به ساعت ارسال؛ ارسال تکراری همچنان مسدود است) */
router.post('/birthdays/run', mgr, async (req, res, next) => {
  try {
    const r = await B.run({ force: true });
    if (r.skipped) req.flash('warn', r.skipped === 'disabled' ? 'ارسال خودکار تولد در تنظیمات خاموش است.' : 'اکنون زمان ارسال نیست.');
    else { const n = Object.values(r.sent).reduce((a, b) => a + b, 0); req.flash('success', n ? `${n} اعلان تولد ارسال شد${r.sms ? ' و ' + r.sms + ' پیامک در صف قرار گرفت' : ''}.` : 'مورد جدیدی برای ارسال نبود (پیام‌های امروز قبلاً ارسال شده‌اند).'); }
    await svc.audit(req, 'run', 'birthdays', null, JSON.stringify(r));
    res.redirect('/birthdays');
  } catch (e) { next(e); }
});
/** تبریک دستی: اعلان و پیامک «روز تولد» به دانش‌آموز و اولیا (حتی اگر قبلاً ارسال شده باشد) */
router.post('/birthdays/:id/greet', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const id = Number(req.params.id);
    const it = (await B.between(J.todayISO(), J.addDays(J.todayISO(), 364), { today: J.todayISO(), k })).find((x) => x.id === id);
    if (!it) { req.flash('error', 'دانش‌آموز یافت نشد یا تاریخ تولد ندارد.'); return res.redirect('/birthdays'); }
    const sent = await B.greetNow(it); await svc.audit(req, 'greet', 'birthdays', id, it.name);
    req.flash('success', `تبریک برای ${it.name} ارسال شد (${sent.inapp} اعلان${sent.sms ? '، ' + sent.sms + ' پیامک' : ''}).`);
    res.redirect(req.get('referer') && /\/birthdays/.test(req.get('referer')) ? '/birthdays' + (req.get('referer').split('/birthdays')[1] || '') : '/birthdays');
  } catch (e) { next(e); }
});
module.exports = router;

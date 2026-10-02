'use strict';
/** تعطیلات و تقویم آموزشی: ثبت دستی تعطیلی (یک‌روزه یا بازه‌ای) و افزودن تعطیلات رسمیِ تاریخ‌ثابت */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const cal = require('../lib/calendar');
const { requireRole } = require('../middleware');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');
router.use('/holidays', modules.guard('calendar'), mgr);

/** پیامد ثبت تعطیلی: امتحان‌هایی که در بازه برنامه‌ریزی شده‌اند */
async function impact(k, s, e) {
  let exams = 0;
  try { exams = Number((await k('exam_schedule').whereBetween('exam_date', [s, e]).count({ n: '*' }).first()).n); } catch (_) { /* ماژول امتحانات */ }
  return { exams };
}
function parseRange(b) {
  const s = J.parseJalali(String(b.start_date || '')); const e = b.end_date ? J.parseJalali(String(b.end_date)) : s;
  const title = String(b.title || '').trim().slice(0, 150);
  if (!s || !e) return { error: 'تاریخ شروع (و پایان) را به‌صورت شمسی معتبر وارد کنید.' };
  if (e < s) return { error: 'تاریخ پایان نباید قبل از شروع باشد.' };
  if (!title) return { error: 'عنوان تعطیلی الزامی است.' };
  let n = 1; for (let d = s; d < e; d = J.addDays(d, 1)) n++;
  if (n > 120) return { error: 'حداکثر طول یک تعطیلی ۱۲۰ روز است.' };
  return { s, e, title, days: n };
}

router.get('/holidays', async (req, res, next) => {
  try {
    const k = db.get(); const t = J.isoToJ(J.todayISO()); const jy = Number(req.query.year) || t.jy;
    const start = J.jToIso(jy, 1, 1); const end = J.jToIso(jy, 12, J.monthRange(jy, 12).length);
    const list = await k('holidays').where('start_date', '<=', end).where('end_date', '>=', start).orderBy('start_date');
    const events = await k('events').where({ type: 'holiday' }).where('start_date', '<=', end).where((b) => b.where('end_date', '>=', start).orWhereNull('end_date')).orderBy('start_date');
    res.view('holidays/index', { title: 'تعطیلات و تقویم آموزشی', jy, list, events, fixed: cal.FIXED_SOLAR, MONTHS: J.MONTHS });
  } catch (e) { next(e); }
});
router.post('/holidays', async (req, res, next) => {
  try {
    const k = db.get(); const r = parseRange(req.body);
    if (r.error) { req.flash('error', r.error); return res.redirect('/holidays'); }
    const dup = await k('holidays').where({ start_date: r.s, end_date: r.e, title: r.title }).first();
    if (dup) { req.flash('error', 'این تعطیلی قبلاً ثبت شده است.'); return res.redirect('/holidays'); }
    const [id] = await k('holidays').insert({ start_date: r.s, end_date: r.e, title: r.title, kind: 'manual', created_by: req.user.id, created_at: svc.nowStr() });
    const im = await impact(k, r.s, r.e); await svc.audit(req, 'create', 'holidays', id, `${r.title}: ${r.s} تا ${r.e}`);
    req.flash('success', `تعطیلی «${r.title}» برای ${r.days} روز ثبت شد.${im.exams ? ` توجه: ${im.exams} امتحان در این بازه برنامه‌ریزی شده که باید جابه‌جا شود.` : ''}`);
    res.redirect(`/holidays?year=${J.isoToJ(r.s).jy}`);
  } catch (e) { next(e); }
});
router.post('/holidays/fixed', async (req, res, next) => {
  try {
    const k = db.get(); const jy = Number(req.body.year); if (!(jy >= 1380 && jy <= 1500)) { req.flash('error', 'سال نامعتبر است.'); return res.redirect('/holidays'); }
    let added = 0;
    for (const h of cal.fixedSolarFor(jy)) {
      if (await k('holidays').where({ start_date: h.start_date, title: h.title }).first()) continue;
      await k('holidays').insert({ ...h, kind: 'official', created_by: req.user.id, created_at: svc.nowStr() }); added++;
    }
    await svc.audit(req, 'create', 'holidays', null, `تعطیلات رسمی ثابت ${jy}: ${added} مورد`);
    req.flash('success', added ? `${added} تعطیلی رسمی ثابت برای سال ${jy} افزوده شد. تعطیلی‌های قمری (تاسوعا، عاشورا، ...) را خودتان دستی ثبت کنید.` : 'همه‌ی تعطیلات ثابت این سال از قبل ثبت شده بود.');
    res.redirect(`/holidays?year=${jy}`);
  } catch (e) { next(e); }
});
router.post('/holidays/:id(\\d+)/update', async (req, res, next) => {
  try {
    const k = db.get(); const h = await k('holidays').where({ id: req.params.id }).first(); if (!h) return res.redirect('/holidays');
    const r = parseRange(req.body); if (r.error) { req.flash('error', r.error); return res.redirect('/holidays'); }
    await k('holidays').where({ id: h.id }).update({ start_date: r.s, end_date: r.e, title: r.title });
    await svc.audit(req, 'update', 'holidays', h.id, `${r.title}: ${r.s} تا ${r.e}`); req.flash('success', 'تعطیلی ویرایش شد.'); res.redirect(`/holidays?year=${J.isoToJ(r.s).jy}`);
  } catch (e) { next(e); }
});
router.post('/holidays/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const k = db.get(); const h = await k('holidays').where({ id: req.params.id }).first(); if (!h) return res.redirect('/holidays');
    await k('holidays').where({ id: h.id }).del(); await svc.audit(req, 'delete', 'holidays', h.id, h.title); req.flash('success', 'تعطیلی حذف شد.'); res.redirect(`/holidays?year=${J.isoToJ(h.start_date).jy}`);
  } catch (e) { next(e); }
});
module.exports = router;

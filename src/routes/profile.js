'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const svc = require('../services');
const modules = require('../modules');
const { uploader, invalidateBadges } = require('../middleware');
const router = express.Router();

router.get('/profile', (req, res) => res.view('profile/index', { title: 'پروفایل من', errors: [] }));
router.post('/profile', uploader('photos', 'avatar', { images: true, maxMB: 2 }), async (req, res, next) => {
  try {
    const u = req.user; const b = req.body; const errors = [];
    if (req.uploadError) errors.push(req.uploadError);
    if (u.role !== 'student' && (!b.full_name || b.full_name.length < 3)) errors.push('نام و نام خانوادگی را وارد کنید.');
    if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) errors.push('ایمیل معتبر نیست.');
    if (!svc.validPhone(b.phone)) errors.push('شماره تلفن معتبر نیست.');
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return res.view('profile/index', { title: 'پروفایل من', errors }); }
    const upd = { email: b.email || null, phone: b.phone || null };
    if (u.role !== 'student') upd.full_name = b.full_name;
    if (req.file) { if (u.avatar) fs.unlink(path.join(config.UPLOAD_DIR, 'photos', u.avatar), () => {}); upd.avatar = req.file.filename; }
    await db.get()('users').where({ id: u.id }).update(upd);
    await svc.audit(req, 'update', 'profile', u.id, '');
    req.flash('success', 'پروفایل شما ذخیره شد.'); res.redirect('/profile');
  } catch (e) { next(e); }
});

router.get('/profile/password', (req, res) => res.view('profile/password', { title: 'تغییر رمز عبور', errors: [], force: !!req.query.force || req.user.must_change_password }));
router.post('/profile/password', async (req, res, next) => {
  try {
    const b = req.body; const errors = []; const min = settings.num('min_password_length') || 6;
    if (!svc.verify(b.current || '', req.user.password_hash)) errors.push('رمز عبور فعلی نادرست است.');
    if (!b.password || b.password.length < min) errors.push(`رمز جدید باید حداقل ${min} نویسه باشد.`);
    if (b.password !== b.password2) errors.push('تکرار رمز جدید مطابقت ندارد.');
    if (b.password && b.password === b.current) errors.push('رمز جدید باید با رمز فعلی متفاوت باشد.');
    if (errors.length) return res.view('profile/password', { title: 'تغییر رمز عبور', errors, force: req.user.must_change_password });
    await db.get()('users').where({ id: req.user.id }).update({ password_hash: svc.hash(b.password), must_change_password: 0 });
    await svc.killSessions(req.user.id, req.sessionID); // سایر دستگاه‌ها باید دوباره وارد شوند
    await svc.audit(req, 'password_change', 'user', req.user.id, '');
    req.flash('success', 'رمز عبور با موفقیت تغییر کرد.'); res.redirect('/');
  } catch (e) { next(e); }
});

/* ---- اعلان‌ها ---- */
router.get('/notifications', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 20;
    const q = db.get()('notifications').where({ user_id: req.user.id });
    const total = Number((await q.clone().count({ c: '*' }).first()).c);
    const rows = await q.orderBy('id', 'desc').limit(per).offset((page - 1) * per);
    res.view('notifications', { title: 'اعلان‌ها', rows, page, pages: Math.max(1, Math.ceil(total / per)), total });
  } catch (e) { next(e); }
});
router.post('/notifications/read-all', async (req, res, next) => {
  try { await db.get()('notifications').where({ user_id: req.user.id, is_read: 0 }).update({ is_read: 1 }); invalidateBadges(req.user.id); res.redirect('/notifications'); } catch (e) { next(e); }
});
router.post('/notifications/clear', async (req, res, next) => {
  try { await db.get()('notifications').where({ user_id: req.user.id, is_read: 1 }).del(); invalidateBadges(req.user.id); req.flash('success', 'اعلان‌های خوانده‌شده پاک شد.'); res.redirect('/notifications'); } catch (e) { next(e); }
});
router.get('/notifications/:id/go', async (req, res, next) => {
  try {
    const n = await db.get()('notifications').where({ id: req.params.id, user_id: req.user.id }).first();
    if (!n) return res.redirect('/notifications');
    await db.get()('notifications').where({ id: n.id }).update({ is_read: 1 }); invalidateBadges(req.user.id);
    res.redirect(n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/notifications');
  } catch (e) { next(e); }
});

/* ---- جستجوی سراسری ---- */
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim(); const k = db.get(); const u = req.user; const out = {};
    if (q.length >= 2) {
      const like = `%${q}%`; const classIds = await svc.accessibleClassIds(u);
      if (u.role !== 'student') {
        // جستجوی نام کامل به‌صورت ترکیبی (سازگار با MySQL و SQLite)
        const parts = q.split(/\s+/).filter(Boolean);
        const sq2 = k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where((b) => {
          if (parts.length > 1) parts.forEach((p) => b.where((x) => x.where('s.first_name', 'like', `%${p}%`).orWhere('s.last_name', 'like', `%${p}%`)));
          else b.where('s.first_name', 'like', like).orWhere('s.last_name', 'like', like).orWhere('s.student_code', 'like', like).orWhere('s.national_id', 'like', like).orWhere('s.father_phone', 'like', like).orWhere('s.mother_phone', 'like', like);
        });
        if (classIds) sq2.whereIn('s.classroom_id', classIds.length ? classIds : [0]);
        out.students = await sq2.limit(10).select('s.id', 's.first_name', 's.last_name', 's.student_code', 'c.name as class_name');
      }
      if (u.role === 'admin' || u.role === 'deputy') out.teachers = await k('teachers as t').join('users as x', 'x.id', 't.user_id').where((b) => b.where('x.full_name', 'like', like).orWhere('t.personnel_code', 'like', like).orWhere('t.specialty', 'like', like)).limit(10).select('t.id', 'x.full_name', 't.specialty');
      if (modules.isEnabled('tickets')) {
        const tq = k('tickets').where('subject', 'like', like);
        if (u.role !== 'admin' && u.role !== 'deputy') tq.where((b) => b.where('created_by', u.id).orWhere('recipient_user_id', u.id));
        out.tickets = await tq.orderBy('id', 'desc').limit(8);
      }
      if (modules.isEnabled('announcements')) { const aq = k('announcements as t').where((b) => b.where('t.title', 'like', like).orWhere('t.body', 'like', like)); svc.audienceFilter(aq, u, classIds); out.announcements = await aq.limit(5).select('t.*'); }
      if (modules.isEnabled('library')) out.books = await k('books').where((b) => b.where('title', 'like', like).orWhere('author', 'like', like)).limit(8);
    }
    res.view('search', { title: 'جستجو', q, gq: q, out });
  } catch (e) { next(e); }
});
module.exports = router;

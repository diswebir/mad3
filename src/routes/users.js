'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/users', requireRole('admin'));

router.get('/users', async (req, res, next) => {
  try {
    const k = db.get(); const q = (req.query.q || '').trim(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 25;
    const qb = k('users');
    if (q) qb.where((b) => b.where('full_name', 'like', `%${q}%`).orWhere('username', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`));
    if (req.query.role) qb.where({ role: req.query.role });
    if (req.query.active === '0' || req.query.active === '1') qb.where({ active: Number(req.query.active) });
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderBy('id', 'desc').limit(per).offset((page - 1) * per).select('id', 'username', 'full_name', 'role', 'active', 'last_login', 'phone', 'created_at');
    res.view('users/index', { title: 'کاربران', rows, q, page, pages: Math.max(1, Math.ceil(total / per)), total, role: req.query.role || '', active: req.query.active || '' });
  } catch (e) { next(e); }
});
router.get('/users/new', (req, res) => res.view('users/form', { title: 'کاربر جدید', row: null, errors: [], vals: { role: 'deputy' } }));
router.post('/users/new', async (req, res, next) => {
  try {
    const b = req.body; const errors = []; const k = db.get();
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(b.username || '')) errors.push('نام کاربری باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
    else if (await k('users').whereRaw('lower(username) = ?', [b.username.toLowerCase()]).first()) errors.push('این نام کاربری قبلاً ثبت شده است.');
    if (!b.full_name || b.full_name.length < 3) errors.push('نام کامل را وارد کنید.');
    if (!['admin', 'deputy'].includes(b.role)) errors.push('نقش نامعتبر است. معلم و دانش‌آموز از بخش‌های خودشان ثبت می‌شوند.');
    if ((b.password || '').length < 8) errors.push('رمز عبور باید حداقل ۸ نویسه باشد.');
    if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) errors.push('ایمیل معتبر نیست.');
    if (!svc.validPhone(b.phone)) errors.push('تلفن معتبر نیست.');
    if (errors.length) return res.view('users/form', { title: 'کاربر جدید', row: null, errors, vals: b });
    const r = await k('users').insert({ username: b.username.toLowerCase(), password_hash: svc.hash(b.password), role: b.role, full_name: b.full_name, email: b.email || null, phone: b.phone || null, active: 1, must_change_password: b.must_change ? 1 : 0 });
    await svc.audit(req, 'create', 'users', Array.isArray(r) ? r[0] : r, b.username);
    req.flash('success', 'کاربر ایجاد شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
router.get('/users/:id/edit', async (req, res, next) => {
  try { const row = await db.get()('users').where({ id: req.params.id }).first(); if (!row) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'کاربر یافت نشد.' }); res.view('users/form', { title: 'ویرایش کاربر', row, errors: [], vals: row }); } catch (e) { next(e); }
});
router.post('/users/:id/edit', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first(); const b = req.body; const errors = [];
    if (!row) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'کاربر یافت نشد.' });
    if (!b.full_name || b.full_name.length < 3) errors.push('نام کامل را وارد کنید.');
    if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) errors.push('ایمیل معتبر نیست.');
    if (!svc.validPhone(b.phone)) errors.push('تلفن معتبر نیست.');
    if (errors.length) return res.view('users/form', { title: 'ویرایش کاربر', row, errors, vals: { ...row, ...b } });
    const upd = { full_name: b.full_name, email: b.email || null, phone: b.phone || null };
    if (['admin', 'deputy'].includes(row.role) && ['admin', 'deputy'].includes(b.role) && row.id !== req.user.id) upd.role = b.role;
    await k('users').where({ id: row.id }).update(upd);
    await svc.audit(req, 'update', 'users', row.id, row.username);
    req.flash('success', 'کاربر ویرایش شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row || row.id === req.user.id) { req.flash('error', 'امکان غیرفعال‌سازی حساب خودتان وجود ندارد.'); return res.redirect('/users'); }
    await k('users').where({ id: row.id }).update({ active: row.active ? 0 : 1 });
    await svc.audit(req, row.active ? 'deactivate' : 'activate', 'users', row.id, row.username);
    req.flash('success', row.active ? 'حساب غیرفعال شد.' : 'حساب فعال شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row) return res.redirect('/users');
    const pw = svc.randomPassword(8);
    await k('users').where({ id: row.id }).update({ password_hash: svc.hash(pw), must_change_password: 1 });
    await svc.audit(req, 'reset_password', 'users', row.id, row.username);
    req.flash('success', `رمز جدید «${row.full_name}»: ${pw}  (کاربر در اولین ورود باید آن را تغییر دهد؛ این رمز فقط یک‌بار نمایش داده می‌شود.)`);
    res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row || row.id === req.user.id || !['admin', 'deputy'].includes(row.role)) { req.flash('error', 'فقط حساب‌های مدیر/معاون (غیر از حساب خودتان) از اینجا قابل حذف‌اند.'); return res.redirect('/users'); }
    await k('users').where({ id: row.id }).del();
    await svc.audit(req, 'delete', 'users', row.id, row.username);
    req.flash('success', 'کاربر حذف شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
module.exports = router;

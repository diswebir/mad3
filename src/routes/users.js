'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const { requireRole } = require('../middleware');
const permissions = require('../permissions');
const router = express.Router();
const permJson = (b) => JSON.stringify([].concat(b.perm || []).filter((x) => permissions.PERMS[x]));
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
    const r = await k('users').insert({ username: b.username.toLowerCase(), password_hash: svc.hash(b.password), role: b.role, full_name: b.full_name, email: b.email || null, phone: b.phone || null, active: 1, must_change_password: b.must_change ? 1 : 0, title: b.title ? String(b.title).slice(0, 80) : null, permissions: b.role === 'deputy' ? permJson(b) : null });
    await svc.audit(req, 'create', 'users', Array.isArray(r) ? r[0] : r, b.username);
    req.flash('success', 'کاربر ایجاد شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
/** ویرایش معلم/دانش‌آموز باید از پرونده خودشان انجام شود تا اطلاعات پرونده و حساب ناهمگون نشود */
async function profileRedirect(row) {
  const k = db.get();
  if (row.role === 'teacher') { const t = await k('teachers').where({ user_id: row.id }).first(); return t ? '/teachers/' + t.id + '/edit' : null; }
  if (row.role === 'student') { const s = await k('students').where({ user_id: row.id }).first(); return s ? '/students/' + s.id + '/edit' : null; }
  return null;
}
router.get('/users/:id(\\d+)/edit', async (req, res, next) => {
  try { const row = await db.get()('users').where({ id: req.params.id }).first(); if (!row) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'کاربر یافت نشد.' }); const pr = await profileRedirect(row); if (pr) return res.redirect(pr); res.view('users/form', { title: 'ویرایش کاربر', row, errors: [], vals: row }); } catch (e) { next(e); }
});
router.post('/users/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first(); const b = req.body; const errors = [];
    if (!row) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'کاربر یافت نشد.' });
    if (['teacher', 'student'].includes(row.role)) return res.redirect((await profileRedirect(row)) || '/users');
    if (!b.full_name || b.full_name.length < 3) errors.push('نام کامل را وارد کنید.');
    if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) errors.push('ایمیل معتبر نیست.');
    if (!svc.validPhone(b.phone)) errors.push('تلفن معتبر نیست.');
    if (errors.length) return res.view('users/form', { title: 'ویرایش کاربر', row, errors, vals: { ...row, ...b } });
    const upd = { full_name: b.full_name, email: b.email || null, phone: b.phone || null };
    if (['admin', 'deputy'].includes(row.role)) { upd.title = b.title ? String(b.title).slice(0, 80) : null; }
    if (['admin', 'deputy'].includes(row.role) && ['admin', 'deputy'].includes(b.role) && row.id !== req.user.id) upd.role = b.role;
    const finalRole = upd.role || row.role;
    if (finalRole === 'deputy' && ['admin', 'deputy'].includes(row.role)) upd.permissions = permJson(b); else if (finalRole === 'admin') upd.permissions = null;
    await k('users').where({ id: row.id }).update(upd);
    await svc.audit(req, 'update', 'users', row.id, row.username + (upd.permissions ? ' perms=' + upd.permissions : ''));
    req.flash('success', 'کاربر ویرایش شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id(\\d+)/toggle', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row || row.id === req.user.id) { req.flash('error', 'امکان غیرفعال‌سازی حساب خودتان وجود ندارد.'); return res.redirect('/users'); }
    const on = row.active ? 0 : 1;
    await k('users').where({ id: row.id }).update({ active: on });
    // همگام‌سازی وضعیت پرونده معلم/دانش‌آموز با حساب کاربری
    if (row.role === 'teacher') await k('teachers').where({ user_id: row.id }).update({ status: on ? 'active' : 'inactive' });
    if (row.role === 'student') await k('students').where({ user_id: row.id }).update({ status: on ? 'active' : 'inactive' });
    if (!on) await svc.killSessions(row.id);
    await svc.audit(req, row.active ? 'deactivate' : 'activate', 'users', row.id, row.username);
    req.flash('success', row.active ? 'حساب غیرفعال شد.' : 'حساب فعال شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id(\\d+)/reset-password', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row) return res.redirect('/users');
    const pw = svc.randomPassword(8);
    await k('users').where({ id: row.id }).update({ password_hash: svc.hash(pw), must_change_password: 1 });
    await svc.killSessions(row.id);
    await svc.audit(req, 'reset_password', 'users', row.id, row.username);
    req.flash('success', `رمز جدید «${row.full_name}»: ${pw}  (کاربر در اولین ورود باید آن را تغییر دهد؛ این رمز فقط یک‌بار نمایش داده می‌شود.)`);
    res.redirect('/users');
  } catch (e) { next(e); }
});
router.post('/users/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const k = db.get(); const row = await k('users').where({ id: req.params.id }).first();
    if (!row || row.id === req.user.id || !['admin', 'deputy'].includes(row.role)) { req.flash('error', 'فقط حساب‌های مدیر/معاون (غیر از حساب خودتان) از اینجا قابل حذف‌اند.'); return res.redirect('/users'); }
    const used = Number((await k('tickets').where((b) => b.where('created_by', row.id).orWhere('recipient_user_id', row.id)).count({ c: '*' }).first()).c) + Number((await k('ticket_messages').where({ user_id: row.id }).count({ c: '*' }).first()).c);
    if (used) { req.flash('error', 'این کاربر در تیکت‌ها سابقه دارد؛ برای حفظ سوابق، به‌جای حذف، حساب را غیرفعال کنید.'); return res.redirect('/users'); }
    await k('notifications').where({ user_id: row.id }).del();
    await k('users').where({ id: row.id }).del();
    await svc.killSessions(row.id);
    await svc.audit(req, 'delete', 'users', row.id, row.username);
    req.flash('success', 'کاربر حذف شد.'); res.redirect('/users');
  } catch (e) { next(e); }
});
module.exports = router;

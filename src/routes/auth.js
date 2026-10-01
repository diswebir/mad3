'use strict';
const express = require('express');
const db = require('../db');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');

const attempts = new Map(); // key -> {count, until}
function lockInfo(key) {
  const a = attempts.get(key);
  if (a && a.until && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 60000);
  if (a && a.until && a.until <= Date.now()) attempts.delete(key);
  return 0;
}
function fail(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= (settings.num('max_login_attempts') || 5)) { a.until = Date.now() + (settings.num('lockout_minutes') || 10) * 60000; a.count = 0; }
  attempts.set(key, a);
}
setInterval(() => { const n = Date.now(); for (const [k, v] of attempts) if (v.until && v.until < n) attempts.delete(k); }, 600000).unref();

module.exports = function (r) {
  // لوگوی مدرسه باید در صفحه ورود هم نمایش داده شود
  r.get('/files/branding/:name', (req, res) => {
    if (!/^[\w.-]+$/.test(req.params.name)) return res.status(404).end();
    res.sendFile(require('path').join(require('../config').UPLOAD_DIR, 'branding', req.params.name), { maxAge: '7d' }, (e) => { if (e && !res.headersSent) res.status(404).end(); });
  });
  r.get('/login', async (req, res, next) => {
    try {
      if (req.user) return res.redirect('/');
      let demo = null;
      if (settings.bool('show_demo_logins')) demo = [['معاون', 'deputy', 'deputy123'], ['معلم', 't.ahmadi', 'teacher123'], ['دانش‌آموز', '14050001', 'student123']];
      res.view('auth/login', { title: 'ورود', demo, error: null, username: '' }, 'bare');
    } catch (e) { next(e); }
  });
  r.post('/login', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const key = req.ip + '|' + username;
      const locked = lockInfo(key);
      const render = (error) => res.status(401).view('auth/login', { title: 'ورود', demo: null, error, username }, 'bare');
      if (locked) return render(`به دلیل تلاش‌های ناموفق متعدد، ورود تا ${locked} دقیقه دیگر مسدود است.`);
      const u = username ? await db.get()('users').whereRaw('lower(username) = ?', [username]).first() : null;
      if (!u || !svc.verify(password, u.password_hash)) { fail(key); await svc.audit({ ip: req.ip }, 'login_failed', 'user', null, username); return render('نام کاربری یا رمز عبور نادرست است.'); }
      if (!u.active) return render('حساب کاربری شما غیرفعال است. با مدیریت مدرسه تماس بگیرید.');
      attempts.delete(key);
      const returnTo = req.session.returnTo;
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.uid = u.id;
        db.get()('users').where({ id: u.id }).update({ last_login: new Date().toISOString().replace('T', ' ').slice(0, 19), last_ip: req.ip }).then(() => svc.audit({ user: u, ip: req.ip }, 'login', 'user', u.id, '')).catch(() => {});
        req.session.save(() => res.redirect(u.must_change_password ? '/profile/password?force=1' : (returnTo && !returnTo.startsWith('/login') ? returnTo : '/')));
      });
    } catch (e) { next(e); }
  });
  r.post('/logout', (req, res) => {
    const u = req.user;
    if (u) svc.audit({ user: u, ip: req.ip }, 'logout', 'user', u.id, '');
    req.session.destroy(() => { res.clearCookie('school.sid', { path: require('../config').load().basePath || '/' }); res.redirect('/login'); });
  });
  r.get('/logout', (req, res) => res.redirect('/'));
};

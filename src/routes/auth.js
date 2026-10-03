'use strict';
const express = require('express');
const db = require('../db');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');
const otp = require('../lib/otp');

const attempts = new Map(); // key -> {count, until}
function lockOne(key) {
  const a = attempts.get(key);
  if (a && a.until && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 60000);
  if (a && a.until && a.until <= Date.now()) attempts.delete(key);
  return 0;
}
// قفل هم برای «آدرس + نام کاربری» و هم برای کل آدرس IP (جلوگیری از حدس رمز با نام‌های کاربری متعدد)
const lockInfo = (ip, user) => Math.max(lockOne(ip + '|' + user), lockOne('ip|' + ip));
function bump(key, limit) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= limit) { a.until = Date.now() + (settings.num('lockout_minutes') || 10) * 60000; a.count = 0; }
  attempts.set(key, a);
}
function fail(ip, user) { const max = settings.num('max_login_attempts') || 5; bump(ip + '|' + user, max); bump('ip|' + ip, max * 5); }
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
      if (demo) { const pu = await db.get()('users as u').join('parent_students as ps', 'ps.user_id', 'u.id').join('students as s', 's.id', 'ps.student_id').where({ 's.student_code': '14050001', 'u.role': 'parent' }).first('u.username'); if (pu) demo.push(['ولی', pu.username, 'parent123']); }
      res.view('auth/login', { title: 'ورود', demo, error: null, username: '', otpParent: otp.parentLoginOn() }, 'bare');
    } catch (e) { next(e); }
  });
  r.post('/login', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const locked = lockInfo(req.ip, username);
      const render = (error) => res.status(401).view('auth/login', { title: 'ورود', demo: null, error, username, otpParent: otp.parentLoginOn() }, 'bare');
      if (locked) return render(`به دلیل تلاش‌های ناموفق متعدد، ورود تا ${locked} دقیقه دیگر مسدود است.`);
      const u = username ? await db.get()('users').whereRaw('lower(username) = ?', [username]).first() : null;
      if (!u || !svc.verify(password, u.password_hash)) { fail(req.ip, username); await svc.audit({ ip: req.ip }, 'login_failed', 'user', null, username); return render('نام کاربری یا رمز عبور نادرست است.'); }
      if (!u.active) return render('حساب کاربری شما غیرفعال است. با مدیریت مدرسه تماس بگیرید.');
      attempts.delete(req.ip + '|' + username);
      startSession(req, res, next, u, 'password');
    } catch (e) { next(e); }
  });

  // ===== کد یکبارمصرف پیامکی: فراموشی رمز و ورود اولیا =====
  const otpFlow = (purpose, base, title, intro) => {
    r.get(base, (req, res) => {
      if (req.user) return res.redirect('/');
      res.view('auth/otp-request', { title, intro, action: base, purpose, enabled: purpose === 'login' ? otp.parentLoginOn() : otp.available(), error: null }, 'bare');
    });
    r.post(base, async (req, res, next) => {
      try {
        if (req.user) return res.redirect('/');
        const on = purpose === 'login' ? otp.parentLoginOn() : otp.available();
        const show = (error, code = 400) => res.status(code).view('auth/otp-request', { title, intro, action: base, purpose, enabled: on, error }, 'bare');
        if (!on) return show('این قابلیت فعال نیست.', 403);
        const ident = String(req.body.identifier || '').trim(); if (!ident) return show('نام کاربری یا شماره موبایل را وارد کنید.');
        const out = await otp.request(purpose, ident, req.ip);
        if (!out.ok) return show(out.error, out.wait ? 429 : 400);
        req.session.otp = { purpose, uid: out.uid || 0, at: Date.now(), demo: out.demoCode || null, masked: out.masked || '' };
        req.session.save(() => res.redirect(base + '/verify'));
      } catch (e) { next(e); }
    });
    const verifyView = (res, extra) => res.view('auth/otp-verify', Object.assign({ title, purpose, action: base + '/verify', requestUrl: base, error: null, demo: null, masked: '', min: settings.num('min_password_length') || 6 }, extra), 'bare');
    r.get(base + '/verify', (req, res) => {
      const o = req.session.otp; if (req.user || !o || o.purpose !== purpose || Date.now() - o.at > 30 * 60000) return res.redirect(base);
      verifyView(res, { demo: o.demo, masked: o.masked });
    });
    r.post(base + '/verify', async (req, res, next) => {
      try {
        const o = req.session.otp; if (req.user || !o || o.purpose !== purpose || Date.now() - o.at > 30 * 60000) return res.redirect(base);
        const bad = (error) => verifyView(res.status(400), { error, demo: o.demo, masked: o.masked });
        const lk = lockInfo(req.ip, 'otp'); if (lk) return bad(`به دلیل تلاش‌های ناموفق متعدد، تا ${lk} دقیقه دیگر مسدود هستید.`);
        let pw = '';
        if (purpose === 'reset') {
          pw = String(req.body.password || ''); const min = settings.num('min_password_length') || 6;
          if (pw.length < min) return bad(`رمز جدید باید حداقل ${min} نویسه باشد.`);
          if (pw !== String(req.body.password2 || '')) return bad('تکرار رمز عبور یکسان نیست.');
        }
        const v = await otp.verify(purpose, o.uid, req.body.code);
        if (!v.ok) { fail(req.ip, 'otp'); return bad(v.error + (v.left !== undefined ? ` (${v.left} تلاش باقی مانده)` : '')); }
        const usr = await db.get()('users').where({ id: o.uid }).first(); if (!usr || !usr.active) return bad('حساب کاربری فعال نیست.');
        attempts.delete(req.ip + '|otp');
        if (purpose === 'reset') {
          await db.get()('users').where({ id: usr.id }).update({ password_hash: svc.hash(pw), must_change_password: 0 });
          await svc.killSessions(usr.id);
          await svc.audit({ user: usr, ip: req.ip }, 'password_reset_otp', 'user', usr.id, '');
          await svc.notify([usr.id], 'رمز عبور تغییر کرد', 'رمز عبور حساب شما با کد پیامکی تغییر کرد. اگر شما نبودید فوراً به مدرسه اطلاع دهید.', '/profile/password', 'warn');
          delete req.session.otp;
          req.flash('success', 'رمز عبور با موفقیت تغییر کرد. اکنون وارد شوید.');
          return req.session.save(() => res.redirect('/login'));
        }
        delete req.session.otp;
        startSession(req, res, next, usr, 'otp');
      } catch (e) { next(e); }
    });
  };
  otpFlow('reset', '/forgot', 'فراموشی رمز عبور', 'نام کاربری یا شماره موبایل ثبت‌شده را وارد کنید تا کد تأیید پیامک شود.');
  otpFlow('login', '/login/otp', 'ورود اولیا با کد پیامکی', 'شماره موبایل ثبت‌شده در مدرسه را وارد کنید تا کد ورود پیامک شود.');

  function startSession(req, res, next, usr, how) {
    const returnTo = req.session.returnTo;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.uid = usr.id; req.session.cookie.maxAge = (settings.num('session_hours') || 8) * 3600 * 1000;
      db.get()('users').where({ id: usr.id }).update({ last_login: new Date().toISOString().replace('T', ' ').slice(0, 19), last_ip: req.ip }).then(() => svc.audit({ user: usr, ip: req.ip }, 'login', 'user', usr.id, how === 'otp' ? 'otp' : '')).catch(() => {});
      req.session.save(() => res.redirect(usr.must_change_password && how === 'password' ? '/profile/password?force=1' : (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/login') ? returnTo : '/')));
    });
  }
  r.post('/logout', (req, res) => {
    const u = req.user;
    if (u) svc.audit({ user: u, ip: req.ip }, 'logout', 'user', u.id, '');
    req.session.destroy(() => { res.clearCookie('school.sid', { path: require('../config').load().basePath || '/' }); res.redirect('/login'); });
  });
  r.get('/logout', (req, res) => res.redirect('/'));
};

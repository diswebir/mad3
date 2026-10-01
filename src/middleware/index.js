'use strict';
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const { normalizeInput, nestKeys } = require('../utils/fa');

/* ---------- ذخیره نشست در پایگاه داده (مناسب هاست اشتراکی؛ بدون MemoryStore) ---------- */
class KnexStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await db.get()('sessions').where({ sid }).first();
      if (!row) return cb(null, null);
      if (Number(row.expires_at) < Date.now()) { await db.get()('sessions').where({ sid }).del(); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    try {
      const k = db.get();
      const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600 * 1000;
      const n = await k('sessions').where({ sid }).update({ sess: JSON.stringify(sess), expires_at: expires });
      if (!n) { try { await k('sessions').insert({ sid, sess: JSON.stringify(sess), expires_at: expires }); } catch (_) { await k('sessions').where({ sid }).update({ sess: JSON.stringify(sess), expires_at: expires }); } }
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  async destroy(sid, cb) { try { await db.get()('sessions').where({ sid }).del(); cb && cb(null); } catch (e) { cb && cb(e); } }
  async touch(sid, sess, cb) { cb && cb(null); }
  static async cleanup() { try { await db.get()('sessions').where('expires_at', '<', Date.now()).del(); } catch (_) { /* ignore */ } }
}

function sessionMiddleware(cfg) {
  const hours = settings.num('session_hours') || 8;
  return session({
    name: 'school.sid', secret: cfg.sessionSecret, store: new KnexStore(), resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.secureCookies ? 'auto' : false, maxAge: hours * 3600 * 1000, path: cfg.basePath || '/' },
  });
}

/* ---------- کش کوتاه‌مدت برای شمارنده‌های نوار کناری ---------- */
const badgeCache = new Map();
async function badgesFor(user) {
  const hit = badgeCache.get(user.id);
  if (hit && hit.t > Date.now() - 15000) return hit.v;
  const k = db.get();
  const v = { notifications: 0, tickets: 0 };
  const n = await k('notifications').where({ user_id: user.id, is_read: 0 }).count({ c: '*' }).first();
  v.notifications = Number(n.c);
  if (require('../modules').isEnabled('tickets')) {
    // تیکت‌هایی که منتظر اقدام این کاربر هستند
    const q = k('tickets');
    if (user.role === 'admin' || user.role === 'deputy') {
      q.where((b) => b.whereIn('status', ['open', 'pending']).andWhere((c) => c.where('recipient_role', 'admin').orWhere('recipient_user_id', user.id)));
    } else {
      q.where((b) => b.where({ created_by: user.id, status: 'answered' }).orWhere((c) => c.where('recipient_user_id', user.id).whereIn('status', ['open', 'pending'])));
    }
    v.tickets = Number((await q.count({ c: '*' }).first()).c);
  }
  badgeCache.set(user.id, { t: Date.now(), v });
  return v;
}
const invalidateBadges = (uid) => { if (uid) badgeCache.delete(uid); else badgeCache.clear(); };

/* ---------- احراز هویت ---------- */
async function loadUser(req, res, next) {
  req.user = null;
  const uid = req.session && req.session.uid;
  if (uid) {
    const u = await db.get()('users').where({ id: uid }).first();
    if (u && u.active) {
      req.user = u;
      if (u.role === 'teacher') req.user.teacher = await db.get()('teachers').where({ user_id: u.id }).first();
      if (u.role === 'student') req.user.student = await db.get()('students').where({ user_id: u.id }).first();
    } else if (req.session) { delete req.session.uid; }
  }
  res.locals.user = req.user;
  res.locals.isManager = isManager(req.user);
  next();
}
function requireAuth(req, res, next) {
  if (req.user) {
    if (req.user.must_change_password && !req.path.startsWith('/profile') && !req.path.startsWith('/logout')) return res.redirect('/profile/password?force=1');
    return next();
  }
  if (req.session) req.session.returnTo = req.originalUrl.replace(config.load().basePath, '') || '/';
  res.redirect('/login');
}
const requireRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'شما اجازه دسترسی به این بخش را ندارید.' });
};
const isManager = (u) => !!u && (u.role === 'admin' || u.role === 'deputy');

/* ---------- CSRF ---------- */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}
function csrfProtect(req, res, next) {
  Object.defineProperty(res.locals, 'csrf', { get: () => csrfToken(req), configurable: true, enumerable: true });
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  const real = req.session && req.session.csrf;
  if (token && real && token.length === real.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(real))) return next();
  res.status(403).view('error', { code: 403, title: 'درخواست نامعتبر', message: 'نشانه امنیتی فرم منقضی شده است. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.' });
}

/* ---------- پیام‌های فلش ---------- */
function flash(req, res, next) {
  req.flash = (type, msg) => { if (!req.session) return; (req.session.flash = req.session.flash || []).push({ type, msg }); };
  res.locals.flash = [];
  if (req.session && req.session.flash && req.session.flash.length) { res.locals.flash = req.session.flash; req.session.flash = []; }
  next();
}

/* ---------- آپلود ---------- */
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.csv']);
function uploader(kind, field, { maxMB = 5, images = false } = {}) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(config.UPLOAD_DIR, kind)),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase()),
  });
  const m = multer({
    storage, limits: { fileSize: maxMB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXT.has(ext) || (images && !['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext))) return cb(new Error('نوع فایل مجاز نیست'));
      cb(null, true);
    },
  }).single(field);
  return (req, res, next) => m(req, res, (err) => {
    if (err) { req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `حجم فایل بیش از ${maxMB} مگابایت است` : err.message; }
    // فایل originalname در multer به‌صورت latin1 خوانده می‌شود
    if (req.file) req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    if (req.body) req.body = nestKeys(normalizeInput(req.body));
    next();
  });
}
const noPassNormalize = (body) => {
  const o = {};
  for (const k of Object.keys(body)) o[k] = /password|pass$|_csrf/i.test(k) ? body[k] : normalizeInput(body[k]);
  return nestKeys(o);
};

module.exports = { KnexStore, sessionMiddleware, loadUser, requireAuth, requireRole, isManager, csrfProtect, flash, uploader, badgesFor, invalidateBadges, noPassNormalize };

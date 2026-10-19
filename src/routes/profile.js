'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ua = require('../lib/ua');
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

/* ---------- دستگاه‌ها و نشست‌های فعال + تاریخچه‌ی ورود ---------- */
async function mySessions(userId) {
  const k = db.get(); const hours = settings.num('session_hours') || 8;
  const rows = await k('sessions').where((b) => b.where('sess', 'like', `%"uid":${Number(userId)},%`).orWhere('sess', 'like', `%"uid":${Number(userId)}}%`)).where('expires_at', '>', Date.now()).select('sid', 'sess', 'expires_at');
  const out = [];
  for (const r of rows) {
    let s; try { s = JSON.parse(r.sess); } catch (_) { continue; } if (Number(s.uid) !== Number(userId)) continue;
    const d = s.dev || {}; const seen = Number(r.expires_at) - ((s.cookie && s.cookie.originalMaxAge) || hours * 3600000);
    out.push({ sid: r.sid, ...ua.parse(d.ua), ip: d.ip || '—', started: d.at || null, seen: seen > 0 ? seen : null, how: d.how || '' });
  }
  return out.sort((a, b) => (b.seen || 0) - (a.seen || 0));
}
router.get('/profile/sessions', async (req, res, next) => {
  try {
    const tok = (sid) => crypto.createHmac('sha256', config.load().sessionSecret || 'x').update(sid).digest('hex').slice(0, 24);
    const list = (await mySessions(req.user.id)).map(({ sid, ...s }) => ({ ...s, current: sid === req.sessionID, token: tok(sid) }));
    const hist = await db.get()('audit_logs').where({ user_id: req.user.id }).whereIn('action', ['login', 'password_reset_otp', 'password_change', 'sessions_end']).orderBy('id', 'desc').limit(15).select('action', 'ip', 'created_at');
    res.view('profile/sessions', { title: 'دستگاه‌ها و نشست‌های فعال', list, hist, ua });
  } catch (e) { next(e); }
});
router.post('/profile/sessions/end', async (req, res, next) => {
  try {
    const t = String(req.body.token || ''); const mine = await mySessions(req.user.id); let n = 0;
    for (const s of mine) {
      if (s.sid === req.sessionID) continue;
      const tok = crypto.createHmac('sha256', config.load().sessionSecret || 'x').update(s.sid).digest('hex').slice(0, 24);
      if (req.body.all === '1' || tok === t) { await db.get()('sessions').where({ sid: s.sid }).del(); n++; }
    }
    if (n) await svc.audit(req, 'sessions_end', 'user', req.user.id, `${n} نشست`);
    req.flash(n ? 'success' : 'info', n ? `${n} نشست دیگر بسته شد.` : 'نشست دیگری برای بستن وجود ندارد.'); res.redirect('/profile/sessions');
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
    const search = require('../lib/search'); const q = String(req.query.q || '').trim().slice(0, 100); const only = search.TYPES.some((t) => t[0] === req.query.type) ? req.query.type : null;
    const groups = await search.run(req.user, q, { limit: only ? 50 : 10, only });
    // یک نتیجه‌ی دقیقاً هم‌کد → پرش مستقیم به پرونده
    const st = groups.find((g) => g.key === 'students');
    if (!only && st && st.total === 1 && st.items[0].code === search.norm(q)) return res.redirect(st.items[0].url);
    const all = only ? await search.run(req.user, q, { limit: 1 }) : groups;
    res.view('search', { title: 'جستجو', q, gq: q, groups, only, tabs: all.map((g) => ({ key: g.key, title: g.title, total: g.total })), types: search.TYPES });
  } catch (e) { next(e); }
});
router.get('/search/suggest', async (req, res, next) => {
  try {
    const search = require('../lib/search'); const groups = await search.run(req.user, String(req.query.q || '').slice(0, 100), { limit: 4 });
    res.set('Cache-Control', 'no-store').json(groups.map((g) => ({ key: g.key, title: g.title, items: g.items.map((i) => ({ title: i.title, sub: i.sub, url: i.url })) })));
  } catch (e) { next(e); }
});
module.exports = router;

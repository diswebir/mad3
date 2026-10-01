'use strict';
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const modules = require('../modules');
const svc = require('../services');
const { requireRole, uploader } = require('../middleware');
const router = express.Router();
router.use(['/settings', '/modules'], requireRole('admin'));

router.get('/settings', (req, res) => res.view('settings/index', { title: 'تنظیمات', defs: settings.DEFS.filter((d) => d.type !== 'hidden'), groups: settings.GROUPS, values: settings.all(), errors: [] }));
router.post('/settings', async (req, res, next) => {
  try {
    const errors = []; const out = {};
    for (const d of settings.DEFS) {
      if (d.type === 'hidden') continue;
      let v = req.body[d.key];
      if (d.type === 'checkbox') v = v === '1' ? '1' : '0';
      else if (d.type === 'days') v = [].concat(v || []).join(',');
      else if (v === undefined) continue;
      if (d.type === 'number') { const n = Number(v); if (isNaN(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) { errors.push(`«${d.label}» باید عددی بین ${d.min} و ${d.max} باشد.`); continue; } v = String(n); }
      if (d.type === 'time' && !svc.validTime(v)) { errors.push(`«${d.label}» نامعتبر است.`); continue; }
      if (d.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) { errors.push('رنگ نامعتبر است.'); continue; }
      if (d.key === 'school_name' && !v) { errors.push('نام مدرسه نمی‌تواند خالی باشد.'); continue; }
      out[d.key] = v;
    }
    if (errors.length) return res.view('settings/index', { title: 'تنظیمات', defs: settings.DEFS.filter((d) => d.type !== 'hidden'), groups: settings.GROUPS, values: { ...settings.all(), ...req.body }, errors });
    await settings.setMany(out);
    await svc.audit(req, 'update', 'settings', null, 'تنظیمات سامانه');
    req.flash('success', 'تنظیمات ذخیره شد.'); res.redirect('/settings');
  } catch (e) { next(e); }
});
router.post('/settings/logo', uploader('branding', 'logo', { images: true, maxMB: 1 }), async (req, res, next) => {
  try {
    if (req.uploadError || !req.file) { req.flash('error', req.uploadError || 'فایلی انتخاب نشد.'); return res.redirect('/settings'); }
    const old = settings.get('logo');
    if (old) fs.unlink(path.join(config.UPLOAD_DIR, 'branding', old), () => {});
    await settings.set('logo', req.file.filename);
    req.flash('success', 'لوگو بروزرسانی شد.'); res.redirect('/settings');
  } catch (e) { next(e); }
});
router.post('/settings/logo/remove', async (req, res, next) => {
  try { const old = settings.get('logo'); if (old) fs.unlink(path.join(config.UPLOAD_DIR, 'branding', old), () => {}); await settings.set('logo', ''); res.redirect('/settings'); } catch (e) { next(e); }
});

router.get('/settings/system', async (req, res, next) => {
  try {
    const k = db.get(); const tables = ['users', 'students', 'teachers', 'classrooms', 'attendance', 'tickets', 'scores', 'audit_logs', 'sessions'];
    const counts = {}; for (const t of tables) counts[t] = Number((await k(t).count({ c: '*' }).first()).c);
    let upload = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else upload += fs.statSync(p).size; } };
    try { walk(config.UPLOAD_DIR); } catch (_) { /* ignore */ }
    const mem = process.memoryUsage();
    res.view('settings/system', { title: 'وضعیت سامانه', counts, info: { node: process.version, platform: `${os.platform()} ${os.release()}`, uptime: Math.round(process.uptime()), rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), db: config.load().db.client === 'mysql' ? 'MySQL' : 'SQLite', upload: Math.round(upload / 1024), basePath: config.load().basePath || '/', env: process.env.NODE_ENV || 'development' } });
  } catch (e) { next(e); }
});

router.get('/modules', (req, res) => res.view('settings/modules', { title: 'ماژول‌ها', mods: modules.MODULES }));
router.post('/modules/:key/toggle', async (req, res, next) => {
  try {
    const m = modules.byKey[req.params.key];
    if (!m || m.core) { req.flash('error', 'این ماژول قابل غیرفعال‌سازی نیست.'); return res.redirect('/modules'); }
    const on = !modules.isEnabled(m.key);
    await modules.setEnabled(m.key, on);
    await svc.audit(req, on ? 'module_enable' : 'module_disable', 'modules', m.key, m.title);
    require('../middleware').invalidateBadges();
    req.flash('success', `ماژول «${m.title}» ${on ? 'فعال' : 'غیرفعال'} شد.`); res.redirect('/modules');
  } catch (e) { next(e); }
});
module.exports = router;

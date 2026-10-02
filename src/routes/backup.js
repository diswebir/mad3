'use strict';
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const modules = require('../modules');
const settings = require('../settings');
const svc = require('../services');
const J = require('../utils/jalali');
const B = require('../lib/backupTools');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/backup', modules.guard('backup'), requireRole('admin'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }).single('file');

router.get('/backup', async (req, res, next) => {
  try {
    const k = db.get(); const counts = {};
    for (const t of ['users', 'students', 'teachers', 'attendance', 'tickets']) counts[t] = Number((await k(t).count({ c: '*' }).first()).c);
    res.view('backup/index', { title: 'پشتیبان‌گیری', counts, sqlite: config.load().db.client !== 'mysql', files: B.list(), autoOn: settings.bool('auto_backup_enabled'), keep: settings.num('auto_backup_keep') || 7, lastAuto: B.list().find((f) => f.kind === 'auto') || null });
  } catch (e) { next(e); }
});
router.post('/backup/download', async (req, res, next) => {
  try {
    const out = await B.dump(db.get()); await svc.audit(req, 'backup', 'system', null, 'JSON');
    res.set('Content-Type', 'application/json; charset=utf-8').set('Content-Disposition', `attachment; filename="school-backup-${J.todayISO()}.json"`).send(JSON.stringify(out));
  } catch (e) { next(e); }
});
router.post('/backup/now', async (req, res, next) => {
  try {
    const r = await B.save(db.get(), 'manual'); B.prune(); await svc.audit(req, 'backup', 'system', null, `ذخیره روی سرور: ${r.name}`);
    req.flash('success', 'پشتیبان روی سرور ذخیره شد.'); res.redirect('/backup');
  } catch (e) { next(e); }
});
router.get('/backup/files/:name', (req, res) => {
  const p = B.pathOf(req.params.name); if (!p || !fs.existsSync(p)) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'فایل پشتیبان پیدا نشد.' });
  svc.audit(req, 'backup', 'system', null, `دانلود ${req.params.name}`).catch(() => {}); res.download(p, req.params.name);
});
router.post('/backup/files/:name/delete', async (req, res, next) => {
  try {
    const p = B.pathOf(req.params.name); if (!p || !fs.existsSync(p)) { req.flash('error', 'فایل پیدا نشد.'); return res.redirect('/backup'); }
    fs.unlinkSync(p); await svc.audit(req, 'delete', 'backup', null, req.params.name); req.flash('success', 'نسخه‌ی پشتیبان حذف شد.'); res.redirect('/backup');
  } catch (e) { next(e); }
});
router.post('/backup/sqlite', async (req, res, next) => {
  try {
    if (config.load().db.client === 'mysql') { req.flash('error', 'این گزینه فقط برای SQLite است.'); return res.redirect('/backup'); }
    const tmp = path.join(os.tmpdir(), `school-${Date.now()}.sqlite`);
    await db.get().raw('VACUUM INTO ?', [tmp]);
    await svc.audit(req, 'backup', 'system', null, 'SQLite');
    res.download(tmp, `school-${J.todayISO()}.sqlite`, () => fs.unlink(tmp, () => {}));
  } catch (e) { next(e); }
});
async function doRestore(req, res, data, label) {
  const k = db.get();
  const pre = await B.save(k, 'pre-restore'); // پشتیبان خودکار پیش از هر بازیابی
  await B.restore(k, data);
  await settings.load(); await modules.load(); require('../middleware').invalidateBadges();
  await k('sessions').del();
  req._noSessionSave = true; // نشست حذف‌شده نباید با ذخیره‌ی پیش از ریدایرکت دوباره ساخته شود
  console.log(`[backup] restored from ${label}; previous state saved as ${pre.name}`);
  res.redirect('/login');
}
router.post('/backup/restore', (req, res, next) => {
  upload(req, res, async (err) => {
    try {
      if (err || !req.file) { req.flash('error', 'فایل پشتیبان را انتخاب کنید.'); return res.redirect('/backup'); }
      if (req.query._csrf !== req.session.csrf) return res.status(403).view('error', { code: 403, title: 'درخواست نامعتبر', message: 'نشانه امنیتی نامعتبر است.' });
      if (req.body.confirm !== 'RESTORE') { req.flash('error', 'برای تأیید، عبارت RESTORE را تایپ کنید.'); return res.redirect('/backup'); }
      let data; try { data = B.read(req.file.buffer); } catch (_) { req.flash('error', 'فایل JSON معتبر نیست.'); return res.redirect('/backup'); }
      if (!B.validShape(data)) { req.flash('error', 'این فایل، پشتیبان این سامانه نیست.'); return res.redirect('/backup'); }
      await doRestore(req, res, data, 'upload');
    } catch (e) { next(e); }
  });
});
router.post('/backup/files/:name/restore', async (req, res, next) => {
  try {
    const p = B.pathOf(req.params.name); if (!p || !fs.existsSync(p)) { req.flash('error', 'فایل پیدا نشد.'); return res.redirect('/backup'); }
    if (req.body.confirm !== 'RESTORE') { req.flash('error', 'برای تأیید، عبارت RESTORE را تایپ کنید.'); return res.redirect('/backup'); }
    let data; try { data = B.read(fs.readFileSync(p)); } catch (_) { req.flash('error', 'فایل پشتیبان خراب است.'); return res.redirect('/backup'); }
    if (!B.validShape(data)) { req.flash('error', 'فایل پشتیبان معتبر نیست.'); return res.redirect('/backup'); }
    await doRestore(req, res, data, req.params.name);
  } catch (e) { next(e); }
});
module.exports = router;

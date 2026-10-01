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
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/backup', modules.guard('backup'), requireRole('admin'));
const TABLES = ['settings', 'modules_state', 'users', 'academic_years', 'subjects', 'teachers', 'classrooms', 'class_subjects', 'students', 'student_documents', 'student_notes', 'attendance', 'tickets', 'ticket_messages', 'assessments', 'scores', 'homework', 'homework_submissions', 'timetable', 'exam_schedule', 'announcements', 'events', 'notifications', 'discipline_records', 'health_records', 'meetings', 'fees', 'payments', 'books', 'book_loans', 'bus_routes', 'audit_logs'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } }).single('file');

router.get('/backup', async (req, res, next) => {
  try {
    const k = db.get(); const counts = {};
    for (const t of ['users', 'students', 'teachers', 'attendance', 'tickets']) counts[t] = Number((await k(t).count({ c: '*' }).first()).c);
    res.view('backup/index', { title: 'پشتیبان‌گیری', counts, sqlite: config.load().db.client !== 'mysql' });
  } catch (e) { next(e); }
});
router.post('/backup/download', async (req, res, next) => {
  try {
    const k = db.get(); const out = { app: 'school-management', version: 1, created_at: new Date().toISOString(), tables: {} };
    for (const t of TABLES) out.tables[t] = await k(t).select();
    await svc.audit(req, 'backup', 'system', null, 'JSON');
    res.set('Content-Type', 'application/json; charset=utf-8').set('Content-Disposition', `attachment; filename="school-backup-${J.todayISO()}.json"`).send(JSON.stringify(out));
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
router.post('/backup/restore', (req, res, next) => {
  upload(req, res, async (err) => {
    try {
      if (err || !req.file) { req.flash('error', 'فایل پشتیبان را انتخاب کنید.'); return res.redirect('/backup'); }
      if (req.query._csrf !== req.session.csrf) return res.status(403).view('error', { code: 403, title: 'درخواست نامعتبر', message: 'نشانه امنیتی نامعتبر است.' });
      if (req.body.confirm !== 'RESTORE') { req.flash('error', 'برای تأیید، عبارت RESTORE را تایپ کنید.'); return res.redirect('/backup'); }
      let data; try { data = JSON.parse(req.file.buffer.toString('utf8')); } catch (_) { req.flash('error', 'فایل JSON معتبر نیست.'); return res.redirect('/backup'); }
      if (!data || data.app !== 'school-management' || !data.tables || !data.tables.users) { req.flash('error', 'این فایل، پشتیبان این سامانه نیست.'); return res.redirect('/backup'); }
      const k = db.get();
      await k.transaction(async (t) => {
        for (const name of TABLES) {
          await t(name).del();
          const rows = data.tables[name] || [];
          if (rows.length) await t.batchInsert(name, rows, Math.max(1, Math.floor(700 / Object.keys(rows[0]).length)));
        }
      });
      await settings.load(); await modules.load(); require('../middleware').invalidateBadges();
      await k('sessions').del();
      res.redirect('/login');
    } catch (e) { next(e); }
  });
});
module.exports = router;

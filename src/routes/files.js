'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const svc = require('../services');
const router = express.Router();

const isMgr = (u) => u.role === 'admin' || u.role === 'deputy';

async function canAccess(user, kind, name) {
  const k = db.get();
  if (kind === 'photos') {
    if (await k('users').where({ avatar: name }).first()) return { ok: true, inline: true };
    const s = await k('students').where({ photo: name }).first();
    if (!s) return { ok: false };
    if (isMgr(user) || s.user_id === user.id) return { ok: true, inline: true };
    if (user.role === 'teacher') { const ids = await svc.accessibleClassIds(user); if (ids.includes(s.classroom_id)) return { ok: true, inline: true }; }
    return { ok: false };
  }
  if (kind === 'documents') {
    const d = await k('student_documents as d').join('students as s', 's.id', 'd.student_id').where('d.file_name', name).select('d.original_name', 's.user_id', 's.classroom_id').first();
    if (!d) return { ok: false };
    if (isMgr(user) || d.user_id === user.id) return { ok: true, name: d.original_name };
    if (user.role === 'teacher') { const ids = await svc.accessibleClassIds(user); if (ids.includes(d.classroom_id)) return { ok: true, name: d.original_name }; }
    return { ok: false };
  }
  if (kind === 'tickets') {
    const m = await k('ticket_messages as m').join('tickets as t', 't.id', 'm.ticket_id').where('m.attachment', name).select('m.attachment_name', 'm.internal', 'm.is_certificate', 't.created_by', 't.recipient_user_id').first();
    if (!m || !svc.canViewTicket(user, m)) return { ok: false };
    if (m.internal && !isMgr(user) && user.role !== 'teacher') return { ok: false };
    const cert = require('../lib/certificate');
    return { ok: true, name: m.attachment_name, inline: !!m.is_certificate && cert.isImageName(name), image: cert.isImageName(name) && !!m.is_certificate };
  }
  if (kind === 'homework') {
    const h = await k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').where('h.attachment', name).select('h.attachment_name', 'cs.classroom_id').first();
    if (h) { if (isMgr(user)) return { ok: true, name: h.attachment_name }; const ids = await svc.accessibleClassIds(user); return ids.includes(h.classroom_id) ? { ok: true, name: h.attachment_name } : { ok: false }; }
    const s = await k('homework_submissions as x').join('students as st', 'st.id', 'x.student_id').join('homework as hw', 'hw.id', 'x.homework_id').join('class_subjects as cs', 'cs.id', 'hw.class_subject_id').where('x.file', name).select('x.file_name', 'st.user_id', 'cs.classroom_id', 'cs.teacher_id').first();
    if (!s) return { ok: false };
    if (isMgr(user) || s.user_id === user.id) return { ok: true, name: s.file_name };
    if (user.role === 'teacher' && user.teacher && s.teacher_id === user.teacher.id) return { ok: true, name: s.file_name };
    return { ok: false };
  }
  return { ok: false };
}

router.get('/files/:kind/:name', async (req, res, next) => {
  try {
    const { kind, name } = req.params;
    if (!['photos', 'documents', 'tickets', 'homework'].includes(kind) || !/^[\w.-]+$/.test(name) || name.includes('..')) return res.status(404).end();
    const a = await canAccess(req.user, kind, name);
    if (!a.ok) return res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'اجازه دانلود این فایل را ندارید.' });
    const file = path.join(config.UPLOAD_DIR, kind, name);
    if (!fs.existsSync(file)) return res.status(404).view('error', { code: 404, title: 'فایل یافت نشد', message: 'فایل مورد نظر روی سرور وجود ندارد.' });
    res.set('Cache-Control', 'private, max-age=3600');
    if (a.image) { // تصویر گواهی: نمایش درون‌خطی ولی بدون امکان اجرای هر محتوای فعال
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox", 'Content-Type': require('../lib/certificate').mimeOf(name), 'Cache-Control': 'private, no-store' });
      return res.sendFile(file, { headers: {} });
    }
    if (a.inline) return res.sendFile(file);
    res.download(file, a.name || name);
  } catch (e) { next(e); }
});
module.exports = router;

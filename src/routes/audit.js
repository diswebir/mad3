'use strict';
const express = require('express');
const db = require('../db');
const modules = require('../modules');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/audit', modules.guard('audit'), requireRole('admin'));
router.get('/audit', async (req, res, next) => {
  try {
    const k = db.get(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 50; const q = (req.query.q || '').trim();
    const qb = k('audit_logs');
    if (req.query.action) qb.where({ action: req.query.action });
    if (q) qb.where((b) => b.where('user_name', 'like', `%${q}%`).orWhere('details', 'like', `%${q}%`).orWhere('entity', 'like', `%${q}%`));
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const rows = await qb.orderBy('id', 'desc').limit(per).offset((page - 1) * per);
    const actions = (await k('audit_logs').distinct('action').orderBy('action')).map((a) => a.action);
    res.view('audit/index', { title: 'گزارش فعالیت‌ها', rows, total, page, pages: Math.max(1, Math.ceil(total / per)), q, action: req.query.action || '', actions });
  } catch (e) { next(e); }
});
module.exports = router;

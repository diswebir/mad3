'use strict';
/**
 * فراخوانی کارهای زمان‌بندی‌شده با cron هاست (cPanel → Cron Jobs):
 *   مثال (هر ۱۵ دقیقه): هر-۱۵-دقیقه curl -fsS "https://example.com/cron?token=TOKEN" >/dev/null
 * توکن در «تنظیمات ← نگهداری و پشتیبان» دیده/بازسازی می‌شود. این آدرس بدون نشست و CSRF است و فقط با توکن کار می‌کند.
 */
const crypto = require('crypto');
const express = require('express');
const settings = require('../settings');
const db = require('../db');

const MIN_GAP_MS = 60 * 1000;
let lastRun = 0; let running = false;

async function ensureToken() {
  let t = settings.get('cron_token');
  if (!t) { t = crypto.randomBytes(24).toString('hex'); await settings.set('cron_token', t); }
  return t;
}
async function regenerate() { const t = crypto.randomBytes(24).toString('hex'); await settings.set('cron_token', t); return t; }
function same(a, b) { const x = crypto.createHash('sha256').update(String(a)).digest(); const y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); }

const router = express.Router();
async function handler(req, res) {
  res.set('Cache-Control', 'no-store');
  const given = req.get('x-cron-token') || (typeof req.query.token === 'string' ? req.query.token : '');
  const real = settings.get('cron_token');
  if (!real || !given || !same(given, real)) return res.status(403).json({ ok: false, error: 'invalid token' });
  if (running) return res.status(202).json({ ok: true, skipped: 'already running' });
  if (Date.now() - lastRun < MIN_GAP_MS) return res.status(429).json({ ok: false, error: 'too soon', retry_after: Math.ceil((MIN_GAP_MS - (Date.now() - lastRun)) / 1000) });
  running = true; lastRun = Date.now();
  try {
    const t0 = Date.now(); const result = await require('../jobs').run();
    try { await db.get()('audit_logs').insert({ action: 'cron', entity: 'system', details: JSON.stringify(result).slice(0, 500), ip: req.ip }); } catch (_) { /* ignore */ }
    res.json({ ok: true, ms: Date.now() - t0, result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); } finally { running = false; }
}
router.get('/cron', handler);
router.post('/cron', express.urlencoded({ extended: false, limit: '1kb' }), handler);

module.exports = { router, ensureToken, regenerate, _resetGap: () => { lastRun = 0; } };

'use strict';
/**
 * مدیریت پیکربندی. تنظیمات نصب در data/config.json ذخیره می‌شود (خارج از پوشه public).
 * متغیرهای محیطی نسبت به فایل اولویت دارند (مناسب Node.js Selector در cPanel).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.SCHOOL_DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOCK_FILE = path.join(DATA_DIR, 'installed.lock');
const STATE_FILE = path.join(DATA_DIR, 'install-state.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR, path.join(UPLOAD_DIR, 'photos'), path.join(UPLOAD_DIR, 'documents'), path.join(UPLOAD_DIR, 'tickets'), path.join(UPLOAD_DIR, 'homework'), path.join(UPLOAD_DIR, 'branding')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

let cache = null;
function load() {
  if (cache) return cache;
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* نصب نشده */ }
  const env = process.env;
  const db = Object.assign({ client: 'sqlite' }, file.db || {});
  if (env.DB_CLIENT) db.client = env.DB_CLIENT;
  if (env.DB_HOST) db.host = env.DB_HOST;
  if (env.DB_PORT) db.port = Number(env.DB_PORT);
  if (env.DB_NAME) db.database = env.DB_NAME;
  if (env.DB_USER) db.user = env.DB_USER;
  if (env.DB_PASSWORD) db.password = env.DB_PASSWORD;
  cache = {
    db,
    basePath: normalizeBase(env.BASE_PATH !== undefined ? env.BASE_PATH : (file.basePath || env.PASSENGER_BASE_URI || '')),
    sessionSecret: env.SESSION_SECRET || file.sessionSecret || null,
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : !!file.secureCookies,
    installedAt: file.installedAt || null,
    domainLock: file.domainLock || null,
  };
  return cache;
}
function normalizeBase(b) {
  b = String(b || '').trim();
  if (!b || b === '/') return '';
  if (!b.startsWith('/')) b = '/' + b;
  return b.replace(/\/+$/, '');
}
function save(cfg) {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  cache = null;
}
/** ادغام بخشی از پیکربندی در config.json بدون از دست رفتن بقیه‌ی کلیدها */
function update(patch) {
  ensureDirs();
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { /* ignore */ }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...file, ...patch }, null, 2), { mode: 0o600 });
  cache = null;
}
function isInstalled() { return fs.existsSync(LOCK_FILE) && fs.existsSync(CONFIG_FILE); }
function markInstalled() { fs.writeFileSync(LOCK_FILE, new Date().toISOString()); }
function randomSecret() { return crypto.randomBytes(48).toString('hex'); }

module.exports = { ROOT, DATA_DIR, CONFIG_FILE, LOCK_FILE, STATE_FILE, UPLOAD_DIR, ensureDirs, load, save, update, isInstalled, markInstalled, randomSecret, normalizeBase };

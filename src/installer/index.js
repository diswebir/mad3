'use strict';
/**
 * ویزارد نصب: بررسی پیش‌نیازها ← پایگاه داده (SQLite یا MySQL) ← اطلاعات مدرسه ← حساب مدیر ← ماژول‌ها ← نصب
 * وضعیت مراحل در data/install-state.json نگهداری می‌شود تا با چند پردازش (Passenger) هم کار کند.
 */
const express = require('express');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');
const dbm = require('../db');
const { createSchema, dropAll } = require('../schema');
const modulesReg = require('../modules');
const settingsSvc = require('../settings');
const { normalizeInput, toFa } = require('../utils/fa');
const { validPhone } = require('../services');
const svc = require('../services');

const STEPS = [['welcome', 'خوش‌آمدگویی'], ['db', 'پایگاه داده'], ['school', 'مدرسه'], ['admin', 'مدیر'], ['modules', 'ماژول‌ها'], ['finish', 'نصب']];

function readState() {
  try { return JSON.parse(fs.readFileSync(config.STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeState(s) { config.ensureDirs(); fs.writeFileSync(config.STATE_FILE, JSON.stringify(s), { mode: 0o600 }); }

function requirements() {
  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ label: `نسخه Node.js (${process.versions.node})`, ok: major >= 18, hint: 'نسخه ۱۸ یا بالاتر لازم است. در cPanel از Setup Node.js App نسخه جدیدتر را انتخاب کنید.' });
  let writable = true;
  try { config.ensureDirs(); const f = config.DATA_DIR + '/.w'; fs.writeFileSync(f, '1'); fs.unlinkSync(f); } catch (_) { writable = false; }
  out.push({ label: 'دسترسی نوشتن در پوشه data (تنظیمات، فایل‌های بارگذاری‌شده، SQLite)', ok: writable, hint: 'مجوز نوشتن پوشه data را بررسی کنید.' });
  out.push({ label: 'درایور SQLite (better-sqlite3)', ok: dbm.sqliteAvailable(), optional: true, hint: 'اختیاری؛ اگر نصب نشده باشد از MySQL استفاده کنید.' });
  let my = true; try { require('mysql2'); } catch (_) { my = false; }
  out.push({ label: 'درایور MySQL (mysql2)', ok: my, optional: true, hint: 'اگر نصب نشده، «Run NPM Install» را اجرا کنید.' });
  out.push({ label: `حافظه آزاد سیستم (${toFa(Math.round(os.freemem() / 1048576))} مگابایت)`, ok: os.freemem() > 100 * 1048576, optional: true, hint: 'حداقل ۱۰۰ مگابایت پیشنهاد می‌شود.' });
  const base = config.load().basePath;
  out.push({ label: `مسیر پایه برنامه: ${base || '/ (ریشه دامنه)'}`, ok: true, optional: true, hint: '' });
  return out;
}

function createRouter(onComplete) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '100kb' }));
  router.use((req, res, next) => {
    res.locals.title = 'نصب سامانه';
    res.locals.user = null;
    res.locals.S = (k) => (k === 'school_name' ? 'سامانه مدیریت مدرسه' : '');
    const st = readState();
    if (!st.csrf) { st.csrf = crypto.randomBytes(16).toString('hex'); writeState(st); }
    res.locals.csrf = st.csrf; res.locals.state = st; res.locals.STEPS = STEPS; res.locals.flash = [];
    if (req.method === 'POST') {
      req.body = normalizeInput(req.body || {});
      if (req.body._csrf !== st.csrf) return res.status(403).send('نشانه امنیتی نامعتبر است؛ صفحه را تازه‌سازی کنید.');
    }
    next();
  });
  const render = (res, step, data = {}) => res.view('installer/' + step, { step, ...data }, 'bare');
  router.get('/', (req, res) => res.redirect('/install'));

  router.get('/install', (req, res) => render(res, 'welcome', { reqs: requirements() }));
  router.post('/install', (req, res) => {
    const reqs = requirements();
    if (reqs.some((r) => !r.ok && !r.optional)) return render(res, 'welcome', { reqs, error: 'ابتدا پیش‌نیازهای ضروری را برطرف کنید.' });
    res.redirect('/install/db');
  });

  router.get('/install/db', (req, res) => render(res, 'db', { sqlite: dbm.sqliteAvailable(), db: readState().db || { client: dbm.sqliteAvailable() ? 'sqlite' : 'mysql', host: 'localhost', port: 3306 } }));
  async function testDb(b) {
    if (b.client === 'sqlite') {
      if (!dbm.sqliteAvailable()) throw new Error('درایور SQLite روی این سرور نصب نیست؛ MySQL را انتخاب کنید.');
      return { client: 'sqlite' };
    }
    const cfg = { client: 'mysql', host: b.host || 'localhost', port: Number(b.port) || 3306, database: b.database, user: b.user, password: b.password || '' };
    if (!cfg.database || !cfg.user) throw new Error('نام پایگاه داده و نام کاربری الزامی است.');
    const k = dbm.buildKnex(cfg);
    try { await k.raw('select 1'); } catch (e) { throw new Error('اتصال برقرار نشد: ' + (e.code || e.message)); } finally { await k.destroy(); }
    return cfg;
  }
  router.post('/install/db', async (req, res) => {
    try {
      const cfg = await testDb(req.body);
      const st = readState(); st.db = cfg; writeState(st);
      if (req.body.test_only) return render(res, 'db', { sqlite: dbm.sqliteAvailable(), db: cfg, ok: 'اتصال با موفقیت برقرار شد ✓' });
      res.redirect('/install/school');
    } catch (e) { render(res, 'db', { sqlite: dbm.sqliteAvailable(), db: req.body, error: e.message }); }
  });

  router.get('/install/school', (req, res) => {
    const st = readState(); if (!st.db) return res.redirect('/install/db');
    render(res, 'school', { school: st.school || { school_type: 'متوسطه اول', periods_count: 6, week_days: '0,1,2,3,4' }, types: settingsSvc.DEFS.find((d) => d.key === 'school_type').options });
  });
  router.post('/install/school', (req, res) => {
    const b = req.body; const st = readState();
    if (!b.school_name || b.school_name.length < 3) return render(res, 'school', { school: b, types: settingsSvc.DEFS.find((d) => d.key === 'school_type').options, error: 'نام مدرسه را وارد کنید (حداقل ۳ حرف).' });
    if (!validPhone(b.school_phone)) return render(res, 'school', { school: b, types: settingsSvc.DEFS.find((d) => d.key === 'school_type').options, error: 'تلفن معتبر نیست.' });
    const days = [].concat(req.body.week_days || []).join(',') || '0,1,2,3,4';
    st.school = { school_name: b.school_name, school_type: b.school_type, school_phone: b.school_phone || '', school_address: b.school_address || '', school_principal: b.school_principal || '', periods_count: String(Math.min(10, Math.max(1, Number(b.periods_count) || 6))), week_days: days, student_code_prefix: (b.student_code_prefix || '').replace(/\D/g, '') || String(new Date().getFullYear() - 621), };
    writeState(st); res.redirect('/install/admin');
  });

  router.get('/install/admin', (req, res) => { const st = readState(); if (!st.school) return res.redirect('/install/school'); render(res, 'admin', { admin: st.admin || { username: 'admin' } }); });
  router.post('/install/admin', (req, res) => {
    const b = req.body; const errors = [];
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(b.username || '')) errors.push('نام کاربری باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
    if (!b.full_name || b.full_name.length < 3) errors.push('نام و نام خانوادگی مدیر را وارد کنید.');
    if (!b.password || b.password.length < 8) errors.push('رمز عبور باید حداقل ۸ نویسه باشد.');
    if (b.password !== b.password2) errors.push('تکرار رمز عبور مطابقت ندارد.');
    const sup = { username: String(b.super_username || '').trim(), password: b.super_password || '' };
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(sup.username)) errors.push('نام کاربری سوپر ادمین باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
    else if (sup.username.toLowerCase() === String(b.username || '').toLowerCase()) errors.push('نام کاربری سوپر ادمین باید با نام کاربری مدیر مدرسه متفاوت باشد.');
    if (sup.password.length < 8) errors.push('رمز عبور سوپر ادمین باید حداقل ۸ نویسه باشد.');
    else if (sup.password !== b.super_password2) errors.push('تکرار رمز عبور سوپر ادمین مطابقت ندارد.');
    else if (sup.password === b.password) errors.push('رمز سوپر ادمین باید با رمز مدیر مدرسه متفاوت باشد.');
    if (errors.length) return render(res, 'admin', { admin: b, errors });
    const st = readState(); st.super = { username: sup.username, password_hash: svc.hash(sup.password) }; st.admin = { username: b.username, full_name: b.full_name, password_hash: svc.hash(b.password), email: b.email || '' }; writeState(st); // رمز به‌صورت متن ساده روی دیسک نگهداری نمی‌شود
    res.redirect('/install/modules');
  });

  router.get('/install/modules', (req, res) => { const st = readState(); if (!st.admin) return res.redirect('/install/admin'); render(res, 'modules', { mods: modulesReg.MODULES.filter((m) => !m.hidden), chosen: st.modules || modulesReg.MODULES.map((m) => m.key), demo: st.demo !== false }); });
  router.post('/install/modules', (req, res) => {
    const st = readState();
    st.modules = [].concat(req.body.modules || []); st.demo = req.body.demo === '1';
    writeState(st); res.redirect('/install/finish');
  });

  router.get('/install/finish', (req, res) => { const st = readState(); if (!st.modules) return res.redirect('/install/modules'); render(res, 'finish', { st }); });
  router.post('/install/finish', async (req, res) => {
    const st = readState();
    if (config.isInstalled()) return res.redirect('/');
    if (!st.db || !st.school || !st.admin || !st.super || !st.modules) return res.redirect('/install');
    const base = config.load().basePath;
    let k = null; let created = false;
    try {
      const cfg = { db: st.db, basePath: base, sessionSecret: config.randomSecret(), secureCookies: req.secure || req.get('x-forwarded-proto') === 'https', installedAt: new Date().toISOString() };
      config.save(cfg);
      await dbm.close();
      k = dbm.init(cfg.db);
      const existing = await k.schema.hasTable('users');
      if (existing && Number((await k('users').count({ c: '*' }).first()).c) > 0) throw new Error('پایگاه داده انتخاب‌شده خالی نیست. یک پایگاه داده خالی بسازید یا جدول‌های قبلی را حذف کنید.');
      await createSchema(k); created = true;
      const seed = require('../seed');
      await seed.seedBase(k, { school: st.school, admin: st.admin, modules: st.modules, superAdmin: st.super });
      await settingsSvc.load();
      await modulesReg.load();
      if (st.demo) await seed.seedDemo(k);
      config.markInstalled();
      try { // قفل دامنه: دامنه‌ای که ویزارد با آن باز شده صریحاً ثبت می‌شود (نه اولین درخواست تصادفی)
        const DL = require('../lib/domainLock'); const mode = ['this', 'manual', 'off'].includes(req.body.domain_lock) ? req.body.domain_lock : 'this'; const h = DL.normalize(req.headers.host);
        if (mode === 'this' && !DL.isLoopback(h) && DL.validHost(h)) await DL.write({ enabled: true, hosts: [h], by: 'installer' });
        else if (mode === 'off') await DL.write({ enabled: false, hosts: [], by: 'installer' });
        else if (mode === 'manual') config.update({ domainLockMode: 'manual' });
      } catch (e) { console.error('[installer] domain lock', e.message); }
      const demoUsed = !!st.demo;
      const adminName = st.admin.username; const superName = st.super.username;
      try { fs.unlinkSync(config.STATE_FILE); } catch (_) { /* ignore */ }
      await onComplete();
      render(res, 'done', { demo: demoUsed, adminName, superName, base });
    } catch (e) {
      console.error('[installer]', e);
      try { fs.unlinkSync(config.CONFIG_FILE); } catch (_) { /* ignore */ }
      try { if (created && k) await dropAll(k); } catch (_) { /* ignore */ }
      try { await dbm.close(); } catch (_) { /* ignore */ }
      render(res, 'finish', { st, error: 'نصب با خطا مواجه شد: ' + e.message });
    }
  });
  router.use((req, res) => res.redirect('/install'));
  return router;
}
module.exports = { createRouter };

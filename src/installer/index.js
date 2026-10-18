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

const STEPS = [['welcome', 'پیش‌نیازها'], ['db', 'پایگاه داده'], ['school', 'اطلاعات مدرسه'], ['admin', 'حساب‌های کاربری'], ['modules', 'ماژول‌ها'], ['finish', 'تأیید و نصب']];
const STEP_HELP = {
  welcome: 'سرور و نسخه‌ی Node بررسی می‌شود تا نصب بدون سورپرایز انجام شود.',
  db: 'محل نگهداری اطلاعات: SQLite (بدون تنظیمات) یا MySQL (پیشنهادی برای هاست).',
  school: 'نام و تنظیمات پایه‌ی مدرسه؛ همه را بعداً می‌توانید تغییر دهید.',
  admin: 'مدیر مدرسه و سوپر ادمین (پشتیبان فنی) را بسازید.',
  modules: 'قابلیت‌های موردنیاز را روشن کنید؛ بعداً هم قابل تغییر است.',
  finish: 'مرور نهایی، قفل دامنه و شروع نصب.',
};
/** دسته‌بندی ماژول‌ها برای صفحه‌ی انتخاب */
const MOD_GROUPS = [
  ['پایه (همیشه فعال)', ['core', 'students', 'teachers', 'classes', 'settings']],
  ['آموزش', ['attendance', 'timetable', 'grades', 'homework', 'exams', 'questionbank', 'calendar', 'birthdays', 'promotion']],
  ['ارتباطات', ['tickets', 'announcements', 'meetings', 'sms', 'parents']],
  ['پرونده و رفاه دانش‌آموز', ['discipline', 'health', 'documents', 'transport', 'exits']],
  ['مالی و منابع', ['finance', 'library', 'hr']],
  ['گزارش و نگهداری', ['reports', 'audit', 'backup']],
];
const COMMON_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', 'admin123', 'admin1234', 'admin12345', '11111111', 'iloveyou', 'abc12345', '00000000', 'school123']);
let installing = false;

function readState() {
  try { return JSON.parse(fs.readFileSync(config.STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeState(s) { config.ensureDirs(); fs.writeFileSync(config.STATE_FILE, JSON.stringify(s), { mode: 0o600 }); }

function requirements() {
  const out = [];
  const major = Number(process.versions.node.split('.')[0]);
  out.push({ key: 'node', label: `نسخه Node.js (${process.versions.node})`, ok: major >= 18, hint: 'نسخه ۱۸ یا بالاتر لازم است (پیشنهاد: ۲۰ یا ۲۲ LTS). در cPanel از Setup Node.js App نسخه‌ی جدیدتر را انتخاب کنید.' });
  let writable = true;
  try { config.ensureDirs(); const f = config.DATA_DIR + '/.w'; fs.writeFileSync(f, '1'); fs.unlinkSync(f); } catch (_) { writable = false; }
  out.push({ key: 'data', label: 'دسترسی نوشتن در پوشه‌ی data', ok: writable, hint: 'مجوز نوشتن پوشه‌ی data را بررسی کنید (تنظیمات، فایل‌های بارگذاری‌شده، پشتیبان و SQLite آنجا ذخیره می‌شوند).' });
  const sq = dbm.sqliteStatus();
  out.push({ key: 'sqlite', label: 'درایور SQLite (better-sqlite3)', ok: sq.ok, optional: true, hint: sq.ok ? '' : 'اختیاری؛ اگر کار نمی‌کند MySQL را انتخاب کنید یا «npm rebuild better-sqlite3» را اجرا کنید.' + (sq.error ? ' (' + sq.error.slice(0, 90) + ')' : '') });
  let my = true; try { require('mysql2'); } catch (_) { my = false; }
  out.push({ key: 'mysql', label: 'درایور MySQL (mysql2)', ok: my, optional: true, hint: 'اگر نصب نشده، «Run NPM Install» (یا npm install) را اجرا کنید.' });
  out.push({ key: 'mem', label: `حافظه‌ی آزاد سیستم (${toFa(Math.round(os.freemem() / 1048576))} مگابایت)`, ok: os.freemem() > 100 * 1048576, optional: true, hint: 'حداقل ۱۰۰ مگابایت پیشنهاد می‌شود.' });
  const base = config.load().basePath;
  out.push({ key: 'base', label: `مسیر پایه‌ی برنامه: ${base || '/ (ریشه‌ی دامنه)'}`, ok: true, optional: true, hint: '' });
  return out;
}
function sysInfo(req) {
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return [
    ['نسخه‌ی سامانه', 'v' + require('../version').VERSION],
    ['Node.js', process.version + ' (' + process.platform + ' / ' + process.arch + ')'],
    ['پوشه‌ی داده', config.DATA_DIR],
    ['نشانی فعلی', proto + '://' + (req.get('host') || '')],
  ];
}
/** پیام فارسیِ راهنما برای خطاهای رایج اتصال MySQL */
function mysqlHint(e) {
  const c = e && e.code; const m = String((e && e.message) || e);
  if (c === 'ECONNREFUSED') return 'سرور MySQL روی این میزبان/پورت پاسخ نمی‌دهد. میزبان و پورت را بررسی کنید (در cPanel معمولاً localhost و ۳۳۰۶؛ در لاراگون: 127.0.0.1).';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'نشانی میزبان پیدا نشد. نام میزبان را درست بنویسید (برای هاست اشتراکی معمولاً localhost).';
  if (c === 'ETIMEDOUT' || c === 'EHOSTUNREACH') return 'زمان اتصال به سرور تمام شد؛ ممکن است دسترسی از بیرون یا فایروال بسته باشد.';
  if (c === 'ER_ACCESS_DENIED_ERROR' || /Access denied/i.test(m)) return 'نام کاربری یا رمز عبور MySQL اشتباه است (در cPanel پیشوند حساب را هم بنویسید؛ مثل cpuser_school).';
  if (c === 'ER_BAD_DB_ERROR' || /Unknown database/i.test(m)) return 'این پایگاه‌داده وجود ندارد. آن را بسازید یا گزینه‌ی «اگر نبود بساز» را بزنید.';
  if (c === 'ER_DBACCESS_DENIED_ERROR') return 'این کاربر به آن پایگاه‌داده دسترسی ندارد (در cPanel کاربر را به پایگاه‌داده اضافه کنید: Add User To Database).';
  return (c || m).toString().slice(0, 160);
}

/** آخرین مرحله‌ای که کاربر پیش‌تر پر کرده (برای «ادامه از همان‌جا») */
function progressOf(st) {
  if (st.modules) return { next: 'finish', label: 'تأیید و نصب' };
  if (st.admin) return { next: 'modules', label: 'ماژول‌ها' };
  if (st.school) return { next: 'admin', label: 'حساب‌های کاربری' };
  if (st.db) return { next: 'db', label: 'اطلاعات مدرسه', to: 'school' };
  return null;
}

function groupMods() {
  const all = modulesReg.MODULES.filter((m) => !m.hidden); const used = new Set(); const out = [];
  for (const [title, keys] of MOD_GROUPS) { const mods = keys.map((k) => all.find((m) => m.key === k)).filter(Boolean); mods.forEach((m) => used.add(m.key)); if (mods.length) out.push({ title, mods }); }
  const rest = all.filter((m) => !used.has(m.key)); if (rest.length) out.push({ title: 'سایر', mods: rest });
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
  const render = (res, step, data = {}) => res.view('installer/' + step, { step, extraCss: 'css/installer.css', extraJs: 'js/installer.js', STEP_HELP, appVersion: require('../version').VERSION, ...data }, 'bare');
  router.get('/', (req, res) => res.redirect('/install'));

  router.get('/install', (req, res) => render(res, 'welcome', { reqs: requirements(), sys: sysInfo(req), progress: progressOf(readState()) }));
  router.post('/install/reset', (req, res) => { try { const st = readState(); fs.writeFileSync(config.STATE_FILE, JSON.stringify({ csrf: st.csrf }), { mode: 0o600 }); } catch (_) { /* ignore */ } res.redirect('/install'); });
  router.post('/install', (req, res) => {
    const reqs = requirements();
    if (reqs.some((r) => !r.ok && !r.optional)) return render(res, 'welcome', { reqs, sys: sysInfo(req), progress: progressOf(readState()), error: 'ابتدا پیش‌نیازهای ضروری (علامت قرمز) را برطرف کنید.' });
    res.redirect('/install/db');
  });

  const dbView = (res, data = {}) => { const st = readState(); const cur = data.db || st.db || { client: dbm.sqliteAvailable() ? 'sqlite' : 'mysql', host: 'localhost', port: 3306 }; const { password, ...safe } = cur; render(res, 'db', { sqlite: dbm.sqliteAvailable(), sqliteErr: dbm.sqliteStatus().error, db: { ...safe, hasPassword: !!(password || (st.db && st.db.password && st.db.client === 'mysql')) }, dataDir: config.DATA_DIR, ...(({ db: _d, ...r }) => r)(data) }); };
  router.get('/install/db', (req, res) => dbView(res));
  /** اتصال را می‌سنجد و جزئیات برمی‌گرداند. رمز ذخیره‌شده در فایل وضعیت هرگز به صفحه برنگردانده می‌شود. */
  async function testDb(b) {
    if (b.client === 'sqlite') {
      if (!dbm.sqliteAvailable()) throw new Error(dbm.SQLITE_HELP);
      const k = dbm.buildKnex({ client: 'sqlite' });
      try { if (await k.schema.hasTable('users') && Number((await k('users').count({ c: '*' }).first()).c) > 0) throw new Error('در پوشه‌ی data یک پایگاه‌داده‌ی SQLite دارای اطلاعات از نصب قبلی هست. فایل data/school.sqlite را پاک کنید (یا پشتیبان بگیرید) و دوباره امتحان کنید.'); } finally { await k.destroy(); }
      return { cfg: { client: 'sqlite' }, info: ['SQLite آماده است', 'فایل: ' + require('path').join(config.DATA_DIR, 'school.sqlite')] };
    }
    const st = readState();
    const host = String(b.host || 'localhost').trim(); const port = Number(b.port) || 3306; const database = String(b.database || '').trim(); const user = String(b.user || '').trim();
    let password = b.password || ''; if (!password && b.keep_password === '1' && st.db && st.db.client === 'mysql' && st.db.host === host && st.db.user === user) password = st.db.password || '';
    if (!database || !user) throw new Error('نام پایگاه‌داده و نام کاربری الزامی است.');
    if (!/^[A-Za-z0-9_$.-]{1,64}$/.test(database)) throw new Error('نام پایگاه‌داده فقط می‌تواند شامل حروف لاتین، عدد، _ و - باشد.');
    if (port < 1 || port > 65535) throw new Error('پورت معتبر نیست.');
    const cfg = { client: 'mysql', host, port, database, user, password };
    const info = [];
    if (b.create_db === '1') {
      const k0 = dbm.buildKnex({ ...cfg, database: undefined });
      try { await k0.raw('CREATE DATABASE IF NOT EXISTS `' + database.replace(/`/g, '') + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); info.push('پایگاه‌داده در صورت نبودن ساخته شد'); } catch (e) { throw new Error('ساخت پایگاه‌داده ممکن نشد: ' + mysqlHint(e) + (e.code === 'ER_DBACCESS_DENIED_ERROR' || e.code === 'ER_ACCESS_DENIED_ERROR' ? ' (در cPanel پایگاه‌داده را از بخش MySQL Databases بسازید.)' : '')); } finally { await k0.destroy(); }
    }
    const k = dbm.buildKnex(cfg);
    try {
      let ver = ''; try { ver = String((await k.raw('select version() as v'))[0][0].v); } catch (_) { await k.raw('select 1'); }
      info.push('اتصال برقرار شد' + (ver ? ' — نسخه‌ی سرور: ' + ver : ''));
      if (await k.schema.hasTable('users') && Number((await k('users').count({ c: '*' }).first()).c) > 0) throw new Error('این پایگاه‌داده از نصب قبلی داده دارد. یک پایگاه‌داده‌ی خالی بسازید یا جدول‌های قبلی را حذف کنید.');
      const n = Number((await k('information_schema.tables').where({ table_schema: database }).count({ c: '*' }).first()).c);
      info.push(n ? `پایگاه‌داده ${toFa(n)} جدول دارد (جدول‌های هم‌نام بازنویسی نمی‌شوند؛ پایگاه‌داده‌ی خالی بهتر است)` : 'پایگاه‌داده خالی است ✓');
    } catch (e) { if (/از نصب قبلی/.test(e.message)) throw e; throw new Error('اتصال برقرار نشد: ' + mysqlHint(e)); } finally { await k.destroy(); }
    return { cfg, info };
  }
  router.post('/install/db/test', async (req, res) => {
    try { const r = await testDb(req.body); res.json({ ok: true, info: r.info }); } catch (e) { res.status(200).json({ ok: false, error: e.message }); }
  });
  router.post('/install/db', async (req, res) => {
    try {
      const { cfg, info } = await testDb(req.body);
      const st = readState(); st.db = cfg; writeState(st);
      if (req.body.test_only) return dbView(res, { ok: info.join(' • '), db: { ...cfg } });
      res.redirect('/install/school');
    } catch (e) { const { password, ...rest } = req.body; dbView(res, { error: e.message, db: { ...rest, client: req.body.client || 'mysql' } }); }
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
    else if (COMMON_PASSWORDS.has(String(b.password).toLowerCase()) || String(b.password).toLowerCase() === String(b.username || '').toLowerCase()) errors.push('این رمز عبور بسیار رایج یا برابر نام کاربری است؛ رمز قوی‌تری انتخاب کنید.');
    if (b.password !== b.password2) errors.push('تکرار رمز عبور مطابقت ندارد.');
    const sup = { username: String(b.super_username || '').trim(), password: b.super_password || '' };
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(sup.username)) errors.push('نام کاربری سوپر ادمین باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
    else if (sup.username.toLowerCase() === String(b.username || '').toLowerCase()) errors.push('نام کاربری سوپر ادمین باید با نام کاربری مدیر مدرسه متفاوت باشد.');
    if (sup.password.length < 8) errors.push('رمز عبور سوپر ادمین باید حداقل ۸ نویسه باشد.');
    else if (COMMON_PASSWORDS.has(sup.password.toLowerCase())) errors.push('رمز سوپر ادمین بسیار رایج است؛ رمز قوی‌تری انتخاب کنید.');
    else if (sup.password !== b.super_password2) errors.push('تکرار رمز عبور سوپر ادمین مطابقت ندارد.');
    else if (sup.password === b.password) errors.push('رمز سوپر ادمین باید با رمز مدیر مدرسه متفاوت باشد.');
    if (errors.length) return render(res, 'admin', { admin: { full_name: b.full_name, username: b.username, email: b.email, super_username: b.super_username }, errors });
    const st = readState(); st.super = { username: sup.username, password_hash: svc.hash(sup.password) }; st.admin = { username: b.username, full_name: b.full_name, password_hash: svc.hash(b.password), email: b.email || '' }; writeState(st); // رمز به‌صورت متن ساده روی دیسک نگهداری نمی‌شود
    res.redirect('/install/modules');
  });

  router.get('/install/modules', (req, res) => { const st = readState(); if (!st.admin) return res.redirect('/install/admin'); render(res, 'modules', { groups: groupMods(), chosen: st.modules || modulesReg.MODULES.map((m) => m.key), demo: st.demo !== false }); });
  router.post('/install/modules', (req, res) => {
    const st = readState();
    st.modules = [].concat(req.body.modules || []); st.demo = req.body.demo === '1';
    writeState(st); res.redirect('/install/finish');
  });

  router.get('/install/finish', (req, res) => { const st = readState(); if (!st.modules) return res.redirect('/install/modules'); render(res, 'finish', { st, host: require('../lib/domainLock').normalize(req.headers.host) }); });
  router.post('/install/finish', async (req, res) => {
    const st = readState();
    if (config.isInstalled()) return res.redirect('/');
    if (!st.db || !st.school || !st.admin || !st.super || !st.modules) return res.redirect('/install');
    const base = config.load().basePath;
    if (installing) return render(res, 'finish', { st, host: '', error: 'نصب در حال انجام است؛ چند لحظه صبر کنید و صفحه را تازه‌سازی نکنید.' });
    installing = true;
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
      await onComplete(); installing = false;
      render(res, 'done', { demo: demoUsed, adminName, superName, base, host: req.headers.host || '', lock: req.body.domain_lock || 'this' });
    } catch (e) {
      installing = false;
      console.error('[installer]', e);
      try { fs.unlinkSync(config.CONFIG_FILE); } catch (_) { /* ignore */ }
      try { if (created && k) await dropAll(k); } catch (_) { /* ignore */ }
      try { await dbm.close(); } catch (_) { /* ignore */ }
      render(res, 'finish', { st, host: '', error: 'نصب با خطا مواجه شد: ' + (dbm.isBindingError(e) ? dbm.SQLITE_HELP : e.message) });
    }
  });
  router.use((req, res) => res.redirect('/install'));
  return router;
}
module.exports = { createRouter };

'use strict';
/** پنل «سوپر ادمین»: قفل دامنه، ماژول‌ها، پیامک، حالت تعمیر، پرونده‌ی فروش و پشتیبانی. مدیر مدرسه به هیچ‌کدام دسترسی ندارد. */
const express = require('express');
const os = require('os');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const modules = require('../modules');
const svc = require('../services');
const J = require('../utils/jalali');
const DL = require('../lib/domainLock');
const SA = require('../lib/superadmin');
const { requireRole, requireSuper } = require('../middleware');

const router = express.Router();

/* ---------- راه‌اندازی اولیه‌ی سوپر ادمین (فقط وقتی هنوز وجود ندارد؛ با توکن فایل سرور) ---------- */
const tries = new Map();
function setup(r) {
  r.get('/super/setup', async (req, res, next) => {
    try {
      if (await SA.exists(db.get())) return res.status(404).view('error', { code: 404, title: 'صفحه یافت نشد', message: 'نشانی درخواستی وجود ندارد.' }, 'bare');
      res.view('super/setup', { title: 'ساخت حساب سوپر ادمین', error: '', vals: {} }, 'bare');
    } catch (e) { next(e); }
  });
  r.post('/super/setup', async (req, res, next) => {
    try {
      const k = db.get(); const b = req.body; const ip = req.ip || '';
      if (await SA.exists(k)) return res.status(404).view('error', { code: 404, title: 'صفحه یافت نشد', message: 'نشانی درخواستی وجود ندارد.' }, 'bare');
      const now = Date.now(); const rec = (tries.get(ip) || []).filter((t) => now - t < 600000);
      if (rec.length >= 5) { tries.set(ip, rec); return res.status(429).view('super/setup', { title: 'ساخت حساب سوپر ادمین', error: 'تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید.', vals: {} }, 'bare'); }
      const fail = (error) => { rec.push(now); tries.set(ip, rec); return res.view('super/setup', { title: 'ساخت حساب سوپر ادمین', error, vals: { username: b.username } }, 'bare'); };
      if (!SA.tokenOk(b.token)) return fail('توکن راه‌اندازی نادرست است. محتوای فایل data/super-setup.token را وارد کنید.');
      if (b.password !== b.password2) return fail('تکرار رمز عبور مطابقت ندارد.');
      try { await SA.create(k, { username: String(b.username || ''), password: String(b.password || ''), full_name: 'سوپر ادمین' }); } catch (e) { return fail(e.message); }
      SA.removeToken();
      req.flash('success', 'حساب سوپر ادمین ساخته شد. اکنون وارد شوید.'); res.redirect('/login');
    } catch (e) { next(e); }
  });
}

router.use('/super', requireRole('admin'), requireSuper);

/* ---------- پرونده‌ی فروش و پشتیبانی ---------- */
const BKEYS = ['sa_client', 'sa_contact', 'sa_sale_price', 'sa_sale_date', 'sa_plan', 'sa_plan_fee', 'sa_next_due', 'sa_notes'];
const bill = () => Object.fromEntries(BKEYS.map((k) => [k, settings.all()[k] || '']));
const toNum = (v) => Math.max(0, Math.round(Number(String(v || '').replace(/[,٬\s]/g, '').replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))) || 0));
function dueInfo(b) {
  if (!b.sa_next_due || b.sa_plan === 'none' || !b.sa_plan) return null;
  const days = Math.round((new Date(b.sa_next_due + 'T00:00:00Z') - new Date(J.todayISO() + 'T00:00:00Z')) / 86400000);
  return { days, level: days < 0 ? 'red' : days <= 14 ? 'amber' : 'green' };
}

router.get('/super', async (req, res, next) => {
  try {
    const k = db.get(); const st = DL.state(); const B = require('../lib/backupTools'); const list = B.list();
    const b = bill(); const due = dueInfo(b);
    const last = list.reduce((m, f) => Math.max(m, f.mtime || 0), 0);
    const mods = modules.MODULES.filter((m) => !m.hidden);
    res.view('super/index', {
      title: 'پنل سوپر ادمین', lock: st, host: DL.normalize(req.headers.host), due, plan: b.sa_plan, nextDue: b.sa_next_due,
      modsOn: mods.filter((m) => modules.isEnabled(m.key)).length, modsAll: mods.length,
      sms: { enabled: settings.bool('sms_enabled'), provider: settings.get('sms_provider'), key: !!settings.get('sms_api_key'), otp: settings.bool('sms_otp_enabled'), pattern: !!settings.get('sms_otp_pattern') },
      maintenance: settings.bool('maintenance_mode'), maintenanceMsg: settings.get('maintenance_message'),
      info: { version: require('../version').VERSION, node: process.version, db: config.load().db.client, uptime: Math.round(process.uptime() / 60), platform: `${os.platform()} ${os.release()}`, lastBackup: last, backups: list.length },
      users: Number((await k('users').whereNot({ role: 'superadmin' }).count({ c: '*' }).first()).c),
    });
  } catch (e) { next(e); }
});

router.post('/super/maintenance', async (req, res, next) => {
  try {
    const on = req.body.on === '1';
    await settings.set('maintenance_mode', on ? '1' : '0');
    if (typeof req.body.message === 'string' && req.body.message.trim()) await settings.set('maintenance_message', req.body.message.trim().slice(0, 500));
    await svc.audit(req, on ? 'maintenance_on' : 'maintenance_off', 'settings', null, on ? 'فعال‌سازی حالت تعمیر (تعلیق دسترسی کاربران)' : 'پایان حالت تعمیر');
    req.flash('success', on ? 'حالت تعمیر فعال شد؛ فقط سوپر ادمین می‌تواند وارد شود.' : 'حالت تعمیر غیرفعال شد.'); res.redirect('/super');
  } catch (e) { next(e); }
});

/* ---------- قفل دامنه ---------- */
router.get('/super/domain', (req, res) => res.view('super/domain', { title: 'قفل دامنه', lock: DL.state(), host: DL.normalize(req.headers.host) }));
async function saveLock(req, res, { enabled, hosts }, msg, action) {
  await DL.setLock({ enabled, hosts, by: req.user.username });
  await svc.audit(req, 'domain_lock', 'domain', null, action);
  req.flash('success', msg); res.redirect('/super/domain');
}
router.post('/super/domain/add', async (req, res, next) => {
  try {
    const h = DL.normalize(req.body.host); const st = DL.state();
    if (!DL.validHost(h)) { req.flash('error', 'نام دامنه معتبر نیست (مثل school.example.ir).'); return res.redirect('/super/domain'); }
    await saveLock(req, res, { enabled: true, hosts: [...new Set([...st.hosts, h])] }, `دامنه‌ی «${h}» مجاز شد.`, `افزودن دامنه: ${h}`);
  } catch (e) { next(e); }
});
router.post('/super/domain/remove', async (req, res, next) => {
  try {
    const h = DL.normalize(req.body.host); const st = DL.state(); const cur = DL.normalize(req.headers.host);
    const rest = st.hosts.filter((x) => x !== h);
    if (!rest.length || (h === cur && !rest.includes(cur))) { req.flash('error', h === cur ? 'این دامنه همین‌جاست؛ حذف آن شما را بیرون می‌اندازد. ابتدا دامنه‌ی جایگزین را اضافه کنید، سپس از آن دامنه این را حذف کنید.' : 'دست‌کم یک دامنه باید باقی بماند (یا قفل را غیرفعال کنید).'); return res.redirect('/super/domain'); }
    await saveLock(req, res, { enabled: true, hosts: rest }, `دامنه‌ی «${h}» حذف شد.`, `حذف دامنه: ${h}`);
  } catch (e) { next(e); }
});
router.post('/super/domain/toggle', async (req, res, next) => {
  try {
    const st = DL.state(); const cur = DL.normalize(req.headers.host); const on = req.body.on === '1';
    const hosts = st.hosts.length ? st.hosts : (st.db && st.db.hosts.length ? st.db.hosts : [cur]);
    await saveLock(req, res, { enabled: on, hosts: on && !hosts.includes(cur) && !DL.isLoopback(cur) ? [...hosts, cur] : hosts }, on ? 'قفل دامنه فعال شد.' : 'قفل دامنه غیرفعال شد؛ سامانه روی هر دامنه‌ای اجرا می‌شود.', on ? 'فعال‌سازی قفل دامنه' : 'غیرفعال‌سازی قفل دامنه');
  } catch (e) { next(e); }
});

/* ---------- پرونده‌ی فروش و پشتیبانی (فقط ثبت و یادآوری؛ هیچ محدودیت خودکاری اعمال نمی‌کند) ---------- */
router.get('/super/billing', async (req, res, next) => {
  try {
    const k = db.get(); const b = bill(); const rows = await k('support_ledger').orderBy('paid_at', 'desc').orderBy('id', 'desc').limit(300);
    const sums = { sale: 0, support: 0, other: 0 }; for (const r of rows) sums[r.kind] = (sums[r.kind] || 0) + Number(r.amount);
    res.view('super/billing', { title: 'پرونده‌ی فروش و پشتیبانی', b, rows, sums, due: dueInfo(b), today: J.isoToJString(J.todayISO()) });
  } catch (e) { next(e); }
});
router.post('/super/billing', async (req, res, next) => {
  try {
    const x = req.body; const out = {};
    out.sa_client = String(x.sa_client || '').slice(0, 150); out.sa_contact = String(x.sa_contact || '').slice(0, 150);
    out.sa_sale_price = String(toNum(x.sa_sale_price)); out.sa_plan_fee = String(toNum(x.sa_plan_fee));
    out.sa_sale_date = J.parseJalali(x.sa_sale_date) || ''; out.sa_next_due = J.parseJalali(x.sa_next_due) || '';
    out.sa_plan = ['none', 'monthly', 'yearly'].includes(x.sa_plan) ? x.sa_plan : 'none'; out.sa_notes = String(x.sa_notes || '').slice(0, 1000);
    await settings.setMany(out); await svc.audit(req, 'update', 'billing', null, 'پرونده‌ی فروش و پشتیبانی');
    req.flash('success', 'ذخیره شد.'); res.redirect('/super/billing');
  } catch (e) { next(e); }
});
router.post('/super/billing/entries', async (req, res, next) => {
  try {
    const x = req.body; const amount = toNum(x.amount); const kind = ['sale', 'support', 'other'].includes(x.kind) ? x.kind : 'support';
    if (!amount) { req.flash('error', 'مبلغ را وارد کنید.'); return res.redirect('/super/billing'); }
    await db.get()('support_ledger').insert({ kind, amount, paid_at: J.parseJalali(x.paid_at) || J.todayISO(), period: String(x.period || '').slice(0, 60) || null, note: String(x.note || '').slice(0, 300) || null, created_by: req.user.id });
    // پرداخت پشتیبانی: سررسید بعدی را یک دوره جلو ببر
    if (kind === 'support' && x.advance === '1') {
      const b = bill(); const base = b.sa_next_due && b.sa_next_due >= J.todayISO() ? b.sa_next_due : J.todayISO();
      const nx = b.sa_plan === 'yearly' ? J.addDays(base, 365) : J.addDays(base, 30);
      if (b.sa_plan === 'monthly' || b.sa_plan === 'yearly') await settings.set('sa_next_due', nx);
    }
    await svc.audit(req, 'create', 'billing', null, `${kind}: ${amount}`);
    req.flash('success', 'پرداخت ثبت شد.'); res.redirect('/super/billing');
  } catch (e) { next(e); }
});
router.post('/super/billing/entries/:id(\\d+)/delete', async (req, res, next) => {
  try { await db.get()('support_ledger').where({ id: req.params.id }).del(); await svc.audit(req, 'delete', 'billing', req.params.id); req.flash('success', 'حذف شد.'); res.redirect('/super/billing'); } catch (e) { next(e); }
});

module.exports = router;
module.exports.setup = setup;
module.exports.dueInfo = dueInfo;
module.exports.bill = bill;

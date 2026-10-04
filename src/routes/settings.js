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

const TABS = [
  ['general', 'اطلاعات مدرسه', 'school'], ['academic', 'آموزشی', 'graduation-cap'], ['reportcard', 'کارنامه', 'file-text'], ['attendance', 'حضور و غیاب', 'calendar-check'],
  ['tickets', 'تیکت‌ها', 'life-buoy'], ['students', 'دانش‌آموزان', 'users'], ['birthday', 'تولد', 'cake'], ['finance', 'مالی', 'wallet'], ['hr', 'منابع انسانی', 'user-cog'],
  ['sms', 'پیامک و کد تأیید', 'smartphone'], ['security', 'امنیت', 'shield-check'], ['appearance', 'ظاهر و ورود', 'palette'], ['system', 'نگهداری، پشتیبان و cron', 'database-backup'],
];
const tabKey = (t) => (TABS.some((x) => x[0] === t) ? t : 'general');
const defsOf = (tab) => settings.DEFS.filter((d) => d.type !== 'hidden' && d.group === tab);
/** نشانی کامل cron برای نمایش به مدیر */
const cronUrl = (req) => `${req.protocol}://${req.get('host')}${config.load().basePath === '/' ? '' : config.load().basePath || ''}/cron?token=${settings.get('cron_token')}`;

async function renderTab(req, res, tab, { errors = [], values = null, confirm = null, status = 200 } = {}) {
  tab = tabKey(tab); const data = { title: 'تنظیمات', tab, tabs: TABS, defs: defsOf(tab), values: values || settings.all(), errors, confirm, groups: settings.GROUPS };
  if (tab === 'birthday') { const BK = require('../lib/birthdayKinds'); data.bdVars = BK.VARS; }
  if (tab === 'system') {
    const k = db.get(); const last = await k('audit_logs').where({ action: 'cron' }).orderBy('id', 'desc').first();
    const B = require('../lib/backupTools'); const list = B.list();
    data.cron = { url: cronUrl(req), last: last ? last.created_at : null, lastResult: last ? last.details : null, line: `*/15 * * * * curl -fsS "${cronUrl(req)}" >/dev/null 2>&1`, wget: `*/15 * * * * wget -q -O /dev/null "${cronUrl(req)}"` };
    data.backups = { n: list.length, last: list.reduce((m, f) => Math.max(m, f.mtime || 0), 0) };
  }
  return res.status(status).view('settings/index', data);
}
router.get('/settings', (req, res, next) => renderTab(req, res, req.query.tab).catch(next));

/** اعتبارسنجی و جمع‌آوری مقادیر برای مجموعه‌ای از تنظیمات */
function collect(req, defs) {
  const errors = []; const out = {};
  for (const d of defs) {
    if (d.type === 'hidden') continue;
      let v = req.body[d.key];
      if (d.type === 'checkbox') v = v === '1' ? '1' : '0';
      else if (d.type === 'days') v = [].concat(v || []).join(',');
      else if (v === undefined) continue;
      if (d.type === 'secret' && !v) continue; // خالی = بدون تغییر
      if (d.key === 'cron_token' && !/^[A-Za-z0-9_-]{16,80}$/.test(v)) { errors.push('«توکن cron» باید ۱۶ تا ۸۰ نویسه‌ی لاتین/عدد (و _ -) باشد.'); continue; }
      if (/^bd_pattern_/.test(d.key) && v && !/^[A-Za-z0-9_-]{3,60}$/.test(v)) { errors.push(`«${d.label}» نامعتبر است.`); continue; }
      if (/^bd_params_/.test(d.key)) { const pr = require('../lib/birthdayKinds').parseParams(v); if (!pr.ok) { errors.push(`«${d.label}»: ${pr.error}`); continue; } }
      if (/^bd_tpl_/.test(d.key) && v.length > 400) { errors.push('«متن پیام» حداکثر ۴۰۰ نویسه است.'); continue; }
      if (d.key === 'sms_otp_pattern' && v && !/^[A-Za-z0-9_-]{3,60}$/.test(v)) { errors.push('«کد الگو» نامعتبر است.'); continue; }
      if (d.key === 'sms_otp_param' && !/^[A-Za-z_]\w{0,30}$/.test(v || '')) { errors.push('«نام متغیر کد» باید لاتین باشد (مثل code).'); continue; }
      if (d.key === 'sms_from_number' && v && !/^\+?\d{3,15}$/.test(v)) { errors.push('«شماره ارسال‌کننده» نامعتبر است (مثل +983000505).'); continue; }
      if (d.key === 'sms_base_url' && v && !/^https?:\/\/[^\s]+$/.test(v)) { errors.push('«نشانی پایه API» باید با http:// یا https:// شروع شود.'); continue; }
      if (d.key === 'term_weights' && v && !/^\d+(\.\d+)?(\s*[,،]\s*\d+(\.\d+)?)*$/.test(v)) { errors.push('«ضریب نوبت‌ها» باید مثل ۱,۲ باشد.'); continue; }
      if (d.key === 'rc_levels' && v && !v.split(/\r?\n/).filter(Boolean).every((l) => /^\d{1,3}\s*\|\s*\S+/.test(l.trim()))) { errors.push('«سطوح توصیفی» باید سطر به سطر به‌شکل «۹۰|عالی» باشد.'); continue; }
      if (d.type === 'number') { const n = Number(v); if (isNaN(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) { errors.push(`«${d.label}» باید عددی بین ${d.min} و ${d.max} باشد.`); continue; } v = String(n); }
      if (d.type === 'time' && !svc.validTime(v)) { errors.push(`«${d.label}» نامعتبر است.`); continue; }
      if (d.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) { errors.push('رنگ نامعتبر است.'); continue; }
      if (d.key === 'week_days' && !v) { errors.push('حداقل یک روز را برای هفته‌ی مدرسه انتخاب کنید.'); continue; }
      if (d.key === 'school_name' && !v) { errors.push('نام مدرسه نمی‌تواند خالی باشد.'); continue; }
    out[d.key] = v;
  }
  return { out, errors };
}
router.post('/settings', async (req, res, next) => {
  try {
    const group = TABS.some((x) => x[0] === req.body._group) ? req.body._group : null; // بدون _group = همه‌ی تنظیمات (سازگاری با نسخه‌های قبل)
    const defs = group ? defsOf(group) : settings.DEFS.filter((d) => d.type !== 'hidden');
    const { out, errors } = collect(req, defs); const tab = group || 'general';
    const mergedValues = { ...settings.all(), ...req.body };
    if (errors.length) return renderTab(req, res, tab, { errors, values: mergedValues });
    // تغییر روزهای هفته‌ی مدرسه: اگر ساعت‌های برنامه در روزهای حذف‌شده بمانند، تأیید صریح لازم است
    if (out.week_days !== undefined && out.week_days !== settings.get('week_days') && req.body.confirm_orphans !== '1') {
      const days = out.week_days.split(',').filter(Boolean).map(Number);
      const orphans = await require('../lib/timetableTools').orphans(db.get(), { days });
      if (orphans.length) return renderTab(req, res, tab, { values: mergedValues, status: 409, confirm: { text: `با این تغییر ${orphans.length} ساعت درسیِ برنامه‌ی هفتگی در روزهای حذف‌شده می‌ماند (${require('../lib/timetableTools').describeOrphans(orphans)}). این ساعت‌ها در برنامه‌ی هفتگی دیده نمی‌شوند و باید جابه‌جا یا حذف شوند.` } });
    }
    await settings.setMany(out);
    await svc.audit(req, 'update', 'settings', null, group ? `تنظیمات «${settings.GROUPS[group]}»` : 'تنظیمات سامانه');
    req.flash('success', 'تنظیمات ذخیره شد.'); res.redirect('/settings?tab=' + tab);
  } catch (e) { next(e); }
});
/** ساخت توکن جدید cron (توکن قبلی بی‌اعتبار می‌شود) */
router.post('/settings/cron/regenerate', async (req, res, next) => {
  try { await require('./cron').regenerate(); await svc.audit(req, 'update', 'settings', null, 'بازسازی توکن cron'); req.flash('success', 'توکن cron جدید ساخته شد؛ زمان‌بندی هاست را با نشانی جدید به‌روز کنید.'); res.redirect('/settings?tab=system'); } catch (e) { next(e); }
});
router.post('/settings/logo', uploader('branding', 'logo', { images: true, maxMB: 1 }), async (req, res, next) => {
  try {
    if (req.uploadError || !req.file) { req.flash('error', req.uploadError || 'فایلی انتخاب نشد.'); return res.redirect('/settings?tab=appearance'); }
    const old = settings.get('logo');
    if (old) fs.unlink(path.join(config.UPLOAD_DIR, 'branding', old), () => {});
    await settings.set('logo', req.file.filename);
    req.flash('success', 'لوگو بروزرسانی شد.'); res.redirect('/settings?tab=appearance');
  } catch (e) { next(e); }
});
router.post('/settings/logo/remove', async (req, res, next) => {
  try { const old = settings.get('logo'); if (old) fs.unlink(path.join(config.UPLOAD_DIR, 'branding', old), () => {}); await settings.set('logo', ''); res.redirect('/settings?tab=appearance'); } catch (e) { next(e); }
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

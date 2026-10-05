'use strict';
/**
 * قفل دامنه: این نصب فقط روی دامنه‌(های) ثبت‌شده کار می‌کند.
 *  - حالت ثبت (mode): auto (پیش‌فرض: اولین دامنه‌ی غیر از localhost ثبت و قفل می‌شود) · manual (هیچ‌چیز خودکار قفل نمی‌شود؛ سوپر ادمین دستی ثبت می‌کند)
 *    · off (بدون قفل). با متغیر محیطی DOMAIN_LOCK=auto|manual|off یا کلید domainLockMode در config.json مقدار پیش‌فرض نصب‌های بدون سابقه‌ی قفل تعیین می‌شود.
 *  - ویزارد نصب دامنه‌ای را که با آن باز شده در پایان نصب صریحاً ثبت می‌کند (نه اولین درخواست تصادفی، مثل پایش سرور یا پیش‌نمایش).
 *  - الگوی زیردامنه: *.example.ir همه‌ی زیردامنه‌ها را مجاز می‌کند (نه خود example.ir).
 *  - قفل هم در data/config.json و هم در پایگاه داده نگه‌داری می‌شود (حذف یکی کافی نیست).
 *  - در دامنه‌ی دیگر فقط یک صفحه‌ی «دامنه مجاز نیست» با فرم ورود سوپر ادمین نمایش داده می‌شود؛
 *    سوپر ادمین می‌تواند همان‌جا دامنه‌ی جدید را مجاز کند.
 * توجه: این یک قفل در سطح برنامه است؛ کسی که دسترسی کامل به فایل‌ها و پایگاه داده دارد می‌تواند آن را دور بزند.
 */
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const settings = require('../settings');
const svc = require('../services');
const RL = require('./ratelimit');

const KEY = 'domain_lock';
const normalize = (h) => {
  h = String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = /^\[([^\]]*)\](?::\d+)?$/.exec(h); // IPv6 داخل براکت
  if (m) return m[1];
  if ((h.match(/:/g) || []).length === 1) h = h.replace(/:\d*$/, ''); // host:port
  return h.replace(/^www\./, '').replace(/\.$/, '');
};
const isLoopback = (h) => ['localhost', '127.0.0.1', '::1', ''].includes(normalize(h));
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const validHost = (h) => { h = String(h || ''); if (h.startsWith('*.')) return DOMAIN_RE.test(h.slice(2)); return DOMAIN_RE.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === 'localhost'; };
/** تطبیق نام میزبان با یک ورودی فهرست (دقیق یا الگوی *.example.ir) */
const matches = (h, entry) => (entry.startsWith('*.') ? h.length > entry.length - 1 && h.endsWith(entry.slice(1)) : h === entry);
const allowed = (h, hosts) => hosts.some((e) => matches(h, e));
/** حالت پیش‌فرض برای نصب‌هایی که هنوز سابقه‌ی قفل ندارند */
const defaultMode = () => { const m = String(process.env.DOMAIN_LOCK || (config.load() || {}).domainLockMode || 'auto').toLowerCase(); return ['auto', 'manual', 'off'].includes(m) ? m : 'auto'; };

function dbLock() { try { const v = settings.get(KEY); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function fileLock() { try { return config.load().domainLock || null; } catch (_) { return null; } }
const clean = (l) => (l ? { enabled: !!l.enabled, hosts: [...new Set((l.hosts || []).map(normalize).filter(Boolean))], at: l.at || null, by: l.by || null } : null);

/** وضعیت مؤثر قفل */
function state() {
  const f = clean(fileLock()); const d = clean(dbLock());
  const recs = [f, d].filter(Boolean);
  const active = recs.filter((r) => r.enabled && r.hosts.length);
  const hosts = [...new Set(active.flatMap((r) => r.hosts))];
  return { file: f, db: d, recorded: recs.length > 0, enforced: active.length > 0, hosts, active };
}
/** آیا این دامنه مجاز است؟ { ok, bind } — bind یعنی هنوز هیچ قفلی ثبت نشده و باید دامنه‌ی فعلی ثبت شود */
function evaluate(host) {
  const h = normalize(host); const st = state();
  if (!st.recorded) return { ok: true, bind: defaultMode() === 'auto' && !isLoopback(h) };
  if (!st.enforced) return { ok: true, bind: false };
  return { ok: st.active.every((r) => allowed(h, r.hosts)), bind: false };
}

async function write(rec) {
  const val = { enabled: !!rec.enabled, hosts: [...new Set((rec.hosts || []).map(normalize).filter(Boolean))], at: new Date().toISOString(), by: rec.by || null };
  config.update({ domainLock: val });
  await settings.set(KEY, JSON.stringify(val));
  return val;
}
let binding = null;
function bindFirst(host) {
  if (binding) return binding;
  binding = write({ enabled: true, hosts: [normalize(host)], by: 'auto' }).catch(() => {}).finally(() => { binding = null; });
  return binding;
}

/* ---------- صفحه‌ی «دامنه مجاز نیست» ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const hostOf = (req) => normalize(String(req.headers.host || ''));
function token(req, shift = 0) {
  const secret = config.load().sessionSecret || 'x';
  return crypto.createHmac('sha256', secret).update('dl|' + hostOf(req) + '|' + (Math.floor(Date.now() / 3600000) - shift)).digest('hex').slice(0, 32);
}
const tokenOk = (req, t) => !!t && [0, 1].some((s) => { const a = Buffer.from(String(t)); const b = Buffer.from(token(req, s)); return a.length === b.length && crypto.timingSafeEqual(a, b); });

/** محدودیت تلاش اشتباه ورود سوپر ادمین (۵ بار در ۱۰ دقیقه؛ شمارنده در پایگاه‌داده) */
const throttled = async (ip) => (await RL.status('domain_auth', RL.normIp(ip))).locked;
const note = (ip) => RL.fail('domain_auth', RL.normIp(ip), { limit: 5, windowMs: 600000, lockMs: 600000, progressive: false, ip });

function page(req, res, { error = '', ok = '' } = {}) {
  const base = config.load().basePath || '';
  const h = hostOf(req);
  res.status(423).set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>دامنه مجاز نیست</title>
<style>@font-face{font-family:Vazirmatn;src:url(${esc(base)}/assets/fonts/Vazirmatn-Variable.woff2) format('woff2');font-weight:100 900}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;background:#f1f5f9;font-family:Vazirmatn,Tahoma,sans-serif;color:#0f172a}
.c{width:100%;max-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:1.6rem;box-shadow:0 10px 30px rgba(15,23,42,.08)}
h1{font-size:1.15rem;margin:0 0 .5rem}p{line-height:2;color:#475569;margin:.3rem 0}code{direction:ltr;unicode-bidi:embed;background:#f1f5f9;padding:.1rem .45rem;border-radius:6px}
label{display:block;margin:.8rem 0 .25rem;font-size:.9rem}input[type=text],input[type=password]{width:100%;padding:.65rem .8rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit;direction:ltr}
button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:10px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.e{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:.6rem .8rem;border-radius:10px;margin:.8rem 0}.k{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:.6rem .8rem;border-radius:10px;margin:.8rem 0}
details{margin-top:1.2rem;border-top:1px dashed #cbd5e1;padding-top:.8rem}summary{cursor:pointer;color:#2563eb;font-size:.92rem}.r{display:flex;gap:.5rem;align-items:center;margin-top:.7rem;font-size:.9rem}.r input{width:auto}</style></head>
<body><main class="c"><h1>🔒 این سامانه برای دامنه‌ی دیگری قفل شده است</h1>
<p>دامنه‌ی فعلی: <code>${esc(h || 'نامشخص')}</code></p><p>این نصب فقط روی دامنه‌ی ثبت‌شده کار می‌کند. برای اجرا روی دامنه‌ی جدید، «سوپر ادمین» (پشتیبان فنی) باید آن را مجاز کند.</p>
${error ? `<div class="e">${esc(error)}</div>` : ''}${ok ? `<div class="k">${esc(ok)}</div>` : ''}
<details${error ? ' open' : ''}><summary>ورود سوپر ادمین برای مجاز کردن این دامنه</summary>
<form method="post" action="${esc(base)}/_domain/authorize" autocomplete="off"><input type="hidden" name="t" value="${token(req)}">
<label>نام کاربری سوپر ادمین</label><input type="text" name="username" required autocomplete="off">
<label>رمز عبور</label><input type="password" name="password" required autocomplete="off">
<div class="r"><input type="radio" id="m1" name="mode" value="add" checked><label for="m1" style="margin:0">افزودن به دامنه‌های مجاز</label></div>
<div class="r"><input type="radio" id="m2" name="mode" value="replace"><label for="m2" style="margin:0">جایگزینی دامنه‌ی قبلی (انتقال کامل)</label></div>
<button type="submit">مجاز کردن «${esc(h)}»</button></form></details></main></body></html>`);
}

async function authorize(req, res) {
  const b = req.body || {}; const h = hostOf(req); const ip = req.ip || '';
  if (!tokenOk(req, b.t)) return page(req, res, { error: 'نشانه‌ی امنیتی فرم منقضی شده است؛ صفحه را تازه‌سازی کنید.' });
  if (await throttled(ip)) return page(req, res, { error: 'تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید.' });
  const u = await db.get()('users').where({ username: String(b.username || '').toLowerCase(), role: 'superadmin', active: 1 }).first();
  if (!(await svc.verifyAsync(b.password, u && u.password_hash)) || !u) { await note(ip); return page(req, res, { error: 'نام کاربری یا رمز عبور سوپر ادمین نادرست است.' }); }
  if (!validHost(h)) return page(req, res, { error: 'نام دامنه معتبر نیست.' });
  const st = state();
  const hosts = b.mode === 'replace' ? [h] : [...new Set([...st.hosts, h])];
  await write({ enabled: true, hosts, by: u.username });
  try { await db.get()('audit_logs').insert({ user_id: u.id, user_name: u.full_name, action: 'domain_authorize', entity: 'domain', entity_id: h, details: `${b.mode === 'replace' ? 'جایگزینی' : 'افزودن'} دامنه: ${h}`.slice(0, 1000), ip }); } catch (_) { /* ignore */ }
  await RL.clear('domain_auth', RL.normIp(ip));
  res.redirect(303, (config.load().basePath || '') + '/');
}

/** میان‌افزار سراسری (پیش از نشست/ورود) */
function guard(req, res, next) {
  try {
    if (!config.isInstalled()) return next();
    const ev = evaluate(hostOf(req));
    if (ev.ok) { if (ev.bind) bindFirst(hostOf(req)); return next(); }
    if (req.method === 'POST' && req.path === '/_domain/authorize') return authorize(req, res).catch(next);
    return page(req, res);
  } catch (e) { next(e); }
}

/* ---------- مدیریت از پنل سوپر ادمین ---------- */
async function setLock({ enabled, hosts, by }) {
  const list = (hosts || []).map(normalize).filter(Boolean);
  return write({ enabled: !!enabled && list.length > 0, hosts: list, by });
}

module.exports = { normalize, isLoopback, validHost, matches, allowed, defaultMode, state, evaluate, guard, setLock, write, bindFirst, KEY };

'use strict';
/**
 * شمارنده‌ی تلاش‌ها و قفل‌ها در پایگاه‌داده (جدول rate_limits).
 *  - با ری‌استارت برنامه (Passenger/cPanel هر چند دقیقه برنامه را می‌خواباند) و با چند پردازه پاک نمی‌شود.
 *  - افزایش شمارنده اتمی است (UPDATE hits = hits + 1) تا درخواست‌های هم‌زمان از قلم نیفتند.
 *  - قفل پلکانی: هر بار که کسی دوباره قفل شود مدت قفل دو برابر می‌شود (تا سقف تنظیم‌شده)؛ پس از مدتی آرامش، پلکان صفر می‌شود.
 *  - IPهای مورداعتماد (تنظیمات) هرگز شمارش/قفل نمی‌شوند.
 * سطل‌ها (bucket): login_user (IP|نام‌کاربری) · login_ip (کل IP) · otp_verify · otp_ip · otp_ident · domain_auth · super_setup
 */
const db = require('../db');
const settings = require('../settings');

const BUCKETS = {
  login_user: 'ورود — نام کاربری از یک IP', login_ip: 'ورود — کل یک IP', otp_ip: 'درخواست کد پیامکی — IP', otp_ident: 'درخواست کد پیامکی — شناسه',
  domain_auth: 'مجازکردن دامنه', super_setup: 'ساخت سوپر ادمین',
};
/** سطل‌هایی که مدیر مدرسه هم می‌تواند ببیند و باز کند (بقیه فقط سوپر ادمین) */
const ADMIN_BUCKETS = ['login_user', 'login_ip', 'otp_ip', 'otp_ident'];
const T = () => db.get()('rate_limits');
const now = () => Date.now();
let lastWarn = 0;
/** شکست ثبت قفل نباید ورود را از کار بیندازد (fail-open)؛ ولی بی‌صدا هم نباشد: حداکثر دقیقه‌ای یک بار در لاگ می‌آید */
const warn = (e) => { if (Date.now() - lastWarn > 60000) { lastWarn = Date.now(); console.error('[ratelimit] خطای پایگاه‌داده (قفل موقتاً غیرفعال):', e && e.message); } };
const num = (v) => Number(v) || 0;
const normIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

function trustedList() { return String(settings.get('lock_trusted_ips') || '').split(/[\s,;،]+/).map(normIp).filter(Boolean); }
const isTrusted = (ip) => { const l = trustedList(); return l.length > 0 && l.includes(normIp(ip)); };

async function row(bucket, key) { return T().where({ bucket, key: String(key).slice(0, 160) }).first(); }
async function ensure(bucket, key, t) {
  try { await T().insert({ bucket, key, hits: 0, strikes: 0, window_start: t, locked_until: 0, last_at: t }); } catch (_) { /* قبلاً ساخته شده (یکتا) */ }
}
const view = (r, t = now()) => (r && num(r.locked_until) > t ? { locked: true, until: num(r.locked_until), seconds: Math.ceil((num(r.locked_until) - t) / 1000), minutes: Math.max(1, Math.ceil((num(r.locked_until) - t) / 60000)) } : { locked: false, seconds: 0, minutes: 0 });

/** آیا این کلید قفل است؟ */
async function status(bucket, key) {
  try { return view(await row(bucket, String(key).slice(0, 160))); } catch (e) { warn(e); return { locked: false, seconds: 0, minutes: 0 }; }
}

/**
 * ثبت یک تلاش ناموفق. opts: { limit, windowMs, lockMs, ip, meta, progressive, maxLockMs, strikeResetMs }
 * خروجی: { locked, minutes, seconds, hits, strikes }
 */
async function fail(bucket, key, opts = {}) {
  key = String(key).slice(0, 160);
  if (opts.ip && isTrusted(opts.ip)) return { locked: false, minutes: 0, seconds: 0, hits: 0, strikes: 0, trusted: true };
  try {
    const limit = Math.max(1, opts.limit || 5); const windowMs = opts.windowMs || 15 * 60000; const lockMs = opts.lockMs || 10 * 60000;
    const progressive = opts.progressive !== undefined ? opts.progressive : settings.bool('lock_progressive');
    const maxLockMs = opts.maxLockMs || (settings.num('lock_max_minutes') || 1440) * 60000;
    const strikeResetMs = opts.strikeResetMs || (settings.num('lock_strike_reset_hours') || 24) * 3600000;
    const t = now(); await ensure(bucket, key, t);
    let r = await row(bucket, key);
    if (num(r.locked_until) > t) return { ...view(r, t), hits: r.hits, strikes: r.strikes };
    const patch = { last_at: t };
    if (t - num(r.window_start) > windowMs) { await T().where({ id: r.id, window_start: r.window_start }).update({ hits: 0, window_start: t }); }
    if (r.strikes && t - num(r.last_at) > strikeResetMs) await T().where({ id: r.id }).update({ strikes: 0 });
    await T().where({ id: r.id }).update({ hits: db.get().raw('hits + 1'), ...patch, ...(opts.meta ? { meta: String(opts.meta).slice(0, 120) } : {}) });
    r = await row(bucket, key);
    if (r.hits >= limit) {
      const strikes = r.strikes + 1; const mult = progressive ? Math.pow(2, strikes - 1) : 1; const dur = Math.min(lockMs * mult, Math.max(lockMs, maxLockMs));
      await T().where({ id: r.id }).update({ hits: 0, strikes, locked_until: t + dur, window_start: t, last_at: t });
      r = await row(bucket, key);
      if (opts.onLock) { try { await opts.onLock({ bucket, key, minutes: Math.ceil(dur / 60000), strikes, meta: opts.meta }); } catch (_) { /* اعلان اختیاری */ } }
      return { ...view(r, t), hits: 0, strikes };
    }
    return { locked: false, minutes: 0, seconds: 0, hits: r.hits, strikes: r.strikes };
  } catch (e) { warn(e); return { locked: false, minutes: 0, seconds: 0, hits: 0, strikes: 0 }; }
}

/** شمارنده‌ی ساده‌ی پنجره‌ای (برای محدودیت تعداد درخواست): { ok, retryMs } */
async function hit(bucket, key, { windowMs, limit, ip }) {
  key = String(key).slice(0, 160);
  if (ip && isTrusted(ip)) return { ok: true, retryMs: 0 };
  try {
    const t = now(); await ensure(bucket, key, t);
    let r = await row(bucket, key);
    if (t - num(r.window_start) >= windowMs) { await T().where({ id: r.id, window_start: r.window_start }).update({ hits: 0, window_start: t }); r = await row(bucket, key); }
    if (r.hits >= limit) return { ok: false, retryMs: Math.max(0, num(r.window_start) + windowMs - t) };
    await T().where({ id: r.id }).update({ hits: db.get().raw('hits + 1'), last_at: t });
    return { ok: true, retryMs: 0, hits: r.hits + 1 };
  } catch (e) { warn(e); return { ok: true, retryMs: 0 }; }
}

async function clear(bucket, key) { try { await T().where({ bucket, key: String(key).slice(0, 160) }).del(); } catch (_) { /* ignore */ } }

/** فهرست قفل‌های فعال (و اختیاری: شمارنده‌های در جریان) */
async function listLocked({ buckets, withHits = false } = {}) {
  const t = now(); const q = T().orderBy('locked_until', 'desc').limit(300);
  if (buckets) q.whereIn('bucket', buckets);
  q.where((w) => { w.where('locked_until', '>', t); if (withHits) w.orWhere('hits', '>', 0); });
  return (await q).map((r) => ({ id: r.id, bucket: r.bucket, label: BUCKETS[r.bucket] || r.bucket, key: r.key, hits: r.hits, strikes: r.strikes, meta: r.meta, ...view(r, t), lastAt: num(r.last_at) }));
}
async function unlock(id, { buckets } = {}) {
  const q = T().where({ id }); if (buckets) q.whereIn('bucket', buckets);
  return q.del();
}
async function unlockAll({ buckets } = {}) { const q = T(); if (buckets) q.whereIn('bucket', buckets); return q.del(); }
/** پاک‌سازی ردیف‌های بی‌اثر (قفل تمام‌شده و بی‌فعالیت بیش از بازه‌ی آرامش) */
async function purge() {
  const t = now(); const reset = (settings.num('lock_strike_reset_hours') || 24) * 3600000;
  return T().where('locked_until', '<', t).where('last_at', '<', t - reset).del();
}
async function counts() {
  const t = now();
  const locked = Number((await T().where('locked_until', '>', t).count({ c: '*' }).first()).c);
  const total = Number((await T().count({ c: '*' }).first()).c);
  return { locked, total };
}

/** ---- کمک‌های ورود (استفاده در routes/auth) ---- */
const loginParams = () => {
  const max = settings.num('max_login_attempts') || 5;
  return { limit: max, ipLimit: max * (settings.num('lock_ip_multiplier') || 5), windowMs: (settings.num('lock_window_minutes') || 15) * 60000, lockMs: (settings.num('lockout_minutes') || 10) * 60000 };
};
/** قفل بودن ورود برای (IP، نام‌کاربری): دقیقه‌ی باقی‌مانده یا ۰ */
async function loginLocked(ip, user) {
  if (isTrusted(ip)) return 0;
  const [a, b] = await Promise.all([status('login_user', normIp(ip) + '|' + user), status('login_ip', normIp(ip))]);
  return Math.max(a.minutes, b.minutes);
}
async function loginFail(ip, user, onLock) {
  const p = loginParams(); ip = normIp(ip);
  const base = { windowMs: p.windowMs, lockMs: p.lockMs, ip, onLock };
  const a = await fail('login_user', ip + '|' + user, { ...base, limit: p.limit, meta: user });
  const b = await fail('login_ip', ip, { ...base, limit: p.ipLimit, meta: 'all' });
  return { locked: a.locked || b.locked, minutes: Math.max(a.minutes || 0, b.minutes || 0), attemptsLeft: a.locked ? 0 : Math.max(0, p.limit - (a.hits || 0)) };
}
const loginOk = (ip, user) => clear('login_user', normIp(ip) + '|' + user);

module.exports = { BUCKETS, ADMIN_BUCKETS, status, fail, hit, clear, listLocked, unlock, unlockAll, purge, counts, isTrusted, normIp, loginLocked, loginFail, loginOk, loginParams };

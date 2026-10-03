'use strict';
/**
 * کد یکبارمصرف پیامکی برای «فراموشی رمز عبور» و «ورود اولیا بدون رمز».
 *  - کد ۶ رقمی تصادفی (crypto.randomInt)، ذخیره‌ی HMAC (نه متن کد)، اعتبار محدود، حداکثر ۵ تلاش، یک‌بارمصرف
 *  - ارسال با الگوی (Pattern) اختصاصی ippanel
 *  - پاسخ یکسان برای کاربر موجود/ناموجود (جلوگیری از شناسایی حساب‌ها)
 *  - محدودیت: ۶۰ ثانیه فاصله‌ی ارسال، ۵ کد در ساعت برای هر کاربر، ۳۰ درخواست در ساعت برای هر IP
 */
const crypto = require('crypto');
const db = require('../db');
const settings = require('../settings');
const sms = require('./sms');
const config = require('../config');
const { toEn } = require('../utils/fa');

const MAX_ATTEMPTS = 5; const COOLDOWN_MS = 60 * 1000; const PER_USER_HOUR = 5; const PER_IP_HOUR = 30;
const ipHits = new Map(); const identHits = new Map();
setInterval(() => { const n = Date.now(); for (const m of [ipHits, identHits]) for (const [k, v] of m) if (v.filter((t) => n - t < 3600000).length === 0) m.delete(k); }, 600000).unref();

const ttlMs = () => (settings.num('otp_ttl_minutes') || 5) * 60000;
const nowStr = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);
/** آیا قابلیت در دسترس است؟ (پیامک فعال + OTP روشن + برای سرویس واقعی کد الگو) */
function available() {
  const c = sms.config();
  if (!c.enabled || !settings.bool('sms_otp_enabled')) return false;
  return c.provider !== 'ippanel' || !!settings.get('sms_otp_pattern');
}
const parentLoginOn = () => available() && settings.bool('sms_otp_parent_login');

const hmac = (uid, purpose, code) => crypto.createHmac('sha256', String(config.load().sessionSecret || 'dev-secret')).update(`${uid}|${purpose}|${code}`).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function hit(map, key, windowMs, limit) {
  const n = Date.now(); const arr = (map.get(key) || []).filter((t) => n - t < windowMs);
  if (arr.length >= limit) { map.set(key, arr); return false; }
  arr.push(n); map.set(key, arr); return true;
}

/** پیدا کردن حساب بر اساس نام کاربری یا شماره‌ی موبایل */
async function findUser(identifier, purpose) {
  const k = db.get(); const raw = toEn(String(identifier || '')).trim().toLowerCase(); if (!raw) return null;
  let u = await k('users').whereRaw('lower(username) = ?', [raw]).first();
  if (!u) {
    const e = sms.toE164(raw);
    if (e) { const tail = e.slice(3); const cands = await k('users').where('phone', 'like', '%' + tail).orderBy('id').limit(10); u = cands.find((c) => sms.toE164(c.phone) === e) || null; }
  }
  if (!u || !u.active) return null;
  if (purpose === 'login' && u.role !== 'parent') return null;
  return u;
}
/** شماره‌ی دریافت کد: موبایل خود کاربر؛ برای دانش‌آموز، موبایل پدر/مادر/سرپرست */
async function phoneFor(u) {
  let e = sms.toE164(u.phone); if (e) return e;
  if (u.role === 'student') {
    const s = await db.get()('students').where({ user_id: u.id }).first();
    if (s) { for (const p of [s.father_phone, s.mother_phone, s.guardian_phone]) { e = sms.toE164(p); if (e) return e; } }
  }
  return null;
}
const mask = (e) => (e ? '0' + e.slice(3, 6) + '•••' + e.slice(-3) : '');

/**
 * درخواست کد. همیشه {ok:true} (حتی اگر کاربر وجود نداشته باشد) مگر محدودیت زمانی/آی‌پی.
 * خروجی: { ok, uid, wait?, error?, demoCode? }
 */
async function request(purpose, identifier, ip) {
  if (!available()) return { ok: false, error: 'ارسال کد پیامکی در این مدرسه فعال نیست.' };
  const idKey = purpose + '|' + String(identifier || '').trim().toLowerCase();
  if (!hit(ipHits, ip || '-', 3600000, PER_IP_HOUR)) return { ok: false, error: 'تعداد درخواست‌های شما زیاد بوده است؛ کمی بعد دوباره تلاش کنید.' };
  const last = (identHits.get(idKey) || [])[0];
  if (last && Date.now() - last < COOLDOWN_MS) return { ok: false, wait: Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000), error: 'برای ارسال دوباره‌ی کد کمی صبر کنید.' };
  identHits.set(idKey, [Date.now()]);
  const k = db.get(); const u = await findUser(identifier, purpose);
  if (!u) return { ok: true, uid: 0 };
  const phone = await phoneFor(u); if (!phone) return { ok: true, uid: 0 };
  const hourAgo = nowStr(new Date(Date.now() - 3600000));
  const recent = Number((await k('otp_codes').where({ user_id: u.id }).where('created_at', '>', hourAgo).count({ c: '*' }).first()).c);
  if (recent >= PER_USER_HOUR) return { ok: true, uid: u.id, throttled: true };
  await k('otp_codes').where({ user_id: u.id, purpose }).whereNull('used_at').update({ used_at: nowStr() });
  const code = String(crypto.randomInt(100000, 1000000));
  await k('otp_codes').insert({ user_id: u.id, purpose, code_hash: hmac(u.id, purpose, code), phone, expires_at: nowStr(new Date(Date.now() + ttlMs())), attempts: 0, ip: String(ip || '').slice(0, 60), created_at: nowStr() });
  const param = settings.get('sms_otp_param') || 'code';
  const r = await sms.sendPattern({ to: phone, patternCode: settings.get('sms_otp_pattern'), params: { [param]: code }, event: 'otp', secretKeys: [param] });
  if (!r.ok) { await k('otp_codes').where({ user_id: u.id, purpose }).whereNull('used_at').update({ used_at: nowStr() }); return { ok: false, error: 'ارسال پیامک ناموفق بود. چند دقیقه بعد دوباره تلاش کنید یا با مدرسه تماس بگیرید.' }; }
  const out = { ok: true, uid: u.id, masked: mask(phone) };
  if (r.simulated && settings.bool('otp_demo_show_code')) out.demoCode = code;
  return out;
}

/** بررسی کد. خروجی: { ok } یا { ok:false, error, left? } */
async function verify(purpose, uid, code) {
  const k = db.get(); code = toEn(String(code || '')).replace(/\D/g, '');
  if (!uid || code.length !== 6) return { ok: false, error: 'کد واردشده نادرست یا منقضی است.' };
  const row = await k('otp_codes').where({ user_id: uid, purpose }).whereNull('used_at').orderBy('id', 'desc').first();
  if (!row || row.expires_at < nowStr()) return { ok: false, error: 'کد واردشده نادرست یا منقضی است.' };
  if (row.attempts >= MAX_ATTEMPTS) { await k('otp_codes').where({ id: row.id }).update({ used_at: nowStr() }); return { ok: false, error: 'تعداد تلاش‌ها بیش از حد مجاز بود. کد جدید درخواست کنید.' }; }
  if (!safeEq(hmac(uid, purpose, code), row.code_hash)) {
    await k('otp_codes').where({ id: row.id }).update({ attempts: row.attempts + 1 });
    return { ok: false, error: 'کد واردشده نادرست یا منقضی است.', left: MAX_ATTEMPTS - row.attempts - 1 };
  }
  const n = await k('otp_codes').where({ id: row.id }).whereNull('used_at').update({ used_at: nowStr() });
  return n ? { ok: true } : { ok: false, error: 'کد واردشده نادرست یا منقضی است.' };
}

async function cleanup() { return db.get()('otp_codes').where('created_at', '<', nowStr(new Date(Date.now() - 86400000))).del(); }

module.exports = { available, parentLoginOn, request, verify, cleanup, findUser, phoneFor, mask, _reset: () => { ipHits.clear(); identHits.clear(); } };

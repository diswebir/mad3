'use strict';
/**
 * حساب «سوپر ادمین» (فروشنده/پشتیبان فنی) — بالاتر از مدیر مدرسه.
 * ساخت: ویزارد نصب، اسکریپت scripts/create-super.js، متغیرهای محیطی SUPERADMIN_USER/SUPERADMIN_PASSWORD (هنگام بالا آمدن)،
 * یا صفحه‌ی یک‌بار مصرف /super/setup با توکن فایل data/super-setup.token (برای سامانه‌های قدیمی که هنوز سوپر ادمین ندارند).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const svc = require('../services');

const TOKEN_FILE = () => path.join(config.DATA_DIR, 'super-setup.token');
const validUser = (u) => /^[a-zA-Z0-9._-]{3,30}$/.test(u || '');

async function exists(k) { return !!(await k('users').where({ role: 'superadmin' }).first()); }
async function create(k, { username, password, full_name }) {
  if (!validUser(username)) throw new Error('نام کاربری سوپر ادمین باید ۳ تا ۳۰ نویسه لاتین/عدد باشد.');
  if (!password || String(password).length < 8) throw new Error('رمز عبور سوپر ادمین باید حداقل ۸ نویسه باشد.');
  if (await k('users').where({ username: username.toLowerCase() }).first()) throw new Error('این نام کاربری قبلاً استفاده شده است.');
  const [id] = await k('users').insert({ username: username.toLowerCase(), password_hash: svc.hash(password), role: 'superadmin', full_name: full_name || 'سوپر ادمین', active: 1 });
  return id;
}
function readToken() { try { return fs.readFileSync(TOKEN_FILE(), 'utf8').trim(); } catch (_) { return null; } }
function removeToken() { try { fs.unlinkSync(TOKEN_FILE()); } catch (_) { /* ignore */ } }
function tokenOk(t) {
  const real = readToken(); if (!real || !t) return false;
  const a = Buffer.from(String(t).trim()); const b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** هنگام راه‌اندازی: اگر سوپر ادمین نیست، از env بساز یا توکن راه‌اندازی تولید کن */
async function boot(k) {
  if (await exists(k)) { removeToken(); return 'exists'; }
  const u = process.env.SUPERADMIN_USER; const p = process.env.SUPERADMIN_PASSWORD;
  if (u && p) {
    try { await create(k, { username: u, password: p }); removeToken(); console.log(`[super] حساب سوپر ادمین «${u}» ساخته شد. متغیر SUPERADMIN_PASSWORD را از تنظیمات هاست حذف کنید.`); return 'created'; }
    catch (e) { console.error('[super]', e.message); }
  }
  if (!readToken()) { config.ensureDirs(); fs.writeFileSync(TOKEN_FILE(), crypto.randomBytes(16).toString('hex'), { mode: 0o600 }); }
  console.log('[super] سوپر ادمین تعریف نشده است. توکن راه‌اندازی در فایل data/super-setup.token ذخیره شد؛ سپس /super/setup را باز کنید یا scripts/create-super.js را اجرا کنید.');
  return 'token';
}
module.exports = { exists, create, boot, tokenOk, removeToken, readToken, validUser };

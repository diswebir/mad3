'use strict';
/**
 * ساخت یا تغییر رمز «سوپر ادمین» از خط فرمان.
 *   ساخت (فقط وقتی هنوز سوپر ادمین وجود ندارد):  node scripts/create-super.js <username> <password>
 *   تغییر رمز (نیازمند رمز فعلی):               node scripts/create-super.js --change <current-password> <new-password>
 * بدون SSH: متغیرهای SUPERADMIN_USER و SUPERADMIN_PASSWORD را در Setup Node.js App بگذارید و برنامه را راه‌اندازی مجدد کنید
 * (یا CURRENT_PASSWORD و NEW_PASSWORD برای تغییر رمز؛ سپس «Run JS script ← super:create»). پس از کار، متغیرهای رمز را حذف کنید.
 */
const db = require('../src/db');
const config = require('../src/config');
const svc = require('../src/services');
const SA = require('../src/lib/superadmin');

(async () => {
  const args = process.argv.slice(2);
  if (!config.isInstalled()) { console.log('سامانه هنوز نصب نشده است.'); process.exit(1); }
  const k = db.init(config.load().db);
  const done = async (code, msg) => { console.log(msg); await db.close(); process.exit(code); };
  if (args[0] === '--change' || (!args.length && process.env.NEW_PASSWORD)) {
    const cur = args[0] === '--change' ? args[1] : process.env.CURRENT_PASSWORD; const nw = args[0] === '--change' ? args[2] : process.env.NEW_PASSWORD;
    if (!cur || !nw || nw.length < 8) return done(1, 'استفاده: node scripts/create-super.js --change <رمز-فعلی> <رمز-جدید (حداقل ۸ نویسه)>');
    const u = await k('users').where({ role: 'superadmin' }).first();
    if (!u) return done(1, 'سوپر ادمینی وجود ندارد.');
    if (!svc.verify(cur, u.password_hash)) return done(1, 'رمز فعلی نادرست است.');
    await k('users').where({ id: u.id }).update({ password_hash: svc.hash(nw), active: 1, must_change_password: 0 });
    await svc.killSessions(u.id);
    return done(0, 'رمز سوپر ادمین تغییر کرد.');
  }
  if (await SA.exists(k)) return done(1, 'سوپر ادمین از قبل وجود دارد. برای تغییر رمز: node scripts/create-super.js --change <رمز-فعلی> <رمز-جدید>');
  const username = args[0] || process.env.SUPERADMIN_USER; const password = args[1] || process.env.SUPERADMIN_PASSWORD;
  if (!username || !password) return done(1, 'استفاده: node scripts/create-super.js <username> <password>');
  try { await SA.create(k, { username, password }); SA.removeToken(); } catch (e) { return done(1, e.message); }
  return done(0, `حساب سوپر ادمین «${username.toLowerCase()}» ساخته شد.`);
})().catch((e) => { console.error(e); process.exit(1); });

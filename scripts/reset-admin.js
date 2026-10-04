'use strict';
/** بازنشانی رمز یک کاربر از خط فرمان:  node scripts/reset-admin.js <username> <new-password> */
const db = require('../src/db');
const config = require('../src/config');
const svc = require('../src/services');

(async () => {
  // بدون SSH: متغیرهای RESET_USER و RESET_PASSWORD را در Setup Node.js App بگذارید و «Run JS script ← reset:admin» را بزنید (پس از کار، متغیرها را حذف کنید)
  const [argUser, argPass] = process.argv.slice(2); const username = argUser || process.env.RESET_USER; const password = argPass || process.env.RESET_PASSWORD;
  if (!username || !password || password.length < 8) { console.log('استفاده: node scripts/reset-admin.js <username> <new-password (حداقل ۸ نویسه)>'); process.exit(1); }
  if (!config.isInstalled()) { console.log('سامانه هنوز نصب نشده است.'); process.exit(1); }
  const k = db.init(config.load().db);
  const target = await k('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first();
  if (target && target.role === 'superadmin') { console.log('این حساب «سوپر ادمین» است و با این اسکریپت بازنشانی نمی‌شود. از «node scripts/create-super.js --change» (با رمز فعلی) استفاده کنید.'); await db.close(); process.exit(1); }
  const n = await k('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).update({ password_hash: svc.hash(password), active: 1, must_change_password: 0 });
  console.log(n ? 'رمز با موفقیت تغییر کرد.' : 'کاربری با این نام یافت نشد.');
  await db.close(); process.exit(n ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

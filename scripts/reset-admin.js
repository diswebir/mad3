'use strict';
/** بازنشانی رمز یک کاربر از خط فرمان:  node scripts/reset-admin.js <username> <new-password> */
const db = require('../src/db');
const config = require('../src/config');
const svc = require('../src/services');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) { console.log('استفاده: node scripts/reset-admin.js <username> <new-password (حداقل ۸ نویسه)>'); process.exit(1); }
  if (!config.isInstalled()) { console.log('سامانه هنوز نصب نشده است.'); process.exit(1); }
  const k = db.init(config.load().db);
  const n = await k('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).update({ password_hash: svc.hash(password), active: 1, must_change_password: 0 });
  console.log(n ? 'رمز با موفقیت تغییر کرد.' : 'کاربری با این نام یافت نشد.');
  await db.close(); process.exit(n ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/**
 * رمزنگاری نسخه‌ی پشتیبان پیش از ارسال به بیرون از هاست.
 * قالب فایل: "SMB1" | salt(16) | iv(12) | tag(16) | متن رمزشده (AES-256-GCM). کلید با scrypt از عبارت رمز ساخته می‌شود.
 * بدون عبارت رمز، فایل قابل‌خواندن نیست — عبارت رمز را جای امن دیگری هم نگه دارید (در پشتیبان ذخیره نمی‌شود).
 */
const crypto = require('crypto');
const MAGIC = Buffer.from('SMB1');
const key = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const isEncrypted = (buf) => Buffer.isBuffer(buf) && buf.length > 48 && buf.subarray(0, 4).equals(MAGIC);
function encrypt(buf, pass) {
  if (!pass || String(pass).length < 8) throw new Error('عبارت رمز حداقل ۸ نویسه باشد.');
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(pass, salt), iv); const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
function decrypt(buf, pass) {
  if (!isEncrypted(buf)) throw new Error('فایل رمزنگاری‌شده‌ی این سامانه نیست.');
  if (!pass) throw new Error('عبارت رمز لازم است.');
  const salt = buf.subarray(4, 20); const iv = buf.subarray(20, 32); const tag = buf.subarray(32, 48); const ct = buf.subarray(48);
  try { const d = crypto.createDecipheriv('aes-256-gcm', key(pass, salt), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); } catch (_) { throw new Error('عبارت رمز نادرست است یا فایل آسیب دیده است.'); }
}
module.exports = { encrypt, decrypt, isEncrypted, MAGIC };

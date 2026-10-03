'use strict';
/**
 * تصویر گواهی/مدرک غیبت (موجه یا غیرموجه) — اعتبارسنجی امن فایل بارگذاری‌شده:
 *  ۱) فقط JPG / PNG / WebP (بدون GIF، SVG، PDF و ...)  ۲) حداکثر ۵ مگابایت  ۳) بررسی امضای واقعی فایل (magic bytes) و تطابق با پسوند
 *  ۴) رد فایل‌هایی که کد اسکریپت/HTML/PHP درون خود دارند (polyglot)  ۵) نام تصادفی و پسوند تعیین‌شده از محتوای واقعی (نه از نام کاربر)
 *  ۶) ذخیره خارج از پوشه‌ی عمومی و ارائه فقط از مسیر احراز هویت‌شده با nosniff
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 5 * 1024 * 1024;
const CERT_TYPES = { medical: 'گواهی پزشکی', guardian: 'نامه‌ی ولی/سرپرست', other: 'سایر مدارک' };

function detect(buf) {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const EXT_OK = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' };
const BAD = [/<\?php/i, /<script/i, /<svg/i, /<html/i, /<iframe/i, /javascript:/i, /<!doctype/i];

/** بررسی فایل ذخیره‌شده‌ی multer. خروجی: { ok, ext } یا { ok:false, error } */
function validate(file) {
  if (!file || !file.path) return { ok: false, error: 'فایلی دریافت نشد.' };
  const claimed = EXT_OK[path.extname(file.originalname || '').toLowerCase()];
  if (!claimed) return { ok: false, error: 'تصویر گواهی باید JPG، PNG یا WebP باشد.' };
  let st; try { st = fs.statSync(file.path); } catch (_) { return { ok: false, error: 'فایل بارگذاری‌شده یافت نشد.' }; }
  if (st.size > MAX_BYTES) return { ok: false, error: 'حجم تصویر بیش از ۵ مگابایت است.' };
  if (st.size < 100) return { ok: false, error: 'فایل تصویر خالی یا ناقص است.' };
  const buf = fs.readFileSync(file.path); const real = detect(buf);
  if (!real) return { ok: false, error: 'محتوای فایل یک تصویر معتبر (JPG/PNG/WebP) نیست.' };
  if (real !== claimed) return { ok: false, error: 'پسوند فایل با محتوای واقعی آن مطابقت ندارد.' };
  const text = buf.toString('latin1'); if (BAD.some((re) => re.test(text))) return { ok: false, error: 'فایل شامل محتوای مشکوک (اسکریپت) است و پذیرفته نشد.' };
  return { ok: true, ext: real };
}
/** نام تصادفی با پسوند واقعی؛ فایل را جابه‌جا و مشخصات جدید را در file می‌نویسد */
function finalize(file, ext) {
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext; const dest = path.join(path.dirname(file.path), name);
  fs.renameSync(file.path, dest); file.path = dest; file.filename = name;
  const base = String(file.originalname || '').replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'گواهی';
  file.originalname = base + '.' + ext;
  return file;
}
const isImageName = (n) => /\.(jpg|png|webp)$/i.test(String(n || ''));
const mimeOf = (n) => ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';

module.exports = { validate, finalize, detect, isImageName, mimeOf, MAX_BYTES, CERT_TYPES };

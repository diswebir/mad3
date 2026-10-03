'use strict';
/** QR دانش‌آموز: محتوای «MAD:کد:امضا» با HMAC تا جعل کد توسط دانش‌آموزان ممکن نباشد */
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');

const secret = () => String(config.load().sessionSecret || 'dev-secret');
const sign = (code) => crypto.createHmac('sha256', secret()).update('qr|' + code).digest('hex').slice(0, 8);
const payload = (code) => `MAD:${code}:${sign(code)}`;
/** خروجی: کد دانش‌آموزی یا null (در صورت امضای نامعتبر). ورودی ساده (فقط کد) نیز پذیرفته می‌شود (خواندن دستی). */
function parse(text, { allowPlain = true } = {}) {
  const t = String(text || '').trim();
  const m = /^MAD:([^:]{1,30}):([0-9a-f]{8})$/i.exec(t);
  if (m) {
    const a = Buffer.from(m[2].toLowerCase()); const b = Buffer.from(sign(m[1]));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
  }
  return allowPlain && /^[0-9A-Za-z\-_.]{3,30}$/.test(t) ? t : null;
}
const svg = (text, opts = {}) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', ...opts });
module.exports = { payload, parse, svg, sign };

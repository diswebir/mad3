'use strict';
const FA = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (v) => (v === null || v === undefined ? '' : String(v).replace(/\d/g, (d) => FA[d]));
const toEn = (v) => String(v)
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const normalizeText = (s) => String(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c{2,}/g, '\u200c');
/** عدد با جداکننده هزارگان فارسی */
const money = (n) => toFa(Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
const number = (n, d = 0) => toFa((Number(n) || 0).toFixed(d).replace(/\.0+$/, ''));
/** نرمال‌سازی ورودی کاربر: ارقام فارسی/عربی → لاتین، ی/ک عربی → فارسی، حذف فاصله‌های اضافی */
// اگر متن شامل حرف فارسی/عربی باشد (متن آزاد مثل پیام، توضیح، نشانی) ارقام را همان‌طور که کاربر نوشته حفظ می‌کنیم؛
// فیلدهای عددی/تاریخ/تلفن/کدها (بدون حرف) به ارقام لاتین تبدیل می‌شوند تا اعتبارسنجی درست کار کند.
const HAS_LETTERS = /[\u0600-\u065F\u066E-\u06D3\u06D5\u06FA-\u06FF]/;
function normalizeInput(value) {
  if (typeof value === 'string') return normalizeText(HAS_LETTERS.test(value) ? value : toEn(value)).trim();
  if (Array.isArray(value)) return value.map(normalizeInput);
  if (value && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = normalizeInput(value[k]); return o; }
  return value;
}
/** تبدیل کلیدهای فرم مانند status[12]=present به شیء {status:{12:'present'}} (همیشه شیء؛ هرگز آرایه فشرده) */
function nestKeys(body) {
  const out = {};
  for (const key of Object.keys(body || {})) {
    const m = /^([^\[\]]+)\[([^\[\]]*)\]$/.exec(key);
    if (m) { const o = (out[m[1]] = out[m[1]] && !Array.isArray(out[m[1]]) && typeof out[m[1]] === 'object' ? out[m[1]] : {}); o[m[2]] = body[key]; } else out[key] = body[key];
  }
  return out;
}
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
module.exports = { nestKeys, toFa, toEn, money, number, normalizeInput, normalizeText, esc };

'use strict';
/** تشخیص ساده‌ی مرورگر/سیستم‌عامل از User-Agent برای فهرست دستگاه‌ها (بدون وابستگی) */
function parse(ua) {
  ua = String(ua || '');
  if (!ua) return { browser: 'نامشخص', os: 'نامشخص', mobile: false, label: 'دستگاه نامشخص' };
  let os = 'نامشخص';
  if (/Windows NT 10|Windows NT 11/.test(ua)) os = 'ویندوز'; else if (/Windows/.test(ua)) os = 'ویندوز';
  else if (/Android/.test(ua)) os = 'اندروید'; else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'; else if (/CrOS/.test(ua)) os = 'Chrome OS'; else if (/Linux/.test(ua)) os = 'لینوکس';
  let browser = 'مرورگر';
  if (/Edg\//.test(ua)) browser = 'Edge'; else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'; else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(ua)) browser = 'Firefox'; else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome'; else if (/Safari\//.test(ua)) browser = 'Safari'; else if (/curl|node|undici|python/i.test(ua)) browser = 'ابزار خط فرمان';
  const mobile = /Mobi|Android|iPhone|iPod/.test(ua);
  return { browser, os, mobile, label: `${browser} روی ${os}` };
}
module.exports = { parse };

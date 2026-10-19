'use strict';
/**
 * برنامه‌ی نصب‌شدنی (PWA): مانیفست پویا، Service Worker و صفحه‌ی «آفلاین».
 * ملاحظه‌ی حریم خصوصی: صفحات HTML و داده‌ها هرگز کش نمی‌شوند؛ فقط فایل‌های ثابت (/assets) و صفحه‌ی آفلاین.
 */
const express = require('express');
const config = require('../config');
const settings = require('../settings');
const { VERSION } = require('../version');
const router = express.Router();
const on = () => settings.get('pwa_enabled') !== '0';
const base = () => (config.load().basePath || '').replace(/\/$/, '');

router.get('/manifest.webmanifest', (req, res) => {
  if (!on()) return res.status(404).send('Not found');
  const b = base(); const name = settings.get('school_name') || 'سامانه مدیریت مدرسه'; const col = /^#[0-9a-fA-F]{6}$/.test(settings.get('primary_color') || '') ? settings.get('primary_color') : '#2563eb';
  res.type('application/manifest+json').set('Cache-Control', 'public, max-age=3600').send(JSON.stringify({
    name, short_name: name.length > 14 ? name.slice(0, 14).trim() : name, description: 'سامانه‌ی مدیریت مدرسه — حضور و غیاب، نمرات، تیکت و ارتباط با اولیا',
    id: b + '/', start_url: b + '/?source=pwa', scope: b + '/', display: 'standalone', orientation: 'portrait-primary', dir: 'rtl', lang: 'fa',
    theme_color: col, background_color: '#f8fafc', categories: ['education'],
    icons: [
      { src: `${b}/assets/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${b}/assets/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${b}/assets/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'اعلان‌ها', url: `${b}/notifications`, icons: [{ src: `${b}/assets/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
      { name: 'تیکت‌ها', url: `${b}/tickets`, icons: [{ src: `${b}/assets/icons/icon-192.png`, sizes: '192x192', type: 'image/png' }] },
    ],
  }));
});

router.get('/sw.js', (req, res) => {
  const b = base();
  res.type('text/javascript').set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': b + '/' });
  if (!on()) { // خاموش‌کردن: Service Worker قبلی خودش را حذف می‌کند
    return res.send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x)))).then(()=>self.registration.unregister())));");
  }
  res.send(`'use strict';
const BASE = ${JSON.stringify(b)}; const CACHE = 'school-v${VERSION}'; const OFFLINE = BASE + '/offline';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, BASE + '/assets/fonts/Vazirmatn-Variable.woff2', BASE + '/assets/icons/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') { // صفحه‌ها همیشه از شبکه؛ فقط در قطعی اینترنت صفحه‌ی آفلاین
    e.respondWith(fetch(r).catch(() => caches.match(OFFLINE))); return;
  }
  if (u.pathname.startsWith(BASE + '/assets/')) { // فایل‌های ثابت: ابتدا کش، سپس به‌روزرسانی در پس‌زمینه
    e.respondWith(caches.open(CACHE).then((c) => c.match(r).then((hit) => {
      const net = fetch(r).then((resp) => { if (resp && resp.ok) c.put(r, resp.clone()); return resp; }).catch(() => hit);
      return hit || net;
    })));
  }
});
`);
});

router.get('/offline', (req, res) => {
  const b = base(); const name = settings.get('school_name') || 'سامانه مدیریت مدرسه';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.set('Cache-Control', 'no-cache').type('html').send(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>آفلاین | ${esc(name)}</title>
<style>@font-face{font-family:Vazirmatn;src:url(${b}/assets/fonts/Vazirmatn-Variable.woff2) format('woff2');font-weight:100 900}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Vazirmatn,Tahoma,sans-serif;background:#f8fafc;color:#0f172a;text-align:center;padding:1.5rem}.b{max-width:420px}.i{width:84px;height:84px;margin:0 auto 1rem;border-radius:24px;background:#2563eb14;display:grid;place-items:center;font-size:2.4rem}h1{font-size:1.3rem;margin:.2rem 0 .6rem}p{color:#475569;line-height:1.9;margin:0 0 1.2rem}a{display:inline-block;background:#2563eb;color:#fff;padding:.7rem 1.4rem;border-radius:12px;text-decoration:none;font-weight:600}</style></head>
<body><div class="b"><div class="i">📡</div><h1>اتصال اینترنت برقرار نیست</h1><p>${esc(name)} برای نمایش اطلاعات به اینترنت نیاز دارد. اتصال خود را بررسی کنید و دوباره تلاش کنید. اطلاعات شما در این دستگاه ذخیره نشده و امن است.</p><a href="${b}/">تلاش دوباره</a></div></body></html>`);
});
module.exports = router;

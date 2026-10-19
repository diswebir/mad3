/* ثبت Service Worker و دکمه‌ی «نصب برنامه» */
(function () {
  var s = document.currentScript; var base = (s && s.getAttribute('data-base')) || '';
  var btn = document.getElementById('pwa-install'); var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; if (btn) btn.hidden = false; });
  window.addEventListener('appinstalled', function () { if (btn) btn.hidden = true; deferred = null; });
  if (btn) btn.addEventListener('click', function () { if (!deferred) return; deferred.prompt(); deferred.userChoice.then(function () { deferred = null; btn.hidden = true; }); });
  // iOS: نصب فقط از منوی «افزودن به صفحه‌ی اصلی» ممکن است
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
  if (ios && btn) { btn.hidden = false; btn.addEventListener('click', function () { alert('برای نصب: دکمه‌ی «اشتراک‌گذاری» Safari را بزنید و «Add to Home Screen» را انتخاب کنید.'); }); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register(base + '/sw.js', { scope: base + '/' }).catch(function () {}); });
  }
})();

(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var toFa = function (s) { return String(s).replace(/\d/g, function (d) { return FA[d]; }); };
  var toEn = function (s) { return String(s).replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 1776; }).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }); };

  /* منوی موبایل */
  var side = $('#sidebar'), mb = $('#menu-btn');
  if (mb && side) mb.addEventListener('click', function (e) { e.stopPropagation(); side.classList.toggle('open'); });
  document.addEventListener('click', function (e) {
    if (side && side.classList.contains('open') && !side.contains(e.target)) side.classList.remove('open');
    $$('.dropdown.open').forEach(function (d) { if (!d.parentNode.contains(e.target)) d.classList.remove('open'); });
    var t = e.target.closest('[data-dropdown]');
    if (t) { var d = $('.dropdown', t.parentNode); if (d) d.classList.toggle('open'); }
  });

  /* حالت تیره */
  var tt = $('#theme-toggle');
  if (tt) tt.addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch (e) { }
  });

  /* تأیید عملیات خطرناک */
  document.addEventListener('submit', function (e) {
    var m = e.target.getAttribute('data-confirm') || (e.submitter && e.submitter.getAttribute('data-confirm'));
    if (m && !window.confirm(m)) e.preventDefault();
  });
  document.addEventListener('click', function (e) {
    var p = e.target.closest('[data-print]'); if (p) { e.preventDefault(); window.print(); }
    var s = e.target.closest('[data-set-all]');
    if (s) { e.preventDefault(); $$('input[type=radio][value="' + s.getAttribute('data-set-all') + '"]', document.getElementById(s.getAttribute('data-target') || 'att-form') || document).forEach(function (r) { r.checked = true; }); }
    var c = e.target.closest('[data-check-all]');
    if (c) { $$(c.getAttribute('data-check-all')).forEach(function (x) { x.checked = c.checked; }); }
  });
  $$('[data-preset]').forEach(function (sel) { sel.addEventListener('change', function () { var o = sel.options[sel.selectedIndex]; if (!o || !o.dataset.perms) return; var list = JSON.parse(o.dataset.perms); $$('input[name=perm]').forEach(function (c) { c.checked = list.indexOf(c.value) >= 0; }); }); });
  $$('[data-autosubmit]').forEach(function (el) { el.addEventListener('change', function () { el.form.submit(); }); });

  /* ورودی‌های ارقام: تبدیل ارقام فارسی به لاتین هنگام تایپ */
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches && el.matches('input.digits,input.jdate,input[type=text][inputmode=numeric]')) {
      var v = toEn(el.value); if (v !== el.value) el.value = v;
    }
  });

  /* تاریخ‌ساز شمسی */
  var J = window.jalaali;
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function openPicker(input) {
    closePop();
    if (!J) return;
    var now = new Date(), tj = J.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    var m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(input.value);
    var sel = m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    var view = sel ? { y: sel.y, m: sel.m } : { y: tj.jy, m: tj.jm };
    view.y = Math.min(Math.max(view.y, tj.jy - 120), tj.jy + 30);
    pop = document.createElement('div'); pop.className = 'jdate-pop';
    var r = input.getBoundingClientRect();
    pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.innerWidth - 280)) + 'px';
    function render() {
      var ys = '';
      for (var y = Math.min(tj.jy - 70, view.y); y <= Math.max(tj.jy + 6, view.y); y++) ys += '<option value="' + y + '"' + (y === view.y ? ' selected' : '') + '>' + toFa(y) + '</option>';
      var ms = MONTHS.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === view.m ? ' selected' : '') + '>' + n + '</option>'; }).join('');
      var len = J.jalaaliMonthLength(view.y, view.m);
      var g = J.toGregorian(view.y, view.m, 1);
      var first = (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7;
      var h = '<div class="hd"><select data-m>' + ms + '</select><select data-y>' + ys + '</select></div><div class="days">';
      ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].forEach(function (x) { h += '<b>' + x + '</b>'; });
      for (var i = 0; i < first; i++) h += '<span></span>';
      for (var d = 1; d <= len; d++) {
        var cls = (sel && sel.y === view.y && sel.m === view.m && sel.d === d ? 'sel ' : '') + (tj.jy === view.y && tj.jm === view.m && tj.jd === d ? 'td' : '');
        h += '<button type="button" data-d="' + d + '" class="' + cls + '">' + toFa(d) + '</button>';
      }
      pop.innerHTML = h + '</div><div style="margin-top:.4rem;display:flex;justify-content:space-between"><button type="button" class="btn sm" data-today>امروز</button><button type="button" class="btn sm ghost" data-clear>پاک‌کردن</button></div>';
    }
    pop.addEventListener('change', function (e) { if (e.target.matches('[data-m]')) view.m = +e.target.value; if (e.target.matches('[data-y]')) view.y = +e.target.value; render(); });
    pop.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-d')) { input.value = view.y + '/' + pad(view.m) + '/' + pad(+b.getAttribute('data-d')); input.dispatchEvent(new Event('change', { bubbles: true })); closePop(); }
      if (b.hasAttribute('data-today')) { input.value = tj.jy + '/' + pad(tj.jm) + '/' + pad(tj.jd); input.dispatchEvent(new Event('change', { bubbles: true })); closePop(); }
      if (b.hasAttribute('data-clear')) { input.value = ''; closePop(); }
    });
    render(); document.body.appendChild(pop);
  }
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('jdate')) openPicker(e.target); });
  document.addEventListener('click', function (e) { if (pop && !pop.contains(e.target) && !(e.target.classList && e.target.classList.contains('jdate'))) closePop(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });

  /* پیشگیری از ارسال دوباره فرم */
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target; if (f.dataset.busy) { e.preventDefault(); return; }
    f.dataset.busy = '1'; setTimeout(function () { delete f.dataset.busy; }, 4000);
  });

  /* انتخاب گیرنده تیکت */
  var rt = $('#recipient-type');
  if (rt) {
    var sync = function () { $$('[data-rec]').forEach(function (el) { el.classList.toggle('hidden', el.getAttribute('data-rec') !== rt.value); }); };
    rt.addEventListener('change', sync); sync();
  }
  /* محاسبه زنده بدهی/میانگین ها — اعتبارسنجی نمره */
  $$('input.score-in').forEach(function (i) {
    i.addEventListener('input', function () {
      var max = parseFloat(i.getAttribute('max')); var v = parseFloat(i.value);
      i.style.borderColor = (!isNaN(v) && (v < 0 || v > max)) ? 'var(--red)' : '';
    });
  });
})();
/* پر کردن عنوان و متن پیام از قالب انتخاب‌شده */
document.addEventListener('change', function (e) {
  var t = e.target; if (!t || !t.matches || !t.matches('[data-template]')) return;
  var o = t.options[t.selectedIndex]; if (!o || !o.dataset.body) return;
  var f = t.form; if (f.elements.title) f.elements.title.value = o.dataset.title || ''; if (f.elements.body) f.elements.body.value = o.dataset.body;
});
/* صفحه‌ی ثبت ورود با QR: ارسال بدون بارگذاری مجدد + اسکن با دوربین (در صورت پشتیبانی مرورگر) */
(function () {
  var form = document.getElementById('gate-form'); if (!form) return;
  var input = document.getElementById('gate-code'), box = document.getElementById('gate-result'), busy = false;
  function show(ok, msg) { box.hidden = false; box.className = 'alert ' + (ok ? 'success' : 'error'); box.textContent = msg; }
  function send(code) {
    if (busy || !code) return; busy = true;
    var fd = new URLSearchParams(); fd.set('code', code); fd.set('_csrf', form.querySelector('[name=_csrf]').value);
    fetch(form.action, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (j) {
        show(j.ok, j.message);
        if (j.ok && !j.duplicate) { var tb = document.getElementById('gate-recent'); var tr = document.createElement('tr'); [j.time, j.student, j.class || '', j.status === 'late' ? 'تأخیر' : 'حاضر'].forEach(function (t) { var td = document.createElement('td'); td.textContent = t; tr.appendChild(td); }); if (tb.rows.length === 1 && tb.rows[0].cells.length === 1) tb.innerHTML = ''; tb.insertBefore(tr, tb.firstChild); }
      }).catch(function () { show(false, 'ارتباط با سرور برقرار نشد.'); }).then(function () { busy = false; input.value = ''; input.focus(); });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value.trim()); });
  if ('BarcodeDetector' in window && navigator.mediaDevices) {
    var cam = document.getElementById('gate-cam'), video = document.getElementById('gate-video'); cam.hidden = false;
    cam.addEventListener('click', function () {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
        video.srcObject = stream; video.hidden = false; video.play(); var det = new window.BarcodeDetector({ formats: ['qr_code'] }); var last = '';
        (function tick() { det.detect(video).then(function (codes) { if (codes[0] && codes[0].rawValue !== last) { last = codes[0].rawValue; send(last); setTimeout(function () { last = ''; }, 4000); } }).catch(function () {}).then(function () { setTimeout(tick, 400); }); })();
      }).catch(function () { show(false, 'دسترسی به دوربین ممکن نشد.'); });
    });
  }
})();

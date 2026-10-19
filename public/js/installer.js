/* رفتار صفحات ویزارد نصب (بدون وابستگی) */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var fa = function (n) { return String(n).replace(/\d/g, function (d) { return FA[d]; }); };
  var norm = function (v) { return String(v).replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 1632; }); };

  /* نمایش/پنهان رمز */
  $$('[data-toggle-pw]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = document.getElementById(b.getAttribute('data-toggle-pw')); if (!i) return;
      var show = i.type === 'password'; i.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'پنهان کردن رمز' : 'نمایش رمز'); b.style.color = show ? 'var(--primary)' : '';
    });
  });

  /* سنجش قدرت رمز */
  function score(p) {
    if (!p) return 0; var s = 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
    if (/^(.)\1+$/.test(p) || /^(12345|qwert|password|admin)/i.test(p)) s = Math.min(s, 1);
    return Math.min(4, Math.max(p.length < 8 ? 1 : 1, s - (p.length < 8 ? 1 : 0)));
  }
  var LV = [['', 0, 'var(--red)'], ['ضعیف', 25, 'var(--red)'], ['متوسط', 50, '#f59e0b'], ['خوب', 75, '#65a30d'], ['عالی', 100, '#16a34a']];
  $$('[data-strength]').forEach(function (inp) {
    var m = document.getElementById(inp.getAttribute('data-strength')); if (!m) return;
    var bar = $('i', m), lbl = $('span', m), def = lbl.textContent;
    inp.addEventListener('input', function () {
      if (!inp.value) { bar.style.width = '0'; lbl.textContent = def; return; }
      var l = LV[score(inp.value)]; bar.style.width = l[1] + '%'; bar.style.background = l[2]; lbl.textContent = 'قدرت رمز: ' + l[0];
    });
  });

  /* تطبیق تکرار رمز */
  $$('[data-match]').forEach(function (inp) {
    var other = document.getElementById(inp.getAttribute('data-match')); var h = inp.parentNode.querySelector('.match-hint');
    function chk() {
      if (!inp.value) { h.textContent = ''; h.className = 'hint match-hint'; return; }
      var ok = inp.value === other.value; h.textContent = ok ? 'یکسان است ✓' : 'با رمز بالا یکسان نیست'; h.className = 'hint match-hint ' + (ok ? 'good' : 'bad');
    }
    inp.addEventListener('input', chk); other.addEventListener('input', chk);
  });

  /* تولید رمز قوی */
  function gen() {
    var set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', sym = '#@$%!?-_', out = '';
    var buf = new Uint32Array(14); (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 12; i++) out += set[buf[i] % set.length];
    out += sym[buf[12] % sym.length] + (buf[13] % 10);
    return out;
  }
  $$('[data-gen]').forEach(function (b) {
    b.addEventListener('click', function () {
      var ids = b.getAttribute('data-gen').split(','), p = gen();
      ids.forEach(function (id) { var i = document.getElementById(id); if (i) { i.value = p; i.type = 'text'; i.dispatchEvent(new Event('input')); } });
      var t = document.querySelector('[data-toggle-pw="' + ids[0] + '"]'); if (t) t.setAttribute('aria-label', 'پنهان کردن رمز');
      b.textContent = 'رمز ساخته شد — آن را یادداشت کنید'; b.disabled = true;
    });
  });

  /* انتخاب نوع پایگاه‌داده */
  var dbForm = $('#db-form');
  if (dbForm) {
    var paneM = $('#pane-mysql'), paneS = $('#pane-sqlite'), res = $('#test-result');
    var sync = function () {
      var v = ($('input[name=client]:checked', dbForm) || {}).value || 'mysql';
      paneM.hidden = v !== 'mysql'; paneS.hidden = v !== 'sqlite';
      $$('.opt', dbForm).forEach(function (o) { o.classList.toggle('on', $('input', o).checked); });
      $$('input:not([type=hidden]),select', paneM).forEach(function (i) { i.disabled = v !== 'mysql'; });
    };
    $$('input[name=client]', dbForm).forEach(function (r) { r.addEventListener('change', sync); }); sync();
    var show = function (cls, html) { res.hidden = false; res.className = 'iw-test ' + cls; res.innerHTML = html; };
    var esc = function (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    var tb = $('#btn-test');
    tb.addEventListener('click', function (e) {
      e.preventDefault();
      var fd = new URLSearchParams(new FormData(dbForm)); fd.delete('test_only');
      tb.disabled = true; show('wait', 'در حال آزمایش اتصال…');
      fetch(location.pathname.replace(/\/$/, '') + '/test', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: fd.toString(), credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) show('ok', '<b>✓ اتصال موفق</b><ul>' + j.info.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
          else show('bad', '<b>✗ ' + esc(j.error) + '</b>');
        })
        .catch(function () { show('bad', 'ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.'); })
        .then(function () { tb.disabled = false; });
    });
  }

  /* تعداد زنگ و روزها */
  var per = $('#s-periods');
  if (per) $$('.iw-stepper button').forEach(function (b) {
    b.addEventListener('click', function () { var n = Number(norm(per.value)) || 6; n = Math.min(10, Math.max(1, n + Number(b.getAttribute('data-step')))); per.value = fa(n); });
  });
  $$('[data-days]').forEach(function (b) {
    b.addEventListener('click', function () { var on = b.getAttribute('data-days').split(','); $$('input[name=week_days]').forEach(function (c) { c.checked = on.indexOf(c.value) > -1; }); });
  });

  /* ماژول‌ها: جستجو، همه/هیچ، شمارنده */
  var mf = $('#mod-form');
  if (mf) {
    var boxes = $$('input[name=modules]', mf), cnt = $('#mod-count');
    var upd = function () { var n = boxes.filter(function (b) { return b.checked || b.disabled; }).length; cnt.textContent = fa(n) + ' از ' + fa(boxes.length) + ' ماژول فعال'; };
    boxes.forEach(function (b) { b.addEventListener('change', upd); }); upd();
    $$('[data-mods]', mf).forEach(function (b) { b.addEventListener('click', function () { var all = b.getAttribute('data-mods') === 'all'; boxes.forEach(function (c) { if (!c.disabled) c.checked = all; }); upd(); }); });
    var q = $('#mod-q');
    q.addEventListener('input', function () {
      var v = q.value.trim(), any = false;
      $$('.iw-mod', mf).forEach(function (m) { var hit = !v || m.getAttribute('data-name').indexOf(v) > -1; m.classList.toggle('hide', !hit); });
      $$('[data-group]', mf).forEach(function (g) { var has = !!$('.iw-mod:not(.hide)', g); g.classList.toggle('hide', !has); any = any || has; });
      $('#mod-empty').hidden = any;
    });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
  }

  /* کپی */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = (document.getElementById(b.getAttribute('data-copy')) || {}).textContent || '';
      var done = function () { var o = b.innerHTML; b.textContent = 'کپی شد ✓'; setTimeout(function () { b.innerHTML = o; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, done); else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); done(); }
    });
  });

  /* نصب: پوشش پیشرفت و جلوگیری از ارسال دوباره */
  var ff = $('#finish-form');
  if (ff) ff.addEventListener('submit', function () {
    var btn = $('#btn-install'); btn.disabled = true;
    var ov = $('#install-overlay'); ov.hidden = false;
    var li = $$('#install-steps li'), i = 0; li[0].className = 'on';
    var t = setInterval(function () { if (i < li.length - 1) { li[i].className = 'fin'; i++; li[i].className = 'on'; } else clearInterval(t); }, 2500);
  });

})();

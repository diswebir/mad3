/* رفتار راهنمای نصب: زبانه‌ها، انتخاب سیستم‌عامل، علامت گام‌ها (ذخیره در مرورگر)، کپی دستور، جستجوی عیب‌یابی */
(function () {
  'use strict';
  var root = document.getElementById('gd'); if (!root) return;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); };
  var FA = '۰۱۲۳۴۵۶۷۸۹'; var fa = function (n) { return String(n).replace(/\d/g, function (d) { return FA[d]; }); };
  var KEY = 'gd-done-v1'; var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  var store = function () { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ } };

  function show(tab, push) {
    $$('[role=tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
    if (push) { try { history.replaceState(null, '', '#' + tab); } catch (e) { /* ignore */ } }
  }
  $$('[role=tab]').forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-tab'), true); }); });
  var h = (location.hash || '').replace('#', ''); show(['cpanel', 'local', 'fix'].indexOf(h) > -1 ? h : 'cpanel');

  $$('[data-os]').forEach(function (b) {
    b.addEventListener('click', function () {
      var os = b.getAttribute('data-os');
      $$('[data-os]').forEach(function (x) { x.classList.toggle('on', x === b); });
      $$('[data-os-box]').forEach(function (bx) { bx.hidden = bx.getAttribute('data-os-box') !== os; });
    });
  });
  (/Mac|Linux/.test(navigator.platform || '') && !/Win/.test(navigator.platform || '')) && (function () { var b = root.querySelector('[data-os=nix]'); b && b.click(); })();

  function progress(panel) {
    var steps = $$('.gd-step', panel), done = steps.filter(function (s) { return s.classList.contains('done'); }).length;
    var bar = panel.querySelector('[data-prog]'); if (!bar) return;
    bar.firstElementChild.style.width = (steps.length ? Math.round(done / steps.length * 100) : 0) + '%';
    bar.lastElementChild.textContent = fa(done) + ' از ' + fa(steps.length) + ' گام انجام شد';
  }
  $$('.gd-step').forEach(function (s) {
    var id = s.getAttribute('data-step'), cb = s.querySelector('.gd-done input');
    if (saved[id]) { s.classList.add('done'); cb.checked = true; }
    cb.addEventListener('change', function () { s.classList.toggle('done', cb.checked); if (cb.checked) saved[id] = 1; else delete saved[id]; store(); progress(s.closest('[data-panel]')); });
  });
  $$('[data-panel]').forEach(progress);

  $$('.gd-copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.parentNode.querySelector('code').textContent;
      var ok = function () { b.textContent = 'کپی شد ✓'; setTimeout(function () { b.textContent = 'کپی'; }, 1400); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, ok);
      else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove(); ok(); }
    });
  });

  var q = document.getElementById('gd-q');
  if (q) q.addEventListener('input', function () {
    var v = q.value.trim(), n = 0;
    $$('.gd-q').forEach(function (d) { var hit = !v || d.getAttribute('data-text').indexOf(v) > -1; d.hidden = !hit; if (hit) n++; if (v && hit) d.open = true; });
    document.getElementById('gd-none').hidden = n > 0;
  });
})();

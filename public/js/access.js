(function () {
  'use strict';
  var form = document.getElementById('cap-form'); if (!form) return;
  var rows = [].slice.call(form.querySelectorAll('.cap-row'));
  var isUser = !!form.querySelector('.cap-eff');
  function val(r) { var c = r.querySelector('input[type=radio]:checked'); return c ? c.value : 'inherit'; }
  function recalc() {
    var a = 0, d = 0;
    rows.forEach(function (r) {
      var mine = val(r); var def = r.getAttribute('data-def') === '1'; var prof = r.getAttribute('data-prof');
      var on = mine !== 'inherit' ? mine === 'allow' : (prof ? prof === 'allow' : def);
      r.classList.toggle('changed', mine !== 'inherit');
      if (mine === 'allow') a++; if (mine === 'deny') d++;
      var e = r.querySelector('.cap-eff'); if (e) { e.textContent = on ? 'فعال' : 'غیرفعال'; e.className = 'cap-eff badge ' + (on ? 'green' : 'red'); }
    });
    var ca = document.getElementById('cnt-allow'), cd = document.getElementById('cnt-deny');
    if (ca) ca.textContent = a.toLocaleString('fa') + ' مجاز'; if (cd) cd.textContent = d.toLocaleString('fa') + ' ممنوع';
  }
  function filter() {
    var q = (document.getElementById('cap-search').value || '').trim().toLowerCase();
    var ch = document.getElementById('cap-only-changed').checked, hi = document.getElementById('cap-only-high').checked;
    rows.forEach(function (r) {
      var ok = (!q || (r.getAttribute('data-text') || '').toLowerCase().indexOf(q) >= 0) && (!ch || r.classList.contains('changed')) && (!hi || r.getAttribute('data-high') === '1');
      r.classList.toggle('hidden', !ok);
    });
    [].forEach.call(form.querySelectorAll('.cap-group'), function (g) { var any = g.querySelector('.cap-row:not(.hidden)'); g.classList.toggle('hidden', !any); if (q && any) g.open = true; });
  }
  form.addEventListener('change', function (e) { if (e.target.type === 'radio') { recalc(); filter(); } });
  ['cap-search', 'cap-only-changed', 'cap-only-high'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener(id === 'cap-search' ? 'input' : 'change', filter); });
  form.addEventListener('click', function (e) {
    var b = e.target.closest('[data-bulk]'); if (!b) return; e.preventDefault();
    var v = b.getAttribute('data-bulk'); var g = b.closest('.cap-group');
    [].forEach.call(g.querySelectorAll('.cap-row:not(.hidden)'), function (r) { var i = r.querySelector('input[value=' + v + ']'); if (i) i.checked = true; });
    recalc();
  });
  var sel = document.getElementById('profile-select'); var pd = document.getElementById('prof-data');
  if (sel && pd && isUser) {
    var P = {}; try { P = JSON.parse(pd.textContent); } catch (_) { /* */ }
    sel.addEventListener('change', function () {
      var p = P[sel.value] || { allow: [], deny: [] };
      rows.forEach(function (r) {
        var k = r.getAttribute('data-key'); var s = p.allow.indexOf(k) >= 0 ? 'allow' : p.deny.indexOf(k) >= 0 ? 'deny' : '';
        r.setAttribute('data-prof', s); var c = r.querySelector('.cap-prof');
        if (c) c.innerHTML = s === 'allow' ? '<span class="badge green">مجاز</span>' : s === 'deny' ? '<span class="badge red">ممنوع</span>' : '<span class="muted">—</span>';
      });
      recalc();
    });
  }
  recalc();
})();

/* ویرایشگر ساعت زنگ‌ها: ساخت سریع، افزودن/حذف/جابه‌جایی ردیف */
(function () {
  var table = document.querySelector('#bell-table tbody'); if (!table) return;
  var KINDS = { class: 'زنگ درسی', break: 'تفریح', prayer: 'نماز', lunch: 'ناهار' };
  var fa = function (s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); };
  var tm = function (hm) { var m = /^(\d{1,2}):(\d{2})$/.exec(hm); return m ? +m[1] * 60 + +m[2] : NaN; };
  var fmt = function (x) { x = ((x % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
  function rowHtml(kind, label, s, e) {
    var opts = Object.keys(KINDS).map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + KINDS[k] + '</option>'; }).join('');
    return '<td class="ix"></td><td><select name="kind">' + opts + '</select></td><td><input type="text" name="label" maxlength="60" value="' + (label || '') + '"></td><td><input type="text" name="start" class="ltr" value="' + s + '" pattern="[0-9]{1,2}:[0-9]{2}" required></td><td><input type="text" name="end" class="ltr" value="' + e + '" pattern="[0-9]{1,2}:[0-9]{2}" required></td><td><button type="button" class="btn sm" data-up>↑</button> <button type="button" class="btn sm" data-down>↓</button> <button type="button" class="btn sm danger" data-del>✕</button></td>';
  }
  function number() { [].forEach.call(table.rows, function (r, i) { r.querySelector('.ix').textContent = fa(i + 1); }); }
  function addRow(kind, label, s, e) { var tr = document.createElement('tr'); tr.innerHTML = rowHtml(kind, label, s, e); table.appendChild(tr); number(); }
  document.getElementById('add-row').addEventListener('click', function () {
    var last = table.rows[table.rows.length - 1]; var end = last ? tm(last.querySelector('[name=end]').value) : tm('07:45');
    addRow('class', '', fmt(isNaN(end) ? 465 : end), fmt((isNaN(end) ? 465 : end) + 45));
  });
  table.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr'); if (!tr) return;
    if (ev.target.matches('[data-del]')) { tr.remove(); number(); }
    else if (ev.target.matches('[data-up]') && tr.previousElementSibling) { tr.parentNode.insertBefore(tr, tr.previousElementSibling); number(); }
    else if (ev.target.matches('[data-down]') && tr.nextElementSibling) { tr.parentNode.insertBefore(tr.nextElementSibling, tr); number(); }
  });
  document.getElementById('q-apply').addEventListener('click', function () {
    var count = Math.min(12, Math.max(1, +document.getElementById('q-count').value || 6)); var cur = tm(document.getElementById('q-start').value); if (isNaN(cur)) cur = 465;
    var mins = +document.getElementById('q-min').value || 45; var brk = +document.getElementById('q-brk').value || 0;
    var la = +document.getElementById('q-long-after').value || 0; var lk = document.getElementById('q-long-kind').value; var lm = +document.getElementById('q-long-min').value || 20;
    table.innerHTML = '';
    for (var i = 1; i <= count; i++) {
      addRow('class', '', fmt(cur), fmt(cur + mins)); cur += mins;
      if (i < count) { if (la && i === la) { addRow(lk, KINDS[lk], fmt(cur), fmt(cur + lm)); cur += lm; } else if (brk > 0) { addRow('break', KINDS.break, fmt(cur), fmt(cur + brk)); cur += brk; } }
    }
  });
})();

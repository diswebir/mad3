(function () {
  'use strict';
  var form = document.getElementById('plan-form'); if (!form) return;
  var data = {}; try { data = JSON.parse(document.getElementById('plan-data').textContent); } catch (_) { /* */ }
  var body = document.getElementById('plan-body'); var fa = function (n) { return Number(n).toLocaleString('fa'); };
  function rows() { return [].slice.call(body.querySelectorAll('.plan-row')); }
  function clamp(el, d) { var lo = Number(el.min) || 1, hi = Number(el.max) || 99; var v = parseInt(el.value, 10); if (isNaN(v)) v = lo; v += d || 0; el.value = Math.min(hi, Math.max(lo, v)); }
  function recalc() {
    var total = 0, tHours = {};
    rows().forEach(function (r) {
      var removed = r.querySelector('.p-remove').checked; r.classList.toggle('removed', removed);
      var h = parseInt(r.querySelector('.p-hours').value, 10) || 0; var m = r.querySelector('.p-max'); var mv = parseInt(m.value, 10) || 0;
      if (mv > h && h > 0) { m.classList.add('warn'); m.title = 'حداکثر در روز نمی‌تواند از ساعت هفتگی بیشتر باشد؛ هنگام ذخیره اصلاح می‌شود'; } else { m.classList.remove('warn'); m.title = ''; }
      if (!removed) { total += h; var t = r.querySelector('.p-teacher').value; if (t) tHours[t] = (tHours[t] || 0) + h; }
    });
    var st = document.getElementById('sum-total'); if (st) st.textContent = fa(total);
    var bar = document.getElementById('sum-bar'), free = document.getElementById('sum-free');
    if (data.capTotal && bar) { bar.style.width = Math.min(100, Math.round(total * 100 / data.capTotal)) + '%'; bar.className = total > data.capTotal ? 'bad' : ''; free.innerHTML = total > data.capTotal ? '<b style="color:var(--red)">' + fa(total - data.capTotal) + ' ساعت بیش از ظرفیت</b>' : '<span class="muted">' + fa(data.capTotal - total) + ' زنگ خالی می‌ماند</span>'; }
    // بار کاری معلم = بار فعلی در همه‌ی کلاس‌ها − سهم اولیه‌ی این کلاس + سهم جدید
    var orig = {}; Object.keys(data.orig || {}).forEach(function (id) { var o = data.orig[id]; if (o.t) orig[o.t] = (orig[o.t] || 0) + o.h; });
    rows().forEach(function (r) {
      var sel = r.querySelector('.p-teacher'); var note = r.querySelector('.p-tnote'); var t = sel.value; var l = (data.loads || {})[t];
      if (!t || !l) { note.textContent = ''; return; }
      var now = l.hours - (orig[t] || 0) + (tHours[t] || 0);
      if (l.load) { note.textContent = 'بار کل: ' + fa(now) + ' از موظفی ' + fa(l.load) + ' ساعت'; note.style.color = now > l.load ? 'var(--red)' : 'var(--muted)'; }
      else { note.textContent = 'بار کل: ' + fa(now) + ' ساعت در هفته'; note.style.color = 'var(--muted)'; }
    });
  }
  form.addEventListener('click', function (e) {
    var b = e.target.closest('[data-step]'); if (b) { e.preventDefault(); var inp = b.parentNode.querySelector('input'); clamp(inp, parseInt(b.getAttribute('data-step'), 10)); recalc(); }
    var rm = e.target.closest('.new-remove'); if (rm) { e.preventDefault(); rm.closest('tr').remove(); recalc(); }
  });
  form.addEventListener('input', function (e) { if (e.target.matches('input[type=number]')) { recalc(); } });
  form.addEventListener('change', function (e) { if (e.target.matches('input[type=number]')) clamp(e.target, 0); recalc(); });
  var idx = 0; var sel = document.getElementById('add-subject');
  document.getElementById('add-btn').addEventListener('click', function () {
    var o = sel.options[sel.selectedIndex]; if (!o || !o.value) { sel.focus(); return; }
    var empty = document.getElementById('plan-empty'); if (empty) empty.remove();
    var tpl = body.querySelector('.p-teacher'); var teachers = tpl ? tpl.innerHTML.replace(/ selected(="[^"]*")?/g, '') : '<option value="">— بدون معلم —</option>';
    var i = idx++; var h = o.getAttribute('data-hours') || 2;
    var tr = document.createElement('tr'); tr.className = 'plan-row is-new';
    tr.innerHTML = '<td><b></b> <span class="badge blue">جدید</span><input type="hidden" name="add[' + i + '][subject_id]" value="' + o.value + '"></td>' +
      '<td><select name="add[' + i + '][teacher_id]" class="p-teacher">' + teachers + '</select><div class="small p-tnote"></div></td>' +
      '<td class="center"><div class="stepper"><button type="button" data-step="-1">−</button><input type="number" name="add[' + i + '][weekly_hours]" class="p-hours" min="1" max="20" value="' + h + '"><button type="button" data-step="1">+</button></div></td>' +
      '<td class="center"><div class="stepper"><button type="button" data-step="-1">−</button><input type="number" name="add[' + i + '][max_per_day]" class="p-max" min="1" max="6" value="' + Math.min(2, h) + '"><button type="button" data-step="1">+</button></div></td>' +
      (form.querySelector('thead th:nth-child(5)') && form.querySelectorAll('thead th').length === 6 ? '<td class="muted small">هنوز چیده نشده</td>' : '') +
      '<td class="center"><button type="button" class="btn sm ghost new-remove" aria-label="حذف ردیف">✕</button><input type="checkbox" class="p-remove" hidden></td>';
    tr.querySelector('b').textContent = o.text.split(' — ')[0];
    body.appendChild(tr); o.remove(); sel.value = ''; recalc();
  });
  recalc();
})();

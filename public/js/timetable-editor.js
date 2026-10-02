/* ویرایشگر برنامه‌ی هفتگی: پالت درس‌ها، کشیدن‌ورها کردن، رنگ‌بندی و تشخیص تداخل لحظه‌ای (سرور هم دوباره بررسی می‌کند) */
(function () {
  var dataEl = document.getElementById('tt-data'); if (!dataEl) return;
  var D = JSON.parse(dataEl.textContent); var form = document.getElementById('tt-form');
  var COL = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#4d7c0f', '#7c3aed', '#ea580c', '#0f766e', '#64748b'];
  var colorOf = function (id) { return COL[Math.abs(Number(id) || 0) % COL.length]; };
  var fa = function (s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); };
  var cells = [].slice.call(form.querySelectorAll('td.cell[data-d]'));
  var chips = [].slice.call(document.querySelectorAll('.tt-chip'));
  var issuesBox = document.getElementById('tt-issues'); var saveBtn = document.getElementById('tt-save');
  var active = null; // درس انتخاب‌شده در پالت

  function setActive(chip) { active = chip ? chip.getAttribute('data-cs') : null; chips.forEach(function (c) { c.classList.toggle('on', c === chip); }); form.classList.toggle('painting', active !== null); }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () { setActive(active === chip.getAttribute('data-cs') ? null : chip); });
    chip.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', chip.getAttribute('data-cs')); e.dataTransfer.effectAllowed = 'copy'; });
  });
  function setCell(td, val) { var sel = td.querySelector('select'); sel.value = val ? String(val) : ''; if (sel.value !== (val ? String(val) : '')) sel.value = ''; validate(); }
  cells.forEach(function (td) {
    var sel = td.querySelector('select');
    td.addEventListener('click', function (e) { if (e.target.closest('select')) return; if (e.target.classList.contains('tt-x')) { setCell(td, ''); return; } if (active !== null) setCell(td, active === '0' ? '' : active); });
    td.addEventListener('dragover', function (e) { e.preventDefault(); td.classList.add('drop'); });
    td.addEventListener('dragleave', function () { td.classList.remove('drop'); });
    td.addEventListener('drop', function (e) { e.preventDefault(); td.classList.remove('drop'); var v = e.dataTransfer.getData('text/plain'); if (v !== '') setCell(td, v === '0' ? '' : v); });
    td.setAttribute('tabindex', '0');
    td.addEventListener('keydown', function (e) { if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === td) { e.preventDefault(); setCell(td, ''); } });
    sel.addEventListener('change', validate);
  });

  function validate() {
    var hard = []; var soft = []; var perDay = {}; var total = {}; var seenTeacherSlot = {};
    cells.forEach(function (td) { td.classList.remove('bad', 'warn'); td.style.removeProperty('--c'); var m = td.querySelector('.tt-msg'); m.textContent = ''; });
    cells.forEach(function (td) {
      var sel = td.querySelector('select'); var id = sel.value; if (!id) { td.classList.remove('filled'); return; }
      var s = D.subjects[id]; if (!s) return; var d = td.getAttribute('data-d'); var p = td.getAttribute('data-p'); var slot = d + '-' + p; var msg = td.querySelector('.tt-msg');
      td.classList.add('filled'); td.style.setProperty('--c', colorOf(id));
      perDay[id + '|' + d] = (perDay[id + '|' + d] || 0) + 1; total[id] = (total[id] || 0) + 1;
      if (s.teacherId) {
        var busy = D.busy[s.teacherId] && D.busy[s.teacherId][slot]; var off = D.unav[s.teacherId] && D.unav[s.teacherId].indexOf(slot) >= 0;
        if (busy) { td.classList.add('bad'); msg.textContent = 'تداخل: ' + s.teacher + ' در کلاس «' + busy + '»'; hard.push(D.weekdays[d] + ' زنگ ' + fa(p) + ': ' + s.teacher + ' در کلاس «' + busy + '» حضور دارد.'); }
        else if (off) { td.classList.add('bad'); msg.textContent = s.teacher + ' این ساعت را ندارد'; hard.push(D.weekdays[d] + ' زنگ ' + fa(p) + ': ساعت غیرمجازِ ' + s.teacher + '.'); }
      }
    });
    Object.keys(perDay).forEach(function (k) {
      var parts = k.split('|'); var s = D.subjects[parts[0]]; if (s && s.max > 0 && perDay[k] > s.max) {
        hard.push('«' + s.name + '» در ' + D.weekdays[parts[1]] + ' ' + fa(perDay[k]) + ' ساعت شده؛ سقف: ' + fa(s.max) + ' ساعت در روز.');
        cells.forEach(function (td) { if (td.getAttribute('data-d') === parts[1] && td.querySelector('select').value === parts[0]) { td.classList.add('warn'); var m = td.querySelector('.tt-msg'); if (!m.textContent) m.textContent = 'بیش از سقف روزانه'; } });
      }
    });
    chips.forEach(function (c) { var id = c.getAttribute('data-cs'); if (id === '0') return; var cn = c.querySelector('.cn'); var n = total[id] || 0; var h = D.subjects[id].hours; cn.textContent = fa(n) + '/' + fa(h); c.classList.toggle('full', n === h); c.classList.toggle('over', n > h); });
    Object.keys(total).forEach(function (id) { if (total[id] > D.subjects[id].hours) soft.push('«' + D.subjects[id].name + '»: ' + fa(total[id]) + ' ساعت چیده شده، ولی ساعت هفتگی ' + fa(D.subjects[id].hours) + ' است.'); });
    var html = hard.slice(0, 6).map(function (x) { return '<div class="err">⛔ ' + x + '</div>'; }).concat(soft.slice(0, 4).map(function (x) { return '<div class="wrn">⚠ ' + x + '</div>'; })).join('');
    issuesBox.innerHTML = html; issuesBox.classList.toggle('hidden', !html);
    if (saveBtn) { saveBtn.disabled = hard.length > 0; saveBtn.title = hard.length ? 'ابتدا تداخل‌ها را برطرف کنید' : ''; }
  }
  validate();
})();

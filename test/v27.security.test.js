'use strict';
/**
 * تست ۲٫۷ — امنیت داده‌ها: جداسازی دسترسی (IDOR) و فرار (escape) خروجی
 *  - دانش‌آموز/والد پرونده‌ی دانش‌آموز دیگر را نمی‌بینند
 *  - معلم فقط دانش‌آموزان کلاس‌های خودش را می‌بیند
 *  - پرکردن واقعی همه‌ی فرم‌های مدیر با payload اسکریپتی: هیچ ۵۰۰، هیچ HTML خام در هیچ صفحه
 */
const { boot, inproc, t, done, assert } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const svc = require('../src/services');
  const par = await k('users').where({ role: 'parent' }).first();
  await k('users').where({ id: par.id }).update({ password_hash: svc.hash('Parent#12345'), must_change_password: 0 });
  const me = await k('students').where({ student_code: '14050001' }).first();
  const others = await k('students').whereNot({ id: me.id }).limit(6).select('id');
  const sub = (id) => [`/students/${id}`, `/students/${id}/edit`, `/students/${id}/print`, `/students/${id}/card`, `/grades/student/${id}`, `/finance/student/${id}`];

  await t('دانش‌آموز و والد: هیچ‌کدام از صفحات پرونده‌ی دانش‌آموزان دیگر باز نمی‌شود', async () => {
    for (const [u, p] of [['14050001', 'student123'], [par.username, 'Parent#12345']]) {
      const c = await app.login(u, p);
      for (const o of others) for (const path of sub(o.id)) { const r = await c.get(path); assert(r.status !== 200 || !/شماره‌ی دانش‌آموزی|کد ملی/.test(r.text), `${u} → ${path} = ${r.status}`); }
    }
  });

  await t('معلم: پرونده‌ی دانش‌آموزان کلاس‌های دیگر ۲۰۰ نمی‌دهد و کلاس‌های خودش را می‌بیند', async () => {
    const studs = await k('students').select('id', 'classroom_id');
    for (const un of ['t.ahmadi', 'a.taheri']) {
      const u = await k('users').where({ username: un }).first(); const tc = await k('teachers').where({ user_id: u.id }).first();
      const ids = await svc.accessibleClassIds({ ...u, teacher: tc }); const c = await app.login(un, 'teacher123');
      for (const s of studs) for (const p of [`/students/${s.id}`, `/students/${s.id}/print`]) {
        const r = await c.get(p); const allowed = ids.includes(s.classroom_id);
        assert((r.status === 200) === allowed, `${un} ${p}: وضعیت ${r.status} ولی مجاز=${allowed}`);
      }
    }
  });

  await t('XSS ذخیره‌شده: همه‌ی فرم‌های مدیر با payload پر می‌شوند؛ بدون ۵۰۰ و بدون HTML خام', async () => {
    const c = await app.login('admin', 'Admin#12345');
    const skipAct = /logout|delete|remove|destroy|reset|restore|backup|archive|promotion\/apply|cron|offsite|purge|clear|wipe|unlock|import|deactivate|disable|toggle/i;
    const skipUrl = /^\/(logout|cron)|\/download|\.xlsx|\.csv|\.pdf|\/export|\/print|\/files\/|\/qr|\/assets\//;
    const PAY = 'XSS"><img src=x onerror=alert(1)>';
    const seen = new Set(); const pat = {}; const q = ['/']; const bad = []; const done2 = new Set(); let forms = 0;
    while (q.length && seen.size < 400) {
      const url = q.shift(); if (seen.has(url)) continue; const pk = url.replace(/\d+/g, '#'); pat[pk] = (pat[pk] || 0) + 1; if (pat[pk] > 2) continue; seen.add(url);
      const r = await c.get(url); if (r.status >= 400 || !/text\/html/.test(r.headers.get('content-type') || '')) continue;
      for (const m of r.text.matchAll(/<a\b[^>]*\bhref="([^"#]+)"/g)) { const h = c.strip(m[1].replace(/&amp;/g, '&')); if (h.startsWith('/') && !skipUrl.test(h) && !seen.has(h)) q.push(h.replace(/[?&](page|p)=\d+/g, '')); }
      for (const fm of r.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
        if (!/method="post"/i.test(fm[1]) || /enctype="multipart/i.test(fm[1])) continue;
        let act = (/action="([^"]*)"/.exec(fm[1]) || [])[1]; act = act === undefined ? url : c.strip(act.replace(/&amp;/g, '&')); if (!act.startsWith('/') || skipAct.test(act)) continue;
        const body = fm[2]; const sig = act.replace(/\d+/g, '#') + '|' + (body.match(/name="[^"]+"/g) || []).length; if (done2.has(sig)) continue; done2.add(sig);
        const data = {};
        for (const i of body.matchAll(/<input\b([^>]*)>/g)) {
          const a = i[1]; const name = (/name="([^"]*)"/.exec(a) || [])[1]; if (!name) continue; const type = ((/type="([^"]*)"/.exec(a) || [])[1] || 'text').toLowerCase(); const val = (/value="([^"]*)"/.exec(a) || [])[1];
          if (['submit', 'button', 'file', 'image', 'reset'].includes(type)) continue;
          if (type === 'checkbox' || type === 'radio') { if (/\bchecked\b/.test(a)) data[name] = val === undefined ? 'on' : val; else if (type === 'radio' && !(name in data)) data[name] = val; continue; }
          data[name] = val !== undefined && val !== '' ? val.replace(/&amp;/g, '&') : type === 'number' ? '2' : type === 'date' ? '2026-10-19' : type === 'time' ? '08:00' : type === 'email' ? 'a@b.co' : type === 'password' ? 'Xx#12345678' : /date|تاریخ|_at$/.test(name) ? '1405/07/27' : /phone|mobile|tel/.test(name) ? '09121234567' : /amount|price|score|hours|count|number|qty/.test(name) ? '2' : PAY + name;
        }
        for (const s of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) { const name = (/name="([^"]*)"/.exec(s[1]) || [])[1]; if (!name) continue; const sel = /<option[^>]*selected[^>]*value="([^"]*)"/.exec(s[2]) || /<option[^>]*value="([^"]*)"[^>]*selected/.exec(s[2]); const opts = [...s[2].matchAll(/<option[^>]*value="([^"]*)"/g)].map((x) => x[1]).filter((x) => x !== ''); data[name] = sel ? sel[1] : (opts[0] || ''); }
        for (const ta of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) { const name = (/name="([^"]*)"/.exec(ta[1]) || [])[1]; if (name) data[name] = ta[2].trim() || PAY; }
        forms++;
        const res = await c.req('POST', act, data, { follow: false, headers: { referer: app.base + url } });
        if (res.status >= 500 || /خطای سرور/.test(res.text || '')) bad.push(`${res.status} ${act}`);
      }
    }
    assert(forms > 40, 'تعداد فرم‌های آزموده‌شده کم است: ' + forms);
    assert.deepStrictEqual(bad, [], 'خطای سرور: ' + bad.join(' ; '));
    let stored = 0; const tabs = await k.raw("select name from sqlite_master where type='table'").catch(() => null);
    if (tabs) for (const n of (Array.isArray(tabs[0]) ? tabs[0] : tabs).map((r) => r.name)) { try { const rows = await k(n).select('*'); if (rows.some((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes('onerror=alert(1)')))) stored++; } catch (e) { /* */ } }
    if (tabs) assert(stored >= 5, 'payload در پایگاه‌داده ذخیره نشد؛ آزمون بی‌اثر است: ' + stored);
    const raw = [];
    for (const u of seen) { const r = await c.get(u); if (r.status >= 400) continue; if (/<img src=x onerror=alert\(1\)>/.test(r.text.replace(/<script[\s\S]*?<\/script>/g, ''))) raw.push(u); }
    assert.deepStrictEqual(raw, [], 'HTML خام در: ' + raw.join(' '));
  });

  await app.stop(); process.exit(done() ? 0 : 1);
})();

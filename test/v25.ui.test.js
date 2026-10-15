'use strict';
/** تست نسخه‌ی ۲٫۵ — رندر صفحه‌ها در نقش‌های مختلف و رفت‌وبرگشت واقعیِ فرم‌ها (همان فیلدهای HTML که مرورگر می‌فرستد) */
const { boot, t, done, assert, inproc, unesc } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const admin = await app.login('admin', 'Admin#12345'); const teach = await app.login('t.ahmadi', 'teacher123'); const dep = await app.login('deputy', 'deputy123');
  const tUser = (await k('users').where({ username: 't.ahmadi' }).first()).id;
  const cid = (await k('class_subjects').whereNotNull('teacher_id').first()).classroom_id;
  const tid = (await k('teachers').first()).id;

  /** همه‌ی فیلدهای یک <form> (با شناسه یا اکشن) را مانند مرورگر جمع می‌کند */
  const scrape = (html, marker) => {
    const i = html.indexOf(marker); assert.ok(i >= 0, 'فرم پیدا نشد: ' + marker);
    const start = html.lastIndexOf('<form', i); const end = html.indexOf('</form>', i); const f = html.slice(start, end);
    const form = {};
    for (const m of f.matchAll(/<input\b([^>]*)>/g)) { const a = m[1]; const name = (/name="([^"]*)"/.exec(a) || [])[1]; if (!name) continue; const type = (/type="([^"]*)"/.exec(a) || [])[1] || 'text'; if (['checkbox', 'radio'].includes(type) && !/\bchecked\b/.test(a)) continue; if (type === 'submit' || type === 'button') continue; form[name] = unesc((/value="([^"]*)"/.exec(a) || [])[1] || (type === 'checkbox' ? 'on' : '')); }
    for (const s of f.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) { const name = (/name="([^"]*)"/.exec(s[1]) || [])[1]; if (!name) continue; const sel = /<option value="([^"]*)"[^>]*\bselected/.exec(s[2]) || /<option value="([^"]*)"/.exec(s[2]); form[name] = sel ? unesc(sel[1]) : ''; }
    return form;
  };
  const errPage = (r) => /خطای سرور|ReferenceError|TypeError|SyntaxError/.test(r.text.slice(0, 4000)) ? r.text.replace(/<[^>]+>/g, ' ').slice(0, 300) : '';

  console.log('● رندر صفحه‌ها');
  await t('مدیر: همه‌ی صفحه‌های تازه و تغییر‌یافته بدون خطا باز می‌شوند', async () => {
    const urls = ['/access', `/access/user/${tUser}`, '/access/profiles/new', `/classes/${cid}`, `/classes/${cid}/curriculum`, '/classes', `/teachers/${tid}`, '/teachers', '/users', `/users/${(await k('users').where({ role: 'deputy' }).first()).id}/edit`, `/timetable?class_id=${cid}`, `/timetable?class_id=${cid}&edit=1`, '/grades', '/calendar', '/calendar?view=week', '/events', '/finance', '/hr'];
    const prof = await k('access_profiles').first(); if (prof) urls.push(`/access/profiles/${prof.id}/edit`);
    for (const u of urls) { const r = await admin.get(u); assert.ok([200, 302].includes(r.status), `${u} → ${r.status}`); assert.ok(!errPage(r), `${u}: ${errPage(r)}`); }
  });
  await t('معاون و معلم (بدون و با مجوز): صفحه‌های کلاس/برنامه/نمرات/تقویم بدون خطا', async () => {
    await admin.post('/access/user/' + tUser, { 'cap[classes.curriculum]': 'allow', 'cap[timetable.edit]': 'allow', 'cap[events.view]': 'allow', 'cap[events.create]': 'allow', 'cap[grades.assess.create]': 'allow' }, '/access/user/' + tUser);
    for (const [c, u] of [[dep, `/classes/${cid}`], [dep, `/classes/${cid}/curriculum`], [dep, '/timetable?edit=1'], [teach, `/classes/${cid}`], [teach, `/classes/${cid}/curriculum`], [teach, `/timetable?class_id=${cid}&edit=1`], [teach, '/grades'], [teach, '/calendar'], [teach, '/calendar?view=week'], [teach, '/events'], [teach, '/events/new']]) {
      const r = await c.get(u); assert.ok([200, 302, 403].includes(r.status), `${u} → ${r.status}`); assert.ok(!errPage(r), `${u}: ${errPage(r)}`);
    }
    await admin.post('/access/user/' + tUser + '/reset', {}, '/access/user/' + tUser);
  });

  console.log('● رفت‌وبرگشت واقعی فرم‌ها');
  await t('برنامه‌ریز: فرمِ خام صفحه (بدون هیچ تغییر) ذخیره می‌شود و چیزی را خراب نمی‌کند؛ تغییر یک ساعت در فرم اعمال می‌شود', async () => {
    const before = await k('class_subjects').where({ classroom_id: cid }).orderBy('id');
    const page = await admin.get(`/classes/${cid}/curriculum`); const form = scrape(page.text, 'id="plan-form"'); assert.ok(Object.keys(form).filter((x) => x.startsWith('rows[')).length >= before.length * 3, 'فیلدهای ردیف‌ها: ' + Object.keys(form).length);
    let r = await admin.req('POST', `/classes/${cid}/curriculum`, form); assert.ok(r.status < 400);
    assert.deepStrictEqual((await k('class_subjects').where({ classroom_id: cid }).orderBy('id')).map((x) => [x.id, x.weekly_hours, x.teacher_id]), before.map((x) => [x.id, x.weekly_hours, x.teacher_id]));
    const first = before[0]; form[`rows[${first.id}][weekly_hours]`] = String(Math.min(20, first.weekly_hours + 1)); form[`rows[${first.id}][max_per_day]`] = '1';
    r = await admin.req('POST', `/classes/${cid}/curriculum`, form);
    const a = await k('class_subjects').where({ id: first.id }).first(); assert.strictEqual(a.weekly_hours, Math.min(20, first.weekly_hours + 1)); assert.strictEqual(a.max_per_day, 1);
  });
  await t('ماتریس دسترسی: فرمِ خامِ صفحه‌ی یک معلم بدون تغییر ذخیره می‌شود و وضعیت را عوض نمی‌کند؛ با یک تیک جدید همان یک مجوز اضافه می‌شود', async () => {
    const page = await admin.get('/access/user/' + tUser); const form = scrape(page.text, 'name="cap[');
    const row0 = await k('users').where({ id: tUser }).first();
    await admin.req('POST', '/access/user/' + tUser, form); assert.deepStrictEqual((await k('users').where({ id: tUser }).first()).caps || null, row0.caps || null);
    form['cap[events.create]'] = 'allow'; const r = await admin.req('POST', '/access/user/' + tUser, form); assert.ok(r.status < 400);
    const caps = require('../src/lib/caps'); const u = await k('users').where({ id: tUser }).first(); assert.ok(caps.parseOv(u.caps).allow.includes('events.create')); assert.strictEqual(caps.parseOv(u.caps).allow.length + caps.parseOv(u.caps).deny.length, 1, 'فقط همان یک مجوز');
    await admin.post('/access/user/' + tUser + '/reset', {}, '/access/user/' + tUser);
  });
  await t('فرم تخصیص درس در صفحه‌ی معلم و فرم سقف‌ها با فیلدهای واقعی کار می‌کنند', async () => {
    const page = await admin.get('/teachers/' + tid); const lf = scrape(page.text, 'name="daily_max"'); lf.daily_max = '6'; lf.weekly_load = '18';
    await admin.req('POST', `/hr/teacher/${tid}/load`, lf); const tr = await k('teachers').where({ id: tid }).first(); assert.strictEqual(tr.daily_max, 6); assert.strictEqual(tr.weekly_load, 18);
    const af = scrape(page.text, 'name="classroom_id"'); assert.ok('classroom_id' in af || 'subject_id' in af, 'فیلدهای فرم تخصیص');
  });
  await t('اسکریپت‌ها و استایل‌های تازه در دسترس‌اند', async () => { for (const u of ['/assets/js/curriculum.js', '/assets/js/access.js', '/assets/css/app.css']) { const r = await admin.get(u); assert.strictEqual(r.status, 200, u); } });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

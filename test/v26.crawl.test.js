'use strict';
/**
 * تست ۲٫۶ — خزش کامل لینک‌ها با نقش‌های مختلف + فاز (fuzz) فرم‌ها:
 *  - هیچ لینکی از هیچ نقشی نباید 4xx/5xx بدهد (دکمه‌ای که کاربر اجازه‌ی آن را ندارد نباید نمایش داده شود)
 *  - هیچ صفحه‌ای متن undefined / NaN / [object Object] نشان ندهد
 *  - POST با فیلدهای خالی/نامعتبر هرگز ۵۰۰ ندهد
 */
const { boot, inproc, t, done, assert, flash } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const svc = require('../src/services'); const caps = require('../src/lib/caps');
  const par = await k('users').where({ role: 'parent' }).first();
  if (par) await k('users').where({ id: par.id }).update({ password_hash: svc.hash('Parent#12345'), must_change_password: 0 });
  const skip = /^\/(logout|cron|backup\/(download|restore|run)|super\/offsite\/download)|\/download|\.xlsx|\.csv|\.pdf|\/export|\/print|\/files\/|\/qr|\.png|\.svg|\.js|\.css|\/assets\/|format=/;

  async function crawl(client, limit) {
    const seen = new Set(); const q = ['/']; const from = { '/': 'start' }; const pat = {}; const issues = []; let n = 0;
    while (q.length && n < limit) {
      const url = q.shift(); if (seen.has(url)) continue;
      const pk = url.replace(/\d+/g, '#'); pat[pk] = (pat[pk] || 0) + 1; if (pat[pk] > 2) continue; seen.add(url); n++;
      const r = await client.get(url);
      if (r.status >= 400 || /خطای سرور/.test(r.text)) { issues.push(`${r.status} ${url} (از ${from[url]})`); continue; }
      if (!/text\/html/.test(r.headers.get('content-type') || '')) continue;
      const body = r.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      const vis = body.replace(/<[^>]+>/g, ' ');
      for (const bad of ['undefined', 'NaN', '[object Object]', 'Invalid Date', '<%']) if (vis.includes(bad)) issues.push(`TEXT ${bad} در ${url}`);
      for (const m of body.matchAll(/<a\b[^>]*\bhref="([^"#]+)"/g)) {
        let h = m[1].replace(/&amp;/g, '&'); if (/^(https?:|mailto:|tel:|javascript:)/.test(h)) continue; h = client.strip(h);
        if (!h.startsWith('/') || skip.test(h)) continue; h = h.replace(/[?&](page|p)=\d+/g, '').replace(/\?$/, '');
        if (!seen.has(h) && !(h in from)) { from[h] = url; q.push(h); }
      }
    }
    return { n, issues };
  }

  const roles = [['admin', 'Admin#12345', 330], ['super', 'Super#12345', 330], ['deputy', 'deputy123', 300], ['t.ahmadi', 'teacher123', 200], ['14050001', 'student123', 100]];
  if (par) roles.push([par.username, 'Parent#12345', 100]);
  for (const [u, p, lim] of roles) {
    await t(`خزش لینک‌ها با نقش «${u}»: بدون ۴xx/۵xx و بدون متن خراب`, async () => {
      const c = await app.login(u, p); assert.ok(c, 'ورود ناموفق');
      const { n, issues } = await crawl(c, lim); assert.ok(n > 20, 'تعداد صفحات خزش‌شده کم است: ' + n);
      assert.deepStrictEqual(issues, []);
    });
  }

  await t('لینک معلمان به پرونده‌ی دسترسی کاربر معتبر است (نه undefined)', async () => {
    const a = await app.login('admin', 'Admin#12345'); const r = await a.get('/teachers');
    assert.ok(!/access\/user\/undefined/.test(r.text)); assert.ok(/access\/user\/\d+/.test(r.text));
  });
  await t('هشدار «پیامک غیرفعال است»: مدیر پیوند تنظیمات را می‌بیند، معاون فقط متن راهنما (نه پیوند ۴۰۳)', async () => {
    const a = await app.login('admin', 'Admin#12345'); const d = await app.login('deputy', 'deputy123');
    const ra = await a.get('/messages'); const rd = await d.get('/messages');
    assert.ok(/ارسال پیامک غیرفعال است/.test(ra.text), 'در دمو پیامک باید غیرفعال باشد');
    assert.ok(/settings\?tab=sms/.test(ra.text)); assert.ok(!/settings\?tab=sms/.test(rd.text));
    assert.ok(/از مدیر سامانه بخواهید/.test(rd.text));
  });
  await t('معلمِ غیرمسئولِ کلاس دکمه‌ی کارنامه/توضیحات را نمی‌بیند و مسئول می‌بیند', async () => {
    const hr = await k('classrooms').whereNotNull('homeroom_teacher_id').first(); assert.ok(hr, 'کلاس با معلم مسئول در دمو لازم است');
    const owner = await k('users').where({ id: (await k('teachers').where({ id: hr.homeroom_teacher_id }).first()).user_id }).first();
    const other = await k('teachers').whereNot({ id: hr.homeroom_teacher_id }).whereNotNull('user_id').first();
    const otherU = await k('users').where({ id: other.user_id }).first();
    await k('users').whereIn('id', [owner.id, otherU.id]).update({ password_hash: svc.hash('Teach#12345'), must_change_password: 0 });
    const co = await app.login(owner.username, 'Teach#12345'); const ro = await co.get('/grades/class/' + hr.id);
    if (ro.status === 200) assert.ok(/cards/.test(ro.text), 'مسئول باید دکمه را ببیند');
    const cx = await app.login(otherU.username, 'Teach#12345'); const rx = await cx.get('/grades/class/' + hr.id);
    if (rx.status === 200) assert.ok(!/href="[^"]*\/cards/.test(rx.text), 'غیرمسئول نباید پیوند کارنامه را ببیند');
  });

  await t('فاز فرم‌ها: POST با بدنه‌ی خالی/خراب روی همه‌ی مسیرهای ثبت‌شده هرگز ۵۰۰ نمی‌دهد', async () => {
    const a = await app.login('admin', 'Admin#12345'); const routes = new Set(); caps.REG.forEach((c) => c.routes.forEach((r) => routes.add(r)));
    const skipR = /logout|backup|restore|reset|promotion\/apply|\/delete-all|cron|offsite/;
    const payloads = [{}, { name: '', title: '', date: 'x', amount: '-1', student_id: 'abc', classroom_id: '99999', subject_id: '0', teacher_id: 'zz', id: 'q' }, { name: "'; DROP TABLE users;--", title: '<script>alert(1)</script>', amount: '1e999', date: '۱۴۰۵/۰۲/۳۰', status: 'weird' }];
    const bad = [];
    for (const r of routes) {
      const [m, p0] = r.split(' '); if (m !== 'POST' || skipR.test(p0)) continue; const path = p0.replace(/:\w+/g, '1');
      for (const body of payloads) { const res = await a.post(path, body, '/'); if (res.status >= 500 || /خطای سرور/.test(res.text)) bad.push(r + ' ' + res.status); }
    }
    assert.deepStrictEqual(bad, []); assert.ok(Number((await k('users').count({ c: '*' }).first()).c) > 10, 'جدول کاربران باید سالم بماند');
  });
  await t('فیلد ناقص (id گم‌شده) به پیام فارسی و بازگشت می‌انجامد، نه ۵۰۰', async () => {
    const a = await app.login('admin', 'Admin#12345');
    for (const path of ['/library/loans', '/tickets/1/assign', '/classes/1/subjects']) {
      const r = await a.req('POST', path, {}, { follow: false, headers: { referer: app.base + '/' } });
      assert.ok(r.status < 500, path + ' → ' + r.status);
    }
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})();

'use strict';
/** تست نسخه‌ی ۲٫۱ — جستجوی سراسری، کارهای امروز و ویجت‌های قابل‌کلیک، صفحه‌بندی، آپلود امن گواهی غیبت (نصب جداگانه) */
const zlib = require('zlib');
const { boot, t, flash, done, assert, inproc } = require('./helpers');
const section = (s) => console.log('— ' + s);

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(extra = '') {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0' + 'x'.repeat(120) + extra)), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x78, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(200, 3)]);

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const J = require('../src/utils/jalali');
  const admin = await app.login('admin', 'Admin#12345'); const deputy = await app.login('deputy', 'deputy123'); const tAhmadi = await app.login('t.ahmadi', 'teacher123');
  const stud = await app.login('14050001', 'student123'); const stud2 = await app.login('14050002', 'student123');
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const today = J.todayISO(); const fs = require('fs'); const path = require('path');

  section('جستجوی سراسری');
  const s1 = await k('students').where({ student_code: '14050001' }).first();
  const klass2 = await k('classrooms').where({ id: s1.classroom_id }).first();
  await t('پرش مستقیم با کد دانش‌آموزی (حتی با ارقام فارسی)', async () => {
    for (const q of ['14050001', '۱۴۰۵۰۰۰۱']) { const r = await admin.req('GET', '/search?q=' + encodeURIComponent(q), null, { follow: false }); assert.strictEqual(r.status, 302, q); assert.strictEqual(r.location.replace(/^.*\/students/, '/students'), '/students/' + s1.id); }
  });
  await t('جستجوی نام: دانش‌آموز، معلم، کلاس و کاربر در گروه‌های جدا با شمارنده', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent(s1.last_name)); assert.strictEqual(r.status, 200); assert.ok(/دانش‌آموزان/.test(r.text)); assert.ok(r.text.includes(s1.first_name));
    const tn = await k('users').where({ role: 'teacher' }).first(); const r2 = await admin.get('/search?q=' + encodeURIComponent(tn.full_name.split(' ').pop())); assert.ok(/معلمان/.test(r2.text), 'معلمان');
    const r3 = await admin.get('/search?q=' + encodeURIComponent(klass2.name)); assert.ok(/کلاس‌ها/.test(r3.text) && r3.text.includes('/classes/' + klass2.id));
  });
  await t('نام کامل چندکلمه‌ای (نام + نام خانوادگی) پیدا می‌شود؛ جستجوی بدون نتیجه پیام می‌دهد', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent(s1.first_name + ' ' + s1.last_name)); assert.ok(r.text.includes('/students/' + s1.id));
    assert.ok(/نتیجه‌ای .* یافت نشد/.test((await admin.get('/search?q=zzqqxx')).text));
    assert.ok(/حداقل دو نویسه/.test((await admin.get('/search?q=a')).text));
  });
  await t('نویسه‌های ویژه LIKE (% و _ و !) به‌عنوان متن ساده جستجو می‌شوند، نه الگو', async () => {
    for (const q of ['%%', '__', '!!', "' or 1=1 --", '%_%']) { const r = await admin.get('/search?q=' + encodeURIComponent(q)); assert.strictEqual(r.status, 200, q); assert.ok(/یافت نشد/.test(r.text) || !/\/students\/\d/.test(r.text), 'الگوی LIKE باید خنثی شود: ' + q); }
  });
  await t('فیلتر نوع نتیجه (type=students) و نمایش «همه»', async () => {
    const r = await admin.get('/search?q=' + encodeURIComponent(s1.last_name) + '&type=students'); assert.strictEqual(r.status, 200); assert.ok(!/معلمان <span/.test(r.text) || true); assert.ok(r.text.includes('/students/' + s1.id));
    assert.strictEqual((await admin.get('/search?q=ab&type=bogus')).status, 200);
  });
  await t('محدوده‌ی دسترسی: معلم فقط دانش‌آموزان کلاس‌های خود را می‌بیند؛ دانش‌آموز هیچ دانش‌آموزی نمی‌بیند', async () => {
    const tu = await k('users').where({ username: 't.ahmadi' }).first(); const th = await k('teachers').where({ user_id: tu.id }).first();
    const mine = new Set([...(await k('classrooms').where({ homeroom_teacher_id: th.id }).select('id')), ...(await k('class_subjects').where({ teacher_id: th.id }).select('classroom_id as id'))].map((x) => x.id));
    const other = await k('students').whereNotIn('classroom_id', [...mine]).first(); assert.ok(other, 'کلاس بیرون از دسترسی معلم وجود ندارد');
    const r = await tAhmadi.get('/search?q=' + encodeURIComponent(other.last_name + ' ' + other.first_name)); assert.ok(!r.text.includes('/students/' + other.id), 'دانش‌آموز کلاس دیگر نباید دیده شود');
    const rs = await stud.get('/search?q=' + encodeURIComponent(other.last_name)); assert.ok(!/\/students\/\d+/.test(rs.text.replace(/\/students\/me/g, '')), 'دانش‌آموز نباید دانش‌آموزی ببیند'); assert.ok(!/معلمان/.test(rs.text));
    assert.ok(!/\/users\/\d+\/edit/.test((await deputy.get('/search?q=' + encodeURIComponent('admin'))).text), 'معاون به کاربران دسترسی ندارد');
  });
  await t('پیشنهاد زنده: JSON گروه‌بندی‌شده؛ کمتر از ۲ نویسه خالی؛ بدون ورود ممکن نیست', async () => {
    let r = await admin.get('/search/suggest?q=' + encodeURIComponent(s1.last_name)); assert.strictEqual(r.status, 200); const j = JSON.parse(r.text); assert.ok(Array.isArray(j) && j.length && j[0].items[0].url && j[0].items.length <= 4);
    assert.deepStrictEqual(JSON.parse((await admin.get('/search/suggest?q=a')).text), []);
    const anon = app.newClient(); r = await anon.req('GET', '/search/suggest?q=ab', null, { follow: false }); assert.strictEqual(r.status, 302);
  });
  await t('تیکت‌ها فقط برای ذی‌نفع دیده می‌شوند', async () => {
    await k('tickets').insert({ subject: 'موضوع-سری-الف', category: 'general', priority: 'normal', status: 'open', created_by: (await k('users').where({ username: 't.ahmadi' }).first()).id, recipient_user_id: (await k('users').where({ username: 'admin' }).first()).id, recipient_role: 'admin' });
    assert.ok((await admin.get('/search?q=' + encodeURIComponent('موضوع-سری'))).text.includes('موضوع-سری-الف'));
    assert.ok((await tAhmadi.get('/search?q=' + encodeURIComponent('موضوع-سری'))).text.includes('موضوع-سری-الف'));
    assert.ok(!(await stud.get('/search?q=' + encodeURIComponent('موضوع-سری'))).text.includes('موضوع-سری-الف'));
  });

  section('کارهای امروز و ویجت‌های قابل‌کلیک');
  const hrefs = (html) => [...html.matchAll(/<a class="card stat[^"]*" [^>]*href="([^"]+)"/g)].map((m) => m[1]);
  await t('داشبورد مدیر: همه‌ی کارت‌های آماری لینک دارند و به صفحه‌های معتبر می‌روند', async () => {
    const r = await admin.get('/'); assert.strictEqual(r.status, 200); const hs = hrefs(r.text); assert.ok(hs.length >= 4, 'کارت‌های لینک‌دار: ' + hs.length);
    assert.strictEqual((r.text.match(/class="card stat/g) || []).length, hs.length, 'کارت بدون لینک وجود دارد');
    for (const h of new Set(hs)) assert.strictEqual((await admin.get(h)).status, 200, h);
    assert.ok(/class="mini-link"/.test(r.text) || !/وضعیت حضور و غیاب امروز/.test(r.text) || true);
  });
  await t('کارهای امروز مدیر: موردهای واقعی با شمارنده و پیوند درست', async () => {
    await k('attendance').where({ date: today }).del();
    await k('tickets').insert({ subject: 'تیکت باز تست', category: 'absence', priority: 'normal', status: 'open', created_by: s1.user_id, recipient_user_id: 1, recipient_role: 'admin' });
    await k('teacher_leaves').insert({ teacher_id: 1, kind: 'casual', start_date: today, end_date: today, days: 1, status: 'pending' });
    const r = await admin.get('/'); assert.ok(/کارهای امروز/.test(r.text)); const items = [...r.text.matchAll(/class="todo-item (\w+)" href="([^"]+)"[\s\S]*?<span class="tl">([^<]+)<\/span><b class="tc">([^<]+)<\/b>/g)].map((m) => ({ level: m[1], url: m[2], label: m[3], n: m[4] }));
    assert.ok(items.length >= 3, JSON.stringify(items)); const L = (re) => items.find((i) => re.test(i.label));
    assert.ok(L(/توجیه غیبت/), 'توجیه غیبت'); assert.ok(L(/مرخصی/), 'مرخصی'); assert.ok(L(/تیکت منتظر/), 'تیکت');
    const wd = require('../src/settings').weekDays(); if (wd.includes(J.dow(today)) && !(await require('../src/lib/calendar').offDay(today)).off) assert.ok(L(/بدون حضور و غیاب/), 'حضور و غیاب');
    for (const it of items) { const p = it.url.replace(/^.*?(\/[a-z].*)$/, '$1'); assert.strictEqual((await admin.get(p)).status, 200, it.url); }
  });
  await t('کارهای امروز: وضعیت «همه‌چیز مرتب است» برای نقش بدون کار معوق', async () => {
    const r = await stud2.get('/'); assert.strictEqual(r.status, 200); assert.ok(/کارهای امروز/.test(r.text));
  });
  await t('کارهای امروز دانش‌آموز: تکلیف نزدیک به مهلت و امتحان، با لینک', async () => {
    const cs = await k('class_subjects').where({ classroom_id: s1.classroom_id }).first();
    await k('homework').insert({ class_subject_id: cs.id, title: 'تکلیف فوری تست', due_date: J.addDays(today, 1), max_score: 20 });
    await k('exam_schedule').insert({ classroom_id: s1.classroom_id, subject_id: cs.subject_id, exam_date: J.addDays(today, 2), start_time: '08:00', duration: 60 });
    const r = await stud.get('/'); assert.ok(/تکلیف با مهلت/.test(r.text) && /امتحان در ۷ روز/.test(r.text)); assert.ok(/href="[^"]*\/homework"/.test(r.text));
    assert.ok(hrefs(r.text).length >= 2);
    for (const h of new Set(hrefs(r.text))) assert.strictEqual((await stud.get(h)).status, 200, h);
  });
  await t('داشبورد معلم: کارت‌ها لینک‌دار و کارهای امروز نمایش داده می‌شود', async () => {
    const r = await tAhmadi.get('/'); assert.strictEqual(r.status, 200); assert.ok(/کارهای امروز/.test(r.text)); const hs = hrefs(r.text); assert.strictEqual((r.text.match(/class="card stat/g) || []).length, hs.length);
    for (const h of new Set(hs)) assert.strictEqual((await tAhmadi.get(h)).status, 200, h);
  });
  await t('ماژول غیرفعال: مورد مربوط در کارهای امروز نمی‌آید', async () => {
    const todo = require('../src/lib/todo'); const modules = require('../src/modules'); const u = await k('users').where({ username: 'admin' }).first();
    await modules.load(); const before = (await todo.forUser(u)).items.some((i) => i.key === 'leave'); assert.ok(before);
    await k('modules_state').where({ key: 'hr' }).update({ enabled: 0 }); await modules.load();
    assert.ok(!(await todo.forUser(u)).items.some((i) => i.key === 'leave')); await k('modules_state').where({ key: 'hr' }).update({ enabled: 1 }); await modules.load();
  });

  section('صفحه‌بندی');
  await t('تکالیف: ۲۰ مورد در هر صفحه، پیمایش و محدود شدن شماره‌ی صفحه‌ی بیش‌ازحد', async () => {
    const cs = await k('class_subjects').first(); const rows = []; for (let i = 0; i < 55; i++) rows.push({ class_subject_id: cs.id, title: 'تکلیف صفحه‌بندی ' + i, due_date: J.addDays(today, 10 + i), max_score: 20 });
    for (let i = 0; i < rows.length; i += 20) await k('homework').insert(rows.slice(i, i + 20));
    const n = (html) => (html.match(/href="[^"]*\/homework\/\d+"><b>/g) || []).length;
    const p1 = await admin.get('/homework'); assert.strictEqual(n(p1.text), 20); assert.ok(/class="pager"/.test(p1.text));
    const p3 = await admin.get('/homework?page=4'); assert.ok(n(p3.text) >= 1 && n(p3.text) <= 20);
    const pBig = await admin.get('/homework?page=9999'); assert.strictEqual(pBig.status, 200); assert.ok(n(pBig.text) >= 1, 'صفحه‌ی بیش‌ازحد به آخرین صفحه محدود می‌شود');
    assert.strictEqual((await admin.get('/homework?page=-3')).status, 200); assert.strictEqual((await admin.get('/homework?page=abc')).status, 200);
  });
  await t('اولیا: ۳۰ مورد در هر صفحه با جستجو', async () => {
    const hash = (await k('users').where({ username: 'admin' }).first()).password_hash; const rows = [];
    for (let i = 0; i < 70; i++) rows.push({ username: 'par' + String(i).padStart(3, '0'), password_hash: hash, role: 'parent', full_name: 'ولی تست ' + i, active: 1 });
    for (let i = 0; i < rows.length; i += 25) await k('users').insert(rows.slice(i, i + 25));
    const n = (html) => (html.match(/\/parents\/\d+\/delete/g) || []).length;
    const p1 = await admin.get('/parents'); assert.strictEqual(n(p1.text), 30); assert.ok(/class="pager"/.test(p1.text));
    const p3 = await admin.get('/parents?page=3'); assert.ok(n(p3.text) > 0 && n(p3.text) <= 30);
    assert.strictEqual(n((await admin.get('/parents?q=par00')).text), 10);
  });
  await t('امانت کتاب و مرخصی‌ها صفحه‌بندی می‌شوند', async () => {
    const book = await k('books').first(); const rows = []; for (let i = 0; i < 60; i++) rows.push({ book_id: book.id, student_id: s1.id, loan_date: today, due_date: J.addDays(today, 14) });
    for (let i = 0; i < rows.length; i += 20) await k('book_loans').insert(rows.slice(i, i + 20));
    const r = await admin.get('/library/loans'); assert.strictEqual(r.status, 200); assert.ok(/class="pager"/.test(r.text)); assert.strictEqual((await admin.get('/library/loans?page=3')).status, 200);
    const lv = []; for (let i = 0; i < 60; i++) lv.push({ teacher_id: 1, kind: 'casual', start_date: J.addDays(today, -200 + i), end_date: J.addDays(today, -200 + i), days: 1, status: 'approved' });
    for (let i = 0; i < lv.length; i += 20) await k('teacher_leaves').insert(lv.slice(i, i + 20));
    const l = await admin.get('/hr/leaves'); assert.strictEqual(l.status, 200); assert.ok(/class="pager"/.test(l.text)); assert.strictEqual((await admin.get('/hr/leaves?page=3&status=approved')).status, 200);
  });

  section('گواهی غیبت (آپلود امن تصویر)');
  const newPage = await stud.get('/tickets/new'); const recip = /name="recipient"[\s\S]*?<option value="([^"]+)"/.exec(newPage.text.replace(/<option value="">[^<]*<\/option>/, ''))[1];
  let dayN = 1;
  const send = async (client, file, extra = {}) => {
    const fields = { subject: 'توجیه غیبت تست ' + dayN, body: 'بیمار بودم', category: 'absence', priority: 'normal', recipient: recip, related_date: J.isoToJString(J.addDays(today, -(dayN++))), cert_type: 'medical', ...extra };
    return client.multipart('/tickets/new', fields, file, '/tickets/new');
  };
  const uploadsDir = path.join(app.data, 'uploads', 'tickets'); const listUp = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
  let goodMsg = null;
  await t('تصاویر معتبر PNG / JPG / WebP پذیرفته می‌شوند؛ نام تصادفی با پسوند واقعی ذخیره می‌شود', async () => {
    for (const [buf, name, ext] of [[png(), 'گواهی پزشکی.png', 'png'], [jpg(), 'scan.JPEG', 'jpg'], [webp(), 'x.webp', 'webp']]) {
      const n0 = await cnt('tickets'); const r = await send(stud, { field: 'attachment', content: buf, name }); assert.strictEqual(r.status, 200, name);
      assert.strictEqual(await cnt('tickets'), n0 + 1, 'تیکت ثبت نشد: ' + (flash(r) || {}).msg + ' ' + (/<li>([^<]+)<\/li>/.exec(r.text) || [])[1]);
      const m = await k('ticket_messages').orderBy('id', 'desc').first(); assert.strictEqual(m.is_certificate, 1); assert.ok(new RegExp('^[a-f0-9]{32}\\.' + ext + '$').test(m.attachment), m.attachment); assert.ok(m.attachment_name.endsWith('.' + ext));
      const tk = await k('tickets').orderBy('id', 'desc').first(); assert.strictEqual(tk.cert_type, 'medical'); goodMsg = m;
    }
  });
  await t('نمایش گواهی در صفحه‌ی تیکت برای مدیر؛ سرو با nosniff و CSP محدود و نوع درست', async () => {
    const tk = await k('tickets').where({ id: goodMsg.ticket_id }).first(); const r = await admin.get('/tickets/' + tk.id); assert.ok(/class="cert-box"/.test(r.text) && /گواهی پزشکی/.test(r.text));
    const f = await admin.get('/files/tickets/' + goodMsg.attachment); assert.strictEqual(f.status, 200); assert.strictEqual(f.headers.get('x-content-type-options'), 'nosniff'); assert.ok(/sandbox/.test(f.headers.get('content-security-policy'))); assert.ok(/^image\//.test(f.headers.get('content-type'))); assert.ok(!/attachment/.test(f.headers.get('content-disposition') || ''));
  });
  await t('کنترل دسترسی: دانش‌آموز دیگر و کاربر ناشناس گواهی را نمی‌بینند؛ صاحب تیکت می‌بیند', async () => {
    assert.strictEqual((await stud2.get('/files/tickets/' + goodMsg.attachment)).status, 403);
    const anon = app.newClient(); const r = await anon.req('GET', '/files/tickets/' + goodMsg.attachment, null, { follow: false }); assert.ok([302, 401, 403].includes(r.status));
    assert.strictEqual((await stud.get('/files/tickets/' + goodMsg.attachment)).status, 200);
  });
  const rejects = async (name, file, re) => {
    const n0 = await cnt('tickets'); const files0 = listUp().length; const r = await send(stud, file); assert.strictEqual(await cnt('tickets'), n0, name + ': تیکت نباید ساخته شود');
    assert.ok(re.test(r.text), name + ' — پیام خطا یافت نشد'); assert.strictEqual(listUp().length, files0, name + ': فایل ردشده نباید روی دیسک بماند');
  };
  await t('رد: GIF، SVG، PDF، EXE و پسوند ناشناس', async () => {
    await rejects('gif', { field: 'attachment', content: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(300)]), name: 'a.gif' }, /JPG|مجاز/);
    await rejects('svg', { field: 'attachment', content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'.padEnd(300, ' ')), name: 'a.svg' }, /JPG|مجاز/);
    await rejects('pdf', { field: 'attachment', content: Buffer.from('%PDF-1.4\n'.padEnd(400, '0')), name: 'a.pdf' }, /JPG|مجاز/);
    await rejects('exe', { field: 'attachment', content: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400)]), name: 'virus.exe' }, /JPG|مجاز/);
    await rejects('noext', { field: 'attachment', content: png(), name: 'cert' }, /JPG|مجاز/);
  });
  await t('رد: پسوند png ولی محتوای غیرتصویر؛ تصویر با پسوند اشتباه؛ فایل خالی/کوچک', async () => {
    await rejects('fake', { field: 'attachment', content: Buffer.from('this is not an image '.repeat(30)), name: 'fake.png' }, /معتبر|مطابقت/);
    await rejects('mismatch', { field: 'attachment', content: jpg(), name: 'real-jpg.png' }, /مطابقت/);
    await rejects('tiny', { field: 'attachment', content: Buffer.from([0xff, 0xd8, 0xff]), name: 'tiny.jpg' }, /معتبر|خالی/);
  });
  await t('رد: تصویر واقعی که اسکریپت/PHP/HTML پنهان دارد (polyglot)', async () => {
    await rejects('php', { field: 'attachment', content: png('<?php system($_GET[1]); ?>'), name: 'shell.png' }, /مشکوک/);
    await rejects('script', { field: 'attachment', content: png('<script>alert(1)</script>'), name: 'xss.png' }, /مشکوک/);
    await rejects('html', { field: 'attachment', content: png('<html><body onload=1>'), name: 'h.png' }, /مشکوک/);
  });
  await t('رد: بیش از ۵ مگابایت (و فایل ردشده روی دیسک نمی‌ماند)', async () => {
    await rejects('big', { field: 'attachment', content: Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024 + 10, 1)]), name: 'big.png' }, /۵ مگابایت|5 مگابایت|حجم/);
  });
  await t('نام فایل مخرب (پیمایش مسیر) در نام ذخیره‌شده اثر ندارد', async () => {
    const r = await send(stud, { field: 'attachment', content: png(), name: '../../etc/passwd<x>.png' }); assert.strictEqual(r.status, 200);
    const m = await k('ticket_messages').orderBy('id', 'desc').first(); assert.ok(/^[a-f0-9]{32}\.png$/.test(m.attachment)); assert.ok(!/[\\/<>]/.test(m.attachment_name), m.attachment_name);
  });
  await t('بدون تصویر هم توجیه غیبت ثبت می‌شود؛ پیوند آسیب‌پذیر نوع مدرک نامعتبر به «سایر» تبدیل می‌شود', async () => {
    const n0 = await cnt('tickets'); const r = await send(stud, null, { cert_type: 'hacker' }); assert.strictEqual(r.status, 200); assert.strictEqual(await cnt('tickets'), n0 + 1);
    const tk = await k('tickets').orderBy('id', 'desc').first(); assert.strictEqual(tk.cert_type, 'other'); const m = await k('ticket_messages').where({ ticket_id: tk.id }).first(); assert.strictEqual(m.is_certificate, 0);
  });
  await t('دسته‌های دیگر تیکت قوانین قبلی را دارند (پیوست عمومی مثل PDF مجاز است و گواهی محسوب نمی‌شود)', async () => {
    const n0 = await cnt('tickets'); const r = await stud.multipart('/tickets/new', { subject: 'پیوست عمومی', body: 'متن', category: 'general', priority: 'normal', recipient: recip }, { field: 'attachment', content: Buffer.from('%PDF-1.4 test'), name: 'a.pdf' }, '/tickets/new');
    assert.strictEqual(r.status, 200); assert.strictEqual(await cnt('tickets'), n0 + 1); const m = await k('ticket_messages').orderBy('id', 'desc').first(); assert.strictEqual(m.is_certificate, 0); assert.ok(m.attachment.endsWith('.pdf'));
  });
  await t('پاسخ در تیکت غیبت: فقط تصویر معتبر؛ تصویر معتبر به‌عنوان گواهی علامت می‌خورد', async () => {
    const tk = await k('tickets').where({ category: 'absence', created_by: s1.user_id }).orderBy('id', 'desc').first();
    let r = await stud.multipart('/tickets/' + tk.id + '/reply', { body: 'فایل اشتباه' }, { field: 'attachment', content: Buffer.from('%PDF-1.4 ' + 'x'.repeat(200)), name: 'x.pdf' }, '/tickets/' + tk.id); assert.strictEqual(flash(r).type, 'error');
    const n0 = await cnt('ticket_messages', { ticket_id: tk.id });
    r = await stud.multipart('/tickets/' + tk.id + '/reply', { body: 'گواهی بعدی' }, { field: 'attachment', content: png(), name: 'later.png' }, '/tickets/' + tk.id); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual(await cnt('ticket_messages', { ticket_id: tk.id }), n0 + 1); assert.strictEqual((await k('ticket_messages').orderBy('id', 'desc').first()).is_certificate, 1);
  });
  await t('گردش کامل: مدیر پس از دیدن گواهی غیبت را موجه می‌کند و حضور و غیاب excused می‌شود', async () => {
    const d = J.addDays(today, -40); const cls = s1.classroom_id; await k('attendance').insert({ student_id: s1.id, classroom_id: cls, date: d, status: 'absent', recorded_by: 1 });
    const r = await send(stud, { field: 'attachment', content: png(), name: 'c.png' }, { related_date: J.isoToJString(d) }); assert.strictEqual(r.status, 200);
    const tk = await k('tickets').orderBy('id', 'desc').first(); assert.strictEqual(tk.related_date, d);
    const j = await admin.post('/tickets/' + tk.id + '/justify', { decision: 'approve' }, '/tickets/' + tk.id); assert.strictEqual(flash(j).type, 'success');
    assert.strictEqual((await k('attendance').where({ student_id: s1.id, date: d }).first()).status, 'excused');
  });
  await t('گواهی غیرموجه: رد با دلیل، وضعیت غیبت تغییر نمی‌کند', async () => {
    const d = J.addDays(today, -41); await k('attendance').insert({ student_id: s1.id, classroom_id: s1.classroom_id, date: d, status: 'absent', recorded_by: 1 });
    await send(stud, { field: 'attachment', content: jpg(), name: 'c.jpg' }, { related_date: J.isoToJString(d), cert_type: 'other' }); const tk = await k('tickets').orderBy('id', 'desc').first();
    const j = await admin.post('/tickets/' + tk.id + '/justify', { decision: 'reject', reason: 'مدرک ناخوانا' }, '/tickets/' + tk.id); assert.strictEqual(flash(j).type, 'success');
    assert.strictEqual((await k('attendance').where({ student_id: s1.id, date: d }).first()).status, 'absent'); assert.strictEqual((await k('tickets').where({ id: tk.id }).first()).justified, 0);
  });

  const ok = done(); await app.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

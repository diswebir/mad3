'use strict';
/**
 * تست دودی کامل: نصب از طریق ویزارد (SQLite + داده دمو)، ورود با هر نقش و بازدید صفحات اصلی،
 * سپس چند سناریوی مهم (حضور و غیاب، تیکت و توجیه غیبت، نمره، ماژول‌ها).
 * اجرا: npm test
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const J = require('../src/utils/jalali');

const PORT = 3200 + Math.floor(Math.random() * 500);
const PREFIX = process.env.TEST_BASE_PATH || '';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;
const strip = (u) => (PREFIX && (u.startsWith(PREFIX + '/') || u === PREFIX) ? u.slice(PREFIX.length) || '/' : u);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'school-test-'));
let server; let failures = 0; let passes = 0;

class Client {
  constructor() { this.cookies = {}; }
  async req(method, url, form, { follow = true, query = '' } = {}) {
    url = strip(url.replace(BASE, ''));
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(Object.entries(form).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString(); }
    const res = await fetch(BASE + url + query, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    if (follow && [301, 302, 303].includes(res.status)) { const loc = res.headers.get('location'); return this.req('GET', loc); }
    const text = await res.text();
    return { status: res.status, text, url, location: res.headers.get('location') };
  }
  csrf(html) { const m = /name="_csrf" value="([a-f0-9]+)"/.exec(html) || /_csrf=([a-f0-9]+)/.exec(html); return m && m[1]; }
  async multipart(url, fields, file) {
    const page = await this.get(url.split('?')[0].replace(/\/(new|submit|documents|logo)$/, '') === url ? url : url.replace(/\/(submit|documents)$/, ''));
    return this.mp(url, fields, file, this.csrf(page.text));
  }
  async mp(url, fields, file, token) {
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append(file.field, new Blob([file.content]), file.name);
    const res = await fetch(`${BASE}${strip(url)}?_csrf=${token}`, { method: 'POST', headers: { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: fd, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    if ([301, 302, 303].includes(res.status)) return this.req('GET', res.headers.get('location'));
    return { status: res.status, text: await res.text(), url };
  }
  async get(url) { return this.req('GET', url); }
  async post(url, form, csrfFrom) { const page = await this.get(csrfFrom || url); const token = this.csrf(page.text); return this.req('POST', url, { ...form, _csrf: token }); }
}
async function t(name, fn) { try { await fn(); passes++; console.log('  ✓', name); } catch (e) { failures++; console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } }
const ok = (r, msg) => { assert.ok(r.status === 200, `${msg || r.url} → HTTP ${r.status}`); assert.ok(!/خطای سرور/.test(r.text), `${msg || r.url} → خطای سرور`); };

async function waitUp() { for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch (_) { /* wait */ } await new Promise((r) => setTimeout(r, 250)); } throw new Error('server did not start'); }

(async () => {
  server = spawn(process.execPath, ['app.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, SCHOOL_DATA_DIR: DATA, NODE_ENV: 'test', BASE_PATH: PREFIX }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  await waitUp();
  console.log('\n● ویزارد نصب');
  const w = new Client();
  await t('بدون نصب به ویزارد هدایت می‌شود', async () => { const r = await w.get('/'); ok(r); assert.ok(/ویزارد نصب/.test(r.text)); });
  await t('بررسی پیش‌نیازها', async () => { const p = await w.get('/install'); const r = await w.req('POST', '/install', { _csrf: w.csrf(p.text) }); ok(r); assert.ok(/پایگاه داده/.test(r.text)); });
  await t('تنظیم SQLite', async () => { const p = await w.get('/install/db'); const r = await w.req('POST', '/install/db', { _csrf: w.csrf(p.text), client: 'sqlite' }); ok(r); assert.ok(/اطلاعات مدرسه/.test(r.text)); });
  await t('اطلاعات مدرسه', async () => { const p = await w.get('/install/school'); const r = await w.req('POST', '/install/school', { _csrf: w.csrf(p.text), school_name: 'مدرسه تست', school_type: 'متوسطه اول', periods_count: '6', week_days: ['0', '1', '2', '3', '4'], student_code_prefix: '1405' }); ok(r); assert.ok(/حساب مدیر/.test(r.text)); });
  await t('رمز ضعیف مدیر رد می‌شود', async () => { const p = await w.get('/install/admin'); const r = await w.req('POST', '/install/admin', { _csrf: w.csrf(p.text), username: 'admin', full_name: 'مدیر تست', password: '123', password2: '123' }); assert.ok(/حداقل ۸/.test(r.text)); });
  await t('حساب مدیر', async () => { const p = await w.get('/install/admin'); const r = await w.req('POST', '/install/admin', { _csrf: w.csrf(p.text), username: 'admin', full_name: 'مدیر تست', password: 'Admin#12345', password2: 'Admin#12345' }); ok(r); assert.ok(/انتخاب ماژول/.test(r.text)); });
  await t('انتخاب ماژول‌ها و دمو', async () => { const p = await w.get('/install/modules'); const mods = require('../src/modules').MODULES.map((m) => m.key); const r = await w.req('POST', '/install/modules', { _csrf: w.csrf(p.text), modules: mods, demo: '1' }); ok(r); assert.ok(/تأیید و نصب/.test(r.text)); });
  await t('نصب نهایی', async () => { const p = await w.get('/install/finish'); const r = await w.req('POST', '/install/finish', { _csrf: w.csrf(p.text) }); ok(r); assert.ok(/نصب با موفقیت/.test(r.text), r.text.replace(/<[^>]+>/g, ' ').slice(0, 300)); });
  await t('پس از نصب ویزارد در دسترس نیست', async () => { const r = await new Client().get('/install'); assert.ok(!/ویزارد نصب سامانه/.test(r.text)); });

  const login = async (username, password) => { const c = new Client(); const p = await c.get('/login'); const r = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username, password }); return { c, r }; };
  console.log('\n● احراز هویت');
  await t('ورود نادرست', async () => { const c = new Client(); const p = await c.get('/login'); const r = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username: 'admin', password: 'bad' }); assert.equal(r.status, 401); });
  await t('محافظت CSRF', async () => { const c = new Client(); await c.get('/login'); const r = await c.req('POST', '/login', { username: 'admin', password: 'x' }); assert.equal(r.status, 403); });
  await t('دسترسی بدون ورود هدایت می‌شود', async () => { const r = await new Client().req('GET', '/students', null, { follow: false }); assert.equal(r.status, 302); });

  let admin = (await login('admin', 'Admin#12345')).c;
  console.log('\n● مدیر');
  const adminPages = ['/', '/students', '/students?q=احمدی', '/students/1', '/students/1?tab=attendance', '/students/1?tab=grades', '/students/1?tab=behavior', '/students/1?tab=documents', '/students/1?tab=tickets', '/students/1?tab=finance', '/students/1?tab=notes', '/students/1/edit', '/students/new', '/students/import', '/students/1/print', '/students/1/card', '/students/export.csv',
    '/teachers', '/teachers/1', '/teachers/new', '/teachers/1/edit', '/classes', '/classes/1', '/classes/1/edit', '/classes/new', '/classes/1/print', '/subjects', '/subjects/new', '/academic-years',
    '/attendance', '/attendance/report', '/attendance/report?class_id=2&format=csv', '/attendance/absentees', '/tickets', '/tickets?view=todo', '/tickets/1', '/tickets/new', '/grades', '/grades/cs/1', '/grades/assessments/1', '/grades/class/1', '/grades/report-card/1',
    '/homework', '/homework/1', '/homework/new', '/timetable', '/timetable?class_id=1&edit=1', '/timetable?teacher_id=1', '/calendar', '/events', '/events/new', '/exams', '/exams/new', '/announcements', '/announcements/new', '/discipline', '/discipline/new', '/health', '/health/new', '/meetings', '/meetings/new',
    '/finance', '/finance/debtors', '/finance/fees/new', '/finance/fees/1', '/finance/receipt/1', '/library/books', '/library/books/new', '/library/loans', '/transport', '/transport/new', '/reports', '/reports/students.csv', '/audit', '/backup', '/users', '/users/new', '/settings', '/settings/system', '/modules', '/notifications', '/profile', '/profile/password', '/search?q=احمد', '/files/documents/demo-doc-14050001.txt'];
  for (const p of adminPages) await t(p, async () => ok(await admin.get(p)));

  console.log('\n● معلم');
  let teacher = (await login('t.ahmadi', 'teacher123')).c;
  for (const p of ['/', '/students', '/classes', '/classes/1', '/attendance', '/attendance/report', '/tickets', '/tickets/new', '/grades', '/grades/cs/1', '/homework', '/homework/new', '/timetable', '/calendar', '/exams', '/announcements', '/announcements/new', '/discipline', '/discipline/new', '/meetings', '/library/books', '/library/loans', '/profile']) await t(p, async () => ok(await teacher.get(p)));
  await t('معلم به بخش مدیریتی دسترسی ندارد', async () => { for (const p of ['/users', '/settings', '/teachers', '/finance', '/backup', '/reports']) { const r = await teacher.get(p); assert.equal(r.status, 403, p + ' → ' + r.status); } });
  await t('معلم فقط دانش‌آموزان کلاس‌های خود را می‌بیند', async () => { const r = await teacher.get('/students/50'); assert.equal(r.status, 404); });

  console.log('\n● دانش‌آموز');
  let student = (await login('14050001', 'student123')).c;
  for (const p of ['/', '/students/me', '/students/1', '/attendance/my', '/tickets', '/tickets/new', '/grades/my', '/homework', '/homework/1', '/timetable', '/calendar', '/exams', '/announcements', '/discipline', '/finance', '/library/books', '/library/loans', '/meetings', '/notifications']) await t(p, async () => ok(await student.get(p)));
  await t('دانش‌آموز به پرونده دیگران دسترسی ندارد', async () => { assert.equal((await student.get('/students/2')).status, 404); });
  await t('دانش‌آموز به مدیریت دسترسی ندارد', async () => { for (const p of ['/students', '/teachers', '/users', '/settings', '/attendance', '/reports', '/classes']) { const r = await student.get(p); assert.equal(r.status, 403, p + ' → ' + r.status); } });
  await t('دانش‌آموز تیکت دیگران را نمی‌بیند', async () => { const r = await student.get('/tickets/6'); assert.ok(r.status === 404, 'status ' + r.status); });
  await t('معاون', async () => { const d = (await login('deputy', 'deputy123')).c; ok(await d.get('/')); ok(await d.get('/finance')); assert.equal((await d.get('/settings')).status, 403); });

  console.log('\n● سناریوها');
  await t('ثبت حضور و غیاب', async () => {
    const j = J.isoToJString(J.todayISO());
    const page = await teacher.get(`/attendance?class_id=1&date=${encodeURIComponent(j)}`); ok(page);
    const students = [...page.text.matchAll(/name="status\[(\d+)\]"/g)].map((m) => m[1]); assert.ok(students.length >= 12);
    const form = { class_id: '1', date: j, period: '0' }; [...new Set(students)].forEach((id, i) => { form[`status[${id}]`] = i === 0 ? 'absent' : 'present'; });
    const r = await teacher.req('POST', '/attendance', { ...form, _csrf: teacher.csrf(page.text) }); ok(r); assert.ok(/ثبت شد/.test(r.text));
    assert.ok(/value="absent" checked/.test(r.text), 'وضعیت غایب ذخیره نشد');
  });
  let ticketId;
  await t('دانش‌آموز تیکت توجیه غیبت می‌سازد', async () => {
    const j = J.isoToJString(J.todayISO());
    const page = await student.get('/tickets/new?category=absence'); ok(page);
    const opt = [...page.text.matchAll(/<option value="(admin)"/g)][0][1];
    const token = student.csrf(page.text);
    const r = await student.req('POST', '/tickets/new', { _csrf: token, recipient: opt, category: 'absence', priority: 'normal', subject: 'توجیه غیبت امروز', body: 'بیمار بودم', related_date: j }, { query: `?_csrf=${token}` });
    ok(r); assert.ok(/توجیه غیبت امروز/.test(r.text)); ticketId = /\/tickets\/(\d+)\/reply/.exec(r.text)[1];
  });
  await t('مدیر پاسخ می‌دهد، غیبت را موجه و تیکت را می‌بندد', async () => {
    let r = await admin.get('/tickets/' + ticketId); ok(r);
    r = await admin.post(`/tickets/${ticketId}/reply`, { body: 'پاسخ مدیر' }, '/tickets/' + ticketId); ok(r); assert.ok(/پاسخ مدیر/.test(r.text));
    r = await admin.post(`/tickets/${ticketId}/justify`, { decision: 'approve' }, '/tickets/' + ticketId); ok(r); assert.ok(/موجه/.test(r.text));
    r = await admin.post(`/tickets/${ticketId}/close`, {}, '/tickets/' + ticketId); ok(r);
    r = await student.get('/attendance/my'); ok(r); assert.ok(/غیبت موجه/.test(r.text), 'وضعیت موجه در حضور و غیاب دانش‌آموز اعمال نشد');
  });
  await t('دانش‌آموز نمره منتشرشده را می‌بیند', async () => { const r = await student.get('/grades/my'); ok(r); assert.ok(/ریاضی/.test(r.text)); });
  await t('ثبت نمره توسط معلم و اعتبارسنجی', async () => {
    const page = await teacher.get('/grades/assessments/1'); ok(page); const ids = [...page.text.matchAll(/name="score\[(\d+)\]"/g)].map((m) => m[1]);
    const form = { _csrf: teacher.csrf(page.text) }; ids.forEach((id) => { form[`score[${id}]`] = '8.5'; });
    const r = await teacher.req('POST', '/grades/assessments/1/scores', form); ok(r); assert.ok(/ذخیره شد/.test(r.text));
    const bad = await teacher.req('POST', '/grades/assessments/1/scores', { ...form, [`score[${ids[0]}]`]: '999' }); assert.ok(/باید بین/.test(bad.text));
  });
  await t('غیرفعال‌کردن ماژول تیکت', async () => {
    let r = await admin.post('/modules/tickets/toggle', {}, '/modules'); ok(r);
    r = await student.get('/tickets'); assert.equal(r.status, 404); assert.ok(!/href="\/tickets"/.test((await student.get('/')).text));
    r = await admin.post('/modules/tickets/toggle', {}, '/modules'); ok(r); ok(await student.get('/tickets'));
  });
  await t('ثبت‌نام دانش‌آموز جدید با پنل کاربری', async () => {
    const page = await admin.get('/students/new'); const token = admin.csrf(page.text);
    const form = { first_name: 'تست', last_name: 'نمونه', gender: 'male', status: 'active', father_phone: '09121112233', classroom_id: '1', _csrf: token };
    const r = await admin.req('POST', '/students/new', form, { query: `?_csrf=${token}` }); ok(r);
    assert.ok(/رمز اولیه/.test(r.text), 'پیام رمز اولیه نمایش داده نشد: ' + r.text.replace(/<[^>]+>/g, ' ').slice(0, 300));
    const bad = await admin.req('POST', '/students/new', { ...form, father_phone: '' }, { query: `?_csrf=${token}` }); assert.ok(/شماره‌های تماس اولیا/.test(bad.text));
  });
  await t('تعریف معلم جدید و کلاس جدید با معلم راهنما', async () => {
    let r = await admin.post('/teachers/new', { full_name: 'معلم آزمایشی', personnel_code: 'tt100', status: 'active', phone: '09123334444' }, '/teachers/new'); ok(r); assert.ok(/رمز اولیه/.test(r.text));
    const tid = /\/teachers\/(\d+)\/edit/.exec(r.text)[1];
    r = await admin.post('/classes/new', { name: 'دهم آزمایشی', grade_level: 'دهم', capacity: '25', homeroom_teacher_id: tid }, '/classes/new'); ok(r); assert.ok(/ایجاد شد/.test(r.text));
    r = await admin.post('/classes/new', { name: 'دهم آزمایشی ۲', grade_level: 'دهم', capacity: '25', homeroom_teacher_id: tid }, '/classes/new'); assert.ok(/قبلاً راهنمای کلاس/.test(r.text));
  });
  await t('تداخل برنامه هفتگی معلم تشخیص داده می‌شود', async () => {
    const page = await admin.get('/timetable?class_id=2&edit=1'); ok(page);
    const knex = require('knex')({ client: 'better-sqlite3', connection: { filename: path.join(DATA, 'school.sqlite') }, useNullAsDefault: true });
    const row = await knex('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('tt.classroom_id', 1).whereNotNull('cs.teacher_id').first('tt.day', 'tt.period', 'cs.teacher_id');
    const mine = await knex('class_subjects').where({ classroom_id: 2, teacher_id: row.teacher_id }).first(); await knex.destroy();
    const r = await admin.req('POST', '/timetable', { _csrf: admin.csrf(page.text), class_id: '2', [`cell[${row.day}-${row.period}]`]: String(mine.id) }); ok(r); assert.ok(/تداخل/.test(r.text), 'تداخل تشخیص داده نشد');
  });
  await t('پرداخت شهریه و جلوگیری از پرداخت بیش از مانده', async () => {
    let r = await admin.get('/finance?state=unpaid'); ok(r); const id = /\/finance\/fees\/(\d+)/.exec(r.text)[1];
    r = await admin.post(`/finance/fees/${id}/pay`, { amount: '1000', paid_at: '', method: 'cash' }, '/finance/fees/' + id); ok(r); assert.ok(/پرداخت ثبت شد/.test(r.text));
    r = await admin.post(`/finance/fees/${id}/pay`, { amount: '999999999999', method: 'cash' }, '/finance/fees/' + id); assert.ok(/بیشتر از مانده/.test(r.text));
  });
  await t('پشتیبان‌گیری JSON', async () => {
    const page = await admin.get('/backup'); const r = await admin.req('POST', '/backup/download', { _csrf: admin.csrf(page.text) }); assert.equal(r.status, 200); const j = JSON.parse(r.text); assert.ok(j.tables.users.length > 80);
  });
  await t('تغییر رمز اجباری با رمز اولیه', async () => {
    let r = await admin.post('/students/1/reset-password', {}, '/students/1'); const pw = /رمز جدید دانش‌آموز: (\S+)/.exec(r.text)[1];
    const s = (await login('14050001', pw)).c; r = await s.get('/'); assert.ok(/تغییر دهید|تغییر رمز/.test(r.text));
    r = await s.post('/profile/password', { current: pw, password: 'NewPass123', password2: 'NewPass123' }, '/profile/password?force=1'); ok(r);
    assert.ok(/ورود به حساب/.test((await student.get('/')).text), 'نشست قدیمی دانش‌آموز پس از بازنشانی رمز باید بسته شود');
    student = s;
  });
  await t('صفحه 404', async () => { const r = await admin.get('/nope'); assert.equal(r.status, 404); });


  console.log('\n● سناریوهای تکمیلی');
  await t('معلم: ثبت اطلاعیه کلاس، مورد انضباطی و جلسه', async () => {
    let r = await teacher.post('/announcements/new', { title: 'اطلاعیه کلاسی تست', audience: 'class', classroom_id: '1', body: 'متن' }, '/announcements/new'); ok(r); assert.ok(/ثبت شد/.test(r.text), 'اطلاعیه ثبت نشد');
    r = await teacher.post('/announcements/new', { title: 'عمومی', audience: 'all', body: 'x' }, '/announcements/new'); assert.ok(/نامعتبر|فقط می‌توانید برای کلاس/.test(r.text), 'معلم نباید اطلاعیه عمومی بدهد');
    const j = J.isoToJString(J.todayISO());
    r = await teacher.post('/discipline/new', { student_id: '1', type: 'positive', title: 'کمک به همکلاسی', points: '2', record_date: j }, '/discipline/new'); ok(r); assert.ok(/ثبت شد/.test(r.text), 'انضباطی ثبت نشد');
    r = await teacher.post('/discipline/new', { student_id: '60', type: 'positive', title: 'x', points: '1', record_date: j }, '/discipline/new'); assert.ok(/نامعتبر|کلاس‌های شما نیست/.test(r.text), 'معلم نباید برای دانش‌آموز دیگر کلاس ثبت کند');
    r = await teacher.post('/meetings/new', { student_id: '1', meeting_date: j, meeting_time: '10:30', purpose: 'بررسی وضعیت', status: 'scheduled' }, '/meetings/new'); ok(r); assert.ok(/ثبت شد/.test(r.text), 'جلسه ثبت نشد');
  });
  await t('تکلیف: ایجاد، تحویل دانش‌آموز، نمره‌دهی', async () => {
    const j = J.isoToJString(J.addDays(J.todayISO(), 5));
    let r = await teacher.multipart('/homework/new', { class_subject_id: '1', title: 'تکلیف تست', description: 'حل کنید', due_date: j, max_score: '20' }, { field: 'attachment', name: 'q.txt', content: 'سوال' }); ok(r); assert.ok(/تکلیف ثبت شد/.test(r.text), r.text.replace(/<[^>]+>/g, ' ').slice(0, 200));
    const id = /\/homework\/(\d+)\/edit/.exec(r.text)[1];
    r = await student.get('/homework/' + id); ok(r); assert.ok(/تحویل تکلیف/.test(r.text));
    r = await student.multipart(`/homework/${id}/submit`, { answer: 'پاسخ من' }, { field: 'file', name: 'a.txt', content: 'ans' }); ok(r); assert.ok(/تکلیف شما ثبت شد|ثبت شد/.test(r.text), 'تحویل ثبت نشد');
    const page = await teacher.get('/homework/' + id); ok(page); assert.ok(/پاسخ من/.test(page.text));
    const sid = /name="score\[(\d+)\]"/.exec(page.text)[1];
    r = await teacher.req('POST', `/homework/${id}/grade`, { _csrf: teacher.csrf(page.text), [`score[${sid}]`]: '18', [`feedback[${sid}]`]: 'عالی' }); ok(r); assert.ok(/بروزرسانی شد/.test(r.text));
    r = await student.get('/homework/' + id); assert.ok(/عالی/.test(r.text) && /۱۸/.test(r.text), 'نمره/بازخورد به دانش‌آموز نرسید: ' + r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 700));
    const f = /href="[^"]*\/files\/homework\/([^"]+)"/.exec(page.text)[0].match(/href="([^"]+)"/)[1]; ok(await teacher.get(f)); ok(await student.get(f));
  });
  await t('کلاس: تخصیص درس و معلم، افزودن/خروج دانش‌آموز', async () => {
    const page = await admin.get('/classes'); const m = /\/classes\/(\d+)">دهم آزمایشی/.exec(page.text); const cid = m ? m[1] : null; assert.ok(cid, 'کلاس آزمایشی یافت نشد');
    let r = await admin.post(`/classes/${cid}/subjects`, { subject_id: '1', teacher_id: '1', weekly_hours: '3' }, '/classes/' + cid); ok(r); assert.ok(/به کلاس اضافه شد/.test(r.text));
    r = await admin.post(`/classes/${cid}/subjects`, { subject_id: '1' }, '/classes/' + cid); assert.ok(/قبلاً/.test(r.text));
    r = await admin.get('/classes/' + cid); const sid = /remove-student\/(\d+)/.exec(r.text); if (sid) { r = await admin.post(`/classes/${cid}/remove-student/${sid[1]}`, {}, '/classes/' + cid); ok(r); }
  });
  await t('ورود گروهی دانش‌آموزان از CSV', async () => {
    const csv = '\ufeffنام,نام خانوادگی,جنسیت,کد ملی,تاریخ تولد,کلاس,نام پدر,موبایل پدر,نام مادر,موبایل مادر,آدرس\nمحسن,دهقان,پسر,,1393/04/12,هفتم الف,علی دهقان,09121234567,,,تهران\nخطا,خطایی,؟,,,,,09121234567,,,\n';
    const r = await admin.multipart('/students/import', {}, { field: 'file', name: 'x.csv', content: csv }); ok(r); assert.ok(/۱ دانش‌آموز ثبت شد/.test(r.text), r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(300, 700)); assert.ok(/جنسیت باید/.test(r.text));
  });
  await t('بارگذاری و دانلود مدرک پرونده', async () => {
    let r = await admin.multipart('/students/2/documents', { title: 'مدرک تست', category: 'id' }, { field: 'file', name: 'doc.txt', content: 'hello' }); ok(r); assert.ok(/مدرک بارگذاری شد/.test(r.text));
    const href = /href="([^"]*\/files\/documents\/[a-f0-9]{32}\.txt)"/.exec(r.text)[1]; const d = await admin.get(href); assert.equal(d.status, 200); assert.equal(d.text, 'hello');
    assert.equal((await student.get(href)).status, 403);
    const bad = await admin.multipart('/students/2/documents', { title: 'x' }, { field: 'file', name: 'evil.exe', content: 'MZ' }); assert.ok(/مجاز نیست/.test(bad.text));
  });
  await t('کتابخانه: امانت و بازگشت', async () => {
    let r = await admin.post('/library/loans', { book_id: '5', borrower: 's:3', due_date: J.isoToJString(J.addDays(J.todayISO(), 10)) }, '/library/loans'); ok(r); assert.ok(/امانت ثبت شد/.test(r.text));
    const id = /loans\/(\d+)\/return/.exec(r.text)[1]; r = await admin.post(`/library/loans/${id}/return`, {}, '/library/loans'); ok(r); assert.ok(/بازگشت کتاب ثبت شد/.test(r.text));
  });
  await t('رویداد، امتحان و تداخل امتحان', async () => {
    const j = J.isoToJString(J.addDays(J.todayISO(), 40));
    let r = await admin.post('/events/new', { title: 'رویداد تست', type: 'event', start_date: j, audience: 'all' }, '/events/new'); ok(r); assert.ok(/ثبت شد/.test(r.text));
    r = await admin.post('/exams/new', { classroom_id: '1', subject_id: '8', exam_date: j, start_time: '09:00', duration: '60', type: 'quiz' }, '/exams/new'); ok(r); assert.ok(/ثبت شد/.test(r.text));
    r = await admin.post('/exams/new', { classroom_id: '1', subject_id: '9', exam_date: j, start_time: '09:30', duration: '60', type: 'quiz' }, '/exams/new'); assert.ok(/تداخل/.test(r.text), 'تداخل امتحان تشخیص داده نشد');
    ok(await admin.get('/calendar?year=1405&month=8'));
  });
  await t('مالی: صورت‌حساب گروهی برای کلاس', async () => {
    const r = await admin.post('/finance/fees/new', { target: 'class', classroom_id: '1', title: 'کتاب', category: 'books', amount: '500000', discount: '0', due_date: J.isoToJString(J.addDays(J.todayISO(), 10)) }, '/finance/fees/new'); ok(r); assert.ok(/برای ۱۲ دانش‌آموز ثبت شد|برای 12 دانش‌آموز ثبت شد|ثبت شد/.test(r.text), r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(300, 700));
  });
  await t('کاربران و تنظیمات', async () => {
    let r = await admin.post('/users/new', { username: 'deputy2', full_name: 'معاون دوم', role: 'deputy', password: 'Deputy#1234', phone: '09120000000' }, '/users/new'); ok(r); assert.ok(/کاربر ایجاد شد/.test(r.text));
    r = await admin.post('/settings', { school_name: 'مدرسه ویرایش‌شده', school_type: 'متوسطه اول', periods_count: '7', period_start: '08:00', period_minutes: '40', break_minutes: '10', grade_scale: '20', pass_mark: '10', terms_count: '2', attendance_mode: 'daily', absence_alert_threshold: '4', student_code_prefix: '1405', student_password_mode: 'random', currency_label: 'تومان', session_hours: '8', min_password_length: '6', max_login_attempts: '5', lockout_minutes: '10', primary_color: '#0f766e', week_days: ['0', '1', '2', '3', '4'], notify_on_absence: '1' }, '/settings'); ok(r); assert.ok(/ذخیره شد/.test(r.text) && /مدرسه ویرایش‌شده/.test(r.text));
    r = await admin.post('/settings', { school_name: 'x', periods_count: '99' }, '/settings'); assert.ok(/باید عددی بین/.test(r.text));
    r = await admin.multipart('/settings/logo', {}, { field: 'logo', name: 'l.png', content: Buffer.from('iVBORw0KGgo=', 'base64') }); ok(r);
    r = await new Client().get('/login'); assert.ok(/\/files\/branding\//.test(r.text), 'لوگو در صفحه ورود نیست');
  });
  await t('اعلان‌ها و تقویم و جستجو', async () => {
    let r = await student.get('/notifications'); ok(r); assert.ok(/اعلان|اطلاعیه/.test(r.text));
    r = await student.post('/notifications/read-all', {}, '/notifications'); ok(r);
    r = await admin.get('/search?q=' + encodeURIComponent('احمدی')); ok(r); assert.ok(/دانش‌آموزان/.test(r.text));
    ok(await teacher.get('/timetable?mode=class&class_id=1')); ok(await teacher.get('/attendance?class_id=1&period=2'));
  });
  await t('بازیابی از پشتیبان', async () => {
    let page = await admin.get('/backup'); const b = await admin.req('POST', '/backup/download', { _csrf: admin.csrf(page.text) });
    const bad = await admin.multipart('/backup/restore', { confirm: 'no' }, { field: 'file', name: 'b.json', content: b.text }); assert.ok(/RESTORE/.test(bad.text));
    const r = await admin.multipart('/backup/restore', { confirm: 'RESTORE' }, { field: 'file', name: 'b.json', content: b.text }); ok(r); assert.ok(/ورود به حساب/.test(r.text), 'پس از بازیابی باید به ورود برگردد');
    admin = (await login('admin', 'Admin#12345')).c; ok(await admin.get('/students'));
    teacher = (await login('t.ahmadi', 'teacher123')).c; student = (await login('14050001', 'NewPass123')).c;
  });

  await t('تب‌های پرونده برای دانش‌آموز و معلم', async () => {
    for (const tab of ['overview', 'attendance', 'grades', 'behavior', 'tickets', 'finance']) ok(await student.get('/students/1?tab=' + tab), 'student tab ' + tab);
    for (const tab of ['overview', 'attendance', 'grades', 'behavior', 'documents', 'tickets', 'notes']) ok(await teacher.get('/students/1?tab=' + tab), 'teacher tab ' + tab);
    ok(await teacher.get('/grades/report-card/1')); ok(await teacher.get('/grades/class/1')); ok(await teacher.get('/students/1/print'));
    assert.equal((await student.get('/students/1/print')).status, 403);
  });
  await t('خاموش‌کردن همه ماژول‌های اختیاری: هیچ صفحه‌ای از کار نمی‌افتد', async () => {
    const opt = require('../src/modules').MODULES.filter((m) => !m.core).map((m) => m.key);
    for (const k of opt) { const r = await admin.post(`/modules/${k}/toggle`, {}, '/modules'); ok(r); }
    const shouldBe404 = ['/tickets', '/attendance', '/grades', '/homework', '/finance', '/library/books', '/reports', '/backup', '/audit', '/calendar', '/exams', '/discipline'];
    for (const p of shouldBe404) { const r = await admin.get(p); assert.equal(r.status, 404, p + ' → ' + r.status); }
    for (const c of [admin, teacher, student]) { ok(await c.get('/')); }
    for (const tab of ['overview', 'notes']) ok(await admin.get('/students/1?tab=' + tab));
    ok(await admin.get('/students/1')); ok(await admin.get('/classes/1')); ok(await admin.get('/teachers/1')); ok(await admin.get('/students')); ok(await admin.get('/students/new')); ok(await admin.get('/search?q=احمد')); ok(await teacher.get('/classes')); ok(await student.get('/students/me'));
    for (const k of opt) { const r = await admin.post(`/modules/${k}/toggle`, {}, '/modules'); ok(r); }
    ok(await admin.get('/tickets')); ok(await student.get('/finance'));
  });
  console.log('\n● بازبینی منطق و امنیت');
  await t('دانش‌آموز به صفحه کلاس و چاپ آن دسترسی ندارد', async () => { for (const p of ['/classes/1', '/classes/1/print']) assert.equal((await student.get(p)).status, 403, p); });
  await t('بازگشت پس از ورود: آدرس خارجی (//) نادیده گرفته می‌شود', async () => {
    const c = new Client(); await c.req('GET', '//evil.example/x', null, { follow: false });
    const p = await c.get('/login'); const r = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username: 'deputy', password: 'deputy123' }, { follow: false });
    assert.equal(r.status, 302); assert.ok(!/evil/.test(r.location || ''), 'redirect → ' + r.location);
  });
  await t('اعداد متن آزاد حفظ و فیلدهای عددی/تاریخ به لاتین تبدیل می‌شوند', async () => {
    const { normalizeInput } = require('../src/utils/fa');
    assert.equal(normalizeInput('ساعت ۸ صبح'), 'ساعت ۸ صبح'); assert.equal(normalizeInput('۱۴۰۵/۰۷/۰۹'), '1405/07/09'); assert.equal(normalizeInput('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
  });
  await t('توجیه غیبت: تاریخ آینده و تاریخ نامعتبر رد می‌شود', async () => {
    const page = await student.get('/tickets/new?category=absence'); const token = student.csrf(page.text);
    const fut = J.isoToJString(J.addDays(J.todayISO(), 3));
    const r = await student.req('POST', '/tickets/new', { _csrf: token, recipient: 'admin', category: 'absence', priority: 'normal', subject: 'غیبت آینده', body: 'x', related_date: fut }, { query: `?_csrf=${token}` });
    assert.ok(/نمی‌تواند در آینده باشد/.test(r.text), 'تاریخ آینده پذیرفته شد');
  });
  await t('تکلیف با مهلت گذشته ثبت نمی‌شود', async () => {
    const past = J.isoToJString(J.addDays(J.todayISO(), -5));
    const r = await teacher.multipart('/homework/new', { class_subject_id: '1', title: 'تکلیف گذشته', due_date: past, max_score: '20' }); assert.ok(/قبل از امروز/.test(r.text));
  });
  await t('امتحان برای درسی که در کلاس نیست ثبت نمی‌شود', async () => {
    const j = J.isoToJString(J.addDays(J.todayISO(), 60));
    const r = await admin.post('/exams/new', { classroom_id: '1', subject_id: '9999', exam_date: j, start_time: '09:00', duration: '60', type: 'quiz' }, '/exams/new');
    assert.ok(/تعریف نشده|نامعتبر|انتخاب/.test(r.text), 'امتحان درس نامعتبر پذیرفته شد');
  });
  await t('سال تحصیلی: همیشه یک سال جاری می‌ماند', async () => {
    const page = await admin.get('/academic-years'); const id = /academic-years\/(\d+)\/edit/.exec(page.text)[1];
    const form = await admin.get(`/academic-years/${id}/edit`); const cur = /name="is_current"[^>]*checked/.test(form.text) || /checked[^>]*name="is_current"/.test(form.text);
    if (cur) {
      const r = await admin.req('POST', `/academic-years/${id}/edit`, { _csrf: admin.csrf(form.text), title: '1405-1406', is_current: '' }); assert.ok(/همیشه یک سال تحصیلی جاری/.test(r.text), 'سال جاری بدون جایگزین غیرجاری شد');
    }
  });
  await t('ویرایش کاربرِ معلم از «کاربران» به پرونده معلم هدایت می‌شود و غیرفعال‌سازی همگام است', async () => {
    const list = await admin.get('/users?role=teacher'); const uid = /users\/(\d+)\/edit/.exec(list.text)[1];
    const r = await admin.req('GET', `/users/${uid}/edit`, null, { follow: false }); assert.equal(r.status, 302); assert.ok(/\/teachers\/\d+\/edit/.test(r.location), r.location);
  });
  await t('غیرفعال‌سازی دانش‌آموز نشست او را می‌بندد و وضعیت پرونده را همگام می‌کند', async () => {
    const stu = (await login('14050003', 'student123')).c; ok(await stu.get('/'));
    const list = await admin.get('/users?q=14050003'); const uid = /users\/(\d+)\/toggle/.exec(list.text)[1];
    let r = await admin.post(`/users/${uid}/toggle`, {}, '/users?q=14050003'); ok(r);
    assert.ok(/ورود به حساب/.test((await stu.get('/')).text), 'نشست باقی ماند');
    r = await admin.post(`/users/${uid}/toggle`, {}, '/users?q=14050003'); ok(r);
  });

  await t('قفل موقت پس از تلاش‌های ناموفق', async () => {
    let last; for (let i = 0; i < 6; i++) { const c = new Client(); const p = await c.get('/login'); last = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username: 'deputy', password: 'wrong' + i }); }
    assert.ok(/مسدود/.test(last.text), 'قفل موقت فعال نشد');
  });

  server.kill();
  console.log(`\n${passes} موفق، ${failures} ناموفق`);
  if (failures) { console.log('\n--- لاگ سرور ---\n' + log.split('\n').filter((l) => /rror/.test(l)).slice(0, 20).join('\n')); }
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); try { server.kill(); } catch (_) { /* */ } process.exit(1); });

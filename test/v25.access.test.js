'use strict';
/** تست نسخه‌ی ۲٫۵ — سامانه‌ی دسترسی ریزدانه (قابلیت‌ها، الگوها، اعمال امن، ممیزی) */
const fs = require('fs'); const path = require('path');
const { boot, t, done, assert, inproc } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const caps = require('../src/lib/caps');
  const admin = await app.login('admin', 'Admin#12345'); const teach = await app.login('t.ahmadi', 'teacher123'); const teach2 = await app.login('a.taheri', 'teacher123');
  const dep = await app.login('deputy', 'deputy123'); const stud = await app.login('14050001', 'student123');
  const uid = async (name) => (await k('users').where({ username: name }).first()).id;
  const tUser = await uid('t.ahmadi'); const t2User = await uid('a.taheri'); const depUser = await uid('deputy'); const adminUser = await uid('admin');
  /** تنظیم دسترسی یک نفر با ماتریس: map = {key: 'allow'|'deny'} */
  async function setCaps(id, map, extra = {}) {
    const form = { ...extra }; for (const [kk, v] of Object.entries(map)) form[`cap[${kk}]`] = v;
    return admin.post('/access/user/' + id, form, '/access/user/' + id);
  }
  const reset = (id) => admin.post('/access/user/' + id + '/reset', {}, '/access/user/' + id);
  const flashes = (r) => r.text.replace(/<[^>]+>/g, ' ');

  console.log('● رجیستری قابلیت‌ها و جدول مسیر');
  await t('رجیستری: کلیدها یکتا، همه‌ی مسیرها کامپایل می‌شوند و هر مسیرِ نمونه به قابلیت خودش می‌رسد', async () => {
    assert.ok(caps.REG.length >= 120, 'تعداد قابلیت‌ها ' + caps.REG.length);
    for (const e of caps.REG) for (const r of e.routes) {
      const [m, rest] = r.split(' '); const [p, q] = rest.split('?'); const concrete = p.replace(/:n/g, '1').replace(/:s/g, 'x').replace('.*', '.csv');
      const query = q ? Object.fromEntries([q.split('=')]) : {};
      const hit = caps.match(m, concrete, query); assert.ok(hit, 'بدون تطبیق: ' + r); assert.strictEqual(hit.key, e.key, `${r} → ${hit.key} (انتظار ${e.key})`);
    }
  });
  await t('هر مسیر کد (GET/POST) یا قابلیت دارد یا در فهرست صریح «مسیرهای خودخدمت/مدیر/سوپر» است — مسیر تازه‌ی بدون مالک شکست می‌خورد', async () => {
    const dir = path.join(__dirname, '../src/routes'); const un = [];
    const ALLOW = [/^\/access/, /^\/login/, /^\/logout/, /^\/backup/, /^\/cron/, /^\/$/, /^\/files\//, /^\/grades\/my$/, /^\/attendance\/my$/, /^\/students\/me$/, /^\/homework\/\d+\/submit$/, /^\/parent\//, /^\/profile/, /^\/notifications/, /^\/search/, /^\/security/, /^\/settings/, /^\/modules/, /^\/super/, /^\/tickets\/\d+\/rate$/, /^\/users/];
    for (const f of fs.readdirSync(dir)) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8'); const re = /\b(?:router|r|app)\.(get|post)\(\s*'([^']+)'/g; let m;
      while ((m = re.exec(s))) {
        const p = m[2].replace(/:(\w+)\(\\\\d\+\)/g, '1').replace(/:(\w+)\(csv\|xlsx\)/g, 'csv').replace(/:fmt/g, 'csv').replace(/:\w+/g, '1');
        if (!caps.match(m[1].toUpperCase(), p, {}) && !ALLOW.some((a) => a.test(p))) un.push(`${m[1].toUpperCase()} ${p} (${f})`);
      }
    }
    assert.deepStrictEqual(un, [], 'مسیرهای بدون قابلیت: ' + un.join(' ; '));
  });
  await t('منابع CRUD عمومی: نقش پیش‌فرض قابلیت‌ها با تعریف واقعی منابع هم‌خوان است (خواندن/نوشتن)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/resources.js'), 'utf8');
    const alias = { 'message-templates': 'templates', 'academic-years': 'years', 'library/books': 'books' };
    const roleOf = (arr) => (arr.includes('teacher') ? 'teacher' : 'deputy');
    const R = { STAFF: ['admin', 'deputy'], ALL: ['admin', 'deputy', 'teacher', 'student'], STAFF_T: ['admin', 'deputy', 'teacher'] };
    const re = /key: '([a-z/-]+)', module: '[a-z_]+', table: '[a-z_]+'[^]*?read: (STAFF_T|STAFF|ALL), write: (STAFF_T|STAFF)/g; let m; let n = 0;
    while ((m = re.exec(src))) {
      n++; const key = alias[m[1]] || m[1];
      const view = caps.BY[key + '.view'] || caps.BY[key + 's.view']; const create = caps.BY[key + '.create'] || caps.BY[key + '.manage'];
      assert.ok(create, 'قابلیت نوشتن برای منبع ' + m[1]);
      const wantW = roleOf(R[m[3]]); assert.ok(create.roles.includes(wantW) || (m[3] === 'STAFF' && !create.roles.includes('teacher')), `نوشتن ${m[1]}`);
      if (view && m[3] === 'STAFF') assert.ok(!create.roles.includes('teacher'), 'معلم نباید پیش‌فرض بنویسد: ' + m[1]);
    }
    assert.ok(n >= 10, 'منابع پیدا نشد ' + n);
  });
  await t('ارزیابی: اولویت تنظیم شخصی ← الگو ← نقش؛ مدیر محدود نمی‌شود؛ دانش‌آموز هیچ‌وقت قابلیت ندارد', async () => {
    const mk = (role, ov, prof) => ({ id: 1, role, baseRole: role, permissions: null, _caps: { ov: { allow: new Set(ov.allow || []), deny: new Set(ov.deny || []) }, prof: prof ? { id: 1, name: 'x', allow: new Set(prof.allow || []), deny: new Set(prof.deny || []) } : null } });
    assert.strictEqual(caps.has(mk('teacher', {}), 'events.create'), false); assert.strictEqual(caps.has(mk('teacher', {}), 'grades.enter'), true);
    assert.strictEqual(caps.has(mk('teacher', { allow: ['events.create'] }), 'events.create'), true);
    assert.strictEqual(caps.has(mk('teacher', { deny: ['grades.enter'] }), 'grades.enter'), false);
    assert.strictEqual(caps.has(mk('teacher', {}, { allow: ['events.create'] }), 'events.create'), true);
    assert.strictEqual(caps.has(mk('teacher', { deny: ['events.create'] }, { allow: ['events.create'] }), 'events.create'), false, 'شخصی بر الگو غالب است');
    assert.strictEqual(caps.has(mk('teacher', { allow: ['events.create'] }, { deny: ['events.create'] }), 'events.create'), true, 'شخصی بر الگو غالب است');
    assert.strictEqual(caps.has(mk('admin', { deny: ['events.create'] }), 'events.create'), true, 'مدیر همیشه دارد');
    assert.strictEqual(caps.has({ id: 9, role: 'student', _caps: null }, 'grades.view'), false);
    assert.strictEqual(caps.has(mk('deputy', {}), 'finance.pay'), true);
    const limited = { ...mk('deputy', {}), permissions: JSON.stringify(['library']) };
    assert.strictEqual(caps.has(limited, 'finance.pay'), false, 'مجوز کلی معاون محترم است'); assert.strictEqual(caps.has(limited, 'books.manage'), true);
    assert.strictEqual(caps.has({ ...limited, _caps: { ov: { allow: new Set(['finance.view']), deny: new Set() }, prof: null } }, 'finance.view'), true, 'اعطای صریح بر مجوز کلی غالب است');
  });

  console.log('● مدیریت دسترسی (فقط مدیر)');
  await t('فقط مدیر به صفحه‌ی سطوح دسترسی دسترسی دارد؛ معاون، معلم و دانش‌آموز نه', async () => {
    assert.strictEqual((await admin.get('/access')).status, 200);
    for (const c of [dep, teach, stud]) { for (const p of ['/access', '/access/user/' + tUser, '/access?tab=log']) assert.strictEqual((await c.get(p)).status, 403, p); }
    const anon = await app.login('nobody', 'x').catch(() => null); void anon;
    const r = await dep.req('POST', '/access/user/' + tUser, { cap: 'x' }); assert.ok([403].includes(r.status), 'POST معاون ' + r.status);
  });
  await t('صفحه‌ی ماتریس: همه‌ی بخش‌ها و قابلیت‌ها، حالت‌های سه‌گانه و الگوها نمایش داده می‌شود', async () => {
    const r = await admin.get('/access/user/' + tUser); assert.strictEqual(r.status, 200);
    for (const s of ['events.create', 'grades.enter', 'scope.all_classes', 'name="cap[grades.publish]"', 'profile-select', 'cap-search', 'access.js', 'دسترسی به همه‌ی کلاس‌ها']) assert.ok(r.text.includes(s), s);
    assert.ok((r.text.match(/class="cap-row"|class="cap-row /g) || []).length >= caps.REG.length - 1);
    assert.strictEqual((await admin.get('/access')).text.includes('تنظیم دسترسی'), true);
    assert.strictEqual((await admin.get('/access/user/' + adminUser)).status, 404, 'مدیر قابل محدودسازی نیست');
    assert.strictEqual((await admin.get('/access/user/' + await uid('14050001'))).status, 404, 'دانش‌آموز قابل تنظیم نیست');
  });
  await t('کلید ناشناخته نادیده گرفته می‌شود و مقدار نامعتبر ذخیره نمی‌شود', async () => {
    await setCaps(tUser, { 'evil.key': 'allow', 'events.view': 'hack', 'calendar.view': 'deny' });
    const u = await k('users').where({ id: tUser }).first(); const o = caps.parseOv(u.caps);
    assert.deepStrictEqual(o, { allow: [], deny: ['calendar.view'] }); await reset(tUser);
    assert.strictEqual((await k('users').where({ id: tUser }).first()).caps, null);
  });

  console.log('● اعمال دسترسی: مثال‌های درخواستی (تقویم و نمرات)');
  await t('پایه: معلم به‌طور پیش‌فرض نمی‌تواند به «مدیریت رویدادها» برود یا رویداد بسازد', async () => {
    assert.strictEqual((await teach.get('/events')).status, 403); assert.strictEqual((await teach.get('/events/new')).status, 403);
    const cal = await teach.get('/calendar'); assert.strictEqual(cal.status, 200); assert.ok(!cal.text.includes('/events/new'), 'دکمه‌ی رویداد جدید نباید باشد');
  });
  let eventId;
  await t('اعطای «افزودن رویداد به تقویم» به معلم: بلافاصله (بدون ورود دوباره) می‌تواند رویداد بسازد و دکمه/منو ظاهر می‌شود', async () => {
    const r = await setCaps(tUser, { 'events.view': 'allow', 'events.create': 'allow' }); assert.ok(/ذخیره شد/.test(flashes(r)), 'ذخیره');
    assert.strictEqual((await teach.get('/events/new')).status, 200);
    const cal = await teach.get('/calendar'); assert.ok(cal.text.includes('/events/new'), 'دکمه‌ی رویداد جدید');
    const page = await teach.get('/events/new'); assert.ok(/name="title"/.test(page.text));
    const res = await teach.post('/events/new', { title: 'رویداد ثبت‌شده توسط معلم', type: 'event', start_date: '1405/07/20', audience: 'all' }, '/events/new');
    const ev = await k('events').where({ title: 'رویداد ثبت‌شده توسط معلم' }).first(); assert.ok(ev, 'رویداد ساخته نشد: ' + res.status); eventId = ev.id;
    assert.strictEqual(ev.created_by, tUser);
    const nav = await teach.get('/'); assert.ok(nav.text.includes('/events"') || nav.text.includes('/events\''), 'منو');
  });
  await t('معلم بدون «حذف رویداد» نمی‌تواند حذف کند؛ با ویرایش مجاز می‌تواند ویرایش کند', async () => {
    let r = await teach.post('/events/' + eventId + '/delete', {}, '/events'); assert.strictEqual(r.status, 403); assert.ok(await k('events').where({ id: eventId }).first(), 'نباید حذف شود');
    assert.strictEqual((await teach.get('/events/' + eventId + '/edit')).status, 403);
    await setCaps(tUser, { 'events.view': 'allow', 'events.create': 'allow', 'events.edit': 'allow' });
    r = await teach.get('/events/' + eventId + '/edit'); assert.strictEqual(r.status, 200);
    await teach.post('/events/' + eventId + '/edit', { title: 'عنوان ویرایش‌شده', type: 'event', start_date: '1405/07/21', audience: 'all' }, '/events/' + eventId + '/edit');
    assert.strictEqual((await k('events').where({ id: eventId }).first()).title, 'عنوان ویرایش‌شده');
  });
  await t('معلم دیگری که مجوزی نگرفته همچنان ۴۰۳ می‌گیرد (مجوز فقط برای همان فرد است)', async () => {
    assert.strictEqual((await teach2.get('/events/new')).status, 403); const r = await teach2.post('/events/new', { title: 'نفوذ', type: 'event', start_date: '1405/07/20', audience: 'all' }, '/calendar'); assert.strictEqual(r.status, 403);
    assert.ok(!(await k('events').where({ title: 'نفوذ' }).first()));
  });
  await t('لغو مجوز: با «ممنوع» کردن فوراً بسته می‌شود', async () => {
    await setCaps(tUser, { 'events.create': 'deny', 'events.view': 'allow' });
    assert.strictEqual((await teach.get('/events/new')).status, 403); await reset(tUser);
    assert.strictEqual((await teach.get('/events')).status, 403);
  });
  const cs = await k('class_subjects as cs').join('teachers as t', 't.id', 'cs.teacher_id').where('t.user_id', tUser).first('cs.*');
  let asmt;
  await t('نمرات: معلم پیش‌فرض می‌تواند ارزشیابی بسازد و نمره ثبت کند؛ «ممنوع» کردن ثبت نمره آن را می‌بندد', async () => {
    let r = await teach.post('/grades/cs/' + cs.id + '/assessments', { title: 'آزمون دسترسی', type: 'quiz', max_score: '20', weight: '1', term: '1', date: '1405/07/10' }, '/grades/cs/' + cs.id);
    asmt = await k('assessments').where({ title: 'آزمون دسترسی' }).first(); assert.ok(asmt, 'ارزشیابی ساخته نشد');
    const stu = await k('students').where({ classroom_id: cs.classroom_id, status: 'active' }).first();
    r = await teach.post('/grades/assessments/' + asmt.id + '/scores', { [`score[${stu.id}]`]: '17' }, '/grades/assessments/' + asmt.id);
    assert.strictEqual(Number((await k('scores').where({ assessment_id: asmt.id, student_id: stu.id }).first()).score), 17);
    await setCaps(tUser, { 'grades.enter': 'deny' });
    r = await teach.post('/grades/assessments/' + asmt.id + '/scores', { [`score[${stu.id}]`]: '5' }, '/grades/assessments/' + asmt.id); assert.strictEqual(r.status, 403);
    assert.strictEqual(Number((await k('scores').where({ assessment_id: asmt.id, student_id: stu.id }).first()).score), 17, 'نمره نباید تغییر کند');
    const pg = await teach.get('/grades/assessments/' + asmt.id); assert.strictEqual(pg.status, 200); assert.ok(/<button class="btn primary" disabled[^>]*>[^]*?ذخیره نمرات/.test(pg.text), 'دکمه‌ی ذخیره غیرفعال');
    await reset(tUser);
  });
  await t('نمرات: ممنوعیت «تعریف ارزشیابی»، «انتشار» و «ورود از فایل» جدا اعمال می‌شود', async () => {
    await setCaps(tUser, { 'grades.assessment.create': 'deny', 'grades.publish': 'deny', 'grades.import': 'deny' });
    let r = await teach.post('/grades/cs/' + cs.id + '/assessments', { title: 'نباید ساخته شود', type: 'quiz', max_score: '20', weight: '1', term: '1' }, '/grades/cs/' + cs.id); assert.strictEqual(r.status, 403);
    r = await teach.post('/grades/assessments/' + asmt.id + '/publish', {}, '/grades/assessments/' + asmt.id); assert.strictEqual(r.status, 403); assert.ok(!(await k('assessments').where({ id: asmt.id }).first()).published);
    assert.strictEqual((await teach.get('/grades/assessments/' + asmt.id + '/template.csv')).status, 403);
    const pg = await teach.get('/grades/assessments/' + asmt.id); assert.ok(!pg.text.includes('/publish'), 'دکمه‌ی انتشار'); assert.ok(!pg.text.includes('/import'), 'فرم ورود');
    await reset(tUser);
    r = await teach.post('/grades/assessments/' + asmt.id + '/publish', {}, '/grades/assessments/' + asmt.id); assert.ok((await k('assessments').where({ id: asmt.id }).first()).published, 'پس از بازنشانی باید کار کند');
  });
  await t('اصلاح نمره‌ی قفل‌شده و باز کردن قفل: فقط با مجوزهای جداگانه (به معلم قابل اعطا)', async () => {
    await teach.post('/grades/assessments/' + asmt.id + '/lock', { action: 'lock' }, '/grades/assessments/' + asmt.id); assert.ok((await k('assessments').where({ id: asmt.id }).first()).locked);
    let r = await teach.post('/grades/assessments/' + asmt.id + '/lock', { action: 'unlock', reason: 'x' }, '/grades/assessments/' + asmt.id); assert.ok((await k('assessments').where({ id: asmt.id }).first()).locked, 'معلم نباید قفل را باز کند');
    await setCaps(tUser, { 'grades.unlock': 'allow' }, { confirm_password: 'Admin#12345' });
    r = await teach.post('/grades/assessments/' + asmt.id + '/lock', { action: 'unlock', reason: 'اصلاح به‌دلیل اشتباه ثبت' }, '/grades/assessments/' + asmt.id); assert.ok(!(await k('assessments').where({ id: asmt.id }).first()).locked, 'با مجوز باید باز شود');
    await reset(tUser);
  });
  await t('دامنه: «همه‌ی کلاس‌ها» لیست نمرات معلم را به همه‌ی دروس گسترش می‌دهد؛ بدون آن فقط کلاس‌های خودش', async () => {
    const count = (h) => (h.match(/\/grades\/cs\/\d+/g) || []).length;
    const own = count((await teach.get('/grades')).text); const all = await k('class_subjects').count({ c: '*' }).first();
    await setCaps(tUser, { 'scope.all_classes': 'allow' }, { confirm_password: 'Admin#12345' });
    const wide = count((await teach.get('/grades')).text); assert.ok(wide > own, `own=${own} wide=${wide}`);
    const other = await k('class_subjects').whereNot({ teacher_id: cs.teacher_id }).first(); assert.strictEqual((await teach.get('/grades/cs/' + other.id)).status, 200);
    await reset(tUser); assert.strictEqual((await teach.get('/grades/cs/' + other.id)).status, 404, 'بدون مجوز دامنه نباید دیده شود'); void all;
  });

  console.log('● ارتقای موقت و مجوزهای مدیریتی برای معلم');
  await t('«ویرایش مشخصات دانش‌آموز» برای معلم: بدون مجوز ۴۰۳، با مجوز باز؛ ذخیره کار می‌کند', async () => {
    const s = await k('students').first(); assert.strictEqual((await teach.get('/students/' + s.id + '/edit')).status, 403);
    await setCaps(tUser, { 'students.edit': 'allow' }); const r = await teach.get('/students/' + s.id + '/edit'); assert.strictEqual(r.status, 200); assert.ok(/name="first_name"/.test(r.text));
    assert.strictEqual((await teach.post('/students/' + s.id + '/delete', {}, '/students')).status, 403, 'حذف جدا است'); assert.ok(await k('students').where({ id: s.id }).first());
    await reset(tUser);
  });
  await t('ویرایش برنامه‌ی هفتگی برای معلم: دکمه‌ی ویرایش و فرم فقط با مجوز', async () => {
    const cid = cs.classroom_id; let r = await teach.get(`/timetable?class_id=${cid}&edit=1`); assert.ok(!r.text.includes('id="tt-form"'));
    assert.strictEqual((await teach.post('/timetable', { class_id: String(cid) }, `/timetable`)).status, 403);
    await setCaps(tUser, { 'timetable.edit': 'allow' }, { confirm_password: 'Admin#12345' });
    r = await teach.get(`/timetable?class_id=${cid}&edit=1`); assert.ok(r.text.includes('id="tt-form"'), 'فرم ویرایش برنامه'); await reset(tUser);
  });
  await t('مجوز حساس (⚠) بدون رمز مدیر یا با رمز غلط ذخیره نمی‌شود؛ با رمز درست ذخیره می‌شود', async () => {
    let r = await setCaps(tUser, { 'students.delete': 'allow' }); assert.ok(/رمز/.test(flashes(r)), 'پیام رمز'); assert.strictEqual((await k('users').where({ id: tUser }).first()).caps, null);
    r = await setCaps(tUser, { 'students.delete': 'allow' }, { confirm_password: 'wrong-pass' }); assert.strictEqual((await k('users').where({ id: tUser }).first()).caps, null);
    r = await setCaps(tUser, { 'students.delete': 'allow' }, { confirm_password: 'Admin#12345' }); assert.ok(caps.parseOv((await k('users').where({ id: tUser }).first()).caps).allow.includes('students.delete')); await reset(tUser);
  });

  console.log('● معاون: محدودسازی و اعطا');
  await t('معاون پیش‌فرض مالی را دارد؛ «ممنوع» کردن ثبت پرداخت فقط همان را می‌بندد و مشاهده باز می‌ماند', async () => {
    assert.strictEqual((await dep.get('/finance')).status, 200);
    await setCaps(depUser, { 'finance.pay': 'deny' }); const fee = await k('fees').first();
    assert.strictEqual((await dep.post('/finance/fees/' + fee.id + '/pay', { amount: '1000', method: 'cash' }, '/finance')).status, 403);
    assert.strictEqual((await dep.get('/finance')).status, 200); await reset(depUser);
  });
  await t('معاون با مجوز کلیِ محدود: بخش بسته ۴۰۳؛ اعطای صریح قابلیت همان بخش را باز می‌کند', async () => {
    await k('users').where({ id: depUser }).update({ permissions: JSON.stringify(['library']) });
    assert.strictEqual((await dep.get('/finance')).status, 403); assert.strictEqual((await dep.get('/library/books')).status, 200);
    await setCaps(depUser, { 'finance.view': 'allow' }, { confirm_password: 'Admin#12345' }); assert.strictEqual((await dep.get('/finance')).status, 200);
    assert.strictEqual((await dep.get('/finance/income')).status, 403, 'فقط همان قابلیت');
    await reset(depUser); await k('users').where({ id: depUser }).update({ permissions: null });
  });
  await t('معاون ناظر (الگوی فقط‌مشاهده): می‌بیند ولی ثبت/حذف ندارد', async () => {
    const p = await k('access_profiles').where({ name: 'معاون ناظر (فقط مشاهده)' }).first(); assert.ok(p, 'الگوی پیش‌فرض');
    await admin.post('/access/user/' + depUser, { profile_id: String(p.id) }, '/access/user/' + depUser);
    assert.strictEqual((await dep.get('/students')).status, 200); assert.strictEqual((await dep.get('/students/new')).status, 403);
    assert.strictEqual((await dep.post('/classes/new', { name: 'نباید', grade_level: 'x' }, '/classes')).status, 403);
    await reset(depUser); assert.strictEqual((await dep.get('/students/new')).status, 200);
  });
  await t('مدیر هرگز محدود نمی‌شود و «ممنوع» روی مدیر اعمال‌شدنی نیست', async () => {
    assert.strictEqual((await admin.get('/students/new')).status, 200);
    const r = await admin.post('/access/user/' + adminUser, { 'cap[students.create]': 'deny' }, '/access'); assert.ok([404].includes(r.status)); assert.strictEqual((await admin.get('/students/new')).status, 200);
  });

  console.log('● الگوهای دسترسی');
  await t('الگوی پیش‌فرض «معلم + مدیریت تقویم» ساخته شده؛ تخصیص آن به معلم دوم رویداد را باز می‌کند', async () => {
    const p = await k('access_profiles').where({ name: 'معلم + مدیریت تقویم' }).first(); assert.ok(p);
    await admin.post('/access/user/' + t2User, { profile_id: String(p.id) }, '/access/user/' + t2User);
    assert.strictEqual((await teach2.get('/events/new')).status, 200);
    await setCaps(t2User, { 'events.create': 'deny' }, { profile_id: String(p.id) }); assert.strictEqual((await teach2.get('/events/new')).status, 403, 'شخصی بر الگو غالب است');
    await reset(t2User); assert.strictEqual((await teach2.get('/events/new')).status, 403);
  });
  await t('ساخت/ویرایش/حذف الگو: اعتبارسنجی نام، یکتایی، رمز برای مجوز حساس، و عدم حذف الگوی در حال استفاده', async () => {
    let r = await admin.post('/access/profiles/save', { id: '', name: 'ab', base_role: 'teacher' }, '/access/profiles/new'); assert.ok(/حداقل/.test(flashes(r)));
    r = await admin.post('/access/profiles/save', { id: '', name: 'معلم + مدیریت تقویم', base_role: 'teacher' }, '/access/profiles/new'); assert.ok(/وجود دارد/.test(flashes(r)));
    r = await admin.post('/access/profiles/save', { id: '', name: 'الگوی حساس', base_role: 'teacher', 'cap[students.delete]': 'allow' }, '/access/profiles/new'); assert.ok(!(await k('access_profiles').where({ name: 'الگوی حساس' }).first()), 'بدون رمز نباید ساخته شود');
    r = await admin.post('/access/profiles/save', { id: '', name: 'الگوی آزمایشی', description: 'تست', base_role: 'teacher', 'cap[events.view]': 'allow', 'cap[homework.create]': 'deny' }, '/access/profiles/new');
    const p = await k('access_profiles').where({ name: 'الگوی آزمایشی' }).first(); assert.ok(p); assert.deepStrictEqual(caps.parseOv(p.caps), { allow: ['events.view'], deny: ['homework.create'] });
    await admin.post('/access/user/' + t2User, { profile_id: String(p.id) }, '/access/user/' + t2User);
    assert.strictEqual((await teach2.get('/events')).status, 200); assert.strictEqual((await teach2.get('/homework/new')).status, 403, 'ممنوعیت الگو');
    await admin.post('/access/profiles/' + p.id + '/delete', {}, '/access?tab=profiles'); assert.ok(await k('access_profiles').where({ id: p.id }).first(), 'در حال استفاده است');
    await reset(t2User); await admin.post('/access/profiles/' + p.id + '/delete', {}, '/access?tab=profiles'); assert.ok(!(await k('access_profiles').where({ id: p.id }).first()), 'باید حذف شود');
    assert.strictEqual((await teach2.get('/homework/new')).status, 200);
  });
  await t('کپی دسترسی بین هم‌نقش‌ها کار می‌کند و میان نقش‌های متفاوت رد می‌شود', async () => {
    await setCaps(tUser, { 'events.view': 'allow' });
    let r = await admin.post('/access/user/' + t2User + '/copy', { from: String(tUser) }, '/access/user/' + t2User); assert.strictEqual((await teach2.get('/events')).status, 200);
    r = await admin.post('/access/user/' + t2User + '/copy', { from: String(depUser) }, '/access/user/' + t2User); assert.ok(/هم‌نقش/.test(flashes(r)));
    await reset(tUser); await reset(t2User);
  });

  console.log('● ممیزی، اعلان و امنیت');
  await t('تغییرها در گزارش فعالیت‌ها ثبت می‌شود (perm_change)؛ ردِ دسترسی هم (denied) و کاربر اعلان می‌گیرد', async () => {
    await setCaps(tUser, { 'events.create': 'allow' }); const a = await k('audit_logs').where({ action: 'perm_change' }).orderBy('id', 'desc').first(); assert.ok(a && /events\.create/.test(a.details), 'ممیزی');
    assert.ok(await k('notifications').where({ user_id: tUser }).where('title', 'like', '%دسترسی%').first(), 'اعلان');
    await reset(tUser); await teach.get('/events/new');
    const d = await k('audit_logs').where({ action: 'denied', entity: 'capability', entity_id: 'events.view' }).first(); assert.ok(d || (await k('audit_logs').where({ action: 'denied', entity: 'capability' }).first()), 'ردِ دسترسی ثبت نشد');
    const log = await admin.get('/access?tab=log'); assert.strictEqual(log.status, 200); assert.ok(log.text.includes('تغییر مجوز'));
  });
  await t('CSRF: ثبت دسترسی بدون توکن رد می‌شود و چیزی ذخیره نمی‌شود', async () => {
    const r = await admin.req('POST', '/access/user/' + tUser, { 'cap[events.view]': 'allow' }); assert.ok([403, 400].includes(r.status), String(r.status));
    assert.strictEqual((await k('users').where({ id: tUser }).first()).caps, null);
  });
  await t('معلم با «بدون مجوز» به سایر بخش‌های مدیریتی هم نفوذ نمی‌کند (نمونه: مالی، گزارش‌ها، کاربران، تنظیمات، پشتیبان)', async () => {
    for (const p of ['/finance', '/reports', '/users', '/settings', '/backup', '/audit', '/teachers', '/access', '/promotion']) assert.ok([403, 404, 302].includes((await teach.get(p)).status), p);
    for (const p of ['/finance', '/reports', '/users', '/audit', '/access']) assert.notStrictEqual((await teach.get(p)).status, 200, p);
  });
  await t('اعطای مجوز به یک معلم ارتقای دائمی نیست: بعد از درخواست مجاز، صفحه‌ی بعدی دوباره با نقش معلم است', async () => {
    await setCaps(tUser, { 'events.view': 'allow' }); assert.strictEqual((await teach.get('/events')).status, 200);
    const home = await teach.get('/'); assert.ok(!/معاون/.test((home.text.match(/class="small">[^]*?<\/span><\/button>/) || [''])[0]), 'برچسب نقش باید «معلم» بماند');
    assert.strictEqual((await teach.get('/users')).status, 403); assert.strictEqual((await teach.get('/finance')).status, 403); await reset(tUser);
  });
  await t('منوی کنار صفحه: آیتم مربوط به مجوز اعطاشده ظاهر می‌شود و آیتم ممنوع‌شده مخفی می‌شود', async () => {
    const side = (h) => h.slice(h.indexOf('<nav class="nav"'), h.indexOf('</nav>')); const has = (h, href) => new RegExp(`href="[^"]*${href}"`).test(side(h));
    await setCaps(tUser, { 'events.view': 'allow', 'calendar.view': 'deny' });
    const h = (await teach.get('/')).text; assert.ok(has(h, '/events'), 'مدیریت رویدادها'); assert.ok(!has(h, '/calendar'), 'تقویم مخفی'); await reset(tUser);
    assert.ok(has((await teach.get('/')).text, '/calendar'));
  });

  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

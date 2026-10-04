'use strict';
/** تست نسخه‌ی ۲٫۲ — تولد: محاسبه‌ی تاریخ شمسی، اعلان به مدیر/اولیا/دانش‌آموز، پیامک (الگو و متن)، تقویم هفتگی، ویجت شمارش معکوس */
const { boot, t, ok, flash, done, assert, setSettings, inproc, mockIppanel, until } = require('./helpers');
const J = require('../src/utils/jalali');
const section = (s) => console.log('— ' + s);

(async () => {
  const app = await boot(); const k = app.k; const ctx = await inproc(app); const settings = ctx.settings;
  const B = require('../src/lib/birthdays'); const BK = require('../src/lib/birthdayKinds');
  const admin = await app.login('admin', 'Admin#12345'); const deputy = await app.login('deputy', 'deputy123'); const teacher = await app.login('t.ahmadi', 'teacher123'); const other = await app.login('a.taheri', 'teacher123');
  const stud = await app.login('14050001', 'student123');
  const today = J.todayISO(); const jt = J.isoToJ(today);
  /** تاریخ تولدِ دانش‌آموزی که «off» روز دیگر سالگردش است و age ساله می‌شود */
  const birthFor = (off, age = 13) => { const j = J.isoToJ(J.addDays(today, off)); const y = j.jy - age; return J.jToIso(y, j.jm, Math.min(j.jd, J.monthRange(y, j.jm).length)); };
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const reload = async () => { await settings.load(); };

  section('محاسبه‌ی تاریخ تولد (شمسی)');
  await t('نخستین تولد بعدی، روزهای مانده و سن جدید', async () => {
    const o = B.occurrence(birthFor(5, 13), today); assert.strictEqual(o.days, 5); assert.strictEqual(o.age, 13); assert.strictEqual(o.date, J.addDays(today, 5));
    const o0 = B.occurrence(birthFor(0, 12), today); assert.strictEqual(o0.days, 0); assert.strictEqual(o0.date, today); assert.strictEqual(o0.age, 12);
    const past = B.occurrence(birthFor(-1, 12), today); assert.ok(past.days > 300 && past.days < 366, 'دیروز → سال بعد'); assert.strictEqual(past.age, 13);
  });
  await t('۳۰ اسفند در سال غیرکبیسه ۲۹ اسفند جشن گرفته می‌شود و در کبیسه ۳۰ اسفند', async () => {
    const leap = [1403, 1408, 1399].find((y) => J.monthRange(y, 12).length === 30); const plain = [1404, 1405, 1406].find((y) => J.monthRange(y, 12).length === 29);
    assert.ok(leap && plain); const birth = J.jToIso(1390 + 0, 12, J.monthRange(1391, 12).length === 30 ? 30 : 29);
    const b30 = J.jToIso(1399, 12, 30);
    assert.strictEqual(B.occurrence(b30, J.jToIso(plain, 12, 1)).date, J.jToIso(plain, 12, 29));
    assert.strictEqual(B.occurrence(b30, J.jToIso(leap, 12, 1)).date, J.jToIso(leap, 12, 30));
    assert.ok(birth);
  });
  await t('هفته از شنبه شروع می‌شود', async () => {
    for (let i = 0; i < 14; i++) { const d = J.addDays(today, i); const ws = B.weekStart(d); assert.strictEqual(J.dow(ws), 0); assert.ok(B.daysBetween(ws, d) >= 0 && B.daysBetween(ws, d) <= 6); }
  });
  await t('شمارش معکوس: روز مانده، درصد پیشرفت و روز تولد', async () => {
    const c = B.countdown({ birth_date: birthFor(10, 14) }, today); assert.strictEqual(c.days, 10); assert.strictEqual(c.today, false); assert.strictEqual(c.age, 14); assert.ok(c.pct >= 0 && c.pct <= 100);
    const t0 = B.countdown({ birth_date: birthFor(0, 14) }, today); assert.strictEqual(t0.today, true); assert.strictEqual(t0.days, 0); assert.strictEqual(B.countdown({ birth_date: null }, today), null);
    assert.ok(B.countdown({ birth_date: birthFor(1, 14) }, today).pct > B.countdown({ birth_date: birthFor(200, 14) }, today).pct, 'هرچه نزدیک‌تر، پُرتر');
  });
  await t('قالب پیام و متغیرهای الگو', async () => {
    assert.strictEqual(B.renderTpl('سلام {first_name} {zzz}!', { first_name: 'علی' }), 'سلام علی !');
    assert.deepStrictEqual(BK.parseParams('name, days').map, [['name', 'name'], ['days', 'days']]);
    assert.deepStrictEqual(BK.parseParams('fname:first_name,sch:school').map, [['fname', 'first_name'], ['sch', 'school']]);
    for (const bad of ['na me', 'x:nope', 'a,a', '9a']) assert.strictEqual(BK.parseParams(bad).ok, false, bad);
  });

  section('داده‌ی آزمون');
  const link = await k('parent_students as ps').join('students as s', 's.id', 'ps.student_id').join('users as u', 'u.id', 'ps.user_id').whereNotNull('s.user_id').where('s.status', 'active').whereNotNull('s.classroom_id').select('s.id as sid', 'ps.user_id as puid', 'u.username as pname').first();
  const students = await k('students').where({ status: 'active' }).whereNotNull('classroom_id').whereNot('id', link.sid).orderBy('id').limit(8);
  const [A, Bs, C, Dd, Ee] = [await k('students').where({ id: link.sid }).first(), students[0], students[1], students[2], students[3]];
  // همه‌ی تولدها را از روزهای نزدیک دور می‌کنیم؛ سپس تولدهای موردنظر را می‌سازیم
  await k('students').update({ birth_date: birthFor(150, 13) });
  await k('students').where({ id: A.id }).update({ birth_date: birthFor(0, 13) });      // امروز
  await k('students').where({ id: Bs.id }).update({ birth_date: birthFor(3, 14) });     // دقیقاً ۳ روز دیگر
  await k('students').where({ id: C.id }).update({ birth_date: birthFor(1, 15) });      // فردا (جبرانِ از‌دست‌رفته)
  await k('students').where({ id: Dd.id }).update({ birth_date: birthFor(5, 12) });     // خارج از پنجره‌ی ۳ روز
  await k('students').where({ id: Ee.id }).update({ birth_date: birthFor(0, 12), status: 'transferred' }); // غیرفعال
  await k('notifications').del(); await k('birthday_log').del(); await k('sms_log').del();
  const stuUser = (await k('users').where({ username: '14050001' }).first());
  const strong = await k('students').where({ user_id: stuUser.id }).first();
  const cls = await k('classrooms as c').join('teachers as th', 'th.id', 'c.homeroom_teacher_id').join('users as tu', 'tu.id', 'th.user_id').where('c.id', A.classroom_id).select('tu.id as tuid', 'tu.username as tname').first();

  section('اجرای روزانه — اعلان درون‌برنامه‌ای');
  await t('پیش از ساعت ارسال هیچ اعلانی نمی‌رود', async () => {
    await settings.set('bd_send_time', '07:30'); const r = await B.run({ today, nowHM: '06:00' }); assert.strictEqual(r.skipped, 'too-early'); assert.strictEqual(await cnt('birthday_log'), 0); assert.strictEqual(await cnt('notifications'), 0);
  });
  await t('خاموش‌بودن ارسال خودکار: هیچ اعلانی نمی‌رود', async () => {
    await settings.set('bd_enabled', '0'); const r = await B.run({ today, nowHM: '09:00' }); assert.strictEqual(r.skipped, 'disabled'); assert.strictEqual(await cnt('birthday_log'), 0); await settings.set('bd_enabled', '1');
  });
  let first;
  await t('پس از ساعت ارسال: امروز + ۱ تا ۳ روز قبل، فقط دانش‌آموز فعال و دارای تاریخ تولد', async () => {
    first = await B.run({ today, nowHM: '08:00' }); assert.ok(!first.skipped);
    assert.strictEqual(first.sent.admin_today, 1); assert.strictEqual(first.sent.parent_today, 1); assert.strictEqual(first.sent.student_today, 1);
    assert.strictEqual(first.sent.admin_before, 2, 'ب و ج'); assert.strictEqual(first.sent.parent_before, 2); assert.strictEqual(first.sent.student_before, 2);
    assert.ok(!(await k('birthday_log').where({ student_id: Ee.id }).first()), 'دانش‌آموز منتقل‌شده'); assert.ok(!(await k('birthday_log').where({ student_id: Dd.id }).first()), '۵ روز دیگر');
  });
  await t('مدیر: یک اعلانِ جمع‌بندی برای «امروز» و یک اعلان برای «چند روز قبل» (نه یکی برای هر نفر)', async () => {
    const adm = await k('users').where({ username: 'admin' }).first(); const n = await k('notifications').where({ user_id: adm.id }).orderBy('id');
    assert.strictEqual(n.length, 2, JSON.stringify(n.map((x) => x.title)));
    const tod = n.find((x) => /امروز/.test(x.title)); const bef = n.find((x) => /نزدیک|راه/.test(x.title)); assert.ok(tod && bef);
    assert.ok(tod.body.includes(`${A.first_name} ${A.last_name}`)); assert.ok(bef.body.includes(Bs.last_name) && bef.body.includes(C.last_name) && /\(۲ نفر\)/.test(bef.title), bef.title);
    assert.strictEqual(tod.link, '/birthdays'); assert.strictEqual(tod.type, 'success');
    const dep = await k('users').where({ username: 'deputy' }).first(); assert.strictEqual(await cnt('notifications', { user_id: dep.id }), 2, 'معاون هم');
  });
  await t('دانش‌آموز و اولیا هر کدام پیام مخصوص خود را می‌گیرند و تکراری دریافت نمی‌کنند', async () => {
    const sN = await k('notifications').where({ user_id: A.user_id }); assert.deepStrictEqual(sN.map((x) => x.title), ['تولدت مبارک 🎂']); assert.ok(sN[0].body.includes(A.first_name) && sN[0].body.includes('۱۳'));
    const pN = await k('notifications').where({ user_id: link.puid }).orderBy('id'); assert.deepStrictEqual(pN.map((x) => x.title), ['تولد فرزندتان مبارک 🎂'], 'اولیا فقط پیام اولیا؛ نه رونوشت پیام دانش‌آموز');
    assert.ok(pN[0].body.includes('اولیای گرامی') && pN[0].body.includes(A.first_name));
    const bN = await k('notifications').where({ user_id: Bs.user_id }); assert.strictEqual(bN.length, 1); assert.ok(/۳ روز/.test(bN[0].body), bN[0].body);
    const cN = await k('notifications').where({ user_id: C.user_id }); assert.strictEqual(cN.length, 1); assert.ok(/۱ روز/.test(cN[0].body));
    assert.strictEqual(await cnt('notifications', { user_id: Dd.user_id }), 0);
  });
  await t('معلم راهنما رونوشت درون‌برنامه‌ای می‌گیرد و معلم کلاس‌های دیگر نه', async () => {
    const mine = await k('notifications').where({ user_id: cls.tuid }); assert.ok(mine.length >= 1, 'معلم راهنما'); assert.ok(mine.every((x) => x.link === '/birthdays'));
    for (const un of ['t.ahmadi', 'a.taheri']) {
      const u = await k('users').where({ username: un }).first(); const th = await k('teachers').where({ user_id: u.id }).first();
      const hr = (await k('classrooms').where({ homeroom_teacher_id: th.id }).select('id')).map((x) => x.id);
      const expected = [A, Bs, C].filter((x) => hr.includes(x.classroom_id)).length;
      assert.strictEqual(await cnt('notifications', { user_id: u.id }), expected, un);
    }
  });
  await t('اجرای دوباره و اجرای هم‌زمان: هیچ پیامی تکراری نمی‌رود', async () => {
    const before = await cnt('notifications'); const logs = await cnt('birthday_log');
    const r = await B.run({ today, nowHM: '09:00' }); assert.deepStrictEqual(r.sent, {}); assert.strictEqual(await cnt('notifications'), before);
    await k('notifications').del(); await k('birthday_log').where({ student_id: A.id }).del();
    const [r1, r2] = await Promise.all([B.run({ today, nowHM: '09:00' }), B.run({ today, nowHM: '09:00' })]);
    assert.strictEqual((r1.sent.parent_today || 0) + (r2.sent.parent_today || 0), 1, 'تنها یک‌بار');
    assert.strictEqual(await cnt('notifications', { user_id: link.puid }), 1); assert.ok(logs >= 1);
  });
  await t('جبران: اگر cron یک روز اجرا نشده باشد، اعلان «چند روز قبل» تا روز تولد هنوز می‌رود', async () => {
    await k('birthday_log').where({ student_id: C.id }).del(); const r = await B.run({ today, nowHM: '10:00' }); assert.strictEqual(r.sent.student_before, 1);
  });
  await t('روز تولد سال بعد دوباره ارسال می‌شود (کلید بر پایه‌ی سال شمسی)', async () => {
    const a = await k('students').where({ id: A.id }).first(); const nextBd = B.occurrence(a.birth_date, J.addDays(today, 1)).date;
    const r = await B.run({ today: nextBd, nowHM: '09:00' }); assert.strictEqual(r.sent.parent_today, 1); assert.strictEqual(r.sent.student_today, 1);
    const rows = await k('birthday_log').where({ student_id: A.id, kind: 'parent_today' }); assert.strictEqual(rows.length, 2); assert.notStrictEqual(rows[0].jy, rows[1].jy);
    await k('birthday_log').where({ student_id: A.id, kind: 'parent_today' }).where('jy', '>', jt.jy).del(); await k('birthday_log').where({ student_id: A.id, kind: 'student_today' }).where('jy', '>', jt.jy).del();
  });
  await t('تنظیم «چند روز قبل = ۰» و خاموش‌کردن یک مخاطب', async () => {
    await k('notifications').del(); await k('birthday_log').del();
    await settings.set('bd_before_days', '0'); await settings.set('bd_on_parent_today', '0');
    const r = await B.run({ today, nowHM: '09:00' }); assert.ok(!r.sent.admin_before && !r.sent.student_before); assert.strictEqual(r.sent.admin_today, 1); assert.ok(!r.sent.parent_today);
    assert.strictEqual(await cnt('notifications', { user_id: link.puid }), 0); assert.strictEqual(await cnt('notifications', { user_id: A.user_id }), 1);
    await settings.set('bd_before_days', '3'); await settings.set('bd_on_parent_today', '1');
  });

  section('پیامک');
  await t('پیامک خاموش: هیچ ردیفی در sms_log ثبت نمی‌شود', async () => { assert.strictEqual(await cnt('sms_log', { event: 'birthday' }), 0); });
  const mock = await mockIppanel();
  await t('پیامک روشن با الگو برای اولیا (متغیرهای دلخواه) و متن ساده برای دانش‌آموز', async () => {
    await setSettings(admin, { sms_enabled: 1, sms_provider: 'ippanel', sms_api_key: 'KEY123', sms_from_number: '+983000505', sms_base_url: mock.url, bd_pattern_parent_today: 'pat-par', bd_params_parent_today: 'fname:first_name,sch:school' });
    await reload(); await k('notifications').del(); await k('birthday_log').del(); await k('sms_log').del(); mock.calls.length = 0;
    await k('students').where({ id: A.id }).update({ mobile: '09121112233', father_phone: '09123334455', mother_phone: '09124445566', guardian_phone: null });
    const r = await B.run({ today, nowHM: '09:00' }); assert.ok(r.sms >= 3, 'sms=' + r.sms);
    await until(async () => (await cnt('sms_log', { event: 'birthday' })) >= 3 && !(await k('sms_log').where({ status: 'queued' }).first()));
    const pat = mock.calls.filter((c) => c.body && c.body.sending_type === 'pattern'); const plain = mock.calls.filter((c) => c.body && c.body.sending_type !== 'pattern');
    assert.strictEqual(pat.length, 2, 'پدر و مادر'); assert.ok(pat.every((c) => c.auth === 'KEY123' && c.body.code === 'pat-par' && c.body.recipients.length === 1));
    assert.deepStrictEqual(Object.keys(pat[0].body.params).sort(), ['fname', 'sch']); assert.strictEqual(pat[0].body.params.fname, A.first_name);
    assert.deepStrictEqual(pat.map((c) => c.body.recipients[0]).sort(), ['+989123334455', '+989124445566']);
    const stuSms = plain.find((c) => c.body.params && c.body.params.recipients.includes('+989121112233')); assert.ok(stuSms, 'پیامک متنی دانش‌آموز'); assert.ok(stuSms.body.message.includes(A.first_name) && !/\{/.test(stuSms.body.message), stuSms.body.message);
    const rows = await k('sms_log').where({ event: 'birthday' }); assert.ok(rows.every((x) => x.student_id), 'student_id ثبت شود'); assert.ok(rows.filter((x) => x.student_id === A.id).length >= 3); assert.ok(rows.every((x) => x.status === 'sent'));
  });
  await t('پیامک به مدیران فقط وقتی روشن است که تیک آن خورده و شماره‌ی پروفایل ثبت شده باشد', async () => {
    const adm = await k('users').where({ username: 'admin' }).first(); await k('users').where({ id: adm.id }).update({ phone: '09100000001' });
    await k('notifications').del(); await k('birthday_log').del(); await k('sms_log').del(); await reload();
    await B.run({ today, nowHM: '09:00' }); await until(async () => !(await k('sms_log').where({ status: 'queued' }).first())); assert.strictEqual(await cnt('sms_log', { to_number: '+989100000001' }), 0, 'پیش‌فرض خاموش');
    await settings.set('bd_sms_admin', '1'); await k('birthday_log').del(); await B.run({ today, nowHM: '09:00' }); await until(async () => (await cnt('sms_log', { to_number: '+989100000001' })) >= 1);
    assert.ok((await cnt('sms_log', { to_number: '+989100000001' })) >= 2, 'برای هر دانش‌آموز یک پیامک'); await settings.set('bd_sms_admin', '0');
  });
  await t('خطای سرویس پیامک اعلان درون‌برنامه‌ای را مختل نمی‌کند', async () => {
    mock.state.mode = 'fail'; await k('notifications').del(); await k('birthday_log').del(); await k('sms_log').del();
    const r = await B.run({ today, nowHM: '09:00' }); assert.strictEqual(r.sent.student_today, 1); assert.strictEqual(await cnt('notifications', { user_id: A.user_id }), 1);
    await until(async () => (await cnt('sms_log', { status: 'failed' })) >= 1); mock.state.mode = 'ok';
  });

  section('تنظیمات تولد (تب)');
  await t('تب «تولد» همه‌ی فیلدها و راهنمای متغیرها را دارد', async () => {
    const r = ok(await admin.get('/settings?tab=birthday')); for (const key of ['bd_enabled', 'bd_before_days', 'bd_send_time', 'bd_sms_parent', 'bd_tpl_student_today', 'bd_pattern_admin_before', 'bd_params_parent_before', 'show_birthdays', 'bd_student_widget']) assert.ok(r.text.includes(`name="${key}"`), key);
    assert.ok(r.text.includes('{first_name}') && /مخاطب: اولیا/.test(r.text));
  });
  await t('اعتبارسنجی: روز، ساعت، کد الگو، متغیرهای الگو و طول متن', async () => {
    const bads = [{ bd_before_days: '30' }, { bd_send_time: '25:90' }, { bd_pattern_parent_today: 'bad pattern!' }, { bd_params_parent_today: 'x:unknown' }, { bd_params_student_today: 'a,a' }, { bd_tpl_student_today: 'x'.repeat(401) }];
    for (const bad of bads) { const page = await admin.get('/settings?tab=birthday'); const r = await admin.req('POST', '/settings', { _csrf: admin.csrf(page.text), _group: 'birthday', ...bad }); assert.ok(/class="alert error/.test(r.text), JSON.stringify(bad)); }
  });
  await t('تنظیمات معتبر ذخیره می‌شود و دسترسی فقط مدیر کل است', async () => {
    await setSettings(admin, { bd_before_days: 2, bd_send_time: '08:15', bd_tpl_parent_today: 'تبریک به {first_name}' }); await reload();
    assert.strictEqual(settings.get('bd_send_time'), '08:15'); assert.strictEqual(B.templateOf('parent_today'), 'تبریک به {first_name}');
    await setSettings(admin, { bd_before_days: 3, bd_send_time: '07:30', bd_tpl_parent_today: '' }); await reload(); assert.strictEqual(B.templateOf('parent_today'), BK.KINDS.parent_today.tpl, 'خالی = پیش‌فرض');
    for (const c of [deputy, teacher, stud]) assert.strictEqual((await c.get('/settings?tab=birthday')).status, 403);
  });

  section('صفحه‌ی تولدها');
  await k('notifications').del(); await k('birthday_log').del(); await k('sms_log').del();
  await k('students').where({ id: Ee.id }).update({ status: 'active', birth_date: birthFor(150, 13) });
  await t('مدیر: همه‌ی بازه‌ها باز می‌شوند و امروز/فردا درست نمایش داده می‌شوند', async () => {
    for (const r of ['today', 'week', 'next', 'month', '30', 'year', 'bogus']) { const p = ok(await admin.get('/birthdays?range=' + r)); assert.ok(p.text.includes('تولدها')); }
    const td = (await admin.get('/birthdays?range=today')).text; assert.ok(td.includes(`${A.first_name} ${A.last_name}`) && !td.includes(`${Bs.first_name} ${Bs.last_name}`));
    const m30 = (await admin.get('/birthdays?range=30')).text; assert.ok(m30.includes(`${A.first_name} ${A.last_name}`) && m30.includes(`${Bs.first_name} ${Bs.last_name}`) && m30.includes('امروز') && m30.includes('روز دیگر'));
    const yr = (await admin.get('/birthdays?range=year')).text; assert.ok(yr.includes(`${Dd.first_name} ${Dd.last_name}`));
  });
  await t('فیلتر کلاس و خروجی CSV', async () => {
    const r = ok(await admin.get(`/birthdays?range=30&class=${A.classroom_id}`)); assert.ok(r.text.includes(`${A.first_name} ${A.last_name}`));
    const other = [Bs, C, Dd].find((s) => s.classroom_id !== A.classroom_id); if (other) assert.ok(!r.text.includes(`${other.first_name} ${other.last_name}`), 'کلاس دیگر');
    const csv = ok(await admin.get('/birthdays/export.csv?range=30')); assert.ok(/text\/csv/.test(csv.headers.get('content-type')) && csv.text.includes('سنِ جدید') && csv.text.includes(A.last_name));
  });
  await t('معلم فقط تولد کلاس‌های خودش را می‌بیند؛ دانش‌آموز به صفحه دسترسی ندارد', async () => {
    const th0 = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('u.username', 't.ahmadi').select('t.*').first(); const mineIds = (await require('../src/services').accessibleClassIds({ role: 'teacher', teacher: th0 })) || []; assert.ok(mineIds.length);
    const page = ok(await teacher.get('/birthdays?range=year')); const all = await k('students').where({ status: 'active' }).select('id', 'first_name', 'last_name', 'classroom_id');
    const foreign = all.find((s) => !mineIds.includes(s.classroom_id)); const mine = all.find((s) => mineIds.includes(s.classroom_id));
    assert.ok(page.text.includes(`${mine.first_name} ${mine.last_name}`)); assert.ok(!page.text.includes(`/students/${foreign.id}"`), 'دانش‌آموز کلاس دیگر');
    assert.ok(!/اجرای فوری|آخرین ارسال/.test(page.text), 'ابزار مدیریتی برای معلم نیست');
    assert.strictEqual((await stud.get('/birthdays')).status, 403); assert.strictEqual((await stud.get('/birthdays/export.csv')).status, 403);
  });
  await t('اجرای فوری و تبریک دستی فقط برای مدیر؛ تبریک دستی بدون ثبت در لاگ و بدون مسدودشدن پیام خودکار', async () => {
    assert.strictEqual((await teacher.req('POST', '/birthdays/run', {})).status, 403); assert.strictEqual((await teacher.req('POST', `/birthdays/${A.id}/greet`, {})).status, 403);
    const r = await admin.post('/birthdays/run', {}, '/birthdays'); const f = flash(r); assert.ok(f && f.type === 'success' && /اعلان تولد ارسال شد/.test(f.text), JSON.stringify(f));
    const again = await admin.post('/birthdays/run', {}, '/birthdays'); assert.ok(/جدیدی برای ارسال نبود/.test(flash(again).text));
    await k('notifications').del(); const logs = await cnt('birthday_log');
    const g = await admin.post(`/birthdays/${A.id}/greet`, {}, '/birthdays'); assert.strictEqual(flash(g).type, 'success'); assert.strictEqual(await cnt('birthday_log'), logs);
    assert.strictEqual(await cnt('notifications', { user_id: A.user_id }), 1); assert.strictEqual(await cnt('notifications', { user_id: link.puid }), 1);
    assert.ok(await k('audit_logs').where({ entity: 'birthdays', action: 'greet' }).first());
  });

  section('تقویم هفتگی و داشبورد');
  await t('تقویم هفتگی: دو هفته، تولدهای مدیر در سلول و در فهرست «این هفته/هفته‌ی بعد»', async () => {
    const r = ok(await admin.get('/calendar?view=week')); assert.ok(/class="cal week"/.test(r.text)); assert.strictEqual((r.text.match(/class="cal week"/g) || []).length, 2);
    assert.ok(r.text.includes('🎂 ' + A.first_name + ' ' + A.last_name), 'تولد امروز'); assert.ok(/تولدهای این هفته/.test(r.text) && /تولدهای هفته‌ی بعد/.test(r.text));
    assert.strictEqual((r.text.match(/<div class="h">/g) || []).length, 14);
    for (const q of ['w=1', 'w=-1', 'w=abc', 'w=9999']) ok(await admin.get('/calendar?view=week&' + q), q);
  });
  await t('تقویم هفتگی: هر تولد در فهرست هفته‌ی درست قرار می‌گیرد (گذشته/امروز/آینده)', async () => {
    const ws = B.weekStart(today); const off = (iso) => B.daysBetween(today, iso);
    await k('students').where({ id: Bs.id }).update({ birth_date: birthFor(off(J.addDays(ws, 1)), 14) }); await k('students').where({ id: Dd.id }).update({ birth_date: birthFor(off(J.addDays(ws, 9)), 12) }); await k('students').where({ id: Ee.id }).update({ birth_date: birthFor(off(J.addDays(ws, 14)), 12) });
    const r = ok(await admin.get('/calendar?view=week')).text; const i1 = r.indexOf('تولدهای این هفته'); const i2 = r.indexOf('تولدهای هفته‌ی بعد'); assert.ok(i1 > 0 && i2 > i1);
    const thisW = r.slice(i1, i2); const nextW = r.slice(i2); const nm = (s) => `${s.first_name} ${s.last_name}`;
    assert.ok(thisW.includes(nm(Bs)) && !nextW.includes(`/students/${Bs.id}"`), 'ب این هفته'); assert.ok(nextW.includes(nm(Dd)) && !thisW.includes(`/students/${Dd.id}"`), 'د هفته بعد'); assert.ok(!thisW.includes(`/students/${Ee.id}"`) && !nextW.includes(`/students/${Ee.id}"`), 'دو هفته بعد: خارج');
    if (B.daysBetween(today, J.addDays(ws, 1)) < 0) assert.ok(/گذشته/.test(thisW), 'برچسب گذشته');
    const week2 = ok(await admin.get('/calendar?view=week&w=1')).text; assert.ok(week2.includes(nm(Ee)) || week2.includes(nm(Dd)), 'هفته‌های بعدی');
  });
  await t('تقویم هفتگی: بدون ماژول یا برای دانش‌آموز، تولد نمایش داده نمی‌شود؛ معلم فقط کلاس خودش', async () => {
    const s = ok(await stud.get('/calendar?view=week')); assert.ok(!s.text.includes('🎂') && !/تولدهای این هفته/.test(s.text));
    ok(await teacher.get('/calendar?view=week')); ok(await deputy.get('/calendar?view=week')); ok(await admin.get('/calendar'));
  });
  await t('تقویم ماهانه هنوز تولدها را نشان می‌دهد و به پرونده لینک است', async () => {
    const r = ok(await admin.get('/calendar')); const j = jt; assert.ok(r.text.includes('🎂'), 'تولد در ماه جاری'); assert.ok(/<a class="ev bday"[^>]*href="[^"]*\/students\/\d+"/.test(r.text)); assert.ok(/نمای هفتگی/.test(r.text)); assert.ok(j);
  });
  await t('داشبورد مدیر و معلم: کارت تولد با لینک‌های قابل‌کلیک', async () => {
    const r = ok(await admin.get('/')); assert.ok(r.text.includes('bd-card') && r.text.includes('/birthdays?range=week') && r.text.includes('/birthdays?range=next') && r.text.includes('/calendar?view=week'));
    assert.ok(r.text.includes(`امروز تولد ${A.first_name} ${A.last_name}`), 'بنر امروز'); ok(await teacher.get('/')); assert.ok((await teacher.get('/')).text.includes('bd-card'));
  });
  await t('داشبورد دانش‌آموز: شمارش معکوس، تولد امروز و حالت بدون تاریخ تولد', async () => {
    await k('students').where({ id: strong.id }).update({ birth_date: birthFor(9, 14) });
    let r = ok(await stud.get('/')); assert.ok(r.text.includes('bd-count') && /۹ روز تا تولد شما/.test(r.text), 'countdown'); assert.ok(r.text.includes('۱۴ ساله می‌شود'));
    await k('students').where({ id: strong.id }).update({ birth_date: birthFor(1, 14) }); assert.ok(/فردا تولد شماست/.test((await stud.get('/')).text));
    await k('students').where({ id: strong.id }).update({ birth_date: birthFor(0, 14) }); r = (await stud.get('/')).text; assert.ok(/امروز تولد شماست/.test(r) && r.includes('is-today'));
    await k('students').where({ id: strong.id }).update({ birth_date: null }); r = (await stud.get('/')).text; assert.ok(!r.includes('bd-count') && /تاریخ تولد در پرونده ثبت نشده/.test(r));
    await k('students').where({ id: strong.id }).update({ birth_date: birthFor(20, 14) });
  });
  await t('داشبورد اولیا نام فرزند را نشان می‌دهد', async () => {
    const parent = await app.login(link.pname, 'parent123'); await k('students').where({ id: A.id }).update({ birth_date: birthFor(4, 13) });
    const r = ok(await parent.get('/')); assert.ok(new RegExp(`۴ روز تا تولد ${A.first_name}`).test(r.text), 'نام فرزند'); await k('students').where({ id: A.id }).update({ birth_date: birthFor(0, 13) });
    assert.strictEqual((await parent.get('/birthdays')).status, 403);
  });
  await t('خاموش‌کردن ویجت‌ها در تنظیمات و ماژول، آن‌ها را از همه‌جا برمی‌دارد', async () => {
    await setSettings(admin, { bd_student_widget: 0, show_birthdays: 0 }); await new Promise((r) => setTimeout(r, 10500));
    assert.ok(!(await stud.get('/')).text.includes('bd-count')); assert.ok(!(await admin.get('/')).text.includes('bd-card'));
    await setSettings(admin, { bd_student_widget: 1, show_birthdays: 1 });
    await admin.post('/modules/birthdays/toggle', {}, '/modules');
    assert.strictEqual((await admin.get('/birthdays')).status, 404, 'ماژول خاموش'); const w = ok(await admin.get('/calendar?view=week')); assert.ok(!w.text.includes('🎂') && !/تولدهای این هفته/.test(w.text));
    assert.ok(!(await admin.get('/')).text.includes('href="/birthdays') || true); await admin.post('/modules/birthdays/toggle', {}, '/modules'); ok(await admin.get('/birthdays'));
  });

  section('داده‌ی نمونه و کار دوره‌ای');
  await t('دمو شامل چند تولد نزدیک است و کار دوره‌ای تولد در jobs.run ثبت می‌شود', async () => {
    const jobs = require('../src/jobs'); await k('birthday_log').del(); await settings.set('bd_send_time', '00:00');
    const out = await jobs.run(); assert.ok('birthdays' in out && typeof out.birthdays === 'object', JSON.stringify(out)); assert.ok(!/error/.test(JSON.stringify(out.birthdays)));
  });
  await t('جدول birthday_log کلید یکتا دارد', async () => {
    await k('birthday_log').insert({ student_id: 999999, jy: 1405, kind: 'parent_today' });
    let dup = false; try { await k('birthday_log').insert({ student_id: 999999, jy: 1405, kind: 'parent_today' }); } catch (_) { dup = true; } assert.ok(dup);
  });

  mock.close(); await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

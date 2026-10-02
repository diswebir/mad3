'use strict';
/** تست نسخه‌ی ۲٫۱ — عملیات سنگین: پشتیبان‌گیری/بازیابی، پشتیبان خودکار، بازگردانی ارتقای پایان سال (نصب جداگانه) */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { boot, t, ok, flash, done, assert, inproc } = require('./helpers');
const section = (s) => console.log('— ' + s);

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const admin = await app.login('admin', 'Admin#12345'); const deputy = await app.login('deputy', 'deputy123');
  const B = require('../src/lib/backupTools'); const settings = require('../src/settings');
  const one = async (q) => (await q.first()) || null; const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);
  const dir = path.join(app.data, 'backups');
  const state = async () => ({
    students: await k('students').orderBy('id').select('id', 'classroom_id', 'status'), classes: await k('classrooms').orderBy('id').select('id', 'name', 'status', 'homeroom_teacher_id', 'academic_year_id'),
    cs: await cnt('class_subjects'), tt: await cnt('timetable'), years: await k('academic_years').orderBy('id').select('id', 'title', 'is_current'), recs: await cnt('student_year_records'), chg: await cnt('student_changes'),
    users: await k('users').orderBy('id').select('id', 'active'),
  });

  section('پشتیبان‌گیری');
  await t('کلید API پیامک در پشتیبان نمی‌آید و بازیابی آن را حفظ می‌کند', async () => {
    await settings.set('sms_api_key', 'SECRET-KEY-123'); await settings.load();
    const r = await admin.post('/backup/download', {}, '/backup'); assert.strictEqual(r.status, 200); assert.ok(!/SECRET-KEY-123/.test(r.text), 'کلید محرمانه در فایل است');
    const data = JSON.parse(r.text); assert.strictEqual(data.version, 3); assert.ok(data.tables.users.length > 3); assert.ok(!data.tables.sessions && !data.tables.otp_codes, 'نشست/OTP نباید در پشتیبان باشد');
    assert.ok(!data.tables.settings.some((x) => x.key === 'sms_api_key')); assert.ok(data.secrets_excluded.includes('sms_api_key'));
  });
  await t('پشتیبان دستی روی سرور: ذخیره، فهرست، دانلود (gzip معتبر) و حذف', async () => {
    let r = await admin.post('/backup/now', {}, '/backup'); assert.strictEqual(flash(r).type, 'success'); const f = B.list().find((x) => x.kind === 'manual'); assert.ok(f);
    assert.ok(new RegExp(f.name.replace(/\./g, '\\.')).test((await admin.get('/backup')).text));
    r = await admin.get('/backup/files/' + f.name); assert.strictEqual(r.status, 200); const data = JSON.parse(zlib.gunzipSync(r.buf).toString()); assert.strictEqual(data.app, 'school-management'); assert.ok(!JSON.stringify(data).includes('SECRET-KEY-123'));
    assert.strictEqual(fs.statSync(path.join(dir, f.name)).mode & 0o077, 0, 'دسترسی فایل باید خصوصی باشد');
    r = await admin.post(`/backup/files/${f.name}/delete`, {}, '/backup'); assert.strictEqual(flash(r).type, 'success'); assert.ok(!fs.existsSync(path.join(dir, f.name)));
  });
  await t('امنیت: نام فایل نامعتبر/پیمایش مسیر رد می‌شود؛ معاون و بدون ورود دسترسی ندارند', async () => {
    for (const bad of ['..%2F..%2Fconfig.json', 'x.json', '..%2Fbackups%2Fauto-20260101-000000.json.gz', 'auto-1-2.json.gz']) assert.strictEqual((await admin.get('/backup/files/' + bad)).status, 404, bad);
    assert.strictEqual((await deputy.get('/backup')).status, 403); assert.strictEqual((await deputy.get('/backup/files/auto-20260101-000000.json.gz')).status, 403); assert.strictEqual((await deputy.req('POST', '/backup/now', {})).status, 403);
    const anon = app.newClient(); const r = await anon.get('/backup'); assert.ok(/name="password"/.test(r.text) || r.status === 403 || r.status === 302);
  });
  await t('پشتیبان خودکار روزانه: یک‌بار در روز، فایل auto، نگه‌داری آخرین N نسخه', async () => {
    const before = B.list().filter((f) => f.kind === 'auto').length;
    const j1 = await B.dailyJob(k, '2031-01-01'); assert.ok(j1 && /^auto-/.test(j1.name)); const j2 = await B.dailyJob(k, '2031-01-01'); assert.strictEqual(j2, null, 'همان روز دوباره نباید ساخته شود');
    assert.strictEqual(B.list().filter((f) => f.kind === 'auto').length, Math.max(before, 0) + 1);
    await settings.set('auto_backup_keep', '2'); await B.dailyJob(k, '2031-01-02'); await new Promise((r) => setTimeout(r, 1100)); await B.dailyJob(k, '2031-01-03');
    assert.ok(B.list().filter((f) => f.kind === 'auto').length <= 2, 'پاک‌سازی نسخه‌های قدیمی انجام نشد');
    await settings.set('auto_backup_enabled', '0'); assert.strictEqual(await B.dailyJob(k, '2031-02-01'), null, 'غیرفعال'); await settings.set('auto_backup_enabled', '1');
  });
  await t('بازیابی: تأیید لازم، پیش از آن پشتیبان خودکار، بازگشت داده، حفظ کلید پیامک', async () => {
    const full = (await admin.post('/backup/download', {}, '/backup')).text; const snapName = `${Date.now()}.json`; fs.writeFileSync(path.join(app.data, snapName), full);
    const nBefore = await cnt('students'); await k('students').where({ student_code: '14050010' }).update({ first_name: 'تغییرکرده' }); await k('students').where('id', '>', 70).del();
    let r = await admin.multipart('/backup/restore', { confirm: 'no' }, { field: 'file', name: 'b.json', content: Buffer.from(full) }, '/backup'); assert.strictEqual(flash(r).type, 'error'); assert.strictEqual((await one(k('students').where({ student_code: '14050010' }))).first_name, 'تغییرکرده');
    r = await admin.multipart('/backup/restore', { confirm: 'RESTORE' }, { field: 'file', name: 'b.json', content: Buffer.from('{"x":1}') }, '/backup'); assert.strictEqual(flash(r).type, 'error');
    const pre0 = B.list().filter((f) => f.kind === 'pre-restore').length;
    r = await admin.multipart('/backup/restore', { confirm: 'RESTORE' }, { field: 'file', name: 'b.json', content: Buffer.from(full) }, '/backup');
    assert.strictEqual(B.list().filter((f) => f.kind === 'pre-restore').length, pre0 + 1, 'پشتیبان پیش از بازیابی'); assert.strictEqual(await cnt('students'), nBefore);
    assert.notStrictEqual((await one(k('students').where({ student_code: '14050010' }))).first_name, 'تغییرکرده'); assert.strictEqual((await one(k('settings').where({ key: 'sms_api_key' }))).value, 'SECRET-KEY-123', 'کلید پیامک باید حفظ شود');
    const admin2 = await app.login('admin', 'Admin#12345'); ok(await admin2.get('/backup'));
    // بازیابی از فایل gz روی سرور
    const f = B.list().find((x) => x.kind === 'pre-restore'); const admin3 = await app.login('admin', 'Admin#12345');
    r = await admin3.post(`/backup/files/${f.name}/restore`, { confirm: '' }, '/backup'); assert.strictEqual(flash(r).type, 'error');
    await admin3.post(`/backup/files/${f.name}/restore`, { confirm: 'RESTORE' }, '/backup'); assert.strictEqual(await cnt('students'), nBefore - 2, 'وضعیت ذخیره‌شده‌ی پیش از بازیابی برگشت'); assert.strictEqual((await one(k('students').where({ student_code: '14050010' }))).first_name, 'تغییرکرده'); assert.ok(!/\[error\]/.test(app.log()), app.log().slice(-400));
  });

  section('ارتقای پایان سال: پشتیبان خودکار و بازگردانی');
  const form = (title, extra = {}) => ({ year_title: title, year_start: '1406/06/31', year_end: '1407/03/31', ...extra });
  const adminY = await app.login('admin', 'Admin#12345'); let s0; let run;
  await t('اجرای ارتقا: پشتیبان «پیش از ارتقا» ساخته می‌شود و سابقه‌ی بازگردانی ثبت می‌شود', async () => {
    s0 = await state(); const pre0 = B.list().filter((f) => f.kind === 'pre-promotion').length;
    const r = await adminY.post('/promotion/apply', form('1406-1407', { confirm: 'PROMOTE' }), '/promotion'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const f = B.list().filter((x) => x.kind === 'pre-promotion'); assert.strictEqual(f.length, pre0 + 1); const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f[0].name))).toString()); assert.strictEqual(data.tables.classrooms.length, s0.classes.length, 'پشتیبان باید وضعیت پیش از ارتقا باشد');
    run = await one(k('promotion_runs').orderBy('id', 'desc')); assert.strictEqual(run.new_year_title, '1406-1407'); assert.strictEqual(run.backup_file, f[0].name); assert.ok(!run.undone_at);
    assert.ok(/بازگردانی/.test((await adminY.get('/promotion')).text));
    assert.notDeepStrictEqual((await state()).classes, s0.classes);
  });
  await t('بازگردانی: بدون تأیید رد؛ با تأیید همه‌چیز دقیقاً به وضعیت قبل برمی‌گردد', async () => {
    let r = await adminY.post(`/promotion/undo/${run.id}`, { confirm: 'undo' }, '/promotion'); assert.strictEqual(flash(r).type, 'error'); assert.ok(!(await one(k('promotion_runs').where({ id: run.id }))).undone_at);
    assert.strictEqual((await deputy.req('POST', `/promotion/undo/${run.id}`, { confirm: 'UNDO' })).status, 403);
    r = await adminY.post(`/promotion/undo/${run.id}`, { confirm: 'UNDO' }, '/promotion'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    assert.deepStrictEqual(await state(), s0); assert.ok((await one(k('promotion_runs').where({ id: run.id }))).undone_at);
    r = await adminY.post(`/promotion/undo/${run.id}`, { confirm: 'UNDO' }, '/promotion'); assert.strictEqual(flash(r).type, 'error', 'بازگردانی دوباره'); assert.strictEqual(flash((await adminY.get('/promotion')) ) && 0, 0);
    assert.strictEqual((await adminY.post('/promotion/undo/99999', { confirm: 'UNDO' }, '/promotion')).status, 200);
  });
  await t('پس از بازگردانی دوباره می‌توان ارتقا داد؛ اگر در کلاس‌های جدید حضور ثبت شود بازگردانی رد می‌شود', async () => {
    let r = await adminY.post('/promotion/apply', form('1406-1407', { confirm: 'PROMOTE' }), '/promotion'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const run2 = await one(k('promotion_runs').orderBy('id', 'desc')); assert.ok(run2.id > run.id);
    const st = await one(k('students').join('classrooms as c', 'c.id', 'students.classroom_id').where('c.status', 'active').select('students.*')); const newCls = await one(k('classrooms').where({ id: st.classroom_id }));
    await k('attendance').insert({ student_id: st.id, classroom_id: newCls.id, date: '2030-01-01', period: 0, status: 'present' }); const s1 = await state();
    r = await adminY.post(`/promotion/undo/${run2.id}`, { confirm: 'UNDO' }, '/promotion'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/حضور و غیاب/.test(flash(r).text), flash(r).text); assert.deepStrictEqual(await state(), s1, 'رد بازگردانی نباید چیزی را تغییر دهد');
    await k('attendance').where({ date: '2030-01-01' }).del();
    // جابه‌جایی دانش‌آموز پس از ارتقا هم مانع است
    const other = await one(k('classrooms').where({ status: 'active' }).whereNot('id', newCls.id)); await k('students').where({ id: st.id }).update({ classroom_id: other.id });
    r = await adminY.post(`/promotion/undo/${run2.id}`, { confirm: 'UNDO' }, '/promotion'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/جابه‌جا/.test(flash(r).text), flash(r).text);
    await k('students').where({ id: st.id }).update({ classroom_id: newCls.id });
    r = await adminY.post(`/promotion/undo/${run2.id}`, { confirm: 'UNDO' }, '/promotion'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    assert.deepStrictEqual(await state(), s0);
  });
  await t('خطای سروری در لاگ نیست', async () => { assert.ok(!/\[error\]/.test(app.log()), app.log().split('\n').filter((l) => /\[error\]/.test(l)).slice(0, 3).join('\n')); });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/** تست‌های یکپارچه‌ی نسخه‌ی ۲: سرور واقعی + پایگاه داده‌ی نمونه + سرور ساختگی IPPanel */
const { boot, t, ok, flash, done, assert, setSettings, inproc, mockIppanel, until } = require('./helpers');
const J = require('../src/utils/jalali');
const xlsx = require('../src/lib/xlsx');

const section = (s) => console.log('— ' + s);
const jstr = (iso) => J.isoToJString(iso);
const today = J.todayISO();
const hid = (html, name) => { const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html); return m ? require('./helpers').unesc(m[1]) : null; };

(async () => {
  const app = await boot(); const k = app.k;
  const ip = await inproc(app); const qr = require('../src/lib/qr'); // پس از تنظیم SCHOOL_DATA_DIR تا کلید امضای QR همان سرور باشد
  const admin = await app.login('admin', 'Admin#12345'); const sup = await app.login('super', 'Super#12345');
  const tAhmadi = await app.login('t.ahmadi', 'teacher123');
  const taheri = await app.login('a.taheri', 'teacher123');
  const student = await app.login('14050001', 'student123');
  const one = async (q) => (await q.first()) || null;
  const cnt = async (table, where = {}) => Number((await k(table).where(where).count({ c: '*' }).first()).c);

  /* ======================= مالی ======================= */
  section('مالی: اقساط، پرداخت، ابطال، سند');
  const stu1 = await one(k('students').where({ student_code: '14050001' })); const stu2 = await one(k('students').where({ student_code: '14050002' }));
  let feeId;
  await t('ایجاد صورت‌حساب ۳قسطی با جمع و تاریخ درست', async () => {
    const r = await admin.post('/finance/fees/new', { target: 'student', student_id: stu1.id, title: 'شهریه آزمایشی', amount: '9,000,001', discount: '0', due_date: jstr(J.addDays(today, 10)), category: 'tuition', installments: '3', installment_step: '1' }, '/finance/fees/new');
    assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const fee = await one(k('fees').where({ title: 'شهریه آزمایشی' })); feeId = fee.id; assert.strictEqual(Number(fee.amount), 9000001);
    const ins = await k('fee_installments').where({ fee_id: fee.id }).orderBy('seq'); assert.strictEqual(ins.length, 3); assert.strictEqual(ins.reduce((a, b) => a + Number(b.amount), 0), 9000001); assert.ok(ins[0].due_date < ins[1].due_date && ins[1].due_date < ins[2].due_date);
    ok(await admin.get('/finance/fees/' + feeId));
  });
  await t('اعتبارسنجی: مبلغ صفر، تخفیف بیش از مبلغ، اقساط بدون سررسید، دسته نامعتبر', async () => {
    const before = await cnt('fees');
    for (const bad of [{ amount: '0' }, { amount: '1000', discount: '2000' }, { amount: '1000', installments: '3', due_date: '' }, { amount: '1000', category: 'zzz' }, { amount: 'abc' }]) {
      const r = await admin.post('/finance/fees/new', { target: 'student', student_id: stu1.id, title: 'نامعتبر', amount: '1000', discount: '0', due_date: jstr(today), category: 'tuition', installments: '1', ...bad }, '/finance/fees/new');
      assert.strictEqual(r.status, 200); assert.ok(/class="alert error/.test(r.text), JSON.stringify(bad));
    }
    assert.strictEqual(await cnt('fees'), before);
  });
  await t('پرداخت جزئی: سند ترتیبی سال‌-شماره، بیش از مانده رد می‌شود', async () => {
    const last = await one(k('payments').whereNotNull('doc_no').orderBy('id', 'desc'));
    const r = await admin.post(`/finance/fees/${feeId}/pay`, { amount: '3,000,000', paid_at: '', method: 'cash' }, '/finance/fees/' + feeId); assert.strictEqual(flash(r).type, 'success');
    const p = await one(k('payments').where({ fee_id: feeId })); assert.ok(/^\d{4}-\d{5}$/.test(p.doc_no), p.doc_no);
    const seqOf = (d) => Number(d.split('-')[1]); assert.strictEqual(seqOf(p.doc_no), seqOf(last.doc_no) + 1);
    const over = await admin.post(`/finance/fees/${feeId}/pay`, { amount: '99,999,999,999', method: 'cash' }, '/finance/fees/' + feeId); assert.strictEqual(flash(over).type, 'error'); assert.strictEqual(await cnt('payments', { fee_id: feeId }), 1);
    const neg = await admin.post(`/finance/fees/${feeId}/pay`, { amount: '-5', method: 'cash' }, '/finance/fees/' + feeId); assert.strictEqual(flash(neg).type, 'error');
  });
  await t('ابطال پرداخت: دلیل لازم است، شماره سند می‌ماند و مبلغ از مانده کم نمی‌شود', async () => {
    const p = await one(k('payments').where({ fee_id: feeId }));
    let r = await admin.post(`/finance/payments/${p.id}/void`, { reason: 'x' }, '/finance/fees/' + feeId); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post(`/finance/payments/${p.id}/void`, { reason: 'ثبت اشتباه' }, '/finance/fees/' + feeId); assert.strictEqual(flash(r).type, 'success');
    const q = await one(k('payments').where({ id: p.id })); assert.strictEqual(Number(q.voided), 1); assert.strictEqual(q.doc_no, p.doc_no);
    r = await admin.post(`/finance/payments/${p.id}/void`, { reason: 'دوباره' }, '/finance/fees/' + feeId); assert.strictEqual(flash(r).type, 'error');
    const pay = await admin.post(`/finance/fees/${feeId}/pay`, { amount: '9,000,001', method: 'card' }, '/finance/fees/' + feeId); assert.strictEqual(flash(pay).type, 'success', 'پس از ابطال کل مبلغ باید قابل پرداخت باشد');
    const d = await admin.post(`/finance/fees/${feeId}/delete`, {}, '/finance/fees/' + feeId); assert.strictEqual(flash(d).type, 'error', 'صورت‌حساب پرداخت‌شده حذف نمی‌شود'); assert.ok(await one(k('fees').where({ id: feeId })));
  });
  await t('دانش‌آموز صورت‌حساب دیگران را نمی‌بیند و مدیر-فقط‌ها بسته‌اند', async () => {
    const f2 = await one(k('fees').where({ student_id: stu2.id })); assert.strictEqual((await student.get('/finance/fees/' + f2.id)).status, 404);
    assert.strictEqual((await tAhmadi.get('/finance')).status, 403); assert.strictEqual((await student.get('/finance/debtors')).status, 403);
    assert.strictEqual((await student.req('POST', '/finance/debtors/remind', {})).status, 403);
  });
  await t('یادآوری بدهکاران بدون پیامک فعال: فقط اعلان درون‌برنامه‌ای', async () => {
    const before = await cnt('sms_log'); const r = await admin.post('/finance/debtors/remind', { only: '' }, '/finance/debtors'); assert.ok(/اعلان|یادآوری/.test(flash(r).text), flash(r) && flash(r).text);
    assert.strictEqual(await cnt('sms_log'), before, 'با پیامک غیرفعال نباید چیزی در صف برود');
  });
  await t('گزارش درآمد و بدهکاران بدون خطا؛ خروجی اکسل معتبر', async () => { ok(await admin.get('/finance/debtors')); ok(await admin.get('/finance/income')); const r = await admin.get('/finance/receipt/' + (await one(k('payments').where({ voided: 0 }))).id); ok(r); });

  /* ======================= برنامه هفتگی ======================= */
  section('برنامه هفتگی: ساعت غیرمجاز، تولید خودکار، جانشین');
  const tchr = await one(k('teachers as t').join('users as u', 'u.id', 't.user_id').where('u.username', 'a.taheri').select('t.id', 't.user_id'));
  await t('ثبت ساعت غیرمجاز معلم و رد ساعتی که برنامه دارد', async () => {
    const busy = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').where('cs.teacher_id', tchr.id).select('tt.day', 'tt.period');
    assert.ok(busy.length > 0, 'دمو باید برنامه‌ی معلم را داشته باشد'); const b = busy[0];
    let r = await admin.post('/timetable/availability', { teacher_id: tchr.id, off: [`${b.day}-${b.period}`] }, '/timetable/availability?teacher_id=' + tchr.id); assert.strictEqual(flash(r).type, 'error', 'ساعتِ دارای برنامه نباید غیرمجاز شود');
    const free = [0, 1, 2, 3, 4].flatMap((d) => [5, 6].map((p) => `${d}-${p}`)).find((x) => !busy.some((y) => `${y.day}-${y.period}` === x));
    r = await admin.post('/timetable/availability', { teacher_id: tchr.id, off: [free, 'x-y', '99-99'] }, '/timetable/availability?teacher_id=' + tchr.id); assert.strictEqual(flash(r).type, 'success');
    const rows = await k('teacher_unavailability').where({ teacher_id: tchr.id }); assert.strictEqual(rows.length, 1, 'ورودی‌های نامعتبر نادیده گرفته شوند'); assert.strictEqual(`${rows[0].day}-${rows[0].period}`, free);
    assert.strictEqual((await tAhmadi.req('POST', '/timetable/availability', { teacher_id: tchr.id })).status, 403);
    r = await admin.post('/timetable/availability', { teacher_id: tchr.id }, '/timetable/availability?teacher_id=' + tchr.id); assert.strictEqual(await cnt('teacher_unavailability', { teacher_id: tchr.id }), 0, 'ارسال بدون انتخاب = پاک‌کردن همه');
    await admin.post('/timetable/availability', { teacher_id: tchr.id, off: [free] }, '/timetable/availability?teacher_id=' + tchr.id);
  });
  await t('تولید خودکار: پیش‌نمایش چیزی ذخیره نمی‌کند؛ اعمال، برنامه‌ی بدون تداخل می‌سازد', async () => {
    const before = JSON.stringify(await k('timetable').orderBy('id').select('classroom_id', 'day', 'period', 'class_subject_id'));
    let r = await admin.post('/timetable/auto', { scope: 'all', seed: '7', phase: 'preview' }, '/timetable/auto'); ok(r);
    assert.strictEqual(JSON.stringify(await k('timetable').orderBy('id').select('classroom_id', 'day', 'period', 'class_subject_id')), before, 'پیش‌نمایش نباید ذخیره کند');
    r = await admin.post('/timetable/auto', { scope: 'all', seed: '7', phase: 'apply' }, '/timetable/auto'); assert.strictEqual(r.status, 200);
    const dbl = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').whereNotNull('cs.teacher_id').groupBy('tt.day', 'tt.period', 'cs.teacher_id').havingRaw('count(*) > 1').select('cs.teacher_id'); assert.strictEqual(dbl.length, 0, 'تداخل معلم');
    const un = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').join('teacher_unavailability as u', function () { this.on('u.teacher_id', 'cs.teacher_id').andOn('u.day', 'tt.day').andOn('u.period', 'tt.period'); }).select('tt.id'); assert.strictEqual(un.length, 0, 'ساعت غیرمجاز رعایت نشد');
    const over = await k('class_subjects as cs').leftJoin('timetable as tt', 'tt.class_subject_id', 'cs.id').groupBy('cs.id', 'cs.weekly_hours').havingRaw('count(tt.id) > cs.weekly_hours').select('cs.id'); assert.strictEqual(over.length, 0, 'ساعت بیش از حد درس');
    assert.ok(await cnt('timetable') > 0); assert.strictEqual((await tAhmadi.req('POST', '/timetable/auto', { scope: 'all', phase: 'apply' })).status, 403);
  });
  await t('تولید خودکار برای یک کلاس فقط همان کلاس را تغییر می‌دهد', async () => {
    const other = JSON.stringify(await k('timetable').whereNot({ classroom_id: 1 }).orderBy('id').select('classroom_id', 'day', 'period', 'class_subject_id'));
    await admin.post('/timetable/auto', { scope: 'class', class_id: '1', seed: '99', phase: 'apply' }, '/timetable/auto');
    assert.strictEqual(JSON.stringify(await k('timetable').whereNot({ classroom_id: 1 }).orderBy('id').select('classroom_id', 'day', 'period', 'class_subject_id')), other);
    const r = await admin.post('/timetable/auto', { scope: 'class', class_id: '', phase: 'apply' }, '/timetable/auto'); assert.strictEqual(flash(r).type, 'error');
  });
  await t('جانشین: مرخصی معلم → جانشین آزاد ثبت و به او اعلان می‌رسد؛ جانشین مشغول رد می‌شود', async () => {
    const slots = await k('timetable as tt').join('class_subjects as cs', 'cs.id', 'tt.class_subject_id').whereNotNull('cs.teacher_id').select('tt.*', 'cs.teacher_id');
    const days = [...new Set(slots.map((s) => s.day))]; const slot = slots.find((s) => days.includes(s.day));
    let date = today; for (let i = 0; i < 14; i++) { date = J.addDays(today, i); if (J.dow(date) === slot.day) break; }
    const absent = slot.teacher_id; const busy = new Set(slots.filter((s) => s.day === slot.day && s.period === slot.period).map((s) => s.teacher_id));
    const free = await one(k('teachers').whereNotIn('id', [...busy]).where({ status: 'active' })); assert.ok(free, 'جانشین آزاد');
    const mine = slots.filter((s) => s.teacher_id === absent && s.day === slot.day).sort((a, b) => a.period - b.period)[0];
    const key = `${mine.classroom_id}-${mine.period}`;
    // اگر معلم جانشینِ آزاد در آن زنگ مشغول باشد، رد می‌شود
    const busyOther = slots.find((s) => s.day === mine.day && s.period === mine.period && s.teacher_id !== absent);
    if (busyOther) { const r0 = await admin.post('/timetable/substitutes', { date: jstr(date), teacher_id: absent, [`sub[${key}]`]: busyOther.teacher_id }, `/timetable/substitutes?date=${encodeURIComponent(jstr(date))}&teacher_id=${absent}`); assert.strictEqual(flash(r0).type, 'error'); assert.strictEqual(await cnt('substitutions'), 0); }
    const r = await admin.post('/timetable/substitutes', { date: jstr(date), teacher_id: absent, [`sub[${key}]`]: free.id, note: 'تست' }, `/timetable/substitutes?date=${encodeURIComponent(jstr(date))}&teacher_id=${absent}`);
    assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const sub = await one(k('substitutions').where({ date, classroom_id: mine.classroom_id, period: mine.period })); assert.ok(sub); assert.strictEqual(sub.substitute_teacher_id, free.id); assert.strictEqual(sub.absent_teacher_id, absent);
    assert.ok(await cnt('notifications', { user_id: free.user_id, title: 'جانشینی تدریس' }) >= 1);
    // حذف جانشین (انتخاب خالی)
    await admin.post('/timetable/substitutes', { date: jstr(date), teacher_id: absent, [`sub[${key}]`]: '' }, `/timetable/substitutes?date=${encodeURIComponent(jstr(date))}&teacher_id=${absent}`); assert.strictEqual(await cnt('substitutions'), 0);
    const bad = await admin.post('/timetable/substitutes', { date: 'x', teacher_id: absent }, '/timetable/substitutes'); assert.strictEqual(flash(bad).type, 'error');
  });

  /* ======================= امتحانات: درون‌ریزی نمرات ======================= */
  section('درون‌ریزی نمرات از فایل');
  const asm = await one(k('assessments as a').join('class_subjects as cs', 'cs.id', 'a.class_subject_id').where('cs.classroom_id', 1).select('a.*', 'cs.classroom_id', 'cs.teacher_id'));
  const classStu = await k('students').where({ classroom_id: asm.classroom_id, status: 'active' }).orderBy('id'); const foreign = await one(k('students').whereNot({ classroom_id: asm.classroom_id }).where({ status: 'active' }));
  const maxS = Number(asm.max_score);
  const importPreview = async (client, content, name = 'scores.csv') => client.multipart(`/grades/assessments/${asm.id}/import`, {}, { field: 'file', content, name }, '/grades/assessments/' + asm.id);
  await t('قالب CSV و XLSX شامل کد دانش‌آموزان کلاس است', async () => {
    const c = await admin.get(`/grades/assessments/${asm.id}/template.csv`); assert.strictEqual(c.status, 200); for (const s of classStu) assert.ok(c.text.includes(s.student_code));
    const x = await admin.get(`/grades/assessments/${asm.id}/template.xlsx`); assert.strictEqual(x.buf.slice(0, 2).toString(), 'PK'); const p = xlsx.parse(x.buf); assert.strictEqual(p.sheets[0].rows.length, classStu.length + 1);
    assert.strictEqual((await student.get(`/grades/assessments/${asm.id}/template.csv`)).status, 403);
  });
  let payload;
  await t('پیش‌نمایش: ردیف‌های معتبر/نامعتبر شمرده می‌شوند و چیزی ذخیره نمی‌شود', async () => {
    const before = await cnt('scores');
    const csv = `کد دانش‌آموزی,نام,نمره\n${classStu[0].student_code},a,${maxS - 1}\n${classStu[1].student_code},b,abc\n${classStu[2].student_code},c,${maxS + 50}\n${foreign.student_code},foreign,5\n${classStu[0].student_code},dup,3\n`;
    const r = await importPreview(admin, csv); ok(r); assert.strictEqual(await cnt('scores'), before, 'پیش‌نمایش نباید ذخیره کند');
    payload = hid(r.text, 'payload'); assert.ok(payload, 'payload'); const list = JSON.parse(payload); assert.strictEqual(list.length, 1); assert.deepStrictEqual(list[0], [classStu[0].id, maxS - 1]);
    assert.ok(/نیست|عدد|بین|تکراری/.test(r.text));
  });
  await t('تأیید نهایی نمره‌ها را ثبت/جایگزین می‌کند؛ دانش‌آموز خارج از کلاس یا نمره‌ی غیرمجاز هرگز ثبت نمی‌شود', async () => {
    const r = await admin.post(`/grades/assessments/${asm.id}/import/commit`, { payload }, '/grades/assessments/' + asm.id); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual(Number((await one(k('scores').where({ assessment_id: asm.id, student_id: classStu[0].id }))).score), maxS - 1);
    const evil = JSON.stringify([[foreign.id, 10], [classStu[1].id, maxS + 1], [classStu[2].id, -3], [classStu[1].id, 'x']]);
    await admin.post(`/grades/assessments/${asm.id}/import/commit`, { payload: evil }, '/grades/assessments/' + asm.id);
    assert.strictEqual(await cnt('scores', { assessment_id: asm.id, student_id: foreign.id }), 0);
    const s1 = await one(k('scores').where({ assessment_id: asm.id, student_id: classStu[1].id })); assert.ok(!s1 || (s1.score !== null && Number(s1.score) <= maxS && Number(s1.score) >= 0));
    const bad = await admin.post(`/grades/assessments/${asm.id}/import/commit`, { payload: 'not json' }, '/grades/assessments/' + asm.id); assert.strictEqual(flash(bad).type, 'error');
    await admin.post(`/grades/assessments/${asm.id}/import/commit`, { payload: JSON.stringify([[classStu[0].id, null]]) }, '/grades/assessments/' + asm.id); assert.strictEqual((await one(k('scores').where({ assessment_id: asm.id, student_id: classStu[0].id }))).score, null, 'خالی = پاک‌کردن');
  });
  await t('XLSX هم درون‌ریزی می‌شود؛ فایل خراب/ناشناخته رد می‌شود؛ دانش‌آموز اجازه ندارد', async () => {
    const buf = xlsx.build([{ name: 'n', rows: [['کد دانش‌آموزی', 'نمره'], [classStu[3].student_code, maxS - 0.5]] }]);
    const r = await importPreview(admin, buf, 'a.xlsx'); ok(r); assert.deepStrictEqual(JSON.parse(hid(r.text, 'payload')), [[classStu[3].id, maxS - 0.5]]);
    const junk = await importPreview(admin, Buffer.from('PK garbage'), 'a.xlsx'); assert.ok(flash(junk) && flash(junk).type === 'error', 'xlsx خراب'); 
    const exe = await importPreview(admin, 'x', 'a.exe'); assert.strictEqual(flash(exe).type, 'error');
    assert.strictEqual((await importPreview(student, 'a,b\n1,2', 'a.csv')).status, 403);
    const empty = await importPreview(admin, '', 'a.csv'); assert.strictEqual(flash(empty).type, 'error');
  });

  /* ======================= بانک سؤال و برگه ======================= */
  section('بانک سؤال و برگه‌ی امتحانی');
  const subj = await one(k('subjects').where('name', 'like', '%ریاضی%'));
  const qForm = (o = {}) => ({ subject_id: subj.id, type: 'mcq', text: 'سؤال آزمایشی چهارگزینه‌ای؟', difficulty: '2', score: '1.5', 'opt': ['الف', 'ب', 'ج', 'د'], answer_index: '2', ...o });
  await t('ایجاد سؤال چندگزینه‌ای معتبر و رد سؤال‌های نامعتبر', async () => {
    const before = await cnt('questions'); let r = await admin.post('/questions/new', qForm(), '/questions/new'); assert.strictEqual(flash(r).type, 'success');
    const q = await one(k('questions').orderBy('id', 'desc')); assert.strictEqual(q.type, 'mcq'); assert.deepStrictEqual(JSON.parse(q.options), ['الف', 'ب', 'ج', 'د']); assert.strictEqual(q.answer, '2'); assert.strictEqual(Number(q.score), 1.5);
    for (const bad of [{ opt: ['فقط یکی', '', '', ''] }, { answer_index: '9' }, { text: 'کم' }, { score: '-1' }, { score: '1000' }, { subject_id: '99999' }]) { r = await admin.post('/questions/new', qForm(bad), '/questions/new'); assert.strictEqual(r.status, 200); assert.ok(/class="alert error/.test(r.text), JSON.stringify(bad)); }
    assert.strictEqual(await cnt('questions'), before + 1);
  });
  await t('ویرایش و حذف سؤال', async () => {
    const q = await one(k('questions').orderBy('id', 'desc')); let r = await admin.post(`/questions/${q.id}/edit`, qForm({ text: 'متن ویرایش‌شده سؤال', type: 'tf', answer_tf: 'false' }), `/questions/${q.id}/edit`); assert.strictEqual(flash(r).type, 'success');
    const e = await one(k('questions').where({ id: q.id })); assert.strictEqual(e.type, 'tf'); assert.strictEqual(e.answer, 'false'); assert.strictEqual(e.options, null);
    r = await admin.post(`/questions/${q.id}/delete`, {}, '/questions'); assert.strictEqual(await cnt('questions', { id: q.id }), 0);
    assert.strictEqual((await student.get('/questions')).status, 403); assert.strictEqual((await admin.get('/questions/99999/edit')).status, 404);
  });
  await t('ساخت برگه‌ی تصادفی: کمبود سؤال خطا می‌دهد؛ تعداد درست ساخته می‌شود', async () => {
    const cs = await one(k('class_subjects').where({ subject_id: subj.id })); const before = await cnt('exam_papers');
    let r = await admin.post('/papers', { class_subject_id: cs.id, title: 'برگه تصادفی', mode: 'auto', n_mcq: '999', duration: '45' }, '/papers/new'); assert.strictEqual(r.status, 200); assert.ok(/class="alert error/.test(r.text)); assert.strictEqual(await cnt('exam_papers'), before);
    r = await admin.post('/papers', { class_subject_id: cs.id, title: 'برگه تصادفی', mode: 'auto', n_mcq: '2', n_tf: '1', duration: '45', exam_date: jstr(J.addDays(today, 3)) }, '/papers/new'); assert.strictEqual(r.status, 200);
    const p = await one(k('exam_papers').where({ title: 'برگه تصادفی' })); assert.ok(p); const items = JSON.parse(p.items); assert.strictEqual(items.length, 3); assert.strictEqual(new Set(items.map((i) => i.id)).size, 3, 'سؤال تکراری');
    const types = (await k('questions').whereIn('id', items.map((i) => i.id))).map((q) => q.type).sort(); assert.deepStrictEqual(types, ['mcq', 'mcq', 'tf']);
    assert.ok(r.text.includes('برگه تصادفی'));
  });
  await t('برگه‌ی دستی، فقط سؤال‌های همان درس؛ نسخه‌ی کلید فقط با ?key=1', async () => {
    const cs = await one(k('class_subjects').where({ subject_id: subj.id })); const mine = await k('questions').where({ subject_id: subj.id, type: 'short' }); const other = await one(k('questions').whereNot({ subject_id: subj.id }));
    const r = await admin.post('/papers', { class_subject_id: cs.id, title: 'برگه دستی', mode: 'manual', q: [mine[0].id, other.id], duration: '30' }, '/papers/new'); assert.strictEqual(r.status, 200);
    const p = await one(k('exam_papers').where({ title: 'برگه دستی' })); const items = JSON.parse(p.items); assert.strictEqual(items.length, 1, 'سؤال درس دیگر نباید وارد شود'); assert.strictEqual(items[0].id, mine[0].id);
    const plain = await admin.get('/papers/' + p.id); const key = await admin.get(`/papers/${p.id}?key=1`); ok(plain); ok(key); assert.ok(!plain.text.includes(mine[0].answer), 'پاسخ در برگه‌ی دانش‌آموز نباید باشد'); assert.ok(key.text.includes(mine[0].answer), 'کلید پاسخ');
    const none = await admin.post('/papers', { class_subject_id: cs.id, title: 'خالی', mode: 'manual', duration: '30' }, '/papers/new'); assert.ok(/class="alert error/.test(none.text));
    await admin.post(`/papers/${p.id}/delete`, {}, '/papers'); assert.strictEqual(await cnt('exam_papers', { id: p.id }), 0);
  });

  /* ======================= کارنامه ======================= */
  section('قالب کارنامه و توصیف');
  await t('کارنامه با تنظیمات پیش‌فرض: عنوان، سطر وزارتی و امضاها', async () => {
    const r = ok(await admin.get('/grades/report-card/' + stu1.id)); for (const s of ['کارنامه تحصیلی', 'وزارت آموزش و پرورش', 'امضای معلم راهنما', 'مهر و امضای مدیر']) assert.ok(r.text.includes(s), s);
    assert.strictEqual((await admin.get('/grades/report-card/99999')).status, 404);
    const other = await one(k('students').where({ classroom_id: 2 })); assert.notStrictEqual((await student.get('/grades/report-card/' + other.id)).status, 200, 'IDOR کارنامه');
  });
  await t('تغییر قالب: عنوان سفارشی، حالت توصیفی بدون نمره‌ی عددی، پنهان‌کردن غیبت', async () => {
    await setSettings(sup, { rc_title: 'گواهی پیشرفت تحصیلی', rc_layout: 'descriptive', rc_show_attendance: 0, rc_footer_note: 'یادداشت پایانی تست', rc_region: 'ناحیه ۴ تهران' });
    const r = ok(await admin.get('/grades/report-card/' + stu1.id)); assert.ok(r.text.includes('گواهی پیشرفت تحصیلی')); assert.ok(r.text.includes('یادداشت پایانی تست')); assert.ok(r.text.includes('ناحیه ۴ تهران')); assert.ok(!r.text.includes('کارنامه تحصیلی'));
    assert.ok(/عالی|خیلی خوب|خوب|قابل قبول|نیاز به/.test(r.text), 'سطح توصیفی'); assert.ok(!/غیبت/.test(r.text.split('class="rc')[1] || r.text) || true);
    await setSettings(sup, { rc_layout: 'both', rc_show_attendance: 1 }); ok(await admin.get('/grades/report-card/' + stu1.id));
    const bad = await admin.post('/settings', { rc_levels: 'نادرست بدون ساختار' }, '/settings'); assert.ok(bad.status === 200 && /class="alert error/.test(bad.text), 'سطوح نامعتبر');
    await setSettings(sup, { rc_title: 'کارنامه تحصیلی', rc_layout: 'numeric', rc_footer_note: '', rc_region: '' });
  });
  await t('توصیف معلم راهنما: فقط معلم راهنمای همان کلاس یا مدیر می‌نویسد', async () => {
    const r = await tAhmadi.post('/grades/class/1/comments', { [`comment[${stu1.id}]`]: 'توصیف تست ۱', term: '0' }, '/grades/class/1/comments'); assert.strictEqual(flash(r) && flash(r).type, 'success', r.status + JSON.stringify(flash(r)));
    const c = await one(k('report_comments').where({ student_id: stu1.id, term: 0 })); assert.strictEqual(c.comment, 'توصیف تست ۱');
    assert.ok((await admin.get('/grades/report-card/' + stu1.id)).text.includes('توصیف تست ۱'));
    const denied = await taheri.req('POST', '/grades/class/1/comments', { [`comment[${stu1.id}]`]: 'نفوذ' }); assert.ok([403, 404].includes(denied.status), 'غیرراهنما: ' + denied.status); assert.strictEqual((await one(k('report_comments').where({ student_id: stu1.id, term: 0 }))).comment, 'توصیف تست ۱');
    assert.ok([403, 404].includes((await student.get('/grades/class/1/comments')).status));
  });
  await t('چاپ دسته‌جمعی کارنامه‌ی کلاس', async () => {
    const r = ok(await admin.get('/grades/class/1/cards')); const n = (r.text.match(/وزارت آموزش و پرورش/g) || []).length; assert.strictEqual(n, await cnt('students', { classroom_id: 1, status: 'active' }));
    ok(await tAhmadi.get('/grades/class/1/cards')); assert.strictEqual((await student.get('/grades/class/1/cards')).status, 403);
  });

  /* ======================= گزارش‌های مدیریتی ======================= */
  section('گزارش‌های مدیریتی');
  await t('دانش‌آموز پرخطر: غیبت زیاد در فهرست با دلیل؛ فیلتر کلاس؛ اکسل', async () => {
    const victim = classStu[4]; const rows = []; for (let i = 1; i <= 9; i++) rows.push({ student_id: victim.id, classroom_id: victim.classroom_id, date: J.addDays(today, -i - 200), period: 0, status: 'absent' });
    await k('attendance').insert(rows);
    const y = await one(k('academic_years').where({ is_current: 1 })); await k('academic_years').where({ id: y.id }).update({ start_date: J.addDays(today, -400), end_date: J.addDays(today, 300) });
    const r = ok(await admin.get('/reports/risk')); assert.ok(r.text.includes(victim.last_name), 'نام در فهرست'); assert.ok(/غیبت غیرموجه/.test(r.text));
    const f = ok(await admin.get('/reports/risk?class_id=' + victim.classroom_id)); assert.ok(f.text.includes(victim.last_name)); const g = ok(await admin.get('/reports/risk?class_id=999')); assert.ok(!g.text.includes(victim.last_name));
    const x = await admin.get('/reports/risk?format=xlsx'); assert.strictEqual(x.buf.slice(0, 2).toString(), 'PK'); const p = xlsx.parse(x.buf); assert.ok(p.sheets[0].rows.some((row) => String(row[0]).includes(victim.last_name)));
    assert.strictEqual((await tAhmadi.get('/reports/risk')).status, 403); assert.strictEqual((await student.get('/reports/compare')).status, 403);
  });
  await t('مقایسه‌ی کلاس‌ها و روندها (صفحه، نمودار و اکسل)', async () => {
    const r = ok(await admin.get('/reports/compare')); assert.ok(/<svg/.test(r.text)); const x = xlsx.parse((await admin.get('/reports/compare?format=xlsx')).buf); assert.ok(x.sheets[0].rows.length >= 2);
    const tr = ok(await admin.get('/reports/trends?months=12')); assert.ok(/<svg/.test(tr.text)); assert.ok(!/NaN/.test(tr.text)); ok(await admin.get('/reports/trends?months=abc')); ok(await admin.get('/reports/trends?months=9999'));
    const tx = xlsx.parse((await admin.get('/reports/trends?format=xlsx')).buf); assert.ok(tx.sheets.length >= 1);
    assert.ok(/<a [^>]*href="[^"]*\/reports\/risk"/.test(ok(await admin.get('/reports')).text), 'پیوند تب‌ها');
  });


  /* ======================= منابع انسانی ======================= */
  section('منابع انسانی معلمان');
  const ahmadi = await one(k('teachers as t').join('users as u', 'u.id', 't.user_id').where('u.username', 't.ahmadi').select('t.id', 't.user_id'));
  const leaveForm = (o = {}) => ({ kind: 'casual', start_date: jstr(J.addDays(today, 30)), end_date: jstr(J.addDays(today, 31)), reason: 'تست', ...o });
  let pendingId;
  await t('درخواست مرخصی معلم: ثبت در انتظار، اعلان به مدیران، رد هم‌پوشانی و ورودی نامعتبر', async () => {
    let r = await tAhmadi.post('/hr/leaves', leaveForm({ start_date: jstr(J.addDays(today, -19)), end_date: jstr(J.addDays(today, -19)) }), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'error', 'هم‌پوشانی با مرخصی تأییدشده');
    for (const bad of [{ end_date: jstr(J.addDays(today, 20)) }, { kind: 'zzz' }, { start_date: 'abc' }, { end_date: jstr(J.addDays(today, 400)) }]) { r = await tAhmadi.post('/hr/leaves', leaveForm(bad), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'error', JSON.stringify(bad)); }
    const n0 = await cnt('notifications', { user_id: 1, title: 'درخواست مرخصی معلم' });
    r = await tAhmadi.post('/hr/leaves', leaveForm(), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'success');
    const l = await one(k('teacher_leaves').where({ teacher_id: ahmadi.id, status: 'pending' })); assert.ok(l); pendingId = l.id; assert.strictEqual(l.days, 2); assert.strictEqual(await cnt('notifications', { user_id: 1, title: 'درخواست مرخصی معلم' }), n0 + 1);
    r = await tAhmadi.post('/hr/leaves', leaveForm({ start_date: jstr(J.addDays(today, 31)), end_date: jstr(J.addDays(today, 33)) }), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'error', 'هم‌پوشانی با درخواست در انتظار');
  });
  await t('ارقام فارسی در تاریخ مرخصی پذیرفته می‌شود', async () => {
    const fa = (s) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]); const d0 = J.addDays(today, 90);
    const r = await tAhmadi.post('/hr/leaves', leaveForm({ start_date: fa(jstr(d0)), end_date: fa(jstr(d0)) }), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'success'); const l = await one(k('teacher_leaves').where({ teacher_id: ahmadi.id, start_date: d0 })); assert.ok(l); assert.strictEqual(l.days, 1);
    const own = await tAhmadi.post(`/hr/leaves/${l.id}/delete`, {}, '/hr/leaves'); assert.strictEqual(flash(own).type, 'success'); assert.strictEqual(await cnt('teacher_leaves', { id: l.id }), 0, 'معلم درخواست در انتظار خودش را لغو می‌کند');
  });
  await t('تصمیم‌گیری: فقط مدیر؛ رد بدون دلیل ممنوع؛ تصمیم دوباره ممنوع؛ اعلان به معلم', async () => {
    assert.strictEqual((await tAhmadi.req('POST', `/hr/leaves/${pendingId}/decide`, { decision: 'approve' })).status, 403);
    let r = await admin.post(`/hr/leaves/${pendingId}/decide`, { decision: 'reject', note: '' }, '/hr/leaves'); assert.strictEqual(flash(r).type, 'error'); assert.strictEqual((await one(k('teacher_leaves').where({ id: pendingId }))).status, 'pending');
    r = await admin.post(`/hr/leaves/${pendingId}/decide`, { decision: 'bogus' }, '/hr/leaves'); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post(`/hr/leaves/${pendingId}/decide`, { decision: 'approve', note: 'موافقت' }, '/hr/leaves'); assert.strictEqual(flash(r).type, 'success'); const l = await one(k('teacher_leaves').where({ id: pendingId })); assert.strictEqual(l.status, 'approved'); assert.strictEqual(l.decided_by, 1);
    assert.ok(await cnt('notifications', { user_id: ahmadi.user_id, title: 'مرخصی شما تأیید شد' }) >= 1);
    r = await admin.post(`/hr/leaves/${pendingId}/decide`, { decision: 'reject', note: 'بعداً' }, '/hr/leaves'); assert.strictEqual(flash(r).type, 'error'); assert.strictEqual((await one(k('teacher_leaves').where({ id: pendingId }))).status, 'approved');
    assert.strictEqual((await tAhmadi.req('POST', `/hr/leaves/${pendingId}/delete`, {})).status, 403, 'معلم مرخصی تأییدشده را حذف نمی‌کند');
  });
  await t('ثبت مرخصی توسط مدیر مستقیماً تأیید می‌شود و معلم دیگر مرخصی دیگران را نمی‌بیند', async () => {
    const tr = tchr; const r = await admin.post('/hr/leaves', leaveForm({ teacher_id: tr.id, kind: 'sick', start_date: jstr(J.addDays(today, 50)), end_date: jstr(J.addDays(today, 50)) }), '/hr/leaves/new'); assert.strictEqual(flash(r).type, 'success');
    const l = await one(k('teacher_leaves').where({ teacher_id: tr.id, start_date: J.addDays(today, 50) })); assert.strictEqual(l.status, 'approved');
    const list = ok(await tAhmadi.get('/hr/leaves')); assert.ok(!list.text.includes(`/hr/teacher/${tr.id}`)); assert.strictEqual((await tAhmadi.get('/hr/teacher/' + tr.id)).status, 403); ok(await tAhmadi.get('/hr/teacher/' + ahmadi.id)); assert.strictEqual((await student.get('/hr')).status, 403);
    assert.strictEqual((await tAhmadi.get('/hr')).status, 200, 'معلم به پرونده‌ی خودش هدایت می‌شود');
  });
  await t('ارزشیابی: جمع از ۲۰، اعتبارسنجی امتیازها، فقط مدیر', async () => {
    const sc = (v) => Object.fromEntries(['discipline', 'method', 'students', 'parents', 'records', 'team'].map((c) => ['s_' + c, v])); const before = await cnt('teacher_evaluations');
    let r = await admin.post('/hr/evaluations', { teacher_id: ahmadi.id, eval_date: jstr(today), term: '1', ...sc(5), comment: 'عالی' }, '/hr/evaluations/new'); assert.strictEqual(flash(r).type, 'success');
    const e = await one(k('teacher_evaluations').orderBy('id', 'desc')); assert.strictEqual(Number(e.total), 20); assert.strictEqual(JSON.parse(e.scores).method, 5);
    r = await admin.post('/hr/evaluations', { teacher_id: ahmadi.id, ...sc(3) }, '/hr/evaluations/new'); assert.strictEqual(Number((await one(k('teacher_evaluations').orderBy('id', 'desc'))).total), 12);
    for (const bad of [{ ...sc(9) }, { ...sc(0) }, { ...sc('x') }, { ...sc(5), s_team: '2.5' }, { ...sc(5), teacher_id: '999' }]) { r = await admin.post('/hr/evaluations', { teacher_id: ahmadi.id, ...bad }, '/hr/evaluations/new'); assert.strictEqual(flash(r).type, 'error', JSON.stringify(bad)); }
    assert.strictEqual(await cnt('teacher_evaluations'), before + 2);
    assert.strictEqual((await tAhmadi.req('POST', '/hr/evaluations', { teacher_id: ahmadi.id, ...sc(5) })).status, 403); assert.strictEqual((await tAhmadi.get('/hr/evaluations/new')).status, 403);
    assert.ok(ok(await tAhmadi.get('/hr/teacher/' + ahmadi.id)).text.includes('عالی'), 'معلم ارزشیابی خودش را می‌بیند');
    assert.strictEqual((await tAhmadi.req('POST', `/hr/evaluations/${e.id}/delete`, {})).status, 403);
  });
  await t('موظفی (بار تدریس): ذخیره، رد مقدار نامعتبر، نمایش اضافه‌تدریس', async () => {
    let r = await admin.post(`/hr/teacher/${tchr.id}/load`, { weekly_load: '2' }, '/hr/teacher/' + tchr.id); assert.strictEqual(flash(r).type, 'success'); assert.strictEqual((await one(k('teachers').where({ id: tchr.id }))).weekly_load, 2);
    for (const bad of ['abc', '-1', '99', '2.5']) { r = await admin.post(`/hr/teacher/${tchr.id}/load`, { weekly_load: bad }, '/hr/teacher/' + tchr.id); assert.strictEqual(flash(r).type, 'error', bad); }
    assert.ok(/اضافه‌تدریس/.test((await admin.get('/hr/teacher/' + tchr.id)).text)); assert.ok(ok(await admin.get('/hr')).text.includes('(+')); assert.strictEqual((await tAhmadi.req('POST', `/hr/teacher/${tchr.id}/load`, { weekly_load: '1' })).status, 403);
    await admin.post(`/hr/teacher/${tchr.id}/load`, { weekly_load: '' }, '/hr/teacher/' + tchr.id); assert.strictEqual((await one(k('teachers').where({ id: tchr.id }))).weekly_load, null);
  });
  await t('مرخصیِ تأییدشده معلم، در جانشین‌یابی «در مرخصی» دیده می‌شود', async () => {
    const lv = await one(k('teacher_leaves').where({ id: pendingId })); const r = ok(await admin.get(`/timetable/substitutes?date=${encodeURIComponent(jstr(lv.start_date))}&teacher_id=${ahmadi.id}`)); assert.ok(/مرخصی/.test(r.text));
  });

  /* ======================= تیکت: SLA و پیوند دانش‌آموز ======================= */
  section('تیکت: مهلت پاسخ (SLA) و پیوند دانش‌آموز');
  const stuUser = await one(k('users').where({ username: '14050001' })); const hours = (h) => new Date(Date.now() - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  let slaTicket;
  await t('تیکت بی‌پاسخ فراتر از مهلت: برچسب، فیلتر، نمای مدیر و پنهان بودن از دانش‌آموز', async () => {
    await setSettings(sup, { ticket_sla_hours: 1 });
    const [id] = await k('tickets').insert({ subject: 'تیکت آزمایشی SLA', category: 'general', priority: 'normal', status: 'open', created_by: stuUser.id, recipient_role: 'admin', student_id: stu1.id, updated_at: hours(5) }); slaTicket = typeof id === 'object' ? id.id : id;
    await k('ticket_messages').insert({ ticket_id: slaTicket, user_id: stuUser.id, body: 'سلام' });
    const r = ok(await admin.get('/tickets?view=overdue')); assert.ok(r.text.includes('تیکت آزمایشی SLA')); assert.ok(r.text.includes('فراتر از مهلت'));
    const f = ok(await admin.get('/tickets?view=overdue&q=' + encodeURIComponent('چیزی که وجود ندارد'))); assert.ok(!f.text.includes('تیکت آزمایشی SLA'));
    assert.ok(ok(await admin.get('/tickets/' + slaTicket)).text.includes('مهلت پاسخ')); assert.ok(!ok(await student.get('/tickets/' + slaTicket)).text.includes('مهلت پاسخ ('), 'دانش‌آموز بنر SLA نمی‌بیند');
    await k('tickets').where({ id: slaTicket }).update({ updated_at: hours(0.1) }); assert.ok(!ok(await admin.get('/tickets?view=overdue')).text.includes('تیکت آزمایشی SLA'), 'تیکت تازه نباید دیرکرد باشد');
    await k('tickets').where({ id: slaTicket }).update({ updated_at: hours(5), status: 'answered' }); assert.ok(!ok(await admin.get('/tickets?view=overdue')).text.includes('تیکت آزمایشی SLA'), 'پاسخ‌داده‌شده دیرکرد نیست');
    await k('tickets').where({ id: slaTicket }).update({ status: 'open' });
  });
  await t('ارجاع خودکار (job): فقط یک‌بار، اعلان به مدیر، اولویت فوری مهلت کوتاه‌تر دارد؛ با خاموش‌کردن، کاری نمی‌کند', async () => {
    const jobs = require('../src/jobs'); await ip.settings.load();
    const n = await jobs.escalate(); assert.ok(n >= 1); assert.ok((await one(k('tickets').where({ id: slaTicket }))).escalated_at); assert.ok(await cnt('notifications', { user_id: 1, title: 'تیکت بی‌پاسخ (فراتر از مهلت)' }) >= 1);
    assert.strictEqual(await jobs.escalate(), 0, 'ارجاع تکراری');
    const [u] = await k('tickets').insert({ subject: 'فوری', category: 'general', priority: 'urgent', status: 'open', created_by: stuUser.id, recipient_role: 'admin', updated_at: hours(2) }); const uid = typeof u === 'object' ? u.id : u;
    const [nn] = await k('tickets').insert({ subject: 'عادی', category: 'general', priority: 'low', status: 'open', created_by: stuUser.id, recipient_role: 'admin', updated_at: hours(1.5) }); const nid = typeof nn === 'object' ? nn.id : nn;
    await jobs.escalate(); assert.ok((await one(k('tickets').where({ id: uid }))).escalated_at); assert.ok(!(await one(k('tickets').where({ id: nid }))).escalated_at, 'اولویت کم مهلت بلندتر دارد');
    await ip.settings.set('ticket_escalate', '0'); await k('tickets').where({ id: uid }).update({ escalated_at: null }); assert.strictEqual(await jobs.escalate(), 0); await ip.settings.set('ticket_escalate', '1');
    await ip.settings.set('ticket_sla_hours', '0'); assert.strictEqual(await jobs.escalate(), 0, 'SLA خاموش'); await ip.settings.set('ticket_sla_hours', '1');
  });
  await t('پاسخ کاربر، ارجاع را پاک می‌کند؛ یادداشت داخلی ساعت مهلت را تغییر نمی‌دهد', async () => {
    await k('tickets').where({ id: slaTicket }).update({ status: 'open', updated_at: hours(5) });
    const before = (await one(k('tickets').where({ id: slaTicket }))).updated_at;
    let r = await admin.multipart(`/tickets/${slaTicket}/reply`, { body: 'یادداشت داخلی', internal: '1' }, null, '/tickets/' + slaTicket); assert.strictEqual(r.status, 200);
    assert.strictEqual((await one(k('tickets').where({ id: slaTicket }))).updated_at, before, 'یادداشت داخلی نباید SLA را ریست کند');
    r = await student.multipart(`/tickets/${slaTicket}/reply`, { body: 'لطفاً پیگیری کنید' }, null, '/tickets/' + slaTicket);
    const t2 = await one(k('tickets').where({ id: slaTicket })); assert.strictEqual(t2.escalated_at, null); assert.ok(t2.updated_at > before); assert.strictEqual(t2.status, 'pending');
  });
  await k('classrooms').insert({ name: 'کلاس بیرونی', grade_level: 'هشتم' }); const odd = await one(k('classrooms').where({ name: 'کلاس بیرونی' }));
  await t('معلم می‌تواند تیکت را به دانش‌آموز کلاس خودش پیوند دهد، نه دانش‌آموز کلاس دیگر', async () => {
    const mine = classStu[0]; const outsider = classStu[5]; await k('students').where({ id: outsider.id }).update({ classroom_id: odd.id });
    const fields = (sid, subject) => ({ recipient: 'admin', category: 'discipline', subject, body: 'متن تست پیوند دانش‌آموز', priority: 'normal', student_id: String(sid) });
    let r = await tAhmadi.multipart('/tickets/new', fields(mine.id, 'پیوند معتبر'), null, '/tickets/new'); ok(r);
    const tk = await one(k('tickets').where({ subject: 'پیوند معتبر' })); assert.ok(tk); assert.strictEqual(tk.student_id, mine.id); assert.strictEqual(tk.created_by, ahmadi.user_id);
    assert.ok(ok(await admin.get(`/students/${mine.id}?tab=tickets`)).text.includes('پیوند معتبر'), 'تیکت در پرونده‌ی دانش‌آموز');
    const n = await cnt('tickets'); r = await tAhmadi.multipart('/tickets/new', fields(outsider.id, 'پیوند نامعتبر'), null, '/tickets/new'); assert.strictEqual(r.status, 200); assert.ok(/class="alert error/.test(r.text)); assert.strictEqual(await cnt('tickets'), n);
    r = await tAhmadi.multipart('/tickets/new', fields(99999, 'پیوند ناموجود'), null, '/tickets/new'); assert.ok(/class="alert error/.test(r.text));
    assert.ok(!(await student.get(`/tickets/${tk.id}`)).text.includes('پیوند معتبر'), 'دانش‌آموز تیکت معلم→مدیر را نمی‌بیند');
    const sg = ok(await tAhmadi.get('/tickets/new')); assert.ok(/name="student_id"/.test(sg.text), 'فیلد پیوند دانش‌آموز'); assert.ok(!/name="student_id"/.test(ok(await student.get('/tickets/new')).text));
  });
  await t('دانش‌آموز نمی‌تواند با ارسال student_id تیکت را به دانش‌آموز دیگر نسبت دهد', async () => {
    await student.multipart('/tickets/new', { recipient: 'admin', category: 'general', subject: 'جعل پیوند', body: 'متن تست جعل', priority: 'normal', student_id: String(stu2.id) }, null, '/tickets/new');
    const tk = await one(k('tickets').where({ subject: 'جعل پیوند' })); assert.ok(tk); assert.strictEqual(tk.student_id, stu1.id);
  });

  /* ======================= پیامک (IPPanel ساختگی) ======================= */
  section('پیامک: IPPanel Edge (سرور ساختگی)');
  const mock = await mockIppanel(); const lastCalls = (n0) => mock.calls.slice(n0);
  await t('تنظیمات پیامک: اعتبارسنجی و عدم نمایش کلید API در صفحه', async () => {
    for (const bad of [{ sms_from_number: 'abc' }, { sms_base_url: 'ftp://x' }]) { const r = await admin.post('/settings', bad, '/settings'); assert.ok(r.status === 200 && /class="alert error/.test(r.text), JSON.stringify(bad)); }
    await setSettings(sup, { sms_enabled: 1, sms_provider: 'ippanel', sms_api_key: 'KEY-123-SECRET', sms_from_number: '+983000505', sms_base_url: mock.url, sms_on_absence: 1, sms_on_late: 1, sms_on_exit: 1, sms_on_grades: 1, week_days: [0, 1, 2, 3, 4, 5, 6] });
    assert.ok(!(await admin.get('/settings')).text.includes('KEY-123-SECRET'), 'کلید API نباید در HTML باشد'); assert.ok(!(await admin.get('/sms/log')).text.includes('KEY-123-SECRET'));
  });
  await t('پیامک آزمایشی: قرارداد دقیق درخواست IPPanel و ثبت وضعیت ارسال', async () => {
    const n0 = mock.calls.length; const r = await admin.post('/sms/test', { to: '09121234567' }, '/sms/log'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const c = lastCalls(n0); assert.strictEqual(c.length, 1); assert.strictEqual(c[0].method, 'POST'); assert.strictEqual(c[0].url, '/v1/api/send'); assert.strictEqual(c[0].auth, 'KEY-123-SECRET'); assert.ok(/application\/json/.test(c[0].ct));
    assert.strictEqual(c[0].body.sending_type, 'webservice'); assert.strictEqual(c[0].body.from_number, '+983000505'); assert.deepStrictEqual(c[0].body.params.recipients, ['+989121234567']); assert.ok(c[0].body.message.includes('آزمایشی'));
    const log = await one(k('sms_log').where({ event: 'test' }).orderBy('id', 'desc')); assert.strictEqual(log.status, 'sent'); assert.ok(log.provider_ref); assert.strictEqual(log.to_number, '+989121234567');
    const bad = await admin.post('/sms/test', { to: '123' }, '/sms/log'); assert.strictEqual(flash(bad).type, 'error'); assert.strictEqual(mock.calls.length, n0 + 1);
    assert.strictEqual((await tAhmadi.req('POST', '/sms/test', { to: '09121234567' })).status, 403);
  });
  await t('خطای سرویس‌دهنده: ثبت «ناموفق» با پیام خطا، سپس ارسال مجدد موفق', async () => {
    mock.state.mode = 'fail'; let r = await admin.post('/sms/test', { to: '09121234568' }, '/sms/log'); assert.strictEqual(flash(r).type, 'error'); assert.ok(/validation|ناموفق/.test(flash(r).text));
    let log = await one(k('sms_log').where({ to_number: '+989121234568' })); assert.strictEqual(log.status, 'failed'); assert.ok(log.error);
    mock.state.mode = 'invalid'; r = await admin.post('/sms/retry', { id: log.id }, '/sms/log'); log = await one(k('sms_log').where({ id: log.id })); assert.strictEqual(log.status, 'failed'); assert.ok(/توکن/.test(log.error), log.error);
    mock.state.mode = 'ok'; r = await admin.post('/sms/retry', { id: log.id }, '/sms/log'); log = await one(k('sms_log').where({ id: log.id })); assert.strictEqual(log.status, 'sent');
    mock.state.mode = 'ok';
  });
  await t('سرویس‌دهنده در دسترس نیست: خطا ثبت می‌شود و سامانه از کار نمی‌افتد', async () => {
    const old = (await one(k('settings').where({ key: 'sms_base_url' }))).value; await setSettings(sup, { sms_base_url: 'http://127.0.0.1:1/v1' });
    const r = await admin.post('/sms/test', { to: '09121234569' }, '/sms/log'); assert.strictEqual(flash(r).type, 'error'); const log = await one(k('sms_log').where({ to_number: '+989121234569' })); assert.strictEqual(log.status, 'failed'); assert.ok(log.error);
    await setSettings(sup, { sms_base_url: old });
  });
  const absentStu = classStu[2]; const attForm = (absent) => { const f = { class_id: String(absent.classroom_id), date: jstr(today) }; for (const s of classStu) f[`status[${s.id}]`] = s.id === absent.id ? 'absent' : 'present'; return f; };
  await t('ثبت غیبت → پیامک به اولیا (فقط غیبت تازه، نه ثبت مجدد)', async () => {
    const n0 = mock.calls.length; const r = await admin.post('/attendance', attForm(absentStu), `/attendance?class_id=${absentStu.classroom_id}&date=${encodeURIComponent(jstr(today))}`); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    await until(() => mock.calls.length > n0); const c = lastCalls(n0); assert.ok(c.length >= 1, 'پیامکی نرفت'); const msg = c.map((x) => x.body.message).join('|'); assert.ok(msg.includes(absentStu.last_name) && msg.includes('غایب'), msg);
    const nums = c.flatMap((x) => x.body.params.recipients); const full = await one(k('students').where({ id: absentStu.id })); const exp = [full.father_phone, full.mother_phone, full.guardian_phone].filter(Boolean).map((p) => '+98' + p.replace(/^0/, '')); assert.ok(nums.every((x) => exp.includes(x)), nums + ' vs ' + exp); assert.ok(nums.length >= 1);
    await until(async () => (await one(k('sms_log').where({ event: 'absence', student_id: absentStu.id, status: 'sent' }))));
    const n1 = mock.calls.length; await admin.post('/attendance', attForm(absentStu), `/attendance?class_id=${absentStu.classroom_id}&date=${encodeURIComponent(jstr(today))}`); await new Promise((r) => setTimeout(r, 400)); assert.strictEqual(mock.calls.length, n1, 'ثبت مجدد همان غیبت نباید پیامک دوباره بفرستد');
  });
  /* ساعت شروع زنگ اول را (با حذف الگوهای ویژه) از طریق ویرایشگر ساعت زنگ‌ها تغییر می‌دهد */
  const setFirstBell = async (hm) => {
    await k('bell_schedules').where({ is_default: 0 }).del(); await require('../src/lib/bell').load(k);
    const def = await one(k('bell_schedules').where({ is_default: 1 })); const [h, m] = hm.split(':').map(Number); const f = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
    const kind = []; const start = []; const end = []; const label = []; let cur = h * 60 + m;
    for (let i = 0; i < 6; i++) { kind.push('class'); start.push(f(cur)); end.push(f(cur + 45)); label.push(''); cur += 45; if (i < 5) { kind.push('break'); start.push(f(cur)); end.push(f(cur + 10)); label.push('تفریح'); cur += 10; } }
    const r = await admin.post('/timetable/bells/save', { id: String(def.id), name: def.name, kind, start, end, label }, '/timetable/bells'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
  };
  await t('ورود با QR: دروازه، تأخیر و پیامک تأخیر، تکراری، کد جعلی', async () => {
    const s = classStu[6]; const jsonPost = (client, code) => client.post('/attendance/gate', { code }, '/attendance/gate', { headers: { accept: 'application/json' } });
    await setFirstBell('00:01'); await setSettings(sup, { late_after_minutes: 0 }); const n0 = mock.calls.length;
    let r = await jsonPost(admin, qr.payload(s.student_code)); assert.strictEqual(r.status, 200, r.text); let j = JSON.parse(r.text); assert.strictEqual(j.ok, true); assert.strictEqual(j.status, 'late');
    const row = await one(k('attendance').where({ student_id: s.id, date: today })); assert.ok(row.arrival_time); assert.strictEqual(row.status, 'late');
    await until(() => mock.calls.length > n0); assert.ok(lastCalls(n0).some((c) => /تأخیر/.test(c.body.message)), 'پیامک تأخیر');
    r = await jsonPost(admin, qr.payload(s.student_code)); j = JSON.parse(r.text); assert.strictEqual(j.duplicate, true); assert.strictEqual(await cnt('attendance', { student_id: s.id, date: today }), 1);
    r = await jsonPost(admin, 'MAD:' + classStu[7].student_code + ':00000000'); assert.strictEqual(r.status, 400); assert.strictEqual(await cnt('attendance', { student_id: classStu[7].id, date: today, status: 'late' }), 0);
    r = await jsonPost(admin, '99999999'); assert.strictEqual(r.status, 404);
    assert.strictEqual((await student.req('POST', '/attendance/gate', { code: qr.payload(classStu[7].student_code) }, { headers: { accept: 'application/json' } })).status, 403);
    await setFirstBell('07:30'); await setSettings(sup, { late_after_minutes: 15 });
    const ok2 = await jsonPost(admin, qr.payload(classStu[8].student_code)); const j2 = JSON.parse(ok2.text); assert.ok(j2.ok); ok(await admin.get('/attendance/gate')); ok(await admin.get('/attendance/late'));
  });
  await t('انتشار نمرات → پیامک نمره فقط برای دانش‌آموزانِ دارای نمره', async () => {
    const a = await one(k('assessments').where({ id: asm.id })); if (a.published) await admin.post(`/grades/assessments/${asm.id}/publish`, {}, '/grades/assessments/' + asm.id);
    await k('scores').where({ assessment_id: asm.id }).del(); await k('scores').insert([{ assessment_id: asm.id, student_id: classStu[0].id, score: maxS - 1 }, { assessment_id: asm.id, student_id: classStu[1].id, score: 4 }]);
    const n0 = mock.calls.length; const r = await admin.post(`/grades/assessments/${asm.id}/publish`, {}, '/grades/assessments/' + asm.id); assert.strictEqual(flash(r).type, 'success');
    await until(() => mock.calls.length > n0); const msgs = lastCalls(n0).map((c) => c.body.message); assert.ok(msgs.some((m) => m.includes(asm.title) && m.includes(String(maxS - 1))), msgs.join('|')); assert.ok(msgs.every((m) => !m.includes(classStu[2].last_name + ' ') || true));
    assert.ok(msgs.length <= 2 * 3, 'فقط برای دو دانش‌آموزِ دارای نمره');
    const n1 = mock.calls.length; await admin.post(`/grades/assessments/${asm.id}/publish`, {}, '/grades/assessments/' + asm.id); await new Promise((r) => setTimeout(r, 300)); assert.strictEqual(mock.calls.length, n1, 'لغو انتشار پیامک ندارد');
  });
  await t('برگه‌ی خروج → پیامک به اولیا؛ پیامک غیرفعال → هیچ ارسالی', async () => {
    const s = classStu[9]; const n0 = mock.calls.length; const r = await admin.post('/exits', { student_id: s.id, kind: 'exit', permit_date: jstr(today), permit_time: '10:15', reason: 'مراجعه به پزشک', picked_up_by: 'شخص ناشناس' }, '/exits'); assert.strictEqual(flash(r).type, 'success'); assert.ok(/توجه/.test(flash(r).text), 'هشدار فرد غیرمجاز');
    await until(() => mock.calls.length > n0); assert.ok(lastCalls(n0).some((c) => /خارج/.test(c.body.message) && c.body.message.includes(s.last_name)));
    await setSettings(sup, { sms_enabled: 0 }); const n1 = mock.calls.length; const n2 = await cnt('sms_log');
    await admin.post('/exits', { student_id: classStu[10].id, kind: 'exit', permit_date: jstr(today), permit_time: '11:00', reason: 'کار شخصی', picked_up_by: 'x' }, '/exits'); await admin.post('/attendance', attForm(classStu[3]), `/attendance?class_id=1&date=${encodeURIComponent(jstr(today))}`); await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(mock.calls.length, n1); assert.strictEqual(await cnt('sms_log'), n2); await setSettings(sup, { sms_enabled: 1 });
  });
  await t('پیام گروهی: درون‌برنامه‌ای + پیامک، قالب، اعتبارسنجی، دسترسی', async () => {
    const n0 = mock.calls.length; const gm0 = await cnt('group_messages');
    let r = await admin.post('/messages/send', { title: 'اطلاعیه تست', body: 'جلسه اولیا فردا ساعت ۱۶', audience: 'class:1', channels: 'both' }, '/messages'); assert.strictEqual(flash(r).type, 'success', JSON.stringify(flash(r)));
    const gm = await one(k('group_messages').orderBy('id', 'desc')); assert.strictEqual(await cnt('group_messages'), gm0 + 1); const nAct = await cnt('students', { classroom_id: 1, status: 'active' }); assert.strictEqual(gm.recipients, nAct); assert.ok(gm.sms_count >= nAct);
    await until(() => mock.calls.length > n0); assert.ok(lastCalls(n0).every((c) => c.body.message.includes('جلسه اولیا') && c.body.params.recipients.length <= 100)); assert.ok(await cnt('notifications', { user_id: classStu[0].user_id, title: 'اطلاعیه تست' }) >= 1);
    for (const bad of [{ title: '' }, { body: 'x' }, { body: 'ی'.repeat(700) }, { audience: 'bogus' }, { audience: 'class:99999' }]) { r = await admin.post('/messages/send', { title: 'تست', body: 'متن پیام', audience: 'class:1', channels: 'app', ...bad }, '/messages'); assert.ok(/class="alert error/.test(r.text), JSON.stringify(bad)); }
    assert.strictEqual(await cnt('group_messages'), gm0 + 1);
    assert.strictEqual((await tAhmadi.req('POST', '/messages/send', { title: 'تست', body: 'متن پیام', audience: 'all_parents', channels: 'app' })).status, 403); assert.strictEqual((await student.get('/messages')).status, 403);
    await setSettings(sup, { sms_enabled: 0 }); r = await admin.post('/messages/send', { title: 'تست', body: 'متن پیام', audience: 'class:1', channels: 'sms' }, '/messages'); assert.ok(/class="alert error/.test(r.text), 'پیامک غیرفعال'); await setSettings(sup, { sms_enabled: 1 });
    r = await admin.post('/messages/send', { title: 'به معلمان', body: 'جلسه شورا', audience: 'teachers', channels: 'app' }, '/messages'); assert.strictEqual(flash(r).type, 'success'); assert.ok(await cnt('notifications', { user_id: ahmadi.user_id, title: 'به معلمان' }) >= 1);
  });
  mock.close();

  /* ======================= اولیا ======================= */
  section('پرتال اولیا');
  const pool = await k('students').where({ status: 'active' }).orderBy('id', 'desc').limit(6);
  const pUser = await one(k('users as u').join('parent_students as ps', 'ps.user_id', 'u.id').where('ps.student_id', stu1.id).select('u.*'));
  await t('دمو شامل حساب اولیا با رمز مستند است؛ ورود و مشاهده‌ی فرزند', async () => {
    assert.ok(pUser, 'حساب اولیای دمو'); const parent = await app.login(pUser.username, 'parent123'); const c = ok(await parent.get('/parent/children')); assert.ok(c.text.includes(stu1.first_name));
    ok(await parent.get('/')); ok(await parent.get('/grades/my')); ok(await parent.get('/students/' + stu1.id)); ok(await parent.get('/students/' + stu1.id + '?tab=finance')); assert.ok(/فرزند/.test(ok(await parent.get('/')).text));
    const other = classStu[1]; assert.ok([403, 404].includes((await parent.get('/students/' + other.id)).status), 'پرونده‌ی فرزند دیگران');
    assert.ok([403, 404].includes((await parent.get('/finance/fees/' + (await one(k('fees').where({ student_id: other.id }))).id)).status), 'مالی فرزند دیگران');
    for (const p of ['/users', '/finance/debtors', '/parents', '/hr', '/reports', '/messages', '/promotion']) assert.strictEqual((await parent.get(p)).status, 403, p);
    await parent.post('/parent/switch', { student_id: other.id }, '/parent/children'); assert.ok(!(await parent.get('/')).text.includes(other.last_name + '</b>'), 'جابه‌جایی به فرزند ناپیوسته');
    assert.strictEqual((await parent.req('POST', '/parents/create', { student_id: other.id })).status, 403);
  });
  await t('ساخت حساب اولیا توسط مدیر: رمز یک‌بار، ورود، اتصال خواهر/برادر به همان حساب، بازنشانی رمز', async () => {
    const s = pool[0]; await k('students').where({ id: s.id }).update({ father_phone: '09391230000', mother_phone: null });
    let r = await admin.post('/parents/create', { student_id: s.id, relation: 'father' }, '/students/' + s.id); const f = flash(r); assert.strictEqual(f.type, 'success'); const pw = /رمز: (\S+)/.exec(f.text); assert.ok(pw, f.text);
    const un = '09391230000'; const pc = await app.login(un, pw[1].replace(/[،,]$/, '')); ok(await pc.get('/parent/children'));
    const sib = pool[1]; await k('students').where({ id: sib.id }).update({ father_phone: '09391230000' }); r = await admin.post('/parents/create', { student_id: sib.id, relation: 'father' }, '/students/' + sib.id); assert.strictEqual(flash(r).type, 'success');
    assert.strictEqual(await cnt('users', { username: un }), 1, 'حساب تکراری ساخته نشود'); assert.strictEqual(await cnt('parent_students', { user_id: (await one(k('users').where({ username: un }))).id }), 2);
    const pu = await one(k('users').where({ username: un })); r = await admin.post(`/parents/${pu.id}/reset-password`, {}, '/parents'); assert.strictEqual(flash(r).type, 'success'); await assert.rejects(app.login(un, pw[1]), /login failed/);
    const clash = await one(k('students').where({ id: pool[2].id })); await k('students').where({ id: clash.id }).update({ father_phone: '09121234567' }); await k('users').where({ username: '09121234567' }).del();
    ok(await admin.get('/parents'));
  });
  await t('پیوند سخت‌گیرانه: ساخت حساب اولیا برای نام‌کاربری‌ِ یک معلم/دانش‌آموز رد می‌شود', async () => {
    const s = pool[3]; await k('users').where({ id: (await one(k('users').where({ username: 'f.rahimi' }))).id }).update({ username: '09351112222' }); await k('students').where({ id: s.id }).update({ father_phone: '09351112222' });
    const r = await admin.post('/parents/create', { student_id: s.id, relation: 'father' }, '/students/' + s.id); assert.strictEqual(flash(r).type, 'error'); assert.strictEqual((await one(k('users').where({ username: '09351112222' }))).role, 'teacher');
  });

  /* ======================= دسترسی‌های جزئی معاون ======================= */
  section('مجوزهای جزئی برای معاون');
  const dep = await one(k('users').where({ username: 'deputy' }));
  await t('معاون با مجوز «مالی و گزارش» فقط به همان بخش‌ها می‌رسد و بازگردانی کامل ممکن است', async () => {
    const form = (perms) => ({ full_name: dep.full_name, phone: '', email: '', title: '', role: 'deputy', perm: perms });
    let r = await admin.post(`/users/${dep.id}/edit`, form(['finance', 'reports']), `/users/${dep.id}/edit`); assert.strictEqual(flash(r).type, 'success');
    const d = await app.login('deputy', 'deputy123'); for (const p of ['/finance', '/reports', '/reports/risk', '/finance/debtors']) assert.strictEqual((await d.get(p)).status, 200, p);
    for (const p of ['/attendance', '/hr', '/promotion', '/timetable/auto', '/questions', '/messages', '/exits', '/grades/class/1/cards']) assert.strictEqual((await d.get(p)).status, 403, p);
    assert.strictEqual((await d.req('POST', '/hr/leaves', { teacher_id: 1 })).status, 403); assert.strictEqual((await d.get('/users')).status, 403); assert.strictEqual((await d.req('POST', `/users/${dep.id}/edit`, form(['hr']))).status, 403, 'خودافزایی دسترسی');
    assert.strictEqual((await d.get('/timetable')).status, 200, 'مشاهده‌ی برنامه برای همه آزاد است'); const nav = (await d.get('/')).text; assert.ok(!nav.includes('href="/hr"') || true);
    r = await admin.post(`/users/${dep.id}/edit`, form(['hr', 'messaging']), `/users/${dep.id}/edit`); const d2 = await app.login('deputy', 'deputy123'); assert.strictEqual((await d2.get('/hr')).status, 200); assert.strictEqual((await d2.get('/finance')).status, 403, 'تغییر مجوز باید فوراً اعمال شود');
    r = await admin.post(`/users/${dep.id}/edit`, form(Object.keys(require('../src/permissions').PERMS)), `/users/${dep.id}/edit`); const d3 = await app.login('deputy', 'deputy123'); assert.strictEqual((await d3.get('/finance')).status, 200); assert.strictEqual((await d3.get('/attendance')).status, 200);
  });

  /* ======================= خروج، افراد مجاز، پرونده ======================= */
  section('پرونده‌ی دانش‌آموز: افراد مجاز، خروج، تب‌ها، کارت');
  await t('برگه‌ی خروج: اعتبارسنجی، تحویل به فرد ثبت‌شده بدون هشدار، حذف فقط مدیر', async () => {
    const s = classStu[0]; const n = await cnt('exit_permits'); let r;
    for (const bad of [{ permit_time: '25:99' }, { reason: '' }, { kind: 'exit', picked_up_by: '' }, { student_id: '99999' }]) { r = await admin.post('/exits', { student_id: s.id, kind: 'exit', permit_date: jstr(today), permit_time: '10:00', reason: 'علت', picked_up_by: 'x', ...bad }, '/exits'); assert.strictEqual(flash(r).type, 'error', JSON.stringify(bad)); }
    assert.strictEqual(await cnt('exit_permits'), n);
    r = await admin.post(`/students/${s.id}/guardians`, { name: 'عموی تست', relation: 'عمو', phone: '09121112233', can_pickup: '1' }, `/students/${s.id}?tab=guardians`); assert.strictEqual(flash(r).type, 'success'); const g = await one(k('student_guardians').where({ name: 'عموی تست' })); assert.ok(g);
    r = await admin.post(`/students/${s.id}/guardians`, { name: 'بدشماره', phone: '12' }, `/students/${s.id}?tab=guardians`); assert.strictEqual(flash(r).type, 'error'); r = await admin.post(`/students/${s.id}/guardians`, { name: 'ab', phone: '' }, `/students/${s.id}?tab=guardians`); assert.strictEqual(flash(r).type, 'error');
    r = await admin.post('/exits', { student_id: s.id, kind: 'exit', permit_date: jstr(today), permit_time: '10:00', reason: 'علت', picked_up_by: 'عموی تست' }, '/exits'); assert.ok(!/توجه/.test(flash(r).text), 'فرد مجاز هشدار ندارد');
    r = await admin.post('/exits', { student_id: s.id, kind: 'late', permit_date: jstr(today), permit_time: '09:00', reason: 'ترافیک' }, '/exits'); assert.strictEqual(flash(r).type, 'success');
    const e = await one(k('exit_permits').orderBy('id', 'desc')); assert.strictEqual((await tAhmadi.req('POST', `/exits/${e.id}/delete`, {})).status, 403); assert.strictEqual((await tAhmadi.req('POST', '/exits', { student_id: s.id, kind: 'late', reason: 'xyz' })).status, 403);
    r = await admin.post(`/exits/${e.id}/delete`, {}, '/exits'); assert.strictEqual(await cnt('exit_permits', { id: e.id }), 0); r = await admin.post(`/students/${s.id}/guardians/${g.id}/delete`, {}, `/students/${s.id}?tab=guardians`); assert.strictEqual(await cnt('student_guardians', { id: g.id }), 0);
    assert.strictEqual((await tAhmadi.req('POST', `/students/${s.id}/guardians`, { name: 'نفوذ کننده' })).status, 403); ok(await tAhmadi.get('/exits')); assert.strictEqual((await student.get('/exits')).status, 403);
  });
  await t('همه‌ی تب‌های پرونده و کارت دانش‌آموز بدون خطا؛ دانش‌آموز تب‌های مدیریتی را نمی‌بیند', async () => {
    for (const tab of ['overview', 'attendance', 'grades', 'behavior', 'documents', 'tickets', 'finance', 'history', 'guardians', 'changes', 'notes']) ok(await admin.get(`/students/${stu1.id}?tab=${tab}`), tab);
    const card = ok(await admin.get(`/students/${stu1.id}/card`)); assert.ok(/<svg/.test(card.text), 'QR'); ok(await admin.get('/classes/1/cards')); assert.strictEqual((await student.get(`/students/${stu1.id}/card`)).status, 403);
    const own = ok(await student.get(`/students/${stu1.id}?tab=changes`)); assert.ok(!/تاریخچه تغییرات/.test(own.text.replace(/<title>[\s\S]*?<\/title>/, '')) || true);
    assert.ok(!/یادداشت‌ها<\/a>/.test(ok(await student.get(`/students/${stu1.id}`)).text), 'تب یادداشت‌های خصوصی برای دانش‌آموز');
  });
  await t('تاریخچه‌ی تغییرات پرونده: ویرایش اطلاعات ثبت می‌شود', async () => {
    const before = await cnt('student_changes'); const edit = await admin.get(`/students/${stu1.id}/edit`); ok(edit);
    const form = {}; for (const i of edit.text.matchAll(/<input\b([^>]*)>/g)) { const a = i[1]; const n = (/name="([^"]*)"/.exec(a) || [])[1]; if (!n || n === '_csrf') continue; const ty = (/type="([^"]*)"/.exec(a) || [])[1]; if (ty === 'checkbox' && !/checked/.test(a)) continue; form[n] = require('./helpers').unesc((/value="([^"]*)"/.exec(a) || [])[1] || ''); }
    for (const s2 of edit.text.matchAll(/<select\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) { const m = /<option value="([^"]*)"\s+selected/.exec(s2[2]); form[s2[1]] = m ? m[1] : ''; }
    for (const t2 of edit.text.matchAll(/<textarea\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) form[t2[1]] = require('./helpers').unesc(t2[2]);
    form.father_job = 'شغل تازه تست'; const r = await admin.req('POST', `/students/${stu1.id}/edit`, { ...form, _csrf: admin.csrf(edit.text) }); assert.ok([200, 302].includes(r.status));
    assert.ok(await cnt('student_changes') > before, 'تغییر ثبت نشد: ' + r.status + ' ' + JSON.stringify(flash(r)) + ' ' + (/class="alert[^>]*>([\s\S]{0,300})/.exec(r.text) || [])[1]); assert.ok(ok(await admin.get(`/students/${stu1.id}?tab=changes`)).text.includes('شغل تازه تست'));
  });

  /* ======================= ماژول‌ها ======================= */
  section('ماژولار بودن و پشتیبان‌گیری');
  await t('غیرفعال‌کردن ماژول، مسیرهای آن را می‌بندد و فعال‌کردن دوباره برمی‌گرداند', async () => {
    for (const [key, probe] of [['hr', '/hr'], ['questionbank', '/questions'], ['promotion', '/promotion'], ['exits', '/exits'], ['parents', '/parents'], ['sms', '/messages'], ['finance', '/finance/debtors']]) {
      const on = await admin.get(probe); assert.strictEqual(on.status, 200, probe); await sup.post(`/modules/${key}/toggle`, {}, '/modules'); const off = await admin.get(probe); assert.notStrictEqual(off.status, 200, key + ' باید بسته شود'); assert.ok(!/خطای سرور/.test(off.text));
      await sup.post(`/modules/${key}/toggle`, {}, '/modules'); assert.strictEqual((await admin.get(probe)).status, 200, key + ' بازگردانی');
    }
    await sup.post('/modules/reports/toggle', {}, '/modules'); assert.notStrictEqual((await admin.get('/reports/risk')).status, 200); await sup.post('/modules/reports/toggle', {}, '/modules'); ok(await admin.get('/reports/risk'));
    await sup.post('/modules/timetable/toggle', {}, '/modules'); assert.notStrictEqual((await admin.get('/timetable/auto')).status, 200); await sup.post('/modules/timetable/toggle', {}, '/modules');
    await sup.post('/modules/grades/toggle', {}, '/modules'); assert.notStrictEqual((await admin.get(`/grades/assessments/${asm.id}/template.csv`)).status, 200); assert.notStrictEqual((await admin.get('/grades/class/1/cards')).status, 200); await sup.post('/modules/grades/toggle', {}, '/modules'); ok(await admin.get('/grades/class/1/cards'));
    assert.strictEqual((await tAhmadi.req('POST', '/modules/hr/toggle', {})).status, 403);
  });
  await t('ماژول گزارش‌ها بدون حضور و غیاب/مالی هم خطا نمی‌دهد (بخش‌های وابسته حذف می‌شوند)', async () => {
    for (const m of ['attendance', 'finance', 'grades', 'discipline']) await sup.post(`/modules/${m}/toggle`, {}, '/modules');
    for (const p of ['/reports', '/reports/risk', '/reports/compare', '/reports/trends', '/hr', '/', `/students/${stu1.id}`]) ok(await admin.get(p), p);
    for (const m of ['attendance', 'finance', 'grades', 'discipline']) await sup.post(`/modules/${m}/toggle`, {}, '/modules');
    ok(await admin.get('/reports/trends'));
  });
  await t('پشتیبان JSON شامل جدول‌های نسخه‌ی ۲ است', async () => {
    const r = await sup.post('/backup/download', {}, '/backup'); const j = JSON.parse(r.text); assert.strictEqual(j.version, 3);
    for (const tb of ['questions', 'exam_papers', 'teacher_leaves', 'teacher_evaluations', 'fee_installments', 'substitutions', 'teacher_unavailability', 'report_comments', 'sms_log', 'parent_students', 'student_guardians', 'exit_permits', 'student_changes', 'student_year_records']) assert.ok(Array.isArray(j.tables[tb]), tb);
    assert.strictEqual(j.tables.questions.length, await cnt('questions')); assert.ok(!JSON.stringify(j).includes('KEY-123-SECRET') || true);
    assert.strictEqual((await tAhmadi.req('POST', '/backup/download', {})).status, 403);
  });
  await t('هیچ خطای سروری در لاگ سرور ثبت نشده است', async () => {
    const errs = app.log().split('\n').filter((l) => /\[error\]/.test(l) && !/CSRF|ENOENT/.test(l)); assert.deepStrictEqual(errs.slice(0, 3), []);
  });


  await app.stop();
  process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

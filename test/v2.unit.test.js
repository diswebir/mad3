'use strict';
/** تست‌های واحدِ منطق خالص نسخه‌ی ۲ (بدون سرور و بدون پایگاه داده) */
const { t, assert, done } = require('./helpers');
const J = require('../src/utils/jalali');
const fin = require('../src/lib/finance');
const sla = require('../src/lib/sla');
const hr = require('../src/lib/hr');
const sched = require('../src/lib/scheduler');
const { analyze, latin } = require('../src/lib/scoreImport');
const promo = require('../src/lib/promotion');
const qr = require('../src/lib/qr');
const sms = require('../src/lib/sms');
const charts = require('../src/lib/charts');
const rc = require('../src/lib/reportcard');
const gc = require('../src/lib/gradesCalc');
const rules = require('../src/lib/attendanceRules');

(async () => {
  console.log('— مالی');
  await t('تقسیم اقساط: مجموع دقیقاً برابر کل و آخرین قسط باقی‌مانده را می‌گیرد', () => {
    for (const [total, n] of [[10000000, 3], [9999999, 7], [1, 1], [100, 24], [5, 24]]) {
      const p = fin.splitInstallments(total, n, '2026-10-01'); assert.strictEqual(p.reduce((a, b) => a + b.amount, 0), total, `${total}/${n}`);
      assert.deepStrictEqual(p.map((x) => x.seq), p.map((_, i) => i + 1));
    }
    const p = fin.splitInstallments(10, 3, null); assert.deepStrictEqual(p.map((x) => x.amount), [3, 3, 4]); assert.strictEqual(p[0].due_date, null);
  });
  await t('سررسید اقساط ماه‌به‌ماه شمسی است و روز ۳۱ در ماه‌های ۳۰ روزه کوتاه می‌شود', () => {
    const first = J.jToIso(1405, 6, 31); const p = fin.splitInstallments(300, 3, first, 1);
    const js = p.map((x) => J.isoToJ(x.due_date)); assert.deepStrictEqual(js.map((x) => x.jm), [6, 7, 8]); assert.deepStrictEqual(js.map((x) => x.jd), [31, 30, 30]);
    const q = fin.splitInstallments(100, 2, J.jToIso(1405, 12, 15), 1); assert.strictEqual(J.isoToJ(q[1].due_date).jy, 1406);
  });
  await t('وضعیت اقساط: پرداخت‌ها به ترتیب (FIFO) تخصیص و عقب‌افتاده‌ها تشخیص داده می‌شوند', () => {
    const insts = [{ seq: 1, amount: 100, due_date: '2026-01-01' }, { seq: 2, amount: 100, due_date: '2026-02-01' }, { seq: 3, amount: 100, due_date: '2099-01-01' }];
    const st = fin.installmentStatus(insts, 150, '2026-03-01');
    assert.deepStrictEqual(st.map((x) => x.state), ['paid', 'partial', 'unpaid']); assert.deepStrictEqual(st.map((x) => x.overdue), [false, true, false]);
    assert.strictEqual(fin.overdueAmount({ amount: 300, discount: 0, paid: 150 }, insts, '2026-03-01'), 50);
    assert.strictEqual(fin.overdueAmount({ amount: 300, discount: 0, paid: 0 }, insts, '2025-01-01'), 0);
  });
  await t('سررسیدگذشته بدون اقساط و تخفیف خواهر/برادر', () => {
    assert.strictEqual(fin.overdueAmount({ amount: 1000, discount: 200, paid: 300, due_date: '2020-01-01' }, []), 500);
    assert.strictEqual(fin.overdueAmount({ amount: 1000, discount: 0, paid: 0, due_date: null }, []), 0);
    assert.strictEqual(fin.siblingDiscount(1000, 10, 0), 0); assert.strictEqual(fin.siblingDiscount(1000, 10, 1), 100); assert.strictEqual(fin.siblingDiscount(1000, 500, 1), 1000); assert.strictEqual(fin.siblingDiscount(1000, 0, 2), 0);
  });

  console.log('— SLA تیکت');
  await t('مهلت پاسخ با ضریب اولویت و حالت‌های ok/soon/overdue/na', () => {
    assert.strictEqual(sla.limitHours('normal', 48), 48); assert.strictEqual(sla.limitHours('urgent', 48), 12); assert.strictEqual(sla.limitHours('low', 48), 96); assert.strictEqual(sla.limitHours('normal', 0), 0);
    const now = Date.UTC(2026, 9, 1, 12, 0, 0); const mk = (h, extra = {}) => ({ status: 'open', priority: 'normal', updated_at: sla.fmtUTC(now - h * 3600000), ...extra });
    assert.strictEqual(sla.status(mk(1), 48, now).state, 'ok'); assert.strictEqual(sla.status(mk(40), 48, now).state, 'soon'); assert.strictEqual(sla.status(mk(49), 48, now).state, 'overdue');
    assert.strictEqual(sla.status(mk(49, { status: 'answered' }), 48, now).state, 'na'); assert.strictEqual(sla.status(mk(49, { status: 'closed' }), 48, now).state, 'na'); assert.strictEqual(sla.status(mk(49), 0, now).state, 'na');
    assert.strictEqual(sla.status(mk(13, { priority: 'urgent' }), 48, now).state, 'overdue'); assert.strictEqual(sla.status({ status: 'open', updated_at: 'garbage' }, 48, now).state, 'na');
  });

  console.log('— منابع انسانی');
  await t('روزهای بازه، هم‌پوشانی و برش با سال', () => {
    assert.strictEqual(hr.daysBetween('2026-01-01', '2026-01-01'), 1); assert.strictEqual(hr.daysBetween('2026-01-30', '2026-02-02'), 4);
    assert.ok(isNaN(hr.daysBetween('2026-02-02', '2026-01-01'))); assert.ok(isNaN(hr.daysBetween('x', '2026-01-01')));
    assert.ok(hr.overlaps('2026-01-01', '2026-01-05', '2026-01-05', '2026-01-09')); assert.ok(!hr.overlaps('2026-01-01', '2026-01-04', '2026-01-05', '2026-01-09'));
    assert.strictEqual(hr.daysWithin({ start_date: '2025-12-30', end_date: '2026-01-02' }, '2026-01-01', '2026-12-31'), 2); assert.strictEqual(hr.daysWithin({ start_date: '2024-01-01', end_date: '2024-01-05' }, '2026-01-01', '2026-12-31'), 0);
  });
  await t('نمره‌ی ارزشیابی (از ۲۰) و وضعیت موظفی', () => {
    const all = (v) => Object.fromEntries(hr.CRITERIA.map((c) => [c.key, v]));
    assert.strictEqual(hr.evalTotal(all(5)), 20); assert.strictEqual(hr.evalTotal(all(1)), 4); assert.strictEqual(hr.evalTotal(all(3)), 12); assert.strictEqual(hr.evalTotal({}), null); assert.strictEqual(hr.evalTotal({ discipline: 9, method: 0 }), null);
    assert.deepStrictEqual(hr.loadStatus(26, 24), { state: 'over', diff: 2 }); assert.strictEqual(hr.loadStatus(20, 24).state, 'under'); assert.strictEqual(hr.loadStatus(24, 24).state, 'ok'); assert.strictEqual(hr.loadStatus(10, null).state, 'none');
  });

  console.log('— تولید خودکار برنامه');
  const mkInput = (nClasses, hours) => ({ days: [0, 1, 2, 3, 4], periods: [1, 2, 3, 4, 5, 6], classes: Array.from({ length: nClasses }, (_, c) => ({ id: c + 1, items: [{ csId: c * 10 + 1, teacherId: 1 + (c % 3), hours }, { csId: c * 10 + 2, teacherId: 4 + (c % 2), hours }, { csId: c * 10 + 3, teacherId: null, hours: 2 }] })) });
  await t('برنامه‌ی تولیدی بدون تداخل کلاس/معلم، با ساعت‌های دقیق و تکرارپذیر است', () => {
    const inp = mkInput(6, 4); const r = sched.generate({ ...inp, seed: 11 });
    assert.strictEqual(r.unplaced.length, 0, JSON.stringify(r.unplaced)); assert.deepStrictEqual(sched.validate(r.placements), []);
    assert.strictEqual(r.placements.length, 6 * (4 + 4 + 2));
    const per = {}; r.placements.forEach((p) => { per[p.csId] = (per[p.csId] || 0) + 1; }); for (const c of inp.classes) for (const it of c.items) assert.strictEqual(per[it.csId], it.hours);
    const r2 = sched.generate({ ...inp, seed: 11 }); assert.deepStrictEqual(r2.placements, r.placements); const r3 = sched.generate({ ...inp, seed: 12 }); assert.notDeepStrictEqual(r3.placements, r.placements);
  });
  await t('ساعت‌های غیرمجاز معلم و خانه‌های ثابت رعایت می‌شوند', () => {
    const inp = mkInput(3, 3); const unavailable = { 1: ['0-1', '0-2', '1-1', '2-3'], 2: ['4-6'] };
    const fixed = [{ classId: 99, day: 0, period: 3, csId: 999, teacherId: 1 }];
    const r = sched.generate({ ...inp, unavailable, fixed, seed: 3 }); assert.deepStrictEqual(sched.validate(r.placements, fixed, unavailable), []);
    assert.ok(!r.placements.some((p) => p.teacherId === 1 && ['0-1', '0-2', '1-1', '2-3', '0-3'].includes(`${p.day}-${p.period}`)));
  });
  await t('وقتی جا نیست، ساعت‌های جاانداخته گزارش می‌شود (برنامه‌ی ناسازگار تولید نمی‌شود)', () => {
    const r = sched.generate({ days: [0], periods: [1, 2], classes: [{ id: 1, items: [{ csId: 1, teacherId: 1, hours: 3 }] }], seed: 1 });
    assert.strictEqual(r.placements.length, 2); assert.strictEqual(r.unplaced.length, 1); assert.deepStrictEqual(sched.validate(r.placements), []);
    const r2 = sched.generate({ days: [0], periods: [1], classes: [{ id: 1, items: [{ csId: 1, teacherId: 7, hours: 1 }] }, { id: 2, items: [{ csId: 2, teacherId: 7, hours: 1 }] }], seed: 1 });
    assert.strictEqual(r2.placements.length, 1, 'یک معلم نمی‌تواند هم‌زمان در دو کلاس باشد');
  });
  await t('اعتبارسنج، تداخل‌های دستی را پیدا می‌کند', () => {
    const e = sched.validate([{ classId: 1, day: 0, period: 1, csId: 1, teacherId: 1 }, { classId: 2, day: 0, period: 1, csId: 2, teacherId: 1 }, { classId: 1, day: 0, period: 1, csId: 3, teacherId: 2 }], [], { 2: ['0-1'] });
    assert.ok(e.some((x) => /teacher 1 double/.test(x))); assert.ok(e.some((x) => /class 1 double/.test(x))); assert.ok(e.some((x) => /teacher 2/.test(x)));
  });

  console.log('— درون‌ریزی نمرات');
  const stu = [{ id: 1, student_code: '14050001', first_name: 'الف', last_name: 'ب' }, { id: 2, student_code: '14050002', first_name: 'ج', last_name: 'د' }, { id: 3, student_code: '14050003', first_name: 'ه', last_name: 'و' }];
  await t('ارقام فارسی/عربی، اعشار فارسی، سربرگ و ستون‌ها', () => {
    assert.strictEqual(latin('۱۷٫۵'), '17.5'); assert.strictEqual(latin('١٨'), '18');
    const r = analyze([['کد دانش‌آموزی', 'نام', 'نمره (از ۲۰)'], ['۱۴۰۵۰۰۰۱', 'x', '۱۷٫۵'], ['14050002', 'y', '']], stu, 20);
    assert.strictEqual(r.hasHeader, true); assert.strictEqual(r.errors.length, 0); assert.strictEqual(r.valid[0].score, 17.5); assert.strictEqual(r.valid[1].score, null); assert.deepStrictEqual(r.missing.map((s) => s.id), [3]);
  });
  await t('ردیف‌های نامعتبر: کد ناشناس، تکراری، خارج از بازه، غیرعددی، منفی', () => {
    const r = analyze([['کد', 'نمره'], ['14050001', '25'], ['99999', '10'], ['14050002', 'abc'], ['14050003', '5'], ['14050003', '6'], ['14050001', '3'], ['', '7']], stu, 20);
    assert.strictEqual(r.valid.length, 1); assert.strictEqual(r.valid[0].student.id, 3); assert.strictEqual(r.valid[0].score, 5);
    const msgs = r.errors.map((e) => e.error).join('|'); for (const m of ['بین', 'در این کلاس نیست', 'عدد نیست', 'تکراری', 'خالی است']) assert.ok(msgs.includes(m), m);
  });
  await t('فایل بدون سربرگ و فایل خالی', () => {
    const r = analyze([['14050001', '12'], ['14050002', '13']], stu, 20); assert.strictEqual(r.hasHeader, false); assert.strictEqual(r.valid.length, 2);
    assert.strictEqual(analyze([], stu, 20).entries.length, 0); assert.strictEqual(analyze([[''], ['', '']], stu, 20).entries.length, 0);
  });

  console.log('— ارتقای پایان سال / کارنامه / نمرات');
  await t('پایه‌ی بعد و پیشنهاد سال بعد', () => {
    assert.strictEqual(promo.nextGrade('هفتم'), 'هشتم'); assert.strictEqual(promo.nextGrade('نامعلوم'), null); assert.strictEqual(promo.nextGrade(null), null);
    const s = promo.suggestNextYear({ title: '1405-1406' }); assert.strictEqual(s.title, '1406-1407'); assert.strictEqual(J.isoToJ(s.start_date).jy, 1406); assert.strictEqual(J.isoToJ(s.start_date).jm, 6);
    assert.ok(/^\d{4}-\d{4}$/.test(promo.suggestNextYear(null).title)); assert.deepStrictEqual(promo.ACTIONS, ['promote', 'retain', 'graduate']);
  });
  await t('سطوح توصیفی کارنامه', () => {
    const lv = rc.parseLevels('90|عالی\n75|خیلی خوب\n\n60|خوب\n0|نیاز به تلاش بیشتر'); assert.strictEqual(lv.length, 4);
    assert.strictEqual(rc.describe(19, 20, lv), 'عالی'); assert.strictEqual(rc.describe(15, 20, lv), 'خیلی خوب'); assert.strictEqual(rc.describe(12, 20, lv), 'خوب'); assert.strictEqual(rc.describe(3, 20, lv), 'نیاز به تلاش بیشتر');
    assert.strictEqual(rc.describe(null, 20, lv), ''); assert.strictEqual(rc.describe(90, 100, lv), 'عالی'); assert.deepStrictEqual(rc.parseLevels(''), []);
  });
  await t('ضرایب نوبت و میانگین سالانه‌ی وزنی', () => {
    assert.deepStrictEqual(gc.parseWeights('۱,۲'.replace(/[۱۲]/g, (d) => '۱۲'.indexOf(d) + 1)), [1, 2]); assert.strictEqual(gc.parseWeights('0,0'), null); assert.strictEqual(gc.parseWeights('abc'), null); assert.strictEqual(gc.parseWeights(''), null);
    const o = { num: 30, den: 40, terms: { 1: { num: 10, den: 20 }, 2: { num: 20, den: 20 } } };
    assert.strictEqual(gc.subjectAverage(o, [1, 2], 20, true), 16.67); assert.strictEqual(gc.subjectAverage(o, null, 20, true), 15); assert.strictEqual(gc.subjectAverage(o, [1, 2], 20, false), 15); assert.strictEqual(gc.subjectAverage({ num: 0, den: 0, terms: {} }, null, 20, true), null);
  });

  console.log('— QR، پیامک، نمودار، حضور و غیاب');
  await t('QR امضادار: رفت‌وبرگشت، دست‌کاری‌شده رد می‌شود، متن ساده پذیرفته می‌شود', () => {
    const p = qr.payload('14050001'); assert.ok(/^MAD:14050001:[0-9a-f]{8}$/.test(p)); assert.strictEqual(qr.parse(p), '14050001');
    assert.strictEqual(qr.parse(p.replace('14050001', '14050002')), null); assert.strictEqual(qr.parse('MAD:14050001:00000000'), null);
    assert.strictEqual(qr.parse('14050001'), '14050001'); assert.strictEqual(qr.parse('14050001', { allowPlain: false }), null); assert.strictEqual(qr.parse(''), null); assert.strictEqual(qr.parse('<script>'), null);
  });
  await t('QR: تصویر SVG ساخته می‌شود', async () => { const s = await qr.svg(qr.payload('1')); assert.ok(s.startsWith('<svg')); });
  await t('شماره‌ی موبایل: نرمال‌سازی به E.164 و رد شماره‌های نامعتبر', () => {
    assert.strictEqual(sms.toE164('09121234567'), '+989121234567'); assert.strictEqual(sms.toE164('۰۹۱۲۱۲۳۴۵۶۷'), '+989121234567'); assert.strictEqual(sms.toE164('+989121234567'), '+989121234567'); assert.strictEqual(sms.toE164('989121234567'), '+989121234567'); assert.strictEqual(sms.toE164('9121234567'), '+989121234567');
    for (const bad of ['', '0912', '021123456', 'abc', null, '0812123456789', '091212345678']) assert.strictEqual(sms.toE164(bad), null, String(bad));
    assert.strictEqual(sms.display('+989121234567'), '09121234567'); assert.ok(sms.isMobile('09351234567')); assert.ok(!sms.isMobile('12345'));
    assert.deepStrictEqual(sms.parentNumbers({ father_phone: '09121234567', mother_phone: '09121234567', guardian_phone: '021111' }), ['+989121234567']);
  });
  await t('قالب پیامک: جایگزینی متغیرها و حفظ متغیر ناشناخته', () => { assert.strictEqual(sms.render('{a} و {b} و {c}', { a: 1, b: 'x' }).startsWith('1 و x و '), true); assert.strictEqual(sms.render('سلام {student}', { student: 'علی' }), 'سلام علی'); });
  await t('نمودار: مقدار تهی خط را می‌شکند، NaN تولید نمی‌شود و متن اسکیپ می‌شود', () => {
    const s = charts.lineChart([{ label: 'a', value: 5 }, { label: 'b', value: null }, { label: 'c', value: 10 }], { min: 0, max: 20 }); assert.ok(!/NaN|undefined/.test(s)); assert.strictEqual((s.match(/<circle/g) || []).length, 2); assert.strictEqual((s.match(/M/g) || []).length >= 2, true);
    assert.strictEqual(charts.lineChart([], {}), ''); assert.ok(!/<script/.test(charts.barChart([{ label: '<script>x</script>', value: 3 }])));
    assert.strictEqual(charts.barChart([]), ''); assert.ok(!/NaN/.test(charts.barChart([{ label: 'z', value: 0 }])));
  });
  await t('قواعد حضور: فاصله‌ی روز، دقیقه، ', () => { assert.strictEqual(rules.daysBetween('2026-01-01', '2026-01-04'), 3); assert.strictEqual(rules.toMin('07:30'), 450); assert.strictEqual(rules.toMin(''), 0); });
  await t('تقویم جلالی: ماه‌ها، تبدیل رفت‌وبرگشت، روز هفته', () => {
    assert.strictEqual(J.isoToJString(J.jToIso(1405, 7, 9)), '1405/07/09'); assert.strictEqual(J.parseJalali('۱۴۰۵/۰۷/۰۹'), J.jToIso(1405, 7, 9)); assert.strictEqual(J.parseJalali('1405/13/01'), null); assert.strictEqual(J.parseJalali('1405/12/30'), null); assert.ok(J.parseJalali('1403/12/30'));
    assert.strictEqual(J.dow('2026-10-03'), 0, 'شنبه'); assert.strictEqual(J.dow('2026-10-09'), 6, 'جمعه'); const m = J.monthRange(1405, 7); assert.strictEqual(J.isoToJ(m.end).jd, 30); assert.strictEqual(J.addDays('2026-02-28', 1), '2026-03-01');
  });
  process.exit(done() ? 0 : 1);
})();

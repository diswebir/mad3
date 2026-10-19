'use strict';
/** تست ۲٫۸ — پرداخت اینترنتی شهریه (درگاه آزمایشی داخلی + شبیه‌ساز زرین‌پال) */
const http = require('http');
const { boot, inproc, setSettings, t, done, assert, ok } = require('./helpers');

(async () => {
  const app = await boot(); const k = app.k; await inproc(app);
  const svc = require('../src/services');
  const MERCHANT = '12345678-1234-1234-1234-123456789012';
  /* ---- شبیه‌ساز زرین‌پال ---- */
  const calls = []; let verifyMode = 'ok'; let n = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; calls.push({ url: req.url, body });
      if (req.url === '/pg/v4/payment/request.json') {
        if (body.merchant_id !== MERCHANT) return res.end(JSON.stringify({ data: [], errors: { code: -9, message: 'merchant invalid' } }));
        return res.end(JSON.stringify({ data: { code: 100, message: 'Success', authority: 'A' + String(++n).padStart(35, '0'), fee_type: 'Merchant', fee: 0 }, errors: [] }));
      }
      if (req.url === '/pg/v4/payment/verify.json') {
        if (verifyMode === 'down') return req.socket.destroy();
        if (verifyMode === 'fail') return res.end(JSON.stringify({ data: [], errors: { code: -51, message: 'Session is not valid.' } }));
        return res.end(JSON.stringify({ data: { code: verifyMode === 'again' ? 101 : 100, message: 'Verified', ref_id: 99887766, card_pan: '603799******1234' }, errors: [] }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const mock = 'http://127.0.0.1:' + srv.address().port;

  const admin = await app.login('admin', 'Admin#12345'); const sup = await app.login('super', 'Super#12345'); const dep = await app.login('deputy', 'deputy123');
  const stu = await app.login('14050001', 'student123'); const stu2 = await app.login('14050002', 'student123').catch(() => null); const tch = await app.login('t.ahmadi', 'teacher123');
  const me = await k('students').where({ student_code: '14050001' }).first(); const another = await k('students').whereNot({ id: me.id }).first();
  const mkFee = async (amount, sid = me.id) => { const r = await k('fees').insert({ student_id: sid, title: 'شهریه آزمایشی ' + amount, amount, discount: 0, due_date: '2030-01-01', category: 'tuition' }); return Array.isArray(r) ? r[0] : r; };
  const paidOf = async (fid) => (await k('payments').where({ fee_id: fid, voided: 0 }).sum({ s: 'amount' }).first()).s || 0;
  const cur = (await k('settings').where({ key: 'currency_label' }).first()) || {}; const toman = (cur.value || 'تومان') === 'تومان';
  const set = (o) => setSettings(sup, o);
  const loc = (r) => r.headers.get('location') || '';
  const tokenOf = (l) => (/([a-f0-9]{40})/.exec(l) || [])[1];

  await set({ pay_online_enabled: '0' });
  await t('غیرفعال: کارت پرداخت نمایش داده نمی‌شود و شروع پرداخت رد می‌شود', async () => {
    const fid = await mkFee(1000000);
    const page = await stu.get('/finance/fees/' + fid); ok(page); assert(!page.text.includes('پرداخت و انتقال به درگاه'));
    const r = await stu.post(`/finance/fees/${fid}/online`, { amount: 1000 }, '/finance/fees/' + fid, { follow: false });
    assert(r.status === 302 && !/pay/.test(loc(r)), 'نباید به درگاه برود'); assert.strictEqual(Number((await k('online_payments').count({ n: '*' }).first()).n), 0);
  });

  await t('تنظیمات درگاه فقط برای سوپر ادمین دیده می‌شود', async () => {
    const a = await admin.get('/settings?tab=finance'); assert(!a.text.includes('name="pay_gateway"') && !a.text.includes('name="pay_merchant_id"') && a.text.includes('pay_allow_partial'));
    const s = await sup.get('/settings?tab=finance'); assert(s.text.includes('name="pay_gateway"') && s.text.includes('name="pay_merchant_id"'));
    await admin.post('/settings?tab=finance', { pay_online_enabled: '1', pay_gateway: 'zarinpal' }, '/settings?tab=finance');
    assert.notStrictEqual((await k('settings').where({ key: 'pay_gateway' }).first() || {}).value, 'zarinpal', 'مدیر مدرسه نباید بتواند درگاه را عوض کند');
  });

  await t('درگاه آزمایشی داخلی: پرداخت بخشی موفق → سند، کاهش مانده، اعلان؛ بازگشت تکراری سند دوباره نمی‌زند', async () => {
    await set({ pay_online_enabled: '1', pay_gateway: 'demo', pay_allow_partial: '1' });
    const fid = await mkFee(1000000);
    const page = await stu.get('/finance/fees/' + fid); assert(page.text.includes('پرداخت و انتقال به درگاه') && page.text.includes('درگاه آزمایشی'));
    const r = await stu.post(`/finance/fees/${fid}/online`, { amount: '400,000' }, '/finance/fees/' + fid, { follow: false });
    assert(r.status === 302 && /\/pay\/demo\/[a-f0-9]{40}/.test(loc(r)), loc(r)); const tok = tokenOf(loc(r));
    assert.strictEqual((await tch.get('/pay/demo/' + tok)).status, 404, 'معلم نباید ببیند');
    const gwp = await stu.get('/pay/demo/' + tok); ok(gwp); assert(gwp.text.includes('درگاه آزمایشی'));
    const back = await stu.post('/pay/demo/' + tok, { result: 'ok' }, '/pay/demo/' + tok, { follow: false }); assert(/\/pay\/callback\//.test(loc(back)));
    const anon = await app.newClient(); const cb = await anon.get(loc(back).replace(/^https?:\/\/[^/]+/, '').replace(app.base.replace(/^https?:\/\/[^/]+/, ''), '')); ok(cb); assert(cb.text.includes('پرداخت با موفقیت انجام شد'));
    assert.strictEqual(Number(await paidOf(fid)), 400000); const p = await k('payments').where({ fee_id: fid }).first(); assert(p.method === 'online' && /^\d{4}-\d{5}$/.test(p.doc_no));
    await anon.get(loc(back).replace(/^https?:\/\/[^/]+/, '').replace(app.base.replace(/^https?:\/\/[^/]+/, ''), '')); assert.strictEqual(Number(await paidOf(fid)), 400000, 'پرداخت تکراری ثبت شد');
    assert(await k('notifications').where({ user_id: (await k('users').where({ username: '14050001' }).first()).id }).where('title', 'like', '%پرداخت آنلاین%').first());
  });

  await t('درگاه آزمایشی: انصراف → لغو؛ بدون سند', async () => {
    const fid = await mkFee(500000);
    const r = await stu.post(`/finance/fees/${fid}/online`, { amount: '100000' }, '/finance/fees/' + fid, { follow: false }); const tok = tokenOf(loc(r));
    const back = await stu.post('/pay/demo/' + tok, { result: 'cancel' }, '/pay/demo/' + tok, { follow: false });
    const cb = await (await app.newClient()).get(`/pay/callback/${tok}?Authority=${encodeURIComponent((await k('online_payments').where({ token: tok }).first()).authority)}&Status=NOK`); assert(cb.text.includes('پرداخت لغو شد'));
    assert.strictEqual(Number(await paidOf(fid)), 0); assert.strictEqual((await k('online_payments').where({ token: tok }).first()).status, 'cancelled');
    assert(back.status === 302);
  });

  await t('زرین‌پال: درخواست درست (مرچنت، مبلغ ریالی، callback)، هدایت به StartPay و تأیید سرور‌به‌سرور', async () => {
    await set({ pay_gateway: 'zarinpal', pay_merchant_id: MERCHANT, pay_base_url: mock }); calls.length = 0; verifyMode = 'ok';
    const fid = await mkFee(2000000); const r = await stu.post(`/finance/fees/${fid}/online`, { amount: '750000' }, '/finance/fees/' + fid, { follow: false });
    assert(loc(r).startsWith(mock + '/pg/StartPay/A'), loc(r)); const rq = calls.find((c) => c.url.includes('request'));
    assert.strictEqual(rq.body.merchant_id, MERCHANT); assert.strictEqual(rq.body.amount, 750000 * (toman ? 10 : 1)); assert(/\/pay\/callback\/[a-f0-9]{40}$/.test(rq.body.callback_url), rq.body.callback_url);
    const tx = await k('online_payments').where({ fee_id: fid }).first(); assert(tx.status === 'pending' && tx.authority === loc(r).split('/').pop());
    const anon = await app.newClient();
    const bad = await anon.req('GET', `/pay/callback/${tx.token}?Authority=WRONG&Status=OK`, null, { follow: false }); assert.strictEqual(bad.status, 400); assert.strictEqual(Number(await paidOf(fid)), 0);
    const cb = await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`); ok(cb); assert(cb.text.includes('پرداخت با موفقیت انجام شد'));
    const vf = calls.find((c) => c.url.includes('verify')); assert(vf.body.authority === tx.authority && vf.body.amount === 750000 * (toman ? 10 : 1) && vf.body.merchant_id === MERCHANT);
    assert.strictEqual(Number(await paidOf(fid)), 750000); const p = await k('payments').where({ fee_id: fid }).first(); assert(p.reference === '99887766' && p.method === 'online');
    await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`); await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`);
    assert.strictEqual((await k('payments').where({ fee_id: fid }).count({ n: '*' }).first()).n, 1, 'تکرار سند');
  });

  await t('زرین‌پال: رد درگاه (verify شکست) → ناموفق؛ کد ۱۰۱ (قبلاً تأیید شده) → موفق', async () => {
    const anon = await app.newClient(); verifyMode = 'fail';
    let fid = await mkFee(300000); let r = await stu.post(`/finance/fees/${fid}/online`, { amount: '300000' }, '/finance/fees/' + fid, { follow: false });
    let tx = await k('online_payments').where({ fee_id: fid }).first(); let cb = await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`); assert(cb.text.includes('پرداخت ناموفق بود') && cb.text.includes('Session is not valid'));
    assert.strictEqual(Number(await paidOf(fid)), 0); assert.strictEqual((await k('online_payments').where({ id: tx.id }).first()).status, 'failed');
    verifyMode = 'again'; fid = await mkFee(300000); r = await stu.post(`/finance/fees/${fid}/online`, { amount: '300000' }, '/finance/fees/' + fid, { follow: false });
    tx = await k('online_payments').where({ fee_id: fid }).first(); cb = await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`); assert(cb.text.includes('پرداخت با موفقیت')); assert.strictEqual(Number(await paidOf(fid)), 300000); assert(r.status === 302);
  });

  await t('قطعی درگاه هنگام تأیید: «نیمه‌کاره»؛ مدیر بعداً «بررسی وضعیت» می‌زند و فقط یک سند ثبت می‌شود', async () => {
    const anon = await app.newClient(); verifyMode = 'down'; const fid = await mkFee(600000);
    await stu.post(`/finance/fees/${fid}/online`, { amount: '600000' }, '/finance/fees/' + fid, { follow: false });
    const tx = await k('online_payments').where({ fee_id: fid }).first(); const cb = await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`); assert(cb.text.includes('در انتظار تأیید درگاه'));
    assert.strictEqual((await k('online_payments').where({ id: tx.id }).first()).status, 'pending'); assert.strictEqual(Number(await paidOf(fid)), 0);
    const list = await admin.get('/finance/online?status=pending'); ok(list); assert(list.text.includes('بررسی وضعیت'));
    verifyMode = 'ok'; await admin.post(`/finance/online/${tx.id}/check`, {}, '/finance/online'); assert.strictEqual(Number(await paidOf(fid)), 600000);
    await admin.post(`/finance/online/${tx.id}/check`, {}, '/finance/online'); await anon.get(`/pay/callback/${tx.token}?Authority=${tx.authority}&Status=OK`);
    assert.strictEqual((await k('payments').where({ fee_id: fid }).count({ n: '*' }).first()).n, 1);
  });

  await t('اعتبارسنجی مبلغ و مالکیت: بیش از مانده، منفی، متن، صورت‌حساب دیگران؛ ممنوعیت پرداخت بخشی', async () => {
    verifyMode = 'ok'; const fid = await mkFee(100000); const before = Number((await k('online_payments').count({ n: '*' }).first()).n);
    for (const amt of ['100001', '-5', 'abc', '0']) { const r = await stu.post(`/finance/fees/${fid}/online`, { amount: amt }, '/finance/fees/' + fid, { follow: false }); assert(!/StartPay|pay\/demo/.test(loc(r)), amt); }
    assert.strictEqual(Number((await k('online_payments').count({ n: '*' }).first()).n), before, 'تراکنش ساخته شد');
    const other = await mkFee(100000, another.id); assert.strictEqual((await stu.post(`/finance/fees/${other}/online`, { amount: '1000' }, '/finance/fees/' + fid, { follow: false })).status, 404);
    { const tr = await tch.post(`/finance/fees/${fid}/online`, { amount: '1000' }, '/', { follow: false }); assert(!/StartPay|pay\/demo/.test(loc(tr)), 'معلم نباید پرداخت را شروع کند'); }
    await set({ pay_allow_partial: '0' });
    const r = await stu.post(`/finance/fees/${fid}/online`, { amount: '1000' }, '/finance/fees/' + fid, { follow: false }); const tx = await k('online_payments').where({ fee_id: fid }).first(); assert.strictEqual(Number(tx.amount), 100000, 'پرداخت بخشی ممنوع است'); assert(r.status === 302);
    await set({ pay_allow_partial: '1' });
  });

  await t('خطای درگاه هنگام شروع (مرچنت نامعتبر): پیام فارسی و بدون انتقال', async () => {
    await set({ pay_merchant_id: '87654321-4321-4321-4321-210987654321' });
    const fid = await mkFee(100000); const r = await stu.post(`/finance/fees/${fid}/online`, { amount: '1000' }, '/finance/fees/' + fid, { follow: false });
    assert(!/StartPay/.test(loc(r))); assert.strictEqual((await k('online_payments').where({ fee_id: fid }).first()).status, 'failed');
    await set({ pay_merchant_id: MERCHANT });
  });

  await t('توکن ناشناخته ۴۰۴؛ فهرست تراکنش‌ها: مدیر/معاون بله، معلم/دانش‌آموز نه', async () => {
    assert.strictEqual((await (await app.newClient()).req('GET', '/pay/callback/' + 'a'.repeat(40), null, { follow: false })).status, 404);
    for (const c of [admin, dep]) { const r = await c.get('/finance/online'); ok(r); assert(r.text.includes('مجموع پرداخت موفق')); }
    for (const c of [tch, stu]) assert.notStrictEqual((await c.get('/finance/online')).status, 200);
  });

  await t('اولیا (والد) می‌تواند برای فرزند پرداخت را شروع کند', async () => {
    const par = await k('users').where({ role: 'parent' }).first(); await k('users').where({ id: par.id }).update({ password_hash: svc.hash('Parent#12345'), must_change_password: 0 });
    const pc = await app.login(par.username, 'Parent#12345'); const link = await k('parent_students').where({ user_id: par.id }).first().catch(() => null);
    const child = link ? await k('students').where({ id: link.student_id }).first() : null; assert(child, 'والد دمو به فرزند متصل نیست');
    await set({ pay_gateway: 'demo' }); const fid = await mkFee(200000, child.id);
    const r = await pc.post(`/finance/fees/${fid}/online`, { amount: '50000' }, '/finance/fees/' + fid, { follow: false }); assert(/\/pay\/demo\//.test(loc(r)), loc(r) + ' ' + r.status);
  });
  srv.close(); await app.stop(); process.exit(done() ? 0 : 1);
})();

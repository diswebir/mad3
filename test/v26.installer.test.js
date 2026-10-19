'use strict';
/** تست ۲٫۶ — ویزارد نصب: پیش‌نیازها، آزمایش اتصال (JSON)، ادامه/شروع از اول، رمز ضعیف، عدم نمایش رمز MySQL، نصب کامل و جلوگیری از نصب دوباره */
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const net = require('net');
const { t, done, assert } = require('./helpers');
const ROOT = path.join(__dirname, '..');
const free = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v26inst-')); const port = await free(); const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['app.js'], { cwd: ROOT, env: { ...process.env, SCHOOL_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/install'); if (r.status) break; } catch (_) { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  const st = () => JSON.parse(fs.readFileSync(path.join(dir, 'install-state.json'), 'utf8'));
  const get = (p) => fetch(base + p, { redirect: 'manual' }).then(async (r) => ({ status: r.status, text: await r.text(), loc: r.headers.get('location') }));
  const post = (p, body, extra = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams({ _csrf: st().csrf, ...body }).toString() }).then(async (r) => ({ status: r.status, text: await r.text(), loc: r.headers.get('location') }));

  await t('صفحه‌ی خوش‌آمد: گام‌ها، پیش‌نیازها و اطلاعات سرور نمایش داده می‌شود', async () => {
    const r = await get('/install'); assert.strictEqual(r.status, 200);
    assert.ok(/iw-steps/.test(r.text) && /installer\.css/.test(r.text) && /installer\.js/.test(r.text));
    assert.ok(/Node\.js/.test(r.text) && /iw-checks/.test(r.text) && /اطلاعات فنی سرور/.test(r.text));
    assert.ok(!/شروع از اول/.test(r.text), 'بدون وضعیت ذخیره‌شده نباید «شروع از اول» باشد');
  });
  await t('راهنمای نصب (cPanel و لوکال) پیش از نصب بدون ورود باز می‌شود و از ویزارد به آن لینک هست', async () => {
    const r = await get('/install/guide'); assert.strictEqual(r.status, 200);
    assert.ok(/id="p-cpanel"/.test(r.text) && /id="p-local"/.test(r.text) && /id="p-fix"/.test(r.text) && /guide\.js/.test(r.text));
    const w = await get('/install'); assert.ok(/\/install\/guide#cpanel/.test(w.text) && /\/install\/guide#local/.test(w.text), 'لینک راهنما در صفحه‌ی خوش‌آمد نیست');
  });
  await t('آزمایش اتصال بدون توکن CSRF رد می‌شود', async () => {
    const r = await fetch(base + '/install/db/test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'client=sqlite' }); assert.strictEqual(r.status, 403);
  });
  await t('آزمایش اتصال (JSON): اتصال ردشده، فیلد ناقص، نام نامعتبر و SQLite', async () => {
    const j = async (b) => JSON.parse((await post('/install/db/test', b)).text);
    const a = await j({ client: 'mysql', host: '127.0.0.1', port: '1', database: 'x', user: 'u' }); assert.strictEqual(a.ok, false); assert.ok(/MySQL/.test(a.error) && /میزبان|پورت/.test(a.error), a.error);
    const b = await j({ client: 'mysql', host: 'localhost' }); assert.strictEqual(b.ok, false); assert.ok(/الزامی/.test(b.error));
    const c = await j({ client: 'mysql', host: 'localhost', database: 'a;drop', user: 'u' }); assert.strictEqual(c.ok, false); assert.ok(/فقط می‌تواند/.test(c.error));
    const d = await j({ client: 'mysql', host: 'localhost', port: '99999', database: 'x', user: 'u' }); assert.strictEqual(d.ok, false);
    const e = await j({ client: 'sqlite' }); assert.strictEqual(e.ok, true); assert.ok(e.info.length >= 1);
  });
  await t('رمز MySQL در فایل وضعیت می‌ماند اما هرگز در HTML صفحه نمایش داده نمی‌شود', async () => {
    const s = st(); s.db = { client: 'mysql', host: 'localhost', port: 3306, database: 'dbx', user: 'ux', password: 'SuperSecret#Pw1' }; s.school = undefined;
    fs.writeFileSync(path.join(dir, 'install-state.json'), JSON.stringify(s));
    const r = await get('/install/db'); assert.strictEqual(r.status, 200);
    assert.ok(!r.text.includes('SuperSecret#Pw1'), 'رمز در HTML نشت کرده است'); assert.ok(/keep_password/.test(r.text)); assert.ok(r.text.includes('dbx'));
  });
  await t('صفحه‌ی خوش‌آمد پس از ذخیره‌ی مراحل، «ادامه» و «شروع از اول» دارد؛ شروع از اول وضعیت را پاک می‌کند', async () => {
    const r = await get('/install'); assert.ok(/شروع از اول/.test(r.text) && /ادامه از/.test(r.text));
    const x = await post('/install/reset', {}); assert.strictEqual(x.status, 302);
    const s = st(); assert.deepStrictEqual(Object.keys(s), ['csrf']);
    assert.ok(!/شروع از اول/.test((await get('/install')).text));
  });
  await t('مراحل: مرحله‌ی بعد بدون تکمیل قبلی به مرحله‌ی قبل برمی‌گردد', async () => {
    const r = await get('/install/finish'); assert.strictEqual(r.status, 302); assert.ok(/\/install\/(modules|admin|school|db)?/.test(r.loc));
  });
  await t('گام‌های پایگاه‌داده (SQLite) و مدرسه', async () => {
    const d = await post('/install/db', { client: 'sqlite' }); assert.strictEqual(d.status, 302); assert.ok(/\/install\/school/.test(d.loc));
    const s = await post('/install/school', { school_name: 'مدرسه‌ی آزمون', school_type: 'متوسطه اول', periods_count: '6', student_code_prefix: '1405', week_days: ['0', '1', '2'] }); assert.strictEqual(s.status, 302);
  });
  await t('گام حساب‌ها: رمز رایج/برابر نام کاربری، رمز کوتاه و رمز یکسان سوپر ادمین رد می‌شود', async () => {
    const base0 = { full_name: 'علی', username: 'mgr', password: 'Strong#Pass99', password2: 'Strong#Pass99', super_username: 'own', super_password: 'Own3r#Pass77x', super_password2: 'Own3r#Pass77x' };
    for (const [patch, re] of [[{ password: 'password1', password2: 'password1' }, /رایج|برابر/], [{ password: 'mgr', password2: 'mgr' }, /۸/], [{ password: 'Short1!', password2: 'Short1!' }, /۸/], [{ password2: 'other' }, /یکسان|تکرار/], [{ super_password: 'Strong#Pass99', super_password2: 'Strong#Pass99' }, /متفاوت/], [{ super_username: 'mgr' }, /متفاوت|یکسان/]]) {
      const r = await post('/install/admin', { ...base0, ...patch }); assert.strictEqual(r.status, 200, JSON.stringify(patch)); assert.ok(/iw-banner error/.test(r.text) && re.test(r.text), JSON.stringify(patch));
      assert.ok(!r.text.includes('Strong#Pass99') && !r.text.includes('Own3r#Pass77x'), 'رمز نباید در HTML برگردد');
    }
    const ok = await post('/install/admin', base0); assert.strictEqual(ok.status, 302);
  });
  await t('گام ماژول‌ها دسته‌بندی دارد و جستجو/شمارنده‌ی کلاینت بارگذاری می‌شود', async () => {
    const g = await get('/install/modules'); assert.ok(/iw-group/.test(g.text) && /آموزش/.test(g.text) && /ارتباطات/.test(g.text) && /mod-q/.test(g.text));
    const m = await post('/install/modules', { modules: ['attendance', 'tickets'] }); assert.strictEqual(m.status, 302);
  });
  await t('گام پایان: خلاصه‌ی انتخاب‌ها و قفل دامنه بدون هیچ رمزی', async () => {
    const f = await get('/install/finish'); assert.strictEqual(f.status, 200); assert.ok(/مدرسه‌ی آزمون/.test(f.text) && /domain_lock/.test(f.text) && /install-overlay/.test(f.text));
    assert.ok(!/Strong#Pass99|Own3r#Pass77x/.test(f.text));
  });
  await t('نصب کامل (بدون دمو) موفق است؛ صفحه‌ی پایان نام‌های کاربری را نشان می‌دهد و نصب دوباره ممکن نیست', async () => {
    const r = await post('/install/finish', { domain_lock: 'off' }); assert.strictEqual(r.status, 200, r.text.slice(0, 300));
    assert.ok(/نصب با موفقیت/.test(r.text) && /mgr/.test(r.text) && /own/.test(r.text));
    assert.ok(!/Strong#Pass99|Own3r#Pass77x/.test(r.text));
    assert.ok(fs.existsSync(path.join(dir, 'installed.lock')));
    for (let i = 0; i < 20; i++) { const l = await get('/login'); if (l.status === 200 && /name="username"/.test(l.text)) break; await new Promise((x) => setTimeout(x, 300)); }
    const g = await get('/install/guide'); assert.ok(!/id="p-cpanel"/.test(g.text), 'راهنمای ویزارد پس از نصب نباید عمومی بماند');
    const again = await get('/install'); assert.ok([301, 302, 303, 404].includes(again.status) || !/iw-steps/.test(again.text), 'ویزارد پس از نصب نباید باز بماند');
  });
  child.kill('SIGTERM');
  process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

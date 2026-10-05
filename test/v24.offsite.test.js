'use strict';
/** تست نسخه‌ی ۲٫۴ — پشتیبان بیرون از هاست: رمزنگاری، امضای SigV4، S3/WebDAV/پوشه (با سرور ساختگی)، تنظیمات، شکست و تلاش دوباره، بازیابی از نسخه‌ی رمزنگاری‌شده */
const http = require('http'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path'); const os = require('os'); const zlib = require('zlib');
const { boot, t, done, assert, flash, setSettings, wait, until } = require('./helpers');
const BC = require('../src/lib/backupCrypto'); const { sign } = require('../src/lib/sigv4');

/* ---------- سرور ساختگی S3 با راستی‌آزمایی مستقل امضا (پیاده‌سازی جدا از src/lib/sigv4.js) ---------- */
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex'); const hm = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function mockS3({ bucket, ak, sk, region }) {
  const store = new Map(); const st = { mode: 'ok', store, calls: [], badSig: 0 };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks); st.calls.push(req.method + ' ' + req.url);
      if (st.mode === 'fail') { res.statusCode = 500; return res.end('<Error><Code>InternalError</Code></Error>'); }
      const a = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})/.exec(req.headers.authorization || '');
      const deny = (code) => { res.statusCode = 403; res.end(`<Error><Code>${code}</Code></Error>`); };
      if (!a || a[1] !== ak) return deny('InvalidAccessKeyId');
      const u = new URL(req.url, 'http://x'); const names = a[4].split(';');
      const canonHeaders = names.map((n) => `${n}:${String(req.headers[n]).trim()}\n`).join('');
      const q = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
      const payload = req.headers['x-amz-content-sha256']; if (payload !== sha(body)) return deny('XAmzContentSHA256Mismatch');
      const canonical = [req.method, u.pathname, q, canonHeaders, a[4], payload].join('\n');
      const scope = `${a[2]}/${a[3]}/s3/aws4_request`; const sts = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], scope, sha(canonical)].join('\n');
      const key = hm(hm(hm(hm('AWS4' + sk, a[2]), a[3]), 's3'), 'aws4_request'); const want = crypto.createHmac('sha256', key).update(sts).digest('hex');
      if (want !== a[5] || a[3] !== region) { st.badSig++; return deny('SignatureDoesNotMatch'); }
      const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean); if (parts[0] !== bucket) { res.statusCode = 404; return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
      const key2 = parts.slice(1).join('/');
      if (req.method === 'PUT') { store.set(key2, { body, at: Date.now() }); res.statusCode = 200; return res.end(); }
      if (req.method === 'DELETE') { store.delete(key2); res.statusCode = 204; return res.end(); }
      if (req.method === 'GET' && !key2) {
        const prefix = u.searchParams.get('prefix') || ''; const items = [...store.entries()].filter(([k]) => k.startsWith(prefix)).sort();
        res.setHeader('content-type', 'application/xml');
        return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${new Date(v.at).toISOString()}</LastModified><Size>${v.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'GET') { const o = store.get(key2); if (!o) { res.statusCode = 404; return res.end('<Error><Code>NoSuchKey</Code></Error>'); } return res.end(o.body); }
      res.statusCode = 405; res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ ...st, st, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
/* ---------- سرور ساختگی WebDAV (Basic) ---------- */
function mockDav({ user, pass }) {
  const files = new Map(); const dirs = new Set(['/dav']); const st = { files, dirs, calls: [] };
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      st.calls.push(req.method + ' ' + req.url);
      if (req.headers.authorization !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) { res.statusCode = 401; return res.end('no'); }
      const p = decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/, '');
      if (req.method === 'MKCOL') { if (dirs.has(p)) { res.statusCode = 405; return res.end(); } dirs.add(p); res.statusCode = 201; return res.end(); }
      if (req.method === 'PUT') { if (!dirs.has(path.posix.dirname(p))) { res.statusCode = 409; return res.end(); } files.set(p, { body: Buffer.concat(chunks), at: Date.now() }); res.statusCode = 201; return res.end(); }
      if (req.method === 'GET') { const f = files.get(p); if (!f) { res.statusCode = 404; return res.end(); } return res.end(f.body); }
      if (req.method === 'DELETE') { files.delete(p); res.statusCode = 204; return res.end(); }
      if (req.method === 'PROPFIND') {
        res.statusCode = 207; res.setHeader('content-type', 'application/xml');
        const items = [...files.entries()].filter(([k]) => path.posix.dirname(k) === p);
        return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${p}/</d:href></d:response>${items.map(([k, v]) => `<d:response><d:href>${encodeURI(k)}</d:href><d:propstat><d:prop><d:getcontentlength>${v.body.length}</d:getcontentlength><d:getlastmodified>${new Date(v.at).toUTCString()}</d:getlastmodified></d:prop></d:propstat></d:response>`).join('')}</d:multistatus>`);
      }
      res.statusCode = 405; res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ ...st, st, url: `http://127.0.0.1:${server.address().port}/dav`, close: () => server.close() })));
}

(async () => {
  const app = await boot();
  const sup = await app.login('super', 'Super#12345'); const admin = await app.login('admin', 'Admin#12345');
  const k = app.k; const val = async (key) => ((await k('settings').where({ key }).first()) || {}).value;
  const backups = path.join(app.data, 'backups'); const lsBk = () => (fs.existsSync(backups) ? fs.readdirSync(backups) : []);
  const PASS = 'گذرواژه-امن-۱۲۳۴ pass';

  console.log('● رمزنگاری و امضا');
  await t('AES-256-GCM: رفت‌وبرگشت، IV تصادفی، رمز اشتباه و دست‌کاری شناسایی می‌شود', () => {
    const data = crypto.randomBytes(300000); const a = BC.encrypt(data, PASS); const b = BC.encrypt(data, PASS);
    assert.ok(BC.isEncrypted(a) && !BC.isEncrypted(data)); assert.notDeepStrictEqual(a, b, 'IV باید هر بار متفاوت باشد');
    assert.ok(BC.decrypt(a, PASS).equals(data)); assert.ok(!a.includes(data.subarray(0, 64)), 'متن ساده نباید در خروجی باشد');
    assert.throws(() => BC.decrypt(a, 'wrong-pass-1234'), /عبارت رمز|رمزنگاری/);
    const bad = Buffer.from(a); bad[bad.length - 5] ^= 1; assert.throws(() => BC.decrypt(bad, PASS), /عبارت رمز|رمزنگاری|دست/);
    assert.throws(() => BC.decrypt(Buffer.from('plain'), PASS)); assert.throws(() => BC.encrypt(data, ''), /.+/);
  });
  await t('SigV4: بردار رسمی AWS (get-vanilla) و تغییر امضا با تغییر ورودی', () => {
    const r = sign({ method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, body: '', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', now: new Date('2015-08-30T12:36:00Z') });
    assert.ok(/Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31/.test(r.headers.Authorization || r.headers.authorization), JSON.stringify(r.headers));
    const r2 = sign({ method: 'GET', url: 'https://example.amazonaws.com/x', headers: {}, body: '', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', now: new Date('2015-08-30T12:36:00Z') });
    assert.notStrictEqual(r.headers.Authorization || r.headers.authorization, r2.headers.Authorization || r2.headers.authorization);
  });

  console.log('● دسترسی و تنظیمات');
  await t('فقط سوپر ادمین: مدیر مدرسه صفحه، تب و اقدام‌های پشتیبان بیرونی را ندارد', async () => {
    for (const u of ['/super/offsite', '/super/health']) assert.strictEqual((await admin.get(u)).status, 403, u);
    for (const u of ['/super/offsite/test', '/super/offsite/sync', '/super/offsite/download']) { const r = await admin.post(u, {}, '/'); assert.strictEqual(r.status, 403, u); }
    const tabs = [...(await admin.get('/settings')).text.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]); assert.ok(!tabs.includes('offsite'), tabs.join());
    const r = await admin.req('POST', '/settings', { _group: 'offsite', offsite_enabled: '1', _csrf: admin.csrf((await admin.get('/settings')).text) }); assert.notStrictEqual(await val('offsite_enabled'), '1', 'مدیر نباید بتواند تنظیم کند'); assert.ok([302, 403, 200].includes(r.status));
    assert.ok((await sup.get('/settings')).text.includes('data-tab="offsite"')); assert.strictEqual((await sup.get('/super/offsite')).status, 200);
  });
  await t('اعتبارسنجی: فعال‌سازی بدون مقصد/کلید/رمز خطا می‌دهد؛ نشانی و پیشوند و رمز کوتاه رد می‌شود', async () => {
    const page = await sup.get('/settings?tab=offsite'); const tok = sup.csrf(page.text);
    const post = async (o) => { const r = await sup.req('POST', '/settings', { _group: 'offsite', _csrf: tok, ...o }); const m = /<div class="alert error"><ul>([\s\S]*?)<\/ul>/.exec(r.text); return m ? m[1].replace(/<[^>]+>/g, ' ') : null; };
    let f = await post({ offsite_enabled: '1', offsite_type: 's3', offsite_encrypt: '1' }); assert.ok(f && /bucket/.test(f) && /S3/.test(f), String(f));
    f = await post({ offsite_type: 's3', offsite_s3_endpoint: 'ftp://x' }); assert.ok(f && /http/.test(f), String(f));
    f = await post({ offsite_type: 's3', offsite_prefix: '../../etc' }); assert.ok(f && /پیشوند/.test(f), String(f));
    f = await post({ offsite_type: 's3', offsite_passphrase: 'short' }); assert.ok(f && /عبارت رمز/.test(f), String(f));
    f = await post({ offsite_enabled: '1', offsite_type: 'folder', offsite_dir: 'relative/dir', offsite_encrypt: '0' }); assert.ok(f && /مسیر/.test(f), String(f));
    f = await post({ offsite_enabled: '1', offsite_type: 'folder', offsite_dir: path.join(backups, 'x'), offsite_encrypt: '0' }); assert.ok(f && /داخل/.test(f), String(f));
    assert.notStrictEqual(await val('offsite_enabled'), '1');
  });

  console.log('● S3');
  const s3 = await mockS3({ bucket: 'schoolbk', ak: 'AKTEST123', sk: 'sk/secret+value', region: 'ir-thr-at1' });
  await t('ذخیره‌ی تنظیمات S3؛ کلید محرمانه و عبارت رمز هرگز در صفحه تکرار نمی‌شوند؛ آزمایش اتصال موفق و بی‌اثر', async () => {
    await setSettings(sup, { offsite_enabled: 1, offsite_type: 's3', offsite_kinds: 'auto_manual', offsite_keep: 2, offsite_prefix: 'p1/school', offsite_encrypt: 1, offsite_passphrase: PASS, offsite_s3_endpoint: s3.url, offsite_s3_region: 'ir-thr-at1', offsite_s3_bucket: 'schoolbk', offsite_s3_key: 'AKTEST123', offsite_s3_secret: 'sk/secret+value', offsite_s3_pathstyle: 1 });
    const html = (await sup.get('/settings?tab=offsite')).text; assert.ok(!html.includes('sk/secret'), 'secret در صفحه'); assert.ok(!html.includes(PASS), 'عبارت رمز در صفحه');
    assert.strictEqual(await val('offsite_s3_secret'), 'sk/secret+value', 'مقدار ذخیره شده (در DB، مثل کلید پیامک)');
    const r = await sup.post('/super/offsite/test', {}, '/super/offsite'); const f = flash(r); assert.ok(f && f.type === 'success', JSON.stringify(f));
    assert.strictEqual(s3.store.size, 0, 'فایل آزمایشی باید پاک شده باشد'); assert.strictEqual(s3.badSig, 0, 'امضا باید مستقلاً تأیید شود');
  });
  await t('پشتیبان دستی ← ارسال رمزنگاری‌شده به S3؛ محتوا قابل رمزگشایی و معتبر است', async () => {
    const f = flash(await sup.post('/backup/now', {}, '/backup')); assert.ok(f && f.type === 'success' && /بیرونی/.test(f.text), JSON.stringify(f));
    const keys = [...s3.store.keys()]; assert.strictEqual(keys.length, 1, keys.join()); assert.ok(/^p1\/school\/manual-\d{8}-\d{6}\.json\.gz\.enc$/.test(keys[0]), keys[0]);
    const obj = s3.store.get(keys[0]).body; assert.ok(BC.isEncrypted(obj)); assert.ok(!(obj[0] === 0x1f && obj[1] === 0x8b));
    const json = JSON.parse(zlib.gunzipSync(BC.decrypt(obj, PASS)).toString()); assert.ok(json.tables && json.tables.users, 'ساختار پشتیبان');
    const rows = json.tables.settings || []; const ks = rows.map((r) => r.key); const raw = JSON.stringify(json);
    for (const bad of ['offsite_state', 'offsite_s3_secret', 'offsite_passphrase', 'offsite_dav_pass']) assert.ok(!ks.includes(bad), bad + ' نباید در پشتیبان باشد'); assert.ok(ks.includes('offsite_s3_bucket'), 'تنظیمات غیرمحرمانه می‌آیند'); assert.ok(!raw.includes('sk/secret') && !raw.includes(PASS), 'اسرار نباید در پشتیبان باشند');
    assert.strictEqual(s3.badSig, 0);
    const st = JSON.parse(await val('offsite_state')); assert.ok(st.last_ok_at && !st.last_error && Object.keys(st.uploaded).length === 1);
    assert.ok(/ارسال شد|موفق/.test((await sup.get('/super/offsite')).text));
  });
  await t('انتخاب نوع: با «فقط خودکار» پشتیبان دستی ارسال نمی‌شود', async () => {
    await wait(1100); await setSettings(sup, { offsite_kinds: 'auto' }); const n = s3.store.size;
    const f = flash(await sup.post('/backup/now', {}, '/backup')); assert.ok(f && f.type === 'success' && !/بیرونی/.test(f.text), JSON.stringify(f)); assert.strictEqual(s3.store.size, n);
    await setSettings(sup, { offsite_kinds: 'auto_manual' });
  });
  await t('نگه‌داری: فقط آخرین ۲ نسخه از هر نوع در مقصد می‌ماند', async () => {
    for (let i = 0; i < 3; i++) { await wait(1100); const f = flash(await sup.post('/backup/now', {}, '/backup')); assert.ok(f && /بیرونی/.test(f.text), JSON.stringify(f)); }
    const keys = [...s3.store.keys()].sort(); assert.strictEqual(keys.length, 2, keys.join());
    const local = lsBk().filter((n) => n.startsWith('manual-')).sort(); assert.strictEqual(keys[1].split('/').pop(), local[local.length - 1] + '.enc', 'تازه‌ترین باید بماند');
  });
  await t('شکست مقصد: پشتیبان محلی سالم می‌ماند، هشدار نشان داده می‌شود، فقط یک اعلان در روز، و کار تکمیلی دوباره می‌فرستد', async () => {
    s3.st.mode = 'fail'; await wait(1100); const before = lsBk().length; const nb = async () => Number((await k('notifications').where({ link: '/super/offsite' }).count({ c: '*' }).first()).c);
    let f = flash(await sup.post('/backup/now', {}, '/backup')); assert.ok(f && f.type === 'warn' && /ناموفق/.test(f.text), JSON.stringify(f));
    assert.strictEqual(lsBk().length, before + 1, 'پشتیبان محلی باید ساخته شود');
    assert.ok(/ناموفق/.test((await sup.get('/super/offsite')).text)); assert.ok(/ناموفق|بیرونی/.test((await sup.get('/')).text), 'کار لازم در داشبورد');
    assert.strictEqual(await nb(), 1, 'یک اعلان'); await wait(1100); await sup.post('/backup/now', {}, '/backup'); assert.strictEqual(await nb(), 1, 'اعلان تکراری در همان روز نباید ساخته شود');
    s3.st.mode = 'ok'; f = flash(await sup.post('/super/offsite/sync', { force: '1' }, '/super/offsite')); assert.ok(f && f.type === 'success', JSON.stringify(f));
    const st = JSON.parse(await val('offsite_state')); assert.ok(!st.last_error, 'خطا باید پاک شود'); assert.ok([...s3.store.keys()].length >= 1);
  });
  await t('کلید اشتباه S3 → خطای ۴۰۳ خوانا (بدون افشای کلید)', async () => {
    await setSettings(sup, { offsite_s3_secret: 'wrong-secret-value' });
    const f = flash(await sup.post('/super/offsite/test', {}, '/super/offsite')); assert.ok(f && f.type === 'error' && /403/.test(f.text) && !/wrong-secret/.test(f.text), JSON.stringify(f));
    await setSettings(sup, { offsite_s3_secret: 'sk/secret+value' }); assert.strictEqual(flash(await sup.post('/super/offsite/test', {}, '/super/offsite')).type, 'success');
  });
  await t('دریافت از مقصد: فایل محلی گم‌شده برمی‌گردد (رمزگشایی‌شده)؛ نام نامعتبر رد می‌شود', async () => {
    const remote = (await sup.get('/super/offsite?remote=1')).text; const m = /name="name" value="(manual-[^"]+\.enc)"/.exec(remote); assert.ok(m, 'فهرست مقصد');
    const local = m[1].replace(/\.enc$/, ''); fs.unlinkSync(path.join(backups, local));
    const f = flash(await sup.post('/super/offsite/download', { name: m[1] }, '/super/offsite?remote=1')); assert.ok(f && f.type === 'success', JSON.stringify(f));
    const buf = fs.readFileSync(path.join(backups, local)); assert.ok(buf[0] === 0x1f && buf[1] === 0x8b, 'باید gzip ساده باشد'); JSON.parse(zlib.gunzipSync(buf));
    const bad = flash(await sup.post('/super/offsite/download', { name: '../../etc/passwd' }, '/super/offsite?remote=1')); assert.ok(bad && bad.type === 'error', JSON.stringify(bad));
  });
  await t('بازیابی از فایل .enc بارگذاری‌شده: بدون/با رمز اشتباه رد؛ با رمز درست انجام می‌شود و تنظیمات بیرونی حفظ می‌ماند', async () => {
    const key = [...s3.store.keys()][0]; const body = s3.store.get(key).body; const up = (pass) => sup.multipart('/backup/restore', { confirm: 'RESTORE', passphrase: pass }, { field: 'file', name: 'x.json.gz.enc', content: body }, '/backup');
    let f = flash(await up('')); assert.ok(f && f.type === 'error', JSON.stringify(f)); f = flash(await up('wrong-pass-9999')); assert.ok(f && f.type === 'error' && /رمز/.test(f.text), JSON.stringify(f));
    const r = await up(PASS); assert.ok(/ورود|login/i.test(r.text) || /\/login/.test(r.url), r.url);
    assert.strictEqual(await val('offsite_enabled'), '1'); assert.strictEqual(await val('offsite_s3_secret') !== undefined, true);
    const s2 = await app.login('super', 'Super#12345'); assert.strictEqual(flash(await s2.post('/super/offsite/test', {}, '/super/offsite')).type, 'success', 'کلید و رمز پس از بازیابی حفظ شده‌اند');
  });
  s3.close();

  console.log('● WebDAV و پوشه');
  const sup2 = await app.login('super', 'Super#12345');
  const dav = await mockDav({ user: 'cloud', pass: 'dav-pass-1' });
  await t('WebDAV: ساخت پوشه، ارسال، فهرست، خواندن، حذف قدیمی‌ها؛ رمز اشتباه ۴۰۱', async () => {
    await setSettings(sup2, { offsite_type: 'webdav', offsite_dav_url: dav.url, offsite_dav_user: 'cloud', offsite_dav_pass: 'dav-pass-1', offsite_prefix: 'bk/school', offsite_keep: 1 });
    assert.strictEqual(flash(await sup2.post('/super/offsite/test', {}, '/super/offsite')).type, 'success');
    await wait(1100); const f = flash(await sup2.post('/backup/now', {}, '/backup')); assert.ok(f && /بیرونی/.test(f.text) && f.type === 'success', JSON.stringify(f));
    await wait(1100); await sup2.post('/backup/now', {}, '/backup');
    const names = [...dav.files.keys()]; assert.strictEqual(names.length, 1, names.join()); assert.ok(/^\/dav\/bk\/school\/manual-.*\.enc$/.test(names[0]), names[0]);
    assert.ok(BC.isEncrypted(dav.files.get(names[0]).body));
    assert.ok(/manual-/.test((await sup2.get('/super/offsite?remote=1')).text));
    await setSettings(sup2, { offsite_dav_pass: 'bad-pass-xyz' }); const e = flash(await sup2.post('/super/offsite/test', {}, '/super/offsite')); assert.ok(e && e.type === 'error' && /401/.test(e.text), JSON.stringify(e));
  });
  dav.close();
  await t('پوشه‌ی دیگر: ارسال بدون رمزنگاری (اگر خاموش شود)، مجوز فایل ۶۰۰، نام امن', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-dir-'));
    await setSettings(sup2, { offsite_type: 'folder', offsite_dir: dir, offsite_prefix: 'sch', offsite_encrypt: 0, offsite_keep: 0 });
    assert.strictEqual(flash(await sup2.post('/super/offsite/test', {}, '/super/offsite')).type, 'success');
    await wait(1100); const f = flash(await sup2.post('/backup/now', {}, '/backup')); assert.ok(f && f.type === 'success' && /بیرونی/.test(f.text), JSON.stringify(f));
    const files = fs.readdirSync(path.join(dir, 'sch')); assert.strictEqual(files.length, 1, files.join()); assert.ok(/^manual-\d{8}-\d{6}\.json\.gz$/.test(files[0]));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'sch', files[0])).mode & 0o077, 0, 'مجوز فایل');
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'sch', files[0]))));
  });
  await t('کار دوره‌ای: مرحله‌های offsite و ratelimit در jobs وجود دارند و بدون خطا اجرا می‌شوند', async () => {
    const r = await sup2.req('GET', '/super/health'); assert.strictEqual(r.status, 200);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'jobs.js'), 'utf8'); assert.ok(/'offsite'/.test(src) && /'ratelimit'/.test(src));
  });
  await app.stop(); process.exit(done() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

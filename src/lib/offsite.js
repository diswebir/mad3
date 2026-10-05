'use strict';
/**
 * پشتیبان بیرون از هاست: نسخه‌ی پشتیبان (data/backups) را — در صورت تمایل رمزنگاری‌شده — به مقصد دیگری می‌فرستد.
 * مقصدها: S3 و سازگارها (آروان، لیارا، Wasabi، Backblaze، MinIO…) · WebDAV (نکست‌کلود و …) · پوشه‌ی دلخواه روی سرور (مثلاً دیسک متصل).
 * همه‌ی تنظیمات فقط در دسترس سوپر ادمین است؛ کلیدها در خود پشتیبان نمی‌آیند.
 * ارسال‌های ناموفق در اجرای بعدیِ کارهای دوره‌ای (هر ۳۰ دقیقه/cron) دوباره تلاش می‌شوند.
 */
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const config = require('../config');
const BC = require('./backupCrypto');
const { sign, rfc } = require('./sigv4');

const STATE_KEY = 'offsite_state';
const REMOTE_RE = /^(auto|manual|pre-promotion|pre-restore)-\d{8}-\d{6}\.json\.gz(\.enc)?$/;
const TIMEOUT = 60000;

/** تنظیمات مؤثر. get(key) پیش‌فرض از تنظیمات ذخیره‌شده می‌خواند؛ برای اعتبارسنجی فرمِ ذخیره‌نشده می‌توان تابع دیگری داد. */
function cfg(get = (k) => settings.get(k)) {
  const T = (k) => String(get(k) === undefined || get(k) === null ? '' : get(k)).trim(); const B = (k) => ['1', 1, true].includes(get(k)); const N = (k) => Number(get(k)) || 0;
  return {
    enabled: B('offsite_enabled'), type: T('offsite_type') || 's3', kinds: T('offsite_kinds') || 'auto_manual', keep: N('offsite_keep'),
    prefix: T('offsite_prefix').replace(/^\/+|\/+$/g, ''), encrypt: B('offsite_encrypt'), pass: T('offsite_passphrase'), alert: B('offsite_alert'),
    s3: { endpoint: T('offsite_s3_endpoint').replace(/\/+$/, ''), region: T('offsite_s3_region') || 'us-east-1', bucket: T('offsite_s3_bucket'), key: T('offsite_s3_key'), secret: T('offsite_s3_secret'), pathStyle: B('offsite_s3_pathstyle') },
    dav: { url: T('offsite_dav_url').replace(/\/+$/, ''), user: T('offsite_dav_user'), pass: T('offsite_dav_pass') },
    dir: T('offsite_dir'),
  };
}
/** بررسی کامل‌بودن تنظیمات؛ فهرست خطاها (خالی = درست). v = مقادیر ادغام‌شده‌ی فرم (اختیاری) */
function validate(c = cfg()) {
  const e = [];
  if (c.encrypt && c.pass.length < 8) e.push('عبارت رمز (حداقل ۸ نویسه) را وارد کنید یا رمزنگاری را خاموش کنید.');
  if (c.type === 's3') {
    if (!/^https?:\/\/[^\s/]+/.test(c.s3.endpoint)) e.push('نشانی سرویس S3 (مثل https://s3.ir-thr-at1.arvanstorage.ir) را وارد کنید.');
    if (!c.s3.bucket) e.push('نام bucket را وارد کنید.'); if (!c.s3.key || !c.s3.secret) e.push('کلید دسترسی و کلید محرمانه‌ی S3 را وارد کنید.');
  } else if (c.type === 'webdav') {
    if (!/^https?:\/\/[^\s/]+/.test(c.dav.url)) e.push('نشانی WebDAV را وارد کنید.'); if (!c.dav.user) e.push('نام کاربری WebDAV را وارد کنید.');
  } else if (c.type === 'folder') {
    if (!/^(\/|[A-Za-z]:[\\/])/.test(c.dir) || /(^|[\\/])\.\.([\\/]|$)/.test(c.dir)) e.push('مسیر پوشه باید کامل (مطلق) و بدون «..» باشد.');
    else if (path.resolve(c.dir).startsWith(path.resolve(config.DATA_DIR, 'backups'))) e.push('پوشه‌ی بیرونی نباید داخل پوشه‌ی پشتیبان‌های همین سرور باشد.');
  } else e.push('نوع مقصد نامعتبر است.');
  return e;
}

/* ---------------------------------- مقصدها ---------------------------------- */
const withTimeout = () => AbortSignal.timeout(TIMEOUT);
async function httpOk(res, okCodes, what) {
  if (okCodes.includes(res.status)) return res;
  let body = ''; try { body = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); } catch (_) { /* ignore */ }
  throw new Error(`${what}: HTTP ${res.status}${body ? ' — ' + body : ''}`);
}
const keyOf = (c, name) => (c.prefix ? c.prefix + '/' : '') + name;

function s3Provider(c) {
  const { endpoint, region, bucket, key: ak, secret: sk, pathStyle } = c.s3; const ep = new URL(endpoint);
  const base = pathStyle ? `${ep.protocol}//${ep.host}/${rfc(bucket)}` : `${ep.protocol}//${bucket}.${ep.host}`;
  const urlFor = (k, q = '') => `${base}/${k.split('/').map(rfc).join('/')}${q}`;
  const call = async (method, url, { body, headers } = {}) => {
    const s = sign({ method, url, headers: headers || {}, body: body || '', accessKey: ak, secretKey: sk, region, service: 's3' });
    return fetch(url, { method, headers: s.headers, body: body || undefined, signal: withTimeout() });
  };
  return {
    label: 'S3',
    async put(name, buf) { await httpOk(await call('PUT', urlFor(keyOf(c, name)), { body: buf, headers: { 'content-type': 'application/octet-stream' } }), [200, 201, 204], 'ارسال به S3'); },
    async get(name) { const r = await httpOk(await call('GET', urlFor(keyOf(c, name))), [200], 'دریافت از S3'); return Buffer.from(await r.arrayBuffer()); },
    async del(name) { await httpOk(await call('DELETE', urlFor(keyOf(c, name))), [200, 204, 404], 'حذف از S3'); },
    async list() {
      const out = []; let token = '';
      for (let page = 0; page < 20; page++) {
        const q = `?list-type=2&max-keys=1000&prefix=${rfc(c.prefix ? c.prefix + '/' : '')}${token ? '&continuation-token=' + rfc(token) : ''}`;
        const r = await httpOk(await call('GET', `${base}/${q}`), [200], 'فهرست S3'); const xml = await r.text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const k = (/<Key>([\s\S]*?)<\/Key>/.exec(m[1]) || [])[1]; if (!k) continue;
          const nm = k.split('/').pop(); if (!REMOTE_RE.test(nm)) continue;
          out.push({ name: nm, size: Number((/<Size>(\d+)<\/Size>/.exec(m[1]) || [])[1] || 0), mtime: Date.parse((/<LastModified>([^<]+)<\/LastModified>/.exec(m[1]) || [])[1]) || 0 });
        }
        const t = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml); if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && t) token = t[1]; else break;
      }
      return out;
    },
  };
}

function davProvider(c) {
  const auth = 'Basic ' + Buffer.from(`${c.dav.user}:${c.dav.pass}`).toString('base64');
  const root = c.dav.url; const segs = c.prefix ? c.prefix.split('/').filter(Boolean) : [];
  const dirUrl = root + segs.map((s) => '/' + rfc(s)).join('');
  const call = (method, url, { body, headers } = {}) => fetch(url, { method, headers: { Authorization: auth, ...(headers || {}) }, body: body || undefined, signal: withTimeout() });
  let ensured = false;
  const ensure = async () => {
    if (ensured) return; let cur = root;
    for (const s of segs) { cur += '/' + rfc(s); const r = await call('MKCOL', cur); if (![200, 201, 204, 301, 405].includes(r.status)) await httpOk(r, [201], 'ساخت پوشه در WebDAV'); }
    ensured = true;
  };
  return {
    label: 'WebDAV',
    async put(name, buf) { await ensure(); await httpOk(await call('PUT', `${dirUrl}/${rfc(name)}`, { body: buf, headers: { 'content-type': 'application/octet-stream' } }), [200, 201, 204], 'ارسال به WebDAV'); },
    async get(name) { const r = await httpOk(await call('GET', `${dirUrl}/${rfc(name)}`), [200], 'دریافت از WebDAV'); return Buffer.from(await r.arrayBuffer()); },
    async del(name) { await httpOk(await call('DELETE', `${dirUrl}/${rfc(name)}`), [200, 204, 404], 'حذف از WebDAV'); },
    async list() {
      await ensure();
      const r = await httpOk(await call('PROPFIND', dirUrl + '/', { headers: { Depth: '1', 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>' }), [200, 207], 'فهرست WebDAV'); const xml = await r.text();
      const out = [];
      for (const m of xml.matchAll(/<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
        const href = (/<(?:\w+:)?href[^>]*>([^<]+)</.exec(m[1]) || [])[1]; if (!href) continue;
        let nm = ''; try { nm = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop()); } catch (_) { continue; }
        if (!REMOTE_RE.test(nm)) continue;
        out.push({ name: nm, size: Number((/<(?:\w+:)?getcontentlength[^>]*>(\d+)</.exec(m[1]) || [])[1] || 0), mtime: Date.parse((/<(?:\w+:)?getlastmodified[^>]*>([^<]+)</.exec(m[1]) || [])[1]) || 0 });
      }
      return out;
    },
  };
}

function folderProvider(c) {
  const dir = path.resolve(c.dir, c.prefix || '');
  const safe = (n) => { if (!REMOTE_RE.test(n) && !/^\.healthcheck-[a-f0-9]+$/.test(n)) throw new Error('نام فایل نامعتبر است.'); return path.join(dir, n); };
  return {
    label: 'پوشه',
    async put(name, buf) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(safe(name), buf, { mode: 0o600 }); },
    async get(name) { return fs.readFileSync(safe(name)); },
    async del(name) { try { fs.unlinkSync(safe(name)); } catch (_) { /* قبلاً حذف شده */ } },
    async list() { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter((n) => REMOTE_RE.test(n)).map((name) => { const st = fs.statSync(path.join(dir, name)); return { name, size: st.size, mtime: st.mtimeMs }; }); },
  };
}
function provider(c = cfg()) { return c.type === 'webdav' ? davProvider(c) : c.type === 'folder' ? folderProvider(c) : s3Provider(c); }

/* ---------------------------------- وضعیت ---------------------------------- */
function state() { try { const s = JSON.parse(settings.get(STATE_KEY) || '{}'); return { uploaded: {}, history: [], ...s }; } catch (_) { return { uploaded: {}, history: [] }; } }
async function saveState(s) {
  const names = Object.keys(s.uploaded || {}); if (names.length > 300) { for (const n of names.sort().slice(0, names.length - 300)) delete s.uploaded[n]; }
  s.history = (s.history || []).slice(0, 30); await settings.set(STATE_KEY, JSON.stringify(s));
}
const kindOf = (name) => name.split('-').slice(0, name.startsWith('pre-') ? 2 : 1).join('-');
const wanted = (c, name) => { const k = kindOf(name); return c.kinds === 'all' || k === 'auto' || (c.kinds === 'auto_manual' && k === 'manual'); };

async function alertSupers(message) {
  try {
    const db = require('../db'); const svc = require('../services'); const s = state(); const today = new Date().toISOString().slice(0, 10);
    if (s.alerted === today) return; s.alerted = today; await saveState(s);
    const ids = (await db.get()('users').where({ role: 'superadmin', active: 1 }).select('id')).map((x) => x.id);
    await svc.notify(ids, 'پشتیبان بیرونی ناموفق بود', String(message).slice(0, 300), '/super/offsite', 'warn');
  } catch (_) { /* اعلان اختیاری */ }
}

/** حذف نسخه‌های قدیمی مقصد: آخرین keep نسخه از هر نوع می‌ماند (keep=0 یعنی هرگز حذف نکن) */
async function pruneRemote(prov, c) {
  if (!(c.keep > 0)) return 0; const list = await prov.list(); const by = {};
  for (const f of list) (by[kindOf(f.name)] = by[kindOf(f.name)] || []).push(f);
  let n = 0; for (const arr of Object.values(by)) { arr.sort((a, b) => (a.name < b.name ? 1 : -1)); for (const f of arr.slice(c.keep)) { try { await prov.del(f.name); n++; } catch (_) { /* بعداً */ } } }
  return n;
}

/** ارسال یک نسخه‌ی محلی. خروجی: { ok, name?, remote?, ms?, error?, skipped? } */
async function push(name) {
  const c = cfg(); if (!c.enabled) return { ok: false, skipped: true, error: 'پشتیبان بیرونی غیرفعال است.' };
  const errs = validate(c); if (errs.length) { const e = errs[0]; await record({ name, ok: false, error: e }); return { ok: false, error: e }; }
  const B = require('./backupTools'); const p = B.pathOf(name); if (!p || !fs.existsSync(p)) return { ok: false, error: 'فایل پشتیبان محلی پیدا نشد.' };
  const t0 = Date.now();
  try {
    const raw = fs.readFileSync(p); const data = c.encrypt ? BC.encrypt(raw, c.pass) : raw; const remote = name + (c.encrypt ? '.enc' : '');
    const prov = provider(c); await prov.put(remote, data);
    try { await pruneRemote(prov, c); } catch (_) { /* حذف قدیمی‌ها اختیاری */ }
    const ms = Date.now() - t0; await record({ name, remote, ok: true, ms, size: data.length });
    return { ok: true, name, remote, ms, size: data.length };
  } catch (e) {
    const msg = String(e && e.cause && e.cause.message ? `${e.message} (${e.cause.message})` : e.message || e).slice(0, 300);
    await record({ name, ok: false, error: msg, ms: Date.now() - t0 }); if (c.alert) await alertSupers(`ارسال «${name}» ناموفق بود: ${msg}`);
    return { ok: false, error: msg };
  }
}
async function record(ev) {
  const s = state(); const at = new Date().toISOString();
  s.history.unshift({ at, name: ev.name, ok: ev.ok, ms: ev.ms, size: ev.size, error: ev.error });
  if (ev.ok) { s.uploaded[ev.name] = at; s.last_ok_at = at; s.last_ok_name = ev.name; s.last_error = null; s.alerted = null; } else { s.last_error = ev.error; s.last_error_at = at; }
  await saveState(s);
}

/** ارسال نسخه‌های هنوز ارسال‌نشده (تازه‌ترین‌ها، حداکثر max فایل در هر اجرا). برای کار دوره‌ای و دکمه‌ی «ارسال همین حالا» */
async function syncPending({ max = 3, force = false } = {}) {
  const c = cfg(); if (!c.enabled) return { skipped: true };
  const B = require('./backupTools'); const s = state();
  const todo = B.list().filter((f) => wanted(c, f.name) && (force || !s.uploaded[f.name])).sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(1, max));
  const out = { sent: 0, failed: 0 };
  for (const f of todo) { const r = await push(f.name); if (r.ok) out.sent++; else { out.failed++; out.error = r.error; if (!force) break; } }
  return out;
}
/** پس از ساخت هر پشتیبان محلی فراخوانی می‌شود */
async function afterSave(name) { const c = cfg(); if (!c.enabled || !wanted(c, name)) return null; return push(name); }

/** آزمایش اتصال: یک فایل کوچک می‌نویسد، فهرست می‌گیرد، می‌خواند و پاک می‌کند */
async function test() {
  const c = cfg(); const errs = validate(c); if (errs.length) return { ok: false, error: errs[0] };
  const t0 = Date.now(); const nm = '.healthcheck-' + require('crypto').randomBytes(4).toString('hex');
  try {
    const prov = provider(c); const body = Buffer.from('school-offsite-check ' + new Date().toISOString());
    await prov.put(nm, body); const back = await prov.get(nm); await prov.del(nm); // نام آزمایشی با الگوی فهرست یکی نیست؛ فقط نوشتن/خواندن/حذف
    if (!back.equals(body)) throw new Error('محتوای خوانده‌شده با محتوای نوشته‌شده یکی نیست.');
    const n = (await prov.list()).length;
    return { ok: true, ms: Date.now() - t0, label: prov.label, remoteCount: n };
  } catch (e) { return { ok: false, error: String(e && e.cause && e.cause.message ? `${e.message} (${e.cause.message})` : e.message || e).slice(0, 300) }; }
}

async function remoteList() { const c = cfg(); const errs = validate(c); if (errs.length) throw new Error(errs[0]); return (await provider(c).list()).sort((a, b) => (a.name < b.name ? 1 : -1)); }
/** دریافت یک نسخه‌ی بیرونی (و رمزگشایی) و ذخیره در پوشه‌ی پشتیبان‌های محلی تا از صفحه‌ی پشتیبان‌گیری بازیابی شود */
async function download(remoteName) {
  if (!REMOTE_RE.test(String(remoteName))) throw new Error('نام فایل نامعتبر است.');
  const c = cfg(); const errs = validate(c); if (errs.length) throw new Error(errs[0]);
  let buf = await provider(c).get(remoteName); if (BC.isEncrypted(buf)) buf = BC.decrypt(buf, c.pass);
  if (!(buf[0] === 0x1f && buf[1] === 0x8b)) throw new Error('فایل دریافتی یک پشتیبان معتبر نیست.');
  const B = require('./backupTools'); const local = remoteName.replace(/\.enc$/, ''); const dest = B.pathOf(local);
  fs.mkdirSync(B.DIR(), { recursive: true, mode: 0o700 }); if (fs.existsSync(dest)) return { name: local, existed: true };
  fs.writeFileSync(dest, buf, { mode: 0o600 }); return { name: local, existed: false, size: buf.length };
}

module.exports = { cfg, validate, provider, push, syncPending, afterSave, test, remoteList, download, state, STATE_KEY, REMOTE_RE, kindOf };

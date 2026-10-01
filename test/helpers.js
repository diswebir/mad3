'use strict';
/** زیرساخت مشترک تست‌های نسخه‌ی ۲: نصب CLI با داده‌ی دمو، اجرای سرور و کلاینت HTTP با کوکی */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PREFIX = process.env.TEST_BASE_PATH || '';
let counts = { pass: 0, fail: 0 };

class Client {
  constructor(base, prefix) { this.cookies = {}; this.base = base; this.prefix = prefix; }
  strip(u) { u = u.replace(this.base, ''); return this.prefix && (u.startsWith(this.prefix + '/') || u === this.prefix) ? u.slice(this.prefix.length) || '/' : u; }
  async req(method, url, form, { follow = true, headers: extra = {} } = {}) {
    url = this.strip(url);
    const headers = { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(Object.entries(form).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString(); }
    const res = await fetch(this.base + url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    if (follow && [301, 302, 303].includes(res.status)) return this.req('GET', res.headers.get('location'));
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, text: buf.toString('utf8'), buf, url, location: res.headers.get('location'), headers: res.headers };
  }
  csrf(html) { const m = /name="_csrf" value="([a-f0-9]+)"/.exec(html) || /_csrf=([a-f0-9]+)/.exec(html); return m && m[1]; }
  get(url) { return this.req('GET', url); }
  /** POST با دریافت خودکار توکن CSRF از صفحه‌ی مبدأ (پیش‌فرض: همان آدرس) */
  async post(url, form, csrfFrom, opts) { const page = await this.get(csrfFrom || url); const token = this.csrf(page.text); assert.ok(token, 'CSRF token not found on ' + (csrfFrom || url)); return this.req('POST', url, { ...form, _csrf: token }, opts); }
  async multipart(url, fields, file, csrfFrom) {
    const page = await this.get(csrfFrom); const token = this.csrf(page.text);
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append(file.field, new Blob([file.content]), file.name);
    const res = await fetch(`${this.base}${this.strip(url)}?_csrf=${token}`, { method: 'POST', headers: { cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: fd, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    if ([301, 302, 303].includes(res.status)) return this.req('GET', res.headers.get('location'));
    return { status: res.status, text: await res.text(), url };
  }
}

async function t(name, fn) { try { await fn(); counts.pass++; console.log('  ✓', name); } catch (e) { counts.fail++; console.log('  ✗', name, '\n     ', String(e.stack || e.message).split('\n').slice(0, process.env.VERBOSE ? 14 : 3).join('\n      ')); } }
const ok = (r, msg) => { assert.ok(r.status === 200, `${msg || r.url} → HTTP ${r.status}`); assert.ok(!/خطای سرور/.test(r.text), `${msg || r.url} → خطای سرور`); return r; };
const flash = (r) => { const m = /class="alert (?:flash )?(success|error|info|warn)[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<div>([\s\S]*?)<\/div>/.exec(r.text); return m ? { type: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() } : null; };

/** نصب تازه در پوشه‌ی موقت و اجرای سرور. خروجی: { base, k (knex مستقل برای بررسی DB), login, stop } */
async function boot({ prefix = PREFIX, demo = true } = {}) {
  const port = 3700 + Math.floor(Math.random() * 600); const data = fs.mkdtempSync(path.join(os.tmpdir(), 'school-v2-'));
  const env = { ...process.env, PORT: String(port), SCHOOL_DATA_DIR: data, NODE_ENV: 'test', BASE_PATH: prefix };
  const inst = spawnSync(process.execPath, ['scripts/install-demo.js', ...(demo ? [] : ['--no-demo'])], { cwd: ROOT, env, encoding: 'utf8' });
  if (inst.status !== 0) throw new Error('install failed: ' + inst.stdout + inst.stderr);
  const server = spawn(process.execPath, ['app.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}${prefix}`;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/healthz'); if (r.ok) break; } catch (_) { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  const knex = require('knex')({ client: 'better-sqlite3', connection: { filename: path.join(data, 'school.sqlite') }, useNullAsDefault: true });
  const login = async (username, password) => { const c = new Client(base, prefix); const p = await c.get('/login'); const r = await c.req('POST', '/login', { _csrf: c.csrf(p.text), username, password }); if (/name="password"/.test(r.text) && /\/login/.test(r.url)) throw new Error('login failed for ' + username); return c; };
  return { base, port, data, k: knex, login, log: () => log, newClient: () => new Client(base, prefix), stop: async () => { server.kill('SIGTERM'); await knex.destroy(); await new Promise((r) => setTimeout(r, 200)); fs.rmSync(data, { recursive: true, force: true }); } };
}
const done = () => { console.log(`\n${counts.pass} موفق، ${counts.fail} ناموفق`); return counts.fail === 0; };

const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** مقادیر فعلی فرم تنظیمات را می‌خواند، overrides را اعمال می‌کند و ذخیره می‌کند (تیک‌ها: 1/0) */
async function setSettings(admin, overrides) {
  const page = await admin.get('/settings'); const m = /<form method="post" action="[^"]*\/settings">([\s\S]*?)<\/form>/.exec(page.text); assert.ok(m, 'settings form not found');
  const html = m[1]; const form = {};
  for (const i of html.matchAll(/<input\b([^>]*)>/g)) {
    const a = i[1]; const name = (/name="([^"]*)"/.exec(a) || [])[1]; if (!name) continue; const type = (/type="([^"]*)"/.exec(a) || [])[1] || 'text'; const val = unesc((/value="([^"]*)"/.exec(a) || [])[1] || '');
    if (type === 'checkbox') { if (/\bchecked\b/.test(a)) form[name] = [].concat(form[name] || [], val); } else if (name !== '_csrf') form[name] = val;
  }
  for (const s of html.matchAll(/<select name="([^"]*)">([\s\S]*?)<\/select>/g)) { const sel = /<option value="([^"]*)" selected/.exec(s[2]) || /<option value="([^"]*)"/.exec(s[2]); form[s[1]] = sel ? unesc(sel[1]) : ''; }
  for (const t of html.matchAll(/<textarea name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) form[t[1]] = unesc(t[2]);
  for (const [k, v] of Object.entries(overrides)) { if (Array.isArray(v)) form[k] = v.map(String); else if (v === 1 || v === 0 || v === '1' || v === '0') { if (String(v) === '1' && typeof form[k] === 'undefined') form[k] = '1'; else if (String(v) === '0') delete form[k]; else form[k] = String(v); } else form[k] = String(v); }
  const r = await admin.req('POST', '/settings', { ...form, _csrf: admin.csrf(page.text) });
  const f = flash(r); assert.ok(f && f.type === 'success', 'settings not saved: ' + (f ? f.text : r.status)); return r;
}
/** بارگذاری ماژول‌های برنامه در همین پردازش روی پایگاه دادهٔ نمونهٔ در حال اجرا (برای تست واحدِ دارای DB) */
async function inproc(app) {
  process.env.SCHOOL_DATA_DIR = app.data; process.env.NODE_ENV = 'test';
  const config = require('../src/config'); const db = require('../src/db'); const settings = require('../src/settings'); const modules = require('../src/modules');
  db.init(config.load().db); await settings.load(); await modules.load();
  return { db, settings, modules, k: db.get() };
}
/** سرور ساختگی IPPanel Edge: درخواست‌ها را ثبت می‌کند. mode: 'ok' | 'fail' | 'invalid' */
function mockIppanel() {
  const http = require('http'); const calls = []; const state = { mode: 'ok', calls };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      let json = null; try { json = JSON.parse(body); } catch (_) { /* */ }
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], body: json });
      res.setHeader('Content-Type', 'application/json');
      if (state.mode === 'ok') return res.end(JSON.stringify({ data: { message_outbox_ids: [1000 + calls.length] }, meta: { status: true, message: 'ok', message_code: '200-1' } }));
      if (state.mode === 'invalid') { res.statusCode = 401; return res.end(JSON.stringify({ meta: { status: false, message: 'توکن نامعتبر است', message_code: '400-1' } })); }
      res.statusCode = 422; res.end(JSON.stringify({ meta: { status: false, message: 'validation', message_code: '400-2', errors: { from_number: ['invalid'] } } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ ...state, state, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** منتظر می‌ماند تا fn مقدار truthy بدهد */
async function until(fn, ms = 5000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await wait(100); } }
module.exports = { boot, t, ok, flash, done, assert, Client, counts, setSettings, inproc, mockIppanel, until, wait, unesc };


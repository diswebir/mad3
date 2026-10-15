#!/usr/bin/env node
'use strict';
/**
 * ابزار سنجش بار (بدون وابستگی). کاربران مجازی وارد می‌شوند و صفحه‌های منوی هر نقش را به‌صورت گردشی باز می‌کنند.
 *
 *   npm run loadtest -- --url http://127.0.0.1:3000 --users 50 --duration 20
 *
 * گزینه‌ها:
 *   --url URL            نشانی سایت (پیش‌فرض http://127.0.0.1:3000؛ با BASE_PATH مثل http://host/school)
 *   --users N            تعداد کاربر هم‌زمان (۲۰)
 *   --duration S         مدت آزمون به ثانیه (۱۵)
 *   --ramp S             افزایش تدریجی کاربران در S ثانیه (۳)
 *   --think MS           مکث بین دو درخواست هر کاربر (۰ = پشت‌سرهم، بدترین حالت؛ ۱۰۰۰ = کاربر واقعی‌تر)
 *   --session-pages N    تعداد صفحه‌ی هر نشست پیش از ورود دوباره (۴۰)
 *   --scenario browse|login|mix   browse: گشت‌وگذار (پیش‌فرض) · login: فقط ورود/خروج · mix: هر دو
 *   --accounts "u:p,u:p" حساب‌های آزمون؛ پیش‌فرض حساب‌های دمو (مدیر، معلم، دانش‌آموز، ولی)
 *   --host-header H      برای اجرا پشت قفل دامنه (هدر Host را جعل می‌کند)
 *   --json FILE          خروجی ماشین‌خوان
 *   --max-error PCT      اگر درصد خطا بیشتر شد با کد ۱ خارج شود (۱)  ·  --max-p95 MS   اگر P95 بیشتر شد با کد ۱ خارج شود
 * هشدار: فقط روی نصب آزمایشی/دمو اجرا کنید؛ ابزار فقط می‌خواند (GET) و ورود/خروج می‌کند.
 */
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs = require('fs');
const zlib = require('zlib');

const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1'; args[k] = v; } }
if (args.help || args.h) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, '').replace(/^ \* ?/gm, '')); process.exit(0); }
const BASE = new URL(args.url || process.env.LOADTEST_URL || 'http://127.0.0.1:3000'); const PREFIX = BASE.pathname.replace(/\/$/, '');
const USERS = Math.max(1, Number(args.users) || 20); const DURATION = Math.max(2, Number(args.duration) || 15); const RAMP = Math.min(DURATION / 2, Number(args.ramp === undefined ? 3 : args.ramp));
const SESSION_PAGES = Math.max(1, Number(args['session-pages']) || 40);
const THINK = Math.max(0, Number(args.think) || 0); const SCENARIO = args.scenario || 'browse';
const ACCOUNTS = String(args.accounts || 'admin:Admin#12345,t.ahmadi:teacher123,a.taheri:teacher123,14050001:student123').split(',').map((s) => { const i = s.indexOf(':'); return { u: s.slice(0, i), p: s.slice(i + 1) }; });
const lib = BASE.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: USERS + 4 });

function request(method, path, { cookies, form } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now(); let body;
    const headers = { 'accept-encoding': 'gzip', cookie: cookies ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') : '' };
    if (args['host-header']) headers.host = args['host-header'];
    if (form) { body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; headers['content-length'] = Buffer.byteLength(body); }
    const req = lib.request({ agent, hostname: BASE.hostname, port: BASE.port || (BASE.protocol === 'https:' ? 443 : 80), path: PREFIX + path, method, headers, timeout: 30000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, location: res.headers.location || '', ms: performance.now() - t0, bytes: buf.length, text: (res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(buf) : buf).toString('utf8'), headers: res.headers }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', (e) => resolve({ status: 0, ms: performance.now() - t0, bytes: 0, text: '', err: e.message, headers: {} }));
    if (body) req.write(body); req.end();
  });
}
const jar = (res, cookies) => { for (const c of [].concat(res.headers['set-cookie'] || [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); cookies[kv.slice(0, i)] = kv.slice(i + 1); } };
async function login(acc) {
  const cookies = {}; const g = await request('GET', '/login', { cookies }); jar(g, cookies);
  const m = /name="_csrf" value="([a-f0-9]+)"/.exec(g.text); if (!m) return { ok: false, why: `صفحه‌ی ورود HTTP ${g.status}`, g };
  const p = await request('POST', '/login', { cookies, form: { username: acc.u, password: acc.p, _csrf: m[1] } }); jar(p, cookies);
  return { ok: p.status === 302 || p.status === 303, why: `ورود HTTP ${p.status}`, cookies, g, p };
}

const stats = { all: [], byPage: new Map(), codes: new Map(), errors: new Map(), bytes: 0, started: 0 };
function rec(label, r, expectOk = (s) => s >= 200 && s < 400) {
  const failed = r.status === 0 || r.status >= 500 || !expectOk(r.status) || (r.status >= 300 && /\/login/.test(r.location || '') && !/^(ورود|خروج)/.test(label)); // بازگشت به صفحه‌ی ورود = نشست از دست رفته
  stats.all.push(r.ms); stats.bytes += r.bytes;
  const e = stats.byPage.get(label) || { n: 0, ms: [], fail: 0 }; e.n++; e.ms.push(r.ms); if (failed) e.fail++; stats.byPage.set(label, e);
  stats.codes.set(r.status, (stats.codes.get(r.status) || 0) + 1);
  if (failed) { const k = `${label} → ${r.status || r.err}`; stats.errors.set(k, (stats.errors.get(k) || 0) + 1); }
}
const SKIP = /logout|export|download|\/backup|cron|print|\.pdf|\.xlsx|\.csv|\/api\/|\/install|\/_|#|sms|mailto|javascript/i;
async function discover(acc) {
  const l = await login(acc); if (!l.ok) return { pages: ['/'], err: l.why };
  const dash = await request('GET', '/', { cookies: l.cookies });
  const nav = (/<nav class="nav"[\s\S]*?<\/nav>/.exec(dash.text) || [dash.text])[0];
  const set = new Set(['/']); for (const m of nav.matchAll(/href="([^"#?][^"]*)"/g)) { let h = m[1]; if (PREFIX && h.startsWith(PREFIX + '/')) h = h.slice(PREFIX.length); if (h.startsWith('/') && !SKIP.test(h) && !h.startsWith('//')) set.add(h); }
  return { pages: [...set].slice(0, 40) };
}

let stop = false; let active = 0;
async function vuser(i, pagesFor) {
  const acc = ACCOUNTS[i % ACCOUNTS.length]; const pages = pagesFor(acc);
  active++;
  try {
    while (!stop) {
      if (SCENARIO === 'login' || (SCENARIO === 'mix' && Math.random() < 0.1)) {
        const t0 = performance.now(); const l = await login(acc); const ms = performance.now() - t0;
        rec('ورود (GET+POST)', { status: l.ok ? 302 : (l.p ? l.p.status : 0), ms, bytes: 0, err: l.why });
        if (l.ok) { const o = await request('POST', '/logout', { cookies: l.cookies, form: { _csrf: (/name="_csrf" value="([a-f0-9]+)"/.exec((await request('GET', '/', { cookies: l.cookies })).text) || [])[1] || '' } }); rec('خروج', o, (s) => s < 500); }
        if (SCENARIO === 'login') { if (THINK) await new Promise((r) => setTimeout(r, THINK)); continue; }
      }
      const l = await login(acc); if (!l.ok) { rec('ورود (GET+POST)', { status: l.p ? l.p.status : 0, ms: 0, bytes: 0, err: l.why }); await new Promise((r) => setTimeout(r, 500)); continue; }
      let n = 0; const order = pages.slice().sort(() => Math.random() - 0.5);
      for (const pg of order) {
        if (stop) break; const r = await request('GET', pg, { cookies: l.cookies }); rec(pg, r, (s) => s === 200 || s === 403 || s === 302);
        if (THINK) await new Promise((x) => setTimeout(x, THINK * (0.5 + Math.random()))); if (++n >= SESSION_PAGES) break; // طول نشست؛ پس از آن ورود تازه (ورود bcrypt دارد و گران است)
      }
    }
  } finally { active--; }
}

const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
const f = (n) => (Math.round(n * 10) / 10).toFixed(1).padStart(8);
async function main() {
  console.log(`سنجش بار → ${BASE.href}  کاربر=${USERS}  مدت=${DURATION}s  مکث=${THINK}ms  سناریو=${SCENARIO}`);
  const hz = await request('GET', '/healthz'); if (hz.status !== 200) { console.error(`✗ سرور پاسخ نمی‌دهد (/healthz → ${hz.status || hz.err}).`); process.exit(2); }
  const pageMap = new Map(); let first = true;
  for (const acc of ACCOUNTS) { const d = await discover(acc); pageMap.set(acc.u, d.pages); if (d.err) console.log(`  ! ${acc.u}: ${d.err}`); else if (first) console.log(`  ${acc.u}: ${d.pages.length} صفحه از منو`); first = false; }
  if ([...pageMap.values()].every((p) => p.length <= 1)) { console.error('✗ ورود با هیچ حساب آزمون ممکن نبود. --accounts را بررسی کنید (حساب‌های دمو لازم است).'); process.exit(2); }
  stats.started = performance.now(); const tasks = [];
  for (let i = 0; i < USERS; i++) { tasks.push(new Promise((r) => setTimeout(r, RAMP ? (i / USERS) * RAMP * 1000 : 0)).then(() => vuser(i, (acc) => pageMap.get(acc.u)))); }
  const tick = setInterval(() => { process.stdout.write(`\r  ${Math.round((performance.now() - stats.started) / 1000)}s · کاربر فعال ${active} · درخواست ${stats.all.length}   `); }, 1000);
  await new Promise((r) => setTimeout(r, DURATION * 1000)); stop = true; await Promise.all(tasks); clearInterval(tick); process.stdout.write('\r' + ' '.repeat(60) + '\r');
  const secs = (performance.now() - stats.started) / 1000; const all = stats.all.slice().sort((a, b) => a - b); const total = all.length;
  const fails = [...stats.byPage.values()].reduce((s, e) => s + e.fail, 0);
  console.log(`\nدرخواست: ${total}   RPS: ${(total / secs).toFixed(1)}   خطا: ${fails} (${(fails / Math.max(1, total) * 100).toFixed(2)}٪)   حجم دریافتی: ${(stats.bytes / 1048576).toFixed(1)} MB (فشرده)`);
  console.log(`زمان پاسخ (ms)  میانگین ${f(all.reduce((s, x) => s + x, 0) / Math.max(1, total))}  P50 ${f(q(all, 0.5))}  P95 ${f(q(all, 0.95))}  P99 ${f(q(all, 0.99))}  بیشینه ${f(all[total - 1] || 0)}`);
  console.log('کدهای وضعیت: ' + [...stats.codes.entries()].sort().map(([k, v]) => `${k || 'ERR'}×${v}`).join('  '));
  const rows = [...stats.byPage.entries()].map(([k, e]) => { const s = e.ms.slice().sort((a, b) => a - b); return { page: k, n: e.n, p50: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1], fail: e.fail }; }).sort((a, b) => b.p95 - a.p95);
  console.log('\nکندترین صفحه‌ها (بر پایه‌ی P95):\n  ' + 'صفحه'.padEnd(34) + 'تعداد'.padStart(7) + '     P50     P95     max  خطا');
  for (const r of rows.slice(0, 12)) console.log('  ' + r.page.slice(0, 33).padEnd(34) + String(r.n).padStart(7) + f(r.p50) + f(r.p95) + f(r.max) + String(r.fail).padStart(5));
  if (stats.errors.size) { console.log('\nخطاها:'); for (const [k, v] of [...stats.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${v}× ${k}`); }
  const out = { url: BASE.href, users: USERS, duration: DURATION, think: THINK, scenario: SCENARIO, total, rps: total / secs, errors: fails, errorPct: fails / Math.max(1, total) * 100, ms: { avg: all.reduce((s, x) => s + x, 0) / Math.max(1, total), p50: q(all, 0.5), p95: q(all, 0.95), p99: q(all, 0.99), max: all[total - 1] || 0 }, pages: rows };
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(out, null, 2));
  const maxErr = Number(args['max-error'] === undefined ? 1 : args['max-error']); let bad = out.errorPct > maxErr; if (args['max-p95'] && out.ms.p95 > Number(args['max-p95'])) bad = true;
  console.log(bad ? '\n✗ آزمون رد شد (خطا یا P95 بیش از حد مجاز).' : '\n✓ آزمون موفق.'); agent.destroy(); process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });

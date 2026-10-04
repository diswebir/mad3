'use strict';
/**
 * سنجه‌های سبک عملکرد (فقط در حافظه، بدون وابستگی): زمان پاسخ، تعداد و نرخ خطا،
 * تأخیر حلقه‌ی رویداد، حافظه. برای صفحه‌ی «سلامت و کارایی» سوپر ادمین.
 * هزینه‌ی هر درخواست چند میکروثانیه است؛ با ENV METRICS=0 خاموش می‌شود.
 */
const { monitorEventLoopDelay, performance } = require('perf_hooks');

const RING = 3000; // آخرین ۳۰۰۰ درخواست
const ring = new Float64Array(RING); const ringStatus = new Uint16Array(RING); let pos = 0; let filled = 0;
const startedAt = Date.now(); let total = 0; let errors5 = 0; let errors4 = 0; let inflight = 0; let peakInflight = 0;
const perGroup = new Map(); // گروه مسیر → { n, sum, max }
const slow = []; // کندترین‌های اخیر
let loop = null;
try { loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable(); } catch (_) { loop = null; }

function group(req) {
  const p = (req.path || '/').split('/').filter(Boolean);
  if (!p.length) return '/';
  if (['assets', 'uploads', 'fonts', 'favicon.svg'].includes(p[0])) return 'static';
  return '/' + p[0] + (p[0] === 'super' && p[1] ? '/' + p[1] : '');
}

function middleware(req, res, next) {
  if (process.env.METRICS === '0') return next();
  const t0 = performance.now(); inflight++; if (inflight > peakInflight) peakInflight = inflight;
  let done = false;
  const fin = () => {
    if (done) return; done = true; inflight--;
    const ms = performance.now() - t0; const code = res.statusCode;
    ring[pos] = ms; ringStatus[pos] = code; pos = (pos + 1) % RING; if (filled < RING) filled++;
    total++; if (code >= 500) errors5++; else if (code >= 400) errors4++;
    const g = group(req); const e = perGroup.get(g) || { n: 0, sum: 0, max: 0 }; e.n++; e.sum += ms; if (ms > e.max) e.max = ms; perGroup.set(g, e);
    if (g !== 'static' && ms > 400) { slow.unshift({ at: new Date().toISOString(), m: req.method, p: g, ms: Math.round(ms), code }); if (slow.length > 15) slow.pop(); }
  };
  res.on('finish', fin); res.on('close', fin); next();
}

const pct = (arr, q) => { if (!arr.length) return 0; const i = Math.min(arr.length - 1, Math.floor(q * arr.length)); return arr[i]; };

function snapshot() {
  const a = Array.from(ring.subarray(0, filled)).sort((x, y) => x - y);
  const mem = process.memoryUsage();
  const groups = [...perGroup.entries()].map(([g, e]) => ({ group: g, n: e.n, avg: e.sum / e.n, max: e.max })).sort((x, y) => y.avg * y.n - x.avg * x.n).slice(0, 12);
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000), node: process.version, pid: process.pid,
    total, errors5, errors4, inflight, peakInflight, sample: filled,
    p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? a[a.length - 1] : 0,
    loopMean: loop ? loop.mean / 1e6 : 0, loopP99: loop ? loop.percentile(99) / 1e6 : 0, loopMax: loop ? loop.max / 1e6 : 0,
    rssMB: mem.rss / 1048576, heapMB: mem.heapUsed / 1048576, groups, slow: slow.slice(),
  };
}
function reset() { filled = 0; pos = 0; total = 0; errors5 = 0; errors4 = 0; peakInflight = 0; perGroup.clear(); slow.length = 0; if (loop) loop.reset(); }

module.exports = { middleware, snapshot, reset };

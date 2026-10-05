'use strict';
/** امضای AWS Signature V4 (برای S3 و سرویس‌های سازگار با S3 مثل آروان، لیارا، Wasabi، MinIO، Backblaze). بدون وابستگی. */
const crypto = require('crypto');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const rfc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const amz = (d) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

/**
 * sign({ method, url, headers, body, accessKey, secretKey, region, service, now })
 * خروجی: هدرهای نهایی (شامل Authorization، x-amz-date و برای s3: x-amz-content-sha256). هدر host را مرورگر/fetch خودش می‌گذارد.
 */
function sign({ method = 'GET', url, headers = {}, body = '', accessKey, secretKey, region = 'us-east-1', service = 's3', now = new Date() }) {
  const u = new URL(url); const date = amz(now); const stamp = date.slice(0, 8);
  const payload = sha(body || '');
  const h = { host: u.host, 'x-amz-date': date };
  if (service === 's3') h['x-amz-content-sha256'] = payload;
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  const names = Object.keys(h).sort();
  const canonHeaders = names.map((n) => `${n}:${String(h[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signed = names.join(';');
  const canonUri = u.pathname.split('/').map((seg) => rfc(decodeURIComponent(seg))).join('/') || '/';
  const q = [...u.searchParams.entries()].map(([k, v]) => [rfc(k), rfc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonQuery = q.map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method.toUpperCase(), canonUri, canonQuery, canonHeaders, signed, payload].join('\n');
  const scope = `${stamp}/${region}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secretKey, stamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSign).update(sts).digest('hex');
  const out = { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
  delete out.host; return { headers: out, canonical, signature, signedHeaders: signed, scope };
}
module.exports = { sign, sha, rfc };

'use strict';
/**
 * درگاه پرداخت اینترنتی. ارائه‌دهندگان:
 *  - zarinpal / zarinpal_sandbox : API نسخه‌ی ۴ زرین‌پال (request + verify)
 *  - demo                         : شبیه‌ساز داخلی برای نمایش و آزمایش (هیچ وجهی جابه‌جا نمی‌شود)
 * مبلغ‌ها در واحد تنظیمات مدرسه (تومان/ریال) نگهداری می‌شوند و هنگام ارسال به درگاه به ریال تبدیل می‌شوند.
 */
const settings = require('../settings');

const HOSTS = { zarinpal: 'https://payment.zarinpal.com', zarinpal_sandbox: 'https://sandbox.zarinpal.com' };
const cfg = () => ({
  enabled: settings.bool('pay_online_enabled'), provider: settings.get('pay_gateway') || 'demo', merchant: String(settings.get('pay_merchant_id') || '').trim(),
  host: String(settings.get('pay_base_url') || '').trim().replace(/\/+$/, ''), toman: (settings.get('currency_label') || 'تومان') === 'تومان',
});
const ready = () => { const c = cfg(); if (!c.enabled) return false; if (c.provider === 'demo') return true; return /^[0-9a-fA-F-]{36}$/.test(c.merchant); };
const toRial = (amount, c = cfg()) => Math.round(Number(amount)) * (c.toman ? 10 : 1);
const hostOf = (c) => c.host || HOSTS[c.provider] || HOSTS.zarinpal;

async function post(url, body) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (_) { /* ignore */ }
    return { status: r.status, json: j };
  } finally { clearTimeout(tm); }
}
const errOf = (j) => { const e = j && j.errors; const first = Array.isArray(e) ? e[0] : e; return first && (first.message || first.code) ? `${first.message || ''}${first.code !== undefined ? ' (کد ' + first.code + ')' : ''}`.trim() : 'پاسخ نامعتبر از درگاه'; };

/** شروع پرداخت → { ok, authority, payUrl, error } */
async function request({ amount, callbackUrl, description, mobile, token }) {
  const c = cfg();
  if (c.provider === 'demo') return { ok: true, authority: 'DEMO' + token.slice(0, 12).toUpperCase(), payUrl: null, demo: true };
  try {
    const body = { merchant_id: c.merchant, amount: toRial(amount, c), callback_url: callbackUrl, description: String(description || 'پرداخت شهریه').slice(0, 250) };
    if (mobile && /^09\d{9}$/.test(mobile)) body.metadata = { mobile };
    const r = await post(hostOf(c) + '/pg/v4/payment/request.json', body);
    const d = r.json && r.json.data;
    if (d && Number(d.code) === 100 && d.authority) return { ok: true, authority: d.authority, payUrl: hostOf(c) + '/pg/StartPay/' + d.authority };
    return { ok: false, error: errOf(r.json) };
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'درگاه پاسخ نداد (مهلت تمام شد).' : 'ارتباط با درگاه برقرار نشد.' }; }
}
/** تأیید تراکنش → { ok, already, refId, card, error, unreachable } */
async function verify({ authority, amount }) {
  const c = cfg();
  try {
    const r = await post(hostOf(c) + '/pg/v4/payment/verify.json', { merchant_id: c.merchant, amount: toRial(amount, c), authority });
    const d = r.json && r.json.data;
    if (d && (Number(d.code) === 100 || Number(d.code) === 101)) return { ok: true, already: Number(d.code) === 101, refId: d.ref_id !== undefined ? String(d.ref_id) : '', card: d.card_pan || '' };
    return { ok: false, error: errOf(r.json) };
  } catch (e) { return { ok: false, unreachable: true, error: 'ارتباط با درگاه برای تأیید برقرار نشد.' }; }
}
module.exports = { cfg, ready, request, verify, toRial };

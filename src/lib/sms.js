'use strict';
/**
 * ارسال پیامک از طریق وب‌سرویس ippanel (Edge API) — https://edge.ippanel.com/v1/api/send
 * حالت «log» فقط ثبت می‌کند و چیزی نمی‌فرستد (برای آزمایش بدون هزینه).
 * همه پیامک‌ها در جدول sms_log ثبت می‌شوند؛ ارسال در پس‌زمینه انجام می‌شود تا درخواست کاربر کند نشود.
 */
const db = require('../db');
const settings = require('../settings');
const { toEn } = require('../utils/fa');

const DEFAULT_BASE = 'https://edge.ippanel.com/v1';
const BATCH = 100;

/** شماره موبایل ایران → قالب E.164 (+989xxxxxxxxx)؛ نامعتبر = null */
function toE164(raw) {
  if (!raw) return null;
  let s = toEn(String(raw)).replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0098')) s = s.slice(4); else if (s.startsWith('98')) s = s.slice(2); else if (s.startsWith('0')) s = s.slice(1);
  return /^9\d{9}$/.test(s) ? '+98' + s : null;
}
const isMobile = (raw) => !!toE164(raw);
const display = (e164) => (e164 ? '0' + e164.slice(3) : '');

function config() {
  return {
    enabled: settings.bool('sms_enabled'), provider: settings.get('sms_provider') || 'log',
    apiKey: settings.get('sms_api_key') || '', from: settings.get('sms_from_number') || '',
    base: String(settings.get('sms_base_url') || DEFAULT_BASE).replace(/\/+$/, ''),
  };
}
/** آیا رویداد خاصی باید پیامک بفرستد؟ */
const eventOn = (ev) => config().enabled && settings.bool('sms_on_' + ev);

/** قالب پیام: {student} {class} {school} {date} {amount} ... */
function render(tpl, vars = {}) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : (k === 'school' ? settings.get('school_name') : m)));
}

async function dispatchRows(ids) {
  const k = db.get(); const cfg = config();
  const rows = await k('sms_log').whereIn('id', ids).where({ status: 'queued' });
  if (!rows.length) return;
  if (cfg.provider !== 'ippanel') { await k('sms_log').whereIn('id', rows.map((r) => r.id)).update({ status: 'simulated', error: null }); return; }
  if (!cfg.apiKey || !cfg.from) { await k('sms_log').whereIn('id', rows.map((r) => r.id)).update({ status: 'failed', error: 'کلید API یا شماره ارسال‌کننده تنظیم نشده است.' }); return; }
  // گروه‌بندی بر اساس متن پیام تا برای هر متن یک درخواست (حداکثر ۱۰۰ گیرنده) ارسال شود
  const byMsg = new Map(); for (const r of rows) { if (!byMsg.has(r.message)) byMsg.set(r.message, []); byMsg.get(r.message).push(r); }
  for (const [message, list] of byMsg) {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH); const idsC = chunk.map((r) => r.id);
      try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(cfg.base + '/api/send', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: cfg.apiKey },
          body: JSON.stringify({ sending_type: 'webservice', from_number: cfg.from, message, params: { recipients: chunk.map((r) => r.to_number) } }),
        });
        clearTimeout(timer);
        let json = null; try { json = await res.json(); } catch (_) { /* ignore */ }
        const ok = res.ok && json && json.meta && json.meta.status === true;
        if (ok) {
          const refs = (json.data && json.data.message_outbox_ids) || [];
          await k('sms_log').whereIn('id', idsC).update({ status: 'sent', provider_ref: refs.length ? String(refs[0]).slice(0, 60) : null, error: null });
        } else {
          const err = (json && json.meta && (json.meta.message || JSON.stringify(json.meta.errors || {}))) || ('HTTP ' + res.status);
          await k('sms_log').whereIn('id', idsC).update({ status: 'failed', error: String(err).slice(0, 250) });
        }
      } catch (e) {
        await k('sms_log').whereIn('id', idsC).update({ status: 'failed', error: (e.name === 'AbortError' ? 'مهلت ارتباط با سرویس پیامک تمام شد.' : String(e.message)).slice(0, 250) });
      }
    }
  }
}

/**
 * ثبت پیامک در صف. items: [{ to, message, studentId }]؛ {wait:true} تا پایان ارسال صبر می‌کند.
 * اگر سامانه پیامک غیرفعال باشد هیچ چیزی ثبت نمی‌شود. خروجی: تعداد پیامک‌های ثبت‌شده.
 */
async function enqueue(items, { event = 'manual', userId = null, wait = false, force = false } = {}) {
  const cfg = config();
  if (!cfg.enabled && !force) return 0;
  const seen = new Set(); const rows = [];
  for (const it of items) {
    const to = toE164(it.to); if (!to || !it.message) continue;
    const key = to + '|' + it.message; if (seen.has(key)) continue; seen.add(key);
    rows.push({ to_number: to, message: String(it.message).slice(0, 1000), event, status: 'queued', student_id: it.studentId || null, created_by: userId });
  }
  if (!rows.length) return 0;
  const k = db.get(); const ids = [];
  for (const r of rows) { const [id] = await k('sms_log').insert(r); ids.push(typeof id === 'object' ? id.id : id); }
  const p = dispatchRows(ids).catch((e) => console.error('[sms]', e.message));
  if (wait) await p;
  return rows.length;
}

/** شماره‌های موبایل اولیای یک دانش‌آموز (پدر، مادر، سرپرست) بدون تکرار */
function parentNumbers(s) { return [...new Set([s.father_phone, s.mother_phone, s.guardian_phone].map(toE164).filter(Boolean))]; }

/** ارسال پیامک به اولیای دانش‌آموزان (فقط اگر رویداد فعال باشد) */
async function notifyParents(students, tplOrFn, event, userId) {
  if (!eventOn(event)) return 0;
  const items = [];
  for (const s of students) {
    const msg = typeof tplOrFn === 'function' ? tplOrFn(s) : render(tplOrFn, { student: `${s.first_name} ${s.last_name}` });
    for (const n of parentNumbers(s)) items.push({ to: n, message: msg, studentId: s.id });
  }
  return enqueue(items, { event, userId });
}
async function retryFailed(ids) {
  const k = db.get();
  const rows = await k('sms_log').whereIn('id', ids).where({ status: 'failed' });
  await k('sms_log').whereIn('id', rows.map((r) => r.id)).update({ status: 'queued', error: null });
  await dispatchRows(rows.map((r) => r.id));
  return rows.length;
}
module.exports = { toE164, isMobile, display, render, enqueue, eventOn, notifyParents, parentNumbers, retryFailed, config, DEFAULT_BASE };

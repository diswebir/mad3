'use strict';
/** مدیریت دسترسی‌های ریزدانه: ماتریس هر نفر، الگوهای دسترسی و گزارش تغییرات — فقط مدیر (نه معاون) */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const caps = require('../lib/caps');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/access', requireRole('admin'));

const GRANTABLE = ['deputy', 'teacher'];
const nf = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد درخواستی یافت نشد.' });
const highOf = (keys) => keys.filter((k) => caps.BY[k] && caps.BY[k].risk === 'high');

router.get('/access', async (req, res, next) => {
  try {
    const k = db.get(); const tab = ['people', 'profiles', 'log'].includes(req.query.tab) ? req.query.tab : 'people';
    const d = { title: 'سطوح دسترسی', tab, regCount: caps.REG.length, groupCount: Object.keys(caps.GROUPS).length };
    const profiles = await k('access_profiles').orderBy('name');
    const used = {}; (await k('users').whereNotNull('profile_id').select('profile_id')).forEach((r) => { used[r.profile_id] = (used[r.profile_id] || 0) + 1; });
    d.profiles = profiles.map((p) => { const o = caps.parseOv(p.caps); return { ...p, nAllow: o.allow.length, nDeny: o.deny.length, users: used[p.id] || 0 }; });
    if (tab === 'people') {
      const q = (req.query.q || '').trim(); const role = GRANTABLE.includes(req.query.role) ? req.query.role : '';
      const qb = k('users').whereIn('role', role ? [role] : GRANTABLE);
      if (q) qb.where((b) => b.where('full_name', 'like', `%${q}%`).orWhere('username', 'like', `%${q}%`));
      const pm = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
      d.q = q; d.role = role;
      d.rows = (await qb.orderBy('role').orderBy('full_name').select('id', 'full_name', 'username', 'role', 'active', 'caps', 'profile_id', 'title')).map((r) => { const o = caps.parseOv(r.caps); return { ...r, nAllow: o.allow.length, nDeny: o.deny.length, profile: r.profile_id ? pm[r.profile_id] || null : null }; });
    }
    if (tab === 'log') {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 40;
      const qb = k('audit_logs').where((b) => b.where('action', 'perm_change').orWhere({ action: 'denied', entity: 'capability' }));
      d.page = page; d.pages = Math.max(1, Math.ceil(Number((await qb.clone().count({ c: '*' }).first()).c) / per));
      d.logs = await qb.orderBy('id', 'desc').limit(per).offset((page - 1) * per);
    }
    res.view('access/index', d);
  } catch (e) { next(e); }
});

async function loadTarget(req, res) {
  const row = await db.get()('users').where({ id: req.params.id }).first();
  if (!row || !GRANTABLE.includes(row.role)) { nf(res); return null; }
  return row;
}
router.get('/access/user/:id(\\d+)', async (req, res, next) => {
  try {
    const row = await loadTarget(req, res); if (!row) return;
    const k = db.get(); const profiles = await k('access_profiles').orderBy('name');
    const pid = req.query.profile !== undefined ? Number(req.query.profile) || null : row.profile_id;
    const prof = profiles.find((p) => p.id === pid) || null;
    const others = await k('users').whereIn('role', GRANTABLE).whereNot({ id: row.id }).orderBy('full_name').select('id', 'full_name', 'role');
    res.view('access/user', { title: 'دسترسی‌های ' + row.full_name, row, groups: caps.matrixFor(row, prof), profiles, profileId: prof ? prof.id : null, others, profilesJson: Object.fromEntries(profiles.map((p) => { const o = caps.parseOv(p.caps); return [p.id, o]; })) });
  } catch (e) { next(e); }
});
router.post('/access/user/:id(\\d+)', async (req, res, next) => {
  try {
    const row = await loadTarget(req, res); if (!row) return;
    const k = db.get(); const back = '/access/user/' + row.id;
    const before = caps.parseOv(row.caps); const after = caps.fromForm(req.body);
    const pid = Number(req.body.profile_id) || null;
    if (pid && !(await k('access_profiles').where({ id: pid }).first())) { req.flash('error', 'الگوی انتخابی یافت نشد.'); return res.redirect(back); }
    const changes = caps.diff(before, after);
    let newlyHigh = highOf(changes.filter((c) => c.to === 'allow').map((c) => c.key));
    if (pid && pid !== row.profile_id) { const np = await k('access_profiles').where({ id: pid }).first(); newlyHigh = newlyHigh.concat(highOf(caps.parseOv(np.caps).allow)); }
    if (newlyHigh.length && !(await svc.verifyAsync(String(req.body.confirm_password || ''), req.user.password_hash))) {
      req.flash('error', 'برای اعطای مجوزهای پرخطر (⚠) رمز عبور خود را درست وارد کنید. تغییری ذخیره نشد.'); return res.redirect(back);
    }
    await k('users').where({ id: row.id }).update({ caps: caps.stringify(after), profile_id: pid });
    const granted = changes.filter((c) => c.to === 'allow').map((c) => caps.BY[c.key].label); const revoked = changes.filter((c) => c.to === 'deny').map((c) => caps.BY[c.key].label);
    const profChanged = (row.profile_id || null) !== pid;
    if (changes.length || profChanged) {
      await svc.audit(req, 'perm_change', 'users', row.id, `${row.username}: ${changes.map((c) => `${c.key}:${c.from}→${c.to}`).join(', ')}${profChanged ? ` | profile ${row.profile_id || '-'}→${pid || '-'}` : ''}`);
      await svc.notify([row.id], 'دسترسی‌های شما تغییر کرد', [granted.length ? 'مجاز شد: ' + granted.slice(0, 4).join('، ') : '', revoked.length ? 'ممنوع شد: ' + revoked.slice(0, 4).join('، ') : ''].filter(Boolean).join(' — ') || 'الگوی دسترسی شما تغییر کرد.', '/profile', 'info');
      const mw = require('../middleware'); if (mw.invalidateBadges) mw.invalidateBadges(row.id);
    }
    req.flash('success', changes.length || profChanged ? `دسترسی‌های «${row.full_name}» ذخیره شد و همین حالا اعمال می‌شود.` : 'تغییری وجود نداشت.');
    res.redirect(back);
  } catch (e) { next(e); }
});
router.post('/access/user/:id(\\d+)/reset', async (req, res, next) => {
  try {
    const row = await loadTarget(req, res); if (!row) return;
    await db.get()('users').where({ id: row.id }).update({ caps: null, profile_id: null });
    await svc.audit(req, 'perm_change', 'users', row.id, row.username + ': reset to role defaults');
    req.flash('success', 'همه‌ی دسترسی‌های اختصاصی حذف شد؛ حساب به پیش‌فرض نقش برگشت.'); res.redirect('/access/user/' + row.id);
  } catch (e) { next(e); }
});
router.post('/access/user/:id(\\d+)/copy', async (req, res, next) => {
  try {
    const row = await loadTarget(req, res); if (!row) return;
    const src = await db.get()('users').where({ id: Number(req.body.from) || 0 }).first();
    if (!src || !GRANTABLE.includes(src.role)) { req.flash('error', 'کاربر مبدأ نامعتبر است.'); return res.redirect('/access/user/' + row.id); }
    if (src.role !== row.role) { req.flash('error', 'کپی فقط بین کاربران هم‌نقش (معلم↔معلم، معاون↔معاون) مجاز است.'); return res.redirect('/access/user/' + row.id); }
    const o = caps.parseOv(src.caps); const hi = highOf(o.allow);
    if (hi.length && !(await svc.verifyAsync(String(req.body.confirm_password || ''), req.user.password_hash))) { req.flash('error', 'کپی شامل مجوز پرخطر است؛ رمز عبور خود را وارد کنید.'); return res.redirect('/access/user/' + row.id); }
    await db.get()('users').where({ id: row.id }).update({ caps: src.caps || null, profile_id: src.profile_id || null });
    await svc.audit(req, 'perm_change', 'users', row.id, `${row.username}: copied from ${src.username}`);
    req.flash('success', `دسترسی‌های «${src.full_name}» برای «${row.full_name}» کپی شد.`); res.redirect('/access/user/' + row.id);
  } catch (e) { next(e); }
});

/* ---------- الگوهای دسترسی ---------- */
function profileView(res, p, errors) {
  const fake = { id: 0, role: p.base_role || 'teacher', permissions: null, caps: p.caps || null };
  res.view('access/profile', { title: p.id ? 'ویرایش الگو: ' + p.name : 'الگوی دسترسی جدید', p, errors: errors || [], groups: caps.matrixFor(fake, null) });
}
router.get('/access/profiles/new', (req, res) => profileView(res, { id: 0, name: '', description: '', base_role: 'teacher', caps: null }));
router.get('/access/profiles/:id(\\d+)/edit', async (req, res, next) => {
  try { const p = await db.get()('access_profiles').where({ id: req.params.id }).first(); if (!p) return nf(res); profileView(res, p); } catch (e) { next(e); }
});
router.post('/access/profiles/save', async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const id = Number(b.id) || 0; const errors = [];
    const name = String(b.name || '').trim().slice(0, 100); const base = GRANTABLE.includes(b.base_role) ? b.base_role : 'teacher';
    if (name.length < 3) errors.push('نام الگو حداقل ۳ نویسه باشد.');
    const dup = await k('access_profiles').where({ name }).whereNot({ id }).first(); if (dup) errors.push('الگویی با این نام وجود دارد.');
    const o = caps.fromForm(b);
    const prev = id ? await k('access_profiles').where({ id }).first() : null; if (id && !prev) return nf(res);
    const newHigh = highOf(o.allow).filter((x) => !prev || !caps.parseOv(prev.caps).allow.includes(x));
    if (!errors.length && newHigh.length && !(await svc.verifyAsync(String(b.confirm_password || ''), req.user.password_hash))) errors.push('این الگو مجوز پرخطر (⚠) می‌دهد؛ رمز عبور خود را وارد کنید.');
    if (errors.length) return profileView(res, { id, name, description: b.description, base_role: base, caps: caps.stringify(o) }, errors);
    const data = { name, description: String(b.description || '').slice(0, 250) || null, base_role: base, caps: caps.stringify(o) };
    let pid = id; if (id) await k('access_profiles').where({ id }).update(data); else { const r = await k('access_profiles').insert(data); pid = Array.isArray(r) ? r[0] : r; }
    await svc.audit(req, 'perm_change', 'access_profiles', pid, `${id ? 'edit' : 'create'} «${name}» allow=${o.allow.length} deny=${o.deny.length}`);
    req.flash('success', id ? 'الگو ذخیره شد و برای همه‌ی کاربران دارای آن اعمال شد.' : 'الگو ساخته شد.'); res.redirect('/access?tab=profiles');
  } catch (e) { next(e); }
});
router.post('/access/profiles/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const k = db.get(); const p = await k('access_profiles').where({ id: req.params.id }).first(); if (!p) return nf(res);
    const n = Number((await k('users').where({ profile_id: p.id }).count({ c: '*' }).first()).c);
    if (n) { req.flash('error', `این الگو برای ${n} نفر تخصیص داده شده است؛ ابتدا آن‌ها را به الگوی دیگر ببرید.`); return res.redirect('/access?tab=profiles'); }
    await k('access_profiles').where({ id: p.id }).del(); await svc.audit(req, 'perm_change', 'access_profiles', p.id, 'delete «' + p.name + '»');
    req.flash('success', 'الگو حذف شد.'); res.redirect('/access?tab=profiles');
  } catch (e) { next(e); }
});

module.exports = router;

'use strict';
/** پورتال اولیا: حساب والدین، انتخاب فرزند، و مدیریت حساب‌ها توسط مدرسه */
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const sms = require('../lib/sms');
const xlsx = require('../lib/xlsx');
const { requireRole } = require('../middleware');
const permissions = require('../permissions');
const router = express.Router();
const mgr = requireRole('admin', 'deputy');

/** فقط‌خواندنی‌بودن حساب اولیا (به‌جز مکاتبه، اعلان و رمز) — در routes/index پیش از مسیرها نصب می‌شود */
const PARENT_WRITE_OK = [/^\/tickets\/new$/, /^\/tickets\/\d+\/(reply|rate)$/, /^\/notifications(\/|$)/, /^\/profile(\/|$)/, /^\/logout$/, /^\/parent\/switch$/];
function parentGuard(req, res, next) {
  const u = req.user;
  if (!u || u.realRole !== 'parent') return next();
  if (!modules.isEnabled('parents')) return res.status(403).view('error', { code: 403, title: 'پورتال اولیا غیرفعال است', message: 'مدرسه این بخش را غیرفعال کرده است.' });
  const free = /^\/(profile|logout|notifications|assets|parent)(\/|$)/.test(req.path);
  if (!u.student && !free) return res.status(403).view('error', { code: 403, title: 'فرزندی متصل نیست', message: 'هنوز دانش‌آموزی به حساب شما متصل نشده است. با مدرسه تماس بگیرید.' });
  if (!['GET', 'HEAD'].includes(req.method) && !PARENT_WRITE_OK.some((re) => re.test(req.path))) {
    return res.status(403).view('error', { code: 403, title: 'حساب اولیا فقط مشاهده‌ای است', message: 'اولیا می‌توانند اطلاعات فرزند را ببینند و با مدرسه مکاتبه کنند؛ ثبت یا تغییر اطلاعات ممکن نیست.' });
  }
  next();
}

router.get('/parent/children', async (req, res, next) => {
  try {
    if (!req.user.realRole) return res.redirect('/');
    const k = db.get(); const out = [];
    for (const c of req.user.children) {
      const cls = c.classroom_id ? await k('classrooms').where({ id: c.classroom_id }).first('name') : null;
      const att = await k('attendance').where({ student_id: c.id }).groupBy('status').select('status').count({ n: '*' });
      out.push({ ...c, class_name: cls ? cls.name : '—', att: Object.fromEntries(att.map((a) => [a.status, Number(a.n)])) });
    }
    res.view('parents/children', { title: 'فرزندان من', kids: out, current: req.user.student ? req.user.student.id : 0 });
  } catch (e) { next(e); }
});
router.post('/parent/switch', (req, res) => {
  const id = Number(req.body.student_id);
  if (req.user.realRole === 'parent' && req.user.children.some((c) => c.id === id)) req.session.childId = id;
  res.redirect('/');
});

/* ---------- مدیریت حساب‌ها توسط مدرسه ---------- */
const guard = [mgr, modules.guard('parents')];
function pickPhone(s, relation) {
  const order = relation === 'mother' ? [s.mother_phone, s.father_phone, s.guardian_phone] : relation === 'guardian' ? [s.guardian_phone, s.father_phone, s.mother_phone] : [s.father_phone, s.mother_phone, s.guardian_phone];
  return order.map(sms.toE164).find(Boolean) || null;
}
const relName = { father: 'پدر', mother: 'مادر', guardian: 'سرپرست' };
/** ساخت (یا اتصال) حساب اولیا برای یک دانش‌آموز. خروجی: { user, password|null, created, linked } */
async function ensureParent(k, s, relation, req) {
  if (!relName[relation]) relation = 'father';
  const e164 = pickPhone(s, relation);
  const username = e164 ? sms.display(e164) : 'p' + s.student_code;
  const fullName = relation === 'mother' ? (s.mother_name || 'مادر ' + s.last_name) : relation === 'guardian' ? (s.guardian_name || 'سرپرست ' + s.last_name) : (s.father_name || 'پدر ' + s.last_name);
  let user = await k('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first(); let password = null; let created = false;
  if (user && user.role !== 'parent') return { error: `نام کاربری «${username}» برای حساب دیگری (${user.full_name}) استفاده شده است.` };
  if (!user) {
    password = svc.randomPassword(8);
    const [id] = await k('users').insert({ username, password_hash: svc.hash(password), role: 'parent', full_name: fullName, phone: e164 ? sms.display(e164) : null, active: 1, must_change_password: 1 });
    user = { id: typeof id === 'object' ? id.id : id, username, full_name: fullName }; created = true;
  }
  const link = await k('parent_students').where({ user_id: user.id, student_id: s.id }).first();
  if (!link) await k('parent_students').insert({ user_id: user.id, student_id: s.id, relation });
  await svc.audit(req, created ? 'create' : 'link', 'parents', user.id, `${username} ← ${s.student_code}`);
  return { user, password, created, linked: !link, username };
}
async function sendCredentials(req, s, r) {
  if (!r.password || !sms.eventOn('credentials')) return 0;
  const to = r.user.phone || r.username; const origin = `${req.protocol}://${req.get('host')}${require('../config').load().basePath || ''}`;
  return sms.enqueue([{ to, message: sms.render('اولیای گرامی؛ حساب شما در سامانه {school}\nنام کاربری: ' + r.username + '\nرمز: ' + r.password + '\n' + origin, {}), studentId: s.id }], { event: 'credentials', userId: req.user.id });
}

router.get('/parents', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const q = (req.query.q || '').trim();
    const qb = k('users as u').where('u.role', 'parent');
    if (q) qb.where((b) => b.where('u.full_name', 'like', `%${q}%`).orWhere('u.username', 'like', `%${q}%`));
    const users = await qb.orderBy('u.id', 'desc').limit(300).select('u.id', 'u.username', 'u.full_name', 'u.active', 'u.last_login');
    const links = users.length ? await k('parent_students as ps').join('students as s', 's.id', 'ps.student_id').whereIn('ps.user_id', users.map((u) => u.id)).select('ps.user_id', 'ps.student_id', 'ps.relation', 's.first_name', 's.last_name') : [];
    const by = {}; for (const l of links) (by[l.user_id] = by[l.user_id] || []).push(l);
    const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    const withoutParent = Number((await k('students').where('status', 'active').whereNotIn('id', k('parent_students').select('student_id')).count({ c: '*' }).first()).c);
    res.view('parents/index', { title: 'حساب‌های اولیا', users, by, q, classes, withoutParent, result: null });
  } catch (e) { next(e); }
});
router.post('/parents/create', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const s = await k('students').where({ id: Number(req.body.student_id) }).first();
    if (!s) { req.flash('error', 'دانش‌آموز یافت نشد.'); return res.redirect('/parents'); }
    const r = await ensureParent(k, s, req.body.relation, req);
    const back = '/students/' + s.id;
    if (r.error) { req.flash('error', r.error); return res.redirect(back); }
    const sent = await sendCredentials(req, s, r);
    req.flash('success', r.created ? `حساب اولیا ساخته شد — نام کاربری: ${r.username} ، رمز: ${r.password} (فقط یک‌بار نمایش داده می‌شود)${sent ? ' و با پیامک ارسال شد' : ''}.` : `فرزند به حساب موجود «${r.username}» متصل شد.`);
    res.redirect(back);
  } catch (e) { next(e); }
});
/** ساخت گروهی برای کلاس/همه دانش‌آموزان فاقد حساب اولیا */
router.post('/parents/bulk', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const qb = k('students').where('status', 'active').whereNotIn('id', k('parent_students').select('student_id'));
    if (req.body.classroom_id) qb.where({ classroom_id: Number(req.body.classroom_id) });
    const students = await qb.orderBy('last_name').limit(2000);
    const rows = []; let skipped = 0;
    for (const s of students) {
      if (!pickPhone(s, 'father')) { skipped++; continue; }
      const r = await ensureParent(k, s, 'father', req);
      if (r.error) { skipped++; continue; }
      await sendCredentials(req, s, r);
      rows.push({ student: `${s.first_name} ${s.last_name}`, username: r.username, password: r.password || '(حساب از قبل موجود بود)', name: r.user.full_name });
    }
    await svc.audit(req, 'bulk_create', 'parents', null, `${rows.length} حساب`);
    const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    res.view('parents/index', { title: 'حساب‌های اولیا', users: [], by: {}, q: '', classes, withoutParent: 0, result: { rows, skipped } });
  } catch (e) { next(e); }
});
router.post('/parents/credentials.xlsx', ...guard, (req, res) => {
  let rows = []; try { rows = JSON.parse(req.body.data || '[]'); } catch (_) { /* ignore */ }
  xlsx.send(res, 'parents-credentials.xlsx', [{ name: 'حساب اولیا', rows: [['دانش‌آموز', 'نام اولیا', 'نام کاربری', 'رمز'], ...rows.slice(0, 5000).map((r) => [r.student, r.name, r.username, r.password])] }]);
});
router.post('/parents/:id(\\d+)/reset-password', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const u = await k('users').where({ id: req.params.id, role: 'parent' }).first(); if (!u) return res.redirect('/parents');
    const pw = svc.randomPassword(8); await k('users').where({ id: u.id }).update({ password_hash: svc.hash(pw), must_change_password: 1 }); await svc.killSessions(u.id);
    await svc.audit(req, 'reset_password', 'parents', u.id, u.username);
    const ps = await k('parent_students as ps').join('students as s', 's.id', 'ps.student_id').where('ps.user_id', u.id).first('s.id');
    const sent = sms.eventOn('credentials') ? await sms.enqueue([{ to: u.phone || u.username, message: `رمز جدید شما در سامانه ${require('../settings').get('school_name')}\nنام کاربری: ${u.username}\nرمز: ${pw}`, studentId: ps ? ps.id : null }], { event: 'credentials', userId: req.user.id }) : 0;
    req.flash('success', `رمز جدید «${u.username}»: ${pw} (فقط یک‌بار نمایش داده می‌شود)${sent ? ' — با پیامک هم ارسال شد' : ''}.`); res.redirect('/parents');
  } catch (e) { next(e); }
});
router.post('/parents/:id(\\d+)/unlink/:sid(\\d+)', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); await k('parent_students').where({ user_id: req.params.id, student_id: req.params.sid }).del();
    await svc.audit(req, 'unlink', 'parents', req.params.id, 'student ' + req.params.sid);
    req.flash('success', 'اتصال حذف شد.'); res.redirect(req.get('referer') && req.get('referer').includes('/students/') ? '/students/' + req.params.sid : '/parents');
  } catch (e) { next(e); }
});
router.post('/parents/:id(\\d+)/delete', ...guard, async (req, res, next) => {
  try {
    const k = db.get(); const u = await k('users').where({ id: req.params.id, role: 'parent' }).first(); if (!u) return res.redirect('/parents');
    const used = Number((await k('tickets').where({ created_by: u.id }).count({ c: '*' }).first()).c) + Number((await k('ticket_messages').where({ user_id: u.id }).count({ c: '*' }).first()).c);
    if (used) { req.flash('error', 'این حساب در تیکت‌ها سابقه دارد؛ به‌جای حذف، غیرفعالش کنید (از بخش کاربران).'); return res.redirect('/parents'); }
    await k.transaction(async (x) => { await x('parent_students').where({ user_id: u.id }).del(); await x('notifications').where({ user_id: u.id }).del(); await x('users').where({ id: u.id }).del(); });
    await svc.killSessions(u.id); await svc.audit(req, 'delete', 'parents', u.id, u.username);
    req.flash('success', 'حساب اولیا حذف شد.'); res.redirect('/parents');
  } catch (e) { next(e); }
});
module.exports = router;
module.exports.parentGuard = parentGuard;
module.exports.ensureParent = ensureParent;

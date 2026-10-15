'use strict';
/** «امنیت و قفل‌ها»: قفل‌های فعال ورود/OTP، خطاهای اخیر ورود، بازکردن قفل. مدیر مدرسه و سوپر ادمین؛ تنظیم حدها فقط سوپر ادمین (تب امنیت) */
const express = require('express');
const db = require('../db');
const settings = require('../settings');
const svc = require('../services');
const RL = require('../lib/ratelimit');
const { requireRole } = require('../middleware');
const router = express.Router();
router.use('/security', requireRole('admin'));

const scope = (user) => (user.isSuper ? undefined : RL.ADMIN_BUCKETS);

router.get('/security', async (req, res, next) => {
  try {
    const k = db.get(); const buckets = scope(req.user);
    const all = await RL.listLocked({ buckets, withHits: true });
    const locks = all.filter((x) => x.locked); const watching = all.filter((x) => !x.locked);
    const dayAgo = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const recent = await k('audit_logs').where({ action: 'login_failed' }).orderBy('id', 'desc').limit(25);
    const fails24 = Number((await k('audit_logs').where({ action: 'login_failed' }).where('created_at', '>', dayAgo).count({ c: '*' }).first()).c);
    const ips24 = Number((await k('audit_logs').where({ action: 'login_failed' }).where('created_at', '>', dayAgo).countDistinct({ c: 'ip' }).first()).c);
    res.view('security/index', { title: 'امنیت و قفل‌ها', locks, watching, recent, fails24, ips24, p: RL.loginParams(), prog: settings.bool('lock_progressive'), maxMin: settings.num('lock_max_minutes'), trusted: String(settings.get('lock_trusted_ips') || '').split(/[\s,;،]+/).filter(Boolean), otp: { max: settings.num('otp_max_attempts'), cool: settings.num('otp_cooldown_seconds'), user: settings.num('otp_per_user_hour'), ip: settings.num('otp_per_ip_hour') } });
  } catch (e) { next(e); }
});
router.post('/security/unlock/:id', async (req, res, next) => {
  try {
    const n = await RL.unlock(Number(req.params.id), { buckets: scope(req.user) });
    if (n) await svc.audit(req, 'unlock', 'rate_limit', req.params.id, 'بازکردن قفل ورود');
    req.flash(n ? 'success' : 'error', n ? 'قفل باز شد.' : 'قفل پیدا نشد یا اجازه‌ی بازکردن آن را ندارید.'); res.redirect('/security');
  } catch (e) { next(e); }
});
router.post('/security/unlock-all', async (req, res, next) => {
  try {
    const n = await RL.unlockAll({ buckets: scope(req.user) });
    await svc.audit(req, 'unlock', 'rate_limit', null, `بازکردن همه‌ی قفل‌ها (${n})`);
    req.flash('success', `${n} قفل/شمارنده پاک شد.`); res.redirect('/security');
  } catch (e) { next(e); }
});
module.exports = router;

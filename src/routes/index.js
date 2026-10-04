'use strict';
const { requireAuth } = require('../middleware');

/** حالت تعمیر: فقط مدیر کل کار می‌کند؛ بقیه‌ی کاربران وارد‌شده پیام تعمیر می‌بینند (خروج آزاد است) */
function maintenanceGuard(req, res, next) {
  if (!require('../settings').bool('maintenance_mode') || !req.user || req.user.isSuper || /^\/(logout|assets|healthz)(\/|$)/.test(req.path)) return next();
  res.status(503).set('Retry-After', '600').view('error', { code: 503, title: 'سامانه در حال به‌روزرسانی است', message: require('../settings').get('maintenance_message') || 'کمی بعد دوباره مراجعه کنید.' });
}
module.exports = function mountRoutes(r) {
  require('./auth')(r);
  require('./super').setup(r); // ساخت یک‌باره‌ی سوپر ادمین (فقط وقتی وجود ندارد)
  r.use(maintenanceGuard);
  r.use(requireAuth);
  r.use(require('./parents').parentGuard);
  r.use(require('../permissions').guard);
  const list = ['files', 'dashboard', 'profile', 'users', 'settings', 'students', 'teachers', 'classes', 'attendance', 'tickets', 'grades', 'homework', 'timetable', 'finance', 'library', 'reports', 'backup', 'super', 'audit', 'security', 'parents', 'scheduling', 'bells', 'holidays', 'birthdays', 'gradeimport', 'questions', 'messages', 'promotion', 'exits', 'analytics', 'hr', 'extras'];
  for (const name of list) { if (require('fs').existsSync(require('path').join(__dirname, name + '.js'))) r.use(require('./' + name)); }
  require('../resources').mountAll(r);
};

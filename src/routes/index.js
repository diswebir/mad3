'use strict';
const { requireAuth } = require('../middleware');

module.exports = function mountRoutes(r) {
  require('./auth')(r);
  r.use(requireAuth);
  r.use(require('./parents').parentGuard);
  r.use(require('../permissions').guard);
  const list = ['files', 'dashboard', 'profile', 'users', 'settings', 'students', 'teachers', 'classes', 'attendance', 'tickets', 'grades', 'homework', 'timetable', 'finance', 'library', 'reports', 'backup', 'audit', 'parents', 'messages', 'promotion', 'exits', 'questions', 'hr', 'extras'];
  for (const name of list) { if (require('fs').existsSync(require('path').join(__dirname, name + '.js'))) r.use(require('./' + name)); }
  require('../resources').mountAll(r);
};

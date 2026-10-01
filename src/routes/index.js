'use strict';
const { requireAuth } = require('../middleware');

module.exports = function mountRoutes(r) {
  require('./auth')(r);
  r.use(requireAuth);
  const list = ['files', 'dashboard', 'profile', 'users', 'settings', 'students', 'teachers', 'classes', 'attendance', 'tickets', 'grades', 'homework', 'timetable', 'finance', 'library', 'reports', 'backup', 'audit'];
  for (const name of list) r.use(require('./' + name));
  require('../resources').mountAll(r);
};

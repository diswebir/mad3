'use strict';
/** راهنمای نصب و راه‌اندازی (هاست cPanel و لوکال‌هاست) داخل برنامه؛ فقط خواندنی، برای مدیر مدرسه و سوپر ادمین */
const express = require('express');
const { requireRole } = require('../middleware');
const router = express.Router();
router.get('/help/install', requireRole('admin'), (req, res) => res.view('help/install', { title: 'راهنمای نصب و راه‌اندازی', extraCss: 'css/guide.css', extraJs: 'js/guide.js' }));
module.exports = router;

'use strict';
/**
 * نقطه ورود برنامه. در cPanel (Setup Node.js App) این فایل را به‌عنوان Application startup file انتخاب کنید.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const { createApp } = require('./src/server');

const port = process.env.PORT || 3000;
createApp().then((app) => {
  app.listen(port, '0.0.0.0', () => console.log(`School management is running on port ${port}`));
}).catch((e) => { console.error('Failed to start:', e); process.exit(1); });

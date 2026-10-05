'use strict';
// تولید public/js/jalaali.js از پکیج jalaali-js برای تاریخ‌ساز شمسی سمت مرورگر
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(require.resolve('jalaali-js'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'jalaali.js'), `(function(){var module={exports:{}};\n${src}\nwindow.jalaali=module.exports;})();\n`);
console.log('jalaali.js ساخته شد');

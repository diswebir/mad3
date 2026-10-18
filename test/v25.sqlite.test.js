'use strict';
/** تست ۲٫۵٫۱ — نبودن فایل بومی better-sqlite3 (مثلاً ویندوز/لاراگون با Node تازه) باید در ویزارد پیش از نصب تشخیص و راهنمایی شود */
const { spawnSync } = require('child_process');
const { t, done, assert } = require('./helpers');
const run = (code) => spawnSync(process.execPath, ['-e', code], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, SCHOOL_DATA_DIR: require('os').tmpdir() + '/v25sqlite' } });
const stub = `const M=require('module');const o=M._load;M._load=function(r,...a){if(r==='better-sqlite3'){return function Database(){throw new Error('Could not locate the bindings file. Tried: → x/better_sqlite3.node')}}return o.call(this,r,...a)};`;

(async () => {
  await t('بدون فایل بومی: sqliteAvailable نادرست است (require به‌تنهایی کافی نیست) و پیام راهنما دارد', async () => {
    const r = run(stub + `const d=require('./src/db');console.log(JSON.stringify({a:d.sqliteAvailable(),s:d.sqliteStatus(),b:d.isBindingError(new Error('Could not locate the bindings file')),h:d.SQLITE_HELP}))`);
    assert.strictEqual(r.status, 0, r.stderr); const o = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.strictEqual(o.a, false); assert.ok(/bindings file/.test(o.s.error)); assert.strictEqual(o.b, true); assert.ok(/MySQL/.test(o.h) && /npm rebuild/.test(o.h) && /Visual Studio/.test(o.h));
  });
  await t('با درایور سالم: وضعیت درست است و اتصال حافظه‌ای کار می‌کند', async () => {
    const r = run(`const d=require('./src/db');console.log(JSON.stringify(d.sqliteStatus()))`); assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(JSON.parse(r.stdout.trim()).ok, true);
  });
  await t('نسخه‌ی وابستگی از Node 24 پشتیبانی می‌کند (≥ 12) و engines درست است', async () => {
    const p = require('../package.json'); const v = p.dependencies['better-sqlite3'] || (p.optionalDependencies || {})['better-sqlite3']; assert.ok(v && parseInt(v.replace(/[^\d]/g, ''), 10) >= 12, String(v));
    assert.ok(/20/.test(p.engines.node));
  });
  process.exit(done() ? 0 : 1);
})();

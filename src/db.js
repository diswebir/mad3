'use strict';
const knexLib = require('knex');
const path = require('path');
const config = require('./config');

let instance = null;

let sqliteProbe = null;
/** require() به‌تنهایی کافی نیست: فایل بومی (.node) فقط هنگام ساختن اولین اتصال بارگذاری می‌شود، پس واقعاً یک پایگاه‌داده‌ی حافظه‌ای باز می‌کنیم */
function sqliteStatus() {
  if (sqliteProbe) return sqliteProbe;
  try {
    require.resolve('better-sqlite3'); const D = require('better-sqlite3'); const d = new D(':memory:'); d.prepare('select 1').get(); d.close();
    sqliteProbe = { ok: true, error: '' };
  } catch (e) { sqliteProbe = { ok: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }; }
  return sqliteProbe;
}
function sqliteAvailable() { return sqliteStatus().ok; }
/** راهنمای فارسی برای خطای نبودن فایل بومی SQLite (ویندوز/لاراگون و نسخه‌ی جدید Node) */
const SQLITE_HELP = `درایور SQLite (better-sqlite3) برای نسخه‌ی Node این سیستم (${process.version}) کامپایل/دانلود نشده است. راه‌حل‌ها: ۱) در پوشه‌ی پروژه اجرا کنید: npm install better-sqlite3@latest --build-from-source=false (یا npm rebuild better-sqlite3) و سپس سرور را دوباره اجرا کنید؛ ۲) اگر کامپایل لازم شد، Visual Studio Build Tools (Desktop development with C++) و Python را نصب کنید یا از Node نسخه‌ی LTS (۲۰ یا ۲۲) استفاده کنید؛ ۳) یا به‌جای SQLite در مرحله‌ی پایگاه‌داده، MySQL را انتخاب کنید (لاراگون MySQL دارد).`;
const isBindingError = (e) => /bindings file|better_sqlite3\.node|NODE_MODULE_VERSION|was compiled against/i.test(String((e && e.message) || e));

function buildKnex(dbCfg) {
  if (dbCfg.client === 'mysql') {
    return knexLib({
      client: 'mysql2',
      connection: {
        host: dbCfg.host || 'localhost', port: dbCfg.port || 3306,
        user: dbCfg.user, password: dbCfg.password, database: dbCfg.database,
        charset: 'utf8mb4', dateStrings: true, decimalNumbers: true, timezone: '+00:00',
      },
      pool: {
        min: 0, max: 8, idleTimeoutMillis: 30000,
        // زمان‌ها در پایگاه داده به‌صورت UTC ذخیره و در برنامه به وقت تهران نمایش داده می‌شوند
        afterCreate(conn, done) { conn.query("SET time_zone = '+00:00'", (err) => done(err, conn)); },
      },
    });
  }
  return knexLib({
    client: 'better-sqlite3',
    connection: { filename: dbCfg.filename || path.join(config.DATA_DIR, 'school.sqlite') },
    useNullAsDefault: true,
    pool: {
      min: 1, max: 1,
      afterCreate(conn, done) {
        try {
          conn.pragma('journal_mode = WAL');
          conn.pragma('synchronous = NORMAL');
          conn.pragma('busy_timeout = 5000');
          conn.pragma('cache_size = -16000');
          conn.pragma('temp_store = MEMORY');
        } catch (e) { return done(e, conn); }
        done(null, conn);
      },
    },
  });
}

function init(dbCfg) {
  if (instance) return instance;
  instance = buildKnex(dbCfg || config.load().db);
  return instance;
}
function get() { if (!instance) throw new Error('پایگاه داده مقداردهی نشده است'); return instance; }
async function close() { if (instance) { await instance.destroy(); instance = null; } }
const isMysql = () => (config.load().db.client === 'mysql');

module.exports = { init, get, close, buildKnex, sqliteAvailable, sqliteStatus, SQLITE_HELP, isBindingError, isMysql };

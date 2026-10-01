'use strict';
const knexLib = require('knex');
const path = require('path');
const config = require('./config');

let instance = null;

function sqliteAvailable() {
  try { require.resolve('better-sqlite3'); require('better-sqlite3'); return true; } catch (_) { return false; }
}

function buildKnex(dbCfg) {
  if (dbCfg.client === 'mysql') {
    return knexLib({
      client: 'mysql2',
      connection: {
        host: dbCfg.host || 'localhost', port: dbCfg.port || 3306,
        user: dbCfg.user, password: dbCfg.password, database: dbCfg.database,
        charset: 'utf8mb4', dateStrings: true, timezone: '+00:00',
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

module.exports = { init, get, close, buildKnex, sqliteAvailable, isMysql };

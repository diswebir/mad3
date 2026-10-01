'use strict';
const db = require('./db');
const { createSchema } = require('./schema');
/** ایجاد جدول‌های جاافتاده هنگام بروزرسانی نسخه (idempotent) */
async function run() { await createSchema(db.get()); }
module.exports = { run };

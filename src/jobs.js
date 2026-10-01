'use strict';
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const { KnexStore } = require('./middleware');

/** کارهای دوره‌ای سبک: پاک‌سازی نشست‌ها، بستن خودکار تیکت‌ها */
async function run() {
  try {
    await KnexStore.cleanup();
    if (modules.isEnabled('tickets')) {
      const days = settings.num('ticket_auto_close_days');
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
        await db.get()('tickets').where({ status: 'answered' }).where('updated_at', '<', cutoff).update({ status: 'closed', closed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
      }
    }
  } catch (e) { console.error('[jobs]', e.message); }
}
module.exports = { run };

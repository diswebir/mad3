'use strict';
/** صفحه‌بندی یک پرس‌وجوی knex (بدون limit/offset). خروجی: { rows, total, page, pages, per } */
async function paginate(q, req, per = 20) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const total = Number((await q.clone().clearSelect().clearOrder().count({ c: '*' }).first()).c) || 0;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(page, pages);
  const rows = await q.limit(per).offset((p - 1) * per);
  return { rows, total, page: p, pages, per };
}
module.exports = { paginate };

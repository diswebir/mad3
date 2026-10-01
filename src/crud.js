'use strict';
/**
 * موتور CRUD عمومی: لیست (جستجو، فیلتر، مرتب‌سازی، صفحه‌بندی)، فرم افزودن/ویرایش، حذف و خروجی CSV
 * برای تعریف سریع و ایمن منابع ساده. تمام منابع نقش‌محور و ماژول‌محور هستند.
 */
const express = require('express');
const db = require('./db');
const modules = require('./modules');
const { requireAuth } = require('./middleware');
const { audit } = require('./services');
const { toCSV } = require('./utils/csv');
const J = require('./utils/jalali');
const { toFa } = require('./utils/fa');

const PER_PAGE = 20;

function coerce(field, raw) {
  if (field.type === 'checkbox') return raw === '1' || raw === 'on' || raw === 'true' ? 1 : 0;
  if (raw === undefined || raw === null || raw === '') return null;
  if (field.type === 'number') { const n = Number(String(raw).replace(/[,٬]/g, '')); return isNaN(n) ? NaN : n; }
  if (field.type === 'date') return J.parseJalali(raw) || false;
  return raw;
}

function mount(app, def) {
  const router = express.Router();
  const base = '/' + def.key;
  def.perPage = def.perPage || PER_PAGE;
  const canRead = (u) => def.read.includes(u.role);
  const canWrite = (u) => def.write.includes(u.role);
  const baseQuery = (k, req) => (def.base ? def.base(k, req) : k(def.table + ' as t').select('t.*'));

  async function scoped(req, qb) { if (def.scope) await def.scope(req, qb); }
  async function resolveOptions(f, req) {
    if (f.optionsFn) return f.optionsFn(db.get(), req);
    return f.options || [];
  }
  async function loadFieldOptions(req, row) {
    const out = {};
    for (const f of def.fields) if (f.type === 'select' || f.optionsFn) out[f.name] = (await resolveOptions(f, req, row)).map((o) => (Array.isArray(o) ? o : [o, o]));
    return out;
  }
  const guard = [requireAuth, modules.guard(def.module || 'core'), (req, res, next) => (canRead(req.user) ? next() : res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'شما اجازه دسترسی به این بخش را ندارید.' }))];
  const writeGuard = (req, res, next) => (canWrite(req.user) ? next() : res.status(403).view('error', { code: 403, title: 'دسترسی غیرمجاز', message: 'شما اجازه تغییر این بخش را ندارید.' }));

  async function listQuery(req) {
    const k = db.get();
    const qb = baseQuery(k, req);
    await scoped(req, qb);
    const q = (req.query.q || '').trim();
    if (q && def.search) qb.where((b) => { def.search.forEach((c, i) => b[i ? 'orWhere' : 'where'](c, 'like', `%${q}%`)); });
    for (const f of def.filters || []) {
      const v = req.query[f.name];
      if (v !== undefined && v !== '') qb.where(f.column, v);
    }
    return { qb };
  }
  const sortable = () => (def.sortable || []);

  router.get('/', guard, async (req, res, next) => {
    try {
      const { qb } = await listQuery(req);
      const countQ = qb.clone().clearSelect().clearOrder().count({ c: '*' }).first();
      let [col, dir] = (def.orderBy || [['t.id', 'desc']])[0];
      if (req.query.sort && sortable().includes(req.query.sort)) { col = req.query.sort; dir = req.query.dir === 'asc' ? 'asc' : 'desc'; }
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const total = Number((await countQ).c);
      const rows = await qb.orderBy(col, dir).limit(def.perPage).offset((page - 1) * def.perPage);
      const filters = [];
      for (const f of def.filters || []) filters.push({ ...f, opts: (await resolveOptions(f, req)).map((o) => (Array.isArray(o) ? o : [o, o])), value: req.query[f.name] || '' });
      const extra = def.listExtra ? await def.listExtra(req, rows) : {};
      res.view('crud/list', { def, rows, filters, q: req.query.q || '', page, pages: Math.max(1, Math.ceil(total / def.perPage)), total, sort: col, dir, canWrite: canWrite(req.user), canEditRow: (r) => canWrite(req.user) && (!def.canEdit || def.canEdit(req, r)), canDeleteRow: (r) => canWrite(req.user) && def.delete !== false && (!def.canDelete || def.canDelete(req, r)), extra, rbase: base, title: def.title });
    } catch (e) { next(e); }
  });

  router.get('/export.csv', guard, async (req, res, next) => {
    try {
      if (def.csv === false) return res.status(404).end();
      const { qb } = await listQuery(req);
      const rows = await qb.orderBy(...(def.orderBy || [['t.id', 'desc']])[0]).limit(5000);
      const cols = def.columns.filter((c) => c.type !== 'actions');
      const h = { date: (v) => J.isoToJString(v), L: require('./labels').L };
      const data = rows.map((r) => cols.map((c) => (c.csv ? c.csv(r, h) : c.type === 'date' ? J.isoToJString(r[c.key]) : c.type === 'badge' ? (c.labels || {})[r[c.key]] || r[c.key] : c.type === 'bool' ? (r[c.key] ? 'بله' : 'خیر') : r[c.key])));
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${def.key}-${J.todayISO()}.csv"`).send(toCSV(cols.map((c) => c.label), data));
    } catch (e) { next(e); }
  });

  async function renderForm(req, res, row, errors, values) {
    const options = await loadFieldOptions(req, row);
    const vals = values || (row ? { ...row } : { ...(def.defaults ? await def.defaults(req) : {}) });
    for (const f of def.fields) if (f.type === 'date' && vals[f.name] && !values) vals[f.name] = J.isoToJString(vals[f.name]);
    res.view('crud/form', { def, row, options, errors: errors || [], vals, rbase: base, title: (row ? 'ویرایش ' : 'افزودن ') + def.singular });
  }

  if (def.write && def.write.length) {
    router.get('/new', guard, writeGuard, async (req, res, next) => { try { await renderForm(req, res, null); } catch (e) { next(e); } });
    router.get('/:id/edit', guard, writeGuard, async (req, res, next) => {
      try {
        const qb = baseQuery(db.get(), req).where('t.id', req.params.id); await scoped(req, qb);
        const row = await qb.first();
        if (!row || (def.canEdit && !def.canEdit(req, row))) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد درخواستی یافت نشد.' });
        await renderForm(req, res, row);
      } catch (e) { next(e); }
    });

    async function save(req, res, next, id) {
      try {
        const k = db.get();
        let existing = null;
        if (id) {
          const qb = baseQuery(k, req).where('t.id', id); await scoped(req, qb);
          existing = await qb.first();
          if (!existing || (def.canEdit && !def.canEdit(req, existing))) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد درخواستی یافت نشد.' });
        }
        const errors = []; const data = {}; const shown = {};
        for (const f of def.fields) {
          if (f.readonly) continue;
          if (f.showIf && !f.showIf(req)) continue;
          const raw = req.body[f.name];
          shown[f.name] = raw;
          const v = coerce(f, raw);
          if (f.required && (v === null || v === '')) { errors.push(`«${f.label}» الزامی است.`); continue; }
          if (v === false) { errors.push(`«${f.label}» معتبر نیست (تاریخ شمسی مانند ۱۴۰۵/۰۷/۰۹).`); continue; }
          if (typeof v === 'number' && isNaN(v)) { errors.push(`«${f.label}» باید عدد باشد.`); continue; }
          if (f.type === 'number' && v !== null) {
            if (f.min !== undefined && v < f.min) errors.push(`«${f.label}» نباید کمتر از ${toFa(f.min)} باشد.`);
            if (f.max !== undefined && v > f.max) errors.push(`«${f.label}» نباید بیشتر از ${toFa(f.max)} باشد.`);
          }
          if (f.type === 'time' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) errors.push(`«${f.label}» باید به‌صورت ساعت:دقیقه باشد.`);
          if (f.type === 'select' && v) {
            const opts = (await resolveOptions(f, req)).map((o) => String(Array.isArray(o) ? o[0] : o));
            if (!opts.includes(String(v))) errors.push(`«${f.label}» نامعتبر است.`);
          }
          if (typeof v === 'string' && f.maxlength && v.length > f.maxlength) errors.push(`«${f.label}» نباید بیش از ${toFa(f.maxlength)} نویسه باشد.`);
          data[f.name] = v;
        }
        if (!errors.length && def.validate) { const e = await def.validate(data, req, existing); if (e) [].concat(e).forEach((m) => errors.push(m)); }
        if (errors.length) return renderForm(req, res, existing, errors, { ...(existing || {}), ...shown });
        if (def.beforeSave) await def.beforeSave(data, req, existing);
        let rid = id;
        if (id) {
          if (def.stamp) data[def.stamp] = new Date().toISOString().replace('T', ' ').slice(0, 19);
          await k(def.table).where({ id }).update(data);
        } else {
          if (def.createdBy) data[def.createdBy] = req.user.id;
          const r = await k(def.table).insert(data);
          rid = Array.isArray(r) ? r[0] : r;
          if (rid && typeof rid === 'object') rid = rid.id;
        }
        if (def.afterSave) await def.afterSave(rid, data, req, !id);
        await audit(req, id ? 'update' : 'create', def.table, rid, data[def.labelField || 'name'] || data.title || '');
        req.flash('success', `${def.singular} با موفقیت ${id ? 'ویرایش' : 'ثبت'} شد.`);
        res.redirect(def.after ? def.after(rid, req) : base);
      } catch (e) { next(e); }
    }
    router.post('/new', guard, writeGuard, (req, res, next) => save(req, res, next, null));
    router.post('/:id/edit', guard, writeGuard, (req, res, next) => save(req, res, next, Number(req.params.id)));

    if (def.delete !== false) {
      router.post('/:id/delete', guard, writeGuard, async (req, res, next) => {
        try {
          const k = db.get();
          const qb = baseQuery(k, req).where('t.id', req.params.id); await scoped(req, qb);
          const row = await qb.first();
          if (!row || (def.canDelete && !def.canDelete(req, row))) return res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'مورد درخواستی یافت نشد.' });
          if (def.beforeDelete) { const msg = await def.beforeDelete(row, req); if (msg) { req.flash('error', msg); return res.redirect(base); } }
          await k(def.table).where({ id: row.id }).del();
          if (def.afterDelete) await def.afterDelete(row, req);
          await audit(req, 'delete', def.table, row.id, row[def.labelField || 'name'] || row.title || '');
          req.flash('success', `${def.singular} حذف شد.`);
          res.redirect(base);
        } catch (e) { next(e); }
      });
    }
  }
  app.use(base, router);
}

module.exports = { mount };

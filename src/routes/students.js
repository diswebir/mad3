'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const settings = require('../settings');
const permissions = require('../permissions');
const modules = require('../modules');
const svc = require('../services');
const J = require('../utils/jalali');
const { toCSV, parseCSV } = require('../utils/csv');
const { normalizeInput } = require('../utils/fa');
const { L } = require('../labels');
const { requireRole, uploader, isManager } = require('../middleware');
const { classResults } = require('../lib/gradesCalc');
const { diffAndLog } = require('../lib/studentChanges');
const charts = require('../lib/charts');
const qr = require('../lib/qr');
const router = express.Router();
const M = modules.isEnabled;
const mgr = requireRole('admin', 'deputy');

const opt = (obj) => Object.entries(obj);
function fieldGroups() {
  return [
    { title: 'اطلاعات هویتی', icon: 'id-card', fields: [
      { name: 'first_name', label: 'نام', type: 'text', required: true }, { name: 'last_name', label: 'نام خانوادگی', type: 'text', required: true },
      { name: 'national_id', label: 'کد ملی', type: 'text', ltr: true, maxlength: 10 }, { name: 'gender', label: 'جنسیت', type: 'select', required: true, opts: opt(L.gender) },
      { name: 'birth_date', label: 'تاریخ تولد', type: 'date' }, { name: 'birth_place', label: 'محل تولد', type: 'text' },
      { name: 'religion', label: 'دین', type: 'text' }, { name: 'nationality', label: 'تابعیت', type: 'text' },
      { name: 'blood_type', label: 'گروه خونی', type: 'select', opts: L.bloodTypes.map((b) => [b, b]) }] },
    { title: 'اطلاعات تحصیلی', icon: 'school', fields: [
      { name: 'student_code', label: 'شماره دانش‌آموزی', type: 'text', ltr: true, hint: 'خالی بگذارید تا خودکار ساخته شود.' }, { name: 'classroom_id', label: 'کلاس', type: 'select', rel: 'classrooms' },
      { name: 'status', label: 'وضعیت', type: 'select', required: true, opts: opt(L.studentStatus) }, { name: 'enrollment_date', label: 'تاریخ ثبت‌نام', type: 'date' },
      { name: 'previous_school', label: 'مدرسه قبلی', type: 'text' }, ...(M('transport') ? [{ name: 'route_id', label: 'سرویس مدرسه', type: 'select', rel: 'routes' }] : [])] },
    { title: 'تماس و نشانی', icon: 'map-pin', fields: [
      { name: 'mobile', label: 'موبایل دانش‌آموز', type: 'tel' }, { name: 'home_phone', label: 'تلفن منزل', type: 'tel' }, { name: 'postal_code', label: 'کد پستی', type: 'text', ltr: true },
      { name: 'address', label: 'نشانی', type: 'textarea', full: true }] },
    { title: 'اطلاعات اولیا', icon: 'users-round', fields: [
      { name: 'father_name', label: 'نام پدر', type: 'text' }, { name: 'father_job', label: 'شغل پدر', type: 'text' }, { name: 'father_phone', label: 'موبایل پدر', type: 'tel' }, { name: 'father_national_id', label: 'کد ملی پدر', type: 'text', ltr: true }, { name: 'father_education', label: 'تحصیلات پدر', type: 'text' },
      { name: 'mother_name', label: 'نام مادر', type: 'text' }, { name: 'mother_job', label: 'شغل مادر', type: 'text' }, { name: 'mother_phone', label: 'موبایل مادر', type: 'tel' }, { name: 'mother_national_id', label: 'کد ملی مادر', type: 'text', ltr: true }, { name: 'mother_education', label: 'تحصیلات مادر', type: 'text' },
      { name: 'guardian_name', label: 'نام سرپرست (در صورت غیر از والدین)', type: 'text' }, { name: 'guardian_relation', label: 'نسبت سرپرست', type: 'text' }, { name: 'guardian_phone', label: 'موبایل سرپرست', type: 'tel' },
      { name: 'emergency_contact', label: 'مخاطب اضطراری', type: 'text' }, { name: 'emergency_phone', label: 'تلفن اضطراری', type: 'tel' },
      { name: 'siblings_count', label: 'تعداد خواهر و برادر', type: 'number' }, { name: 'family_status', label: 'وضعیت خانوادگی', type: 'text' }] },
    { title: 'سلامت و بیمه', icon: 'heart-pulse', fields: [
      { name: 'allergies', label: 'حساسیت‌ها', type: 'textarea' }, { name: 'chronic_disease', label: 'بیماری خاص/مزمن', type: 'textarea' }, { name: 'medications', label: 'داروهای مصرفی', type: 'textarea' },
      { name: 'special_needs', label: 'نیازهای ویژه آموزشی', type: 'textarea' }, { name: 'insurance', label: 'بیمه', type: 'text' }] },
    { title: 'یادداشت', icon: 'notebook-pen', fields: [{ name: 'notes', label: 'توضیحات تکمیلی', type: 'textarea', full: true }] },
  ];
}
async function formOptions(k) {
  return {
    classrooms: (await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name')).map((c) => [c.id, c.name]),
    routes: M('transport') ? (await k('bus_routes').orderBy('name').select('id', 'name')).map((c) => [c.id, c.name]) : [],
  };
}
function allFields() { return fieldGroups().flatMap((g) => g.fields); }

async function getStudent(req, id) {
  const k = db.get(); const u = req.user;
  const s = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.id', id).first('s.*', 'c.name as class_name', 'c.homeroom_teacher_id');
  if (!s) return null;
  if (isManager(u)) return s;
  if (u.role === 'student') return u.student && u.student.id === s.id ? s : null; // اولیا: نقش مؤثر student با فرزند انتخاب‌شده
  const ids = await svc.accessibleClassIds(u);
  return ids && ids.includes(s.classroom_id) ? s : null;
}
const notFound = (res) => res.status(404).view('error', { code: 404, title: 'یافت نشد', message: 'دانش‌آموز مورد نظر یافت نشد یا به آن دسترسی ندارید.' });

/* ---------- لیست ---------- */
async function listQuery(req) {
  const k = db.get(); const u = req.user;
  const qb = k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id');
  if (u.role === 'teacher') { const ids = await svc.accessibleClassIds(u); qb.whereIn('s.classroom_id', ids.length ? ids : [0]); }
  const q = (req.query.q || '').trim();
  if (q) {
    const parts = q.split(/\s+/);
    qb.where((b) => {
      if (parts.length > 1) parts.forEach((p) => b.where((x) => x.where('s.first_name', 'like', `%${p}%`).orWhere('s.last_name', 'like', `%${p}%`)));
      else b.where('s.first_name', 'like', `%${q}%`).orWhere('s.last_name', 'like', `%${q}%`).orWhere('s.student_code', 'like', `%${q}%`).orWhere('s.national_id', 'like', `%${q}%`).orWhere('s.father_phone', 'like', `%${q}%`).orWhere('s.mother_phone', 'like', `%${q}%`).orWhere('s.father_name', 'like', `%${q}%`);
    });
  }
  for (const f of ['classroom_id', 'status', 'gender']) if (req.query[f]) qb.where('s.' + f, req.query[f]);
  return { qb };
}
router.get('/students', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const page = Math.max(1, parseInt(req.query.page, 10) || 1); const per = 25;
    const { qb } = await listQuery(req);
    const total = Number((await qb.clone().count({ c: '*' }).first()).c);
    const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
    const sortCol = { code: 's.student_code', name: 's.last_name', class: 'c.name' }[req.query.sort] || 's.last_name';
    const rows = await qb.orderBy(sortCol, dir).orderBy('s.first_name').limit(per).offset((page - 1) * per).select('s.id', 's.first_name', 's.last_name', 's.student_code', 's.gender', 's.status', 's.father_phone', 's.mother_phone', 's.father_name', 's.photo', 'c.name as class_name');
    const classes = await k('classrooms').where('status', '<>', 'archived').orderBy('name').select('id', 'name');
    res.view('students/index', { title: 'دانش‌آموزان', rows, classes, total, page, pages: Math.max(1, Math.ceil(total / per)), q: req.query.q || '', f: req.query, sort: req.query.sort || 'name', dir });
  } catch (e) { next(e); }
});
router.get('/students/export.csv', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const { qb } = await listQuery(req);
    const rows = await qb.orderBy('s.last_name').limit(10000).select('s.*', 'c.name as class_name');
    const head = ['شماره دانش‌آموزی', 'نام', 'نام خانوادگی', 'کد ملی', 'جنسیت', 'تاریخ تولد', 'کلاس', 'وضعیت', 'نام پدر', 'موبایل پدر', 'نام مادر', 'موبایل مادر', 'تلفن منزل', 'نشانی'];
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="students-${J.todayISO()}.csv"`)
      .send(toCSV(head, rows.map((s) => [s.student_code, s.first_name, s.last_name, s.national_id, L.gender[s.gender], J.isoToJString(s.birth_date), s.class_name, L.studentStatus[s.status], s.father_name, s.father_phone, s.mother_name, s.mother_phone, s.home_phone, s.address])));
  } catch (e) { next(e); }
});
router.post('/students/bulk', mgr, async (req, res, next) => {
  try {
    const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean); const k = db.get();
    if (!ids.length) { req.flash('error', 'هیچ دانش‌آموزی انتخاب نشده است.'); return res.redirect('/students'); }
    if (req.body.action === 'move' && req.body.classroom_id) {
      const cls = await k('classrooms').where({ id: Number(req.body.classroom_id) }).first();
      if (!cls) { req.flash('error', 'کلاس مقصد معتبر نیست.'); return res.redirect('/students'); }
      const movers = (await k('students').whereIn('id', ids).where({ status: 'active' }).where((b) => b.whereNull('classroom_id').orWhereNot('classroom_id', cls.id)).select('id')).map((x) => x.id);
      const cnt = Number((await k('students').where({ classroom_id: cls.id, status: 'active' }).count({ c: '*' }).first()).c);
      if (cls.capacity && cnt + movers.length > cls.capacity) { req.flash('error', `ظرفیت کلاس «${cls.name}» (${cls.capacity} نفر) کافی نیست؛ ${cnt} نفر عضو هستند.`); return res.redirect('/students'); }
      if (!movers.length) { req.flash('error', 'دانش‌آموز فعالِ قابل انتقالی در انتخاب شما نیست.'); return res.redirect('/students'); }
      await k('students').whereIn('id', movers).update({ classroom_id: cls.id });
      await svc.audit(req, 'bulk_move', 'students', null, `${movers.length} دانش‌آموز → ${cls.name}`); req.flash('success', `${movers.length} دانش‌آموز به «${cls.name}» منتقل شد.`);
    } else if (req.body.action === 'status' && L.studentStatus[req.body.status]) {
      const before = await k('students').whereIn('id', ids).select('id', 'user_id', 'student_code', 'status');
      await k('students').whereIn('id', ids).update({ status: req.body.status });
      await k('users').whereIn('id', before.map((x) => x.user_id)).update({ active: req.body.status === 'active' ? 1 : 0 });
      for (const b of before) { if (b.status !== req.body.status) await svc.audit(req, 'status_change', 'students', b.id, `${b.student_code}: ${b.status} → ${req.body.status}`); if (req.body.status !== 'active') await svc.killSessions(b.user_id); }
      await svc.audit(req, 'bulk_status', 'students', null, `${ids.length} → ${req.body.status}`); req.flash('success', 'وضعیت دانش‌آموزان تغییر کرد.');
    }
    res.redirect('/students');
  } catch (e) { next(e); }
});

/* ---------- ورود گروهی از CSV ---------- */
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('file');
const IMPORT_COLS = [['first_name', 'نام'], ['last_name', 'نام خانوادگی'], ['gender', 'جنسیت (پسر/دختر)'], ['national_id', 'کد ملی'], ['birth_date', 'تاریخ تولد (۱۳۹۳/۰۵/۲۰)'], ['classroom', 'کلاس (نام دقیق)'], ['father_name', 'نام پدر'], ['father_phone', 'موبایل پدر'], ['mother_name', 'نام مادر'], ['mother_phone', 'موبایل مادر'], ['address', 'نشانی']];
router.get('/students/import', mgr, (req, res) => res.view('students/import', { title: 'ورود گروهی دانش‌آموزان', cols: IMPORT_COLS, result: null }));
router.get('/students/import/template.csv', mgr, (req, res) => res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="students-template.csv"').send(toCSV(IMPORT_COLS.map((c) => c[1]), [['علی', 'رضایی', 'پسر', '', '1393/05/20', 'هفتم الف', 'محمد رضایی', '09121234567', 'زهرا احمدی', '09127654321', 'تهران']])));
router.post('/students/import', mgr, (req, res, next) => {
  csvUpload(req, res, async (err) => {
    try {
      if (err || !req.file) { req.flash('error', err ? err.message : 'فایل CSV را انتخاب کنید.'); return res.redirect('/students/import'); }
      const token = req.query._csrf; if (!token || token !== req.session.csrf) return res.status(403).view('error', { code: 403, title: 'درخواست نامعتبر', message: 'نشانه امنیتی نامعتبر است.' });
      const k = db.get(); const rows = parseCSV(req.file.buffer.toString('utf8')); rows.shift();
      const classRows = await k('classrooms').where('status', '<>', 'archived').select('id', 'name', 'capacity');
      const classes = Object.fromEntries(classRows.map((c) => [c.name, c.id]));
      const room = {}; // ظرفیت باقی‌مانده هر کلاس
      for (const c of classRows) { const n = Number((await k('students').where({ classroom_id: c.id, status: 'active' }).count({ c: '*' }).first()).c); room[c.id] = c.capacity ? c.capacity - n : Infinity; }
      const result = { ok: 0, errors: [], creds: [] };
      if (rows.length > 1000) { req.flash('error', 'حداکثر ۱۰۰۰ ردیف در هر بار ورود مجاز است.'); return res.redirect('/students/import'); }
      for (const [i, raw] of rows.entries()) {
        const r = normalizeInput(raw); const line = i + 2;
        const [first_name, last_name, g, national_id, bd, klass, father_name, father_phone, mother_name, mother_phone, address] = r;
        const gender = /^(پسر|male|m)$/i.test(g || '') ? 'male' : /^(دختر|female|f)$/i.test(g || '') ? 'female' : null;
        const birth = bd ? J.parseJalali(bd) : null;
        if (!first_name || !last_name) { result.errors.push(`ردیف ${line}: نام و نام خانوادگی الزامی است.`); continue; }
        if (!gender) { result.errors.push(`ردیف ${line}: جنسیت باید «پسر» یا «دختر» باشد.`); continue; }
        if (national_id && !svc.validNationalId(national_id)) { result.errors.push(`ردیف ${line}: کد ملی نامعتبر است.`); continue; }
        if (national_id && await k('students').where({ national_id }).first()) { result.errors.push(`ردیف ${line}: کد ملی تکراری است.`); continue; }
        if (bd && !birth) { result.errors.push(`ردیف ${line}: تاریخ تولد نامعتبر است.`); continue; }
        if (klass && !classes[klass]) { result.errors.push(`ردیف ${line}: کلاس «${klass}» وجود ندارد.`); continue; }
        if (!svc.validPhone(father_phone) || !svc.validPhone(mother_phone)) { result.errors.push(`ردیف ${line}: شماره تلفن نامعتبر است.`); continue; }
        if (!father_phone && !mother_phone) { result.errors.push(`ردیف ${line}: حداقل یکی از شماره‌های پدر یا مادر الزامی است.`); continue; }
        if (klass && room[classes[klass]] <= 0) { result.errors.push(`ردیف ${line}: ظرفیت کلاس «${klass}» تکمیل است.`); continue; }
        if (klass) room[classes[klass]]--;
        const created = await createStudent(k, { first_name, last_name, gender, national_id: national_id || null, birth_date: birth, classroom_id: klass ? classes[klass] : null, father_name: father_name || null, father_phone: father_phone || null, mother_name: mother_name || null, mother_phone: mother_phone || null, address: address || null, status: 'active', enrollment_date: J.todayISO() });
        result.ok++; result.creds.push([created.student_code, `${first_name} ${last_name}`, created.password]);
      }
      await svc.audit(req, 'import', 'students', null, `${result.ok} دانش‌آموز`);
      res.view('students/import', { title: 'ورود گروهی دانش‌آموزان', cols: IMPORT_COLS, result });
    } catch (e) { next(e); }
  });
});

async function createStudent(k, data) {
  const code = data.student_code || await svc.nextStudentCode();
  const password = (settings.get('student_password_mode') === 'national_id' && data.national_id) ? data.national_id : svc.randomPassword(8);
  const username = await svc.uniqueUsername(code);
  const password_hash = svc.hash(password);
  return k.transaction(async (t) => {
    const ur = await t('users').insert({ username, password_hash, role: 'student', full_name: `${data.first_name} ${data.last_name}`, active: data.status === 'active' ? 1 : 0, must_change_password: 1 });
    const user_id = Array.isArray(ur) ? ur[0] : ur;
    const sr = await t('students').insert({ ...data, student_code: code, user_id });
    return { id: Array.isArray(sr) ? sr[0] : sr, user_id, student_code: code, username, password };
  });
}

/* ---------- افزودن/ویرایش ---------- */
async function renderForm(req, res, row, errors, vals) {
  const options = await formOptions(db.get());
  res.view('students/form', { title: row ? 'ویرایش پرونده دانش‌آموز' : 'ثبت‌نام دانش‌آموز جدید', row, errors: errors || [], vals: vals || (row ? { ...row, birth_date: J.isoToJString(row.birth_date), enrollment_date: J.isoToJString(row.enrollment_date) } : { status: 'active', nationality: 'ایرانی', religion: 'اسلام', enrollment_date: J.isoToJString(J.todayISO()), classroom_id: req.query.class_id || '' }), groups: fieldGroups(), options });
}
router.get('/students/new', mgr, (req, res, next) => renderForm(req, res, null).catch(next));
async function collect(req, k, existing) {
  const errors = []; const data = {}; const b = req.body;
  const clsIds = (await k('classrooms').where('status', '<>', 'archived').select('id')).map((c) => String(c.id));
  const routeIds = M('transport') ? (await k('bus_routes').select('id')).map((c) => String(c.id)) : [];
  for (const f of allFields()) {
    if (f.name === 'route_id' && !M('transport')) continue;
    let v = b[f.name]; if (v === '' || v === undefined) v = null;
    if (f.required && v === null) { errors.push(`«${f.label}» الزامی است.`); continue; }
    if (v !== null && f.type === 'date') { const iso = J.parseJalali(v); if (!iso) { errors.push(`«${f.label}» نامعتبر است (مثال: ۱۴۰۵/۰۷/۰۹).`); continue; } v = iso; }
    if (v !== null && f.type === 'number') { v = Number(v); if (isNaN(v) || v < 0 || v > 30) { errors.push(`«${f.label}» نامعتبر است.`); continue; } }
    if (v !== null && f.type === 'tel' && !svc.validPhone(v)) { errors.push(`«${f.label}» معتبر نیست.`); continue; }
    if (v !== null && f.name === 'gender' && !L.gender[v]) { errors.push('جنسیت نامعتبر است.'); continue; }
    if (v !== null && f.name === 'status' && !L.studentStatus[v]) { errors.push('وضعیت نامعتبر است.'); continue; }
    if (v !== null && f.name === 'classroom_id' && !clsIds.includes(String(v))) { errors.push('کلاس نامعتبر است.'); continue; }
    if (v !== null && f.name === 'route_id' && !routeIds.includes(String(v))) { errors.push('سرویس نامعتبر است.'); continue; }
    if (v !== null && f.name === 'blood_type' && !L.bloodTypes.includes(v)) { errors.push('گروه خونی نامعتبر است.'); continue; }
    data[f.name] = v;
  }
  if (data.national_id) {
    if (!svc.validNationalId(data.national_id)) errors.push('کد ملی دانش‌آموز معتبر نیست.');
    else { const dup = await k('students').where({ national_id: data.national_id }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first(); if (dup) errors.push('این کد ملی قبلاً برای دانش‌آموز دیگری ثبت شده است.'); }
  }
  for (const f of ['father_national_id', 'mother_national_id']) if (data[f] && !svc.validNationalId(data[f])) errors.push('کد ملی والدین معتبر نیست.');
  if (!data.father_phone && !data.mother_phone && !data.guardian_phone) errors.push('حداقل یکی از شماره‌های تماس اولیا (پدر، مادر یا سرپرست) الزامی است.');
  if (data.student_code) {
    if (!/^[A-Za-z0-9-]{3,30}$/.test(data.student_code)) errors.push('شماره دانش‌آموزی فقط می‌تواند شامل حروف لاتین، عدد و خط تیره باشد.');
    else { const dup = await k('students').where({ student_code: data.student_code }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).first(); if (dup) errors.push('این شماره دانش‌آموزی تکراری است.'); }
  }
  if (data.classroom_id) {
    const cls = await k('classrooms').where({ id: data.classroom_id }).first();
    const cnt = Number((await k('students').where({ classroom_id: data.classroom_id, status: 'active' }).modify((q) => { if (existing) q.whereNot('id', existing.id); }).count({ c: '*' }).first()).c);
    if (cls && cls.capacity && cnt >= cls.capacity) errors.push(`ظرفیت کلاس «${cls.name}» تکمیل است (${cls.capacity} نفر).`);
  }
  return { errors, data };
}
router.post('/students/new', mgr, uploader('photos', 'photo', { images: true, maxMB: 2 }), async (req, res, next) => {
  try {
    const k = db.get(); const { errors, data } = await collect(req, k, null);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return renderForm(req, res, null, errors, req.body); }
    if (!data.student_code) delete data.student_code;
    if (req.file) data.photo = req.file.filename;
    const c = await createStudent(k, data);
    await svc.audit(req, 'create', 'students', c.id, `${data.first_name} ${data.last_name}`);
    req.flash('success', `دانش‌آموز ثبت شد. نام کاربری: ${c.username} — رمز اولیه: ${c.password} (در اولین ورود باید تغییر کند؛ فقط یک‌بار نمایش داده می‌شود.)`);
    res.redirect('/students/' + c.id);
  } catch (e) { next(e); }
});
router.get('/students/:id(\\d+)/edit', mgr, async (req, res, next) => { try { const s = await getStudent(req, req.params.id); if (!s) return notFound(res); await renderForm(req, res, s); } catch (e) { next(e); } });
router.post('/students/:id(\\d+)/edit', mgr, uploader('photos', 'photo', { images: true, maxMB: 2 }), async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const { errors, data } = await collect(req, k, s);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) { if (req.file) fs.unlink(req.file.path, () => {}); return renderForm(req, res, s, errors, { ...req.body }); }
    if (!data.student_code) data.student_code = s.student_code;
    if (req.file) { if (s.photo) fs.unlink(path.join(config.UPLOAD_DIR, 'photos', s.photo), () => {}); data.photo = req.file.filename; }
    await diffAndLog(k, s, data, req.user);
    await k('students').where({ id: s.id }).update(data);
    const upd = { full_name: `${data.first_name} ${data.last_name}`, active: data.status === 'active' ? 1 : 0 };
    const u = await k('users').where({ id: s.user_id }).first();
    if (u && u.username === s.student_code && data.student_code !== s.student_code) upd.username = await svc.uniqueUsername(data.student_code);
    await k('users').where({ id: s.user_id }).update(upd);
    await svc.audit(req, 'update', 'students', s.id, upd.full_name);
    req.flash('success', 'پرونده دانش‌آموز ذخیره شد.'); res.redirect('/students/' + s.id);
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/delete', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const loans = Number((await k('book_loans').where({ student_id: s.id }).whereNull('returned_at').count({ c: '*' }).first()).c);
    if (loans) { req.flash('error', 'این دانش‌آموز کتاب امانت‌گرفته‌شده بازنگردانده دارد؛ ابتدا بازگشت کتاب‌ها را ثبت کنید.'); return res.redirect('/students/' + s.id); }
    const files = { documents: [], tickets: [], homework: [] };
    (await k('student_documents').where({ student_id: s.id }).select('file_name')).forEach((d) => files.documents.push(d.file_name));
    (await k('homework_submissions').where({ student_id: s.id }).whereNotNull('file').select('file')).forEach((d) => files.homework.push(d.file));
    const tk = await k('tickets').where((b) => b.where('student_id', s.id).orWhere('created_by', s.user_id)).select('id');
    const tkIds = tk.map((x) => x.id);
    if (tkIds.length) (await k('ticket_messages').whereIn('ticket_id', tkIds).whereNotNull('attachment').select('attachment')).forEach((d) => files.tickets.push(d.attachment));
    await k.transaction(async (t) => {
      if (tkIds.length) { await t('ticket_messages').whereIn('ticket_id', tkIds).del(); await t('tickets').whereIn('id', tkIds).del(); }
      await t('ticket_messages').where({ user_id: s.user_id }).del();
      const fees = await t('fees').where({ student_id: s.id }).select('id');
      if (fees.length) await t('payments').whereIn('fee_id', fees.map((f) => f.id)).del();
      for (const tb of ['fees', 'attendance', 'scores', 'homework_submissions', 'discipline_records', 'health_records', 'meetings', 'student_notes', 'student_documents', 'book_loans']) await t(tb).where({ student_id: s.id }).del();
      await t('notifications').where({ user_id: s.user_id }).del();
      await t('students').where({ id: s.id }).del(); await t('users').where({ id: s.user_id }).del();
    });
    await svc.killSessions(s.user_id);
    if (s.photo) fs.unlink(path.join(config.UPLOAD_DIR, 'photos', s.photo), () => {});
    for (const [kind, list] of Object.entries(files)) list.forEach((f) => fs.unlink(path.join(config.UPLOAD_DIR, kind, f), () => {}));
    await svc.audit(req, 'delete', 'students', s.id, `${s.first_name} ${s.last_name}`);
    req.flash('success', 'دانش‌آموز و تمام سوابق او حذف شد.'); res.redirect('/students');
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/reset-password', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const pw = svc.randomPassword(8);
    await k('users').where({ id: s.user_id }).update({ password_hash: svc.hash(pw), must_change_password: 1 });
    await svc.killSessions(s.user_id);
    await svc.audit(req, 'reset_password', 'students', s.id, s.student_code);
    req.flash('success', `رمز جدید دانش‌آموز: ${pw} (فقط یک‌بار نمایش داده می‌شود)`); res.redirect('/students/' + s.id);
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/status', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s || !L.studentStatus[req.body.status]) return notFound(res);
    await diffAndLog(k, s, { status: req.body.status }, req.user);
    await k('students').where({ id: s.id }).update({ status: req.body.status });
    await k('users').where({ id: s.user_id }).update({ active: req.body.status === 'active' ? 1 : 0 });
    await svc.audit(req, 'status', 'students', s.id, req.body.status);
    req.flash('success', 'وضعیت دانش‌آموز تغییر کرد.'); res.redirect('/students/' + s.id);
  } catch (e) { next(e); }
});

/* ---------- یادداشت‌ها ---------- */
router.post('/students/:id(\\d+)/notes', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    if (!req.body.body) { req.flash('error', 'متن یادداشت را وارد کنید.'); return res.redirect(`/students/${s.id}?tab=notes`); }
    await db.get()('student_notes').insert({ student_id: s.id, author_id: req.user.id, body: req.body.body.slice(0, 2000), private: 1 });
    req.flash('success', 'یادداشت ثبت شد.'); res.redirect(`/students/${s.id}?tab=notes`);
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/notes/:nid/delete', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const n = await k('student_notes').where({ id: req.params.nid, student_id: s.id }).first();
    if (n && (isManager(req.user) || n.author_id === req.user.id)) await k('student_notes').where({ id: n.id }).del();
    res.redirect(`/students/${s.id}?tab=notes`);
  } catch (e) { next(e); }
});

/* ---------- مدارک ---------- */
router.post('/students/:id(\\d+)/documents', requireRole('admin', 'deputy'), uploader('documents', 'file', { maxMB: 5 }), async (req, res, next) => {
  try {
    if (!M('documents')) return res.redirect('/students');
    const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    if (req.uploadError || !req.file) { req.flash('error', req.uploadError || 'فایلی انتخاب نشده است.'); return res.redirect(`/students/${s.id}?tab=documents`); }
    await db.get()('student_documents').insert({ student_id: s.id, title: (req.body.title || req.file.originalname).slice(0, 150), category: L.docCategory[req.body.category] ? req.body.category : 'other', file_name: req.file.filename, original_name: req.file.originalname.slice(0, 200), size: req.file.size, uploaded_by: req.user.id });
    await svc.audit(req, 'upload', 'student_documents', s.id, req.file.originalname);
    req.flash('success', 'مدرک بارگذاری شد.'); res.redirect(`/students/${s.id}?tab=documents`);
  } catch (e) { next(e); }
});
router.post('/students/:id(\\d+)/documents/:did/delete', requireRole('admin', 'deputy'), async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const d = await k('student_documents').where({ id: req.params.did, student_id: s.id }).first();
    if (d) { fs.unlink(path.join(config.UPLOAD_DIR, 'documents', d.file_name), () => {}); await k('student_documents').where({ id: d.id }).del(); }
    req.flash('success', 'مدرک حذف شد.'); res.redirect(`/students/${s.id}?tab=documents`);
  } catch (e) { next(e); }
});

/* ---------- نمایش پرونده ---------- */
router.get('/students/me', requireRole('student'), (req, res) => (req.user.student ? res.redirect('/students/' + req.user.student.id) : res.redirect('/')));

function display(s, extra = {}) {
  const out = {};
  for (const f of allFields()) {
    let v = s[f.name];
    if (v === null || v === undefined || v === '') { out[f.name] = '—'; continue; }
    if (f.type === 'date') v = J.isoToJString(v);
    else if (f.name === 'gender') v = L.gender[v]; else if (f.name === 'status') v = L.studentStatus[v];
    out[f.name] = v;
  }
  out.classroom_id = s.class_name || '—';
  out.route_id = extra.routeName || '—';
  return out;
}
router.get('/students/:id(\\d+)', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const mgrFlag = isManager(u);
    const tabs = [['overview', 'مشخصات و اولیا']];
    if (M('attendance')) tabs.push(['attendance', 'حضور و غیاب']);
    if (M('grades')) tabs.push(['grades', 'نمرات']);
    if (M('discipline') || M('health') || M('meetings')) tabs.push(['behavior', 'انضباطی و سلامت']);
    if (M('documents') && u.role !== 'student') tabs.push(['documents', 'مدارک']);
    if (M('tickets')) tabs.push(['tickets', 'تیکت‌ها']);
    if (M('finance') && (mgrFlag || u.role === 'student')) tabs.push(['finance', 'مالی']);
    tabs.push(['history', 'سوابق تحصیلی']);
    if (u.role !== 'student') tabs.push(['guardians', 'اولیای مجاز و خروج']);
    if (mgrFlag) tabs.push(['changes', 'تاریخچه تغییرات']);
    if (u.role !== 'student') tabs.push(['notes', 'یادداشت‌ها']);
    let tab = req.query.tab; if (!tabs.find((t) => t[0] === tab)) tab = 'overview';
    const data = { title: `${s.first_name} ${s.last_name}`, s, tabs, tab, groups: fieldGroups(), disp: display(s), age: J.ageFrom(s.birth_date), mgrFlag, canNote: u.role !== 'student' };
    if (tab === 'overview') {
      data.homeroom = s.homeroom_teacher_id ? await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.id', s.homeroom_teacher_id).first('u.full_name', 'u.phone') : null;
      data.route = M('transport') && s.route_id ? await k('bus_routes').where({ id: s.route_id }).first() : null;
      data.disp = display(s, { routeName: data.route ? data.route.name : null });
      if (mgrFlag && M('parents') && permissions.can(u, 'parents')) data.parentAccounts = await k('parent_students as ps').join('users as p', 'p.id', 'ps.user_id').where('ps.student_id', s.id).select('p.id', 'p.username', 'p.full_name', 'p.active', 'ps.relation');
    }
    if (tab === 'attendance') {
      const rows = await k('attendance').where({ student_id: s.id }).groupBy('status').select('status').count({ c: '*' });
      data.att = Object.fromEntries(rows.map((r) => [r.status, Number(r.c)])); data.attTotal = Object.values(data.att).reduce((a, b) => a + b, 0);
      data.attList = await k('attendance').where({ student_id: s.id }).orderBy('date', 'desc').limit(30);
    }
    if (tab === 'grades' && s.classroom_id) {
      const published = !mgrFlag && u.role !== 'teacher';
      const r = await classResults(k, s.classroom_id, { publishedOnly: published, ...(await svc.gradeScope(u, s.classroom_id)) });
      data.report = r; data.me = r.students.find((x) => x.id === s.id) || null; data.showRank = u.role !== 'student' || settings.bool('show_rank_to_students');
      data.classAvg = (() => { const v = r.students.filter((x) => x.overall !== null); return v.length ? Math.round(v.reduce((a, b) => a + b.overall, 0) / v.length * 100) / 100 : null; })();
    }
    if (tab === 'behavior') {
      if (M('discipline')) { data.discipline = await k('discipline_records').where({ student_id: s.id }).orderBy('record_date', 'desc'); data.behaviorScore = Math.max(0, Math.min(20, 20 + data.discipline.reduce((a, b) => a + (b.points || 0), 0))); }
      if (M('health') && mgrFlag) data.health = await k('health_records').where({ student_id: s.id }).orderBy('record_date', 'desc');
      if (M('meetings')) data.meetings = await k('meetings').where({ student_id: s.id }).orderBy('meeting_date', 'desc');
    }
    if (tab === 'history') {
      data.records = await k('student_year_records').where({ student_id: s.id }).orderBy('academic_year_id');
      data.chart = charts.lineChart(data.records.map((r) => ({ label: r.year_title, value: r.overall === null ? null : Number(r.overall) })), { max: settings.num('grade_scale') || 20 });
      data.absChart = charts.barChart(data.records.map((r) => ({ label: r.year_title, value: r.absent_days || 0, color: '#dc2626' })), { unit: ' روز' });
    }
    if (tab === 'guardians') {
      data.guardians = await k('student_guardians').where({ student_id: s.id }).orderBy('id');
      if (M('exits')) data.exits = await k('exit_permits').where({ student_id: s.id }).orderBy('id', 'desc').limit(30);
    }
    if (tab === 'changes') data.fieldLabels = Object.fromEntries(allFields().map((f) => [f.name, f.label]));
    if (tab === 'changes') data.changes = await k('student_changes').where({ student_id: s.id }).orderBy('id', 'desc').limit(200);
    if (tab === 'documents') data.docs = await k('student_documents').where({ student_id: s.id }).orderBy('id', 'desc');
    if (tab === 'tickets') data.tickets = await k('tickets').where({ student_id: s.id }).modify((q) => { if (!mgrFlag) q.where((b) => b.where('created_by', u.id).orWhere('recipient_user_id', u.id)); }).orderBy('id', 'desc');
    if (tab === 'finance') {
      data.fees = await k('fees as f').leftJoin(require('../lib/finance').paidSub(k), 'p.fee_id', 'f.id').where('f.student_id', s.id).orderBy('f.due_date').select('f.*', k.raw('coalesce(p.paid,0) as paid'));
    }
    if (tab === 'notes') data.notes = await k('student_notes as n').leftJoin('users as u', 'u.id', 'n.author_id').where('n.student_id', s.id).modify((q) => { if (!mgrFlag) q.where('n.author_id', u.id); }).orderBy('n.id', 'desc').select('n.*', 'u.full_name as author');
    res.view('students/show', data);
  } catch (e) { next(e); }
});
router.get('/students/:id(\\d+)/print', requireRole('admin', 'deputy', 'teacher'), async (req, res, next) => {
  try {
    const k = db.get(); const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const attRows = await k('attendance').where({ student_id: s.id }).groupBy('status').select('status').count({ c: '*' });
    const route = M('transport') && s.route_id ? await k('bus_routes').where({ id: s.route_id }).first() : null;
    res.view('students/print', { title: 'پرونده ' + s.first_name + ' ' + s.last_name, s, groups: fieldGroups(), disp: display(s, { routeName: route ? route.name : null }), att: Object.fromEntries(attRows.map((r) => [r.status, Number(r.c)])) });
  } catch (e) { next(e); }
});
router.get('/students/:id(\\d+)/card', requireRole('admin', 'deputy'), async (req, res, next) => {
  try {
    const s = await getStudent(req, req.params.id); if (!s) return notFound(res);
    const year = await db.get()('academic_years').where({ is_current: 1 }).first();
    res.view('students/card', { title: 'کارت شناسایی', s, year, cards: [{ s, qr: await qr.svg(qr.payload(s.student_code), { width: 120 }) }] });
  } catch (e) { next(e); }
});
/** چاپ گروهی کارت‌های یک کلاس (۸ کارت در هر صفحه‌ی A4) */
router.get('/classes/:id(\\d+)/cards', requireRole('admin', 'deputy'), async (req, res, next) => {
  try {
    const k = db.get(); const c = await k('classrooms').where({ id: req.params.id }).first(); if (!c) return notFound(res);
    const students = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where({ 's.classroom_id': c.id, 's.status': 'active' }).orderBy('s.last_name').select('s.*', 'c.name as class_name');
    const year = await k('academic_years').where({ is_current: 1 }).first();
    const cards = []; for (const s of students) cards.push({ s, qr: await qr.svg(qr.payload(s.student_code), { width: 120 }) });
    res.view('students/card', { title: 'کارت‌های کلاس ' + c.name, s: null, year, cards, cls: c });
  } catch (e) { next(e); }
});
module.exports = router;

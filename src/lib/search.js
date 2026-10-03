'use strict';
/** جستجوی سراسری با رعایت دسترسی نقش‌ها و ماژول‌ها. خروجی: [{ key, title, icon, total, items:[{ title, sub, url }] }] */
const db = require('../db');
const modules = require('../modules');
const svc = require('../services');
const { toEn } = require('../utils/fa');

const norm = (s) => toEn(String(s || '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[!%_]/g, (c) => '!' + c);
const TYPES = [['students', 'دانش‌آموزان', 'graduation-cap'], ['teachers', 'معلمان', 'briefcase'], ['classes', 'کلاس‌ها', 'layout-grid'], ['users', 'کاربران', 'users'], ['parents', 'اولیا', 'users'], ['tickets', 'تیکت‌ها', 'life-buoy'], ['homework', 'تکالیف', 'book-open'], ['announcements', 'اطلاعیه‌ها', 'megaphone'], ['books', 'کتاب‌ها', 'library-big']];

async function run(user, rawQ, { limit = 10, only = null } = {}) {
  const q = norm(rawQ); if (q.length < 2) return [];
  const k = db.get(); const like = `%${esc(q)}%`; const out = []; const u = user;
  const mgr = u.role === 'admin' || u.role === 'deputy'; const classIds = await svc.accessibleClassIds(u);
  const want = (key) => !only || only === key;
  const push = (key, rows, total) => { const t = TYPES.find((x) => x[0] === key); if (rows.length) out.push({ key, title: t[1], icon: t[2], total: total === undefined ? rows.length : total, items: rows }); };
  const L = (qb) => qb.limit(limit);
  const ESC = (col, b, v = like) => b.orWhereRaw(`${col} like ? escape '!'`, [v]);

  if (want('students') && u.role !== 'student') {
    const parts = q.split(' ').filter(Boolean);
    const base = () => {
      const sq = k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where((b) => {
        if (parts.length > 1) parts.forEach((p) => b.where((x) => { x.whereRaw("s.first_name like ? escape '!'", [`%${esc(p)}%`]); ESC('s.last_name', x, `%${esc(p)}%`); }));
        else { b.whereRaw("s.first_name like ? escape '!'", [like]); for (const c of ['s.last_name', 's.student_code', 's.national_id', 's.father_phone', 's.mother_phone', 's.guardian_phone', 's.father_name']) ESC(c, b); }
      });
      if (classIds) sq.whereIn('s.classroom_id', classIds.length ? classIds : [0]);
      return sq;
    };
    const total = Number((await base().count({ c: '*' }).first()).c);
    const rows = await L(base()).orderBy('s.last_name').select('s.id', 's.first_name', 's.last_name', 's.student_code', 's.status', 'c.name as class_name');
    push('students', rows.map((s) => ({ title: `${s.first_name} ${s.last_name}`, sub: `${s.student_code}${s.class_name ? ' · ' + s.class_name : ''}${s.status !== 'active' ? ' · غیرفعال' : ''}`, url: '/students/' + s.id, code: s.student_code })), total);
  }
  if (want('teachers') && mgr) {
    const rows = await L(k('teachers as t').join('users as x', 'x.id', 't.user_id').where((b) => { b.whereRaw("x.full_name like ? escape '!'", [like]); ESC('t.personnel_code', b); ESC('t.specialty', b); ESC('x.phone', b); }).select('t.id', 'x.full_name', 't.specialty'));
    push('teachers', rows.map((t) => ({ title: t.full_name, sub: t.specialty || '', url: '/teachers/' + t.id })));
  }
  if (want('classes') && (mgr || u.role === 'teacher')) {
    const cq = k('classrooms').whereRaw("name like ? escape '!'", [like]); if (classIds) cq.whereIn('id', classIds.length ? classIds : [0]);
    const rows = await L(cq.orderBy('name').select('id', 'name', 'grade_level'));
    push('classes', rows.map((c) => ({ title: c.name, sub: c.grade_level ? 'پایه ' + c.grade_level : '', url: '/classes/' + c.id })));
  }
  if (want('users') && u.role === 'admin') {
    const rows = await L(k('users').whereNot('role', 'parent').whereNot('role', 'student').where((b) => { b.whereRaw("full_name like ? escape '!'", [like]); ESC('username', b); ESC('phone', b); ESC('email', b); }).select('id', 'full_name', 'username', 'role'));
    push('users', rows.map((x) => ({ title: x.full_name, sub: `${x.username} · ${({ admin: 'مدیر', deputy: 'معاون', teacher: 'معلم' })[x.role] || x.role}`, url: '/users/' + x.id + '/edit' })));
  }
  if (want('parents') && mgr && modules.isEnabled('parents')) {
    const rows = await L(k('users').where('role', 'parent').where((b) => { b.whereRaw("full_name like ? escape '!'", [like]); ESC('username', b); ESC('phone', b); }).select('id', 'full_name', 'username'));
    push('parents', rows.map((x) => ({ title: x.full_name, sub: x.username, url: '/parents?q=' + encodeURIComponent(x.username) })));
  }
  if (want('tickets') && modules.isEnabled('tickets')) {
    const tq = k('tickets').whereRaw("subject like ? escape '!'", [like]);
    if (!mgr) tq.where((b) => b.where('created_by', u.id).orWhere('recipient_user_id', u.id));
    const rows = await L(tq.orderBy('id', 'desc').select('id', 'subject', 'status'));
    push('tickets', rows.map((t) => ({ title: t.subject, sub: ({ open: 'باز', pending: 'در انتظار', answered: 'پاسخ‌داده‌شده', closed: 'بسته' })[t.status] || t.status, url: '/tickets/' + t.id })));
  }
  if (want('homework') && modules.isEnabled('homework')) {
    const hq = k('homework as h').join('class_subjects as cs', 'cs.id', 'h.class_subject_id').leftJoin('classrooms as c', 'c.id', 'cs.classroom_id').whereRaw("h.title like ? escape '!'", [like]);
    if (classIds) hq.whereIn('cs.classroom_id', classIds.length ? classIds : [0]);
    const rows = await L(hq.orderBy('h.id', 'desc').select('h.id', 'h.title', 'c.name as class_name'));
    push('homework', rows.map((h) => ({ title: h.title, sub: h.class_name || '', url: '/homework/' + h.id })));
  }
  if (want('announcements') && modules.isEnabled('announcements')) {
    const aq = k('announcements as t').where((b) => { b.whereRaw("t.title like ? escape '!'", [like]); ESC('t.body', b); }); svc.audienceFilter(aq, u, classIds);
    const rows = await L(aq.orderBy('t.id', 'desc').select('t.id', 't.title'));
    push('announcements', rows.map((a) => ({ title: a.title, sub: '', url: '/announcements' })));
  }
  if (want('books') && modules.isEnabled('library')) {
    const rows = await L(k('books').where((b) => { b.whereRaw("title like ? escape '!'", [like]); ESC('author', b); }).select('id', 'title', 'author'));
    push('books', rows.map((b) => ({ title: b.title, sub: b.author || '', url: '/library/books?q=' + encodeURIComponent(b.title) })));
  }
  return out;
}
module.exports = { run, norm, TYPES };

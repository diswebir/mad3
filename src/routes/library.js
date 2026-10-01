'use strict';
const express = require('express');
const db = require('../db');
const svc = require('../services');
const modules = require('../modules');
const J = require('../utils/jalali');
const { requireRole, isManager } = require('../middleware');
const router = express.Router();
router.use('/library', modules.guard('library'));
const mgr = requireRole('admin', 'deputy');

router.get('/library', (req, res) => res.redirect('/library/books'));
router.get('/library/loans', async (req, res, next) => {
  try {
    const k = db.get(); const u = req.user; const today = J.todayISO(); const view = req.query.view || 'active';
    const q = k('book_loans as l').join('books as b', 'b.id', 'l.book_id').leftJoin('students as s', 's.id', 'l.student_id').leftJoin('teachers as t', 't.id', 'l.teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id')
      .select('l.*', 'b.title', 's.first_name', 's.last_name', 'tu.full_name as teacher_name', 'c.name as class_name').orderBy('l.id', 'desc').limit(300);
    if (u.role === 'student') q.where('l.student_id', u.student ? u.student.id : 0);
    else if (u.role === 'teacher') q.where('l.teacher_id', u.teacher ? u.teacher.id : 0);
    if (view === 'active') q.whereNull('l.returned_at'); else if (view === 'overdue') q.whereNull('l.returned_at').where('l.due_date', '<', today); else if (view === 'returned') q.whereNotNull('l.returned_at');
    const data = { title: 'امانت کتاب', rows: await q, view, today };
    if (isManager(u)) {
      const books = await k('books as b').select('b.id', 'b.title', 'b.copies', k.raw('(select count(*) from book_loans l where l.book_id = b.id and l.returned_at is null) as lent')).orderBy('b.title');
      data.books = books.filter((b) => b.copies > b.lent);
      data.students = await k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').select('s.id', 's.first_name', 's.last_name', 'c.name as cname');
      data.teachers = await k('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.full_name').select('t.id', 'u.full_name');
      data.defaultDue = J.isoToJString(J.addDays(today, 14));
    }
    res.view('library/loans', data);
  } catch (e) { next(e); }
});
router.post('/library/loans', mgr, async (req, res, next) => {
  try {
    const k = db.get(); const b = req.body; const book = await k('books').where({ id: b.book_id }).first();
    if (!book) { req.flash('error', 'کتاب را انتخاب کنید.'); return res.redirect('/library/loans'); }
    const lent = Number((await k('book_loans').where({ book_id: book.id }).whereNull('returned_at').count({ c: '*' }).first()).c);
    if (lent >= book.copies) { req.flash('error', 'همه نسخه‌های این کتاب در امانت است.'); return res.redirect('/library/loans'); }
    const [type, id] = String(b.borrower || '').split(':'); const due = J.parseJalali(b.due_date);
    if (!due || due < J.todayISO()) { req.flash('error', 'تاریخ بازگشت نامعتبر است.'); return res.redirect('/library/loans'); }
    const rec = { book_id: book.id, loan_date: J.todayISO(), due_date: due, recorded_by: req.user.id };
    let notifyUser = null;
    if (type === 's') { const s = await k('students').where({ id }).first(); if (!s) { req.flash('error', 'امانت‌گیرنده نامعتبر است.'); return res.redirect('/library/loans'); } rec.student_id = s.id; notifyUser = s.user_id; } else if (type === 't') { const t = await k('teachers').where({ id }).first(); if (!t) { req.flash('error', 'امانت‌گیرنده نامعتبر است.'); return res.redirect('/library/loans'); } rec.teacher_id = t.id; notifyUser = t.user_id; } else { req.flash('error', 'امانت‌گیرنده را انتخاب کنید.'); return res.redirect('/library/loans'); }
    const r = await k('book_loans').insert(rec); await svc.notify(notifyUser, 'کتاب امانت داده شد', `${book.title} — موعد بازگشت: ${J.isoToJString(due)}`, '/library/loans');
    await svc.audit(req, 'loan', 'book_loans', Array.isArray(r) ? r[0] : r, book.title); req.flash('success', 'امانت ثبت شد.'); res.redirect('/library/loans');
  } catch (e) { next(e); }
});
router.post('/library/loans/:id(\\d+)/return', mgr, async (req, res, next) => {
  try { const k = db.get(); const l = await k('book_loans').where({ id: req.params.id }).first(); if (l && !l.returned_at) { await k('book_loans').where({ id: l.id }).update({ returned_at: J.todayISO() }); await svc.audit(req, 'return', 'book_loans', l.id, ''); req.flash('success', 'بازگشت کتاب ثبت شد.'); } res.redirect('/library/loans'); } catch (e) { next(e); }
});
module.exports = router;

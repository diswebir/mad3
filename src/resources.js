'use strict';
/** تعریف منابع CRUD ساده روی موتور عمومی */
const crud = require('./crud');
const svc = require('./services');
const J = require('./utils/jalali');
const { L, badge } = require('./labels');

const STAFF = ['admin', 'deputy']; const ALL = ['admin', 'deputy', 'teacher', 'student']; const STAFF_T = ['admin', 'deputy', 'teacher'];
const pairs = (obj) => Object.entries(obj);
const isMgr = (u) => u.role === 'admin' || u.role === 'deputy';

async function studentOptions(k, req) {
  const q = k('students as s').leftJoin('classrooms as c', 'c.id', 's.classroom_id').where('s.status', 'active').orderBy('c.name').orderBy('s.last_name').limit(1500).select('s.id', 's.first_name', 's.last_name', 'c.name as cname');
  if (req.user.role === 'teacher') { const ids = await svc.accessibleClassIds(req.user); q.whereIn('s.classroom_id', ids.length ? ids : [0]); }
  return (await q).map((s) => [s.id, `${s.last_name} ${s.first_name}${s.cname ? ' — ' + s.cname : ''}`]);
}
const studentLink = { key: 'student_name', label: 'دانش‌آموز', sortKey: 'student_name', html: (r, h) => `<a href="${h.u('/students/' + r.student_id)}">${h.esc(r.student_name)}</a><div class="muted small">${h.esc(r.class_name || '')}</div>` };
async function ownStudentScope(req, qb) {
  const u = req.user;
  if (u.role === 'student') qb.where('t.student_id', u.student ? u.student.id : 0);
  else if (u.role === 'teacher') { const ids = await svc.accessibleClassIds(u); qb.whereIn('s.classroom_id', ids.length ? ids : [0]); }
}
function defs(db) {
  const k0 = () => db.get();
  const concat = (k) => (db.isMysql() ? k.raw("concat(s.first_name, ' ', s.last_name) as student_name") : k.raw("(s.first_name || ' ' || s.last_name) as student_name"));
  const studentBase = (table) => (k) => k(table + ' as t').join('students as s', 's.id', 't.student_id').leftJoin('classrooms as c', 'c.id', 's.classroom_id').select('t.*', concat(k), 'c.name as class_name');
  const classOptions = async (k, req) => {
    const ids = await svc.accessibleClassIds(req.user);
    const q = k('classrooms').orderBy('name').select('id', 'name'); if (ids) q.whereIn('id', ids.length ? ids : [0]);
    return (await q).map((c) => [c.id, c.name]);
  };

  return [
    {
      key: 'subjects', module: 'classes', table: 'subjects', title: 'دروس', singular: 'درس', icon: 'book-open', read: STAFF, write: STAFF,
      search: ['t.name', 't.code'], orderBy: [['t.name', 'asc']], sortable: ['t.name', 't.weekly_hours'],
      fields: [{ name: 'name', label: 'نام درس', type: 'text', required: true, maxlength: 100 }, { name: 'code', label: 'کد درس', type: 'text', ltr: true }, { name: 'grade_level', label: 'مقطع/پایه', type: 'text' }, { name: 'weekly_hours', label: 'ساعت هفتگی پیش‌فرض', type: 'number', min: 1, max: 20 }, { name: 'coefficient', label: 'ضریب درس (برای معدل)', type: 'number', min: 1, max: 10 }, { name: 'description', label: 'توضیحات', type: 'textarea' }],
      columns: [{ key: 'name', label: 'درس', sortKey: 't.name' }, { key: 'code', label: 'کد' }, { key: 'grade_level', label: 'مقطع' }, { key: 'weekly_hours', label: 'ساعت هفتگی', type: 'number', sortKey: 't.weekly_hours' }, { key: 'coefficient', label: 'ضریب', type: 'number' }],
      beforeDelete: async (row) => { const n = await k0()('class_subjects').where({ subject_id: row.id }).first(); return n ? 'این درس به کلاس‌ها تخصیص داده شده است؛ ابتدا از کلاس‌ها حذفش کنید.' : null; },
    },
    {
      key: 'academic-years', module: 'classes', table: 'academic_years', title: 'سال‌های تحصیلی', singular: 'سال تحصیلی', icon: 'calendar-days', read: STAFF, write: STAFF, labelField: 'title',
      orderBy: [['t.id', 'desc']], csv: false,
      fields: [{ name: 'title', label: 'عنوان (مثلاً ۱۴۰۵-۱۴۰۶)', type: 'text', required: true }, { name: 'start_date', label: 'تاریخ شروع', type: 'date' }, { name: 'end_date', label: 'تاریخ پایان', type: 'date' }, { name: 'is_current', label: 'سال تحصیلی جاری', type: 'checkbox' }, { name: 'notes', label: 'توضیحات', type: 'textarea' }],
      columns: [{ key: 'title', label: 'سال' }, { key: 'start_date', label: 'شروع', type: 'date' }, { key: 'end_date', label: 'پایان', type: 'date' }, { key: 'is_current', label: 'جاری', type: 'bool' }],
      validate: async (d, req, existing) => {
        if (d.start_date && d.end_date && d.start_date > d.end_date) return 'تاریخ پایان باید بعد از شروع باشد.';
        if (!d.is_current) { // همیشه باید یک سال جاری وجود داشته باشد
          const other = await k0()('academic_years').where({ is_current: 1 }).modify((b) => { if (existing) b.whereNot('id', existing.id); }).first();
          if (!other) { if (existing) return 'باید همیشه یک سال تحصیلی جاری وجود داشته باشد؛ برای تغییر، سال دیگری را «جاری» کنید.'; d.is_current = 1; }
        }
        return null;
      },
      afterSave: async (id, data) => { if (data.is_current) await k0()('academic_years').whereNot({ id }).update({ is_current: 0 }); },
      beforeDelete: async (row) => { if (row.is_current) return 'سال تحصیلی جاری قابل حذف نیست.'; const n = await k0()('classrooms').where({ academic_year_id: row.id }).first(); return n ? 'کلاس‌هایی به این سال تحصیلی وابسته‌اند.' : null; },
    },
    {
      key: 'announcements', module: 'announcements', table: 'announcements', title: 'اطلاعیه‌ها', singular: 'اطلاعیه', icon: 'megaphone', read: ALL, write: STAFF_T, createdBy: 'created_by', labelField: 'title', csv: false,
      base: (k) => k('announcements as t').leftJoin('classrooms as c', 'c.id', 't.classroom_id').leftJoin('users as u', 'u.id', 't.created_by').select('t.*', 'c.name as class_name', 'u.full_name as author'),
      scope: async (req, qb) => { if (isMgr(req.user)) return; const ids = await svc.accessibleClassIds(req.user); svc.audienceFilter(qb, req.user, ids); qb.where((b) => b.whereNull('t.expires_on').orWhere('t.expires_on', '>=', J.todayISO())); if (req.method !== 'GET' && req.user.role === 'teacher') qb.where('t.created_by', req.user.id); },
      orderBy: [['t.pinned', 'desc'], ['t.id', 'desc']], search: ['t.title', 't.body'],
      filters: [{ name: 'audience', label: 'مخاطب', column: 't.audience', options: pairs(L.audience) }],
      canEdit: (req, r) => isMgr(req.user) || r.created_by === req.user.id,
      fields: [{ name: 'title', label: 'عنوان', type: 'text', required: true, maxlength: 200 },
        { name: 'audience', label: 'مخاطب', type: 'select', required: true, optionsFn: async (k, req) => (isMgr(req.user) ? pairs(L.audience) : [['class', L.audience.class]]) },
        { name: 'classroom_id', label: 'کلاس (برای مخاطب «یک کلاس»)', type: 'select', optionsFn: classOptions },
        { name: 'expires_on', label: 'تاریخ انقضا (اختیاری)', type: 'date' },
        { name: 'pinned', label: 'سنجاق‌شده (بالای لیست)', type: 'checkbox' },
        { name: 'body', label: 'متن اطلاعیه', type: 'textarea', required: true }],
      defaults: () => ({ audience: 'all' }),
      validate: async (d, req) => {
        if (d.audience === 'class' && !d.classroom_id) return 'برای مخاطب «یک کلاس»، کلاس را انتخاب کنید.';
        if (d.audience !== 'class') d.classroom_id = null;
        if (!isMgr(req.user)) { const ids = await svc.accessibleClassIds(req.user); if (d.audience !== 'class' || !ids.includes(Number(d.classroom_id))) return 'شما فقط می‌توانید برای کلاس‌های خودتان اطلاعیه ثبت کنید.'; d.pinned = 0; }
      },
      afterSave: async (id, d, req, isNew) => {
        if (!isNew) return;
        const k = k0(); let q = k('users').where({ active: 1 }).whereNot('id', req.user.id);
        if (d.audience === 'teachers') q = q.where({ role: 'teacher' });
        else if (d.audience === 'students') q = q.where({ role: 'student' });
        else if (d.audience === 'class') q = q.where({ role: 'student' }).whereIn('id', k('students').where({ classroom_id: d.classroom_id }).select('user_id'));
        const ids = (await q.select('id')).map((x) => x.id);
        await svc.notify(ids, 'اطلاعیه جدید: ' + d.title, String(d.body).slice(0, 150), '/announcements');
      },
      columns: [{ key: 'title', label: 'عنوان', html: (r, h) => `<b>${h.esc(r.title)}</b>${r.pinned ? ' <span class="badge amber">سنجاق</span>' : ''}<div class="muted small">${h.esc(String(r.body).slice(0, 90))}${String(r.body).length > 90 ? '…' : ''}</div>` },
        { key: 'audience', label: 'مخاطب', html: (r, h) => h.esc(L.audience[r.audience]) + (r.class_name ? ` (${h.esc(r.class_name)})` : '') }, { key: 'author', label: 'ارسال‌کننده' }, { key: 'created_at', label: 'تاریخ', type: 'date' }],
    },
    {
      key: 'events', module: 'calendar', table: 'events', title: 'رویدادها', singular: 'رویداد', icon: 'flag', read: STAFF, write: STAFF, createdBy: 'created_by', labelField: 'title',
      orderBy: [['t.start_date', 'desc']], search: ['t.title', 't.location'], filters: [{ name: 'type', label: 'نوع', column: 't.type', options: pairs(L.eventType) }],
      fields: [{ name: 'title', label: 'عنوان', type: 'text', required: true }, { name: 'type', label: 'نوع', type: 'select', required: true, options: pairs(L.eventType) }, { name: 'start_date', label: 'تاریخ شروع', type: 'date', required: true }, { name: 'end_date', label: 'تاریخ پایان', type: 'date' }, { name: 'start_time', label: 'ساعت', type: 'time' }, { name: 'audience', label: 'مخاطب', type: 'select', required: true, options: [['all', 'همه'], ['teachers', 'معلمان'], ['students', 'دانش‌آموزان']] }, { name: 'location', label: 'مکان', type: 'text' }, { name: 'description', label: 'توضیحات', type: 'textarea' }],
      defaults: () => ({ type: 'event', audience: 'all' }),
      validate: (d) => (d.end_date && d.end_date < d.start_date ? 'تاریخ پایان نباید قبل از شروع باشد.' : null),
      columns: [{ key: 'title', label: 'عنوان' }, { key: 'type', label: 'نوع', type: 'badge', labels: L.eventType }, { key: 'start_date', label: 'شروع', type: 'date', sortKey: 't.start_date' }, { key: 'end_date', label: 'پایان', type: 'date' }, { key: 'location', label: 'مکان' }],
      sortable: ['t.start_date'], headActions: [{ href: '/calendar', label: 'نمای تقویم', icon: 'calendar-days' }],
    },
    {
      key: 'exams', module: 'exams', table: 'exam_schedule', title: 'برنامه امتحانات', singular: 'امتحان', icon: 'clipboard-list', read: ALL, write: STAFF, labelField: 'type',
      base: (k) => k('exam_schedule as t').join('subjects as s', 's.id', 't.subject_id').join('classrooms as c', 'c.id', 't.classroom_id').select('t.*', 's.name as subject_name', 'c.name as class_name'),
      scope: async (req, qb) => { const ids = await svc.accessibleClassIds(req.user); if (ids) qb.whereIn('t.classroom_id', ids.length ? ids : [0]); },
      orderBy: [['t.exam_date', 'asc']], sortable: ['t.exam_date'], search: ['s.name', 'c.name'],
      filters: [{ name: 'classroom_id', label: 'کلاس', column: 't.classroom_id', optionsFn: async (k, req) => (await k('classrooms').orderBy('name').select('id', 'name')).map((c) => [c.id, c.name]) }, { name: 'type', label: 'نوع', column: 't.type', options: pairs(L.examType) }],
      fields: [{ name: 'classroom_id', label: 'کلاس', type: 'select', required: true, optionsFn: async (k) => (await k('classrooms').orderBy('name').select('id', 'name')).map((c) => [c.id, c.name]) },
        { name: 'subject_id', label: 'درس', type: 'select', required: true, optionsFn: async (k) => (await k('subjects').orderBy('name').select('id', 'name')).map((c) => [c.id, c.name]) },
        { name: 'exam_date', label: 'تاریخ امتحان', type: 'date', required: true }, { name: 'start_time', label: 'ساعت شروع', type: 'time' }, { name: 'duration', label: 'مدت (دقیقه)', type: 'number', min: 5, max: 300 },
        { name: 'type', label: 'نوع', type: 'select', required: true, options: pairs(L.examType) }, { name: 'location', label: 'مکان', type: 'text' }, { name: 'notes', label: 'توضیحات', type: 'textarea' }],
      defaults: () => ({ type: 'midterm', duration: 60 }),
      validate: async (d, req, existing) => {
        const inClass = await k0()('class_subjects').where({ classroom_id: d.classroom_id, subject_id: d.subject_id }).first();
        if (!inClass) return 'این درس در فهرست دروس کلاس انتخاب‌شده تعریف نشده است.';
        const q = k0()('exam_schedule').where({ classroom_id: d.classroom_id, exam_date: d.exam_date }).modify((b) => { if (existing) b.whereNot('id', existing.id); });
        const same = await q.clone().where({ subject_id: d.subject_id, type: d.type }).first(); if (same) return 'این امتحان برای این کلاس و تاریخ قبلاً ثبت شده است.';
        if (d.start_time) { const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }; const a0 = toMin(d.start_time); const a1 = a0 + (d.duration || 60); for (const e of await q.clone().whereNotNull('start_time')) { const b0 = toMin(e.start_time); const b1 = b0 + (e.duration || 60); if (a0 < b1 && b0 < a1) return 'زمان این امتحان با امتحان دیگری از همین کلاس در همان روز تداخل دارد.'; } }
      },
      afterSave: async (id, d, req, isNew) => {
        if (!isNew) return; const us = await k0()('students').where({ classroom_id: d.classroom_id, status: 'active' }).select('user_id'); const sub = await k0()('subjects').where({ id: d.subject_id }).first();
        await svc.notify(us.map((x) => x.user_id), `امتحان ${sub.name} ثبت شد`, `تاریخ: ${J.isoToJString(d.exam_date)} ${d.start_time || ''}`, '/exams');
      },
      columns: [{ key: 'exam_date', label: 'تاریخ', type: 'date', sortKey: 't.exam_date' }, { key: 'subject_name', label: 'درس' }, { key: 'class_name', label: 'کلاس' }, { key: 'start_time', label: 'ساعت', html: (r, h) => h.fa(r.start_time || '—') }, { key: 'duration', label: 'مدت (دقیقه)', type: 'number' }, { key: 'type', label: 'نوع', type: 'badge', labels: L.examType }, { key: 'location', label: 'مکان' }],
      headActions: [],
    },
    {
      key: 'discipline', module: 'discipline', table: 'discipline_records', title: 'انضباطی و رفتار', singular: 'مورد', icon: 'gavel', read: ALL, write: STAFF_T, labelField: 'title',
      base: studentBase('discipline_records'), scope: ownStudentScope, createdBy: 'recorded_by',
      orderBy: [['t.record_date', 'desc']], sortable: ['t.record_date', 't.points'], search: ['t.title', 's.first_name', 's.last_name'],
      filters: [{ name: 'type', label: 'نوع', column: 't.type', options: pairs(L.disciplineType) }],
      canEdit: (req, r) => isMgr(req.user) || r.recorded_by === req.user.id,
      fields: [{ name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, optionsFn: studentOptions }, { name: 'type', label: 'نوع', type: 'select', required: true, options: pairs(L.disciplineType) },
        { name: 'title', label: 'عنوان', type: 'text', required: true }, { name: 'points', label: 'امتیاز (مثبت/منفی، −۲۰ تا ۲۰)', type: 'number', min: -20, max: 20 }, { name: 'record_date', label: 'تاریخ', type: 'date', required: true },
        { name: 'action_taken', label: 'اقدام انجام‌شده', type: 'text' }, { name: 'description', label: 'شرح', type: 'textarea' }],
      defaults: () => ({ type: 'negative', record_date: J.isoToJString(J.todayISO()), points: -1 }),
      validate: async (d, req) => { if (d.type === 'positive' && d.points < 0) d.points = Math.abs(d.points || 0); if (d.type === 'negative' && d.points > 0) d.points = -d.points; if (d.points === null) d.points = 0; if (req.user.role === 'teacher') { const opts = await studentOptions(k0(), req); if (!opts.find((o) => String(o[0]) === String(d.student_id))) return 'این دانش‌آموز در کلاس‌های شما نیست.'; } },
      afterSave: async (id, d, req, isNew) => { if (!isNew) return; const s = await k0()('students').where({ id: d.student_id }).first(); await svc.notify(s.user_id, d.type === 'positive' ? 'مورد تشویقی در پرونده شما ثبت شد' : 'مورد انضباطی در پرونده شما ثبت شد', d.title, '/discipline', d.type === 'positive' ? 'success' : 'warn'); },
      columns: [studentLink, { key: 'type', label: 'نوع', type: 'badge', labels: L.disciplineType, colors: { positive: 'green', negative: 'red' } }, { key: 'title', label: 'عنوان' }, { key: 'points', label: 'امتیاز', html: (r, h) => h.fa((r.points > 0 ? '+' : '') + (r.points || 0)) }, { key: 'record_date', label: 'تاریخ', type: 'date', sortKey: 't.record_date' }, { key: 'action_taken', label: 'اقدام' }],
    },
    {
      key: 'health', module: 'health', table: 'health_records', title: 'بهداشت و سلامت', singular: 'سابقه', icon: 'heart-pulse', read: STAFF, write: STAFF, labelField: 'description', createdBy: 'recorded_by',
      base: studentBase('health_records'), orderBy: [['t.record_date', 'desc']], search: ['t.description', 's.first_name', 's.last_name'], filters: [{ name: 'type', label: 'نوع', column: 't.type', options: pairs(L.healthType) }],
      fields: [{ name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, optionsFn: studentOptions }, { name: 'record_date', label: 'تاریخ', type: 'date', required: true }, { name: 'type', label: 'نوع', type: 'select', required: true, options: pairs(L.healthType) }, { name: 'description', label: 'شرح', type: 'textarea', required: true }, { name: 'action_taken', label: 'اقدام انجام‌شده', type: 'textarea' }, { name: 'parent_informed', label: 'اولیا مطلع شدند', type: 'checkbox' }],
      defaults: () => ({ type: 'visit', record_date: J.isoToJString(J.todayISO()) }),
      columns: [studentLink, { key: 'type', label: 'نوع', type: 'badge', labels: L.healthType }, { key: 'description', label: 'شرح', type: 'trunc' }, { key: 'parent_informed', label: 'اطلاع اولیا', type: 'bool' }, { key: 'record_date', label: 'تاریخ', type: 'date' }],
    },
    {
      key: 'meetings', module: 'meetings', table: 'meetings', title: 'جلسات اولیا', singular: 'جلسه', icon: 'users-round', read: ALL, write: STAFF_T, createdBy: 'created_by', labelField: 'purpose',
      base: studentBase('meetings'), scope: ownStudentScope, orderBy: [['t.meeting_date', 'desc']], sortable: ['t.meeting_date'], search: ['t.purpose', 's.first_name', 's.last_name'], filters: [{ name: 'status', label: 'وضعیت', column: 't.status', options: pairs(L.meetingStatus) }],
      canEdit: (req, r) => isMgr(req.user) || r.created_by === req.user.id,
      fields: [{ name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, optionsFn: studentOptions }, { name: 'meeting_date', label: 'تاریخ جلسه', type: 'date', required: true }, { name: 'meeting_time', label: 'ساعت', type: 'time' }, { name: 'with_whom', label: 'با (معلم/مسئول)', type: 'text' }, { name: 'purpose', label: 'موضوع', type: 'text', required: true }, { name: 'status', label: 'وضعیت', type: 'select', required: true, options: pairs(L.meetingStatus) }, { name: 'minutes', label: 'صورت‌جلسه / نتیجه', type: 'textarea' }],
      defaults: (req) => ({ status: 'scheduled', meeting_date: J.isoToJString(J.addDays(J.todayISO(), 3)), with_whom: req.user.full_name }),
      afterSave: async (id, d, req, isNew) => { if (!isNew) return; const s = await k0()('students').where({ id: d.student_id }).first(); await svc.notify(s.user_id, 'جلسه اولیا برنامه‌ریزی شد', `${J.isoToJString(d.meeting_date)} ${d.meeting_time || ''} — ${d.purpose}`, '/meetings'); },
      columns: [studentLink, { key: 'meeting_date', label: 'تاریخ', html: (r, h) => h.d(r.meeting_date) + ' ' + h.fa(r.meeting_time || ''), sortKey: 't.meeting_date' }, { key: 'purpose', label: 'موضوع', type: 'trunc' }, { key: 'with_whom', label: 'با' }, { key: 'status', label: 'وضعیت', type: 'badge', labels: L.meetingStatus, colors: { held: 'green', scheduled: 'blue', cancelled: 'gray', missed: 'red' } }],
    },
    {
      key: 'transport', module: 'transport', table: 'bus_routes', title: 'سرویس مدرسه', singular: 'مسیر', icon: 'bus', read: STAFF, write: STAFF,
      base: (k) => k('bus_routes as t').select('t.*', k.raw('(select count(*) from students s where s.route_id = t.id) as riders')),
      search: ['t.name', 't.driver_name', 't.plate'], orderBy: [['t.name', 'asc']],
      fields: [{ name: 'name', label: 'نام مسیر', type: 'text', required: true }, { name: 'driver_name', label: 'نام راننده', type: 'text' }, { name: 'driver_phone', label: 'تلفن راننده', type: 'tel' }, { name: 'plate', label: 'پلاک', type: 'text' }, { name: 'capacity', label: 'ظرفیت', type: 'number', min: 1, max: 100 }, { name: 'monthly_fee', label: 'شهریه ماهانه', type: 'number', min: 0 }, { name: 'stops', label: 'ایستگاه‌ها', type: 'textarea' }],
      columns: [{ key: 'name', label: 'مسیر' }, { key: 'driver_name', label: 'راننده' }, { key: 'driver_phone', label: 'تلفن', html: (r, h) => `<span class="ltr">${h.fa(r.driver_phone || '—')}</span>` }, { key: 'plate', label: 'پلاک' }, { key: 'riders', label: 'سرنشین', html: (r, h) => h.fa(r.riders) + ' / ' + h.fa(r.capacity) }, { key: 'monthly_fee', label: 'شهریه ماهانه', type: 'money' }],
      beforeDelete: async (row) => { const n = await k0()('students').where({ route_id: row.id }).first(); return n ? 'دانش‌آموزانی به این مسیر تخصیص داده شده‌اند.' : null; },
    },
    {
      key: 'library/books', module: 'library', table: 'books', title: 'کتاب‌های کتابخانه', singular: 'کتاب', icon: 'library-big', read: ALL, write: STAFF, labelField: 'title',
      base: (k) => k('books as t').select('t.*', k.raw('(select count(*) from book_loans l where l.book_id = t.id and l.returned_at is null) as lent')),
      search: ['t.title', 't.author', 't.isbn', 't.category'], orderBy: [['t.title', 'asc']], sortable: ['t.title', 't.author'],
      filters: [{ name: 'category', label: 'دسته', column: 't.category', optionsFn: async (k) => (await k('books').distinct('category').whereNotNull('category')).map((c) => [c.category, c.category]) }],
      fields: [{ name: 'title', label: 'عنوان کتاب', type: 'text', required: true }, { name: 'author', label: 'نویسنده', type: 'text' }, { name: 'category', label: 'دسته‌بندی', type: 'text' }, { name: 'publisher', label: 'ناشر', type: 'text' }, { name: 'isbn', label: 'شابک', type: 'text', ltr: true }, { name: 'copies', label: 'تعداد نسخه', type: 'number', required: true, min: 1, max: 1000 }, { name: 'shelf', label: 'قفسه', type: 'text' }, { name: 'description', label: 'توضیحات', type: 'textarea' }],
      defaults: () => ({ copies: 1 }),
      columns: [{ key: 'title', label: 'عنوان', sortKey: 't.title' }, { key: 'author', label: 'نویسنده', sortKey: 't.author' }, { key: 'category', label: 'دسته' }, { key: 'shelf', label: 'قفسه' }, { key: 'copies', label: 'موجودی', html: (r, h) => { const av = r.copies - r.lent; return `<span class="badge ${av > 0 ? 'green' : 'red'}">${h.fa(av)} از ${h.fa(r.copies)}</span>`; } }],
      validate: async (d, req, ex) => { if (ex) { const lent = Number((await k0()('book_loans').where({ book_id: ex.id }).whereNull('returned_at').count({ c: '*' }).first()).c); if (d.copies < lent) return `${lent} نسخه در امانت است؛ تعداد نسخه نمی‌تواند کمتر باشد.`; } },
      beforeDelete: async (row) => { const n = await k0()('book_loans').where({ book_id: row.id }).first(); return n ? 'برای این کتاب سابقه امانت وجود دارد؛ حذف ممکن نیست.' : null; },
      headActions: [{ href: '/library/loans', label: 'امانت‌ها', icon: 'book-marked', roles: ALL }],
    },
  ];
}

function mountAll(router) {
  const db = require('./db');
  const wrapper = { use: (...a) => router.use(...a) };
  for (const d of defs(db)) crud.mount(wrapper, d);
}
module.exports = { mountAll, studentOptions };

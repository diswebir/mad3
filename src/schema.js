'use strict';
/**
 * ساختار پایگاه داده (سازگار با SQLite و MySQL). برای سازگاری حداکثری از کلید خارجی استفاده نشده و
 * یکپارچگی داده در لایه برنامه تضمین می‌شود؛ ایندکس‌ها برای کوئری‌های پرتکرار تعریف شده‌اند.
 */
async function createSchema(db) {
  const has = (t) => db.schema.hasTable(t);
  const isMysql = /mysql/.test(String(db.client.config.client));
  const make = async (name, cb) => { if (!(await has(name))) await db.schema.createTable(name, (t) => { if (isMysql) { t.charset('utf8mb4'); t.collate('utf8mb4_unicode_ci'); } cb(t); }); };
  const ts = (t) => { t.dateTime('created_at').defaultTo(db.fn.now()); };

  await make('settings', (t) => { t.string('key', 100).primary(); t.text('value'); });
  await make('modules_state', (t) => { t.string('key', 60).primary(); t.boolean('enabled').notNullable().defaultTo(true); });
  await make('sessions', (t) => { t.string('sid', 128).primary(); t.text('sess').notNullable(); t.bigInteger('expires_at').notNullable().index(); });

  await make('users', (t) => {
    t.increments('id');
    t.string('username', 80).notNullable().unique();
    t.string('password_hash', 120).notNullable();
    t.string('role', 20).notNullable().index(); // admin | deputy | teacher | student
    t.string('full_name', 150).notNullable();
    t.string('email', 150);
    t.string('phone', 30);
    t.string('avatar', 200);
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.string('last_login', 30);
    t.string('last_ip', 60);
    ts(t);
  });

  await make('academic_years', (t) => {
    t.increments('id'); t.string('title', 60).notNullable(); t.string('start_date', 10); t.string('end_date', 10);
    t.boolean('is_current').notNullable().defaultTo(false); t.text('notes'); ts(t);
  });
  await make('subjects', (t) => {
    t.increments('id'); t.string('name', 100).notNullable(); t.string('code', 30); t.string('grade_level', 40);
    t.integer('weekly_hours').defaultTo(2); t.integer('coefficient').defaultTo(1); t.text('description'); ts(t);
  });
  await make('teachers', (t) => {
    t.increments('id'); t.integer('user_id').notNullable().unique();
    t.string('personnel_code', 30); t.string('national_id', 20); t.string('gender', 10);
    t.string('birth_date', 10); t.string('specialty', 100); t.string('degree', 60); t.string('hire_date', 10);
    t.string('employment_type', 40); t.string('emergency_phone', 30); t.text('address'); t.text('bio');
    t.string('status', 20).notNullable().defaultTo('active'); ts(t);
  });
  await make('classrooms', (t) => {
    t.increments('id'); t.string('name', 100).notNullable(); t.string('grade_level', 40); t.string('section', 20);
    t.integer('capacity').defaultTo(30); t.string('room_no', 30); t.integer('academic_year_id').index();
    t.integer('homeroom_teacher_id').index(); t.text('notes'); ts(t);
  });
  await make('class_subjects', (t) => {
    t.increments('id'); t.integer('classroom_id').notNullable().index(); t.integer('subject_id').notNullable();
    t.integer('teacher_id').index(); t.integer('weekly_hours').defaultTo(2); t.unique(['classroom_id', 'subject_id']);
  });
  await make('students', (t) => {
    t.increments('id'); t.integer('user_id').notNullable().unique();
    t.string('student_code', 30).notNullable().unique(); t.string('first_name', 80).notNullable(); t.string('last_name', 80).notNullable();
    t.string('national_id', 20).index(); t.string('gender', 10); t.string('birth_date', 10); t.string('birth_place', 80);
    t.string('religion', 40); t.string('nationality', 40).defaultTo('ایرانی'); t.string('blood_type', 6);
    t.integer('classroom_id').index(); t.integer('route_id'); t.string('enrollment_date', 10); t.string('previous_school', 150);
    t.string('status', 20).notNullable().defaultTo('active').index(); t.string('photo', 200);
    t.text('address'); t.string('postal_code', 20); t.string('home_phone', 30); t.string('mobile', 30);
    t.string('father_name', 100); t.string('father_job', 100); t.string('father_phone', 30); t.string('father_national_id', 20); t.string('father_education', 60);
    t.string('mother_name', 100); t.string('mother_job', 100); t.string('mother_phone', 30); t.string('mother_national_id', 20); t.string('mother_education', 60);
    t.string('guardian_name', 100); t.string('guardian_relation', 40); t.string('guardian_phone', 30);
    t.string('emergency_contact', 100); t.string('emergency_phone', 30);
    t.integer('siblings_count'); t.string('family_status', 60);
    t.text('allergies'); t.text('chronic_disease'); t.text('medications'); t.string('insurance', 100); t.text('special_needs');
    t.text('notes'); ts(t);
  });
  await make('student_documents', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('title', 150).notNullable(); t.string('category', 60);
    t.string('file_name', 200).notNullable(); t.string('original_name', 200); t.integer('size'); t.integer('uploaded_by'); ts(t);
  });
  await make('student_notes', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.integer('author_id'); t.text('body').notNullable();
    t.boolean('private').notNullable().defaultTo(true); ts(t);
  });
  await make('attendance', (t) => {
    t.increments('id'); t.integer('student_id').notNullable(); t.integer('classroom_id').notNullable().index();
    t.string('date', 10).notNullable(); t.integer('period').notNullable().defaultTo(0); t.string('status', 12).notNullable();
    t.string('note', 250); t.integer('recorded_by'); t.string('updated_at', 30);
    t.unique(['student_id', 'date', 'period']); t.index(['classroom_id', 'date']); t.index(['date']);
  });
  await make('tickets', (t) => {
    t.increments('id'); t.string('subject', 200).notNullable(); t.string('category', 40).notNullable().defaultTo('general');
    t.string('priority', 12).notNullable().defaultTo('normal'); t.string('status', 12).notNullable().defaultTo('open').index();
    t.integer('created_by').notNullable().index(); t.integer('recipient_user_id').index(); t.string('recipient_role', 20);
    t.integer('student_id').index(); t.string('related_date', 10); t.integer('rating'); t.text('rating_comment');
    t.string('updated_at', 30); t.string('closed_at', 30); t.boolean('justified').defaultTo(false); ts(t);
  });
  await make('ticket_messages', (t) => {
    t.increments('id'); t.integer('ticket_id').notNullable().index(); t.integer('user_id').notNullable();
    t.text('body').notNullable(); t.string('attachment', 200); t.string('attachment_name', 200);
    t.boolean('internal').notNullable().defaultTo(false); ts(t);
  });
  await make('assessments', (t) => {
    t.increments('id'); t.integer('class_subject_id').notNullable().index(); t.string('title', 150).notNullable();
    t.string('type', 20).notNullable().defaultTo('quiz'); t.decimal('max_score', 6, 2).notNullable().defaultTo(20);
    t.decimal('weight', 6, 2).notNullable().defaultTo(1); t.string('date', 10); t.integer('term').defaultTo(1);
    t.boolean('published').notNullable().defaultTo(false); t.integer('created_by'); ts(t);
  });
  await make('scores', (t) => {
    t.increments('id'); t.integer('assessment_id').notNullable(); t.integer('student_id').notNullable().index();
    t.decimal('score', 6, 2); t.string('note', 250); t.unique(['assessment_id', 'student_id']);
  });
  await make('homework', (t) => {
    t.increments('id'); t.integer('class_subject_id').notNullable().index(); t.string('title', 200).notNullable();
    t.text('description'); t.string('due_date', 10); t.string('attachment', 200); t.string('attachment_name', 200);
    t.integer('max_score').defaultTo(20); t.integer('created_by'); ts(t);
  });
  await make('homework_submissions', (t) => {
    t.increments('id'); t.integer('homework_id').notNullable().index(); t.integer('student_id').notNullable().index();
    t.text('answer'); t.string('file', 200); t.string('file_name', 200); t.string('submitted_at', 30);
    t.boolean('late').defaultTo(false); t.decimal('score', 6, 2); t.text('feedback'); t.unique(['homework_id', 'student_id']);
  });
  await make('timetable', (t) => {
    t.increments('id'); t.integer('classroom_id').notNullable(); t.integer('day').notNullable(); t.integer('period').notNullable();
    t.integer('class_subject_id').notNullable(); t.unique(['classroom_id', 'day', 'period']);
  });
  await make('exam_schedule', (t) => {
    t.increments('id'); t.integer('classroom_id').notNullable().index(); t.integer('subject_id').notNullable();
    t.string('exam_date', 10).notNullable().index(); t.string('start_time', 5); t.integer('duration').defaultTo(60);
    t.string('location', 80); t.string('type', 20).defaultTo('midterm'); t.text('notes'); ts(t);
  });
  await make('announcements', (t) => {
    t.increments('id'); t.string('title', 200).notNullable(); t.text('body').notNullable();
    t.string('audience', 20).notNullable().defaultTo('all'); t.integer('classroom_id'); t.boolean('pinned').notNullable().defaultTo(false);
    t.string('expires_on', 10); t.integer('created_by'); ts(t);
  });
  await make('events', (t) => {
    t.increments('id'); t.string('title', 200).notNullable(); t.text('description'); t.string('start_date', 10).notNullable().index();
    t.string('end_date', 10); t.string('start_time', 5); t.string('type', 20).defaultTo('event'); t.string('audience', 20).defaultTo('all');
    t.string('location', 100); t.integer('created_by'); ts(t);
  });
  await make('notifications', (t) => {
    t.increments('id'); t.integer('user_id').notNullable(); t.string('title', 200).notNullable(); t.text('body');
    t.string('link', 200); t.string('type', 20).defaultTo('info'); t.boolean('is_read').notNullable().defaultTo(false); ts(t);
    t.index(['user_id', 'is_read']);
  });
  await make('discipline_records', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('type', 12).notNullable().defaultTo('negative');
    t.string('title', 200).notNullable(); t.text('description'); t.integer('points').defaultTo(0); t.string('record_date', 10);
    t.string('action_taken', 200); t.integer('recorded_by'); ts(t);
  });
  await make('health_records', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('record_date', 10); t.string('type', 30);
    t.text('description').notNullable(); t.text('action_taken'); t.boolean('parent_informed').defaultTo(false); t.integer('recorded_by'); ts(t);
  });
  await make('meetings', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('meeting_date', 10).notNullable(); t.string('meeting_time', 5);
    t.string('with_whom', 100); t.string('purpose', 250); t.text('minutes'); t.string('status', 20).defaultTo('scheduled'); t.integer('created_by'); ts(t);
  });
  await make('fees', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('title', 150).notNullable(); t.bigInteger('amount').notNullable();
    t.bigInteger('discount').defaultTo(0); t.string('due_date', 10); t.string('category', 40).defaultTo('tuition');
    t.integer('academic_year_id'); t.text('notes'); ts(t);
  });
  await make('payments', (t) => {
    t.increments('id'); t.integer('fee_id').notNullable().index(); t.bigInteger('amount').notNullable(); t.string('paid_at', 10);
    t.string('method', 20).defaultTo('cash'); t.string('reference', 60); t.integer('recorded_by'); ts(t);
  });
  await make('books', (t) => {
    t.increments('id'); t.string('title', 200).notNullable(); t.string('author', 120); t.string('isbn', 30); t.string('category', 60);
    t.string('publisher', 100); t.integer('copies').notNullable().defaultTo(1); t.string('shelf', 30); t.text('description'); ts(t);
  });
  await make('book_loans', (t) => {
    t.increments('id'); t.integer('book_id').notNullable().index(); t.integer('student_id').index(); t.integer('teacher_id');
    t.string('loan_date', 10).notNullable(); t.string('due_date', 10).notNullable(); t.string('returned_at', 10); t.integer('recorded_by'); ts(t);
  });
  await make('bus_routes', (t) => {
    t.increments('id'); t.string('name', 100).notNullable(); t.string('driver_name', 100); t.string('driver_phone', 30);
    t.string('plate', 30); t.integer('capacity').defaultTo(20); t.bigInteger('monthly_fee').defaultTo(0); t.text('stops'); ts(t);
  });
  await make('audit_logs', (t) => {
    t.increments('id'); t.integer('user_id').index(); t.string('user_name', 150); t.string('action', 40).notNullable(); t.string('entity', 40);
    t.string('entity_id', 30); t.text('details'); t.string('ip', 60); ts(t); t.index(['created_at']);
  });
  /* ===== نسخه ۲: ستون‌ها و جدول‌های تازه (idempotent؛ برای نصب‌های قدیمی هم اجرا می‌شود) ===== */
  const addCol = async (table, col, cb) => { if (!(await db.schema.hasColumn(table, col))) await db.schema.alterTable(table, (t) => cb(t)); };
  await addCol('users', 'permissions', (t) => t.text('permissions'));
  await addCol('users', 'title', (t) => t.string('title', 80));
  await addCol('classrooms', 'status', (t) => t.string('status', 12).notNullable().defaultTo('active'));
  await addCol('attendance', 'arrival_time', (t) => t.string('arrival_time', 5));
  await addCol('tickets', 'escalated_at', (t) => t.string('escalated_at', 30));
  await addCol('payments', 'doc_no', (t) => t.string('doc_no', 20).index());
  await addCol('payments', 'voided', (t) => t.boolean('voided').notNullable().defaultTo(false));
  await addCol('payments', 'void_reason', (t) => t.string('void_reason', 250));
  await addCol('fees', 'discount_note', (t) => t.string('discount_note', 150));
  await addCol('teachers', 'weekly_load', (t) => t.integer('weekly_load'));

  await make('parent_students', (t) => {
    t.increments('id'); t.integer('user_id').notNullable().index(); t.integer('student_id').notNullable().index(); t.string('relation', 20).defaultTo('father'); ts(t);
    t.unique(['user_id', 'student_id']);
  });
  await make('sms_log', (t) => {
    t.increments('id'); t.string('to_number', 30).notNullable(); t.text('message').notNullable(); t.string('event', 30); t.string('status', 12).notNullable().defaultTo('queued').index();
    t.string('provider_ref', 60); t.string('error', 250); t.integer('student_id'); t.integer('created_by'); ts(t);
  });
  await make('message_templates', (t) => { t.increments('id'); t.string('title', 120).notNullable(); t.text('body').notNullable(); t.string('category', 30).defaultTo('general'); ts(t); });
  await make('group_messages', (t) => {
    t.increments('id'); t.string('title', 200).notNullable(); t.text('body').notNullable(); t.string('audience', 30).notNullable(); t.string('audience_label', 150);
    t.string('channels', 20).notNullable().defaultTo('app'); t.integer('recipients').defaultTo(0); t.integer('sms_count').defaultTo(0); t.integer('sent_by'); ts(t);
  });
  await make('student_year_records', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.integer('academic_year_id'); t.string('year_title', 60); t.string('classroom_name', 100); t.string('grade_level', 40);
    t.decimal('overall', 6, 2); t.integer('rank_no'); t.integer('ranked_count'); t.string('result', 20).notNullable().defaultTo('promoted');
    t.integer('absent_days').defaultTo(0); t.integer('late_count').defaultTo(0); t.integer('behavior_score'); t.text('notes'); ts(t);
    t.unique(['student_id', 'academic_year_id']);
  });
  await make('report_comments', (t) => {
    t.increments('id'); t.integer('student_id').notNullable(); t.integer('term').notNullable().defaultTo(0); t.text('comment'); t.integer('author_id'); ts(t);
    t.unique(['student_id', 'term']);
  });
  await make('fee_installments', (t) => {
    t.increments('id'); t.integer('fee_id').notNullable().index(); t.integer('seq').notNullable(); t.string('due_date', 10); t.bigInteger('amount').notNullable();
  });
  await make('teacher_unavailability', (t) => {
    t.increments('id'); t.integer('teacher_id').notNullable().index(); t.integer('day').notNullable(); t.integer('period').notNullable(); t.string('note', 150);
    t.unique(['teacher_id', 'day', 'period']);
  });
  await make('substitutions', (t) => {
    t.increments('id'); t.string('date', 10).notNullable().index(); t.integer('classroom_id').notNullable(); t.integer('period').notNullable(); t.integer('class_subject_id');
    t.integer('absent_teacher_id'); t.integer('substitute_teacher_id').notNullable(); t.string('note', 200); t.integer('created_by'); ts(t);
    t.unique(['date', 'classroom_id', 'period']);
  });
  await make('questions', (t) => {
    t.increments('id'); t.integer('subject_id').notNullable().index(); t.string('grade_level', 40); t.string('type', 12).notNullable().defaultTo('descriptive');
    t.text('text').notNullable(); t.text('options'); t.text('answer'); t.integer('difficulty').defaultTo(2); t.decimal('score', 6, 2).defaultTo(1); t.integer('created_by'); ts(t);
  });
  await make('exam_papers', (t) => {
    t.increments('id'); t.string('title', 200).notNullable(); t.integer('class_subject_id').notNullable().index(); t.string('exam_date', 10); t.integer('duration').defaultTo(60);
    t.text('instructions'); t.text('items'); t.integer('created_by'); ts(t);
  });
  await make('student_changes', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('field', 40).notNullable(); t.text('old_value'); t.text('new_value'); t.integer('user_id'); t.string('user_name', 150); ts(t);
  });
  await make('student_guardians', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('name', 120).notNullable(); t.string('relation', 40); t.string('phone', 30); t.string('national_id', 20);
    t.boolean('can_pickup').notNullable().defaultTo(true); t.boolean('is_legal').notNullable().defaultTo(false); t.string('notes', 250); ts(t);
  });
  await make('exit_permits', (t) => {
    t.increments('id'); t.integer('student_id').notNullable().index(); t.string('kind', 10).notNullable().defaultTo('exit'); t.string('permit_date', 10).notNullable(); t.string('permit_time', 5);
    t.string('reason', 250); t.string('picked_up_by', 120); t.integer('approved_by'); t.string('approved_name', 150); ts(t);
  });
  await make('teacher_leaves', (t) => {
    t.increments('id'); t.integer('teacher_id').notNullable().index(); t.string('kind', 20).notNullable().defaultTo('casual'); t.string('start_date', 10).notNullable(); t.string('end_date', 10).notNullable();
    t.integer('days').defaultTo(1); t.text('reason'); t.string('status', 12).notNullable().defaultTo('pending').index(); t.integer('decided_by'); t.string('decided_at', 30); t.string('decision_note', 250); ts(t);
  });
  await make('teacher_evaluations', (t) => {
    t.increments('id'); t.integer('teacher_id').notNullable().index(); t.string('eval_date', 10).notNullable(); t.integer('term').defaultTo(1); t.text('scores'); t.decimal('total', 6, 2);
    t.text('comment'); t.integer('evaluator_id'); ts(t);
  });

}

const TABLES = ['settings', 'modules_state', 'sessions', 'users', 'academic_years', 'subjects', 'teachers', 'classrooms', 'class_subjects', 'students', 'student_documents', 'student_notes', 'attendance', 'tickets', 'ticket_messages', 'assessments', 'scores', 'homework', 'homework_submissions', 'timetable', 'exam_schedule', 'announcements', 'events', 'notifications', 'discipline_records', 'health_records', 'meetings', 'fees', 'payments', 'books', 'book_loans', 'bus_routes', 'audit_logs', 'parent_students', 'sms_log', 'message_templates', 'group_messages', 'student_year_records', 'report_comments', 'fee_installments', 'teacher_unavailability', 'substitutions', 'questions', 'exam_papers', 'student_changes', 'student_guardians', 'exit_permits', 'teacher_leaves', 'teacher_evaluations'];
/** حذف جدول‌های ساخته‌شده توسط نصب ناقص (فقط در ویزارد نصب استفاده می‌شود) */
async function dropAll(db) { for (const t of TABLES) await db.schema.dropTableIfExists(t); }

module.exports = { createSchema, dropAll, TABLES };

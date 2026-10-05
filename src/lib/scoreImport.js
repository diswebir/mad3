'use strict';
/** تحلیل فایل نمرات (CSV/Excel): تشخیص ستون‌ها، اعتبارسنجی و تطبیق با دانش‌آموزان کلاس */
const FA = '۰۱۲۳۴۵۶۷۸۹'; const AR = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s === null || s === undefined ? '' : s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[٫,]/g, '.').replace(/[\u200c\u200f\u200e]/g, '').trim();
const norm = (s) => String(s || '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, '').toLowerCase();

/** rows: آرایه‌ی ردیف‌ها (ردیف اول عنوان است). students: [{id, student_code, first_name, last_name}] */
function analyze(rows, students, maxScore) {
  const byCode = Object.fromEntries(students.map((s) => [norm(s.student_code), s]));
  let codeCol = -1; let scoreCol = -1; let start = 0;
  const head = (rows[0] || []).map(norm);
  if (head.length) {
    codeCol = head.findIndex((h) => /کد|شماره|code|id/.test(h) && !/نمره/.test(h));
    scoreCol = head.findIndex((h) => /نمره|score|mark/.test(h));
    if (codeCol >= 0 || scoreCol >= 0) start = 1;
  }
  if (codeCol < 0) codeCol = 0;
  if (scoreCol < 0) scoreCol = head.length >= 3 ? head.length - 1 : 1;
  const seen = new Set(); const entries = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.every((c) => String(c || '').trim() === '')) continue;
    const code = latin(r[codeCol]); const rawScore = latin(r[scoreCol]);
    const e = { row: i + 1, code, rawScore, student: null, score: null, error: null };
    const st = byCode[norm(code)];
    if (!code) e.error = 'کد دانش‌آموزی خالی است';
    else if (!st) e.error = 'دانش‌آموزی با این کد در این کلاس نیست';
    else if (seen.has(st.id)) e.error = 'کد تکراری در فایل';
    else {
      e.student = st; seen.add(st.id);
      if (rawScore === '') e.score = null; // خالی = پاک‌کردن/بدون نمره
      else { const v = Number(rawScore); if (!Number.isFinite(v)) e.error = 'نمره عدد نیست'; else if (v < 0 || v > Number(maxScore)) e.error = `نمره باید بین ۰ و ${maxScore} باشد`; else e.score = Math.round(v * 100) / 100; }
    }
    entries.push(e);
  }
  const valid = entries.filter((e) => !e.error);
  return { entries, valid, errors: entries.filter((e) => e.error), codeCol, scoreCol, hasHeader: start === 1, missing: students.filter((s) => !seen.has(s.id)) };
}
module.exports = { analyze, latin };

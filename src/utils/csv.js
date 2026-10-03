'use strict';
/** تولید و خواندن CSV (با BOM تا در Excel فارسی درست باز شود) */
function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // جلوگیری از CSV injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(headers, rows) {
  const out = [headers.map(cell).join(',')];
  for (const r of rows) out.push(r.map(cell).join(','));
  return '\ufeff' + out.join('\r\n');
}
function parseCSV(text) {
  text = String(text).replace(/^\ufeff/, '');
  const rows = []; let row = []; let cur = ''; let q = false;
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
module.exports = { toCSV, parseCSV };

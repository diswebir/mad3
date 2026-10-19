'use strict';
/**
 * خواندن و نوشتن فایل Excel (xlsx) بدون وابستگی خارجی.
 * build(sheets) → Buffer ، parse(buffer) → { sheets: [{ name, rows }] }
 * فقط داده‌های متنی/عددی ساده پشتیبانی می‌شود (برای ورود/خروج اطلاعات مدرسه کافی است).
 */
const zlib = require('zlib');

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function zipStore(files) {
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function zipRead(buf, maxEntry = 30 * 1024 * 1024) {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('فایل Excel معتبر نیست (ساختار zip پیدا نشد).');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('فایل Excel آسیب‌دیده است.');
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const nl = buf.readUInt16LE(p + 28); const el = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32); const lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(lo + 26); const lel = buf.readUInt16LE(lo + 28); const start = lo + 30 + lnl + lel;
    const raw = buf.slice(start, start + csize);
    if (/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) {
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: maxEntry });
    }
    p += 46 + nl + el + cl;
  }
  return out;
}

function build(sheets) {
  const files = [];
  const list = sheets.map((s, i) => ({ ...s, id: i + 1, name: String(s.name || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) }));
  files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + list.map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
  files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + list.map((s) => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('') + '</sheets></workbook>' });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('') + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF9"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' });
  for (const s of list) {
    let rowsXml = '';
    (s.rows || []).forEach((row, ri) => {
      let cells = '';
      row.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const ref = colName(ci) + (ri + 1); const st = ri === 0 && s.header !== false ? ' s="1"' : '';
        if (typeof v === 'number' && isFinite(v)) cells += `<c r="${ref}"${st}><v>${v}</v></c>`;
        else cells += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      });
      rowsXml += `<row r="${ri + 1}">${cells}</row>`;
    });
    const maxCols = Math.max(1, ...(s.rows || []).map((r) => r.length));
    const cols = '<cols>' + Array.from({ length: maxCols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${(s.widths && s.widths[i]) || 18}" customWidth="1"/>`).join('') + '</cols>';
    files.push({ name: `xl/worksheets/sheet${s.id}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView ${s.rtl === false ? '' : 'rightToLeft="1" '}workbookViewId="0"/></sheetViews>${cols}<sheetData>${rowsXml}</sheetData></worksheet>` });
  }
  return zipStore(files);
}

const xmlUnesc = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, g) => (g === 'lt' ? '<' : g === 'gt' ? '>' : g === 'amp' ? '&' : g === 'quot' ? '"' : g === 'apos' ? "'" : g[1] === 'x' ? String.fromCodePoint(parseInt(g.slice(2), 16)) : String.fromCodePoint(parseInt(g.slice(1), 10))));
const textOf = (xml) => { let out = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += xmlUnesc(m[1]); return out; };

function parse(buf, { maxRows = 20000 } = {}) {
  const z = zipRead(buf);
  const wb = z['xl/workbook.xml']; if (!wb) throw new Error('فایل Excel معتبر نیست.');
  const rels = z['xl/_rels/workbook.xml.rels'] ? z['xl/_rels/workbook.xml.rels'].toString('utf8') : '';
  const shared = []; if (z['xl/sharedStrings.xml']) { const re = /<si>([\s\S]*?)<\/si>/g; const x = z['xl/sharedStrings.xml'].toString('utf8'); let m; while ((m = re.exec(x))) shared.push(textOf(m[1])); }
  const sheets = []; const re = /<sheet\s[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g; let m; const wbx = wb.toString('utf8');
  while ((m = re.exec(wbx))) {
    const rid = m[2]; const rm = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`).exec(rels); const tm = rm && /Target="([^"]+)"/.exec(rm[0]);
    let target = tm ? tm[1].replace(/^\//, '') : null; if (target && !target.startsWith('xl/')) target = 'xl/' + target;
    const sx = target && z[target]; if (!sx) continue;
    const rows = []; const rr = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let r; const x = sx.toString('utf8');
    while ((r = rr.exec(x))) {
      const row = []; const cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
      while ((c = cr.exec(r[1]))) {
        const attrs = c[1]; const ref = /r="([A-Z]+\d+)"/.exec(attrs); const t = /t="([^"]+)"/.exec(attrs); const body = c[2] || '';
        let val = '';
        if (t && t[1] === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(body); val = v ? shared[Number(v[1])] || '' : ''; }
        else if (t && t[1] === 'inlineStr') val = textOf(body);
        else { const v = /<v>([\s\S]*?)<\/v>/.exec(body); val = v ? xmlUnesc(v[1]) : ''; }
        const idx = ref ? colIndex(ref[1]) : row.length; while (row.length < idx) row.push(''); row[idx] = val;
      }
      rows.push(row); if (rows.length >= maxRows) break;
    }
    sheets.push({ name: xmlUnesc(m[1]), rows });
  }
  return { sheets };
}

/** پاسخ HTTP فایل xlsx */
function send(res, filename, sheets) {
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="${filename}"`).send(build(sheets));
}
module.exports = { build, parse, send, crc32 };

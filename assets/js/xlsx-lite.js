/* ============================================================
   xlsx-lite.js — tiny .xlsx editor used by Fill DepEd ECR and the
   DepEd Item Analysis export. Needs JSZip (assets/js/vendor/jszip.min.js).
   Only the parts that are written change; every other byte of the
   workbook stays as it was.
   ============================================================ */
const XlsxLite = (() => {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  /* ============================================================
     Minimal XLSX editor (keeps everything it does not touch)
     ============================================================ */
  async function openWorkbook(file) {
    const zip = await JSZip.loadAsync(file);
    const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
    const wbXml = await read('xl/workbook.xml');
    const relsXml = await read('xl/_rels/workbook.xml.rels');
    if (!wbXml || !relsXml) throw new Error('Hindi ito valid na Excel (.xlsx) file.');
    const parser = new DOMParser();
    const wbDoc = parser.parseFromString(wbXml, 'application/xml');
    const relDoc = parser.parseFromString(relsXml, 'application/xml');
    const rels = {};
    Array.from(relDoc.getElementsByTagName('Relationship')).forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const sheetPaths = {};
    Array.from(wbDoc.getElementsByTagNameNS(NS, 'sheet')).forEach((s) => {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      let t = rels[rid] || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      sheetPaths[s.getAttribute('name')] = t;
    });
    const ssXml = await read('xl/sharedStrings.xml');
    const shared = [];
    if (ssXml) {
      const ssDoc = parser.parseFromString(ssXml, 'application/xml');
      Array.from(ssDoc.getElementsByTagNameNS(NS, 'si')).forEach((si) => {
        shared.push(Array.from(si.getElementsByTagNameNS(NS, 't')).map((t) => t.textContent).join(''));
      });
    }
    const sheets = {};
    return {
      zip, wbXml, sheetPaths, shared, names: Object.keys(sheetPaths),
      readText: read,
      writeText(p, text) { zip.file(p, text, { createFolders: false }); },
      remove(p) { zip.remove(p); },
      async sheet(name) {
        if (sheets[name]) return sheets[name];
        const p = sheetPaths[name];
        if (!p) return null;
        const xml = await read(p);
        sheets[name] = makeSheet(xml, p, shared);
        return sheets[name];
      },
      async save() {
        Object.values(sheets).forEach((s) => { if (s.dirty) zip.file(s.path, s.xml, { createFolders: false }); });
        // Let Excel recompute every formula when the file is opened.
        let wb = this.wbXml;
        if (/<calcPr\b/.test(wb)) {
          wb = wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, attrs, slash) => '<calcPr' + attrs.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"' + slash + '>');
        } else {
          wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
        }
        zip.file('xl/workbook.xml', wb, { createFolders: false });
        return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
      }
    };
  }

  // String-level editor: only the <c> elements that are written change, so every other
  // byte of the DepEd sheet (namespaces, extensions, protection, validation) stays identical.
  const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xmlUnesc = (v) => String(v).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
  const cellRe = (ref) => new RegExp('<c r="' + ref + '"(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)');

  function makeSheet(xml, path, shared) {
    const api = {
      path, dirty: false,
      get xml() { return xml; },
      setXml(x) { xml = x; api.dirty = true; },
      get(ref) {
        const m = cellRe(ref).exec(xml);
        if (!m) return '';
        const attrs = m[1] || '', inner = m[2] || '';
        const t = (/\st="([^"]*)"/.exec(attrs) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        if (t === 's') return v !== undefined ? (shared[Number(v)] || '') : '';
        if (t === 'inlineStr') return xmlUnesc((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
        if (v === undefined) return '';
        if (t === 'str' || t === 'e' || t === 'b') return xmlUnesc(v);
        const num = Number(v);
        return isNaN(num) ? xmlUnesc(v) : num;
      },
      hasFormula(ref) { const m = cellRe(ref).exec(xml); return !!(m && /<f[\s>\/]/.test(m[2] || '')); },
      set(ref, value) {
        if (api.hasFormula(ref)) throw new Error('Formula cell ' + ref + ' — hindi ginalaw.');
        let body = '', type = '';
        if (value === null || value === undefined || value === '') { body = ''; }
        else if (typeof value === 'number' && isFinite(value)) { body = '<v>' + value + '</v>'; }
        else { type = ' t="inlineStr"'; body = '<is><t xml:space="preserve">' + xmlEsc(value) + '</t></is>'; }
        const m = cellRe(ref).exec(xml);
        if (m) {
          const attrs = (m[1] || '').replace(/\st="[^"]*"/, '');
          const repl = '<c r="' + ref + '"' + attrs + type + (body ? '>' + body + '</c>' : '/>');
          xml = xml.slice(0, m.index) + repl + xml.slice(m.index + m[0].length);
        } else {
          const { col, row } = { col: /^[A-Z]+/.exec(ref)[0], row: Number(/\d+$/.exec(ref)[0]) };
          const cell = '<c r="' + ref + '"' + type + (body ? '>' + body + '</c>' : '/>');
          const rowRe = new RegExp('<row r="' + row + '"(?=[\\s>/])[^>]*?(?:/>|>([\\s\\S]*?)</row>)');
          const rm = rowRe.exec(xml);
          if (rm) {
            if (rm[0].endsWith('/>')) {
              const open = rm[0].slice(0, -2) + '>';
              xml = xml.slice(0, rm.index) + open + cell + '</row>' + xml.slice(rm.index + rm[0].length);
            } else {
              const inner = rm[1] || '';
              const n = colNum(col);
              let pos = inner.length;
              const re = /<c r="([A-Z]+)\d+"/g; let cm;
              while ((cm = re.exec(inner))) { if (colNum(cm[1]) > n) { pos = cm.index; break; } }
              const start = rm.index + rm[0].indexOf('>') + 1;
              xml = xml.slice(0, start + pos) + cell + xml.slice(start + pos);
            }
          } else {
            const newRow = '<row r="' + row + '">' + cell + '</row>';
            const re = /<row r="(\d+)"/g; let mm, at = -1;
            while ((mm = re.exec(xml))) { if (Number(mm[1]) > row) { at = mm.index; break; } }
            if (at < 0) at = xml.indexOf('</sheetData>');
            if (at < 0) throw new Error('Walang sheetData sa ' + path);
            xml = xml.slice(0, at) + newRow + xml.slice(at);
          }
        }
        api.dirty = true;
      }
    };
    return api;
  }


  return { openWorkbook, makeSheet, colNum, colName, xmlEsc, xmlUnesc, NS, XLSX_MIME };
})();
if (typeof window !== 'undefined') window.XlsxLite = XlsxLite;

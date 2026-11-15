/* ============================================================
   tos-word.js — TOS Generator → Save as Word (.docx)
   Version: 1.0.0
   Builds an editable Word file (landscape) with the DepEd header, the TOS
   table, LOTS:HOTS totals, signatories, and optionally the Most/Least
   Learned table and the Answer Key. Uses docx@8.5.0 from the CDN; if it
   cannot load (offline), saves a .doc (HTML) that Word also opens.
   ============================================================ */
const TosWord = (() => {
  'use strict';

  const PAPERS = { letter: { w: 12240, h: 15840, css: '11in 8.5in' }, long: { w: 12240, h: 18720, css: '13in 8.5in' }, a4: { w: 11906, h: 16838, css: '297mm 210mm' } };
  const BLOOMS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
  const TERM_LABEL = { term1: 'Physics & Chemistry', term2: 'Chemistry & Life Science', term3: 'Earth Science' };
  const TERM_NUM = { term1: '1ST', term2: '2ND', term3: '3RD' };
  const EXAM = { quiz1: 'QUIZ 1', quiz2: 'QUIZ 2', quiz3: 'QUIZ 3', st1: 'SUMMATIVE TEST 1', st2: 'SUMMATIVE TEST 2', te: 'TERM EXAM' };
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function headerLines() {
    const d = (typeof CONFIG !== 'undefined' && CONFIG.DEVELOPER) || {};
    return ['Republic of the Philippines', 'DEPARTMENT OF EDUCATION', d.region || 'Region III', d.division || '',
      d.district || '', d.school || '', 'SY 2026-2027'].filter(Boolean);
  }

  function sigList(s) {
    s = s || {};
    return [['Prepared by', s.prepared], ['Checked by', s.checked], ['Noted by', s.noted]]
      .filter((x) => x[1] && (x[1].name || x[1].position));
  }

  /* ---------------- .docx ---------------- */
  function buildDocx(o) {
    const D = window.docx, FONT = 'Arial', SZ = 18;
    const { tos } = o;
    const paper = PAPERS[o.paper] || PAPERS.letter;
    const m = 576, usable = Math.max(paper.w, paper.h) - 2 * m;
    const run = (t, x) => new D.TextRun(Object.assign({ text: t == null ? '' : String(t), font: FONT, size: SZ }, x || {}));
    const para = (ch, x) => new D.Paragraph(Object.assign({ children: Array.isArray(ch) ? ch : [ch] }, x || {}));
    const center = (t, x, p) => para(run(t, x), Object.assign({ alignment: D.AlignmentType.CENTER }, p || {}));
    const B = { style: D.BorderStyle.SINGLE, size: 4, color: '607D8B' };
    const NB = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const borders = { top: B, bottom: B, left: B, right: B };
    const cell = (content, opt) => {
      opt = opt || {};
      const kids = (Array.isArray(content) ? content : [content]).map((c) => c instanceof D.Paragraph ? c
        : para(run(c, { bold: !!opt.bold, size: opt.size || SZ }), { alignment: opt.left ? D.AlignmentType.LEFT : D.AlignmentType.CENTER }));
      return new D.TableCell({ children: kids, borders, columnSpan: opt.span, rowSpan: opt.rows, verticalAlign: D.VerticalAlign.CENTER,
        shading: opt.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: opt.fill } : undefined,
        width: opt.w ? { size: opt.w, type: D.WidthType.DXA } : undefined,
        margins: { top: 40, bottom: 40, left: 60, right: 60 } });
    };
    const H = { bold: true, fill: 'E3F2FD', size: 16 };
    const grid = (W, rows) => new D.Table({ width: { size: usable, type: D.WidthType.DXA }, columnWidths: W, layout: D.TableLayoutType.FIXED, rows });
    const header = () => headerLines().map((t, i) => center(t, { bold: i === 1 || i === 5, size: i === 1 ? 20 : 16 }));
    const sigs = () => {
      const list = sigList(o.signatories);
      if (!list.length) return [];
      const w = Math.round(usable / 3);
      return [para(run(''), { spacing: { before: 120 } }), new D.Table({
        width: { size: w * list.length, type: D.WidthType.DXA }, columnWidths: list.map(() => w),
        borders: { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB },
        rows: [new D.TableRow({ children: list.map(([role, p]) => new D.TableCell({
          borders: { top: NB, bottom: NB, left: NB, right: NB },
          children: [para(run(role + ':')), para(run(''), { spacing: { after: 200 } }),
            center(p.name || '', { bold: true }, { border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: '000000' } } }),
            center(p.position || '', { size: 16 })]
        })) })]
      })];
    };

    const pageProps = { page: { size: { width: paper.w, height: paper.h, orientation: D.PageOrientation.LANDSCAPE }, margin: { top: m, right: m, bottom: m, left: m } } };
    const exam = EXAM[tos.assessment] || String(tos.assessment || '').toUpperCase();

    // ---- TOS table ----
    const pct = [30, 6, 7, 6, 6, 6, 6, 6, 6, 6, 9];
    const W = pct.map((x) => Math.round(usable * x / 100));
    const sum = (a, b) => W.slice(a, b + 1).reduce((t, x) => t + x, 0);
    const rows = [
      new D.TableRow({ tableHeader: true, children: [
        cell('Learning Competencies', Object.assign({ rows: 2, w: W[0] }, H)), cell('Hours', Object.assign({ rows: 2, w: W[1] }, H)),
        cell('% Weight', Object.assign({ rows: 2, w: W[2] }, H)), cell('Items', Object.assign({ rows: 2, w: W[3] }, H)),
        cell("Revised Bloom's Taxonomy", Object.assign({ span: 6, w: sum(4, 9) }, H)), cell('Item Numbers', Object.assign({ rows: 2, w: W[10] }, H))] }),
      new D.TableRow({ tableHeader: true, children: BLOOMS.map((b, k) => cell(b, Object.assign({ w: W[4 + k] }, H, { size: 14 }))) })
    ];
    tos.rows.forEach((r) => {
      const range = r.itemFrom === r.itemTo ? String(r.itemFrom) : r.itemFrom + '–' + r.itemTo;
      rows.push(new D.TableRow({ cantSplit: true, children: [
        cell([para([run(r.code, { bold: true, size: 15, color: '0D47A1' })]), para(run(r.description))], { left: true, w: W[0] }),
        cell(r.hours, { w: W[1] }), cell(r.weightPercent + '%', { w: W[2] }), cell(r.items, { bold: true, w: W[3] })]
        .concat(BLOOMS.map((b, k) => cell((r.bloomDistribution || {})[b] || 0, { w: W[4 + k] })))
        .concat([cell(range, { w: W[10] })]) }));
    });
    const t = tos.totals;
    const F = { bold: true, fill: 'F5F7FA' };
    rows.push(new D.TableRow({ children: [cell('TOTAL', Object.assign({ w: W[0] }, F)), cell(t.hours, Object.assign({ w: W[1] }, F)),
      cell(t.weightPercent + '%', Object.assign({ w: W[2] }, F)), cell(t.items, Object.assign({ w: W[3] }, F))]
      .concat(BLOOMS.map((b, k) => cell(t.blooms[b] || 0, Object.assign({ w: W[4 + k] }, F)))).concat([cell('', Object.assign({ w: W[10] }, F))]) }));
    rows.push(new D.TableRow({ children: [cell('LOTS:', Object.assign({ span: 4, w: sum(0, 3) }, F)),
      cell(t.lotsCount + ' (' + t.lotsPercent + '%)', Object.assign({ span: 2, w: sum(4, 5) }, F)),
      cell('HOTS:', Object.assign({ span: 4, w: sum(6, 9) }, F)), cell(t.hotsCount + ' (' + t.hotsPercent + '%)', Object.assign({ w: W[10] }, F))] }));

    const sections = [{ properties: pageProps, children: header().concat([
      center('TABLE OF SPECIFICATIONS · ' + (TERM_NUM[tos.term] || '') + ' TERM · ' + exam, { bold: true, size: 24 }, { spacing: { before: 160 } }),
      center('Subject: General Science 11 · Term: ' + (TERM_LABEL[tos.term] || '') + ' · Coverage: ' + (tos.coverage || '') +
        ' · Total Items: ' + tos.totalItems + ' · Total Hours: ' + t.hours, { size: 18 }, { spacing: { after: 120 } }),
      grid(W, rows)
    ]).concat(sigs()) }];

    // ---- Most / Least learned ----
    if (o.withMll && o.mll && (o.mll.top5.length || o.mll.bot5.length)) {
      const MW = [5, 37, 8, 5, 37, 8].map((x) => Math.round(usable * x / 100));
      const mrows = [new D.TableRow({ tableHeader: true, children: [
        cell('Most Learned Competencies', Object.assign({ span: 3, w: MW[0] + MW[1] + MW[2] }, H, { fill: 'E8F5E9' })),
        cell('Least Learned Competencies', Object.assign({ span: 3, w: MW[3] + MW[4] + MW[5] }, H, { fill: 'FFEBEE' }))] }),
      new D.TableRow({ tableHeader: true, children: ['Rank', 'Competency', 'MPS', 'Rank', 'Competency', 'MPS'].map((x, k) => cell(x, Object.assign({ w: MW[k] }, H))) })];
      for (let i = 0; i < 5; i++) {
        const a = o.mll.top5[i], b = o.mll.bot5[i];
        const comp = (x) => x ? [para(run(x.code, { bold: true, size: 15, color: '0D47A1' })), para(run(x.description))] : [para(run(''))];
        mrows.push(new D.TableRow({ cantSplit: true, children: [cell(i + 1, { w: MW[0] }), cell(comp(a), { left: true, w: MW[1] }), cell(a ? a.pct + '%' : '—', { w: MW[2] }),
          cell(i + 1, { w: MW[3] }), cell(comp(b), { left: true, w: MW[4] }), cell(b ? b.pct + '%' : '—', { w: MW[5] })] }));
      }
      sections.push({ properties: pageProps, children: header().concat([
        center('MOST & LEAST LEARNED COMPETENCIES', { bold: true, size: 24 }, { spacing: { before: 160 } }),
        center('Subject: GENERAL SCIENCE 11 · ' + ({ term1: 'First Term', term2: 'Second Term', term3: 'Third Term' }[tos.term] || '') + ' · Based on ST1 + ST2 MPS', { size: 18 }, { spacing: { after: 120 } }),
        grid(MW, mrows)
      ]).concat(sigs()) });
    }

    // ---- Answer key ----
    if (o.withKey && tos.answerKey && tos.answerKey.length) {
      const n = tos.answerKey.length, cols = 4, per = Math.ceil(n / cols);
      const KW = Array.from({ length: cols * 3 }, (_, k) => Math.round(usable * (k % 3 === 1 ? 14 : 5.5) / 100));
      const krows = [new D.TableRow({ tableHeader: true, children: Array.from({ length: cols }).flatMap((_, c) =>
        ['No.', 'Answer', 'Bloom'].map((x, k) => cell(x, Object.assign({ w: KW[c * 3 + k] }, H)))) })];
      for (let r = 0; r < per; r++) {
        const tds = [];
        for (let c = 0; c < cols; c++) {
          const k = tos.answerKey[r + c * per];
          tds.push(cell(k ? k.itemNo : '', { w: KW[c * 3] }), cell(k ? k.answer : '', { left: true, w: KW[c * 3 + 1], size: 16 }),
            cell(k ? String(k.bloomLevel || '').slice(0, 3) : '', { w: KW[c * 3 + 2], size: 14 }));
        }
        krows.push(new D.TableRow({ cantSplit: true, children: tds }));
      }
      sections.push({ properties: pageProps, children: header().concat([
        center('ANSWER KEY · ' + (TERM_NUM[tos.term] || '') + ' TERM · ' + exam, { bold: true, size: 24 }, { spacing: { before: 160, after: 120 } }),
        grid(KW, krows)
      ]) });
    }

    const dev = (typeof CONFIG !== 'undefined' && CONFIG.DEVELOPER) || {};
    const doc = new D.Document({ creator: dev.name || 'Teacher', title: 'TOS — ' + exam,
      styles: { default: { document: { run: { font: FONT, size: SZ } } } }, sections });
    return D.Packer.toBlob(doc);
  }

  /* ---------------- .doc fallback ---------------- */
  function buildDoc(o) {
    const paper = PAPERS[o.paper] || PAPERS.letter;
    const parts = [document.getElementById('tos-doc-container')];
    if (o.withMll) parts.push(document.getElementById('mll-container'));
    if (o.withKey) parts.push(document.getElementById('answer-key-container'));
    const html = parts.filter(Boolean).map((el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('.no-print, button, .tos-edit-banner').forEach((x) => x.remove());
      c.querySelectorAll('input.bloom-edit').forEach((i) => { i.replaceWith(document.createTextNode(i.value)); });
      return c.innerHTML;
    }).join('<br style="page-break-before:always">');
    const css = `@page{size:${paper.css};margin:0.5in;} body{font-family:Arial;font-size:9pt;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #607d8b;padding:3px 5px;font-size:9pt;} th{background:#e3f2fd;}`;
    return new Blob(['﻿', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + html + '</body></html>'], { type: 'application/msword' });
  }

  async function save(o) {
    const base = 'TOS_GENSCI_' + String(o.tos.term || '').toUpperCase() + '_' + String(o.tos.assessment || '').toUpperCase();
    if (window.docx && window.docx.Document) {
      try { download(await buildDocx(o), base + '.docx'); return 'docx'; }
      catch (e) { console.warn('[TosWord] docx failed, using .doc:', e); }
    }
    download(buildDoc(o), base + '.doc');
    return 'doc';
  }

  return { save, _esc: esc };
})();
if (typeof window !== 'undefined') window.TosWord = TosWord;

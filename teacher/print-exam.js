/* ============================================================
   print-exam.js — Printable Exam Copies
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Lets the teacher print the ACTUAL questions of any Quiz,
   Summative Test or Term Exam (per term) for students who
   cannot access the internet, or save them as an editable
   Word (.docx) file first.

   - Reads student/term{N}/assessments/{id}.json (same bank the
     online quiz engine uses — single source of truth)
   - Set A / Set B use Randomize.generateSet() with the same seed
     (term-id + set letter) the students get online, so the paper
     copy has the SAME question order as the online version.
   - Options are never shuffled (matches randomize.js v1.4.0)
   - Answer key is optional and always on its own page
   - docx via docx@8.5.0 (CDN, same as Exam Evidence); if the
     library can't load, falls back to a Word-compatible .doc file
   ============================================================ */
window.PrintExam = (function () {
  'use strict';

  var LETTERS = 'ABCDEFGH';

  var PAPERS = {
    letter: { label: 'Short bond (Letter 8.5 × 11 in)', css: '8.5in 11in', wCss: '8.5in', hCss: '11in', w: 12240, h: 15840 },
    a4:     { label: 'A4 (210 × 297 mm)',               css: '210mm 297mm', wCss: '210mm', hCss: '297mm', w: 11906, h: 16838 },
    long:   { label: 'Long bond (8.5 × 13 in)',         css: '8.5in 13in', wCss: '8.5in', hCss: '13in', w: 12240, h: 18720 }
  };

  var ASSESSMENTS = {
    quiz1: { label: 'Quiz 1',           minutes: 20 },
    quiz2: { label: 'Quiz 2',           minutes: 20 },
    quiz3: { label: 'Quiz 3',           minutes: 20 },
    st1:   { label: 'Summative Test 1', minutes: 45 },
    st2:   { label: 'Summative Test 2', minutes: 45 },
    te:    { label: 'Term Exam',        minutes: 60 }
  };

  var DIR_WITH_BLANK = 'Read each item carefully. Choose the letter of the BEST answer and write it on the blank before the number. Avoid erasures.';
  var DIR_NO_BLANK   = 'Read each item carefully. Encircle the letter of the BEST answer. Avoid erasures.';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- data ---------- */
  async function loadBank(term, id) {
    var paths = [
      '../student/' + term + '/assessments/' + id + '.json',
      'student/' + term + '/assessments/' + id + '.json'
    ];
    var lastErr = null;
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(paths[i], { cache: 'no-cache' });
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status + ' for ' + paths[i]); continue; }
        var bank = await res.json();
        if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
          throw new Error(id + '.json has no questions.');
        }
        return bank;
      } catch (e) { lastErr = e; }
    }
    throw new Error('Hindi ma-load ang ' + id + '.json (' + term + '). ' + (lastErr ? lastErr.message : ''));
  }

  function toItem(q) {
    var opts = (q.options || []).slice();
    return { text: q.text, options: opts, correctIndex: opts.indexOf(q.correct) };
  }

  /** which: 'A' | 'B' | 'MASTER' */
  function buildVersion(bank, term, id, which) {
    var items;
    if (which === 'A' || which === 'B') {
      if (typeof Randomize === 'undefined' || !Randomize.generateSet) {
        throw new Error('randomize.js is not loaded — cannot build Set ' + which + '.');
      }
      var set = Randomize.generateSet(bank, term + '-' + id, which);
      items = set.questions.map(function (q) { return toItem(q); });
    } else {
      items = bank.questions.map(toItem);
    }
    return { key: which, label: which === 'MASTER' ? 'Master Copy' : 'Set ' + which, items: items };
  }

  function versionKeys(choice) {
    if (choice === 'AB') return ['A', 'B'];
    return [choice];
  }

  /* ---------- HTML (preview, print, .doc fallback) ---------- */
  function buildCss(opts) {
    var L = opts.answerLine ? '4.6em' : '2.2em';
    return '' +
      '.pe-doc{font-family:Calibri,Carlito,Arial,sans-serif;color:#000;font-size:' + opts.fontPt + 'pt;line-height:1.25;}' +
      '.pe-doc .pe-c{text-align:center;margin:0;}' +
      '.pe-doc .pe-s1{font-size:.9em;}' +
      '.pe-doc .pe-s2{font-size:1.1em;font-weight:bold;}' +
      '.pe-doc .pe-title{text-align:center;font-weight:bold;font-size:1.25em;margin:10px 0 0;}' +
      '.pe-doc .pe-sub{text-align:center;font-size:.95em;margin:2px 0 0;}' +
      '.pe-doc .pe-set{text-align:center;font-weight:bold;letter-spacing:.12em;margin:6px 0 8px;}' +
      '.pe-doc table.pe-info{width:100%;border-collapse:collapse;margin:4px 0 6px;}' +
      '.pe-doc table.pe-info td{width:50%;padding:4px 0;}' +
      '.pe-doc .pe-dir{border-bottom:1.5px solid #000;padding:2px 0 8px;margin:6px 0 12px;}' +
      '.pe-doc .pe-qs{column-count:' + opts.cols + ';column-gap:.35in;' + (opts.cols === 2 ? 'column-rule:1px solid #bbb;' : '') + '}' +
      '.pe-doc .pe-q{display:flex;break-inside:avoid;page-break-inside:avoid;margin:0 0 .6em;}' +
      '.pe-doc .pe-qn{flex:0 0 ' + L + ';white-space:nowrap;}' +
      '.pe-doc .pe-qb{flex:1 1 auto;min-width:0;}' +
      '.pe-doc .pe-qt{margin-bottom:.15em;}' +
      '.pe-doc .pe-o{display:flex;padding-left:.2em;}' +
      '.pe-doc .pe-ol{flex:0 0 1.6em;}' +
      '.pe-doc .pe-keytitle{text-align:center;font-weight:bold;font-size:1.2em;margin:0 0 4px;}' +
      '.pe-doc .pe-keysub{text-align:center;margin:0 0 14px;}' +
      '.pe-doc table.pe-key{width:100%;border-collapse:collapse;}' +
      '.pe-doc table.pe-key td{border:1px solid #888;padding:4px 8px;width:20%;}';
  }

  function headHtml(model, v) {
    var s = model.school || {};
    var o = model.opts;
    var lines = [];
    lines.push('<p class="pe-c pe-s1">Republic of the Philippines</p>');
    lines.push('<p class="pe-c pe-s1"><b>Department of Education</b></p>');
    var rd = [s.region, s.division].filter(Boolean).join(' — ');
    if (rd) lines.push('<p class="pe-c pe-s1">' + esc(rd) + '</p>');
    if (s.schoolName) lines.push('<p class="pe-c pe-s2">' + esc(s.schoolName) + '</p>');
    var ay = [s.schoolAddress, s.schoolYear].filter(Boolean).join(' · ');
    if (ay) lines.push('<p class="pe-c pe-s1">' + esc(ay) + '</p>');

    var sub = ['Term ' + model.termNo];
    if (model.bank.coverage) sub.push(model.bank.coverage);
    sub.push(v.items.length + ' items');
    if (o.showMinutes && model.minutes) sub.push(model.minutes + ' minutes');

    return lines.join('') +
      '<p class="pe-title">' + esc((s.subject || 'General Science').toUpperCase()) + (s.gradeLevel ? ' — ' + esc(s.gradeLevel.toUpperCase()) : '') + '</p>' +
      '<p class="pe-title" style="font-size:1.05em;margin-top:2px;">' + esc(model.bank.title || model.assessmentLabel) + '</p>' +
      '<p class="pe-sub">' + esc(sub.join(' · ')) + '</p>' +
      (v.key === 'MASTER' ? '' : '<p class="pe-set">— ' + esc(v.label.toUpperCase()) + ' —</p>') +
      (v.key === 'MASTER' ? '<p class="pe-set">— MASTER COPY —</p>' : '') +
      '<table class="pe-info"><tr><td>Name: ______________________________</td><td>Section: ____________________</td></tr>' +
      '<tr><td>Date: ____________________</td><td>Score: ________ / ' + v.items.length + '</td></tr></table>' +
      '<div class="pe-dir"><b>Directions:</b> ' + esc(o.directions) + '</div>';
  }

  function questionsHtml(v, opts) {
    var out = ['<div class="pe-qs">'];
    v.items.forEach(function (it, i) {
      var num = (opts.answerLine ? '_____ ' : '') + (i + 1) + '.';
      var optsHtml = it.options.map(function (t, k) {
        return '<div class="pe-o"><span class="pe-ol">' + LETTERS[k] + '.</span><span>' + esc(t) + '</span></div>';
      }).join('');
      out.push('<div class="pe-q"><div class="pe-qn">' + num + '</div><div class="pe-qb"><div class="pe-qt">' + esc(it.text) + '</div>' + optsHtml + '</div></div>');
    });
    out.push('</div>');
    return out.join('');
  }

  function keyCells(v) {
    return v.items.map(function (it, i) {
      return (i + 1) + '. ' + (it.correctIndex >= 0 ? LETTERS[it.correctIndex] : '?');
    });
  }

  function keyHtml(model, v) {
    var cells = keyCells(v);
    var perRow = 5;
    var rows = Math.ceil(cells.length / perRow);
    var trs = [];
    for (var r = 0; r < rows; r++) {
      var tds = [];
      for (var c = 0; c < perRow; c++) {
        // column-major so the key reads 1,2,3… down each column
        var idx = r + c * rows;
        tds.push('<td>' + esc(cells[idx] || '') + '</td>');
      }
      trs.push('<tr>' + tds.join('') + '</tr>');
    }
    return '<p class="pe-keytitle">ANSWER KEY — ' + esc(v.label.toUpperCase()) + '</p>' +
      '<p class="pe-keysub">' + esc(model.bank.title || model.assessmentLabel) + ' · Term ' + model.termNo + ' · <b>FOR TEACHER USE ONLY</b></p>' +
      '<table class="pe-key">' + trs.join('') + '</table>';
  }

  /** Returns the inner HTML (a series of .pe-page blocks). */
  function renderHtml(model) {
    var o = model.opts;
    var pages = [];
    if (o.output !== 'key') {
      model.versions.forEach(function (v) {
        pages.push('<section class="pe-page">' + headHtml(model, v) + questionsHtml(v, o) + '</section>');
      });
    }
    if (o.output !== 'student') {
      model.versions.forEach(function (v) {
        pages.push('<section class="pe-page">' + keyHtml(model, v) + '</section>');
      });
    }
    return pages.join('');
  }

  /* ---------- .doc fallback (no external library needed) ---------- */
  function buildDocHtml(model) {
    var paper = PAPERS[model.opts.paper] || PAPERS.letter;
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(model.bank.title || model.assessmentLabel) + '</title>' +
      '<style>@page{size:' + paper.css + ';margin:.6in;}' + buildCss(Object.assign({}, model.opts, { cols: 1 })) +
      '.pe-page{page-break-after:always;}</style></head><body><div class="pe-doc">' + renderHtml(model) + '</div></body></html>';
  }

  /* ---------- .docx ---------- */
  async function buildDocxBlob(model) {
    var D = window.docx;
    if (!D || !D.Document) throw new Error('docx library not loaded');

    var o = model.opts;
    var s = model.school || {};
    var paper = PAPERS[o.paper] || PAPERS.letter;
    var FONT = 'Calibri';
    var size = o.fontPt * 2;           // half-points
    var margin = 864;                  // 0.6 in
    var L = o.answerLine ? Math.round(o.fontPt * 100) : 520;
    var OPT_HANG = 360;

    function run(text, extra) {
      return new D.TextRun(Object.assign({ text: text == null ? '' : String(text), font: FONT, size: size }, extra || {}));
    }
    function para(children, extra) {
      return new D.Paragraph(Object.assign({ children: children }, extra || {}));
    }
    function tabRun() {
      return D.Tab ? new D.TextRun({ children: [new D.Tab()], font: FONT, size: size }) : run('  ');
    }
    function center(text, extra) {
      return para([run(text, extra)], { alignment: D.AlignmentType.CENTER, spacing: { after: 0 } });
    }
    function none() { return { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' }; }
    function noBorders() { var n = none(); return { top: n, bottom: n, left: n, right: n }; }
    function pageProps(restart) {
      var p = { size: { width: paper.w, height: paper.h }, margin: { top: margin, right: margin, bottom: margin, left: margin } };
      if (restart) p.pageNumbers = { start: 1 };
      return p;
    }
    function footers(label) {
      return {
        default: new D.Footer({
          children: [para([
            run(label + '  ·  Page ', { size: 16 }),
            new D.TextRun({ children: [D.PageNumber.CURRENT], font: FONT, size: 16 })
          ], { alignment: D.AlignmentType.CENTER })]
        })
      };
    }

    function headParas(v) {
      var out = [];
      out.push(center('Republic of the Philippines', { size: size - 2 }));
      out.push(center('Department of Education', { size: size - 2, bold: true }));
      var rd = [s.region, s.division].filter(Boolean).join(' — ');
      if (rd) out.push(center(rd, { size: size - 4 }));
      if (s.schoolName) out.push(center(s.schoolName, { size: size + 2, bold: true }));
      var ay = [s.schoolAddress, s.schoolYear].filter(Boolean).join(' · ');
      if (ay) out.push(center(ay, { size: size - 4 }));

      out.push(para([run(((s.subject || 'General Science') + (s.gradeLevel ? ' — ' + s.gradeLevel : '')).toUpperCase(), { bold: true, size: size + 4 })],
        { alignment: D.AlignmentType.CENTER, spacing: { before: 160, after: 0 } }));
      out.push(para([run(model.bank.title || model.assessmentLabel, { bold: true, size: size + 1 })],
        { alignment: D.AlignmentType.CENTER, spacing: { after: 0 } }));

      var sub = ['Term ' + model.termNo];
      if (model.bank.coverage) sub.push(model.bank.coverage);
      sub.push(v.items.length + ' items');
      if (o.showMinutes && model.minutes) sub.push(model.minutes + ' minutes');
      out.push(center(sub.join(' · '), { size: size - 2 }));
      out.push(para([run('— ' + (v.key === 'MASTER' ? 'MASTER COPY' : v.label.toUpperCase()) + ' —', { bold: true })],
        { alignment: D.AlignmentType.CENTER, spacing: { before: 100, after: 100 } }));

      function cell(text) {
        return new D.TableCell({
          borders: noBorders(),
          width: { size: 50, type: D.WidthType.PERCENTAGE },
          children: [para([run(text)], { spacing: { before: 60, after: 60 } })]
        });
      }
      var n = none();
      out.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        borders: { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n },
        rows: [
          new D.TableRow({ children: [cell('Name: ______________________________'), cell('Section: ____________________')] }),
          new D.TableRow({ children: [cell('Date: ____________________'), cell('Score: ________ / ' + v.items.length)] })
        ]
      }));

      out.push(para([run('Directions: ', { bold: true }), run(o.directions)], {
        spacing: { before: 120, after: 200 },
        border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: '000000', space: 4 } }
      }));
      return out;
    }

    function questionParas(v) {
      var out = [];
      v.items.forEach(function (it, i) {
        var num = (o.answerLine ? '_____ ' : '') + (i + 1) + '.';
        out.push(para([run(num), tabRun(), run(it.text)], {
          indent: { left: L, hanging: L },
          spacing: { before: i === 0 ? 0 : 60, after: 20 },
          keepNext: true, keepLines: true
        }));
        it.options.forEach(function (t, k) {
          var last = k === it.options.length - 1;
          out.push(para([run(LETTERS[k] + '.'), tabRun(), run(t)], {
            indent: { left: L + OPT_HANG, hanging: OPT_HANG },
            spacing: { after: last ? 100 : 0 },
            keepNext: !last, keepLines: true
          }));
        });
      });
      return out;
    }

    function keyChildren(v) {
      var cells = keyCells(v);
      var perRow = 5;
      var rows = Math.ceil(cells.length / perRow);
      var line = { style: D.BorderStyle.SINGLE, size: 4, color: '888888' };
      var trs = [];
      for (var r = 0; r < rows; r++) {
        var tcs = [];
        for (var c = 0; c < perRow; c++) {
          var idx = r + c * rows;
          tcs.push(new D.TableCell({
            borders: { top: line, bottom: line, left: line, right: line },
            width: { size: 20, type: D.WidthType.PERCENTAGE },
            children: [para([run(cells[idx] || '')], { spacing: { before: 40, after: 40 } })]
          }));
        }
        trs.push(new D.TableRow({ children: tcs }));
      }
      return [
        para([run('ANSWER KEY — ' + v.label.toUpperCase(), { bold: true, size: size + 4 })], { alignment: D.AlignmentType.CENTER, spacing: { after: 40 } }),
        para([run((model.bank.title || model.assessmentLabel) + ' · Term ' + model.termNo + ' · FOR TEACHER USE ONLY')], { alignment: D.AlignmentType.CENTER, spacing: { after: 240 } }),
        new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: trs })
      ];
    }

    var sections = [];
    var baseLabel = (s.subject || 'General Science') + ' · Term ' + model.termNo + ' · ' + model.assessmentLabel;

    if (o.output !== 'key') {
      model.versions.forEach(function (v) {
        var label = baseLabel + ' · ' + v.label;
        if (o.cols === 2) {
          sections.push({ properties: { page: pageProps(true) }, footers: footers(label), children: headParas(v) });
          sections.push({
            properties: { type: D.SectionType.CONTINUOUS, page: pageProps(false), column: { count: 2, space: 500 } },
            footers: footers(label),
            children: questionParas(v)
          });
        } else {
          sections.push({ properties: { page: pageProps(true) }, footers: footers(label), children: headParas(v).concat(questionParas(v)) });
        }
      });
    }
    if (o.output !== 'student') {
      model.versions.forEach(function (v) {
        sections.push({
          properties: { page: pageProps(true) },
          footers: footers('Answer Key · ' + baseLabel + ' · ' + v.label),
          children: keyChildren(v)
        });
      });
    }

    var doc = new D.Document({
      creator: s.teacherName || 'Teacher',
      title: (model.bank.title || model.assessmentLabel) + ' — Term ' + model.termNo,
      description: 'Printable exam copy generated from General Science app',
      styles: { default: { document: { run: { font: FONT, size: size } } } },
      sections: sections
    });
    return D.Packer.toBlob(doc);
  }

  /* ---------- file name + download ---------- */
  function fileBase(model) {
    var tag = model.opts.output === 'key' ? 'AnswerKey' : 'Exam';
    var vers = model.versions.map(function (v) { return v.key === 'MASTER' ? 'Master' : 'Set' + v.key; }).join('');
    return 'GenSci_T' + model.termNo + '_' + model.assessmentId.toUpperCase() + '_' + vers + '_' + tag;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /** Save as Word. Returns 'docx' or 'doc' depending on what was produced. */
  async function saveWord(model) {
    var base = fileBase(model);
    if (window.docx && window.docx.Document) {
      var blob = await buildDocxBlob(model);
      download(blob, base + '.docx');
      return 'docx';
    }
    var html = buildDocHtml(model);
    download(new Blob(['\ufeff', html], { type: 'application/msword' }), base + '.doc');
    return 'doc';
  }

  /* ---------- model ---------- */
  function buildModel(bank, termNo, assessmentId, versionChoice, opts) {
    var term = 'term' + termNo;
    var meta = ASSESSMENTS[assessmentId] || { label: assessmentId, minutes: 0 };
    return {
      school: window.SCHOOL_INFO || {},
      bank: bank,
      termNo: termNo,
      assessmentId: assessmentId,
      assessmentLabel: meta.label,
      minutes: meta.minutes,
      versions: versionKeys(versionChoice).map(function (k) { return buildVersion(bank, term, assessmentId, k); }),
      opts: opts
    };
  }

  return {
    PAPERS: PAPERS,
    ASSESSMENTS: ASSESSMENTS,
    DIR_WITH_BLANK: DIR_WITH_BLANK,
    DIR_NO_BLANK: DIR_NO_BLANK,
    loadBank: loadBank,
    buildModel: buildModel,
    buildCss: buildCss,
    renderHtml: renderHtml,
    buildDocxBlob: buildDocxBlob,
    buildDocHtml: buildDocHtml,
    saveWord: saveWord
  };
})();

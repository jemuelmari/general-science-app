/* ============================================================
   print-exam.js — Printable Exam Copies
   Version: 1.1.0
   App: General Science
   ------------------------------------------------------------
   v1.1.0: + Student ANSWER SHEET (bubble sheet: Name / LRN / Section / Set,
             one row per item) for students without devices; print it
             alone, with the test, or with test + key. After checking,
             record the scores in Score Entry (teacher/score-entry.html).
   Lets the teacher print the ACTUAL questions of any Quiz,
   Summative Test or Term Exam (per term) for students who
   cannot access the internet, or save them as an editable
   Word (.docx) file first.

   - Reads student/term{N}/assessments/{id}.json (same bank the
     online quiz engine uses — single source of truth)
   - Set A / Set B use Randomize.generateSet() with the same seed
     (term-id + set letter) the students get online, so the paper
     copy has the SAME question order as the online version.
   - Choices for Set A/B come from randomize.js v1.5.0 (same as online); MASTER uses the local seeded placement
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

  /* ---------- choice shuffling (printed copies only) ----------
     The question banks store the correct answer as the FIRST option
     for every item, so unshuffled paper copies would be "all A".
     This places the correct answer at a seeded, evenly-spread
     position (A–D) and shuffles the distractors. Deterministic:
     same term/assessment/set => same paper every time, so the
     printed key always matches the printed questions. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFromString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function shuffled(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function hasRun(positions, len) {
    var run = 1;
    for (var i = 1; i < positions.length; i++) {
      run = positions[i] === positions[i - 1] ? run + 1 : 1;
      if (run >= len) return true;
    }
    return false;
  }
  function isLocked(it) {
    // keep original order for "All of the above"-type items, or malformed items
    if (it.options.length < 2 || it.correctIndex < 0) return true;
    return (typeof Randomize !== 'undefined' && Randomize.hasUnshuffleableOption)
      ? Randomize.hasUnshuffleableOption(it.options) : false;
  }
  function shuffleChoices(items, seedStr) {
    var rng = mulberry32(seedFromString(seedStr));
    var n = items.length;
    // balanced target positions: as equal a count of A/B/C/D as possible
    var base = [];
    for (var i = 0; i < n; i++) base.push(i % 4);
    var positions = shuffled(base, rng);
    for (var tries = 0; tries < 200 && hasRun(positions, 3); tries++) positions = shuffled(base, rng);

    return items.map(function (it, i) {
      if (isLocked(it)) return it;
      var correct = it.options[it.correctIndex];
      var others = shuffled(it.options.filter(function (_, k) { return k !== it.correctIndex; }), rng);
      var target = Math.min(positions[i], it.options.length - 1);
      var opts = others.slice();
      opts.splice(target, 0, correct);
      return { text: it.text, options: opts, correctIndex: target };
    });
  }

  /** which: 'A' | 'B' | 'MASTER' */
  function buildVersion(bank, term, id, which, shuffleOpts) {
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
    // randomize.js v1.5.0 already places the choices for Set A/B with this same seed
    // (so online == paper). Only the MASTER copy (or an older randomize.js) needs it here.
    var seededByEngine = (which === 'A' || which === 'B') && typeof Randomize !== 'undefined' && Randomize.CHOICES_SEEDED;
    if (shuffleOpts && !seededByEngine) items = shuffleChoices(items, term + '-' + id + '#choices-' + which);
    return { key: which, label: which === 'MASTER' ? 'Master Copy' : 'Set ' + which, items: items };
  }

  /** Which parts to print for the "What to print" choice. */
  function parts(o) {
    var out = o.output || 'student';
    return {
      questions: ['student', 'both', 'student-sheet', 'all'].indexOf(out) !== -1,
      sheet: ['sheet', 'student-sheet', 'all'].indexOf(out) !== -1,
      key: ['both', 'key', 'all'].indexOf(out) !== -1
    };
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
      '.pe-doc table.pe-key td{border:1px solid #888;padding:4px 8px;width:20%;}' +
      '.pe-doc table.pe-sheet{width:100%;border-collapse:collapse;margin-top:6px;}' +
      '.pe-doc table.pe-sheet td{padding:3px 4px;vertical-align:middle;white-space:nowrap;}' +
      '.pe-doc .pe-bn{display:inline-block;width:2.2em;text-align:right;margin-right:.4em;font-weight:bold;}' +
      '.pe-doc .pe-bub{display:inline-block;width:1.45em;height:1.45em;line-height:1.4em;border:1.2px solid #000;border-radius:50%;text-align:center;font-size:.8em;margin:0 .18em;}' +
      '.pe-doc .pe-sheetbox{border:1.5px solid #000;padding:6px 10px;margin:8px 0;}';
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

  /** Bubble answer sheet: one row per item, column-major (1–20 down the first column …). */
  function sheetHtml(model, v) {
    var s = model.school || {};
    var n = v.items.length;
    var cols = n > 40 ? 3 : n > 20 ? 2 : 1;
    var rows = Math.ceil(n / cols);
    var nOpt = Math.max.apply(null, v.items.map(function (it) { return it.options.length; }).concat([4]));
    var trs = [];
    for (var r = 0; r < rows; r++) {
      var tds = [];
      for (var c = 0; c < cols; c++) {
        var i = r + c * rows;
        if (i >= n) { tds.push('<td></td>'); continue; }
        var b = '';
        for (var k = 0; k < nOpt; k++) b += '<span class="pe-bub">' + LETTERS[k] + '</span>';
        tds.push('<td><span class="pe-bn">' + (i + 1) + '.</span>' + b + '</td>');
      }
      trs.push('<tr>' + tds.join('') + '</tr>');
    }
    return (s.schoolName ? '<p class="pe-c pe-s2">' + esc(s.schoolName) + '</p>' : '') +
      '<p class="pe-title">ANSWER SHEET</p>' +
      '<p class="pe-sub">' + esc(model.bank.title || model.assessmentLabel) + ' · Term ' + model.termNo + ' · ' + n + ' items</p>' +
      '<p class="pe-set">— ' + esc(v.key === 'MASTER' ? 'MASTER COPY' : v.label.toUpperCase()) + ' —</p>' +
      '<div class="pe-sheetbox"><table class="pe-info">' +
        '<tr><td>Name: ______________________________</td><td>LRN: ____________________</td></tr>' +
        '<tr><td>Section: ____________________</td><td>Date: ____________________</td></tr>' +
        '<tr><td>Score: ________ / ' + n + '</td><td>Checked by: ________________</td></tr></table></div>' +
      '<div class="pe-dir"><b>Directions:</b> Shade or encircle the letter of your answer. Use only one answer per number. ' +
        'Make sure the SET on your test paper is the same as this answer sheet (' + esc(v.key === 'MASTER' ? 'Master' : v.label) + ').</div>' +
      '<table class="pe-sheet">' + trs.join('') + '</table>';
  }

  /** Returns the inner HTML (a series of .pe-page blocks). */
  function renderHtml(model) {
    var o = model.opts;
    var want = parts(o);
    var pages = [];
    if (want.questions) {
      model.versions.forEach(function (v) {
        pages.push('<section class="pe-page">' + headHtml(model, v) + questionsHtml(v, o) + '</section>');
      });
    }
    if (want.sheet) {
      model.versions.forEach(function (v) {
        pages.push('<section class="pe-page">' + sheetHtml(model, v) + '</section>');
      });
    }
    if (want.key) {
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

    var want = parts(o);
    if (want.questions) {
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
    if (want.sheet) {
      model.versions.forEach(function (v) {
        var n = v.items.length, cols = n > 40 ? 3 : n > 20 ? 2 : 1, rows = Math.ceil(n / cols);
        var trs = [];
        for (var r = 0; r < rows; r++) {
          var cells = [];
          for (var c = 0; c < cols; c++) {
            var i = r + c * rows;
            var txt = i < n ? (i + 1) + '.   ( A )   ( B )   ( C )   ( D )' : '';
            cells.push(new D.TableCell({ borders: { top: none(), bottom: none(), left: none(), right: none() }, children: [para([run(txt)])] }));
          }
          trs.push(new D.TableRow({ children: cells }));
        }
        sections.push({
          properties: { page: pageProps(true) },
          footers: footers('Answer Sheet · ' + baseLabel + ' · ' + v.label),
          children: [
            center('ANSWER SHEET', { bold: true }),
            center((model.bank.title || model.assessmentLabel) + ' · Term ' + model.termNo + ' · ' + v.label),
            para([run('Name: ______________________________    LRN: ____________________')]),
            para([run('Section: ____________________    Date: ______________    Score: ______ / ' + n)]),
            para([run('Directions: Encircle the letter of your answer. Use the same SET as your test paper.')], { spacing: { after: 160 } }),
            new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: trs })
          ]
        });
      });
    }
    if (want.key) {
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
    var tag = model.opts.output === 'key' ? 'AnswerKey' : model.opts.output === 'sheet' ? 'AnswerSheet' : 'Exam';
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
      versions: versionKeys(versionChoice).map(function (k) { return buildVersion(bank, term, assessmentId, k, !!opts.shuffleChoices); }),
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

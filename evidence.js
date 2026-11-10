/* ============================================================
   evidence.js — Exam Evidence (General Science, Grade 11)
   Version: 1.0.0
   ------------------------------------------------------------
   Gumagawa ng printable "Examination Evidence Record" ng isang estudyante (o ng buong section)
   para sa Quiz 1–3, Summative Test 1–2, at Term Exam — para ipapirma sa magulang/guardian.

   Laman ng bawat evidence:
   - DepEd header + school info, pangalan, LRN, grade/section, subject, assessment
   - Resulta: score, percent, remarks (passed/not yet), proficiency level, petsa/oras, tagal ng pagsagot,
     tab-switch warnings, auto-submit
   - Performance per competency
   - ITEM-BY-ITEM: ang tanong, lahat ng choices, ang sagot ng estudyante, at ang tamang sagot
   - Evidence ID (hash ng LRN + assessment + score + timestamp) para ma-trace sa record sa Google Sheet
   - Signature blocks: Student, Parent/Guardian, Teacher

   Output: Print / Save as PDF (browser) at Word (.docx via docx@8.5.0).

   NOTA SA DATA:
   - Ang quiz engine ay nagra-randomize ng ORDER ng tanong at ng CHOICES para sa bawat estudyante,
     at ang naitatala lang ay ang tanong, ang susi ng sagot na pinili, at ang tamang susi. Kaya ang
     evidence ay sumusunod sa ORDER NG TANONG na nakita ng estudyante, at ipinapakita ang mga sagot
     sa pamamagitan ng TEXT ng choice (hindi letra), para hindi magkamali.
   - Ang laman ng record ay ang PINAKAHULING attempt na naka-save para sa assessment na iyon.
   ============================================================ */
window.Evidence = (function () {
  'use strict';

  /* ===== APP-SPECIFIC SETTINGS (i-edit dito kung iba ang pangalan sa app mo) ===== */
  var APP_NAME   = 'General Science Online Modular Application';   // lalabas sa footer ng evidence
  var ID_PREFIX  = 'GS';                                            // Evidence ID: GS-XXXXXXXX
  var TOKEN_KEY  = 'gsa_teacher_token';                             // sessionStorage key ng teacher password/token
  var TOKEN_KEYS_FALLBACK = ['gba_teacher_token'];                  // iba pang posibleng key na babasahin din
  var BANK_DIRS  = ['../data/', 'data/'];                           // saan hahanapin ang question bank JSON
  // Pangalan ng question bank file: data/<subject>-<code>.json  (hal. data/gensci-quiz1.json)
  function bankFile(subject, code) { return subject + '-' + code + '.json'; }

  var SUBJECTS = { gensci: 'General Science' };

  var ASSESSMENTS = [
    { code: 'quiz1', label: 'Quiz 1', bucket: 'quizzes' },
    { code: 'quiz2', label: 'Quiz 2', bucket: 'quizzes' },
    { code: 'quiz3', label: 'Quiz 3', bucket: 'quizzes' },
    { code: 'st1',   label: 'Summative Test 1', bucket: 'st' },
    { code: 'st2',   label: 'Summative Test 2', bucket: 'st' },
    { code: 'te',    label: 'Term Exam', bucket: 'te' }
  ];

  var PAPERS = {
    letter: { label: 'Short bond (Letter 8.5 × 11 in)', css: '8.5in 11in',   w: 12240, h: 15840 },
    a4:     { label: 'A4 (210 × 297 mm)',               css: '210mm 297mm', w: 11906, h: 16838 },
    long:   { label: 'Long bond (8.5 × 13 in)',         css: '8.5in 13in',  w: 12240, h: 18720 }
  };

  // I-edit dito ang school year. Ang ibang info ay kinukuha sa CONFIG.DEVELOPER (config.js).
  var DEFAULT_SCHOOL_YEAR = 'S.Y. 2026-2027';

  /* ---------- school info ---------- */
  function schoolInfo() {
    var dev = (typeof CONFIG !== 'undefined' && CONFIG.DEVELOPER) || {};
    var o = window.SCHOOL_INFO || {};
    var rawName = o.teacherName || dev.name || '';
    return {
      region: o.region || dev.region || '',
      division: o.division || dev.division || '',
      district: o.district || dev.district || '',
      schoolName: (o.schoolName || dev.school || '').toUpperCase(),
      schoolYear: o.schoolYear || DEFAULT_SCHOOL_YEAR,
      teacherName: rawName,
      teacherPosition: o.teacherPosition || dev.position || '',
      gradeLevel: o.gradeLevel || 'Grade 11'
    };
  }

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function plain(s) {   // para sa docx: tanggalin ang HTML tags kung mayroon
    return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  function fmtDate(d) { if (!d) return '—'; var dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { if (!d) return ''; var dt = new Date(d); return isNaN(dt) ? '' : dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function fmtDuration(sec) {
    sec = Number(sec); if (!sec || sec < 0) return '—';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ' min ' + (s < 10 ? '0' : '') + s + ' sec';
  }
  function fullName(st) {
    if (!st) return '(Unknown)';
    var ln = String(st.lastName || '').toUpperCase(), fn = st.firstName || '', mn = st.middleName || '';
    if (!ln && !fn) return '(Unnamed)';
    return ln + ', ' + fn + (mn ? ' ' + mn : '');
  }
  function fmtLRN(l) { return String(l || ''); }
  function hash8(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }
  function isFlat(o) {
    return !!o && typeof o === 'object' && ['score', 'percent', 'total', 'passed'].some(function (k) { return o[k] !== undefined && typeof o[k] !== 'object'; });
  }

  /* ---------- data: students ---------- */
  function normalizeScores(scores) {
    var out = {};
    Object.keys(scores || {}).forEach(function (subj) {
      var s = scores[subj]; if (!s || typeof s !== 'object') return;
      out[subj] = {};
      Object.keys(s).forEach(function (t) {
        var v = s[t]; if (v === null || v === undefined || typeof v !== 'object') { out[subj][t] = {}; return; }
        if (t === 'te' && isFlat(v)) { var e = {}; e[subj + '-te'] = v; v = e; }   // lumang flat na Term Exam
        out[subj][t] = v;
      });
    });
    return out;
  }

  function fromLocal() {
    var users = (typeof Store !== 'undefined' && Store.getAllUsers) ? Store.getAllUsers() : [];
    return users.map(function (u) {
      return { lrn: u.lrn, lastName: u.lastName, firstName: u.firstName, middleName: u.middleName,
               gradeLevel: u.gradeLevel, section: u.section, scores: normalizeScores(Store.getScores(u.lrn)) };
    });
  }

  /**
   * Kinukuha ang pinakabagong data ng lahat ng estudyante.
   * 1) Kung may TeacherSync (auto-sync): mag-sync sa Google Sheet, tapos basahin ang Store.
   * 2) Kung wala: direktang kuha sa backend (getAllStudentsAggregated) gamit ang teacher token.
   * 3) Kung pumalya: gamitin ang data na naka-save sa device na ito.
   * @returns {{students:Array, source:'cloud'|'local', error?:string}}
   */
  async function loadStudents(opts) {
    opts = opts || {};
    var cloudOn = typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
    if (cloudOn && window.TeacherSync && TeacherSync.syncNow) {
      var r = await TeacherSync.syncNow({ ask: !!opts.ask });
      if (r && r.ok) return { students: fromLocal(), source: 'cloud' };
      return { students: fromLocal(), source: 'local', error: r && r.error };
    }
    if (cloudOn) {
      var token = '';
      try { token = sessionStorage.getItem(TOKEN_KEY) || ''; for (var k = 0; k < TOKEN_KEYS_FALLBACK.length && !token; k++) token = sessionStorage.getItem(TOKEN_KEYS_FALLBACK[k]) || ''; } catch (e) { /* ignore */ }
      if (!token && opts.ask) { token = prompt('Enter teacher password to load students from the Google Sheet:') || ''; if (token) { try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ } } }
      if (token) {
        try {
          var res = await fetch(CONFIG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getAllStudentsAggregated', token: token }) });
          var text = await res.text();
          var data = JSON.parse(text);
          if (data.ok) {
            return { source: 'cloud', students: (data.students || []).map(function (s) { s.scores = normalizeScores(s.scores); return s; }) };
          }
          return { students: fromLocal(), source: 'local', error: data.error || 'Backend error' };
        } catch (e) { return { students: fromLocal(), source: 'local', error: e.message }; }
      }
    }
    return { students: fromLocal(), source: 'local', error: cloudOn ? 'NO_TOKEN' : 'Backend not configured' };
  }

  /* ---------- data: question bank ---------- */
  var _bankCache = {};
  async function loadBank(subject, code) {
    var key = subject + '-' + code;
    if (_bankCache[key]) return _bankCache[key];
    var paths = BANK_DIRS.map(function (d) { return d + bankFile(subject, code); });
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(paths[i] + '?v=' + Date.now());
        if (res.ok) { _bankCache[key] = await res.json(); return _bankCache[key]; }
      } catch (e) { /* subukan ang susunod */ }
    }
    throw new Error('Hindi ma-load ang question bank (' + key + '.json). I-check ang internet.');
  }

  /* ---------- model ---------- */
  function findAssessment(code) { return ASSESSMENTS.filter(function (a) { return a.code === code; })[0] || null; }

  function getEntry(student, subject, code) {
    var a = findAssessment(code); if (!a) return null;
    var s = ((student.scores || {})[subject]) || {};
    var bucket = s[a.bucket];
    if (!bucket) return null;
    if (a.bucket === 'te' && isFlat(bucket)) return bucket;
    var e = bucket[subject + '-' + code];
    return (e && e.score !== null && e.score !== undefined) ? e : null;
  }

  function buildModel(student, subject, code, bank, opts) {
    opts = opts || {};
    var a = findAssessment(code);
    var entry = getEntry(student, subject, code);
    if (!entry) return null;

    var byId = {};
    (bank.items || []).forEach(function (q) { if (q && q.id != null) byId[String(q.id)] = q; });

    var breakdown = Array.isArray(entry.breakdown) ? entry.breakdown : [];
    var keyMismatch = 0;
    var items = breakdown.map(function (b, i) {
      var q = byId[String(b.id)] || null;
      var opts2 = (q && q.options) || [];
      function labelOf(k) { var o = opts2.filter(function (x) { return x.key === k; })[0]; return o ? o.label : null; }
      var givenLabel = (b.given === undefined || b.given === null || b.given === '') ? null : (labelOf(b.given) || '(' + b.given + ')');
      var correctLabel = labelOf(b.correct) || (b.correct ? '(' + b.correct + ')' : '(unknown)');
      var bankCorrect = opts2.filter(function (x) { return x.correct; })[0];
      if (bankCorrect && b.correct && bankCorrect.key !== b.correct) keyMismatch++;
      return {
        no: i + 1,
        text: q ? q.text : '(Question text not found in the current question bank)',
        competency: b.competency || (q && q.competency) || 'General',
        options: opts2.map(function (o) { return { label: o.label, isCorrect: o.key === b.correct, isGiven: b.given !== undefined && o.key === b.given }; }),
        givenLabel: givenLabel,
        correctLabel: correctLabel,
        isCorrect: !!b.isCorrect
      };
    });

    var total = entry.total != null ? entry.total : (items.length || (bank.items || []).length);
    var correct = entry.score != null ? entry.score : items.filter(function (x) { return x.isCorrect; }).length;
    var percent = entry.percent != null ? entry.percent : (total ? Math.round(correct / total * 100) : 0);
    var passing = bank.passingScore || 80;

    var comp = {};
    items.forEach(function (it) {
      var c = comp[it.competency] || (comp[it.competency] = { code: it.competency, total: 0, correct: 0 });
      c.total++; if (it.isCorrect) c.correct++;
    });

    var ts = entry.timestamp || (entry.override && entry.override.at) || '';
    var level = (typeof Transmutation !== 'undefined' && Transmutation.proficiencyLevel) ? Transmutation.proficiencyLevel(percent).level : '';

    return {
      student: student, subject: subject, subjectName: SUBJECTS[subject] || subject,
      code: code, label: a.label, title: bank.title || a.label,
      entry: entry, items: items, hasItems: items.length > 0,
      correct: correct, total: total, wrong: Math.max(0, total - correct), percent: percent,
      passing: passing, passed: percent >= passing, level: level,
      competencies: Object.keys(comp).map(function (k) { return comp[k]; }),
      takenAt: ts, durationSec: entry.durationSec || 0,
      tabViolations: entry.tabViolations || 0, autoSubmitted: !!entry.autoSubmitted,
      override: entry.override || null, keyMismatch: keyMismatch,
      evidenceId: ID_PREFIX + '-' + hash8([student.lrn, subject + '-' + code, ts, correct, total].join('|'))
    };
  }

  /* ---------- HTML (preview + print) ---------- */
  var CSS = [
    '.ev-page{background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;box-sizing:border-box;}',
    '.ev-c{text-align:center;margin:0;}',
    '.ev-title{font-size:14pt;font-weight:700;letter-spacing:.5px;margin:10px 0 8px;text-align:center;}',
    '.ev-info{width:100%;border-collapse:collapse;margin-bottom:8px;}',
    '.ev-info td{border:1px solid #000;padding:4px 8px;font-size:10.5pt;}',
    '.ev-info td.k{width:28%;background:#f1f1f1;font-weight:700;}',
    '.ev-h{font-size:12pt;font-weight:700;margin:14px 0 6px;border-bottom:2px solid #000;padding-bottom:2px;break-after:avoid;page-break-after:avoid;}',
    '.ev-result{display:flex;gap:8px;margin:6px 0;}',
    '.ev-box{flex:1;border:1px solid #000;text-align:center;padding:6px 4px;}',
    '.ev-box b{display:block;font-size:15pt;}',
    '.ev-box span{font-size:8.5pt;text-transform:uppercase;letter-spacing:.3px;}',
    '.ev-pass{color:#1b5e20;}.ev-fail{color:#b71c1c;}',
    '.ev-tbl{width:100%;border-collapse:collapse;font-size:10pt;}',
    '.ev-tbl th,.ev-tbl td{border:1px solid #000;padding:3px 6px;text-align:left;}',
    '.ev-tbl th{background:#f1f1f1;}',
    '.ev-item{margin:0 0 9px;break-inside:avoid;page-break-inside:avoid;}',
    '.ev-q{font-weight:700;margin:0 0 2px;}',
    '.ev-o{margin:0 0 1px 22px;font-size:10.5pt;}',
    '.ev-o.c{font-weight:700;}',
    '.ev-ans{margin:3px 0 0 22px;font-size:10.5pt;}',
    '.ev-ok{color:#1b5e20;}.ev-no{color:#b71c1c;}',
    '.ev-note{font-size:9pt;color:#444;margin:4px 0;background:none;border:0;padding:0;break-after:avoid;page-break-after:avoid;}',
    '.ev-sign{display:flex;gap:24px;margin-top:26px;break-inside:avoid;page-break-inside:avoid;}',
    '.ev-sign div{flex:1;text-align:center;font-size:10pt;}',
    '.ev-line{border-top:1px solid #000;margin-top:34px;padding-top:3px;font-weight:700;}',
    '.ev-foot{font-size:8.5pt;color:#555;margin-top:12px;text-align:center;}'
  ].join('\n');

  function pageHtml(m, o) {
    var s = schoolInfo(), st = m.student;
    var html = [];
    html.push('<div class="ev-page">');
    html.push('<p class="ev-c"><b>REPUBLIC OF THE PHILIPPINES</b></p><p class="ev-c"><b>DEPARTMENT OF EDUCATION</b></p>');
    html.push('<p class="ev-c" style="font-size:10pt">' + esc(s.region) + ' — ' + esc(s.division) + (s.district ? ' — ' + esc(s.district) : '') + '</p>');
    html.push('<p class="ev-c" style="font-size:13pt"><b>' + esc(s.schoolName) + '</b></p><p class="ev-c" style="font-size:10pt">' + esc(s.schoolYear) + '</p>');
    html.push('<div class="ev-title">EXAMINATION EVIDENCE RECORD</div>');

    html.push('<table class="ev-info">' + [
      ['Student Name', fullName(st)], ['LRN', fmtLRN(st.lrn)],
      ['Grade & Section', (st.gradeLevel ? 'Grade ' + String(st.gradeLevel).replace(/^grade\s*/i, '') : s.gradeLevel) + ' - ' + (st.section || '—')],
      ['Subject', m.subjectName], ['Assessment', m.label + ' — ' + m.title],
      ['Date & Time Taken', m.override ? fmtDate(m.override.takenOn || m.takenAt) + ' (recorded by teacher)' : fmtDate(m.takenAt) + (fmtTime(m.takenAt) ? ', ' + fmtTime(m.takenAt) : '')]
    ].map(function (r) { return '<tr><td class="k">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>');

    html.push('<div class="ev-h">RESULT</div><div class="ev-result">' +
      '<div class="ev-box"><b>' + m.correct + ' / ' + m.total + '</b><span>Score</span></div>' +
      '<div class="ev-box"><b>' + m.percent + '%</b><span>Percentage</span></div>' +
      '<div class="ev-box"><b class="' + (m.passed ? 'ev-pass' : 'ev-fail') + '">' + (m.passed ? 'PASSED' : 'NOT YET PASSED') + '</b><span>Passing: ' + m.passing + '%</span></div>' +
      (m.level ? '<div class="ev-box"><b style="font-size:9.5pt;line-height:1.5">' + esc(m.level) + '</b><span>Proficiency</span></div>' : '') + '</div>');

    var facts = [];
    if (m.durationSec) facts.push('Time used: ' + fmtDuration(m.durationSec));
    if (m.hasItems) facts.push('Tab-switch warnings: ' + m.tabViolations);
    if (m.autoSubmitted) facts.push('Auto-submitted (time up / too many tab switches)');
    if (facts.length) html.push('<p class="ev-note">' + esc(facts.join('  •  ')) + '</p>');
    if (m.override) html.push('<p class="ev-note"><b>Note:</b> This score was entered/verified by the teacher' + (m.override.reason ? ' (' + esc(m.override.reason) + ')' : '') + '. Item-level answers are not available for paper-based or manually entered scores.</p>');

    if (o.competencies !== false && m.competencies.length) {
      html.push('<div class="ev-h">PERFORMANCE PER COMPETENCY</div><table class="ev-tbl"><tr><th>Competency code</th><th style="width:70px">Correct</th><th style="width:70px">Items</th><th style="width:70px">%</th></tr>' +
        m.competencies.map(function (c) { return '<tr><td>' + esc(c.code) + '</td><td>' + c.correct + '</td><td>' + c.total + '</td><td>' + Math.round(c.correct / c.total * 100) + '%</td></tr>'; }).join('') + '</table>');
    }

    if (o.items !== false) {
      html.push('<div class="ev-h">ITEM-BY-ITEM ANSWERS</div>');
      if (!m.hasItems) {
        html.push('<p class="ev-note">Walang item-level record para sa assessment na ito (paper-based o manually entered ang score). Ang resulta sa itaas ang opisyal na record.</p>');
      } else {
        html.push('<p class="ev-note">Ang bawat estudyante ay may kani-kaniyang pagkakasunod-sunod ng tanong at ng mga choices, kaya ang mga sagot ay nakasulat sa buong text at hindi sa letra. ✓ = tamang sagot · ✗ = sagot ng estudyante (mali).</p>');
        m.items.forEach(function (it) {
          html.push('<div class="ev-item"><p class="ev-q">' + it.no + '. ' + esc(it.text) + '</p>');
          it.options.forEach(function (op) {
            var mark = op.isCorrect ? ' ✓' : (op.isGiven ? ' ✗' : '');
            html.push('<p class="ev-o' + (op.isCorrect ? ' c' : '') + '">' + (op.isGiven ? '☒' : '☐') + ' ' + esc(op.label) + mark + '</p>');
          });
          html.push('<p class="ev-ans ' + (it.isCorrect ? 'ev-ok' : 'ev-no') + '">Student’s answer: <b>' + esc(it.givenLabel == null ? '(no answer)' : it.givenLabel) + '</b> — ' + (it.isCorrect ? 'CORRECT' : 'WRONG') +
            (it.isCorrect ? '' : '<br/>Correct answer: <b>' + esc(it.correctLabel) + '</b>') + '</p></div>');
        });
      }
    }

    html.push('<div class="ev-h">SUMMARY</div><p><b>Correct: ' + m.correct + ' &nbsp;|&nbsp; Wrong/Unanswered: ' + m.wrong + ' &nbsp;|&nbsp; Score: ' + m.percent + '% &nbsp;|&nbsp; Remarks: <span class="' + (m.passed ? 'ev-pass' : 'ev-fail') + '">' + (m.passed ? 'PASSED' : 'NOT YET PASSED') + '</span></b></p>');
    html.push('<p class="ev-note">Parent/Guardian’s comment (optional): ______________________________________________________________</p>');

    html.push('<div class="ev-sign">' +
      (o.studentSign !== false ? '<div><div class="ev-line">' + esc(fullName(st)) + '</div>Student (signature over printed name)</div>' : '') +
      '<div><div class="ev-line">&nbsp;</div>Parent / Guardian<br/>(signature over printed name)<br/><br/>Date: ______________</div>' +
      '<div><div class="ev-line">' + esc(s.teacherName) + '</div>' + esc(s.teacherPosition) + '</div></div>');

    html.push('<p class="ev-foot">Evidence ID: <b>' + m.evidenceId + '</b> · Generated ' + esc(new Date().toLocaleString('en-PH')) + ' · ' + esc(APP_NAME) +
      (m.keyMismatch ? '<br/>Note: the answer key of ' + m.keyMismatch + ' item(s) was revised after this exam was taken; the stored result is shown.' : '') + '</p>');
    html.push('</div>');
    return html.join('');
  }

  /** HTML ng lahat ng pages (isa bawat estudyante, may page-break). */
  function renderHtml(models, o) {
    return models.map(function (m, i) {
      return '<div class="ev-sheet" style="' + (i < models.length - 1 ? 'break-after:page;page-break-after:always;' : '') + '">' + pageHtml(m, o || {}) + '</div>';
    }).join('');
  }

  function paperCss(paperKey) {
    var p = PAPERS[paperKey] || PAPERS.letter;
    return '@page{size:' + p.css + ';margin:0.6in;}\n' + CSS;
  }

  /* ---------- DOCX ---------- */
  async function toDocx(models, o, paperKey) {
    var D = window.docx;
    if (!D || !D.Document) throw new Error('Hindi naka-load ang docx library. I-check ang internet.');
    var paper = PAPERS[paperKey] || PAPERS.letter;
    var s = schoolInfo();
    var AL = D.AlignmentType, BS = D.BorderStyle, WT = D.WidthType;
    var bd = { style: BS.SINGLE, size: 4, color: '000000' };
    var borders = { top: bd, bottom: bd, left: bd, right: bd };

    function run(text, x) { x = x || {}; return new D.TextRun({ text: text == null ? '' : String(text), bold: !!x.bold, italics: !!x.italics, size: x.size || 21, color: x.color, font: 'Calibri' }); }
    function para(text, x) {
      x = x || {};
      return new D.Paragraph({ alignment: x.align || AL.LEFT, spacing: x.spacing || { after: 50 }, indent: x.indent, keepNext: !!x.keepNext, keepLines: true, pageBreakBefore: !!x.pageBreakBefore,
        children: Array.isArray(text) ? text : [run(text, x)] });
    }
    function cell(text, x) {
      x = x || {};
      return new D.TableCell({ width: x.w ? { size: x.w, type: WT.PERCENTAGE } : undefined, borders: borders, shading: x.fill ? { fill: x.fill } : undefined,
        children: [new D.Paragraph({ alignment: x.align || AL.LEFT, children: [run(text, { bold: x.bold, size: x.size || 20, color: x.color })] })] });
    }

    var children = [];
    models.forEach(function (m, idx) {
      var st = m.student;
      var first = idx === 0;
      children.push(para('REPUBLIC OF THE PHILIPPINES', { bold: true, align: AL.CENTER, pageBreakBefore: !first, spacing: { after: 0 } }));
      children.push(para('DEPARTMENT OF EDUCATION', { bold: true, align: AL.CENTER, spacing: { after: 0 } }));
      children.push(para(s.region + ' — ' + s.division + (s.district ? ' — ' + s.district : ''), { align: AL.CENTER, size: 19, spacing: { after: 0 } }));
      children.push(para(s.schoolName, { bold: true, align: AL.CENTER, size: 26, spacing: { after: 0 } }));
      children.push(para(s.schoolYear, { align: AL.CENTER, size: 19, spacing: { after: 100 } }));
      children.push(para('EXAMINATION EVIDENCE RECORD', { bold: true, align: AL.CENTER, size: 28, spacing: { before: 100, after: 120 } }));

      var info = [
        ['Student Name', fullName(st)], ['LRN', fmtLRN(st.lrn)],
        ['Grade & Section', (st.gradeLevel ? 'Grade ' + String(st.gradeLevel).replace(/^grade\s*/i, '') : s.gradeLevel) + ' - ' + (st.section || '—')],
        ['Subject', m.subjectName], ['Assessment', m.label + ' — ' + m.title],
        ['Date & Time Taken', m.override ? fmtDate(m.override.takenOn || m.takenAt) + ' (recorded by teacher)' : fmtDate(m.takenAt) + (fmtTime(m.takenAt) ? ', ' + fmtTime(m.takenAt) : '')]
      ];
      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: info.map(function (r) { return new D.TableRow({ children: [cell(r[0], { bold: true, fill: 'F1F1F1', w: 28 }), cell(r[1], { w: 72 })] }); }) }));

      children.push(para('RESULT', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
      var res = [['Score', m.correct + ' / ' + m.total], ['Percentage', m.percent + '%'], ['Remarks', (m.passed ? 'PASSED' : 'NOT YET PASSED') + ' (passing: ' + m.passing + '%)']];
      if (m.level) res.push(['Proficiency', m.level]);
      if (m.durationSec) res.push(['Time used', fmtDuration(m.durationSec)]);
      if (m.hasItems) res.push(['Tab-switch warnings', String(m.tabViolations) + (m.autoSubmitted ? ' (auto-submitted)' : '')]);
      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: res.map(function (r) { return new D.TableRow({ children: [cell(r[0], { bold: true, fill: 'F1F1F1', w: 28 }), cell(r[1], { w: 72, bold: r[0] === 'Remarks', color: r[0] === 'Remarks' ? (m.passed ? '1B5E20' : 'B71C1C') : undefined })] }); }) }));
      if (m.override) children.push(para('Note: This score was entered/verified by the teacher' + (m.override.reason ? ' (' + m.override.reason + ')' : '') + '. Item-level answers are not available for paper-based or manually entered scores.', { italics: true, size: 18, spacing: { before: 60 } }));

      if (o.competencies !== false && m.competencies.length) {
        children.push(para('PERFORMANCE PER COMPETENCY', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
        var rows = [new D.TableRow({ tableHeader: true, children: [cell('Competency code', { bold: true, fill: 'F1F1F1', w: 55 }), cell('Correct', { bold: true, fill: 'F1F1F1', w: 15 }), cell('Items', { bold: true, fill: 'F1F1F1', w: 15 }), cell('%', { bold: true, fill: 'F1F1F1', w: 15 })] })];
        m.competencies.forEach(function (c) { rows.push(new D.TableRow({ children: [cell(c.code, { w: 55 }), cell(c.correct, { w: 15 }), cell(c.total, { w: 15 }), cell(Math.round(c.correct / c.total * 100) + '%', { w: 15 })] })); });
        children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: rows }));
      }

      if (o.items !== false) {
        children.push(para('ITEM-BY-ITEM ANSWERS', { bold: true, size: 24, spacing: { before: 240, after: 80 }, keepNext: true }));
        if (!m.hasItems) {
          children.push(para('Walang item-level record para sa assessment na ito (paper-based o manually entered ang score). Ang resulta sa itaas ang opisyal na record.', { italics: true, size: 19 }));
        } else {
          children.push(para('Ang bawat estudyante ay may kani-kaniyang pagkakasunod-sunod ng tanong at ng mga choices, kaya ang mga sagot ay nakasulat sa buong text at hindi sa letra. ✓ = tamang sagot · ✗ = sagot ng estudyante (mali).', { italics: true, size: 17, spacing: { after: 100 } }));
          m.items.forEach(function (it) {
            children.push(para(it.no + '. ' + plain(it.text), { bold: true, size: 21, spacing: { before: 100, after: 20 }, keepNext: true }));
            it.options.forEach(function (op) {
              children.push(para((op.isGiven ? '☒ ' : '☐ ') + plain(op.label) + (op.isCorrect ? '  ✓' : (op.isGiven ? '  ✗' : '')), { bold: op.isCorrect, size: 20, spacing: { after: 10 }, indent: { left: 400 }, keepNext: true }));
            });
            children.push(para('Student’s answer: ' + plain(it.givenLabel == null ? '(no answer)' : it.givenLabel) + ' — ' + (it.isCorrect ? 'CORRECT' : 'WRONG'), { bold: true, size: 20, color: it.isCorrect ? '1B5E20' : 'B71C1C', spacing: { before: 20, after: it.isCorrect ? 60 : 0 }, indent: { left: 400 }, keepNext: !it.isCorrect }));
            if (!it.isCorrect) children.push(para('Correct answer: ' + plain(it.correctLabel), { size: 20, color: '1B5E20', spacing: { after: 60 }, indent: { left: 400 } }));
          });
        }
      }

      children.push(para('SUMMARY', { bold: true, size: 24, spacing: { before: 240, after: 80 }, keepNext: true }));
      children.push(para('Correct: ' + m.correct + ' | Wrong/Unanswered: ' + m.wrong + ' | Score: ' + m.percent + '% | Remarks: ' + (m.passed ? 'PASSED' : 'NOT YET PASSED'), { bold: true, color: m.passed ? '1B5E20' : 'B71C1C', keepNext: true }));
      children.push(para('Parent/Guardian’s comment (optional): ______________________________________________', { size: 19, spacing: { before: 80, after: 200 }, keepNext: true }));

      var sigCells = [];
      var noB = { top: { style: BS.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BS.NONE, size: 0, color: 'FFFFFF' }, left: { style: BS.NONE, size: 0, color: 'FFFFFF' }, right: { style: BS.NONE, size: 0, color: 'FFFFFF' } };
      function sig(name, role) {
        return new D.TableCell({ borders: noB, width: { size: 33, type: WT.PERCENTAGE }, children: [
          new D.Paragraph({ spacing: { before: 520 }, alignment: AL.CENTER, border: { top: { style: BS.SINGLE, size: 6, color: '000000', space: 2 } }, children: [run(name, { bold: true, size: 20 })] }),
          new D.Paragraph({ alignment: AL.CENTER, children: [run(role, { size: 18 })] })
        ] });
      }
      if (o.studentSign !== false) sigCells.push(sig(fullName(st), 'Student (signature over printed name)'));
      sigCells.push(sig(' ', 'Parent / Guardian (signature over printed name)'));
      sigCells.push(sig(s.teacherName, s.teacherPosition));
      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, borders: { top: { style: BS.NONE }, bottom: { style: BS.NONE }, left: { style: BS.NONE }, right: { style: BS.NONE }, insideHorizontal: { style: BS.NONE }, insideVertical: { style: BS.NONE } }, rows: [new D.TableRow({ cantSplit: true, children: sigCells })] }));
      children.push(para('Parent/Guardian Date: ______________', { size: 19, spacing: { before: 120 } }));
      children.push(para('Evidence ID: ' + m.evidenceId + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · ' + APP_NAME + (m.keyMismatch ? ' · Note: the answer key of ' + m.keyMismatch + ' item(s) was revised after this exam was taken; the stored result is shown.' : ''), { size: 16, color: '555555', align: AL.CENTER, spacing: { before: 120 } }));
    });

    var doc = new D.Document({
      creator: s.teacherName || 'Teacher',
      title: 'Exam Evidence — ' + (models.length === 1 ? fullName(models[0].student) : models.length + ' students'),
      sections: [{ properties: { page: { size: { width: paper.w, height: paper.h }, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } }, children: children }]
    });
    return D.Packer.toBlob(doc);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function safeName(s) { return String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

  return {
    SUBJECTS: SUBJECTS, ASSESSMENTS: ASSESSMENTS, PAPERS: PAPERS,
    loadStudents: loadStudents, loadBank: loadBank, getEntry: getEntry, buildModel: buildModel,
    renderHtml: renderHtml, paperCss: paperCss, toDocx: toDocx, download: download,
    fullName: fullName, safeName: safeName, findAssessment: findAssessment
  };
})();

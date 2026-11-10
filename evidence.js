/* ============================================================
   evidence.js — Exam Evidence (General Science, Grade 11)
   Version: 2.0.0
   ------------------------------------------------------------
   Printable "Examination Evidence Record" ng isang estudyante (o ng buong section)
   para sa Quiz 1–3, Summative Test 1–2, at Term Exam ng Term 1–3.
   Output: Preview / Print / Save as PDF (browser) at Word (.docx via docx@8.5.0).

   v2.0.0 — ALIGNMENT FIX (evidence ↔ actual exam ng estudyante)
   ------------------------------------------------------------
   DATING PROBLEMA: Ang tanong ay hinahanap sa KASALUKUYANG question bank (student/termN/assessments/*.json)
   gamit ang questionId / originalIndex / index — walang beripikasyon. Kapag nabago ang bank pagkatapos
   kunin ng estudyante ang exam (revised ang content, na-retag, na-revert/na-regenerate, nagbago ang
   ayos o ID ng mga item), iba na ang tanong/choices na lumalabas, kaya lumilipat ang "mali" sa ibang item.

   AYOS: Ang naka-save na itemResults ng estudyante ang SOURCE OF TRUTH (given, expected, correct, order).
   Bawat item ay ibinabalik sa tamang tanong sa bank LAMANG kung TUGMA (ang `expected` ay ang tamang sagot
   ng tanong at ang `given` ay isa sa choices). Pagkakasunod ng pagsubok: questionId → originalIndex → index
   → paghahanap sa buong bank (kung isa lang ang tugma). Kapag walang tugma, HINDI maglalagay ng maling
   tanong; ipapakita ang naka-save na sagot ng estudyante at lalagyan ng paliwanag.
   Ang numero at pagkakasunod ng item ay ang mismong ayos na nakita ng estudyante (set A/B shuffle).
   ============================================================ */
window.Evidence = (function () {
  'use strict';

  /* ===== APP-SPECIFIC SETTINGS ===== */
  var APP_NAME  = 'General Science Online Modular Application';
  var ID_PREFIX = 'GS';
  var TOKEN_KEY = 'gsa_teacher_token';
  var PASSING   = 75;                      // tugma sa passScore ng quiz-engine
  var SUBJECT_NAME = 'General Science';

  var TERMS = [
    { code: 'term1', label: 'Term 1' },
    { code: 'term2', label: 'Term 2' },
    { code: 'term3', label: 'Term 3' }
  ];

  var ASSESSMENTS = [
    { code: 'quiz1', label: 'Quiz 1',           bucket: 'quizzes' },
    { code: 'quiz2', label: 'Quiz 2',           bucket: 'quizzes' },
    { code: 'quiz3', label: 'Quiz 3',           bucket: 'quizzes' },
    { code: 'st1',   label: 'Summative Test 1', bucket: 'st' },
    { code: 'st2',   label: 'Summative Test 2', bucket: 'st' },
    { code: 'te',    label: 'Term Exam',        bucket: 'te' }
  ];

  var PAPERS = {
    letter: { label: 'Short bond (Letter 8.5 × 11 in)', css: '8.5in 11in',   w: 12240, h: 15840 },
    a4:     { label: 'A4 (210 × 297 mm)',               css: '210mm 297mm', w: 11906, h: 16838 },
    long:   { label: 'Long bond (8.5 × 13 in)',         css: '8.5in 13in',  w: 12240, h: 18720 }
  };

  /* ---------- school info (config.js → SCHOOL_INFO / CONFIG.DEVELOPER) ---------- */
  function schoolInfo() {
    var dev = (typeof CONFIG !== 'undefined' && CONFIG.DEVELOPER) || {};
    var o = window.SCHOOL_INFO || {};
    return {
      region: o.region || dev.region || '',
      division: o.division || dev.division || '',
      district: dev.district || '',
      schoolName: String(o.schoolName || dev.school || '').toUpperCase(),
      schoolAddress: o.schoolAddress || '',
      schoolYear: o.schoolYear || '',
      teacherName: o.teacherName || dev.name || '',
      teacherPosition: o.teacherPosition || dev.position || '',
      gradeLevel: o.gradeLevel || 'Grade 11'
    };
  }

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plain(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  function norm(s) { return plain(s).replace(/\s+/g, ' ').trim(); }
  function fmtDate(d) { if (!d) return '—'; var dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { if (!d) return ''; var dt = new Date(d); return isNaN(dt) ? '' : dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function fmtDuration(sec) { sec = Math.round(Number(sec)); if (!sec || sec < 0) return '—'; var m = Math.floor(sec / 60), s = sec % 60; return m + ' min ' + (s < 10 ? '0' : '') + s + ' sec'; }
  function fullName(st) {
    if (!st) return '(Unknown)';
    var ln = String(st.lastName || '').toUpperCase(), fn = st.firstName || '', mn = st.middleName || '';
    if (!ln && !fn) return st.name || '(Unnamed)';
    return ln + ', ' + fn + (mn ? ' ' + mn : '');
  }
  function hash8(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(16).toUpperCase().padStart(8, '0'); }
  function safeName(s) { return String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function findAssessment(code) { return ASSESSMENTS.filter(function (a) { return a.code === code; })[0] || null; }
  function findTerm(code) { return TERMS.filter(function (t) { return t.code === code; })[0] || null; }
  function isRecord(o) { return !!o && typeof o === 'object' && (o.score !== undefined || o.percent !== undefined || Array.isArray(o.itemResults)); }

  /* ---------- data: students ---------- */
  function parseMaybe(v) { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return v || {}; }

  function normStudent(s) {
    var prog = parseMaybe(s.progress || s.progressJSON || s.progressData);
    var scores = parseMaybe(s.scores || prog.scores);
    return {
      lrn: s.lrn || s.LRN, lastName: s.lastName, firstName: s.firstName, middleName: s.middleName,
      name: s.name, gradeLevel: s.gradeLevel, section: s.section || s.Section || '', scores: scores
    };
  }

  function fromLocal() {
    var users = (typeof Store !== 'undefined' && Store.getAllUsers) ? Store.getAllUsers() : [];
    return users.map(function (u) {
      return { lrn: u.lrn, lastName: u.lastName, firstName: u.firstName, middleName: u.middleName,
               gradeLevel: u.gradeLevel, section: u.section, scores: Store.getScores(u.lrn) || {} };
    });
  }

  /** @returns {{students:Array, source:'cloud'|'local', error?:string}} */
  async function loadStudents(opts) {
    opts = opts || {};
    var cloudOn = typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
    if (cloudOn) {
      var token = '';
      try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* ignore */ }
      if (!token && opts.ask) {
        token = prompt('Enter teacher password to load students from the Google Sheet:') || '';
        if (token) { try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ } }
      }
      if (!token && CONFIG.TEACHER_PASSWORD_HASH) token = CONFIG.TEACHER_PASSWORD_HASH;
      if (token) {
        try {
          var res = await fetch(CONFIG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'pullTeacherDashboard', token: token }) });
          var data = JSON.parse(await res.text());
          var list = data && data.ok ? (data.students || data.records || []) : null;
          if (list && list.length) return { source: 'cloud', students: list.map(normStudent) };
          return { students: fromLocal(), source: 'local', error: (data && data.error) || 'No students returned' };
        } catch (e) { return { students: fromLocal(), source: 'local', error: e.message }; }
      }
    }
    return { students: fromLocal(), source: 'local', error: cloudOn ? 'NO_TOKEN' : 'Backend not configured' };
  }

  /* ---------- data: question bank ---------- */
  var _bankCache = {};
  async function loadBank(term, code) {
    var key = term + '/' + code;
    if (_bankCache[key]) return _bankCache[key];
    var paths = ['../student/' + term + '/assessments/' + code + '.json', 'student/' + term + '/assessments/' + code + '.json'];
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(paths[i] + '?v=' + Date.now(), { cache: 'no-store' });
        if (res.ok) { _bankCache[key] = await res.json(); return _bankCache[key]; }
      } catch (e) { /* subukan ang susunod */ }
    }
    throw new Error('Hindi ma-load ang question bank (' + key + '.json). I-check ang internet.');
  }

  /* ---------- record lookup ---------- */
  function getEntry(student, term, code) {
    var a = findAssessment(code); if (!a) return null;
    var t = ((student.scores || {})[term]) || null;
    if (!t) return null;
    var e = null;
    if (a.bucket === 'te') {
      var te = t.te;
      e = isRecord(te) ? te : (te && isRecord(te.te) ? te.te : null);   // flat o nested (scores.termN.te.te)
    } else {
      e = t[a.bucket] && t[a.bucket][code];
    }
    return isRecord(e) ? e : null;
  }

  /* ---------- ALIGNMENT: ibalik ang bawat naka-save na item sa tamang tanong ---------- */
  function fits(q, r) {
    if (!q || !Array.isArray(q.options)) return false;
    var opts = q.options.map(norm);
    if (r.expected != null && r.expected !== '') {
      if (norm(q.correct) !== norm(r.expected)) return false;
      if (opts.indexOf(norm(r.expected)) < 0) return false;
    }
    if (r.given != null && r.given !== '' && opts.indexOf(norm(r.given)) < 0) return false;
    // Dagdag na pagkakakilanlan: kung naka-save ang competency/bloom ng item, dapat tugma rin sa tanong.
    if (r.competency && q.competency && norm(r.competency) !== norm(q.competency)) return false;
    if (r.bloomLevel && q.bloomLevel && norm(r.bloomLevel) !== norm(q.bloomLevel)) return false;
    return true;
  }

  function resolveQuestion(r, bank, used) {
    var qs = bank.questions || [];
    var byId = {};
    qs.forEach(function (q) { if (q && q.id != null) byId[String(q.id)] = q; });
    var cands = [];
    if (r.questionId != null && byId[String(r.questionId)]) cands.push(byId[String(r.questionId)]);
    if (r.originalIndex != null && qs[r.originalIndex]) cands.push(qs[r.originalIndex]);
    if (r.index != null && qs[r.index]) cands.push(qs[r.index]);
    for (var i = 0; i < cands.length; i++) if (fits(cands[i], r)) return { q: cands[i], how: i === 0 ? 'id' : 'index' };
    var found = qs.filter(function (q) { return !used[q.id] && fits(q, r); });
    if (found.length === 1) return { q: found[0], how: 'search' };
    return { q: null, how: 'none' };   // walang tugma o malabo — huwag manghula ng tanong
  }

  function buildModel(student, term, code, bank) {
    var a = findAssessment(code), t = findTerm(term);
    var entry = getEntry(student, term, code);
    if (!entry) return null;

    var raw = Array.isArray(entry.itemResults) ? entry.itemResults.slice() : [];
    // Ayos ayon sa nakita ng estudyante (set index). Kung walang index, panatilihin ang naka-save na ayos.
    if (raw.length && raw.every(function (r) { return typeof r.index === 'number'; })) raw.sort(function (x, y) { return x.index - y.index; });

    var used = {}, stale = 0, relocated = 0;
    var items = raw.map(function (r, i) {
      var hit = resolveQuestion(r, bank, used);
      var q = hit.q;
      if (q) used[q.id] = true;
      if (!q) stale++; else if (hit.how === 'search') relocated++;
      var given = (r.given === undefined || r.given === null || r.given === '') ? null : plain(r.given);
      var expected = r.expected != null && r.expected !== '' ? plain(r.expected) : (q ? plain(q.correct) : '(unknown)');
      var isCorrect = typeof r.correct === 'boolean' ? r.correct : (given !== null && norm(given) === norm(expected));
      return {
        no: i + 1,
        found: !!q,
        text: q ? q.text : null,
        competency: r.competency || (q && q.competency) || 'General',
        options: q ? q.options.map(function (o) { return { label: o, isCorrect: norm(o) === norm(expected), isGiven: given !== null && norm(o) === norm(given) }; }) : [],
        givenLabel: given,
        correctLabel: expected,
        isCorrect: isCorrect
      };
    });

    var total = entry.total != null ? entry.total : (items.length || (bank.questions || []).length);
    var correct = entry.score != null ? entry.score : items.filter(function (x) { return x.isCorrect; }).length;
    var percent = entry.percent != null ? entry.percent : (total ? Math.round(correct / total * 100) : 0);

    var comp = {}, order = [];
    items.forEach(function (it) {
      var c = comp[it.competency];
      if (!c) { c = comp[it.competency] = { code: it.competency, total: 0, correct: 0 }; order.push(it.competency); }
      c.total++; if (it.isCorrect) c.correct++;
    });

    var itemCorrect = items.filter(function (x) { return x.isCorrect; }).length;
    var ts = entry.timestamp || '';
    var level = (typeof Transmutation !== 'undefined' && Transmutation.proficiencyLevel) ? Transmutation.proficiencyLevel(percent).level : '';

    return {
      student: student, term: term, termLabel: t ? t.label : term, code: code, label: a.label,
      title: (t ? t.label + ' — ' : '') + (bank.title || a.label),
      entry: entry, items: items, hasItems: items.length > 0,
      correct: correct, total: total, wrong: Math.max(0, total - correct), percent: percent,
      passing: PASSING, passed: percent >= PASSING, level: level,
      competencies: order.map(function (k) { return comp[k]; }),
      takenAt: ts, durationSec: entry.timeUsed || 0, setLetter: entry.set || '',
      stale: stale, relocated: relocated,
      countMismatch: items.length > 0 && itemCorrect !== correct,
      evidenceId: ID_PREFIX + '-' + hash8([student.lrn, term + '-' + code, ts, correct, total].join('|'))
    };
  }

  /* ---------- HTML (preview + print) — layout ng sample ---------- */
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

  var STALE_TEXT = '(Ang teksto ng tanong na ito ay nabago na sa question bank matapos ang exam, kaya ang naka-save na sagot lang ng estudyante ang ipinapakita.)';

  function infoRows(m, s) {
    var st = m.student;
    return [
      ['Student Name', fullName(st)], ['LRN', String(st.lrn || '')],
      ['Grade & Section', (st.gradeLevel ? 'Grade ' + String(st.gradeLevel).replace(/^grade\s*/i, '') : s.gradeLevel) + ' - ' + (st.section || '—')],
      ['Subject', SUBJECT_NAME], ['Assessment', m.label + ' — ' + m.title],
      ['Date & Time Taken', fmtDate(m.takenAt) + (fmtTime(m.takenAt) ? ', ' + fmtTime(m.takenAt) : '')]
    ].concat(m.setLetter ? [['Question Set', 'Set ' + m.setLetter]] : []);
  }

  function notesFor(m) {
    var n = [];
    if (m.stale) n.push(m.stale + ' item(s): nabago na ang tanong sa question bank matapos ang exam — ang naka-save na sagot ng estudyante ang ipinapakita (walang tanong/choices).');
    if (m.relocated) n.push(m.relocated + ' item(s) ay itinugma sa tanong sa bank gamit ang naka-save na sagot (nagbago ang ID/posisyon sa bank).');
    if (m.countMismatch) n.push('Paalala: ang bilang ng tamang item sa listahan ay hindi tugma sa naka-save na score (' + m.correct + '). Ang naka-save na score ang opisyal.');
    return n;
  }

  function pageHtml(m, o) {
    var s = schoolInfo();
    var st = m.student;
    var html = [];
    html.push('<div class="ev-page">');
    html.push('<p class="ev-c"><b>REPUBLIC OF THE PHILIPPINES</b></p><p class="ev-c"><b>DEPARTMENT OF EDUCATION</b></p>');
    html.push('<p class="ev-c" style="font-size:10pt">' + esc(s.region) + ' — ' + esc(s.division) + (s.district ? ' — ' + esc(s.district) : '') + '</p>');
    html.push('<p class="ev-c" style="font-size:13pt"><b>' + esc(s.schoolName) + '</b></p>');
    if (s.schoolAddress) html.push('<p class="ev-c" style="font-size:10pt">' + esc(s.schoolAddress) + '</p>');
    html.push('<p class="ev-c" style="font-size:10pt">' + esc(s.schoolYear) + '</p>');
    html.push('<div class="ev-title">EXAMINATION EVIDENCE RECORD</div>');

    html.push('<table class="ev-info">' + infoRows(m, s).map(function (r) { return '<tr><td class="k">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>');

    html.push('<div class="ev-h">RESULT</div><div class="ev-result">' +
      '<div class="ev-box"><b>' + m.correct + ' / ' + m.total + '</b><span>Score</span></div>' +
      '<div class="ev-box"><b>' + m.percent + '%</b><span>Percentage</span></div>' +
      '<div class="ev-box"><b class="' + (m.passed ? 'ev-pass' : 'ev-fail') + '">' + (m.passed ? 'PASSED' : 'NOT YET PASSED') + '</b><span>Passing: ' + m.passing + '%</span></div>' +
      (m.level ? '<div class="ev-box"><b style="font-size:9.5pt;line-height:1.5">' + esc(m.level) + '</b><span>Proficiency</span></div>' : '') + '</div>');

    if (m.durationSec) html.push('<p class="ev-note">Time used: ' + esc(fmtDuration(m.durationSec)) + '</p>');
    notesFor(m).forEach(function (n) { html.push('<p class="ev-note"><b>Note:</b> ' + esc(n) + '</p>'); });

    if (o.competencies !== false && m.competencies.length) {
      html.push('<div class="ev-h">PERFORMANCE PER COMPETENCY</div><table class="ev-tbl"><tr><th>Competency code</th><th style="width:70px">Correct</th><th style="width:70px">Items</th><th style="width:70px">%</th></tr>' +
        m.competencies.map(function (c) { return '<tr><td>' + esc(c.code) + '</td><td>' + c.correct + '</td><td>' + c.total + '</td><td>' + Math.round(c.correct / c.total * 100) + '%</td></tr>'; }).join('') + '</table>');
    }

    if (o.items !== false) {
      html.push('<div class="ev-h">ITEM-BY-ITEM ANSWERS</div>');
      if (!m.hasItems) {
        html.push('<p class="ev-note">Walang item-level record para sa assessment na ito. Ang resulta sa itaas ang opisyal na record.</p>');
      } else {
        html.push('<p class="ev-note">Ang numero at pagkakasunod ng mga tanong ay ang <b>mismong ayos na nakita ng estudyante</b> sa exam (Set ' + esc(m.setLetter || '—') + '). ☒ = sagot ng estudyante · ✓ = tamang sagot.</p>');
        m.items.forEach(function (it) {
          html.push('<div class="ev-item"><p class="ev-q">' + it.no + '. ' + (it.found ? esc(plain(it.text)) : esc(STALE_TEXT)) + '</p>');
          it.options.forEach(function (op) {
            var mark = op.isCorrect ? ' ✓' : (op.isGiven ? ' ✗' : '');
            html.push('<p class="ev-o' + (op.isCorrect ? ' c' : '') + '">' + (op.isGiven ? '☒' : '☐') + ' ' + esc(plain(op.label)) + mark + '</p>');
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

    html.push('<p class="ev-foot">Evidence ID: <b>' + m.evidenceId + '</b> · Generated ' + esc(new Date().toLocaleString('en-PH')) + ' · ' + esc(APP_NAME) + '</p>');
    html.push('</div>');
    return html.join('');
  }

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
      return new D.Paragraph({ alignment: x.align || AL.LEFT, spacing: x.spacing || { after: 50 }, indent: x.indent, keepNext: !!x.keepNext, keepLines: true, pageBreakBefore: !!x.pageBreakBefore, children: [run(text, x)] });
    }
    function cell(text, x) {
      x = x || {};
      return new D.TableCell({ width: x.w ? { size: x.w, type: WT.PERCENTAGE } : undefined, borders: borders, shading: x.fill ? { fill: x.fill } : undefined,
        children: [new D.Paragraph({ alignment: x.align || AL.LEFT, children: [run(text, { bold: x.bold, size: x.size || 20, color: x.color })] })] });
    }
    function kvTable(rows, colorRemarks, m) {
      return new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: rows.map(function (r) {
        var rem = colorRemarks && r[0] === 'Remarks';
        return new D.TableRow({ children: [cell(r[0], { bold: true, fill: 'F1F1F1', w: 28 }), cell(r[1], { w: 72, bold: rem, color: rem ? (m.passed ? '1B5E20' : 'B71C1C') : undefined })] });
      }) });
    }

    var children = [];
    models.forEach(function (m, idx) {
      var st = m.student, first = idx === 0;
      children.push(para('REPUBLIC OF THE PHILIPPINES', { bold: true, align: AL.CENTER, pageBreakBefore: !first, spacing: { after: 0 } }));
      children.push(para('DEPARTMENT OF EDUCATION', { bold: true, align: AL.CENTER, spacing: { after: 0 } }));
      children.push(para(s.region + ' — ' + s.division + (s.district ? ' — ' + s.district : ''), { align: AL.CENTER, size: 19, spacing: { after: 0 } }));
      children.push(para(s.schoolName, { bold: true, align: AL.CENTER, size: 26, spacing: { after: 0 } }));
      if (s.schoolAddress) children.push(para(s.schoolAddress, { align: AL.CENTER, size: 19, spacing: { after: 0 } }));
      children.push(para(s.schoolYear, { align: AL.CENTER, size: 19, spacing: { after: 100 } }));
      children.push(para('EXAMINATION EVIDENCE RECORD', { bold: true, align: AL.CENTER, size: 28, spacing: { before: 100, after: 120 } }));
      children.push(kvTable(infoRows(m, s)));

      children.push(para('RESULT', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
      var res = [['Score', m.correct + ' / ' + m.total], ['Percentage', m.percent + '%'], ['Remarks', (m.passed ? 'PASSED' : 'NOT YET PASSED') + ' (passing: ' + m.passing + '%)']];
      if (m.level) res.push(['Proficiency', m.level]);
      if (m.durationSec) res.push(['Time used', fmtDuration(m.durationSec)]);
      children.push(kvTable(res, true, m));
      notesFor(m).forEach(function (n) { children.push(para('Note: ' + n, { italics: true, size: 18, spacing: { before: 60 } })); });

      if (o.competencies !== false && m.competencies.length) {
        children.push(para('PERFORMANCE PER COMPETENCY', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
        var rows = [new D.TableRow({ tableHeader: true, children: [cell('Competency code', { bold: true, fill: 'F1F1F1', w: 55 }), cell('Correct', { bold: true, fill: 'F1F1F1', w: 15 }), cell('Items', { bold: true, fill: 'F1F1F1', w: 15 }), cell('%', { bold: true, fill: 'F1F1F1', w: 15 })] })];
        m.competencies.forEach(function (c) { rows.push(new D.TableRow({ children: [cell(c.code, { w: 55 }), cell(c.correct, { w: 15 }), cell(c.total, { w: 15 }), cell(Math.round(c.correct / c.total * 100) + '%', { w: 15 })] })); });
        children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: rows }));
      }

      if (o.items !== false) {
        children.push(para('ITEM-BY-ITEM ANSWERS', { bold: true, size: 24, spacing: { before: 240, after: 80 }, keepNext: true }));
        if (!m.hasItems) {
          children.push(para('Walang item-level record para sa assessment na ito. Ang resulta sa itaas ang opisyal na record.', { italics: true, size: 19 }));
        } else {
          children.push(para('Ang numero at pagkakasunod ng mga tanong ay ang mismong ayos na nakita ng estudyante sa exam (Set ' + (m.setLetter || '—') + '). ☒ = sagot ng estudyante · ✓ = tamang sagot.', { italics: true, size: 17, spacing: { after: 100 } }));
          m.items.forEach(function (it) {
            children.push(para(it.no + '. ' + (it.found ? plain(it.text) : STALE_TEXT), { bold: true, size: 21, spacing: { before: 100, after: 20 }, keepNext: true }));
            it.options.forEach(function (op) {
              children.push(para((op.isGiven ? '☒ ' : '☐ ') + plain(op.label) + (op.isCorrect ? '  ✓' : (op.isGiven ? '  ✗' : '')), { bold: op.isCorrect, size: 20, spacing: { after: 10 }, indent: { left: 400 }, keepNext: true }));
            });
            children.push(para('Student’s answer: ' + (it.givenLabel == null ? '(no answer)' : it.givenLabel) + ' — ' + (it.isCorrect ? 'CORRECT' : 'WRONG'), { bold: true, size: 20, color: it.isCorrect ? '1B5E20' : 'B71C1C', spacing: { before: 20, after: it.isCorrect ? 60 : 0 }, indent: { left: 400 }, keepNext: !it.isCorrect }));
            if (!it.isCorrect) children.push(para('Correct answer: ' + it.correctLabel, { size: 20, color: '1B5E20', spacing: { after: 60 }, indent: { left: 400 } }));
          });
        }
      }

      children.push(para('SUMMARY', { bold: true, size: 24, spacing: { before: 240, after: 80 }, keepNext: true }));
      children.push(para('Correct: ' + m.correct + ' | Wrong/Unanswered: ' + m.wrong + ' | Score: ' + m.percent + '% | Remarks: ' + (m.passed ? 'PASSED' : 'NOT YET PASSED'), { bold: true, color: m.passed ? '1B5E20' : 'B71C1C', keepNext: true }));
      children.push(para('Parent/Guardian’s comment (optional): ______________________________________________', { size: 19, spacing: { before: 80, after: 200 }, keepNext: true }));

      var none = { style: BS.NONE, size: 0, color: 'FFFFFF' };
      var noB = { top: none, bottom: none, left: none, right: none };
      function sig(name, role) {
        return new D.TableCell({ borders: noB, width: { size: 33, type: WT.PERCENTAGE }, children: [
          new D.Paragraph({ spacing: { before: 520 }, alignment: AL.CENTER, border: { top: { style: BS.SINGLE, size: 6, color: '000000', space: 2 } }, children: [run(name, { bold: true, size: 20 })] }),
          new D.Paragraph({ alignment: AL.CENTER, children: [run(role, { size: 18 })] })
        ] });
      }
      var sigCells = [];
      if (o.studentSign !== false) sigCells.push(sig(fullName(st), 'Student (signature over printed name)'));
      sigCells.push(sig(' ', 'Parent / Guardian (signature over printed name)'));
      sigCells.push(sig(s.teacherName, s.teacherPosition));
      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }, rows: [new D.TableRow({ cantSplit: true, children: sigCells })] }));
      children.push(para('Parent/Guardian Date: ______________', { size: 19, spacing: { before: 120 } }));
      children.push(para('Evidence ID: ' + m.evidenceId + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · ' + APP_NAME, { size: 16, color: '555555', align: AL.CENTER, spacing: { before: 120 } }));
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

  return {
    TERMS: TERMS, ASSESSMENTS: ASSESSMENTS, PAPERS: PAPERS,
    loadStudents: loadStudents, loadBank: loadBank, getEntry: getEntry, buildModel: buildModel,
    renderHtml: renderHtml, paperCss: paperCss, toDocx: toDocx, download: download,
    fullName: fullName, safeName: safeName, findAssessment: findAssessment, findTerm: findTerm
  };
})();

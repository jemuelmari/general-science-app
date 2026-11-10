/* ============================================================
   evidence.js — Exam Evidence (General Science, Grade 11)
   Version: 2.0.0
   ------------------------------------------------------------
   Gumagawa ng printable "Examination Evidence Record" ng isang estudyante (o ng buong section)
   para sa Quiz 1–3, Summative Test 1–2, at Term Exam ng Term 1–3 — para ipapirma sa magulang/guardian.

   Layout/architecture: kapareho ng General Biology version (Preview, Print/PDF, Word, section batch,
   Evidence ID, signature blocks). Ang data layer ay naka-wire sa GenSci app:

   DATA MODEL (GenSci)
   - scores[termN][bucket][id]   bucket = quizzes | st | te
     entry = { score, total, percent, passed, timeUsed(sec), set, timestamp, itemResults[] }
     itemResult = { index, questionId, given(TEXT), expected(TEXT), correct, competency, originalIndex*,
                    oo?, qh? }          (* originalIndex ay MALI sa lumang records = shown position)
   - Question bank: student/term{N}/assessments/{id}.json  -> bank.questions[]

   ALIGNMENT RULES (para pareho ang evidence at ang actual na exam ng bata)
   1. Ang item at ang numero nito ay galing sa itemResults (ayon sa index = pagkakasunod na nakita ng
      estudyante). HINDI ginagamit ang originalIndex para hanapin ang tanong (mali ito sa lumang records).
   2. Ang tanong ay hinahanap sa bank sa pamamagitan ng questionId (fallback: unique na tamang sagot).
   3. Ang sagot ng estudyante at ang tamang sagot ay galing sa naka-save na record (given / expected),
      hindi sa kasalukuyang bank — kaya hindi magbabago ang evidence kahit na-edit ang bank.
   4. Kung may `oo` (randomize.js v1.5.0+), eksaktong order at letra (A–D) ng choices ang ipinapakita.
      Kung wala (lumang random shuffle), buong text lang ang ipinapakita, walang letra.
   5. Duplicate item entries (index) mula sa merged cloud data ay inaalis; kung hindi tugma ang itemResults
      sa score/total, hahanapin ang tamang attempt sa Attempts sheet (pullAttempts).
   6. May ALIGNMENT CHECK bawat record (m.issues) — makikita sa page bago mag-print.

   Output: Print / Save as PDF (browser) at Word (.docx via docx@8.5.0).
   ============================================================ */
window.Evidence = (function () {
  'use strict';

  var APP_NAME = 'General Science Online Modular Application';
  var ID_PREFIX = 'GS';
  var TOKEN_KEY = 'gsa_teacher_token';      // kapareho ng teacher-cloud.js
  var PASSING = 75;                         // PASS_THRESHOLD sa quiz-engine.js
  var DEFAULT_SCHOOL_YEAR = 'S.Y. 2026-2027';

  var TERMS = [{ no: 1, key: 'term1', label: 'Term 1' }, { no: 2, key: 'term2', label: 'Term 2' }, { no: 3, key: 'term3', label: 'Term 3' }];

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

  var LETTERS = 'ABCDEFGH';

  /* ---------- school info (config.js → SCHOOL_INFO, CONFIG.DEVELOPER) ---------- */
  function schoolInfo() {
    var dev = (typeof CONFIG !== 'undefined' && CONFIG.DEVELOPER) || {};
    var o = window.SCHOOL_INFO || {};
    return {
      region: o.region || dev.region || '',
      division: o.division || dev.division || '',
      district: dev.district || '',
      schoolName: String(o.schoolName || dev.school || '').toUpperCase(),
      schoolAddress: o.schoolAddress || '',
      schoolYear: o.schoolYear || DEFAULT_SCHOOL_YEAR,
      teacherName: o.teacherName || dev.name || '',
      teacherPosition: o.teacherPosition || dev.position || '',
      subject: o.subject || 'General Science',
      gradeLevel: o.gradeLevel || 'Grade 11'
    };
  }

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plain(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
  function fmtDate(d) { if (!d) return '—'; var dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { if (!d) return ''; var dt = new Date(d); return isNaN(dt) ? '' : dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function fmtDuration(sec) {                       // timeUsed ay nasa SECONDS sa GenSci
    sec = Math.round(Number(sec)); if (!sec || sec < 0) return '—';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ' min ' + (s < 10 ? '0' : '') + s + ' sec';
  }
  function fullName(st) {
    if (!st) return '(Unknown)';
    var ln = String(st.lastName || '').toUpperCase(), fn = st.firstName || '', mn = st.middleName || '';
    if (!ln && !fn) return '(Unnamed)';
    return ln + ', ' + fn + (mn ? ' ' + mn : '');
  }
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }
  /** Kapareho ng Randomize.itemHash() sa randomize.js v1.5.0 */
  function itemHash(q) { return fnv([q.text, (q.options || []).join('\u241F'), q.correct].join('\u241E')); }
  function findAssessment(code) { return ASSESSMENTS.filter(function (a) { return a.code === code; })[0] || null; }
  function findTerm(no) { return TERMS.filter(function (t) { return String(t.no) === String(no); })[0] || TERMS[0]; }
  function bucketOf(code) { var a = findAssessment(code); return a ? a.bucket : null; }
  function isPerm(oo, n) {
    if (!Array.isArray(oo) || oo.length !== n) return false;
    var seen = {}; for (var i = 0; i < oo.length; i++) { var k = oo[i]; if (typeof k !== 'number' || k < 0 || k >= n || seen[k]) return false; seen[k] = 1; }
    return true;
  }

  /* ---------- data: students + attempts (cloud) ---------- */
  function token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  async function post(body) {
    var res = await fetch(CONFIG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return JSON.parse(await res.text());
  }

  function normalizeStudent(s) {
    var p = s.progress || s.progressJSON || {};
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
    var scores = p.scores || s.scores || {};
    if (typeof scores === 'string') { try { scores = JSON.parse(scores); } catch (e) { scores = {}; } }
    return {
      lrn: String(s.lrn || s.LRN || ''), lastName: s.lastName || '', firstName: s.firstName || '', middleName: s.middleName || '',
      section: s.section || '', gradeLevel: s.gradeLevel || '', scores: scores
    };
  }

  function attemptTime(r) { return r.clientTimestamp || r.serverTimestamp || (r.payload && r.payload.attempt && r.payload.attempt.timestamp) || ''; }
  function attemptKey(lrn, term, code) { return String(lrn) + '|' + term + '|' + code; }

  function indexAttempts(records) {
    var idx = {};
    (records || []).forEach(function (r) { var k = attemptKey(r.lrn, r.term, r.assessment); (idx[k] = idx[k] || []).push(r); });
    Object.keys(idx).forEach(function (k) { idx[k].sort(function (a, b) { return new Date(attemptTime(b)) - new Date(attemptTime(a)); }); });
    return idx;
  }

  function studentsFromAttempts(records) {
    var by = {};
    (records || []).slice().sort(function (a, b) { return new Date(attemptTime(b)) - new Date(attemptTime(a)); }).forEach(function (r) {
      var st = by[r.lrn];
      if (!st) {
        var nm = String(r.studentName || ''), c = nm.indexOf(',');
        st = by[r.lrn] = { lrn: String(r.lrn), lastName: c >= 0 ? nm.slice(0, c).trim() : nm, firstName: c >= 0 ? nm.slice(c + 1).trim() : '', middleName: '', section: r.section || '', gradeLevel: '', scores: {} };
      }
      var b = bucketOf(r.assessment); if (!b) return;
      var t = st.scores[r.term] = st.scores[r.term] || {};
      var entry = { score: r.score, total: r.total, itemResults: r.itemResults || [], set: r.set || '', timestamp: attemptTime(r) };
      if (b === 'te') { if (!t.te) t.te = entry; } else { t[b] = t[b] || {}; if (!t[b][r.assessment]) t[b][r.assessment] = entry; }
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  /**
   * 1) pullTeacherDashboard  → students + scores (pinakabagong attempt bawat assessment)
   * 2) pullAttempts (includeUsed) → bawat attempt na may sariling itemResults (pang-verify/pang-ayos)
   * @returns {{students:Array, attempts:Object, source:'cloud'|'attempts'|'none', error?:string}}
   */
  async function loadStudents() {
    var out = { students: [], attempts: {}, source: 'none', error: '' };
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) { out.error = 'Backend URL not configured.'; return out; }

    var dashErr = '';
    try {
      var d = await post({ action: 'pullTeacherDashboard', token: token() || CONFIG.TEACHER_PASSWORD_HASH });
      var list = d && d.ok ? (d.students || d.records || []) : [];
      if (list.length) { out.students = list.map(normalizeStudent).filter(function (s) { return s.lrn; }); out.source = 'cloud'; }
      else dashErr = (d && d.error) || 'No students returned.';
    } catch (e) { dashErr = e.message; }

    var atts = [];
    try {
      var a = await post({ action: 'pullAttempts', includeUsed: true });
      if (a && a.ok) atts = a.records || [];
    } catch (e) { /* optional */ }
    out.attempts = indexAttempts(atts);

    if (!out.students.length && atts.length) { out.students = studentsFromAttempts(atts); out.source = 'attempts'; }
    if (!out.students.length) out.error = dashErr || 'Walang estudyante.';
    return out;
  }

  /* ---------- data: question bank + competency labels ---------- */
  var _bankCache = {}, _compCache = null;

  async function loadBank(termNo, code) {
    var term = findTerm(termNo), key = term.key + '-' + code;
    if (_bankCache[key]) return _bankCache[key];
    var paths = ['../student/' + term.key + '/assessments/' + code + '.json', 'student/' + term.key + '/assessments/' + code + '.json'];
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(paths[i] + '?v=' + Date.now());
        if (res.ok) {
          var bank = await res.json();
          if (bank && Array.isArray(bank.questions) && bank.questions.length) { _bankCache[key] = bank; return bank; }
        }
      } catch (e) { /* subukan ang susunod */ }
    }
    throw new Error('Hindi ma-load ang question bank (' + term.key + '/' + code + '.json). I-check ang internet.');
  }

  async function loadCompetencies() {
    if (_compCache) return _compCache;
    var map = {};
    var paths = ['../data/competencies.json', 'data/competencies.json'];
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await fetch(paths[i]);
        if (!res.ok) continue;
        var d = await res.json();
        TERMS.forEach(function (t) { ((d[t.key] && d[t.key].competencies) || []).forEach(function (c) { map[c.code] = c.shortLabel || c.description || ''; }); });
        break;
      } catch (e) { /* optional */ }
    }
    _compCache = map;
    return map;
  }

  /* ---------- model ---------- */
  function getEntry(student, termKey, code) {
    var a = findAssessment(code); if (!a) return null;
    var t = (student.scores || {})[termKey]; if (!t) return null;
    var e = a.bucket === 'te' ? t.te : (t[a.bucket] || {})[code];
    if (!e || typeof e !== 'object') return null;
    if (e.score == null && !(e.itemResults && e.itemResults.length)) return null;
    return e;
  }

  /** Alisin ang duplicate `index` (galing sa merged cloud arrays); huling entry ang nananalo; i-sort ayon sa index. */
  function cleanItemResults(arr) {
    if (!Array.isArray(arr)) return { list: [], removed: 0 };
    var byIdx = {}, order = [];
    arr.forEach(function (r, pos) {
      if (!r || typeof r !== 'object') return;
      var k = r.index != null && !isNaN(Number(r.index)) ? Number(r.index) : pos;
      if (!(k in byIdx)) order.push(k);
      byIdx[k] = r;
    });
    order.sort(function (a, b) { return a - b; });
    return { list: order.map(function (k) { return byIdx[k]; }), removed: arr.length - order.length };
  }

  function itemsCorrect(list) { return list.filter(function (r) { return r.given != null && r.given === r.expected; }).length; }

  /** Hard integrity: dapat tugma ang bilang ng items at ang bilang ng tama sa naka-save na score/total. */
  function integrity(list, score, total) {
    var probs = [];
    if (list.length && total != null && list.length !== Number(total)) probs.push('count');
    if (list.length && score != null && itemsCorrect(list) !== Number(score)) probs.push('score');
    return probs;
  }

  function pickAttempt(cands, entry) {
    if (!cands || !cands.length) return null;
    var ts = entry && entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    var exact = cands.filter(function (r) { var t = new Date(attemptTime(r)).getTime(); return ts && t && Math.abs(t - ts) < 2000; })[0];
    if (exact) return exact;
    var same = cands.filter(function (r) { return entry && Number(r.score) === Number(entry.score) && Number(r.total) === Number(entry.total); })[0];
    return same || null;
  }

  function buildModel(student, termNo, code, bank, ctx) {
    ctx = ctx || {};
    var a = findAssessment(code), term = findTerm(termNo);
    var entry = getEntry(student, term.key, code);
    var cands = (ctx.attempts || {})[attemptKey(student.lrn, term.key, code)] || [];
    if (!entry && cands.length) entry = { score: cands[0].score, total: cands[0].total, itemResults: cands[0].itemResults, set: cands[0].set, timestamp: attemptTime(cands[0]) };
    if (!entry) return null;

    var issues = [], source = 'Student record (cloud)';
    var cleaned = cleanItemResults(entry.itemResults);
    var list = cleaned.list;
    var eff = { score: entry.score != null ? entry.score : entry.correct, total: entry.total, set: entry.set, timestamp: entry.timestamp, percent: entry.percent, timeUsed: entry.timeUsed };
    var probs = integrity(list, eff.score, eff.total != null ? eff.total : list.length);

    if (cleaned.removed) issues.push({ sev: 'warn', msg: cleaned.removed + ' duplicate item entr' + (cleaned.removed > 1 ? 'ies were' : 'y was') + ' removed (merged sync data).' });

    if (!list.length || probs.length) {
      var at = pickAttempt(cands, entry) || (!list.length ? cands[0] : null);
      if (at) {
        var l2 = cleanItemResults(at.itemResults).list;
        var p2 = integrity(l2, at.score, at.total != null ? at.total : l2.length);
        if (l2.length && (!list.length || p2.length < probs.length)) {
          list = l2; probs = p2; source = 'Attempts sheet (verified original submission)';
          eff = { score: at.score, total: at.total, set: at.set || eff.set, timestamp: attemptTime(at) || eff.timestamp, percent: null, timeUsed: entry.timeUsed };
          issues.push({ sev: 'info', msg: 'Student record was inconsistent; the original attempt from the Attempts sheet was used instead.' });
        }
      }
    }

    var qs = bank.questions || [], byId = {}, byKey = {};
    qs.forEach(function (q) { if (q && q.id != null) byId[String(q.id)] = q; if (q) (byKey[q.correct] = byKey[q.correct] || []).push(q); });

    var nNoQ = 0, nKey = 0, nOpt = 0, nFlag = 0, nRev = 0, nOrdered = 0, nRevised = 0;
    var items = list.map(function (r, i) {
      var q = r.questionId != null ? byId[String(r.questionId)] : null;
      if (!q && r.expected != null && byKey[r.expected] && byKey[r.expected].length === 1) q = byKey[r.expected][0];
      var given = r.given == null || r.given === '' ? null : String(r.given);
      var expected = r.expected != null ? String(r.expected) : (q ? q.correct : null);
      var isCorrect = given !== null && expected !== null && given === expected;

      var qOpts = q ? (q.options || []) : [];
      var ordered = !!(q && isPerm(r.oo, qOpts.length));
      var shown = ordered ? r.oo.map(function (k) { return qOpts[k]; }) : qOpts.slice();
      if (ordered) nOrdered++;

      if (!q) nNoQ++;
      else {
        var kChg = q.correct !== expected, hChg = !!(r.qh && r.qh !== itemHash(q));
        if (kChg) nKey++;
        if ((given !== null && qOpts.indexOf(given) < 0) || qOpts.indexOf(expected) < 0) nOpt++;
        if (hChg) nRev++;
        if (kChg || hChg) nRevised++;
      }
      if (typeof r.correct === 'boolean' && r.correct !== isCorrect) nFlag++;

      var opts = shown.map(function (label, k) { return { label: label, letter: ordered ? LETTERS[k] : '', isCorrect: label === expected, isGiven: given !== null && label === given }; });
      if (!q) {   // walang tanong sa bank: ipakita man lang ang naitala
        if (expected != null) opts.push({ label: expected, letter: '', isCorrect: true, isGiven: given === expected });
        if (given != null && given !== expected) opts.push({ label: given, letter: '', isCorrect: false, isGiven: true });
      }
      var gLetter = '', cLetter = '';
      opts.forEach(function (o) { if (o.isGiven) gLetter = o.letter; if (o.isCorrect) cLetter = o.letter; });

      return {
        no: i + 1,
        text: q ? q.text : '(Question text not found in the current question bank)',
        competency: r.competency || (q && q.competency) || 'General',
        options: opts, ordered: ordered,
        givenLabel: given, givenLetter: gLetter,
        correctLabel: expected != null ? expected : '(unknown)', correctLetter: cLetter,
        isCorrect: isCorrect
      };
    });

    var total = eff.total != null ? Number(eff.total) : (items.length || qs.length);
    var correct = eff.score != null ? Number(eff.score) : items.filter(function (x) { return x.isCorrect; }).length;
    var percent = eff.percent != null ? Number(eff.percent) : (total ? Math.round(correct / total * 100) : 0);

    if (probs.indexOf('count') >= 0) issues.push({ sev: 'err', msg: 'Item count (' + items.length + ') does not match the saved total (' + total + ').' });
    if (probs.indexOf('score') >= 0) issues.push({ sev: 'err', msg: 'Items marked correct (' + itemsCorrect(list) + ') do not match the saved score (' + correct + ').' });
    if (qs.length !== total) issues.push({ sev: 'warn', msg: 'Question bank now has ' + qs.length + ' items; this attempt had ' + total + '. The bank was changed after the exam.' });
    if (nNoQ) issues.push({ sev: 'warn', msg: nNoQ + ' item(s) could not be found in the current bank (question text unavailable).' });
    if (nKey) issues.push({ sev: 'warn', msg: nKey + ' item(s): the answer key in the bank was revised after this exam. The student’s original expected answer is shown.' });
    if (nOpt) issues.push({ sev: 'warn', msg: nOpt + ' item(s): choices in the bank no longer match what the student answered.' });
    if (nRev) issues.push({ sev: 'warn', msg: nRev + ' item(s) were edited in the bank after this exam (fingerprint changed).' });
    if (nFlag) issues.push({ sev: 'warn', msg: nFlag + ' item(s): saved correct/wrong flag differs from given vs expected (the comparison of given vs expected is used).' });
    if (items.length && !nOrdered) issues.push({ sev: 'info', msg: 'Old-engine attempt: choice order shown on screen was random and not recorded, so choices are listed by full text (no letters).' });

    var comp = {};
    items.forEach(function (it) { var c = comp[it.competency] || (comp[it.competency] = { code: it.competency, total: 0, correct: 0 }); c.total++; if (it.isCorrect) c.correct++; });

    var level = (typeof Transmutation !== 'undefined' && Transmutation.proficiencyLevel) ? Transmutation.proficiencyLevel(percent).level : '';
    var title = bank.title || a.label;

    return {
      student: student, termNo: term.no, termLabel: term.label, code: code, label: a.label, title: title,
      setLetter: eff.set || '', items: items, hasItems: items.length > 0, allOrdered: items.length > 0 && nOrdered === items.length,
      correct: correct, total: total, wrong: Math.max(0, total - correct), percent: percent,
      passing: PASSING, passed: percent >= PASSING, level: level,
      competencies: Object.keys(comp).map(function (k) { return comp[k]; }),
      takenAt: eff.timestamp || '', durationSec: eff.timeUsed || 0,
      issues: issues, source: source, revisedCount: nRevised,
      evidenceId: ID_PREFIX + '-' + fnv([student.lrn, term.key + '-' + code, eff.timestamp || '', correct, total].join('|'))
    };
  }

  function worstSeverity(m) { var r = 'ok'; m.issues.forEach(function (x) { if (x.sev === 'err') r = 'err'; else if (x.sev === 'warn' && r !== 'err') r = 'warn'; else if (x.sev === 'info' && r === 'ok') r = 'info'; }); return r; }

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

  function infoRows(m, s) {
    var st = m.student;
    var grade = st.gradeLevel ? 'Grade ' + String(st.gradeLevel).replace(/^grade\s*/i, '') : s.gradeLevel;
    return [
      ['Student Name', fullName(st)], ['LRN', String(st.lrn || '')],
      ['Grade & Section', grade + ' - ' + (st.section || '—')],
      ['Subject', s.subject], ['Assessment', m.termLabel + ' — ' + m.label + (m.title && m.title !== m.label ? ' (' + m.title + ')' : '')],
      ['Set', m.setLetter ? 'Set ' + m.setLetter : '—'],
      ['Date & Time Taken', fmtDate(m.takenAt) + (fmtTime(m.takenAt) ? ', ' + fmtTime(m.takenAt) : '')]
    ];
  }

  function orderNote(m) {
    return m.allOrdered
      ? 'Ang mga choices ay nakasulat sa eksaktong pagkakasunod na nakita ng estudyante sa exam (A–D). ☒ = pinili ng estudyante · ✓ = tamang sagot.'
      : 'Random ang pagkakasunod ng mga tanong at choices sa bawat estudyante sa exam na ito, kaya ang mga sagot ay nakasulat sa buong text at hindi sa letra. Ang numero ng tanong ay ayon sa pagkakasunod na nakita ng estudyante. ☒ = pinili ng estudyante · ✓ = tamang sagot.';
  }

  function pageHtml(m, o, comp) {
    var s = schoolInfo(), st = m.student;
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

    if (o.competencies !== false && m.competencies.length) {
      html.push('<div class="ev-h">PERFORMANCE PER COMPETENCY</div><table class="ev-tbl"><tr><th>Competency</th><th style="width:70px">Correct</th><th style="width:70px">Items</th><th style="width:70px">%</th></tr>' +
        m.competencies.map(function (c) { return '<tr><td>' + esc(c.code) + (comp && comp[c.code] ? ' — ' + esc(comp[c.code]) : '') + '</td><td>' + c.correct + '</td><td>' + c.total + '</td><td>' + Math.round(c.correct / c.total * 100) + '%</td></tr>'; }).join('') + '</table>');
    }

    if (o.items !== false) {
      html.push('<div class="ev-h">ITEM-BY-ITEM ANSWERS</div>');
      if (!m.hasItems) {
        html.push('<p class="ev-note">Walang item-level record para sa assessment na ito. Ang resulta sa itaas ang opisyal na record.</p>');
      } else {
        html.push('<p class="ev-note">' + esc(orderNote(m)) + '</p>');
        m.items.forEach(function (it) {
          html.push('<div class="ev-item"><p class="ev-q">' + it.no + '. ' + esc(it.text) + '</p>');
          it.options.forEach(function (op) {
            var mark = op.isCorrect ? ' ✓' : (op.isGiven ? ' ✗' : '');
            html.push('<p class="ev-o' + (op.isCorrect ? ' c' : '') + '">' + (op.isGiven ? '☒' : '☐') + ' ' + (op.letter ? op.letter + '. ' : '') + esc(op.label) + mark + '</p>');
          });
          var gl = it.givenLabel == null ? '(no answer)' : (it.givenLetter ? it.givenLetter + '. ' : '') + it.givenLabel;
          html.push('<p class="ev-ans ' + (it.isCorrect ? 'ev-ok' : 'ev-no') + '">Student’s answer: <b>' + esc(gl) + '</b> — ' + (it.isCorrect ? 'CORRECT' : 'WRONG') +
            (it.isCorrect ? '' : '<br/>Correct answer: <b>' + esc((it.correctLetter ? it.correctLetter + '. ' : '') + it.correctLabel) + '</b>') + '</p></div>');
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
      (m.revisedCount ? '<br/>Note: ' + m.revisedCount + ' item(s) were revised in the question bank after this exam was taken; the answers recorded at the time of the exam are shown.' : '') + '</p>');
    html.push('</div>');
    return html.join('');
  }

  function renderHtml(models, o, comp) {
    return models.map(function (m, i) {
      return '<div class="ev-sheet" style="' + (i < models.length - 1 ? 'break-after:page;page-break-after:always;' : '') + '">' + pageHtml(m, o || {}, comp) + '</div>';
    }).join('');
  }

  function paperCss(paperKey) {
    var p = PAPERS[paperKey] || PAPERS.letter;
    return '@page{size:' + p.css + ';margin:0.6in;}\n' + CSS;
  }

  /* ---------- DOCX ---------- */
  async function toDocx(models, o, paperKey, comp) {
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
      var st = m.student, first = idx === 0;
      children.push(para('REPUBLIC OF THE PHILIPPINES', { bold: true, align: AL.CENTER, pageBreakBefore: !first, spacing: { after: 0 } }));
      children.push(para('DEPARTMENT OF EDUCATION', { bold: true, align: AL.CENTER, spacing: { after: 0 } }));
      children.push(para(s.region + ' — ' + s.division + (s.district ? ' — ' + s.district : ''), { align: AL.CENTER, size: 19, spacing: { after: 0 } }));
      children.push(para(s.schoolName, { bold: true, align: AL.CENTER, size: 26, spacing: { after: 0 } }));
      if (s.schoolAddress) children.push(para(s.schoolAddress, { align: AL.CENTER, size: 19, spacing: { after: 0 } }));
      children.push(para(s.schoolYear, { align: AL.CENTER, size: 19, spacing: { after: 100 } }));
      children.push(para('EXAMINATION EVIDENCE RECORD', { bold: true, align: AL.CENTER, size: 28, spacing: { before: 100, after: 120 } }));

      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: infoRows(m, s).map(function (r) { return new D.TableRow({ children: [cell(r[0], { bold: true, fill: 'F1F1F1', w: 28 }), cell(r[1], { w: 72 })] }); }) }));

      children.push(para('RESULT', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
      var res = [['Score', m.correct + ' / ' + m.total], ['Percentage', m.percent + '%'], ['Remarks', (m.passed ? 'PASSED' : 'NOT YET PASSED') + ' (passing: ' + m.passing + '%)']];
      if (m.level) res.push(['Proficiency', m.level]);
      if (m.durationSec) res.push(['Time used', fmtDuration(m.durationSec)]);
      children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: res.map(function (r) { return new D.TableRow({ children: [cell(r[0], { bold: true, fill: 'F1F1F1', w: 28 }), cell(r[1], { w: 72, bold: r[0] === 'Remarks', color: r[0] === 'Remarks' ? (m.passed ? '1B5E20' : 'B71C1C') : undefined })] }); }) }));

      if (o.competencies !== false && m.competencies.length) {
        children.push(para('PERFORMANCE PER COMPETENCY', { bold: true, size: 24, spacing: { before: 200, after: 80 }, keepNext: true }));
        var rows = [new D.TableRow({ tableHeader: true, children: [cell('Competency', { bold: true, fill: 'F1F1F1', w: 55 }), cell('Correct', { bold: true, fill: 'F1F1F1', w: 15 }), cell('Items', { bold: true, fill: 'F1F1F1', w: 15 }), cell('%', { bold: true, fill: 'F1F1F1', w: 15 })] })];
        m.competencies.forEach(function (c) { rows.push(new D.TableRow({ children: [cell(c.code + (comp && comp[c.code] ? ' — ' + comp[c.code] : ''), { w: 55 }), cell(c.correct, { w: 15 }), cell(c.total, { w: 15 }), cell(Math.round(c.correct / c.total * 100) + '%', { w: 15 })] })); });
        children.push(new D.Table({ width: { size: 100, type: WT.PERCENTAGE }, rows: rows }));
      }

      if (o.items !== false) {
        children.push(para('ITEM-BY-ITEM ANSWERS', { bold: true, size: 24, spacing: { before: 240, after: 80 }, keepNext: true }));
        if (!m.hasItems) {
          children.push(para('Walang item-level record para sa assessment na ito. Ang resulta sa itaas ang opisyal na record.', { italics: true, size: 19 }));
        } else {
          children.push(para(orderNote(m), { italics: true, size: 17, spacing: { after: 100 } }));
          m.items.forEach(function (it) {
            children.push(para(it.no + '. ' + plain(it.text), { bold: true, size: 21, spacing: { before: 100, after: 20 }, keepNext: true }));
            it.options.forEach(function (op) {
              children.push(para((op.isGiven ? '☒ ' : '☐ ') + (op.letter ? op.letter + '. ' : '') + plain(op.label) + (op.isCorrect ? '  ✓' : (op.isGiven ? '  ✗' : '')), { bold: op.isCorrect, size: 20, spacing: { after: 10 }, indent: { left: 400 }, keepNext: true }));
            });
            var gl = it.givenLabel == null ? '(no answer)' : (it.givenLetter ? it.givenLetter + '. ' : '') + plain(it.givenLabel);
            children.push(para('Student’s answer: ' + gl + ' — ' + (it.isCorrect ? 'CORRECT' : 'WRONG'), { bold: true, size: 20, color: it.isCorrect ? '1B5E20' : 'B71C1C', spacing: { before: 20, after: it.isCorrect ? 60 : 0 }, indent: { left: 400 }, keepNext: !it.isCorrect }));
            if (!it.isCorrect) children.push(para('Correct answer: ' + (it.correctLetter ? it.correctLetter + '. ' : '') + plain(it.correctLabel), { size: 20, color: '1B5E20', spacing: { after: 60 }, indent: { left: 400 } }));
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
      children.push(para('Evidence ID: ' + m.evidenceId + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · ' + APP_NAME + (m.revisedCount ? ' · Note: ' + m.revisedCount + ' item(s) were revised in the question bank after this exam was taken; the answers recorded at the time of the exam are shown.' : ''), { size: 16, color: '555555', align: AL.CENTER, spacing: { before: 120 } }));
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
    TERMS: TERMS, ASSESSMENTS: ASSESSMENTS, PAPERS: PAPERS,
    loadStudents: loadStudents, loadBank: loadBank, loadCompetencies: loadCompetencies,
    getEntry: getEntry, buildModel: buildModel, worstSeverity: worstSeverity,
    renderHtml: renderHtml, paperCss: paperCss, toDocx: toDocx, download: download,
    fullName: fullName, safeName: safeName, findAssessment: findAssessment, findTerm: findTerm,
    cleanItemResults: cleanItemResults, itemHash: itemHash
  };
})();

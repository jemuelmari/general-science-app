/* ============================================================
   teacher-cloud.js — Cloud-First Dashboard Logic
   Version: 2.0.0
   v2.0.0: ONE source of truth for every teacher page.
           - fetchStudents() now merges, into each student's
             progress.scores, (1) the teacher's PT grades from the
             PTGrades sheet and (2) teacher score overrides
             (paper-and-pen / Score Entry). Class Record, Grading
             Sheet, Reports, Assessment Tracker, Intervention and
             Item Analysis therefore all show the same numbers.
           - An override WINS over the online score (it may be lower).
             The online record is kept under record.online.
           - Attempts are pulled with the teacher token (backend 1.11.0).
           - hydrateStore() survives a full localStorage (quota) and
             keeps everything in memory instead.
   v1.4.0: fetchStudents() hands the dataVersion to TeacherWatch.
   v1.2.0: withItems restores itemResults from the Attempts sheet.
   ============================================================ */

const TeacherCloud = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  let _last = { overrides: [], ptGrades: [], students: [] };

  function _token() {
    try { return sessionStorage.getItem('gsa_teacher_token') || ''; } catch (e) { return ''; }
  }

  async function _post(body) {
    const token = _token();
    if (!token) throw new Error('Teacher session expired. Please log in again.');
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: token }, body))
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Backend returned a non-JSON response (HTTP ' + res.status + ')'); }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Request failed.');
    return data;
  }

  // Score bucket used inside progress.scores[term]
  const BUCKET_OF = (id) => /^quiz/.test(id) ? 'quizzes' : /^st/.test(id) ? 'st' : id === 'te' ? 'te' : /^pt/.test(id) ? 'pt' : null;

  /** Read a score record (any of the stored shapes). */
  function getRecord(scores, term, id) {
    const t = (scores || {})[term] || {};
    const b = BUCKET_OF(id);
    if (b === 'te') return (t.te && t.te.te) || (t.te && t.te.score !== undefined ? t.te : null);
    return (t[b] && t[b][id]) || null;
  }

  /** Write a score record in the canonical shape. */
  function setRecord(scores, term, id, rec) {
    const b = BUCKET_OF(id);
    if (!b) return;
    scores[term] = scores[term] || {};
    if (b === 'te') {
      if (scores[term].te && scores[term].te.score !== undefined && !scores[term].te.te) scores[term].te = {};
      scores[term].te = scores[term].te || {};
      scores[term].te.te = rec;
    } else {
      scores[term][b] = scores[term][b] || {};
      scores[term][b][id] = rec;
    }
  }

  /** Percent of a record, or null. */
  function percentOf(rec) {
    if (!rec) return null;
    if (rec.percent != null && rec.percent !== '' && !isNaN(Number(rec.percent))) return Number(rec.percent);
    if (rec.score != null && rec.total) return (Number(rec.score) / Number(rec.total)) * 100;
    return null;
  }

  function _applyExtras(students, ptGrades, overrides) {
    const byLrn = {};
    students.forEach(s => {
      if (!s.progress || typeof s.progress !== 'object') s.progress = {};
      if (!s.progress.scores || typeof s.progress.scores !== 'object') s.progress.scores = {};
      byLrn[s.lrn] = s;
    });

    // 1) PT grades (teacher-graded rubric total out of 100)
    (ptGrades || []).forEach(g => {
      const s = byLrn[g.lrn]; if (!s || !g.term || !g.ptId) return;
      const prev = getRecord(s.progress.scores, g.term, g.ptId) || {};
      const total = Number(g.totalScore) || 0;
      setRecord(s.progress.scores, g.term, g.ptId, Object.assign({}, prev, {
        score: total, total: 100, percent: total, graded: true,
        gradedAt: g.gradedAt || '', teacherNotes: g.teacherNotes || ''
      }));
    });

    // 2) Teacher overrides (paper-and-pen) — always win
    (overrides || []).forEach(o => {
      const s = byLrn[o.lrn]; if (!s || !o.term || !o.assessment) return;
      const prev = getRecord(s.progress.scores, o.term, o.assessment);
      const rec = {
        score: Number(o.score), total: Number(o.total),
        percent: o.percent != null ? Number(o.percent) : (Number(o.score) / Number(o.total)) * 100,
        passed: ((Number(o.score) / Number(o.total)) * 100) >= ((typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70),
        timestamp: o.enteredAt || '', override: true, source: o.source || 'paper', note: o.note || '',
        enteredBy: o.enteredBy || ''
      };
      if (prev && !prev.override) rec.online = { score: prev.score, total: prev.total, percent: percentOf(prev), timestamp: prev.timestamp || '' };
      // keep PT submission details (file link etc.)
      if (BUCKET_OF(o.assessment) === 'pt' && prev) Object.keys(prev).forEach(k => { if (!(k in rec) && k !== 'online') rec[k] = prev[k]; });
      setRecord(s.progress.scores, o.term, o.assessment, rec);
    });
  }

  // opts.withItems: restore itemResults from Attempts (item analysis / TOS)
  // opts.includeNameless: keep rows without a name (normalize-names page)
  async function fetchStudents(opts) {
    opts = opts || {};
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend URL not configured.');
    }
    const data = await _post({ action: 'pullTeacherDashboard' });
    if (data.dataVersion) {
      window.__gsaDataVersion = String(data.dataVersion);
      if (window.TeacherWatch && typeof window.TeacherWatch.setBaseline === 'function') window.TeacherWatch.setBaseline(data.dataVersion);
    }
    let list = data.students || [];
    if (!opts.includeNameless) {
      // Skip ghost rows (no name / UNIDENTIFIED placeholder)
      list = list.filter(s => (s.lastName || s.firstName) && String(s.lastName).toUpperCase() !== 'UNIDENTIFIED');
    }
    if (opts.withItems) {
      try { _restoreItemResults(list, await _fetchAttempts()); }
      catch (e) { console.warn('[TeacherCloud] itemResults restore skipped:', e.message); }
    }
    _applyExtras(list, data.ptGrades || [], data.overrides || []);
    _last = { overrides: data.overrides || [], ptGrades: data.ptGrades || [], students: list };
    return list;
  }

  async function _fetchAttempts() {
    const data = await _post({ action: 'pullAttempts', includeUsed: true });
    return data.records || [];
  }

  // Put itemResults back into scores records that lost them (oversize strip)
  function _restoreItemResults(students, attempts) {
    const best = {}; // lrn|term|assessment -> list
    attempts.forEach(a => {
      if (!a.itemResults || !a.itemResults.length) return;
      const k = a.lrn + '|' + a.term + '|' + a.assessment;
      (best[k] = best[k] || []).push(a);
    });
    students.forEach(s => {
      const scores = (s.progress && s.progress.scores) || {};
      Object.keys(scores).forEach(term => {
        ['quiz1', 'quiz2', 'quiz3', 'st1', 'st2', 'te'].forEach(id => {
          const rec = getRecord(scores, term, id);
          if (!rec || (rec.itemResults && rec.itemResults.length)) return;
          const list = best[s.lrn + '|' + term + '|' + id];
          if (!list) return;
          list.sort((a, b) => String(b.serverTimestamp).localeCompare(String(a.serverTimestamp)));
          const match = list.find(a => Number(a.score) === Number(rec.score)) || null;
          if (match) rec.itemResults = match.itemResults;
        });
      });
    });
  }

  // In-memory copy used when localStorage is full
  const _mem = { users: null, scores: {}, progress: {}, badges: {} };

  // Mirror cloud data into localStorage (teacher device only, never pushed back)
  async function hydrateStore(opts) {
    opts = opts || {};
    const students = await fetchStudents(opts);
    const users = {};
    let quotaHit = false;
    students.forEach(s => {
      users[s.lrn] = {
        lrn: s.lrn, lastName: s.lastName, firstName: s.firstName,
        middleName: s.middleName || '', sex: s.sex || '',
        section: s.section || '', gradeLevel: 11
      };
      const p = s.progress || {};
      _mem.scores[s.lrn] = p.scores || {};
      _mem.progress[s.lrn] = p.progress || {};
      _mem.badges[s.lrn] = p.badges || {};
      if (quotaHit) return;
      try {
        localStorage.setItem(NS + 'scores_' + s.lrn, JSON.stringify(p.scores || {}));
        localStorage.setItem(NS + 'progress_' + s.lrn, JSON.stringify(p.progress || {}));
        localStorage.setItem(NS + 'badges_' + s.lrn, JSON.stringify(p.badges || {}));
      } catch (e) { quotaHit = true; console.warn('[TeacherCloud] localStorage full — using in-memory data.'); }
    });
    _mem.users = users;
    try { localStorage.setItem(NS + 'users', JSON.stringify(users)); } catch (e) { quotaHit = true; }
    if (quotaHit && typeof Store !== 'undefined') {
      // Serve the class data from memory for this page
      Store.getAllUsers = function () { return Object.keys(_mem.users).map(k => _mem.users[k]); };
      Store.getUser = function (lrn) { return _mem.users[lrn] || null; };
      Store.getScores = function (lrn) { return _mem.scores[lrn] || {}; };
      Store.getProgress = function (lrn) { return _mem.progress[lrn] || {}; };
      Store.getBadges = function (lrn) { return _mem.badges[lrn] || {}; };
    }
    return students;
  }

  /** Teacher score overrides */
  async function saveOverrides(records, enteredBy) {
    return _post({ action: 'saveScoreOverride', records: records, enteredBy: enteredBy || 'Teacher' });
  }
  async function deleteOverride(lrn, term, assessment) {
    return _post({ action: 'deleteScoreOverride', lrn: lrn, term: term, assessment: assessment });
  }

  function lastExtras() { return _last; }

  return { fetchStudents, hydrateStore, saveOverrides, deleteOverride, lastExtras, getRecord, setRecord, percentOf, BUCKET_OF };
})();

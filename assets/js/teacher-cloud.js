/* ============================================================
   teacher-cloud.js — Cloud-First Dashboard Logic
   Version: 1.4.0
   v1.4.0: fetchStudents() hands the dataVersion that came with the data to
           TeacherWatch (teacher-watch.js) -> the "New student data is available.
           Refresh the page" banner knows exactly which version is on screen.
   Fetches student data from StudentsMaster via backend.
   v1.1.0: + hydrateStore(): copies cloud students into the local
           Store cache so pages that still call Store.getAllUsers()/
           Store.getScores() (grading-sheet, reports, tos-generator)
           see the real class data instead of an empty teacher device.
   v1.2.0: hydrateStore({withItems:true}) also pulls the Attempts sheet
           and restores itemResults that the backend strips from
           StudentsMaster when progress JSON is too large. Needed by
           the TOS generator (competency MPS / Most-Least Learned).
   ============================================================ */

const TeacherCloud = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  function _token() {
    return sessionStorage.getItem('gsa_teacher_token') || '';
  }

  // opts.withItems: restore itemResults from Attempts (item analysis / TOS)
  // opts.includeNameless: keep rows without a name (normalize-names page)
  async function fetchStudents(opts) {
    opts = opts || {};
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend URL not configured.');
    }
    const token = _token();
    if (!token) throw new Error('Teacher session expired. Please log in again.');

    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'pullTeacherDashboard', token: token })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Backend returned a non-JSON response (HTTP ' + res.status + ')'); }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Failed to fetch students.');
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
    return list;
  }

  const TYPE_OF = (id) => /^quiz/.test(id) ? 'quizzes' : /^st/.test(id) ? 'st' : id === 'te' ? 'te' : null;

  async function _fetchAttempts() {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'pullAttempts', includeUsed: true })
    });
    const data = JSON.parse(await res.text());
    if (!data || !data.ok) throw new Error((data && data.error) || 'Failed to fetch attempts.');
    return data.records || [];
  }

  // Put itemResults back into scores records that lost them
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
        const t = scores[term] || {};
        const visit = (type, id, rec) => {
          if (!rec || (rec.itemResults && rec.itemResults.length)) return;
          const list = best[s.lrn + '|' + term + '|' + id];
          if (!list) return;
          list.sort((a, b) => String(b.serverTimestamp).localeCompare(String(a.serverTimestamp)));
          const match = list.find(a => a.score === rec.score) || list[0];
          rec.itemResults = match.itemResults;
        };
        Object.keys(t).forEach(type => {
          if (type === 'te' && t.te && !t.te.score && t.te.te) visit('te', 'te', t.te.te);
          else if (t[type] && typeof t[type] === 'object') Object.keys(t[type]).forEach(id => visit(type, id, t[type][id]));
        });
      });
    });
  }

  // Mirror cloud data into localStorage (teacher device only, never pushed back)
  async function hydrateStore(opts) {
    opts = opts || {};
    const students = await fetchStudents(opts);
    const users = {};
    students.forEach(s => {
      users[s.lrn] = {
        lrn: s.lrn, lastName: s.lastName, firstName: s.firstName,
        middleName: s.middleName || '', sex: s.sex || '',
        section: s.section || '', gradeLevel: 11
      };
      const p = s.progress || {};
      localStorage.setItem(NS + 'scores_' + s.lrn, JSON.stringify(p.scores || {}));
      localStorage.setItem(NS + 'progress_' + s.lrn, JSON.stringify(p.progress || {}));
      localStorage.setItem(NS + 'badges_' + s.lrn, JSON.stringify(p.badges || {}));
    });
    localStorage.setItem(NS + 'users', JSON.stringify(users));
    return students;
  }

  return { fetchStudents, hydrateStore };
})();

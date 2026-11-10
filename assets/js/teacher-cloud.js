/* ============================================================
   teacher-cloud.js — Cloud-First Dashboard Logic
   Version: 1.1.0
   Fetches student data from StudentsMaster via backend.
   v1.1.0: + hydrateStore(): copies cloud students into the local
           Store cache so pages that still call Store.getAllUsers()/
           Store.getScores() (grading-sheet, reports, tos-generator)
           see the real class data instead of an empty teacher device.
   ============================================================ */

const TeacherCloud = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  function _token() {
    return sessionStorage.getItem('gsa_teacher_token') || '';
  }

  async function fetchStudents() {
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
    // Skip registered-in-name-only ghosts (no name at all)
    return (data.students || []).filter(s => (s.lastName || s.firstName));
  }

  // Mirror cloud data into localStorage (teacher device only, never pushed back)
  async function hydrateStore() {
    const students = await fetchStudents();
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

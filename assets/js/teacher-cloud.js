/* ============================================================
   teacher-cloud.js — Cloud-First Dashboard Logic
   Version: 1.0.0
   Fetches student data from StudentsMaster via backend
   ============================================================ */

const TeacherCloud = (() => {
  'use strict';

  async function fetchStudents() {
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend URL not configured.');
    }

    const token = sessionStorage.getItem('gsa_teacher_token') || 'invalid-token';

    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'pullTeacherDashboard',
        token: token
      })
    });

    const data = await res.json();
    if (!data || !data.ok) {
      throw new Error(data.error || 'Failed to fetch students.');
    }
    return data.students || [];
  }

  return { fetchStudents };
})();

/* ============================================================
   classrecord.js — Gradebook logic (Cloud-First)
   Version: 1.2.0
   ============================================================ */

(() => {
  'use strict';

  TeacherAuth.init();
  if (!TeacherAuth.require()) return;

  /* ============================================================
     WEIGHTING CONSTANTS
     ============================================================ */
  const WEIGHTS = (typeof CONFIG !== 'undefined' && CONFIG.WEIGHTS) || { ww: 0.20, pt: 0.50, ex: 0.30 };
  const EX_INTERNAL = (typeof CONFIG !== 'undefined' && CONFIG.EX_INTERNAL) || { st1: 0.30, st2: 0.30, te: 0.40 };

  let backendPTGrades = {};
  let allStudents = []; // Galing sa backend

  /* ============================================================
     FETCH STUDENTS FROM BACKEND
     ============================================================ */
  async function fetchStudentsFromCloud() {
    const tbody = document.getElementById('summary-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">⏳ Fetching students from cloud...</td></tr>';

    try {
      if (typeof TeacherCloud === 'undefined' || typeof TeacherCloud.fetchStudents !== 'function') {
        throw new Error('TeacherCloud module not loaded.');
      }
      allStudents = await TeacherCloud.fetchStudents();
      console.log(`[ClassRecord] Loaded ${allStudents.length} students from cloud.`);
    } catch (err) {
      console.error('[ClassRecord] Failed to fetch from cloud:', err);
      allStudents = [];
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#c62828;">❌ ${err.message}</td></tr>`;
      throw err;
    }
  }

  async function fetchPTGrades() {
    if (typeof PTGrade === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) return;
    try {
      var res = await PTGrade.pullGrades({});
      if (res && res.ok && res.records) {
        var map = {};
        res.records.forEach(function(g) {
          if (!map[g.lrn]) map[g.lrn] = {};
          if (!map[g.lrn][g.term]) map[g.lrn][g.term] = {};
          map[g.lrn][g.term][g.ptId] = g.totalScore;
        });
        backendPTGrades = map;
      }
    } catch (e) {
      console.warn('[ClassRecord] Failed to fetch PT grades from backend:', e);
    }
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function getStudents(term, section) {
    let list = allStudents; // Galing sa backend
    if (section) list = list.filter(s => (s.section || '').replace(/_/g, ' ').toUpperCase() === section.replace(/_/g, ' ').toUpperCase());
    return list.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
  }

  function getScorePercent(lrn, term, type, id) {
    // PT scores galing sa backend
    if (type === 'pt') {
      var backendScore = backendPTGrades[lrn]?.[term]?.[id];
      if (backendScore !== undefined) return backendScore;
      return null;
    }

    // Other scores (quizzes, STs, TE) galing sa StudentsMaster progressJSON
    const student = allStudents.find(s => s.lrn === lrn);
    if (!student) return null;
    
    const p = student.progress || {};
    const scores = p.scores?.[term] || {};
    
    let record = null;
    if (type === 'te') record = scores.te;
    else record = scores[type]?.[id];
    
    if (!record) return null;
    if (record.percent != null) return record.percent;
    if (record.score != null && record.total) return (record.score / record.total) * 100;
    return null;
  }

  function computeGrade(students, term) {
    return students.map((s) => {
      const q1 = getScorePercent(s.lrn, term, 'quizzes', 'quiz1');
      const q2 = getScorePercent(s.lrn, term, 'quizzes', 'quiz2');
      const q3 = getScorePercent(s.lrn, term, 'quizzes', 'quiz3');
      const st1 = getScorePercent(s.lrn, term, 'st', 'st1');
      const st2 = getScorePercent(s.lrn, term, 'st', 'st2');
      const pt1 = getScorePercent(s.lrn, term, 'pt', 'pt1');
      const pt2 = getScorePercent(s.lrn, term, 'pt', 'pt2');
      const pt3 = getScorePercent(s.lrn, term, 'pt', 'pt3');
      const te = getScorePercent(s.lrn, term, 'te', 'te');

      const quizPcts = [q1, q2, q3].filter((v) => v != null);
      const wwAvg = quizPcts.length ? quizPcts.reduce((a, b) => a + b, 0) / quizPcts.length : null;

      const ptPcts = [pt1, pt2, pt3].filter((v) => v != null);
      const ptAvg = ptPcts.length ? ptPcts.reduce((a, b) => a + b, 0) / ptPcts.length : null;

      let exAvg = null;
      if (st1 != null && st2 != null && te != null) {
        exAvg = (st1 * EX_INTERNAL.st1) + (st2 * EX_INTERNAL.st2) + (te * EX_INTERNAL.te);
      }

      const finalGrade = (typeof Transmutation !== 'undefined' && Transmutation.computeFinalGradeSafe)
        ? Transmutation.computeFinalGradeSafe(wwAvg, ptAvg, exAvg, WEIGHTS)
        : { insufficient: true, transmuted: null };

      let availableSum = 0, availableWeight = 0;
      if (wwAvg !== null) { availableSum += wwAvg * WEIGHTS.ww; availableWeight += WEIGHTS.ww; }
      if (ptAvg !== null) { availableSum += ptAvg * WEIGHTS.pt; availableWeight += WEIGHTS.pt; }
      if (exAvg !== null) { availableSum += exAvg * WEIGHTS.ex; availableWeight += WEIGHTS.ex; }
      const partialScore = availableWeight > 0 ? (availableSum / availableWeight) : 0;

      const compCount = [q1, q2, q3, pt1, pt2, pt3, st1, st2, te].filter((v) => v != null).length;

      return {
        student: s,
        scores: { q1, q2, q3, st1, st2, pt1, pt2, pt3, te },
        wwAvg, ptAvg, exAvg, final: finalGrade, partialScore, compCount
      };
    });
  }

  /* ============================================================
     RENDER — SUMMARY
     ============================================================ */
  function renderSummary(rows, term) {
    const tbody = document.getElementById('summary-body');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">No students found for this filter.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    rows.forEach((r) => {
      const s = r.student;
      const initials = ((s.firstName || '?').charAt(0) + (s.lastName || '?').charAt(0)).toUpperCase();
      const avatarClass = (typeof UI !== 'undefined' && UI.getAvatarClass) ? UI.getAvatarClass(s.lrn) : '';
      const tr = document.createElement('tr');

      let finalCell;
      if (r.final.insufficient || r.final.transmuted == null) {
        finalCell = '<td class="final-grade" style="color:#bdbdbd;background:#fafafa;">—</td>';
      } else {
        finalCell = '<td class="final-grade ' + (r.final.transmuted >= 75 ? 'passing' : 'failing') + '">' + r.final.transmuted + '</td>';
      }

      tr.innerHTML =
        '<td class="student-cell">' +
          '<div class="student-cell">' +
            '<div class="student-avatar ' + avatarClass + '">' + initials + '</div>' +
            '<div class="student-info">' +
              '<div class="name">' + (s.lastName || '') + ', ' + (s.firstName || '') + '</div>' +
              '<div class="meta">' + (s.section || '') + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        cellValue(r.scores.q1) + cellValue(r.scores.q2) + cellValue(r.scores.q3) +
        cellValue(r.scores.pt1) + cellValue(r.scores.pt2) + cellValue(r.scores.pt3) +
        cellValue(r.scores.st1) + cellValue(r.scores.st2) + cellValue(r.scores.te) +
        finalCell;

      tbody.appendChild(tr);
    });
  }

  function cellValue(pct) {
    if (pct == null) return '<td class="empty-cell">—</td>';
    const rounded = Math.round(pct);
    let color = '#37474f';
    if (rounded >= 90) color = '#2e7d32';
    else if (rounded >= 75) color = '#0d47a1';
    else if (rounded >= 65) color = '#ed6c02';
    else color = '#c62828';
    return '<td class="grade-cell" style="color:' + color + ';">' + rounded + '</td>';
  }

  /* ============================================================
     RENDER — STATS (Simplified)
     ============================================================ */
  function renderStats(rows) {
    const stats = document.getElementById('cr-stats');
    if (!stats) return;
    if (!rows.length) {
      stats.innerHTML = '<div class="cr-stat-card"><div class="cs-value">0</div><div class="cs-label">No Students</div></div>';
      return;
    }

    const rowsWithData = rows.filter((r) => r.compCount > 0);
    const partialScores = rowsWithData.map((r) => r.partialScore).filter((v) => v > 0);
    const avg = partialScores.length ? partialScores.reduce((a, b) => a + b, 0) / partialScores.length : 0;

    const completeFinals = rows.map((r) => (r.final && !r.final.insufficient) ? r.final.transmuted : null).filter((v) => v != null && v > 0);
    const passing = completeFinals.filter((v) => v >= 75).length;
    const failing = completeFinals.filter((v) => v < 75).length;

    const submissionCount = rows.reduce((acc, r) => acc + Object.values(r.scores).filter((v) => v != null).length, 0);
    const completion = rows.length ? Math.round((submissionCount / (rows.length * 9)) * 100) : 0;

    stats.innerHTML =
      '<div class="cr-stat-card blue"><div class="cs-icon">👥</div><div class="cs-value">' + rows.length + '</div><div class="cs-label">Students</div></div>' +
      '<div class="cr-stat-card ' + (avg >= 75 ? 'green' : 'amber') + '"><div class="cs-icon">📊</div><div class="cs-value">' + avg.toFixed(1) + '</div><div class="cs-label">Class Average</div></div>' +
      '<div class="cr-stat-card green"><div class="cs-icon">✅</div><div class="cs-value">' + passing + '</div><div class="cs-label">Passing</div></div>' +
      '<div class="cr-stat-card red"><div class="cs-icon">❌</div><div class="cs-value">' + failing + '</div><div class="cs-label">Failing</div></div>' +
      '<div class="cr-stat-card ' + (completion >= 75 ? 'green' : 'amber') + '"><div class="cs-icon">📝</div><div class="cs-value">' + completion + '%</div><div class="cs-label">Submission Rate</div></div>';
  }

  /* ============================================================
     TABS
     ============================================================ */
  function attachTabs() {
    const tabs = document.querySelectorAll('.cr-tab');
    const panels = {
      summary: document.getElementById('tab-summary'),
      distribution: document.getElementById('tab-distribution'),
      mll: document.getElementById('tab-mll'),
      transmutation: document.getElementById('tab-transmutation')
    };
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        Object.values(panels).forEach((p) => p && (p.style.display = 'none'));
        panels[tab.dataset.tab]?.style.setProperty('display', 'block');
      });
    });
  }

  /* ============================================================
     MAIN RENDER
     ============================================================ */
  async function render() {
    const term = document.getElementById('filter-term').value;
    const section = document.getElementById('filter-section').value;

    // Show loading
    const tbody = document.getElementById('summary-body');
    if (tbody && !allStudents.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">⏳ Loading students and PT grades...</td></tr>';
    }

    // Fetch students from cloud (if not yet loaded)
    if (!allStudents.length) {
      try {
        await fetchStudentsFromCloud();
      } catch (e) {
        return;
      }
    }

    // Fetch latest PT grades
    await fetchPTGrades();

    const students = getStudents(term, section);
    const rows = computeGrade(students, term);

    renderStats(rows);
    renderSummary(rows, term);
  }

  /* ============================================================
     EVENT LISTENERS
     ============================================================ */
  function attachListeners() {
    document.getElementById('filter-term').addEventListener('change', render);
    document.getElementById('filter-section').addEventListener('change', render);
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      allStudents = []; // Force re-fetch
      await render();
      if (typeof APP !== 'undefined' && APP.toast) APP.toast('Refreshed from cloud!', 'success', 1500);
    });
    if (document.getElementById('btn-export')) {
      document.getElementById('btn-export').addEventListener('click', () => {
        if (typeof APP !== 'undefined' && APP.toast) APP.toast('Export feature coming soon', 'info', 2000);
      });
    }
    if (document.getElementById('btn-logout')) {
      document.getElementById('btn-logout').addEventListener('click', () => TeacherAuth.logout());
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    attachTabs();
    attachListeners();
    render();
  });

})();

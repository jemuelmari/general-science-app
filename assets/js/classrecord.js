/* ============================================================
   classrecord.js — Gradebook logic (Cloud-First + Fixed)
   Version: 2.2.0
   ============================================================ */

(async function() {
  'use strict';

  console.log('[ClassRecord] Script loaded');

  if (typeof TeacherAuth !== 'undefined') {
    TeacherAuth.init();
    if (!TeacherAuth.require()) { console.log('[ClassRecord] Auth failed'); return; }
  }

  const WEIGHTS = (typeof CONFIG !== 'undefined' && CONFIG.WEIGHTS) || { ww: 0.20, pt: 0.50, ex: 0.30 };
  const EX_INTERNAL = (typeof CONFIG !== 'undefined' && CONFIG.EX_INTERNAL) || { st1: 0.30, st2: 0.30, te: 0.40 };

  let allStudents = [];
  let backendPTGrades = {};

  // ── FETCH DATA FROM BACKEND ──
  async function fetchStudentsFromCloud() {
    console.log('[ClassRecord] Fetching students from cloud...');
    const tbody = document.getElementById('summary-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">⏳ Syncing data from backend...</td></tr>';
    
    try {
      if (typeof TeacherCloud === 'undefined') throw new Error('TeacherCloud module not loaded.');
      allStudents = await TeacherCloud.fetchStudents();
      console.log('[ClassRecord] Fetched students:', allStudents.length);
    } catch (err) {
      console.error('[ClassRecord] Fetch error:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#c62828;">❌ ${err.message}</td></tr>`;
      throw err;
    }
  }

  async function fetchPTGrades() {
    console.log('[ClassRecord] Fetching PT Grades...');
    if (typeof PTGrade === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      console.warn('[ClassRecord] PTGrade or CONFIG missing');
      return;
    }
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
      console.warn('[ClassRecord] Failed to fetch PT grades:', e);
    }
  }

  // ── HELPERS ──
  function getStudents(term, section) {
    let list = allStudents;
    if (section) {
      const cleanFilter = section.replace(/_/g, ' ').trim().toUpperCase();
      list = list.filter(s => {
        const sSec = (s.section || '').replace(/_/g, ' ').trim().toUpperCase();
        return sSec === cleanFilter;
      });
    }
    return list.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
  }

  function getScorePercent(lrn, term, type, id) {
    if (type === 'pt') {
      var backendScore = backendPTGrades[lrn]?.[term]?.[id];
      if (backendScore !== undefined) return backendScore;
      return null;
    }

    const student = allStudents.find(s => s.lrn === lrn);
    if (!student) return null;
    
    const scores = student.progress?.scores?.[term] || {};
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

  // ── RENDER: SUMMARY TABLE ──
  function renderSummary(rows, term) {
    const tbody = document.getElementById('summary-body');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">No students found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    rows.forEach((r) => {
      const s = r.student;
      const initials = ((s.firstName || '?').charAt(0) + (s.lastName || '?').charAt(0)).toUpperCase();
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
            '<div class="student-avatar" style="background:#0d47a1;">' + initials + '</div>' +
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

  // ── RENDER: STATS ──
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

  // ── RENDER: DISTRIBUTION ──
  function renderDistribution(rows) {
    const grid = document.getElementById('distribution-grid');
    if (!grid) return;

    const finals = rows.map((r) => (r.final && !r.final.insufficient) ? r.final.transmuted : null).filter((v) => v != null && v > 0);
    const ranges = [
      { label: '90–100 (Outstanding)',   min: 90, max: 100, color: '#2e7d32' },
      { label: '85–89 (Very Satisfactory)', min: 85, max: 89, color: '#0d47a1' },
      { label: '80–84 (Satisfactory)',   min: 80, max: 84, color: '#0277bd' },
      { label: '75–79 (Fairly Satisfactory)', min: 75, max: 79, color: '#00acc1' },
      { label: 'Below 75 (Did Not Meet)', min: 0, max: 74, color: '#c62828' }
    ];
    const rangeCounts = ranges.map((r) => ({ ...r, count: finals.filter((f) => f >= r.min && f <= r.max).length }));

    const pcts = [];
    rows.forEach((r) => { Object.values(r.scores).forEach((v) => { if (v != null) pcts.push(v); }); });
    const avgMPS = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const pl = Transmutation.proficiencyLevel ? Transmutation.proficiencyLevel(avgMPS) : { level: 'N/A', key: 'info' };

    grid.innerHTML =
      '<div class="report-card">' +
        '<h4>📊 Grade Distribution</h4>' +
        (finals.length === 0
          ? '<p class="text-muted text-small" style="text-align:center;padding:20px;">No complete final grades yet.</p>'
          : rangeCounts.map((r) => (typeof UI !== 'undefined' && UI.renderDistributionRow) ? UI.renderDistributionRow(r.label, r.count, finals.length, r.color) : `<div>${r.label}: ${r.count}</div>`).join('')
        ) +
      '</div>' +
      '<div class="report-card">' +
        '<h4>🎯 Class Performance Summary</h4>' +
        '<div style="margin-top:16px;">' +
          '<div class="text-small text-muted" style="margin-bottom:6px;">Class MPS</div>' +
          '<div style="font-size:2rem;font-weight:800;color:' + mpsColor(avgMPS) + ';">' + avgMPS.toFixed(1) + '%</div>' +
          '<div style="margin-top:12px;"><span class="pl-indicator pl-' + pl.key + '">' + pl.level + '</span></div>' +
        '</div>' +
      '</div>';
  }

  function mpsColor(mps) {
    if (mps >= 90) return '#2e7d32';
    if (mps >= 75) return '#0d47a1';
    if (mps >= 50) return '#ed6c02';
    return '#c62828';
  }

  // ── RENDER: MLL ──
  function renderMLL(rows) {
    const grid = document.getElementById('mll-grid');
    if (!grid) return;
    const labels = { q1: 'Quiz 1', q2: 'Quiz 2', q3: 'Quiz 3', pt1: 'PT1', pt2: 'PT2', pt3: 'PT3', st1: 'ST1', st2: 'ST2', te: 'Term Exam' };
    const assessmentStats = Object.keys(labels).map((k) => {
      const pcts = rows.map((r) => r.scores[k]).filter((v) => v != null);
      return { key: k, label: labels[k], avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0, count: pcts.length };
    }).filter((a) => a.count > 0);

    const sorted = [...assessmentStats].sort((a, b) => b.avg - a.avg);
    const most = sorted.slice(0, 3);
    const least = sorted.slice(-3).reverse();

    grid.innerHTML =
      '<div class="report-card"><h4>✅ Most Learned</h4><ul class="mll-list">' +
        most.map((a) => `<li><div class="mll-desc"><span class="mll-code">${a.count} sub</span>${a.label}</div><div class="mll-mps" style="color:#2e7d32;">${a.avg.toFixed(1)}%</div></li>`).join('') +
      '</ul></div>' +
      '<div class="report-card"><h4>⚠️ Least Learned</h4><ul class="mll-list">' +
        least.map((a) => `<li><div class="mll-desc"><span class="mll-code">${a.count} sub</span>${a.label}</div><div class="mll-mps" style="color:#c62828;">${a.avg.toFixed(1)}%</div></li>`).join('') +
      '</ul></div>';
  }

  // ── RENDER: TRANSMUTATION ──
  function renderTransmutationTable() {
    const tbody = document.getElementById('transmutation-body');
    if (!tbody) return;
    const rows = [];
    for (let raw = 100; raw >= 0; raw -= 2) {
      const left = { raw, out: Transmutation.transmute ? Transmutation.transmute(raw) : raw };
      const right = raw - 1 >= 0 ? { raw: raw - 1, out: Transmutation.transmute ? Transmutation.transmute(raw - 1) : raw - 1 } : null;
      rows.push([left, right]);
    }
    tbody.innerHTML = rows.map(([l, r]) => '<tr><td class="raw">' + l.raw + '</td><td class="final">' + l.out + '</td>' + (r ? '<td class="raw">' + r.raw + '</td><td class="final">' + r.out + '</td>' : '<td></td><td></td>') + '</tr>').join('');
  }

  // ── TABS ──
  function attachTabs() {
    const tabs = document.querySelectorAll('.cr-tab');
    const panels = { summary: document.getElementById('tab-summary'), distribution: document.getElementById('tab-distribution'), mll: document.getElementById('tab-mll'), transmutation: document.getElementById('tab-transmutation') };
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        Object.values(panels).forEach((p) => p && (p.style.display = 'none'));
        panels[tab.dataset.tab]?.style.setProperty('display', 'block');
      });
    });
  }

  // ── MAIN RENDER ──
  async function render() {
    try {
      const term = document.getElementById('filter-term').value;
      const section = document.getElementById('filter-section').value;

      if (!allStudents.length) await fetchStudentsFromCloud();
      await fetchPTGrades();

      const students = getStudents(term, section);
      const rows = computeGrade(students, term);

      renderStats(rows);
      renderSummary(rows, term);
      renderDistribution(rows);
      renderMLL(rows);
      renderTransmutationTable();
    } catch (err) {
      console.error('[ClassRecord] Render error:', err);
      const tbody = document.getElementById('summary-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#c62828;">❌ Error: ${err.message}</td></tr>`;
    }
  }

  // ── EVENT LISTENERS & INIT ──
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[ClassRecord] DOM ready');
    attachTabs();
    document.getElementById('filter-term').addEventListener('change', render);
    document.getElementById('filter-section').addEventListener('change', render);
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      allStudents = [];
      await render();
    });
    document.getElementById('btn-logout').addEventListener('click', () => TeacherAuth.logout());
    
    render();
  });

})();

/* ============================================================
   classrecord.js — Gradebook logic
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Features:
   - Auth guard via TeacherAuth
   - Term + section filters
   - Weighted final grade (20% WW / 50% PT / 30% EX)
   - EX internal breakdown (ST1 30%, ST2 30%, TE 40%)
   - 4 tabs: Summary, Distribution, Most/Least Learned, Transmutation
   - CSV export
   - Auto-refresh on filter change
   ============================================================ */

(() => {
  'use strict';

  TeacherAuth.init();
  if (!TeacherAuth.require()) return;

  /* ============================================================
     WEIGHTING CONSTANTS (per config.js, DO 015, s. 2026)
     ============================================================ */
  const WEIGHTS = (typeof CONFIG !== 'undefined' && CONFIG.WEIGHTS) || {
    ww: 0.20,
    pt: 0.50,
    ex: 0.30
  };

  const EX_INTERNAL = (typeof CONFIG !== 'undefined' && CONFIG.EX_INTERNAL) || {
    st1: 0.30,
    st2: 0.30,
    te: 0.40
  };

  const ASSESSMENT_MAX = {
    quiz1: 20, quiz2: 20, quiz3: 20,
    st1: 30, st2: 30,
    pt1: 100, pt2: 100, pt3: 100,
    te: 60
  };

  /* ============================================================
     HELPERS
     ============================================================ */
  function getStudents(term, section) {
    let all = Store.getAllUsers();
    if (section) all = all.filter((s) => s.section === section);
    return APP.sortStudents(all, 'last', 'asc');
  }

  function getScorePercent(lrn, term, type, id) {
    const scores = Store.getScores(lrn);
    const t = scores[term] || {};
    let record = null;
    if (type === 'te') record = t.te;
    else record = t[type]?.[id];
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

      // WW average (quizzes only)
      const quizPcts = [q1, q2, q3].filter((v) => v != null);
      const wwAvg = quizPcts.length ? quizPcts.reduce((a, b) => a + b, 0) / quizPcts.length : null;

      // PT average
      const ptPcts = [pt1, pt2, pt3].filter((v) => v != null);
      const ptAvg = ptPcts.length ? ptPcts.reduce((a, b) => a + b, 0) / ptPcts.length : null;

      // EX = 30% ST1 + 30% ST2 + 40% TE
      let exAvg = null;
      if (st1 != null && st2 != null && te != null) {
        exAvg = (st1 * EX_INTERNAL.st1) + (st2 * EX_INTERNAL.st2) + (te * EX_INTERNAL.te);
      }

      // Compute final grade
      const finalGrade = Transmutation.computeFinalGrade(
        wwAvg ?? 0,
        ptAvg ?? 0,
        exAvg ?? 0,
        WEIGHTS
      );

      return {
        student: s,
        scores: { q1, q2, q3, st1, st2, pt1, pt2, pt3, te },
        wwAvg,
        ptAvg,
        exAvg,
        final: finalGrade
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
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">No students found.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    rows.forEach((r) => {
      const s = r.student;
      const initials = `${(s.firstName || '?').charAt(0)}${(s.lastName || '?').charAt(0)}`.toUpperCase();
      const avatarClass = UI.getAvatarClass(s.lrn);
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td class="student-cell">
          <div class="student-cell">
            <div class="student-avatar ${avatarClass}">${initials}</div>
            <div class="student-info">
              <div class="name">${APP.formatFullName(s.lastName, s.firstName, s.middleName)}</div>
              <div class="meta">${s.section}</div>
            </div>
          </div>
        </td>
        ${cellValue(r.scores.q1)}
        ${cellValue(r.scores.q2)}
        ${cellValue(r.scores.q3)}
        ${cellValue(r.scores.pt1, 'pt')}
        ${cellValue(r.scores.pt2, 'pt')}
        ${cellValue(r.scores.pt3, 'pt')}
        ${cellValue(r.scores.st1)}
        ${cellValue(r.scores.st2)}
        ${cellValue(r.scores.te)}
        <td class="final-grade ${r.final.transmuted >= 75 ? 'passing' : 'failing'}">
          ${r.final.transmuted || '—'}
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  function cellValue(pct, type) {
    if (pct == null) return `<td class="empty-cell">—</td>`;
    const rounded = Math.round(pct);
    let color = '#37474f';
    if (rounded >= 90) color = '#2e7d32';
    else if (rounded >= 75) color = '#0d47a1';
    else if (rounded >= 65) color = '#ed6c02';
    else color = '#c62828';

    return `<td class="grade-cell" style="color:${color};">${rounded}</td>`;
  }

  /* ============================================================
     RENDER — STATS
     ============================================================ */
  function renderStats(rows) {
    const stats = document.getElementById('cr-stats');
    if (!stats) return;

    if (!rows.length) {
      stats.innerHTML = `<div class="cr-stat-card"><div class="cs-value">0</div><div class="cs-label">No Students</div></div>`;
      return;
    }

    const finals = rows.map((r) => r.final.transmuted).filter((v) => v > 0);
    const avg = finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;
    const passing = finals.filter((v) => v >= 75).length;
    const failing = finals.filter((v) => v < 75).length;
    const completion = rows.length
      ? Math.round(
          rows.reduce((acc, r) => acc + Object.values(r.scores).filter((v) => v != null).length, 0) /
          (rows.length * 9) * 100
        )
      : 0;

    stats.innerHTML = `
      <div class="cr-stat-card blue">
        <div class="cs-icon">👥</div>
        <div class="cs-value">${rows.length}</div>
        <div class="cs-label">Students</div>
      </div>
      <div class="cr-stat-card ${avg >= 75 ? 'green' : 'amber'}">
        <div class="cs-icon">📊</div>
        <div class="cs-value">${avg.toFixed(1)}</div>
        <div class="cs-label">Class Average</div>
      </div>
      <div class="cr-stat-card green">
        <div class="cs-icon">✅</div>
        <div class="cs-value">${passing}</div>
        <div class="cs-label">Passing</div>
      </div>
      <div class="cr-stat-card red">
        <div class="cs-icon">❌</div>
        <div class="cs-value">${failing}</div>
        <div class="cs-label">Failing</div>
      </div>
      <div class="cr-stat-card ${completion >= 75 ? 'green' : 'amber'}">
        <div class="cs-icon">📝</div>
        <div class="cs-value">${completion}%</div>
        <div class="cs-label">Submission Rate</div>
      </div>
    `;
  }

  /* ============================================================
     RENDER — DISTRIBUTION
     ============================================================ */
  function renderDistribution(rows) {
    const grid = document.getElementById('distribution-grid');
    if (!grid) return;

    const finals = rows.map((r) => r.final.transmuted).filter((v) => v > 0);

    // Grade ranges
    const ranges = [
      { label: '90–100 (Outstanding)',   min: 90, max: 100, color: '#2e7d32' },
      { label: '85–89 (Very Satisfactory)', min: 85, max: 89, color: '#0d47a1' },
      { label: '80–84 (Satisfactory)',   min: 80, max: 84, color: '#0277bd' },
      { label: '75–79 (Fairly Satisfactory)', min: 75, max: 79, color: '#00acc1' },
      { label: 'Below 75 (Did Not Meet)', min: 0, max: 74, color: '#c62828' }
    ];

    const rangeCounts = ranges.map((r) => ({
      ...r,
      count: finals.filter((f) => f >= r.min && f <= r.max).length
    }));

    // Proficiency level distribution (based on MPS-like avg of quizzes + STs)
    const pcts = [];
    rows.forEach((r) => {
      Object.values(r.scores).forEach((v) => { if (v != null) pcts.push(v); });
    });
    const avgMPS = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    const pl = Transmutation.proficiencyLevel(avgMPS);

    grid.innerHTML = `
      <div class="report-card">
        <h4>📊 Grade Distribution</h4>
        ${rangeCounts.map((r) => UI.renderDistributionRow(r.label, r.count, finals.length, r.color)).join('')}
        ${finals.length === 0 ? '<p class="text-muted text-small">No grades to display yet.</p>' : ''}
      </div>

      <div class="report-card">
        <h4>🎯 Class Performance Summary</h4>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <div class="text-small text-muted" style="margin-bottom:6px;">Class MPS (across all assessments)</div>
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="font-size:2rem;font-weight:800;color:${mpsColor(avgMPS)};">${avgMPS.toFixed(1)}%</div>
              <span class="pl-indicator pl-${pl.key}">${pl.level}</span>
            </div>
          </div>
          <div>
            <div class="text-small text-muted" style="margin-bottom:6px;">Proficiency Level</div>
            <div style="font-size:0.9rem;color:#37474f;line-height:1.5;">
              Based on MPS, the class is classified as
              <strong style="color:${mpsColor(avgMPS)};">${pl.level}</strong>.
            </div>
          </div>
        </div>
      </div>

      <div class="report-card">
        <h4>📝 Submission Summary</h4>
        ${['q1', 'q2', 'q3', 'pt1', 'pt2', 'pt3', 'st1', 'st2', 'te'].map((k) => {
          const label = {
            q1: 'Quiz 1', q2: 'Quiz 2', q3: 'Quiz 3',
            pt1: 'PT1', pt2: 'PT2', pt3: 'PT3',
            st1: 'ST1', st2: 'ST2', te: 'Term Exam'
          }[k];
          const count = rows.filter((r) => r.scores[k] != null).length;
          return UI.renderDistributionRow(label, count, rows.length, '#1976d2');
        }).join('')}
      </div>
    `;
  }

  function mpsColor(mps) {
    if (mps >= 90) return '#2e7d32';
    if (mps >= 75) return '#0d47a1';
    if (mps >= 50) return '#ed6c02';
    return '#c62828';
  }

  /* ============================================================
     RENDER — MOST / LEAST LEARNED
     ============================================================ */
  function renderMLL(rows) {
    const grid = document.getElementById('mll-grid');
    if (!grid) return;

    const labels = {
      q1: 'Quiz 1', q2: 'Quiz 2', q3: 'Quiz 3',
      pt1: 'PT1', pt2: 'PT2', pt3: 'PT3',
      st1: 'ST1', st2: 'ST2', te: 'Term Exam'
    };

    // Compute average per assessment
    const assessmentStats = Object.keys(labels).map((k) => {
      const pcts = rows.map((r) => r.scores[k]).filter((v) => v != null);
      return {
        key: k,
        label: labels[k],
        avg: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0,
        count: pcts.length
      };
    }).filter((a) => a.count > 0);

    const sorted = [...assessmentStats].sort((a, b) => b.avg - a.avg);
    const most = sorted.slice(0, 3);
    const least = sorted.slice(-3).reverse();

    grid.innerHTML = `
      <div class="report-card">
        <h4>✅ Most Learned (Top 3)</h4>
        <ul class="mll-list">
          ${most.map((a) => `
            <li>
              <div class="mll-desc">
                <span class="mll-code">${a.count} submissions</span>
                ${a.label}
              </div>
              <div class="mll-mps" style="color:#2e7d32;">${a.avg.toFixed(1)}%</div>
            </li>
          `).join('')}
          ${most.length === 0 ? '<li class="text-muted">No data yet.</li>' : ''}
        </ul>
      </div>

      <div class="report-card">
        <h4>⚠️ Least Learned (Bottom 3)</h4>
        <ul class="mll-list">
          ${least.map((a) => `
            <li>
              <div class="mll-desc">
                <span class="mll-code">${a.count} submissions</span>
                ${a.label}
              </div>
              <div class="mll-mps" style="color:#c62828;">${a.avg.toFixed(1)}%</div>
            </li>
          `).join('')}
          ${least.length === 0 ? '<li class="text-muted">No data yet.</li>' : ''}
        </ul>
      </div>
    `;
  }

  /* ============================================================
     RENDER — TRANSMUTATION TABLE
     ============================================================ */
  function renderTransmutationTable() {
    const tbody = document.getElementById('transmutation-body');
    if (!tbody) return;

    const rows = [];
    for (let raw = 100; raw >= 0; raw -= 2) {
      const left = { raw, out: Transmutation.transmute(raw) };
      const right = raw - 1 >= 0 ? { raw: raw - 1, out: Transmutation.transmute(raw - 1) } : null;
      rows.push([left, right]);
    }

    tbody.innerHTML = rows.map(([l, r]) => `
      <tr>
        <td class="raw">${l.raw}</td>
        <td class="final">${l.out}</td>
        ${r
          ? `<td class="raw">${r.raw}</td><td class="final">${r.out}</td>`
          : `<td></td><td></td>`}
      </tr>
    `).join('');
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
     CSV EXPORT
     ============================================================ */
  function exportCSV() {
    const term = document.getElementById('filter-term').value;
    const section = document.getElementById('filter-section').value;
    const students = getStudents(term, section);
    const rows = computeGrade(students, term);

    const headers = [
      'Last Name', 'First Name', 'Middle Name', 'LRN', 'Section',
      'Quiz1', 'Quiz2', 'Quiz3',
      'PT1', 'PT2', 'PT3',
      'ST1', 'ST2', 'TE',
      'WW Avg', 'PT Avg', 'EX Avg',
      'Final Grade'
    ];

    const data = rows.map((r) => {
      const s = r.student;
      return [
        s.lastName || '',
        s.firstName || '',
        s.middleName || '',
        s.lrn,
        s.section,
        r.scores.q1 != null ? Math.round(r.scores.q1) : '',
        r.scores.q2 != null ? Math.round(r.scores.q2) : '',
        r.scores.q3 != null ? Math.round(r.scores.q3) : '',
        r.scores.pt1 != null ? Math.round(r.scores.pt1) : '',
        r.scores.pt2 != null ? Math.round(r.scores.pt2) : '',
        r.scores.pt3 != null ? Math.round(r.scores.pt3) : '',
        r.scores.st1 != null ? Math.round(r.scores.st1) : '',
        r.scores.st2 != null ? Math.round(r.scores.st2) : '',
        r.scores.te != null ? Math.round(r.scores.te) : '',
        r.wwAvg != null ? r.wwAvg.toFixed(1) : '',
        r.ptAvg != null ? r.ptAvg.toFixed(1) : '',
        r.exAvg != null ? r.exAvg.toFixed(1) : '',
        r.final.transmuted || ''
      ];
    });

    UI.exportCSV(`GSA_ClassRecord_${term}_${section || 'All'}.csv`, headers, data);
    APP.toast('Class record exported', 'success');
  }

  /* ============================================================
     MAIN RENDER
     ============================================================ */
  function render() {
    const term = document.getElementById('filter-term').value;
    const section = document.getElementById('filter-section').value;

    const students = getStudents(term, section);
    const rows = computeGrade(students, term);

    renderStats(rows);
    renderSummary(rows, term);
    renderDistribution(rows);
    renderMLL(rows);
    renderTransmutationTable();
  }

  /* ============================================================
     EVENT LISTENERS
     ============================================================ */
  function attachListeners() {
    document.getElementById('filter-term').addEventListener('change', render);
    document.getElementById('filter-section').addEventListener('change', render);
    document.getElementById('btn-refresh').addEventListener('click', () => {
      render();
      APP.toast('Refreshed', 'success', 1500);
    });
    document.getElementById('btn-export').addEventListener('click', exportCSV);
    document.getElementById('btn-logout').addEventListener('click', () => TeacherAuth.logout());
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
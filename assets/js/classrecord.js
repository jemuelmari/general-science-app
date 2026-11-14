/* ============================================================
   classrecord.js — Gradebook logic (Cloud-First + Fixed)
   Version: 3.0.0
   v3.0.0: - Scores come from TeacherCloud (PT grades + teacher/paper
             overrides already merged) — same numbers as Grading Sheet,
             Reports and Assessment Tracker.
           - One grade formula: Transmutation.computeTermGrade().
           - Most & Least Learned tab is now COMPETENCY based (top 5 / 5,
             code + full statement, from ST1 + ST2 item results).
           - Student names are HTML-escaped. Paper scores are marked "P".
   ============================================================ */

(async function() {
  'use strict';

  console.log('[ClassRecord] Script loaded');

  if (typeof TeacherAuth !== 'undefined') {
    TeacherAuth.init();
    if (!TeacherAuth.require()) { console.log('[ClassRecord] Auth failed'); return; }
  }

  const RAW_PASS = (typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70;
  const esc = (v) => (typeof APP !== 'undefined' && APP.escapeHtml) ? APP.escapeHtml(v) : String(v == null ? '' : v);

  let allStudents = [];

  // ── FETCH DATA FROM BACKEND ──
  async function fetchStudentsFromCloud() {
    console.log('[ClassRecord] Fetching students from cloud...');
    const tbody = document.getElementById('summary-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">⏳ Syncing data from backend...</td></tr>';
    
    try {
      if (typeof TeacherCloud === 'undefined') throw new Error('TeacherCloud module not loaded.');
      allStudents = await TeacherCloud.fetchStudents({ withItems: true });
      console.log('[ClassRecord] Fetched students:', allStudents.length);
    } catch (err) {
      console.error('[ClassRecord] Fetch error:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#c62828;">❌ ${err.message}</td></tr>`;
      throw err;
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

  const IDS = { q1: 'quiz1', q2: 'quiz2', q3: 'quiz3', st1: 'st1', st2: 'st2', pt1: 'pt1', pt2: 'pt2', pt3: 'pt3', te: 'te' };

  function getRec(s, term, id) {
    return TeacherCloud.getRecord((s.progress && s.progress.scores) || {}, term, id);
  }

  function computeGrade(students, term) {
    return students.map((s) => {
      const scores = {}, paper = {};
      Object.keys(IDS).forEach(k => {
        const rec = getRec(s, term, IDS[k]);
        scores[k] = TeacherCloud.percentOf(rec);
        paper[k] = !!(rec && rec.override);
      });
      const g = Transmutation.computeTermGrade(scores);
      const compCount = Object.values(scores).filter((v) => v != null).length;
      return {
        student: s, scores: scores, paper: paper,
        wwAvg: g.wwAvg, ptAvg: g.ptAvg, exAvg: g.exAvg, final: g.final,
        partialScore: g.partialScore == null ? 0 : g.partialScore,
        partialTransmuted: g.partialTransmuted, compCount
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
            '<div class="student-avatar" style="background:#0d47a1;">' + esc(initials) + '</div>' +
            '<div class="student-info">' +
              '<div class="name">' + esc((s.lastName || '') + ', ' + (s.firstName || '')) + '</div>' +
              '<div class="meta">' + esc(s.section || '') + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        ['q1', 'q2', 'q3', 'pt1', 'pt2', 'pt3', 'st1', 'st2', 'te'].map(k => cellValue(r.scores[k], r.paper[k])).join('') +
        finalCell;

      tbody.appendChild(tr);
    });
  }

  function cellValue(pct, isPaper) {
    if (pct == null) return '<td class="empty-cell">—</td>';
    const rounded = Math.round(pct);
    let color = '#37474f';
    if (rounded >= 90) color = '#2e7d32';
    else if (rounded >= RAW_PASS) color = '#0d47a1';
    else if (rounded >= RAW_PASS - 10) color = '#ed6c02';
    else color = '#c62828';
    const tag = isPaper ? '<sup title="Paper / teacher-entered score" style="color:#6a1b9a;font-weight:700;margin-left:2px;">P</sup>' : '';
    return '<td class="grade-cell" style="color:' + color + ';">' + rounded + tag + '</td>';
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
    const partialScores = rowsWithData.map((r) => r.partialTransmuted).filter((v) => v != null && v > 0);
    const avg = partialScores.length ? partialScores.reduce((a, b) => a + b, 0) / partialScores.length : 0;

    const completeFinals = rows.map((r) => (r.final && !r.final.insufficient) ? r.final.transmuted : null).filter((v) => v != null && v > 0);
    const passing = completeFinals.filter((v) => v >= 75).length;
    const failing = completeFinals.filter((v) => v < 75).length;

    const submissionCount = rows.reduce((acc, r) => acc + Object.values(r.scores).filter((v) => v != null).length, 0);
    const completion = rows.length ? Math.round((submissionCount / (rows.length * 9)) * 100) : 0;

    stats.innerHTML =
      '<div class="cr-stat-card blue"><div class="cs-icon">👥</div><div class="cs-value">' + rows.length + '</div><div class="cs-label">Students</div></div>' +
      '<div class="cr-stat-card ' + (avg >= 75 ? 'green' : 'amber') + '"><div class="cs-icon">📊</div><div class="cs-value">' + avg.toFixed(1) + '</div><div class="cs-label">Class Average (transmuted)</div></div>' +
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

  // ── RENDER: MLL (competency-based, ST1 + ST2) ──
  async function renderMLL(students, term) {
    const grid = document.getElementById('mll-grid');
    if (!grid) return;
    if (typeof CompetencyAnalysis === 'undefined') { grid.innerHTML = '<div class="report-card">Competency module not loaded.</div>'; return; }
    grid.innerHTML = '<div class="report-card">⏳ Computing competency MPS from ST1 and ST2…</div>';
    try {
      const list = await CompetencyAnalysis.competencyMPS(students, term, ['st1', 'st2']);
      if (!list.length) { grid.innerHTML = '<div class="report-card"><p class="text-muted">No ST1 / ST2 item data yet for this term.</p></div>'; return; }
      const ml = CompetencyAnalysis.mostLeast(list, 5);
      const li = (c, color) => '<li><div class="mll-desc"><span class="mll-code">' + esc(c.code) + '</span>' + esc(c.description) +
        '<div class="text-small text-muted">' + esc(CompetencyAnalysis.mpsLevel(c.mps)) + ' · ' + c.students + ' students</div></div>' +
        '<div class="mll-mps" style="color:' + color + ';">' + c.mps.toFixed(1) + '%</div></li>';
      const note = ml.available < 10 ? '<p class="text-small text-muted" style="margin-top:8px;">ST1 + ST2 cover ' + ml.available + ' competencies this term, so each competency appears in only one list (least learned is filled first).</p>' : '';
      grid.innerHTML =
        '<div class="report-card"><h4>✅ Most Learned (top ' + ml.most.length + ')</h4><ul class="mll-list">' + ml.most.map(c => li(c, '#2e7d32')).join('') + '</ul></div>' +
        '<div class="report-card"><h4>⚠️ Least Learned (top ' + ml.least.length + ') — Term Exam basis</h4><ul class="mll-list">' + ml.least.map(c => li(c, '#c62828')).join('') + '</ul>' + note + '</div>';
    } catch (e) {
      grid.innerHTML = '<div class="report-card" style="color:#c62828;">⚠️ ' + esc(e.message) + '</div>';
    }
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

      const students = getStudents(term, section);
      const rows = computeGrade(students, term);

      renderStats(rows);
      renderSummary(rows, term);
      renderDistribution(rows);
      renderMLL(students, term);
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

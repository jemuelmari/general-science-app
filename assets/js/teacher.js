/* ============================================================
   teacher.js — Teacher dashboard logic
   Version: 1.1.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.1.0: Added Term Control feature integration
   ============================================================ */

(() => {
  'use strict';

  // ---------- Auth guard ----------
  TeacherAuth.init();
  if (!TeacherAuth.require()) return;

  /* ============================================================
     HELPERS
     ============================================================ */
  function getStudentsBySection(section) {
    const all = Store.getAllUsers();
    if (!section) return all;
    return all.filter((u) => u.section === section);
  }

  function countCompletedDays(lrn, term) {
    const progress = Store.getProgress(lrn);
    return progress[term]?.completed?.length || 0;
  }

  function getOverallProgress(lrn) {
    const t1 = countCompletedDays(lrn, 'term1');
    const t2 = countCompletedDays(lrn, 'term2');
    const t3 = countCompletedDays(lrn, 'term3');
    return {
      term1: t1,
      term2: t2,
      term3: t3,
      total: t1 + t2 + t3,
      max: 120
    };
  }

  function countAssessmentsCompleted(lrn, term) {
    const scores = Store.getScores(lrn);
    const t = scores[term] || {};
    let count = 0;
    if (t.quizzes) count += Object.keys(t.quizzes).length;
    if (t.st) count += Object.keys(t.st).length;
    if (t.pt) count += Object.keys(t.pt).length;
    if (t.te) count += 1;
    return count;
  }

  /* ============================================================
     QUICK STATS
     ============================================================ */
  function renderQuickStats() {
    const students = Store.getAllUsers();
    const total = students.length;

    let totalDays = 0;
    let activeCount = 0;
    let alertsCount = 0;

    students.forEach((s) => {
      const prog = getOverallProgress(s.lrn);
      totalDays += prog.total;
      if (prog.total > 0) activeCount++;
      if (prog.total < 10) alertsCount++;
    });

    const avgProgress = total ? Math.round(totalDays / (total * 120) * 100) : 0;

    const stats = [
      { value: total, label: 'Total Students', icon: '👥', color: 'blue' },
      { value: activeCount, label: 'Active Learners', icon: '✍️', color: 'green' },
      { value: avgProgress + '%', label: 'Avg Progress', icon: '📈', color: 'blue' },
      { value: alertsCount, label: 'Needs Follow-Up', icon: '⚠️', color: alertsCount > 0 ? 'red' : 'green' }
    ];

    document.getElementById('stat-total').textContent = total;
    document.getElementById('quick-stats').innerHTML = stats.map((s) => `
      <div class="stat-card ${s.color}">
        <div class="stat-icon">${s.icon}</div>
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');
  }

  /* ============================================================
     ROSTER
     ============================================================ */
  function renderRoster() {
    const sectionFilter = document.getElementById('roster-section').value;
    const search = document.getElementById('roster-search').value.trim().toLowerCase();

    let students = getStudentsBySection(sectionFilter);

    if (search) {
      students = students.filter((s) => {
        const fullName = APP.formatFullName(s.lastName, s.firstName, s.middleName).toLowerCase();
        const lrn = String(s.lrn).toLowerCase();
        return fullName.includes(search) || lrn.includes(search);
      });
    }

    students = APP.sortStudents(students, 'last', 'asc');

    const tbody = document.getElementById('roster-body');

    if (!students.length) {
      tbody.innerHTML = `
        <tr><td colspan="8" style="text-align:center;padding:40px;color:#90a4ae;">
          <div style="font-size:2rem;margin-bottom:8px;">📭</div>
          No students found${search ? ` matching "${search}"` : ''}.
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    students.forEach((s) => {
      const initials = `${(s.firstName || '?').charAt(0)}${(s.lastName || '?').charAt(0)}`.toUpperCase();
      const avatarClass = UI.getAvatarClass(s.lrn);

      const t1 = countCompletedDays(s.lrn, 'term1');
      const t2 = countCompletedDays(s.lrn, 'term2');
      const t3 = countCompletedDays(s.lrn, 'term3');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="student-cell">
            <div class="student-avatar ${avatarClass}">${initials}</div>
            <div class="student-info">
              <div class="name">${APP.formatFullName(s.lastName, s.firstName, s.middleName)}</div>
              <div class="meta">Grade ${s.gradeLevel} · ${s.section}</div>
            </div>
          </div>
        </td>
        <td style="font-family:'Consolas',monospace;font-size:0.8rem;">${APP.formatLRN(s.lrn)}</td>
        <td><span class="badge-pill info">${s.section}</span></td>
        <td>${APP.getSexBadge(s.sex)}</td>
        <td>${progressBadge(t1)}</td>
        <td>${progressBadge(t2)}</td>
        <td>${progressBadge(t3)}</td>
        <td>
          <button class="btn btn-outline" style="padding:4px 10px;font-size:0.75rem;" data-view="${s.lrn}">
            👁 View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lrn = btn.dataset.view;
        openStudentDetail(lrn);
      });
    });
  }

  function progressBadge(count) {
    const pct = Math.round((count / 40) * 100);
    if (count === 0) return `<span style="color:#bdbdbd;">0/40</span>`;
    if (pct >= 90) return `<span style="color:#2e7d32;font-weight:700;">${count}/40</span>`;
    if (pct >= 50) return `<span style="color:#0d47a1;font-weight:700;">${count}/40</span>`;
    if (pct >= 20) return `<span style="color:#ed6c02;font-weight:700;">${count}/40</span>`;
    return `<span style="color:#c62828;font-weight:700;">${count}/40</span>`;
  }

  /* ============================================================
     STUDENT DETAIL MODAL
     ============================================================ */
  function openStudentDetail(lrn) {
    const student = Store.getUser(lrn);
    if (!student) return;

    const progress = getOverallProgress(lrn);
    const scores = Store.getScores(lrn);

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;
      z-index:9999;padding:20px;overflow-y:auto;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background:#fff;border-radius:14px;padding:0;
      max-width:600px;width:100%;max-height:90vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.3);
    `;

    const initials = `${(student.firstName || '?').charAt(0)}${(student.lastName || '?').charAt(0)}`.toUpperCase();
    const avatarClass = UI.getAvatarClass(student.lrn);

    const allSTs = [];
    ['term1', 'term2', 'term3'].forEach((term) => {
      Object.values(scores[term]?.st || {}).forEach((s) => {
        if (s && s.total) allSTs.push((s.score / s.total) * 100);
      });
    });
    const avg = allSTs.length ? allSTs.reduce((a, b) => a + b, 0) / allSTs.length : 0;
    const classification = Transmutation.classifyStudent(avg);

    modal.innerHTML = `
      <div style="padding:24px;background:linear-gradient(135deg,#0d47a1,#1976d2,#00acc1);color:#fff;border-radius:14px 14px 0 0;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div class="student-avatar ${avatarClass}" style="width:56px;height:56px;font-size:1.1rem;">${initials}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:1.1rem;">${APP.formatFullName(student.lastName, student.firstName, student.middleName)}</div>
            <div style="font-size:0.8rem;opacity:0.9;margin-top:2px;">
              LRN: ${APP.formatLRN(student.lrn)} · ${student.section} · ${APP.getSexValue(student.sex) || '—'}
            </div>
          </div>
          <button id="detail-close" style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:1.2rem;width:36px;height:36px;border-radius:50%;cursor:pointer;">×</button>
        </div>
      </div>

      <div style="padding:20px 24px;">

        <div style="margin-bottom:20px;">
          <div style="font-size:0.75rem;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Overall Standing</div>
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f5f7fa;border-radius:10px;">
            <span class="badge-pill ${classification.key === 'enrichment' ? 'success' : classification.key === 'on-track' ? 'info' : classification.key === 'remediation' ? 'warning' : 'danger'}">
              ${classification.label}
            </span>
            <span style="font-size:0.85rem;color:#37474f;">
              ST Average: <strong>${avg.toFixed(1)}%</strong>
            </span>
          </div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:0.75rem;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Progress by Term</div>
          ${['term1','term2','term3'].map((t, i) => {
            const count = progress[t];
            const pct = Math.round((count / 40) * 100);
            return `
              <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#37474f;margin-bottom:4px;">
                  <span>Term ${i+1}</span>
                  <span>${count}/40 days · ${pct}%</span>
                </div>
                <div class="progress-bar-modern">
                  <div class="fill ${pct >= 90 ? 'green' : pct >= 50 ? 'blue' : pct >= 20 ? 'amber' : 'red'}"
                       style="width:${pct}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:0.75rem;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Assessments Completed</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${['term1','term2','term3'].map((t, i) => {
              const count = countAssessmentsCompleted(lrn, t);
              return `
                <div style="text-align:center;padding:12px;background:#f5f7fa;border-radius:10px;">
                  <div style="font-size:1.4rem;font-weight:800;color:#0d47a1;">${count}</div>
                  <div style="font-size:0.7rem;color:#5f6368;text-transform:uppercase;letter-spacing:0.3px;">Term ${i+1}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="classrecord.html" class="btn btn-primary" style="flex:1;text-align:center;">📊 Open in Class Record</a>
          <button id="detail-export" class="btn btn-outline" style="flex:1;">📥 Export Data</button>
        </div>

      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('#detail-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    modal.querySelector('#detail-export').onclick = () => {
      const data = Store.exportAll(lrn);
      if (!data) {
        APP.toast('No data to export', 'warning');
        return;
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSA_${student.lastName}_${student.firstName}_${student.lrn}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      APP.toast('Student data exported', 'success');
    };
  }

  /* ============================================================
     EVENT LISTENERS
     ============================================================ */
  function attachListeners() {
    document.getElementById('roster-section').addEventListener('change', renderRoster);
    document.getElementById('roster-search').addEventListener('input', renderRoster);

    document.getElementById('btn-logout').addEventListener('click', () => {
      TeacherAuth.logout();
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    renderQuickStats();
    renderRoster();
    attachListeners();
  });

})();

/* ============================================================
   dashboard.js — Student dashboard logic
   Version: 1.0.0
   App: General Science
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Auth guard ---------- */
  const user = Store.getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  /* ---------- User pill ---------- */
  APP.$('#user-pill').textContent =
    `${user.firstName} ${user.lastName.charAt(0)}. · ${user.section}`;

  /* ---------- Hero greeting ---------- */
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  APP.$('#dash-avatar').textContent = initials;
  APP.$('#greeting-name').textContent = `Hello, ${user.firstName}! 👋`;
  APP.$('#greeting-meta').innerHTML = `
    <span>🎓 LRN: ${APP.formatLRN(user.lrn)}</span>
    <span>📘 Grade ${user.gradeLevel} — ${user.section}</span>
  `;

  /* ---------- Compute standing ---------- */
  function computeStanding() {
    const scores = Store.getScores(user.lrn);
    const allSTs = [];

    ['term1', 'term2', 'term3'].forEach((term) => {
      const st = scores[term]?.st || {};
      Object.values(st).forEach((s) => {
        if (s && s.total) allSTs.push((s.score / s.total) * 100);
      });
    });

    if (!allSTs.length) return { label: 'No data yet', key: 'on-track', avg: null };

    const avg = allSTs.reduce((a, b) => a + b, 0) / allSTs.length;
    return { ...Transmutation.classifyStudent(avg), avg };
  }

  const standing = computeStanding();

  APP.$('#standing-badge').innerHTML = `
    <div style="text-align:right;">
      <div class="badge badge-${standing.key}" style="font-size:0.9rem;padding:8px 16px;">
        ${standing.label}
      </div>
      ${standing.avg !== null ? `<div class="text-small text-muted" style="margin-top:4px;">ST Average: ${standing.avg.toFixed(1)}%</div>` : ''}
    </div>
  `;

  /* ---------- Quick stats ---------- */
  const progress = Store.getProgress(user.lrn);
  const badges = Store.getBadges(user.lrn);

  const stats = [
    { value: (progress.term1?.completed?.length || 0), label: 'Term 1 Days Done' },
    { value: (progress.term2?.completed?.length || 0), label: 'Term 2 Days Done' },
    { value: (progress.term3?.completed?.length || 0), label: 'Term 3 Days Done' },
    { value: (badges.term1?.length || 0) + (badges.term2?.length || 0) + (badges.term3?.length || 0), label: 'Total Badges' },
    { value: standing.avg !== null ? `${standing.avg.toFixed(0)}%` : '—', label: 'ST Average' }
  ];

  APP.$('#quick-stats').innerHTML = stats.map((s) => `
    <div class="qs-card green">
      <div class="qs-info">
        <div class="qs-value">${s.value}</div>
        <div class="qs-label">${s.label}</div>
      </div>
    </div>
  `).join('');

  /* ---------- Term cards ---------- */
  const terms = [
    {
      id: 'term1',
      title: 'Term 1',
      desc: 'Physics & Chemistry',
      icon: '⚛️',
      topics: 'Motion · Machines · Hydraulics · Light · Sound · Chemistry',
      totalWeeks: 10
    },
    {
      id: 'term2',
      title: 'Term 2',
      desc: 'Chemistry & Life Science',
      icon: '🧪',
      topics: 'Chemical Reactions · Solutions · Cells · Organ Systems · Climate',
      totalWeeks: 10
    },
    {
      id: 'term3',
      title: 'Term 3',
      desc: 'Earth Science',
      icon: '🌏',
      topics: 'Earth\'s Uniqueness · Philippine Geology · Hazards · DRRM',
      totalWeeks: 10
    }
  ];

  APP.$('#terms-grid').innerHTML = terms.map((t) => {
    const done = progress[t.id]?.completed?.length || 0;
    const totalDays = t.totalWeeks * 4;
    const pct = Math.round((done / totalDays) * 100);
    const locked = t.id !== 'term1' && !progress[terms[terms.indexOf(t) - 1].id]?.completed?.includes(
      `${terms[terms.indexOf(t) - 1].id}-w10-d4`
    );

    return `
      <div class="subject-card" data-term="${t.id}" style="${locked ? 'opacity:0.5;cursor:not-allowed;' : ''}">
        <div style="font-size:2rem;">${t.icon}</div>
        <h3>${t.title} — ${t.desc}</h3>
        <p class="text-muted text-small">${t.topics}</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
        <p class="text-small text-muted">${done}/${totalDays} days · ${pct}% complete</p>
        ${locked ? '<span class="badge badge-warning" style="margin-top:8px;">🔒 Locked</span>' : ''}
      </div>
    `;
  }).join('');

  document.querySelectorAll('[data-term]').forEach((card) => {
    card.addEventListener('click', () => {
      const term = card.dataset.term;
      if (card.style.opacity === '0.5') {
        APP.toast('Complete the previous term first.', 'warning');
        return;
      }
      window.location.href = `${term}/index.html`;
    });
  });

  /* ---------- Badges ---------- */
  const allBadges = [
    { id: 'physicist',        icon: '⚛️', name: 'Physicist' },
    { id: 'machine-master',   icon: '⚙️', name: 'Machine Master' },
    { id: 'hydraulics-pro',   icon: '💧', name: 'Hydraulics Pro' },
    { id: 'chemist',          icon: '🧪', name: 'Chemist' },
    { id: 'reaction-master',  icon: '⚗️', name: 'Reaction Master' },
    { id: 'cell-explorer',    icon: '🔬', name: 'Cell Explorer' },
    { id: 'systems-pro',      icon: '🫀', name: 'Systems Pro' },
    { id: 'earth-scientist',  icon: '🌏', name: 'Earth Scientist' }
  ];

  const earnedSet = new Set([
    ...(badges.term1 || []),
    ...(badges.term2 || []),
    ...(badges.term3 || [])
  ]);

  APP.$('#badge-total').textContent = `🏆 ${earnedSet.size} badges earned`;
  APP.$('#badge-week').textContent = `This week: ${earnedSet.size}`;

  APP.$('#badge-gallery').innerHTML = allBadges.map((b) => {
    const earned = earnedSet.has(b.id);
    return `
      <div class="badge-item ${earned ? '' : 'locked'}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
      </div>
    `;
  }).join('');

  /* ---------- Sync UI ---------- */
  const syncBtnCode = APP.$('#btn-sync-code');

  if (syncBtnCode) {
    const backendOn = Sync.backendEnabled();
    syncBtnCode.textContent = backendOn
      ? '🔑 Generate Sync Code (works anywhere)'
      : '🔑 Generate Sync Code (this device only)';

    if (!backendOn) {
      const warn = document.createElement('div');
      warn.className = 'alert alert-warning';
      warn.style.cssText = 'margin-top:12px;font-size:0.85rem;';
      warn.innerHTML = `
        <strong>⚠️ Sync Code is limited</strong>
        <p style="margin-top:6px;">Sync Codes currently only work if the teacher uses the <strong>same device</strong>.
        To send progress from a different device, use <strong>Download Backup (JSON)</strong> instead.</p>
      `;
      syncBtnCode.parentElement.appendChild(warn);
    } else {
      const info = document.createElement('div');
      info.className = 'alert alert-success';
      info.style.cssText = 'margin-top:12px;font-size:0.85rem;';
      info.innerHTML = `
        <strong>✅ Cross-device sync enabled</strong>
        <p style="margin-top:6px;">Sync Codes work on any device connected to the internet.</p>
      `;
      syncBtnCode.parentElement.appendChild(info);
    }
  }

  /* ---------- Sync: Generate Code ---------- */
  if (syncBtnCode) {
    syncBtnCode.addEventListener('click', async () => {
      syncBtnCode.disabled = true;
      syncBtnCode.textContent = '⏳ Generating...';
      try {
        const result = await Sync.generateSyncCode(user.lrn, null);
        const modeLabel = result.mode === 'backend'
          ? '<span style="color:var(--color-success);">✅ Works across devices</span>'
          : '<span style="color:var(--color-warning);">⚠️ Only works on THIS device</span>';
        APP.$('#sync-output').innerHTML = `
          <div class="alert alert-success">
            <strong>✅ Sync Code Generated!</strong>
            <div style="font-family:monospace;font-size:1.4rem;margin:12px 0;text-align:center;padding:12px;background:#fff;border-radius:6px;letter-spacing:1px;">
              ${result.code}
            </div>
            <p class="text-small" style="margin-bottom:8px;">Mode: ${modeLabel}</p>
            <p class="text-small">${result.mode === 'backend'
              ? 'Send this code to your teacher — they can import it from any device.'
              : 'Your teacher must use the SAME device to import this code.'}</p>
          </div>
        `;
        APP.toast('Sync code generated!', 'success');
      } catch (e) {
        APP.toast('Failed: ' + e.message, 'danger');
      } finally {
        syncBtnCode.disabled = false;
        syncBtnCode.textContent = Sync.backendEnabled()
          ? '🔑 Generate Sync Code (works anywhere)'
          : '🔑 Generate Sync Code (this device only)';
      }
    });
  }

  /* ---------- Sync: Export JSON ---------- */
  APP.$('#btn-export-json').addEventListener('click', async () => {
    try {
      const fn = await Sync.exportAsFile(user.lrn, null);
      APP.toast(`Saved: ${fn}`, 'success');
    } catch (e) {
      APP.toast('Export failed: ' + e.message, 'danger');
    }
  });

  /* ---------- Sync: Import JSON ---------- */
  APP.$('#btn-import-json').addEventListener('click', () => {
    APP.$('#import-file').click();
  });

  APP.$('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await Backup.uploadBackup(file);
      APP.toast(`Backup restored for ${data.user.firstName}!`, 'success');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      APP.toast('Import failed: ' + err.message, 'danger');
    }
    e.target.value = '';
  });

  /* ---------- Log Out ---------- */
  APP.$('#btn-logout').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(255,255,255,0.95);
      display:flex;align-items:center;justify-content:center;
      z-index:99999;font-family:'Segoe UI',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:2rem;">👋</div>
        <div style="font-weight:600;color:#0d47a1;margin-top:8px;">Logging out...</div>
      </div>
    `;
    document.body.appendChild(overlay);

    sessionStorage.setItem('gsa_logout_pending', JSON.stringify({
      lrn: user.lrn,
      at: Date.now()
    }));

    Store.clearSession();

    setTimeout(() => {
      window.location.replace('login.html');
    }, 150);
  });

})();

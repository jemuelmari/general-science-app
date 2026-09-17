/* ============================================================
   ui-helpers.js — Shared UI rendering utilities
   Version: 1.0.0
   App: General Science
   ============================================================ */

const UI = (() => {
  'use strict';

  /* ============================================================
     AVATARS
     ============================================================ */
  function getInitials(firstName, lastName) {
    const f = (firstName || '?').trim().charAt(0).toUpperCase();
    const l = (lastName || '?').trim().charAt(0).toUpperCase();
    return `${f}${l}`;
  }

  function getAvatarClass(seed) {
    const s = String(seed || '0');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    const n = (Math.abs(hash) % 6) + 1;
    return `av-${n}`;
  }

  function renderAvatar(firstName, lastName, seed) {
    const initials = getInitials(firstName, lastName);
    const cls = getAvatarClass(seed || `${firstName}${lastName}`);
    return `<div class="student-avatar ${cls}">${initials}</div>`;
  }

  function renderStudentCell(user, meta) {
    const avatar = renderAvatar(user.firstName, user.lastName, user.lrn);
    const name = APP.formatFullName(user.lastName, user.firstName, user.middleName);
    const metaText = meta || `LRN: ${APP.formatLRN(user.lrn)} · ${user.section}`;
    return `
      <div class="student-cell">
        ${avatar}
        <div class="student-info">
          <div class="name">${name}</div>
          <div class="meta">${metaText}</div>
        </div>
      </div>
    `;
  }

  /* ============================================================
     PROGRESS RINGS
     ============================================================ */
  function renderProgressRing(pct, opts = {}) {
    const size = opts.size || 60;
    const stroke = opts.stroke || 6;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(pct, 100) / 100) * circumference;
    const color = opts.color || getPctHex(pct);
    const label = opts.label !== false ? `${Math.round(pct)}%` : '';

    return `
      <div class="progress-ring" style="width:${size}px;height:${size}px;">
        <svg width="${size}" height="${size}">
          <circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${radius}"></circle>
          <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${radius}"
                  stroke="${color}"
                  stroke-dasharray="${circumference}"
                  stroke-dashoffset="${offset}"></circle>
        </svg>
        ${label ? `<div class="label" style="color:${color};">${label}</div>` : ''}
      </div>
    `;
  }

  function renderProgressBar(pct, color = null) {
    const c = color || getPctColor(pct);
    return `
      <div class="progress-bar-modern">
        <div class="fill ${c}" style="width:${Math.min(pct, 100)}%;"></div>
      </div>
    `;
  }

  function getPctColor(pct) {
    if (pct >= 90) return 'green';
    if (pct >= 75) return 'blue';
    if (pct >= 50) return 'amber';
    return 'red';
  }

  function getPctHex(pct) {
    if (pct >= 90) return '#2e7d32';
    if (pct >= 75) return '#0277bd';
    if (pct >= 50) return '#ed6c02';
    return '#c62828';
  }

  /* ============================================================
     BAR CHARTS
     ============================================================ */
  function renderBarChart(data, opts = {}) {
    const height = opts.height || 120;
    const maxVal = opts.maxValue || Math.max(...data.map((d) => d.value), 1);
    const color = opts.color;

    return `
      <div class="bar-chart" style="height:${height}px;">
        ${data.map((d) => {
          const pct = (d.value / maxVal) * 100;
          const barStyle = color
            ? `height:${pct}%;background:${color};`
            : `height:${pct}%;`;
          return `
            <div class="bar" style="${barStyle}">
              <span class="bar-value">${d.value}</span>
              <span class="bar-label">${d.label}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /* ============================================================
     DISTRIBUTION BARS
     ============================================================ */
  function renderDistributionRow(label, count, total, color) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    const bg = color || 'linear-gradient(90deg, #0d47a1, #1976d2)';
    return `
      <div class="distribution-row">
        <span class="distribution-label">${label}</span>
        <div class="distribution-bar">
          <div class="distribution-fill" style="width:${pct}%;background:${bg};">
            ${pct > 8 ? pct + '%' : ''}
          </div>
        </div>
        <span class="distribution-count">${count}</span>
      </div>
    `;
  }

  /* ============================================================
     ACTIVITY HEATMAP
     ============================================================ */
  function renderHeatmap(dayDetails, opts = {}) {
    const prefix = opts.prefix || 'term1';
    const weeks = opts.weeks || 10;

    let html = '<div class="activity-heatmap">';
    for (let w = 1; w <= weeks; w++) {
      html += '<div class="heatmap-week">';
      html += `<div class="week-label">W${w}</div>`;
      html += '<div class="heatmap-days">';
      for (let d = 1; d <= 4; d++) {
        const key = `${prefix}-w${w}-d${d}`;
        const done = dayDetails[key] ? 'done-4' : 'done-0';
        html += `<div class="heatmap-day ${done}" title="Week ${w} Day ${d}"></div>`;
      }
      html += '</div></div>';
    }
    html += '</div>';
    return html;
  }

  function renderWeekGrid(dayDetails, opts = {}) {
    const prefix = opts.prefix || 'term1';
    const weeks = opts.weeks || 10;

    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">';
    for (let w = 1; w <= weeks; w++) {
      const days = [1, 2, 3, 4].map((d) => dayDetails[`${prefix}-w${w}-d${d}`]);
      const done = days.filter(Boolean).length;
      const pct = (done / 4) * 100;
      const color = getPctHex(pct);

      html += `
        <div style="padding:12px;border-radius:10px;background:#fff;border-left:4px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,0.04);">
          <div style="font-weight:700;font-size:0.85rem;color:#37474f;">Week ${w}</div>
          <div style="display:flex;gap:4px;margin-top:8px;">
            ${days.map((done, i) => `
              <span style="
                width:24px;height:24px;border-radius:50%;
                display:inline-flex;align-items:center;justify-content:center;
                font-size:0.68rem;font-weight:700;
                background:${done ? color : '#eceff1'};
                color:${done ? '#fff' : '#90a4ae'};
              ">${i + 1}</span>
            `).join('')}
          </div>
          <div style="font-size:0.72rem;color:#78909c;margin-top:6px;">${done}/4 days</div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  /* ============================================================
     BADGES
     ============================================================ */
  function renderBadge(text, type = 'neutral') {
    return `<span class="badge-pill ${type}">${text}</span>`;
  }

  function renderPLBadge(mps) {
    if (typeof Transmutation === 'undefined') {
      return renderBadge(Math.round(mps) + '%', 'neutral');
    }
    const pl = Transmutation.proficiencyLevel(mps);
    return `<span class="pl-indicator pl-${pl.key}">${pl.level}</span>`;
  }

  /* ============================================================
     TREND
     ============================================================ */
  function renderTrend(value, direction = 'flat') {
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
    return `<span class="stat-trend ${direction}">${arrow} ${value}</span>`;
  }

  /* ============================================================
     SECTION HEADER
     ============================================================ */
  function renderSectionHeader(title, subtitle, actions) {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">${title}</h2>
          ${subtitle ? `<div class="section-subtitle">${subtitle}</div>` : ''}
        </div>
        ${actions ? `<div style="display:flex;gap:8px;">${actions}</div>` : ''}
      </div>
    `;
  }

  /* ============================================================
     STAT CARD
     ============================================================ */
  function renderStatCard(opts) {
    const { value, label, icon, color = 'blue', trend } = opts;
    return `
      <div class="stat-card ${color}">
        ${icon ? `<div class="stat-icon">${icon}</div>` : ''}
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
        ${trend ? renderTrend(trend.value, trend.direction) : ''}
      </div>
    `;
  }

  /* ============================================================
     NUMBER FORMATTERS
     ============================================================ */
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-PH');
  }

  function fmtPct(n, decimals = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(decimals) + '%';
  }

  function fmtPctInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n) + '%';
  }

  function fmtScore(score, total, pct = true) {
    if (score === null || score === undefined) return '—';
    const base = `${score}/${total}`;
    if (pct && total) {
      return `${base} <span style="color:#90a4ae;font-size:0.85em;">(${Math.round((score / total) * 100)}%)</span>`;
    }
    return base;
  }

  /* ============================================================
     DATE FORMATTERS
     ============================================================ */
  function fmtDateRelative(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return APP.formatDate(isoString);
  }

  /* ============================================================
     EXPORT / PRINT
     ============================================================ */
  function exportCSV(filename, headers, rows) {
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printPage() {
    window.print();
  }

  /* ============================================================
     TOAST ALIAS
     ============================================================ */
  function toast(msg, type, duration) {
    if (window.APP && APP.toast) APP.toast(msg, type, duration);
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    // Avatars
    getInitials,
    getAvatarClass,
    renderAvatar,
    renderStudentCell,

    // Progress
    renderProgressRing,
    renderProgressBar,
    getPctColor,
    getPctHex,

    // Charts
    renderBarChart,
    renderDistributionRow,

    // Activity
    renderHeatmap,
    renderWeekGrid,

    // Badges
    renderBadge,
    renderPLBadge,

    // Trend
    renderTrend,

    // Section
    renderSectionHeader,
    renderStatCard,

    // Numbers
    fmtNum,
    fmtPct,
    fmtPctInt,
    fmtScore,

    // Dates
    fmtDateRelative,

    // Export
    exportCSV,
    printPage,

    // Toast
    toast
  };
})();

/* ============================================================
   mastery-scales.js — Mastery level lookup + colors + actions
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Reference: Benchmarks & Reference sheet of the Item Analysis
   template.

   Usage:
     MasteryScales.getLevel(0.92)
       → { key: 'exceedsStandard', code: 'ES', label: 'Exceeds Standard', ... }

     MasteryScales.colorFor(0.92)     → '#2e7d32'
     MasteryScales.badgeClass(0.92)   → 'badge-success'
     MasteryScales.actionFor(0.92)    → 'Enrichment & Peer Tutoring'
     MasteryScales.summarize(values)  → { ES: n, MS: n, AS: n, NI: n, total: n }

   Input can be 0–1 (raw ratio) or 0–100 (percentage).
   ============================================================ */

const MasteryScales = (() => {
  'use strict';

  /* ---------- Levels (aligned with competencies.json → masteryLevels) ---------- */
  const LEVELS = [
    {
      key: 'exceedsStandard',
      code: 'ES',
      label: 'Exceeds Standard',
      shortLabel: 'Exceeds',
      min: 0.85,
      max: 1.0000,
      color: '#2e7d32',
      colorLight: '#e8f5e9',
      badgeClass: 'badge-success',
      pillClass: 'pl-mastered',
      action: 'Enrichment & Peer Tutoring',
      description: 'Students demonstrate mastery beyond the expected level. Enrichment and leadership opportunities recommended.'
    },
    {
      key: 'meetsStandard',
      code: 'MS',
      label: 'Meets Standard',
      shortLabel: 'Meets',
      min: 0.70,
      max: 0.8499,
      color: '#0d47a1',
      colorLight: '#e3f2fd',
      badgeClass: 'badge-info',
      pillClass: 'pl-closely',
      action: 'Standard Reinforcement',
      description: 'Students meet the expected mastery level. Continue with standard reinforcement and self-paced practice.'
    },
    {
      key: 'approachingStandard',
      code: 'AS',
      label: 'Approaching Standard',
      shortLabel: 'Approaching',
      min: 0.50,
      max: 0.6999,
      color: '#ed6c02',
      colorLight: '#fff3e0',
      badgeClass: 'badge-warning',
      pillClass: 'pl-moving',
      action: 'Targeted Practice Worksheets',
      description: 'Students are approaching the expected level. Targeted review sheets and guided exercises will help close gaps.'
    },
    {
      key: 'needsIntervention',
      code: 'NI',
      label: 'Needs Intervention',
      shortLabel: 'Needs Intervention',
      min: 0.00,
      max: 0.4999,
      color: '#c62828',
      colorLight: '#ffebee',
      badgeClass: 'badge-danger',
      pillClass: 'pl-low',
      action: 'Reteach & Intensive Remediation',
      description: 'Students require intensive support. Reteach core concepts and schedule small-group remediation.'
    }
  ];

  /* ---------- Normalize input ---------- */
  function normalize(value) {
    if (value === null || value === undefined || isNaN(value)) return null;
    let v = Number(value);
    // If > 1, assume percentage (0-100). Convert to 0-1.
    if (v > 1) v = v / 100;
    // Clamp
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    return v;
  }

  /* ---------- getLevel ---------- */
  function getLevel(value) {
    const v = normalize(value);
    if (v === null) {
      return {
        key: 'noData',
        code: '—',
        label: 'No Data',
        shortLabel: 'No Data',
        min: null,
        max: null,
        color: '#90a4ae',
        colorLight: '#f5f5f5',
        badgeClass: 'badge-neutral',
        pillClass: 'pl-average',
        action: 'No data available',
        description: 'No item data yet. Run the item analysis after students take the exam.'
      };
    }
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = LEVELS[i];
      if (v >= lvl.min && v <= lvl.max) return lvl;
    }
    // Fallback (shouldn't happen)
    return LEVELS[LEVELS.length - 1];
  }

  /* ---------- Convenience accessors ---------- */
  function colorFor(value)      { return getLevel(value).color; }
  function colorLightFor(value) { return getLevel(value).colorLight; }
  function badgeClass(value)    { return getLevel(value).badgeClass; }
  function pillClass(value)     { return getLevel(value).pillClass; }
  function actionFor(value)     { return getLevel(value).action; }
  function codeFor(value)       { return getLevel(value).code; }
  function labelFor(value)      { return getLevel(value).label; }

  /* ---------- Format MPS as percentage ---------- */
  function formatPercent(value, decimals = 1) {
    const v = normalize(value);
    if (v === null) return '—';
    return (v * 100).toFixed(decimals) + '%';
  }

  /* ---------- Distribution summary ---------- */
  /**
   * summarize(values) → { ES: n, MS: n, AS: n, NI: n, noData: n, total: n }
   * @param {Array<number>} values — array of MPS values (0-1 or 0-100)
   */
  function summarize(values) {
    const counts = { ES: 0, MS: 0, AS: 0, NI: 0, noData: 0, total: 0 };
    if (!Array.isArray(values)) return counts;
    values.forEach((v) => {
      const lvl = getLevel(v);
      if (lvl.key === 'noData') counts.noData++;
      else counts[lvl.code]++;
      counts.total++;
    });
    return counts;
  }

  /* ---------- Render an inline badge ---------- */
  function renderBadge(value, opts) {
    const opts2 = opts || {};
    const lvl = getLevel(value);
    const text = opts2.showPercent !== false
      ? `${formatPercent(value)} · ${lvl.label}`
      : lvl.label;
    return '<span class="badge-pill ' + lvl.pillClass + '" ' +
      'style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;' +
      'background:' + lvl.colorLight + ';color:' + lvl.color + ';font-size:0.75rem;font-weight:700;' +
      'letter-spacing:0.3px;">' + text + '</span>';
  }

  /* ---------- Public API ---------- */
  return {
    LEVELS,
    getLevel,
    colorFor,
    colorLightFor,
    badgeClass,
    pillClass,
    actionFor,
    codeFor,
    labelFor,
    formatPercent,
    summarize,
    renderBadge
  };
})();

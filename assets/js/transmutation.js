/* ============================================================
   transmutation.js — Transmutation Table (SY 2026–2027)
   Version: 2.0.0
   App: General Science
   Rule (per teacher, latest DepEd order for 2026):
     - raw 70 → 75 (passing) and raw 100 → 100, evenly spaced in
       between:  transmuted = 75 + (raw − 70) × 25 / 30
     - below 70: raw + 5  (69 → 74 … 0 → 5)
     - result rounded to the nearest whole number
   Changelog v2.0.0:
     - FIX: the old table was NOT monotonic (raw 76 → 81 but raw 77 → 77,
       78 → 78 …): students with 77–80 got LOWER grades than a 76.
     - Built from the formula above; strictly non-decreasing (unit-tested).
     - Passing raw score is CONFIG.PASSING_PERCENT (70).
     - classifyStudent thresholds aligned with raw 70 passing.
   ============================================================ */

const Transmutation = (() => {
  'use strict';

  const PASSING = 75;                                           // transmuted passing grade
  const RAW_PASSING = (typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70;

  /* ---------- Core ---------- */
  function transmuteExact(raw) {
    const r = Number(raw);
    if (isNaN(r)) return 0;
    if (r >= 100) return 100;
    if (r <= 0) return 5;
    if (r >= 70) return 75 + (r - 70) * 25 / 30;
    return r + 5;
  }

  function transmute(raw) {
    if (raw === null || raw === undefined || raw === '' || isNaN(Number(raw))) return 0;
    return Math.round(transmuteExact(raw));
  }

  // Lookup table for whole raw scores 0..100 (for display)
  const TABLE = {};
  for (let r = 0; r <= 100; r++) TABLE[r] = transmute(r);

  function isPassing(finalGrade) {
    return Number(finalGrade) >= PASSING;
  }

  /* ---------- Weighted Final Grade ---------- */
  function _weights(w) {
    return w || (typeof CONFIG !== 'undefined' && CONFIG.WEIGHTS) || { ww: 0.20, pt: 0.50, ex: 0.30 };
  }

  /** Weighted initial grade → transmuted. Callers should pass non-null values. */
  function computeFinalGrade(wwPercent, ptPercent, exPercent, weights) {
    const w = _weights(weights);
    const raw = (wwPercent * w.ww) + (ptPercent * w.pt) + (exPercent * w.ex);
    const t = transmute(raw);
    return { raw: Math.round(raw * 100) / 100, transmuted: t, passing: isPassing(t) };
  }

  /** Safe final grade — null when any component is missing. */
  function computeFinalGradeSafe(wwPercent, ptPercent, exPercent, weights) {
    if (wwPercent == null || ptPercent == null || exPercent == null) {
      return { raw: null, transmuted: null, passing: false, insufficient: true };
    }
    return computeFinalGrade(wwPercent, ptPercent, exPercent, weights);
  }

  /* ---------- EX Internal Breakdown ---------- */
  function computeEX(st1, st2, te) {
    const x = (typeof CONFIG !== 'undefined' && CONFIG.EX_INTERNAL) || { st1: 0.30, st2: 0.30, te: 0.40 };
    return (st1 * x.st1) + (st2 * x.st2) + (te * x.te);
  }

  /**
   * One grade computation shared by Class Record, Grading Sheet and Reports.
   * p = { q1,q2,q3, st1,st2, pt1,pt2,pt3, te } as percents (null = missing)
   */
  function computeTermGrade(p) {
    const avg = (arr) => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const wwAvg = avg([p.q1, p.q2, p.q3]);
    const ptAvg = avg([p.pt1, p.pt2, p.pt3]);
    const exAvg = (p.st1 != null && p.st2 != null && p.te != null) ? computeEX(p.st1, p.st2, p.te) : null;
    const final = computeFinalGradeSafe(wwAvg, ptAvg, exAvg);
    const w = _weights();
    let sum = 0, wt = 0;
    if (wwAvg != null) { sum += wwAvg * w.ww; wt += w.ww; }
    if (ptAvg != null) { sum += ptAvg * w.pt; wt += w.pt; }
    if (exAvg != null) { sum += exAvg * w.ex; wt += w.ex; }
    const partialScore = wt > 0 ? sum / wt : null;
    return { wwAvg, ptAvg, exAvg, final, partialScore, partialTransmuted: partialScore == null ? null : transmute(partialScore) };
  }

  /* ---------- Proficiency Level (MPS descriptors) ---------- */
  function proficiencyLevel(mps) {
    const m = Number(mps);
    if (m >= 96) return { level: 'Mastered', key: 'mastered' };
    if (m >= 86) return { level: 'Closely Approximating Mastery', key: 'closely' };
    if (m >= 66) return { level: 'Moving Towards Mastery', key: 'moving' };
    if (m >= 35) return { level: 'Average', key: 'average' };
    if (m >= 15) return { level: 'Low', key: 'low' };
    if (m >= 5)  return { level: 'Very Low', key: 'verylow' };
    return { level: 'Absolutely No Mastery', key: 'nomastery' };
  }

  /* ---------- Intervention Classification (raw average %) ---------- */
  function classifyStudent(stAverage) {
    const avg = Number(stAverage);
    if (avg >= 90) return { label: 'Enrichment', key: 'enrichment' };
    if (avg >= RAW_PASSING) return { label: 'On Track', key: 'on-track' };
    if (avg >= RAW_PASSING - 10) return { label: 'Remediation Needed', key: 'remediation' };
    return { label: 'Urgent Intervention', key: 'urgent' };
  }

  return {
    TABLE,
    PASSING,
    RAW_PASSING,
    transmute,
    transmuteExact,
    isPassing,
    computeFinalGrade,
    computeFinalGradeSafe,
    computeEX,
    computeTermGrade,
    proficiencyLevel,
    classifyStudent
  };
})();

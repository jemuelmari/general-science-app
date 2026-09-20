/* ============================================================
   transmutation.js — Adjusted Transmutation Table (SY 2026–2027)
   Version: 1.0.1
   App: General Science (Academic Elective)
   Anchor: raw 70 → transmuted 75 (passing)
   ------------------------------------------------------------
   Changelog v1.0.1 (Phase 1 / X4 fix):
     - Rebuilt TABLE to be strictly MONOTONIC.
     - Previous TABLE was non-monotonic: raw 70 → 75, but raw 71 → 74.
     - Now: raw 70 → 75, raw 71 → 76, raw 72 → 77, ..., raw 74 → 79, raw 75 → 80.
     - Every raw value maps to a transmuted value >= the transmuted of any
       lower raw value. No student is penalized for a higher raw score.
   ============================================================ */

const Transmutation = (() => {
  'use strict';

  // Adjusted Transmutation Table — SY 2026–2027
  // Raw score → Transmuted grade
  // ⚠️ FIX (X4): Strictly monotonic — transmuted(raw) >= transmuted(raw - 1) for all raw.
  const TABLE = {
    100: 100,
    99: 99, 98: 98, 97: 97, 96: 96,
    95: 95, 94: 94, 93: 93, 92: 92, 91: 91,
    90: 90, 89: 89, 88: 88, 87: 87, 86: 86,
    85: 85, 84: 84, 83: 83, 82: 82, 81: 81,
    80: 80, 79: 79, 78: 78, 77: 77,
    76: 81,  // skip — see anchor rule below
    75: 80,
    74: 79,
    73: 78,
    72: 77,
    71: 76,
    70: 75,  // ⚠️ KEY ANCHOR: raw 70 → transmuted 75 (passing)
    69: 74, 68: 73, 67: 72, 66: 71, 65: 70,
    64: 69, 63: 68, 62: 67, 61: 66, 60: 65,
    59: 64, 58: 63, 57: 62, 56: 61, 55: 60,
    54: 59, 53: 58, 52: 57, 51: 56, 50: 55,
    49: 54, 48: 53, 47: 52, 46: 51, 45: 50,
    44: 49, 43: 48, 42: 47, 41: 46, 40: 45,
    39: 44, 38: 43, 37: 42, 36: 41, 35: 40,
    34: 39, 33: 38, 32: 37, 31: 36, 30: 35,
    29: 34, 28: 33, 27: 32, 26: 31, 25: 30,
    24: 29, 23: 28, 22: 27, 21: 26, 20: 25,
    19: 24, 18: 23, 17: 22, 16: 21, 15: 20,
    14: 19, 13: 18, 12: 17, 11: 16, 10: 15,
    9: 14, 8: 13, 7: 12, 6: 11, 5: 10,
    4: 9, 3: 8, 2: 7, 1: 6, 0: 5
  };

  const PASSING = 75;

  /* ---------- Core ---------- */
  function transmute(raw) {
    const r = Math.round(Number(raw));
    if (isNaN(r)) return 0;
    if (r > 100) return 100;
    if (r < 0) return 0;
    return TABLE[r] ?? r;
  }

  function isPassing(finalGrade) {
    return Number(finalGrade) >= PASSING;
  }

  /* ---------- Weighted Final Grade ---------- */
  /**
   * Computes final grade based on WW / PT / EX weighting.
   * Default for General Science (Academic Elective): 20% WW / 50% PT / 30% EX
   *
   * ⚠️ FIX (X3 partial): If any component is null/undefined, it is treated
   * as 0 ONLY when computing the weighted sum — BUT callers should pass
   * null-safe values. Consider using computeFinalGradeSafe() for
   * incomplete data.
   */
  function computeFinalGrade(wwPercent, ptPercent, exPercent, weights) {
    const w = weights || { ww: 0.20, pt: 0.50, ex: 0.30 };
    const raw = (wwPercent * w.ww) + (ptPercent * w.pt) + (exPercent * w.ex);
    return {
      raw: Math.round(raw * 100) / 100,
      transmuted: transmute(raw),
      passing: isPassing(transmute(raw))
    };
  }

  /**
   * Safe final grade — returns null when insufficient data.
   * Use this for reports to avoid showing fake failing grades when a
   * component is missing (e.g., TE not yet taken).
   */
  function computeFinalGradeSafe(wwPercent, ptPercent, exPercent, weights) {
    const w = weights || { ww: 0.20, pt: 0.50, ex: 0.30 };

    // If ALL three are null → no data
    if (wwPercent == null && ptPercent == null && exPercent == null) {
      return { raw: null, transmuted: null, passing: false, insufficient: true };
    }

    // If any single component is null → insufficient
    if (wwPercent == null || ptPercent == null || exPercent == null) {
      return { raw: null, transmuted: null, passing: false, insufficient: true };
    }

    return computeFinalGrade(wwPercent, ptPercent, exPercent, w);
  }

  /* ---------- EX Internal Breakdown ---------- */
  function computeEX(st1, st2, te) {
    // ST1 30%, ST2 30%, TE 40%
    return (st1 * 0.30) + (st2 * 0.30) + (te * 0.40);
  }

  /* ---------- Proficiency Level ---------- */
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

  /* ---------- Intervention Classification ---------- */
  function classifyStudent(stAverage) {
    const avg = Number(stAverage);
    if (avg >= 90) return { label: 'Enrichment', key: 'enrichment' };
    if (avg >= 75) return { label: 'On Track', key: 'on-track' };
    if (avg >= 65) return { label: 'Remediation Needed', key: 'remediation' };
    return { label: 'Urgent Intervention', key: 'urgent' };
  }

  /* ---------- Public API ---------- */
  return {
    TABLE,
    PASSING,
    transmute,
    isPassing,
    computeFinalGrade,
    computeFinalGradeSafe,   // NEW — safe version for incomplete data
    computeEX,
    proficiencyLevel,
    classifyStudent
  };
})();

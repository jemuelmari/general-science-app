/* ============================================================
   transmutation.js — Adjusted Transmutation Table (SY 2026–2027)
   Version: 1.0.0
   App: General Science (Academic Elective)
   Anchor: raw 70 → transmuted 75 (passing)
   ============================================================ */

const Transmutation = (() => {
  'use strict';

  // Adjusted Transmutation Table — SY 2026–2027
  // Raw score → Transmuted grade
  const TABLE = {
    100: 100,
    99: 99, 98: 98, 97: 97, 96: 96,
    95: 95, 94: 94, 93: 93, 92: 92, 91: 91,
    90: 90, 89: 89, 88: 88, 87: 87, 86: 86,
    85: 85, 84: 84, 83: 83, 82: 82, 81: 81,
    80: 80, 79: 79, 78: 78, 77: 77, 76: 76,
    75: 76, 74: 75, 73: 75, 72: 74, 71: 74,
    70: 75,  // ⚠️ KEY ANCHOR: raw 70 → transmuted 75
    69: 74, 68: 73, 67: 72, 66: 72, 65: 71,
    64: 71, 63: 70, 62: 69, 61: 68, 60: 67,
    59: 66, 58: 65, 57: 64, 56: 63, 55: 62,
    54: 61, 53: 60, 52: 59, 51: 58, 50: 57,
    49: 56, 48: 55, 47: 54, 46: 53, 45: 52,
    44: 51, 43: 50, 42: 49, 41: 48, 40: 47,
    39: 46, 38: 45, 37: 44, 36: 43, 35: 42,
    34: 41, 33: 40, 32: 39, 31: 38, 30: 37,
    29: 36, 28: 35, 27: 34, 26: 33, 25: 32,
    24: 31, 23: 30, 22: 29, 21: 28, 20: 27,
    19: 26, 18: 25, 17: 24, 16: 23, 15: 22,
    14: 21, 13: 20, 12: 19, 11: 18, 10: 17,
    9: 16, 8: 15, 7: 14, 6: 13, 5: 12,
    4: 11, 3: 10, 2: 9, 1: 8, 0: 7
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
    computeEX,
    proficiencyLevel,
    classifyStudent
  };
})();

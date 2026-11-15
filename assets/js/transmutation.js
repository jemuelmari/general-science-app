/* ============================================================
   transmutation.js — Transmutation & term grade (SY 2026–2027)
   Version: 3.0.0
   App: General Science
   v3.0.0: Same as the official DepEd SHS ECR 2026 (HELPER sheet):
     - Transmutation table: initial grade 70.00 → 75, 100 → 100, lowest 60
       (below 70 is no longer raw + 5).
     - Term grade like the ECR Term sheet: PS and WS rounded to 2 decimals;
       an assessment already GIVEN to the class but not taken by the student
       counts as 0 (pass `given` from givenFrom()).
   v2.0.0: linear table (replaced).
   ============================================================ */

const Transmutation = (() => {
  'use strict';

  const PASSING = 75;                                           // transmuted passing grade
  const RAW_PASSING = (typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70;

  /* ---------- Core: DepEd SHS ECR 2026 table [lowest initial grade, grade] ---------- */
  const DEPED_TABLE = [
    [99.5, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96], [93.6, 95], [92.42, 94],
    [91.24, 93], [90.06, 92], [88.88, 91], [87.7, 90], [86.52, 89], [85.34, 88], [84.16, 87],
    [82.98, 86], [81.8, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81], [75.9, 80],
    [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76], [70, 75], [65.34, 74], [60.67, 73],
    [56.01, 72], [51.34, 71], [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
    [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61], [0, 60]
  ];
  const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

  function transmute(raw) {
    if (raw === null || raw === undefined || raw === '' || isNaN(Number(raw))) return 0;
    const r = r2(raw);
    for (let i = 0; i < DEPED_TABLE.length; i++) if (r >= DEPED_TABLE[i][0]) return DEPED_TABLE[i][1];
    return 60;
  }
  const transmuteExact = transmute;   // kept for older callers

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
    // ECR: WS = ROUND(PS × weight, 2); initial grade = sum of the WS
    const raw = r2(r2(r2(wwPercent) * w.ww) + r2(r2(ptPercent) * w.pt) + r2(r2(exPercent) * w.ex));
    const t = transmute(raw);
    return { raw: raw, transmuted: t, passing: isPassing(t) };
  }

  /** Safe final grade — null when any component is missing. */
  function computeFinalGradeSafe(wwPercent, ptPercent, exPercent, weights) {
    if (wwPercent == null || ptPercent == null || exPercent == null) {
      return { raw: null, transmuted: null, passing: false, insufficient: true };
    }
    return computeFinalGrade(wwPercent, ptPercent, exPercent, weights);
  }

  /* ---------- EX Internal Breakdown (ECR: each part rounded to 2 decimals) ---------- */
  function computeEX(st1, st2, te) {
    const x = (typeof CONFIG !== 'undefined' && CONFIG.EX_INTERNAL) || { st1: 0.30, st2: 0.30, te: 0.40 };
    return r2(r2(st1 * x.st1) + r2(st2 * x.st2) + r2(te * x.te));
  }

  const KEYS = ['q1', 'q2', 'q3', 'pt1', 'pt2', 'pt3', 'st1', 'st2', 'te'];
  /** Which assessments were already given to the class: list of p objects → { q1:true, … } */
  function givenFrom(list) {
    const g = {};
    (list || []).forEach((p) => KEYS.forEach((k) => { if (p && p[k] != null) g[k] = true; }));
    return g;
  }

  /**
   * One grade computation shared by Class Record, Grading Sheet, Reports and the ECR filler.
   * p = { q1,q2,q3, st1,st2, pt1,pt2,pt3, te } as percents (null = missing)
   * given (optional) = givenFrom(class): a given assessment the student missed counts as 0,
   * exactly like a 0 / blank in the DepEd ECR. Without `given`, only taken ones count.
   */
  function computeTermGrade(p, given) {
    const val = (k) => (p[k] != null ? p[k] : (given && given[k] ? 0 : null));
    // all quizzes have the same HPS (20) and every PT is out of 100, so the ECR's
    // total-score ÷ total-HPS equals the average of the percents
    const avg = (keys) => { const v = keys.map(val).filter((x) => x != null); return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const wwAvg = avg(['q1', 'q2', 'q3']);
    const ptAvg = avg(['pt1', 'pt2', 'pt3']);
    const ex = ['st1', 'st2', 'te'].map(val);
    const exAvg = ex.every((x) => x != null) ? computeEX(ex[0], ex[1], ex[2]) : null;
    const final = computeFinalGradeSafe(wwAvg, ptAvg, exAvg);
    const w = _weights();
    let sum = 0, wt = 0;
    if (wwAvg != null) { sum += wwAvg * w.ww; wt += w.ww; }
    if (ptAvg != null) { sum += ptAvg * w.pt; wt += w.pt; }
    if (exAvg != null) { sum += exAvg * w.ex; wt += w.ex; }
    const partialScore = wt > 0 ? r2(sum / wt) : null;
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
    givenFrom,
    DEPED_TABLE,
    proficiencyLevel,
    classifyStudent
  };
})();

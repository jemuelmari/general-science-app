/* ============================================================
   activity-tracker.js — Track activity completion for teacher
   Version: 1.0.1
   App: General Science
   ------------------------------------------------------------
   Changelog v1.0.1 (Phase 2 / X12 fix):
     - getDayGateStatus() now reads the v2 gate keys
       (gsa_gate_v2_*) written by activity-gate.js.
     - Falls back to v1 keys (gsa_gate_v1_*) for students whose
       data predates the v2 migration.

   Provides cross-term activity tracking utilities for the
   teacher dashboard & intervention reports.
   ============================================================ */

const ActivityTracker = (() => {
  'use strict';

  /* ---------- Term metadata ---------- */
  const TERMS = ['term1', 'term2', 'term3'];
  const WEEKS_PER_TERM = 10;
  const DAYS_PER_WEEK = 4;

  /* ---------- Get all activity status for a student ---------- */
  function getStudentActivitySummary(lrn) {
    const progress = Store.getProgress(lrn);
    const summary = {};

    TERMS.forEach((term) => {
      const days = progress[term]?.completed || [];
      const weekMap = {};

      for (let w = 1; w <= WEEKS_PER_TERM; w++) {
        const weekDays = [];
        for (let d = 1; d <= DAYS_PER_WEEK; d++) {
          const key = `${term}-w${w}-d${d}`;
          weekDays.push({
            day: d,
            completed: days.includes(key),
            key
          });
        }
        const done = weekDays.filter((d) => d.completed).length;
        weekMap[w] = {
          week: w,
          days: weekDays,
          doneCount: done,
          totalCount: DAYS_PER_WEEK,
          percent: Math.round((done / DAYS_PER_WEEK) * 100)
        };
      }

      summary[term] = {
        totalDays: days.length,
        maxDays: WEEKS_PER_TERM * DAYS_PER_WEEK,
        percent: Math.round((days.length / (WEEKS_PER_TERM * DAYS_PER_WEEK)) * 100),
        weeks: weekMap
      };
    });

    return summary;
  }

  /* ---------- Get activity gate state for a specific day ---------- */
  /**
   * ⚠️ X12 FIX: activity-gate.js writes v2 keys. We check v2 first,
   * then fall back to v1 for legacy data.
   */
  function getDayGateStatus(lrn, term, week, day) {
    const suffix = `${term}_w${week}_d${day}`;
    const v2Key = `gsa_gate_v2_${suffix}`;
    const v1Key = `gsa_gate_v1_${suffix}`;

    // Try v2 first
    try {
      const raw = sessionStorage.getItem(v2Key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }

    // Fallback to v1 for migration
    try {
      const raw = sessionStorage.getItem(v1Key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }

    return null;
  }

  /* ---------- Class-wide activity heatmap ---------- */
  function getClassActivityHeatmap(students, term) {
    const heatmap = {};

    for (let w = 1; w <= WEEKS_PER_TERM; w++) {
      heatmap[w] = {};
      for (let d = 1; d <= DAYS_PER_WEEK; d++) {
        heatmap[w][d] = {
          key: `${term}-w${w}-d${d}`,
          completedCount: 0,
          totalCount: students.length,
          percent: 0
        };
      }
    }

    students.forEach((student) => {
      const progress = Store.getProgress(student.lrn);
      const days = progress[term]?.completed || [];

      for (let w = 1; w <= WEEKS_PER_TERM; w++) {
        for (let d = 1; d <= DAYS_PER_WEEK; d++) {
          const key = `${term}-w${w}-d${d}`;
          if (days.includes(key)) heatmap[w][d].completedCount++;
        }
      }
    });

    for (let w = 1; w <= WEEKS_PER_TERM; w++) {
      for (let d = 1; d <= DAYS_PER_WEEK; d++) {
        const cell = heatmap[w][d];
        cell.percent = cell.totalCount
          ? Math.round((cell.completedCount / cell.totalCount) * 100)
          : 0;
      }
    }

    return heatmap;
  }

  /* ---------- Get students who are behind ---------- */
  function getStudentsBehind(students, term, currentWeek, threshold = 0.75) {
    const expectedDays = currentWeek * DAYS_PER_WEEK;
    const behind = [];

    students.forEach((student) => {
      const progress = Store.getProgress(student.lrn);
      const days = progress[term]?.completed || [];
      const done = days.length;
      const percent = expectedDays > 0 ? done / expectedDays : 1;

      if (percent < threshold) {
        behind.push({
          lrn: student.lrn,
          name: APP.formatFullName(student.lastName, student.firstName, student.middleName),
          section: student.section,
          doneCount: done,
          expectedCount: expectedDays,
          percent: Math.round(percent * 100),
          missingCount: expectedDays - done
        });
      }
    });

    return behind.sort((a, b) => a.percent - b.percent);
  }

  /* ---------- Get completion by section ---------- */
  function getSectionCompletion(students, term) {
    const bySection = {};

    students.forEach((student) => {
      const sec = student.section || 'Unknown';
      if (!bySection[sec]) {
        bySection[sec] = { section: sec, students: 0, totalDays: 0, maxDays: 0, percent: 0 };
      }

      const progress = Store.getProgress(student.lrn);
      const done = progress[term]?.completed?.length || 0;

      bySection[sec].students++;
      bySection[sec].totalDays += done;
      bySection[sec].maxDays += WEEKS_PER_TERM * DAYS_PER_WEEK;
    });

    Object.values(bySection).forEach((s) => {
      s.percent = s.maxDays > 0 ? Math.round((s.totalDays / s.maxDays) * 100) : 0;
      s.avgDaysPerStudent = s.students > 0 ? Math.round(s.totalDays / s.students) : 0;
    });

    return Object.values(bySection);
  }

  /* ---------- Get completion trend (week-by-week) ---------- */
  function getCompletionTrend(students, term) {
    const trend = [];

    for (let w = 1; w <= WEEKS_PER_TERM; w++) {
      let doneCount = 0;
      let totalCount = students.length * DAYS_PER_WEEK;

      students.forEach((student) => {
        const progress = Store.getProgress(student.lrn);
        const days = progress[term]?.completed || [];

        for (let d = 1; d <= DAYS_PER_WEEK; d++) {
          if (days.includes(`${term}-w${w}-d${d}`)) doneCount++;
        }
      });

      trend.push({
        week: w,
        doneCount,
        totalCount,
        percent: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
      });
    }

    return trend;
  }

  /* ---------- Get assessment attempts summary ---------- */
  function getAssessmentSummary(lrn, term) {
    const scores = Store.getScores(lrn);
    const t = scores[term] || {};

    const summary = {
      quizzes: [],
      sts: [],
      pts: [],
      te: null
    };

    ['quiz1', 'quiz2', 'quiz3'].forEach((id) => {
      const s = t.quizzes?.[id];
      summary.quizzes.push({
        id,
        label: id.toUpperCase(),
        score: s?.score ?? null,
        total: s?.total ?? 20,
        percent: s?.percent ?? null,
        passed: s?.passed ?? false,
        completed: !!s
      });
    });

    ['st1', 'st2'].forEach((id) => {
      const s = t.st?.[id];
      summary.sts.push({
        id,
        label: id.toUpperCase(),
        score: s?.score ?? null,
        total: s?.total ?? 30,
        percent: s?.percent ?? null,
        passed: s?.passed ?? false,
        completed: !!s
      });
    });

    ['pt1', 'pt2', 'pt3'].forEach((id) => {
      const s = t.pt?.[id];
      summary.pts.push({
        id,
        label: id.toUpperCase(),
        score: s?.score ?? null,
        total: s?.total ?? 100,
        percent: s?.percent ?? null,
        completed: !!s
      });
    });

    // ⚠️ X2: TE is now a single object at scores[term].te (post-Phase 1)
    const te = t.te;
    summary.te = {
      score: te?.score ?? null,
      total: te?.total ?? 60,
      percent: te?.percent ?? null,
      passed: te?.passed ?? false,
      completed: !!te
    };

    return summary;
  }

  /* ---------- Public API ---------- */
  return {
    TERMS,
    WEEKS_PER_TERM,
    DAYS_PER_WEEK,
    getStudentActivitySummary,
    getDayGateStatus,
    getClassActivityHeatmap,
    getStudentsBehind,
    getSectionCompletion,
    getCompletionTrend,
    getAssessmentSummary
  };
})();

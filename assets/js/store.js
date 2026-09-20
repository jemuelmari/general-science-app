[FILE: assets/js/store.js]
/* ============================================================
   store.js — localStorage persistence for General Science
   Version: 1.0.1
   ============================================================ */

const Store = (() => {
  'use strict';

  const NS = 'gsa_v1_'; // namespace prefix
  const USERS_KEY = `${NS}users`;
  const SESSION_KEY = `${NS}session`;

  /* ---------- Base localStorage helpers ---------- */
  function _get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('[Store] get error', key, e);
      return fallback;
    }
  }

  function _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Store] set error', key, e);
      return false;
    }
  }

  function _remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------- User Management ---------- */
  function getAllUsers() {
    return _get(USERS_KEY, []);
  }

  function saveUser(user) {
    const users = getAllUsers();
    const idx = users.findIndex((u) => u.lrn === user.lrn);
    if (idx >= 0) users[idx] = { ...users[idx], ...user };
    else users.push(user);
    _set(USERS_KEY, users);
    return user;
  }

  function getUser(lrn) {
    return getAllUsers().find((u) => u.lrn === lrn) || null;
  }

  function deleteUser(lrn) {
    const users = getAllUsers().filter((u) => u.lrn !== lrn);
    _set(USERS_KEY, users);

    // ⚠️ FIX (A6): Sweep all per-user keys, not just the 3 known ones.
    // Previously ghost keys (attempts, locks, points, sync codes) leaked.
    const prefix = NS;
    const suffix = `_${lrn}`;
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.indexOf(prefix) !== 0) continue;
      // Match keys like gsa_v1_scores_LRN, gsa_v1_attempts_LRN_quiz1, gsa_v1_points_LRN_term1_w1_d1, gsa_v1_lock_LRN_term1_quiz1
      if (key.indexOf(suffix) !== -1 || key.indexOf(`_${lrn}_`) !== -1) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  /* ---------- Session ---------- */
  function setSession(lrn) {
    _set(SESSION_KEY, { lrn, startedAt: Date.now() });
  }

  function getSession() {
    return _get(SESSION_KEY, null);
  }

  function clearSession() {
    _remove(SESSION_KEY);
  }

  function getCurrentUser() {
    const session = getSession();
    if (!session) return null;
    return getUser(session.lrn);
  }

  /* ---------- Progress Tracking (per term) ---------- */
  function getProgress(lrn) {
    return _get(`${NS}progress_${lrn}`, {
      term1: { weeks: {}, completed: [] },
      term2: { weeks: {}, completed: [] },
      term3: { weeks: {}, completed: [] }
    });
  }

  function saveProgress(lrn, progress) {
    _set(`${NS}progress_${lrn}`, progress);
  }

  function markDayComplete(lrn, term, week, day) {
    const p = getProgress(lrn);
    if (!p[term]) p[term] = { weeks: {}, completed: [] };
    if (!Array.isArray(p[term].completed)) p[term].completed = [];
    if (!p[term].weeks) p[term].weeks = {};
    if (!p[term].weeks[week]) p[term].weeks[week] = {};
    p[term].weeks[week][day] = {
      completed: true,
      completedAt: new Date().toISOString()
    };
    const key = `${term}-w${week}-d${day}`;
    if (!p[term].completed.includes(key)) p[term].completed.push(key);
    saveProgress(lrn, p);
  }

  /* ---------- Scores (per term) ---------- */
  function getScores(lrn) {
    return _get(`${NS}scores_${lrn}`, {
      term1: { quizzes: {}, st: {}, pt: {}, te: null, activities: {} },
      term2: { quizzes: {}, st: {}, pt: {}, te: null, activities: {} },
      term3: { quizzes: {}, st: {}, pt: {}, te: null, activities: {} }
    });
  }

  /**
   * Save an assessment score.
   *
   * ⚠️ FIX (X2): TE records are now written directly to scores[term].te
   * instead of scores[term].te.te. This matches how classrecord.js,
   * grading-sheet.html, reports.html, and term index pages READ the value.
   *
   * ⚠️ FIX (X24): If a PT record already has a teacher-set score,
   * preserve it when the student re-submits (unless the caller explicitly
   * passes score: null AND existing score is null).
   *
   * ⚠️ NEW: Stores `set` field (A or B) so item analysis can un-shuffle.
   */
  function saveScore(lrn, term, type, id, data) {
    const scores = getScores(lrn);
    if (!scores[term]) scores[term] = { quizzes: {}, st: {}, pt: {}, te: null, activities: {} };

    // ⚠️ FIX (X2): TE has a different structure — it's a single record, not a map.
    if (type === 'te') {
      const existing = scores[term].te || {};
      // Preserve teacher score if present
      const preservedScore = (data && data.score != null) ? data.score
        : (existing.score != null ? existing.score : null);
      const preservedPercent = (data && data.percent != null) ? data.percent
        : (existing.percent != null ? existing.percent : null);

      scores[term].te = {
        ...existing,
        ...data,
        score: preservedScore,
        percent: preservedPercent,
        timestamp: new Date().toISOString()
      };
    } else {
      if (!scores[term][type]) scores[term][type] = {};
      const existing = scores[term][type][id] || {};

      // ⚠️ FIX (X24): Preserve teacher-set score on PT re-submit
      const preservedScore = (data && data.score != null) ? data.score
        : (existing.score != null ? existing.score : null);
      const preservedPercent = (data && data.percent != null) ? data.percent
        : (existing.percent != null ? existing.percent : null);

      scores[term][type][id] = {
        ...existing,
        ...data,
        score: preservedScore,
        percent: preservedPercent,
        timestamp: new Date().toISOString()
      };
    }

    _set(`${NS}scores_${lrn}`, scores);
    return type === 'te' ? scores[term].te : scores[term][type][id];
  }

  /* ---------- Badges (per term) ---------- */
  function getBadges(lrn) {
    return _get(`${NS}badges_${lrn}`, { term1: [], term2: [], term3: [] });
  }

  function awardBadge(lrn, term, badgeId) {
    const badges = getBadges(lrn);
    if (!Array.isArray(badges[term])) badges[term] = [];
    if (!badges[term].includes(badgeId)) {
      badges[term].push(badgeId);
      _set(`${NS}badges_${lrn}`, badges);
      return true;
    }
    return false;
  }

  /* ---------- Daily Points ---------- */
  function getDailyPoints(lrn, term, week, day) {
    const key = `${NS}points_${lrn}_${term}_w${week}_d${day}`;
    return _get(key, 0);
  }

  function addDailyPoints(lrn, term, week, day, points) {
    const key = `${NS}points_${lrn}_${term}_w${week}_d${day}`;
    const current = _get(key, 0);
    const updated = current + points;
    _set(key, updated);
    return updated;
  }

  /* ---------- Assessment Attempts (Anti-cheat) ---------- */
  function getAttempts(lrn, assessmentId) {
    return _get(`${NS}attempts_${lrn}_${assessmentId}`, 0);
  }

  function incrementAttempts(lrn, assessmentId) {
    const key = `${NS}attempts_${lrn}_${assessmentId}`;
    const n = _get(key, 0) + 1;
    _set(key, n);
    return n;
  }

  function lockAssessment(lrn, assessmentId, lockData) {
    _set(`${NS}lock_${lrn}_${assessmentId}`, {
      locked: true,
      ...lockData,
      lockedAt: new Date().toISOString()
    });
  }

  function isAssessmentLocked(lrn, assessmentId) {
    const lock = _get(`${NS}lock_${lrn}_${assessmentId}`, null);
    return lock && lock.locked;
  }

  function unlockAssessment(lrn, assessmentId) {
    _remove(`${NS}lock_${lrn}_${assessmentId}`);
  }

  /* ---------- Export / Import (Backup) ---------- */
  function exportAll(lrn) {
    const user = getUser(lrn);
    if (!user) return null;
    return {
      version: '1.0.1',
      app: 'General Science',
      exportedAt: new Date().toISOString(),
      user,
      progress: getProgress(lrn),
      scores: getScores(lrn),
      badges: getBadges(lrn)
    };
  }

  function importAll(payload) {
    if (!payload || !payload.user) throw new Error('Invalid backup payload');
    saveUser(payload.user);
    if (payload.progress) saveProgress(payload.user.lrn, payload.progress);
    if (payload.scores) _set(`${NS}scores_${payload.user.lrn}`, payload.scores);
    if (payload.badges) _set(`${NS}badges_${payload.user.lrn}`, payload.badges);
    return true;
  }

  /* ---------- Clear All (Dev only) ---------- */
  function clearAll() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS))
      .forEach((k) => localStorage.removeItem(k));
  }

  /* ---------- Public API ---------- */
  return {
    // Users
    getAllUsers, saveUser, getUser, deleteUser,

    // Session
    setSession, getSession, clearSession, getCurrentUser,

    // Progress
    getProgress, saveProgress, markDayComplete,

    // Scores
    getScores, saveScore,

    // Badges
    getBadges, awardBadge,

    // Points
    getDailyPoints, addDailyPoints,

    // Anti-cheat
    getAttempts, incrementAttempts,
    lockAssessment, isAssessmentLocked, unlockAssessment,

    // Backup
    exportAll, importAll,

    // Dev
    clearAll
  };
})();

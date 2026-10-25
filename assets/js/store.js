/* ============================================================
   store.js — Local Storage + Cloud Sync Manager
   Version: 2.1.0 (Cloud-First Architecture + All Legacy Functions)
   ============================================================ */

const Store = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  let syncTimeout = null;
  let isSyncing = false;
  let deviceId = localStorage.getItem(NS + 'device_id');

  // Generate Device ID if not exists
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    localStorage.setItem(NS + 'device_id', deviceId);
  }

  /* ============================================================
     HELPER: Simple Hash for Integrity Check
     ============================================================ */
  function computeHash(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  /* ============================================================
     CORE: Get & Set
     ============================================================ */
  function get(key, defaultValue = null) {
    try {
      const val = localStorage.getItem(NS + key);
      return val ? JSON.parse(val) : defaultValue;
    } catch (e) {
      console.warn('[Store] Failed to parse:', key, e);
      return defaultValue;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      scheduleSync(); // Trigger auto-sync to backend
      return true;
    } catch (e) {
      console.error('[Store] Failed to save:', key, e);
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(NS + key);
    scheduleSync();
  }

  /* ============================================================
     AUTO-SYNC MECHANISM
     ============================================================ */
  function scheduleSync() {
    if (syncTimeout) clearTimeout(syncTimeout);
    // Debounce: Sync 3 seconds after the last save action
    syncTimeout = setTimeout(() => {
      syncToBackend();
    }, 3000);
  }

  async function syncToBackend() {
    if (isSyncing || !navigator.onLine) return;
    if (typeof Sync === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) return;

    const user = getCurrentUser();
    if (!user || !user.lrn) return;

    isSyncing = true;
    
    try {
      // Gather ALL progress data for this student
      const progressData = {
        scores: getScores(user.lrn),
        progress: getProgress(user.lrn),
        badges: getBadges(user.lrn),
        locks: getAllLocks(user.lrn),
        unlocks: getAllUnlocks(user.lrn),
        lastLocalSave: new Date().toISOString()
      };

      const jsonString = JSON.stringify(progressData);
      const hash = computeHash(jsonString);

      // Call backend action 'syncStudentProgress'
      const res = await Sync.backendPost({
        action: 'syncStudentProgress',
        lrn: user.lrn,
        progressJSON: progressData,
        integrityHash: hash,
        deviceId: deviceId,
        studentInfo: {
          lastName: user.lastName,
          firstName: user.firstName,
          middleName: user.middleName || '',
          sex: user.sex || '',
          section: user.section || ''
        }
      });

      if (res && res.ok) {
        console.log('☁️ Cloud Sync Success:', res.syncedAt);
        localStorage.setItem(NS + 'last_sync_time', new Date().toISOString());
      } else {
        console.warn('☁️ Cloud Sync Failed:', res ? res.error : 'Unknown error');
      }
    } catch (e) {
      console.warn('☁️ Cloud Sync Error:', e.message);
    } finally {
      isSyncing = false;
    }
  }

  // Listen for internet recovery
  window.addEventListener('online', () => {
    console.log('🌐 Internet restored. Syncing...');
    syncToBackend();
  });

  /* ============================================================
     USER MANAGEMENT (Cloud-First + Legacy)
     ============================================================ */
  
  async function loginStudent(lrn) {
    if (typeof Sync === 'undefined' || typeof CONFIG === 'undefined') {
      throw new Error('Backend not configured');
    }

    const cleanLrn = String(lrn).replace(/-/g, '').trim();
    
    // 1. Call backend to get or create student
    const res = await Sync.backendPost({
      action: 'loginStudent',
      lrn: cleanLrn,
      deviceId: deviceId
    });

    if (!res || !res.ok) {
      throw new Error(res.error || 'Login failed');
    }

    const studentData = res.student;
    
    // 2. Save user info locally
    const user = {
      lrn: studentData.lrn,
      lastName: studentData.lastName || 'New',
      firstName: studentData.firstName || 'Student',
      middleName: studentData.middleName || '',
      sex: studentData.sex || '',
      section: studentData.section || 'ACADEMIC A', // Default if new
      gradeLevel: 11
    };
    
    set('session', user);
    set('scores_' + cleanLrn, studentData.progress.scores || {});
    set('progress_' + cleanLrn, studentData.progress.progress || {});
    set('badges_' + cleanLrn, studentData.progress.badges || {});
    
    return { isNew: res.isNew, user: user };
  }

  function getCurrentUser() {
    return get('session', null);
  }

  function getUser(lrn) {
    const users = get('users', {});
    return users[lrn] || null;
  }

  function getAllUsers() {
    const users = get('users', {});
    return Object.values(users).sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
  }

  function saveUser(user) {
    const users = get('users', {});
    users[user.lrn] = user;
    set('users', users);
  }

  function clearSession() {
    remove('session');
  }

  /* ============================================================
     SCORES & PROGRESS
     ============================================================ */
  function saveScore(lrn, term, type, id, payload) {
    const scores = getScores(lrn);
    if (!scores[term]) scores[term] = {};
    if (!scores[term][type]) scores[term][type] = {};
    
    scores[term][type][id] = payload;
    set('scores_' + lrn, scores);
  }

  function getScores(lrn) {
    return get('scores_' + lrn, {});
  }

  function saveProgress(lrn, term, data) {
    const progress = getProgress(lrn);
    if (!progress[term]) progress[term] = {};
    progress[term] = Object.assign(progress[term], data);
    set('progress_' + lrn, progress);
  }

  function getProgress(lrn) {
    return get('progress_' + lrn, {});
  }

  function saveBadges(lrn, term, badges) {
    const allBadges = getBadges(lrn);
    allBadges[term] = badges;
    set('badges_' + lrn, allBadges);
  }

  function getBadges(lrn) {
    return get('badges_' + lrn, {});
  }

  /* ============================================================
     LOCKS & UNLOCKS
     ============================================================ */
  function lockAssessment(lrn, lockKey, reason) {
    const locks = get('locks_' + lrn, {});
    locks[lockKey] = { lockedAt: new Date().toISOString(), reason: reason || 'failed' };
    set('locks_' + lrn, locks);
  }

  function unlockAssessment(lrn, lockKey) {
    const locks = get('locks_' + lrn, {});
    delete locks[lockKey];
    set('locks_' + lrn, locks);
  }

  function isAssessmentLocked(lrn, lockKey) {
    const locks = get('locks_' + lrn, {});
    return !!locks[lockKey];
  }

  function getAllLocks(lrn) {
    return get('locks_' + lrn, {});
  }

  function getAllUnlocks(lrn) {
    // Placeholder for unlocks (usually from backend)
    return get('unlocks_' + lrn, {});
  }

  /* ============================================================
     MISC
     ============================================================ */
  function clearAllData() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(NS));
    keys.forEach(k => localStorage.removeItem(k));
  }

  return {
    get, set, remove,
    loginStudent,
    getCurrentUser,
    getUser,
    getAllUsers,
    saveUser,
    clearSession,
    saveScore,
    getScores,
    saveProgress,
    getProgress,
    saveBadges,
    getBadges,
    lockAssessment,
    unlockAssessment,
    isAssessmentLocked,
    getAllLocks,
    getAllUnlocks,
    clearAllData,
    syncToBackend
  };
})();

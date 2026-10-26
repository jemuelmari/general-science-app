/* ============================================================
   store.js — Local Storage + Cloud Sync Manager
   Version: 2.2.0 (Durable sync queue + offline + merge-on-login)
   ============================================================ */

const Store = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  const SYNC_DELAY = 3000;                          // debounce after the last save
  const RETRY_DELAYS = [10000, 30000, 60000, 120000];
  const WATCHDOG_MS = 60000;                        // check for leftover unsynced data
  const DIRTY_KEY_RE = /^(scores|progress|badges|locks|unlocks)_(.+)$/;

  let syncTimeout = null;
  let retryTimeout = null;
  let retryCount = 0;
  let currentSync = null;     // Promise while a sync is running
  let needResync = false;     // a new save happened while syncing
  let dirtySeq = 0;
  let warnedNoBackend = false;
  let pillTimer = null;

  let deviceId = localStorage.getItem(NS + 'device_id');
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    localStorage.setItem(NS + 'device_id', deviceId);
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function computeHash(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function notify(msg, type, ms) {
    try { if (typeof APP !== 'undefined' && APP.toast) APP.toast(msg, type || 'info', ms || 4000); } catch (e) { }
  }

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  /* ---------- Dirty flag (stored on the device; survives logout/refresh) ---------- */
  function dirtyKey(lrn) { return NS + 'dirty_' + lrn; }

  function markDirty(lrn) {
    try { localStorage.setItem(dirtyKey(lrn), Date.now() + '-' + (++dirtySeq)); } catch (e) { }
  }

  function isDirty(lrn) {
    try { return !!localStorage.getItem(dirtyKey(lrn)); } catch (e) { return false; }
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

  // No dirty flag and no auto-sync (for data that comes from the backend itself)
  function setRaw(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Store] Failed to save:', key, e);
      return false;
    }
  }

  function set(key, value) {
    if (!setRaw(key, value)) return false;
    const m = key.match(DIRTY_KEY_RE);
    if (m) markDirty(m[2]);
    scheduleSync();
    refreshStatus();
    return true;
  }

  function remove(key) {
    localStorage.removeItem(NS + key);
    scheduleSync();
  }

  /* ============================================================
     SYNC (queue + retry)
     ============================================================ */
  function scheduleSync(delay) {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      syncTimeout = null;
      const u = getCurrentUser();
      if (u && u.lrn && isDirty(u.lrn)) syncToBackend();
    }, delay === undefined ? SYNC_DELAY : delay);
  }

  function scheduleRetry() {
    if (retryTimeout) return;
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    retryCount++;
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      const u = getCurrentUser();
      if (u && u.lrn && isDirty(u.lrn)) syncToBackend();
    }, delay);
  }

  async function doSyncOnce() {
    if (!isOnline()) return { ok: false, reason: 'offline' };

    if (typeof Sync === 'undefined' || typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      if (!warnedNoBackend) {
        warnedNoBackend = true;
        console.warn('☁️ Sync skipped: Sync / CONFIG.BACKEND_URL is not available on this page (check script tags).');
      }
      return { ok: false, reason: 'no-backend' };
    }

    const user = getCurrentUser();
    if (!user || !user.lrn) return { ok: false, reason: 'no-user' };

    const lrn = user.lrn;
    const stampAtStart = localStorage.getItem(dirtyKey(lrn));

    try {
      const progressData = {
        scores: getScores(lrn),
        progress: getProgress(lrn),
        badges: getBadges(lrn),
        locks: getAllLocks(lrn),
        unlocks: getAllUnlocks(lrn),
        lastLocalSave: new Date().toISOString()
      };
      const hash = computeHash(JSON.stringify(progressData));

      const res = await Sync.backendPost({
        action: 'syncStudentProgress',
        lrn: lrn,
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
        retryCount = 0;
        // Clear the dirty flag ONLY if nothing new was saved during the sync
        if (localStorage.getItem(dirtyKey(lrn)) === stampAtStart) {
          localStorage.removeItem(dirtyKey(lrn));
        } else {
          needResync = true;
        }
        return { ok: true, syncedAt: res.syncedAt };
      }

      console.warn('☁️ Cloud Sync Failed:', res ? res.error : 'Unknown error');
      scheduleRetry();
      return { ok: false, reason: (res && res.error) || 'unknown' };
    } catch (e) {
      console.warn('☁️ Cloud Sync Error:', e && e.message);
      scheduleRetry();
      return { ok: false, reason: (e && e.message) || 'error' };
    }
  }

  // Safe to call repeatedly; always resolves to { ok, reason }
  function syncToBackend() {
    if (currentSync) { needResync = true; return currentSync; }

    currentSync = (async () => {
      let result;
      do {
        needResync = false;
        result = await doSyncOnce();
      } while (needResync && result.ok);
      return result;
    })().finally(() => {
      currentSync = null;
      const u = getCurrentUser();
      refreshStatus(!!(u && !isDirty(u.lrn)));
    });

    refreshStatus();
    return currentSync;
  }

  // Wait for the sync (with timeout). true = safe (synced or nothing pending)
  async function flushSync(timeoutMs) {
    const u = getCurrentUser();
    if (!u || !u.lrn) return true;
    if (!isDirty(u.lrn)) return true;
    const timeout = new Promise(resolve => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs || 5000));
    const r = await Promise.race([syncToBackend(), timeout]);
    return !!(r && r.ok) && !isDirty(u.lrn);
  }

  /* ============================================================
     STATUS PILL (offline / unsynced / synced)
     ============================================================ */
  function hidePill() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('gsa-sync-pill');
    if (el) el.style.display = 'none';
  }

  function showPill(text, withButton) {
    if (typeof document === 'undefined') return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => showPill(text, withButton), { once: true });
      return;
    }
    let el = document.getElementById('gsa-sync-pill');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gsa-sync-pill';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9997;max-width:320px;padding:10px 14px;border-radius:10px;background:#0d47a1;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);align-items:center;gap:10px;';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (withButton) {
      const b = document.createElement('button');
      b.textContent = 'Sync now';
      b.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer;background:#fff;color:#0d47a1;';
      b.addEventListener('click', () => { syncToBackend(); });
      el.appendChild(b);
    }
    el.style.display = 'flex';
  }

  function refreshStatus(flashSynced) {
    if (typeof document === 'undefined') return;
    if (pillTimer) { clearTimeout(pillTimer); pillTimer = null; }
    const u = getCurrentUser();
    if (!u || !u.lrn) { hidePill(); return; }
    const dirty = isDirty(u.lrn);

    if (!isOnline()) {
      showPill(dirty ? '📴 Offline — progress saved on this device. It will sync when you are back online.' : '📴 Offline', false);
    } else if (currentSync) {
      showPill('🔄 Syncing your progress...', false);
    } else if (dirty) {
      showPill('⚠️ Some progress has not been synced yet.', true);
    } else if (flashSynced) {
      showPill('☁️ Progress synced.', false);
      pillTimer = setTimeout(hidePill, 2500);
    } else {
      hidePill();
    }
  }

  window.addEventListener('online', () => {
    console.log('🌐 Internet restored.');
    const u = getCurrentUser();
    if (u && u.lrn && isDirty(u.lrn)) {
      notify('🌐 You are back online. Syncing your progress...', 'info', 4000);
      syncToBackend();
    }
    refreshStatus();
  });

  window.addEventListener('offline', () => {
    notify('📴 No internet connection. Your progress is saved on this device and will sync when you reconnect.', 'warning', 5000);
    refreshStatus();
  });

  try {
    document.addEventListener('visibilitychange', () => {
      const u = getCurrentUser();
      if (u && u.lrn && isDirty(u.lrn) && isOnline()) syncToBackend();
    });
    window.addEventListener('pagehide', () => {
      const u = getCurrentUser();
      if (u && u.lrn && isDirty(u.lrn) && isOnline()) syncToBackend();
    });
  } catch (e) { }

  // Watchdog: retry if anything is left unsynced
  setInterval(() => {
    const u = getCurrentUser();
    if (u && u.lrn && isDirty(u.lrn) && isOnline() && !currentSync) syncToBackend();
  }, WATCHDOG_MS);

  // On load of any page: sync anything left unsynced
  setTimeout(() => {
    const u = getCurrentUser();
    if (u && u.lrn && isDirty(u.lrn)) syncToBackend();
    refreshStatus();
  }, 1000);

  /* ============================================================
     MERGE (so unsynced local data is never overwritten)
     ============================================================ */
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function mergeData(server, local) {
    if (Array.isArray(server) && Array.isArray(local)) {
      const seen = new Set();
      const out = [];
      server.concat(local).forEach(item => {
        const k = typeof item === 'object' ? JSON.stringify(item) : typeof item + ':' + String(item);
        if (!seen.has(k)) { seen.add(k); out.push(item); }
      });
      return out;
    }
    if (isPlainObject(server) && isPlainObject(local)) {
      if (typeof server.updatedAt === 'string' && typeof local.updatedAt === 'string') {
        return local.updatedAt >= server.updatedAt ? local : server;
      }
      const out = Object.assign({}, server);
      Object.keys(local).forEach(k => {
        out[k] = k in server ? mergeData(server[k], local[k]) : local[k];
      });
      return out;
    }
    return local !== undefined ? local : server;
  }

  /* ============================================================
     USER MANAGEMENT (Cloud-First + Legacy)
     ============================================================ */
  async function loginStudent(lrn) {
    if (typeof Sync === 'undefined' || typeof CONFIG === 'undefined') {
      throw new Error('Backend not configured');
    }

    const cleanLrn = String(lrn).replace(/-/g, '').trim();

    const res = await Sync.backendPost({
      action: 'loginStudent',
      lrn: cleanLrn,
      deviceId: deviceId
    });

    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Login failed');
    }

    const studentData = res.student;
    const sp = studentData.progress || {};

    const user = {
      lrn: studentData.lrn,
      lastName: studentData.lastName || 'New',
      firstName: studentData.firstName || 'Student',
      middleName: studentData.middleName || '',
      sex: studentData.sex || '',
      section: studentData.section || 'ACADEMIC A',
      gradeLevel: 11
    };

    let scores = sp.scores || {};
    let progress = sp.progress || {};
    let badges = sp.badges || {};

    // Unsynced local data? Merge it instead of overwriting.
    const hadUnsynced = isDirty(cleanLrn);
    if (hadUnsynced) {
      console.warn('[Store] Unsynced local data found — merging with backend data.');
      scores = mergeData(scores, get('scores_' + cleanLrn, {}));
      progress = mergeData(progress, get('progress_' + cleanLrn, {}));
      badges = mergeData(badges, get('badges_' + cleanLrn, {}));
    }

    setRaw('session', user);
    setRaw('scores_' + cleanLrn, scores);
    setRaw('progress_' + cleanLrn, progress);
    setRaw('badges_' + cleanLrn, badges);

    if (hadUnsynced) {
      markDirty(cleanLrn);
      scheduleSync(500);
    }
    refreshStatus();

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
    hidePill();
  }

  // Use this on the Log Out button: syncs progress first, then clears the session
  async function logout() {
    try { await flushSync(4000); } catch (e) { }
    clearSession();
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
    logout,
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
    syncToBackend,
    flushSync,
    hasUnsynced: (lrn) => isDirty(lrn)
  };
})();

/* ============================================================
   store.js — Local Storage + Cloud Sync Manager
   Version: 2.3.0 (Auto-pull + safe merge)
   Changelog v2.3.0:
     - ADDED: pullNow() + auto-pull (on load, every 2 min on listing pages, when the tab becomes visible
       again, when back online). Progress made on another device now shows up without
       logging in again. Listing pages (dashboard / term / week) refresh themselves
       when the pulled data changed.
     - FIX: login/pull merge used to concatenate itemResults arrays and mix fields of two
       different score records. Now one whole record wins (same rules as Code.gs).
     - FIX: locks were last-write-wins per device -> a stale device could erase a lock.
       Locks are unioned; unlockAssessment() leaves a tombstone (unlocks[key].unlockedAt)
       that beats any older lock, so unlocks reach every device.
   ============================================================ */

const Store = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  const SYNC_DELAY = 3000;                          // debounce after the last save
  const RETRY_DELAYS = [10000, 30000, 60000, 120000];
  const WATCHDOG_MS = 60000;                        // check for leftover unsynced data
  const DIRTY_KEY_RE = /^(scores|progress|badges|locks|unlocks)_(.+)$/;
  const PULL_INTERVAL = 120 * 1000;                 // auto-pull on listing pages while the tab is visible
  const MIN_PULL_GAP = 20 * 1000;

  let syncTimeout = null;
  let retryTimeout = null;
  let retryCount = 0;
  let currentSync = null;     // Promise while a sync is running
  let needResync = false;     // a new save happened while syncing
  let dirtySeq = 0;
  let warnedNoBackend = false;
  let pillTimer = null;
  let lastSyncError = null;   // reason of the last failed sync (null if ok)
  let currentPull = null;     // Promise while a pull is running
  let lastPullAt = 0;

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

  function friendlyReason(reason) {
    if (reason === 'offline') return 'No internet connection';
    if (reason === 'no-backend') return 'Backend is not configured on this page';
    if (reason === 'no-user') return 'Please log in again';
    if (reason === 'timeout') return 'The server took too long to respond';
    return String(reason || 'Unknown error');
  }

  function notify(msg, type, ms) {
    try { if (typeof APP !== 'undefined' && APP.toast) APP.toast(msg, type || 'info', ms || 4000); } catch (e) { }
  }

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  /* ---------- Backend POST (uses Sync.backendPost if present, else posts directly) ---------- */
  async function backendPost(payload) {
    // NOTE: always use the local implementation (has a 20s timeout). Sync.backendPost
    // has none, so one stalled request used to freeze every later sync ("Syncing..." forever).
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend not configured');
    }
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const resp = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
      const text = await resp.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('Backend returned a non-JSON response (HTTP ' + resp.status + ')');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('The server took too long to respond');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
     CORE: Get & Set (NULL-SAFE)
     ============================================================ */
  function get(key, defaultValue = null) {
    try {
      const val = localStorage.getItem(NS + key);
      if (!val || val === 'null' || val === 'undefined') return defaultValue;
      const parsed = JSON.parse(val);
      if (parsed === null || parsed === undefined) return defaultValue;
      return parsed;
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

    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      if (!warnedNoBackend) {
        warnedNoBackend = true;
        console.warn('☁️ Sync skipped: CONFIG.BACKEND_URL is not available on this page (check that config.js is loaded).');
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

      const res = await backendPost({
        action: 'syncStudentProgress',
        lrn: lrn,
        progressJSON: progressData,
        integrityHash: hash,
        deviceId: deviceId,
        studentInfo: {
          lastName: user.lastName || '',
          firstName: user.firstName || '',
          middleName: user.middleName || '',
          sex: user.sex || '',
          section: user.section || ''
        }
      });

      // Server says this LRN was never registered: retrying will never help
      if (res && res.notRegistered) {
        console.warn('☁️ Sync stopped:', res.error);
        localStorage.removeItem(dirtyKey(lrn));
        return { ok: false, reason: res.error || 'not-registered' };
      }

      if (res && res.ok) {
        console.log('☁️ Cloud Sync Success:', res.syncedAt);
        localStorage.setItem(NS + 'last_sync_time', new Date().toISOString());
        retryCount = 0;
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

  function syncToBackend() {
    if (currentSync) { needResync = true; return currentSync; }

    currentSync = (async () => {
      let result;
      do {
        needResync = false;
        result = await doSyncOnce();
      } while (needResync && result.ok);
      return result;
    })().then(r => {
      lastSyncError = r && r.ok ? null : (r && r.reason) || 'Unknown error';
      return r;
    }).finally(() => {
      currentSync = null;
      const u = getCurrentUser();
      refreshStatus(!!(u && !isDirty(u.lrn)));
    });

    refreshStatus();
    return currentSync;
  }

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
      b.addEventListener('click', () => {
        syncToBackend().then(r => {
          if (r && !r.ok) notify('⚠️ Sync failed: ' + friendlyReason(r.reason), 'danger', 8000);
        });
      });
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
      showPill('⚠️ Some progress has not been synced yet.' +
        (lastSyncError && lastSyncError !== 'offline' ? ' (' + friendlyReason(lastSyncError) + ')' : ''), true);
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

  setInterval(() => {
    const u = getCurrentUser();
    if (u && u.lrn && isDirty(u.lrn) && isOnline() && !currentSync) syncToBackend();
  }, WATCHDOG_MS);

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

  /* ---------- Safe merge (mirror of mergeProgressData in Code.gs) ---------- */
  const TS_KEYS = ['timestamp', 'updatedAt', 'submittedAt', 'gradedAt', 'lockedAt', 'unlockedAt', 'at'];
  const HEAVY_KEYS = { itemResults: 1, breakdown: 1, items: 1, answers: 1 };

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function tsOf(o) {
    if (typeof o === 'string') { const d = Date.parse(o); return isNaN(d) ? 0 : d; }
    if (!isPlainObject(o)) return 0;
    let best = 0;
    TS_KEYS.forEach(k => {
      if (!o[k]) return;
      const t = Date.parse(o[k]);
      if (!isNaN(t) && t > best) best = t;
    });
    return best;
  }

  function isGraded(o) {
    return isPlainObject(o) &&
      ((o.percent !== undefined && o.percent !== null) ||
       (o.score !== undefined && o.score !== null && Number(o.total) > 0));
  }

  function pctOf(o) {
    if (o.percent !== undefined && o.percent !== null) return Number(o.percent) || 0;
    return Number(o.total) ? Number(o.score) / Number(o.total) * 100 : 0;
  }

  function hasItems(o) { return !!(o && Array.isArray(o.itemResults) && o.itemResults.length); }

  // ONE whole record wins (never a hybrid of two attempts).
  function mergeScoreEntry(ex, inc) {
    if (!isPlainObject(ex)) return inc;
    if (!isPlainObject(inc)) return ex;

    if (isGraded(ex) && isGraded(inc)) {
      const ep = pctOf(ex), ip = pctOf(inc);
      let out = ip > ep ? inc : ip < ep ? ex : (tsOf(inc) > tsOf(ex) ? inc : ex);
      const other = out === ex ? inc : ex;
      if (!hasItems(out) && hasItems(other) && ip === ep) {
        out = clone(out);
        out.itemResults = other.itemResults;
      }
      return out;
    }

    const newer = tsOf(inc) > tsOf(ex) ? inc : ex;
    const older = newer === inc ? ex : inc;
    const res = clone(newer);
    ['bestScore', 'attempts', 'points'].forEach(k => {
      if (typeof ex[k] === 'number' || typeof inc[k] === 'number') res[k] = Math.max(Number(ex[k]) || 0, Number(inc[k]) || 0);
    });
    if (ex.passed !== undefined || inc.passed !== undefined) res.passed = !!(ex.passed || inc.passed);
    if (res.score === undefined && older.score !== undefined) res.score = older.score;
    return res;
  }

  function mergeScoreMaps(base, inc) {
    const out = clone(isPlainObject(base) ? base : {});
    if (!isPlainObject(inc)) return out;
    Object.keys(inc).forEach(term => {
      if (!isPlainObject(inc[term])) return;
      if (!isPlainObject(out[term])) out[term] = {};
      Object.keys(inc[term]).forEach(type => {
        const items = inc[term][type];
        if (!isPlainObject(items)) return;
        if (!isPlainObject(out[term][type])) out[term][type] = {};
        Object.keys(items).forEach(id => {
          if (!isPlainObject(items[id])) return;
          out[term][type][id] = mergeScoreEntry(out[term][type][id], clone(items[id]));
        });
      });
    });
    return out;
  }

  function mergeProgressMaps(base, inc) {
    const out = clone(isPlainObject(base) ? base : {});
    if (!isPlainObject(inc)) return out;
    Object.keys(inc).forEach(term => {
      const t = inc[term];
      if (!isPlainObject(t)) return;
      if (!isPlainObject(out[term])) out[term] = { completed: [], weeks: {} };
      const o = out[term];
      Object.keys(t).forEach(k => { if (k !== 'completed' && k !== 'weeks') o[k] = clone(t[k]); });
      if (!Array.isArray(o.completed)) o.completed = [];
      (Array.isArray(t.completed) ? t.completed : []).forEach(d => { if (o.completed.indexOf(d) === -1) o.completed.push(d); });
      if (isPlainObject(t.weeks)) {
        if (!isPlainObject(o.weeks)) o.weeks = {};
        Object.assign(o.weeks, clone(t.weeks));
      }
    });
    return out;
  }

  function mergeBadgeMaps(base, inc) {
    const out = clone(isPlainObject(base) ? base : {});
    if (!isPlainObject(inc)) return out;
    Object.keys(inc).forEach(term => {
      if (!Array.isArray(out[term])) out[term] = [];
      (Array.isArray(inc[term]) ? inc[term] : []).forEach(b => { if (out[term].indexOf(b) === -1) out[term].push(b); });
    });
    return out;
  }

  function stampObj(v) { return typeof v === 'string' ? { unlockedAt: v } : v; }

  // Locks are unioned; an unlock tombstone beats a lock that is not newer than it.
  function mergeLocksUnlocks(lockSrcs, unlockSrcs) {
    const locks = {}, unlocks = {};
    lockSrcs.forEach(src => {
      if (!isPlainObject(src)) return;
      Object.keys(src).forEach(k => {
        const v = src[k];
        if (!v) return;
        if (!locks[k] || tsOf(v) >= tsOf(locks[k])) locks[k] = clone(v);
      });
    });
    unlockSrcs.forEach(src => {
      if (!isPlainObject(src)) return;
      Object.keys(src).forEach(k => {
        const v = stampObj(src[k]);
        if (!isPlainObject(v)) return;
        if (!unlocks[k] || tsOf(v) >= tsOf(unlocks[k])) unlocks[k] = clone(v);
      });
    });
    Object.keys(locks).forEach(k => { if (unlocks[k] && tsOf(unlocks[k]) >= tsOf(locks[k])) delete locks[k]; });
    return { locks, unlocks };
  }

  // server = what the cloud has, local = this device. Result is the same on every device.
  function mergeBundle(server, local) {
    server = server || {}; local = local || {};
    const lu = mergeLocksUnlocks([server.locks, local.locks], [server.unlocks, local.unlocks]);
    return {
      scores: mergeScoreMaps(mergeScoreMaps({}, server.scores), local.scores),
      progress: mergeProgressMaps(mergeProgressMaps({}, server.progress), local.progress),
      badges: mergeBadgeMaps(mergeBadgeMaps({}, server.badges), local.badges),
      locks: lu.locks,
      unlocks: lu.unlocks
    };
  }

  function stripHeavy(v) {
    if (Array.isArray(v)) return v.map(stripHeavy);
    if (isPlainObject(v)) {
      const o = {};
      Object.keys(v).forEach(k => { if (!HEAVY_KEYS[k]) o[k] = stripHeavy(v[k]); });
      return o;
    }
    return v;
  }

  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (isPlainObject(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  function readBundle(lrn) {
    return {
      scores: get('scores_' + lrn, {}),
      progress: get('progress_' + lrn, {}),
      badges: get('badges_' + lrn, {}),
      locks: get('locks_' + lrn, {}),
      unlocks: get('unlocks_' + lrn, {})
    };
  }

  // Writes only what changed (no needless storage writes). Returns true when anything changed.
  function writeBundle(lrn, b) {
    const cur = readBundle(lrn);
    let changed = false;
    ['scores', 'progress', 'badges', 'locks', 'unlocks'].forEach(k => {
      if (stable(cur[k]) !== stable(b[k])) { setRaw(k + '_' + lrn, b[k]); changed = true; }
    });
    return changed;
  }

  // Is there something in `merged` that the cloud copy does not have yet?
  // (itemResults are ignored: the cloud strips them when a row is too large)
  function cloudIsBehind(serverProgress, merged) {
    const srv = mergeBundle(serverProgress, {});
    return stable(stripHeavy(srv)) !== stable(stripHeavy(merged));
  }

  /* ============================================================
     USER MANAGEMENT (Cloud-First + Legacy)
     ============================================================ */
  async function loginStudent(lrn) {
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend not configured');
    }

    const cleanLrn = String(lrn).replace(/-/g, '').trim();

    const res = await backendPost({
      action: 'loginStudent',
      lrn: cleanLrn,
      deviceId: deviceId
    });

    return applyLoginResult(res);
  }

  // Used by login.html too: applies a loginStudent response WITHOUT wiping unsynced local data
  function applyLoginResult(res) {
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Login failed');
    }
    const studentData = res.student;
    const cleanLrn = studentData.lrn;
    if (res.isNew) return { isNew: true, user: null };

    const sp = studentData.progress || {};
    const user = {
      lrn: cleanLrn,
      lastName: studentData.lastName || '',
      firstName: studentData.firstName || '',
      middleName: studentData.middleName || '',
      sex: studentData.sex || '',
      section: studentData.section || '',
      gradeLevel: 11
    };

    // Merge cloud + this device (never lose either side, never mix two score records)
    const merged = mergeBundle(sp, readBundle(cleanLrn));
    setRaw('session', user);
    writeBundle(cleanLrn, merged);
    if (cloudIsBehind(sp, merged)) markDirty(cleanLrn);
    if (res.student && res.student.lastSyncedAt) setRaw('pull_stamp_' + cleanLrn, res.student.lastSyncedAt);

    if (isDirty(cleanLrn)) scheduleSync(500);
    refreshStatus();

    return { isNew: false, user: user };
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

  async function logout() {
    try { await flushSync(4000); } catch (e) { }
    clearSession();
  }

  /* ============================================================
     PULL (cloud -> this device) + AUTO-PULL
     ============================================================ */
  function isListingPage() {
    const p = location.pathname;
    return /\/student\/(dashboard|profile)\.html$/.test(p) ||
           /\/student\/term\d+\/(week\d+\/)?index\.html$/.test(p) ||
           /\/student\/term\d+\/assessments\/index\.html$/.test(p);
  }

  // Only pages that merely LIST progress reload themselves (never a quiz / lesson in progress).
  function maybeRefreshView() {
    try {
      if (!isListingPage()) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      const last = Number(sessionStorage.getItem('gsa_pull_reload_at') || 0);
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem('gsa_pull_reload_at', String(Date.now()));
      location.reload();
    } catch (e) { /* ignore */ }
  }

  // opts.force: ignore the "nothing changed" shortcut.  opts.refresh: reload listing pages if data changed.
  async function pullNow(opts) {
    opts = opts || {};
    if (currentPull) return currentPull;
    if (!isOnline()) return { ok: false, reason: 'offline' };
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) return { ok: false, reason: 'no-backend' };
    const user = getCurrentUser();
    if (!user || !user.lrn) return { ok: false, reason: 'no-user' };
    const lrn = user.lrn;

    currentPull = (async () => {
      try {
        // our own unsynced work goes up first, so the pull cannot race it
        if (isDirty(lrn)) { try { await syncToBackend(); } catch (e) { /* keep going */ } }

        const since = opts.force ? '' : String(get('pull_stamp_' + lrn, '') || '');
        const res = await backendPost({ action: 'pullStudentProgress', lrn: lrn, since: since, deviceId: deviceId });
        if (!res || !res.ok) return { ok: false, reason: (res && res.error) || 'unknown' };
        lastPullAt = Date.now();
        if (res.unchanged) return { ok: true, changed: false, unchanged: true };
        if (res.isNew || !res.student) return { ok: true, changed: false, isNew: true };

        // Read the device state only NOW (after the await) so nothing saved meanwhile is lost
        const sp = res.student.progress || {};
        const local = readBundle(lrn);
        const merged = mergeBundle(sp, local);
        const changed = writeBundle(lrn, merged);
        if (cloudIsBehind(sp, merged)) { markDirty(lrn); scheduleSync(500); }
        if (res.student.lastSyncedAt) setRaw('pull_stamp_' + lrn, res.student.lastSyncedAt);
        setRaw('last_pull_time', new Date().toISOString());

        try { window.dispatchEvent(new CustomEvent('gsa:data-pulled', { detail: { changed: changed } })); } catch (e) { /* ignore */ }
        if (changed && opts.refresh) maybeRefreshView();
        refreshStatus();
        return { ok: true, changed: changed };
      } catch (e) {
        return { ok: false, reason: (e && e.message) || 'error' };
      }
    })().finally(() => { currentPull = null; });
    return currentPull;
  }

  function autoPull(reason, force) {
    const u = getCurrentUser();
    if (!u || !u.lrn) return;
    if (document.hidden) return;
    if (document.body && document.body.classList.contains('quiz-active')) return;   // never disturb a running quiz
    if (!force && Date.now() - lastPullAt < PULL_INTERVAL - 2000) return;
    if (Date.now() - lastPullAt < MIN_PULL_GAP) return;
    pullNow({ refresh: true });
  }

  try {
    setTimeout(() => autoPull('load', true), 1500);
    // the timer only runs on pages that LIST progress (one backend call per student per 2 min
    // is plenty and keeps the Apps Script daily quota safe); other pages pull on load / return
    setInterval(() => { if (isListingPage()) autoPull('interval', false); }, PULL_INTERVAL);
    window.addEventListener('online', () => setTimeout(() => autoPull('online', true), 800));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => autoPull('visible', true), 400); });
  } catch (e) { /* auto-pull must never break a page */ }

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

  // Leaves a tombstone so the unlock beats any older copy of the lock on other devices / the cloud.
  function unlockAssessment(lrn, lockKey) {
    const locks = get('locks_' + lrn, {});
    delete locks[lockKey];
    const unlocks = get('unlocks_' + lrn, {});
    unlocks[lockKey] = { unlockedAt: new Date().toISOString() };
    set('unlocks_' + lrn, unlocks);
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

  function diagnose() {
    const u = getCurrentUser();
    let host = null;
    try { host = new URL(CONFIG.BACKEND_URL).host; } catch (e) { }
    return {
      online: isOnline(),
      hasSync: typeof Sync !== 'undefined',
      syncHasBackendPost: typeof Sync !== 'undefined' && !!Sync && typeof Sync.backendPost === 'function',
      hasConfig: typeof CONFIG !== 'undefined',
      backendUrlSet: typeof CONFIG !== 'undefined' && !!CONFIG.BACKEND_URL,
      backendHost: host,
      user: u ? u.lrn : null,
      unsynced: u ? isDirty(u.lrn) : null,
      syncing: !!currentSync,
      lastSyncTime: localStorage.getItem(NS + 'last_sync_time'),
      lastSyncError: lastSyncError
    };
  }

  return {
    diagnose,
    get, set, remove,
    loginStudent,
    applyLoginResult,
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
    pullNow,
    mergeBundle,
    mergeScoreEntry,
    hasUnsynced: (lrn) => isDirty(lrn)
  };
})();

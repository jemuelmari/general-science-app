/* ============================================================
   sync-auto.js — Offline-first auto-push + unlock poller
   Version: 1.2.0
   App: General Science
   Changelog v1.2.0: 15-second unlock polling while on quiz pages.
                     Auto-reload after applying a remote unlock.
                     Kept 5-min polling for other pages.
   ============================================================ */

const SyncAuto = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  const QUEUE_KEY = NS + 'sync_queue';
  const STATE_KEY = NS + 'sync_state';

  const MAX_RETRIES = 5;
  const BASE_RETRY_DELAY_MS = 2000;
  const MAX_RETRY_DELAY_MS = 60000;
  const FLUSH_INTERVAL_MS = 30000;
  const UNLOCK_POLL_FAST_MS = 15 * 1000;      // 15s — on quiz pages
  const UNLOCK_POLL_SLOW_MS = 5 * 60 * 1000;  // 5min — everywhere else

  var _statusCallbacks = [];
  var _flushTimer = null;
  var _unlockTimer = null;
  var _isFlushing = false;

  function _loadQueue() {
    try { var raw = localStorage.getItem(QUEUE_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }

  function _saveQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
    catch (e) { console.warn('[SyncAuto] Could not persist queue:', e); }
  }

  function _loadState() {
    try { var raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) : { lastSync: null, lastError: null }; }
    catch (e) { return { lastSync: null, lastError: null }; }
  }

  function _saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function enqueue(lrn, term, assessment, attempt) {
    var pushId = (typeof Sync !== 'undefined' && Sync.makePushId)
      ? Sync.makePushId(lrn, term, assessment, attempt.timestamp)
      : (lrn + '-' + term + '-' + assessment + '-' + Date.now());

    var queue = _loadQueue();
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].pushId === pushId) { _emitStatus(); return { ok: true, pushId: pushId, alreadyQueued: true }; }
    }

    queue.push({
      pushId: pushId, lrn: lrn, term: term, assessment: assessment, attempt: attempt,
      queuedAt: new Date().toISOString(), retries: 0, lastError: null
    });
    _saveQueue(queue);
    _emitStatus();
    if (navigator.onLine) setTimeout(function () { flushNow(); }, 100);
    return { ok: true, pushId: pushId };
  }

  async function flushNow() {
    if (_isFlushing) return { ok: false, reason: 'already_flushing' };
    if (!navigator.onLine) return { ok: false, reason: 'offline' };
    if (typeof Sync === 'undefined' || !Sync.backendEnabled || !Sync.backendEnabled()) {
      return { ok: false, reason: 'backend_disabled' };
    }

    _isFlushing = true;
    var queue = _loadQueue();
    if (!queue.length) { _isFlushing = false; _emitStatus(); return { ok: true, pushed: 0, failed: 0, remaining: 0 }; }

    var pushed = 0, failed = 0, remaining = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (item.retries > 0 && item.nextAttemptAt && Date.now() < item.nextAttemptAt) {
        remaining.push(item); continue;
      }
      var res;
      try { res = await Sync.pushAttempt(item.lrn, item.term, item.assessment, item.attempt); }
      catch (e) { res = { ok: false, error: e.message }; }

      if (res && res.ok) { pushed++; }
      else {
        failed++;
        item.retries = (item.retries || 0) + 1;
        item.lastError = (res && res.error) || 'Unknown error';
        if (item.retries >= MAX_RETRIES) {
          item.failedAt = new Date().toISOString();
          remaining.push(item);
        } else {
          var delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, item.retries - 1), MAX_RETRY_DELAY_MS);
          item.nextAttemptAt = Date.now() + delay;
          remaining.push(item);
        }
      }
    }

    _saveQueue(remaining);
    var state = _loadState();
    if (pushed > 0) state.lastSync = new Date().toISOString();
    if (failed > 0) state.lastError = (remaining[0] && remaining[0].lastError) || 'Partial failure';
    _saveState(state);
    _isFlushing = false;
    _emitStatus();
    return { ok: true, pushed: pushed, failed: failed, remaining: remaining.length };
  }

  /* ============================================================
     UNLOCK POLLING
     ============================================================ */

  function _isOnQuizPage() {
    return !!document.getElementById('quiz-root');
  }

  async function pollUnlocks() {
    if (!navigator.onLine) return;
    if (typeof Sync === 'undefined' || typeof Sync.pullUnlocks !== 'function') return;
    if (typeof CONFIG === 'undefined' || !CONFIG.backendEnabled) return;

    var user = (typeof Store !== 'undefined' && Store.getCurrentUser) ? Store.getCurrentUser() : null;
    if (!user) return;

    try {
      var res = await Sync.pullUnlocks(user.lrn);
      if (!res || !res.ok || !res.records || !res.records.length) return;

      var applied = 0;
      res.records.forEach(function (u) {
        var lockKey = u.term + '_' + u.assessment;
        if (Store.isAssessmentLocked(user.lrn, lockKey)) {
          Store.unlockAssessment(user.lrn, lockKey);
          console.log('[SyncAuto] 🔓 Remote unlock applied:', lockKey);
        }
        if (typeof Sync.markUnlockApplied === 'function') {
          Sync.markUnlockApplied(u.unlockId).catch(function () {});
        }
        applied++;
      });

      if (applied > 0 && _isOnQuizPage()) {
        console.log('[SyncAuto] Reloading quiz page to reflect unlock...');
        setTimeout(function () { location.reload(); }, 500);
      }
    } catch (e) {
      console.warn('[SyncAuto] Unlock poll failed:', e.message);
    }
  }

  /* ============================================================
     STATUS
     ============================================================ */

  function getStatus() {
    var queue = _loadQueue();
    var state = _loadState();
    var pending = queue.filter(function (q) { return !q.failedAt; }).length;
    var failedItems = queue.filter(function (q) { return q.failedAt; }).length;
    var status;
    if (!queue.length) status = 'synced';
    else if (failedItems > 0) status = 'failed';
    else status = 'pending';

    return {
      status: status, queueSize: queue.length, pending: pending, failed: failedItems,
      online: navigator.onLine,
      backendEnabled: (typeof Sync !== 'undefined' && Sync.backendEnabled) ? Sync.backendEnabled() : false,
      lastSync: state.lastSync, lastError: state.lastError
    };
  }

  function onStatus(cb) {
    if (typeof cb === 'function') _statusCallbacks.push(cb);
    try { cb(getStatus()); } catch (e) {}
    return function unsubscribe() {
      _statusCallbacks = _statusCallbacks.filter(function (c) { return c !== cb; });
    };
  }

  function _emitStatus() {
    var status = getStatus();
    _statusCallbacks.forEach(function (cb) {
      try { cb(status); } catch (e) { console.warn('[SyncAuto] Callback error:', e); }
    });
  }

  function _scheduleUnlockPoll() {
    if (_unlockTimer) clearTimeout(_unlockTimer);
    var interval = _isOnQuizPage() ? UNLOCK_POLL_FAST_MS : UNLOCK_POLL_SLOW_MS;
    _unlockTimer = setTimeout(function () {
      pollUnlocks().then(function () { _scheduleUnlockPoll(); });
    }, interval);
  }

  function _start() {
    window.addEventListener('online', function () {
      console.info('[SyncAuto] Back online — flushing queue');
      flushNow();
      pollUnlocks();
    });

    window.addEventListener('offline', function () { _emitStatus(); });

    if (_flushTimer) clearInterval(_flushTimer);
    _flushTimer = setInterval(function () {
      if (navigator.onLine && _loadQueue().length > 0) flushNow();
    }, FLUSH_INTERVAL_MS);

    // Kick off the first unlock poll 1s after load, then reschedule adaptively
    setTimeout(function () {
      pollUnlocks().then(function () { _scheduleUnlockPoll(); });
    }, 1000);

    setTimeout(function () { flushNow(); }, 2000);
    _emitStatus();
  }

  function clearQueue() { _saveQueue([]); _emitStatus(); return { ok: true }; }

  function retryFailed() {
    var queue = _loadQueue();
    queue.forEach(function (item) {
      delete item.failedAt; delete item.nextAttemptAt; item.retries = 0;
    });
    _saveQueue(queue);
    return flushNow();
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _start);
    else _start();
  }

  return {
    enqueue: enqueue,
    flushNow: flushNow,
    pollUnlocks: pollUnlocks,
    getStatus: getStatus,
    onStatus: onStatus,
    clearQueue: clearQueue,
    retryFailed: retryFailed
  };
})();

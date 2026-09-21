/* ============================================================
   sync-auto.js — Offline-first auto-push queue for attempts
   Version: 1.0.0
   App: General Science · v1.0.2
   ------------------------------------------------------------
   Responsibilities:
     1. Queue attempts locally when offline
     2. Auto-flush queue when back online (window 'online' event)
     3. Retry with exponential backoff
     4. Status events: 'synced' | 'pending' | 'failed'
     5. Fire callbacks so UI can render sync badge

   Depends on:
     - Sync (sync.js)  — for pushAttempt
     - Store           — for user context
     - CONFIG          — for backendEnabled

   Storage:
     localStorage 'gsa_v1_sync_queue' = [ { pushId, lrn, term, assessment,
                                            attempt, queuedAt, retries, lastError } ]

   Usage:
     SyncAuto.enqueue(lrn, term, assessment, attempt);
     SyncAuto.onStatus(cb);      // called with { status, queueSize, lastError }
     SyncAuto.flushNow();
     SyncAuto.getStatus();       // { status, queueSize, online, lastSync, lastError }
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

  var _statusCallbacks = [];
  var _flushTimer = null;
  var _isFlushing = false;

  /* ============================================================
     QUEUE PERSISTENCE
     ============================================================ */
  function _loadQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function _saveQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
    catch (e) { console.warn('[SyncAuto] Could not persist queue:', e); }
  }

  function _loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : { lastSync: null, lastError: null };
    } catch (e) { return { lastSync: null, lastError: null }; }
  }

  function _saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    catch (e) {}
  }

  /* ============================================================
     PUBLIC: ENQUEUE
     ============================================================ */
  /**
   * Add an attempt to the queue. Idempotent by pushId.
   * Immediately attempts a flush if online.
   */
  function enqueue(lrn, term, assessment, attempt) {
    var pushId = (typeof Sync !== 'undefined' && Sync.makePushId)
      ? Sync.makePushId(lrn, term, assessment, attempt.timestamp)
      : (lrn + '-' + term + '-' + assessment + '-' + Date.now());

    var queue = _loadQueue();

    // Idempotency — don't double-queue the same attempt
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].pushId === pushId) {
        _emitStatus();
        return { ok: true, pushId: pushId, alreadyQueued: true };
      }
    }

    queue.push({
      pushId: pushId,
      lrn: lrn,
      term: term,
      assessment: assessment,
      attempt: attempt,
      queuedAt: new Date().toISOString(),
      retries: 0,
      lastError: null
    });
    _saveQueue(queue);

    _emitStatus();

    // Fire-and-forget flush
    if (navigator.onLine) {
      setTimeout(function () { flushNow(); }, 100);
    }

    return { ok: true, pushId: pushId };
  }

  /* ============================================================
     PUBLIC: FLUSH
     ============================================================ */
  /**
   * Attempt to flush the entire queue. Errors are captured per-item.
   * Returns: { ok, pushed, failed, remaining }
   */
  async function flushNow() {
    if (_isFlushing) return { ok: false, reason: 'already_flushing' };
    if (!navigator.onLine) return { ok: false, reason: 'offline' };

    if (typeof Sync === 'undefined' || !Sync.backendEnabled || !Sync.backendEnabled()) {
      return { ok: false, reason: 'backend_disabled' };
    }

    _isFlushing = true;
    var queue = _loadQueue();
    if (!queue.length) {
      _isFlushing = false;
      _emitStatus();
      return { ok: true, pushed: 0, failed: 0, remaining: 0 };
    }

    var pushed = 0;
    var failed = 0;
    var remaining = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];

      // Backoff check
      if (item.retries > 0 && item.nextAttemptAt && Date.now() < item.nextAttemptAt) {
        remaining.push(item);
        continue;
      }

      var res;
      try {
        res = await Sync.pushAttempt(item.lrn, item.term, item.assessment, item.attempt);
      } catch (e) {
        res = { ok: false, error: e.message };
      }

      if (res && res.ok) {
        pushed++;
        // success — drop from queue
      } else {
        failed++;
        item.retries = (item.retries || 0) + 1;
        item.lastError = (res && res.error) || 'Unknown error';

        if (item.retries >= MAX_RETRIES) {
          // Give up — keep in queue but flag as failed
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
     PUBLIC: STATUS
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
      status: status,
      queueSize: queue.length,
      pending: pending,
      failed: failedItems,
      online: navigator.onLine,
      backendEnabled: (typeof Sync !== 'undefined' && Sync.backendEnabled) ? Sync.backendEnabled() : false,
      lastSync: state.lastSync,
      lastError: state.lastError
    };
  }

  /* ============================================================
     PUBLIC: STATUS CALLBACKS
     ============================================================ */
  function onStatus(cb) {
    if (typeof cb === 'function') _statusCallbacks.push(cb);
    // Fire once immediately with current status
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

  /* ============================================================
     LIFECYCLE — auto-flush on online / interval
     ============================================================ */
  function _start() {
    // Flush on 'online' event
    window.addEventListener('online', function () {
      console.info('[SyncAuto] Back online — flushing queue');
      flushNow();
    });

    window.addEventListener('offline', function () {
      console.info('[SyncAuto] Offline');
      _emitStatus();
    });

    // Periodic flush
    if (_flushTimer) clearInterval(_flushTimer);
    _flushTimer = setInterval(function () {
      if (navigator.onLine && _loadQueue().length > 0) {
        flushNow();
      }
    }, FLUSH_INTERVAL_MS);

    // Initial flush (deferred so module init is not blocked)
    setTimeout(function () { flushNow(); }, 2000);

    _emitStatus();
  }

  /* ============================================================
     PUBLIC: CLEAR (admin / debug)
     ============================================================ */
  function clearQueue() {
    _saveQueue([]);
    _emitStatus();
    return { ok: true };
  }

  function retryFailed() {
    var queue = _loadQueue();
    queue.forEach(function (item) {
      delete item.failedAt;
      delete item.nextAttemptAt;
      item.retries = 0;
    });
    _saveQueue(queue);
    return flushNow();
  }

  /* ============================================================
     AUTO-START (skip if explicitly disabled)
     ============================================================ */
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _start);
    } else {
      _start();
    }
  }

  /* ============================================================
     Public API
     ============================================================ */
  return {
    enqueue: enqueue,
    flushNow: flushNow,
    getStatus: getStatus,
    onStatus: onStatus,
    clearQueue: clearQueue,
    retryFailed: retryFailed
  };
})();

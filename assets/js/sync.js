/* ============================================================
   sync.js — Sync Code + JSON payload + backend bridge
   Version: 2.0.1
   App: General Science · v1.0.2
   Changelog:
     v2.0.1: getSyncStatus now uses POST (was GET → Unknown action).
     v2.0.0: Canonical JSON signing (X36); new pushAttempt/pullAttempts/
             markUsedBulk/archiveUsed/getSyncStatus wrappers;
             legacy API preserved (registerSyncCode flow unchanged).
     v1.1.0: Added pullAllPending() for teacher Sync Center.
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  /* ============================================================
     CANONICAL JSON (X36 fix — matches Code.gs)
     ============================================================ */
  /**
   * Canonicalize: keys sorted recursively, no whitespace, no signature field.
   * MUST match Code.gs canonicalize() exactly, or HMAC will mismatch.
   */
  function canonicalize(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number') {
      if (isNaN(obj) || !isFinite(obj)) return 'null';
      return String(obj);
    }
    if (typeof obj === 'boolean') return obj ? 'true' : 'false';
    if (typeof obj === 'string') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(canonicalize).join(',') + ']';
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj).filter(function (k) {
        if (k === 'signature') return false;
        return obj[k] !== undefined && typeof obj[k] !== 'function';
      });
      keys.sort();
      var parts = keys.map(function (k) {
        return JSON.stringify(k) + ':' + canonicalize(obj[k]);
      });
      return '{' + parts.join(',') + '}';
    }
    return 'null';
  }

  /**
   * Sign a payload using canonical JSON.
   */
  async function signCanonical(payload) {
    var canonical = canonicalize(payload);
    if (typeof Security !== 'undefined' && typeof Security.signString === 'function') {
      return await Security.signString(canonical);
    }
    if (typeof Security !== 'undefined' && typeof Security.sign === 'function') {
      return await Security.sign(payload);
    }
    throw new Error('Security module unavailable — cannot sign payload');
  }

  async function verifyCanonical(payload, signature) {
    var canonical = canonicalize(payload);
    if (typeof Security !== 'undefined' && typeof Security.verifyString === 'function') {
      return await Security.verifyString(canonical, signature);
    }
    if (typeof Security !== 'undefined' && typeof Security.verify === 'function') {
      return await Security.verify(payload, signature);
    }
    throw new Error('Security module unavailable — cannot verify payload');
  }

  /* ============================================================
     Backend helpers
     ============================================================ */
  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body) {
    var res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function backendGet(params) {
    var url = new URL(CONFIG.BACKEND_URL);
    Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
    var res = await fetch(url.toString());
    return res.json();
  }

  /* ============================================================
     Payload Builder (legacy)
     ============================================================ */
  async function buildPayload(lrn, term) {
    var user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    var progress = Store.getProgress(lrn);
    var scores = Store.getScores(lrn);
    var badges = Store.getBadges(lrn);

    var payload = {
      version: '1.0.0',
      app: 'General Science',
      generatedAt: new Date().toISOString(),
      student: {
        lrn: user.lrn,
        lastName: user.lastName,
        firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel,
        section: user.section,
        sex: user.sex || ''
      },
      term: term || 'all',
      progress: term ? (function () { var o = {}; o[term] = progress[term]; return o; })() : progress,
      scores: term ? (function () { var o = {}; o[term] = scores[term]; return o; })() : scores,
      badges: term ? (function () { var o = {}; o[term] = badges[term]; return o; })() : badges
    };

    var signature = await signCanonical(payload);
    return { payload: payload, signature: signature };
  }

  /* ============================================================
     Sync Code (legacy, unchanged)
     ============================================================ */
  async function generateSyncCode(lrn, term) {
    var built = await buildPayload(lrn, term);
    var payload = built.payload;
    var signature = built.signature;
    var json = JSON.stringify(payload);
    var signatureShort = signature.slice(0, 8).toUpperCase();
    var hash = _shortHash(json).toUpperCase();
    var code = 'GS11-' + hash.slice(0, 4) + '-' + hash.slice(4, 8) + '-' + signatureShort;

    var mode = 'local';

    if (backendEnabled()) {
      try {
        var res = await backendPost({
          action: 'registerSyncCode',
          code: code,
          lrn: lrn,
          payload: payload,
          signature: signature
        });
        if (res.ok) mode = 'backend';
        else console.warn('[Sync] Backend register failed:', res.error);
      } catch (err) {
        console.warn('[Sync] Backend unreachable, saving locally:', err);
      }
    }

    _saveLocalCode(code, { payload: payload, signature: signature });

    return {
      code: code,
      payload: payload,
      signature: signature,
      mode: mode,
      createdAt: new Date().toISOString()
    };
  }

  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        var res = await backendPost({ action: 'resolveSyncCode', code: code });
        if (res.ok) {
          return {
            payload: res.payload,
            signature: res.signature,
            source: 'backend',
            createdAt: res.createdAt
          };
        }
      } catch (err) {
        console.warn('[Sync] Backend lookup failed, trying local:', err);
      }
    }

    var local = _getLocalCode(code);
    if (local) {
      var copy = {};
      Object.keys(local).forEach(function (k) { copy[k] = local[k]; });
      copy.source = 'local';
      return copy;
    }

    return null;
  }

  function _saveLocalCode(code, data) {
    var codes = JSON.parse(localStorage.getItem(NS + 'sync_codes') || '{}');
    codes[code] = Object.assign({}, data, { savedAt: new Date().toISOString() });
    var entries = Object.keys(codes).map(function (k) { return [k, codes[k]]; });
    entries.sort(function (a, b) {
      return new Date(b[1].savedAt) - new Date(a[1].savedAt);
    });
    var trimmed = {};
    entries.slice(0, 10).forEach(function (pair) { trimmed[pair[0]] = pair[1]; });
    localStorage.setItem(NS + 'sync_codes', JSON.stringify(trimmed));
  }

  function _getLocalCode(code) {
    var codes = JSON.parse(localStorage.getItem(NS + 'sync_codes') || '{}');
    return codes[code] || null;
  }

  /* ============================================================
     JSON File Export / Import (legacy)
     ============================================================ */
  async function exportAsFile(lrn, term) {
    var built = await buildPayload(lrn, term);
    var envelope = { payload: built.payload, signature: built.signature };
    var json = JSON.stringify(envelope, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);

    var filename = 'GSA_' + built.payload.student.lrn + '_' + (term || 'all') + '_' + _dateStamp() + '.json';
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  async function importFromFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = async function (e) {
        try {
          var envelope = JSON.parse(e.target.result);
          var payload = envelope.payload;
          var signature = envelope.signature;
          if (!payload || !signature) throw new Error('Missing payload or signature');
          var valid = await verifyCanonical(payload, signature);
          resolve({ payload: payload, signature: signature, valid: valid });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('File read error')); };
      reader.readAsText(file);
    });
  }

  async function importFromCode(code) {
    var record = await lookupSyncCode(code);
    if (!record) {
      return {
        valid: false,
        error: backendEnabled()
          ? 'Code not found (checked backend and this device)'
          : 'Code not found on this device. Enable the backend for cross-device sync.'
      };
    }
    var valid = await verifyCanonical(record.payload, record.signature);
    return {
      payload: record.payload,
      signature: record.signature,
      valid: valid,
      source: record.source
    };
  }

  /* ============================================================
     LEGACY: pullAllPending (sync codes)
     ============================================================ */
  async function pullAllPending(filters) {
    if (!backendEnabled()) {
      return { ok: false, error: 'Backend not configured. Set CONFIG.BACKEND_URL.' };
    }
    try {
      var body = { action: 'pullAllPending' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Unknown backend error' };

      var records = (res.records || []).map(function (r) {
        var copy = {};
        Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
        copy.verified = true;
        return copy;
      });

      return { ok: true, count: records.length, records: records };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function markCodeUsed(code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({ action: 'deleteSyncCode', code: code });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try {
      var start = Date.now();
      var res = await backendGet({ action: 'ping' });
      return Object.assign({}, res, { ms: Date.now() - start });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     NEW v2.0.0 — Attempts (auto-push)
     ============================================================ */

  function buildAttemptPayload(lrn, term, assessment, attempt) {
    var user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    return {
      version: '2.0.0',
      student: {
        lrn: user.lrn,
        lastName: user.lastName,
        firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel,
        section: user.section
      },
      attempt: {
        term: term,
        assessment: assessment,
        score: attempt.score,
        total: attempt.total,
        itemResults: attempt.itemResults || [],
        set: attempt.set || '',
        timestamp: attempt.timestamp || new Date().toISOString()
      }
    };
  }

  function makePushId(lrn, term, assessment, timestamp) {
    var ts = timestamp ? new Date(timestamp).getTime() : Date.now();
    return lrn + '-' + term + '-' + assessment + '-' + ts;
  }

  async function pushAttempt(lrn, term, assessment, attempt) {
    if (!backendEnabled()) {
      return { ok: false, error: 'Backend not configured', offline: true };
    }

    var payload = buildAttemptPayload(lrn, term, assessment, attempt);
    var signature = await signCanonical(payload);
    var pushId = makePushId(lrn, term, assessment, attempt.timestamp);

    try {
      var res = await backendPost({
        action: 'pushAttempt',
        pushId: pushId,
        lrn: lrn,
        term: term,
        assessment: assessment,
        score: attempt.score,
        total: attempt.total,
        itemResults: attempt.itemResults || [],
        set: attempt.set || '',
        clientTimestamp: attempt.timestamp || new Date().toISOString(),
        payload: payload,
        signature: signature
      });
      return Object.assign({ pushId: pushId }, res);
    } catch (err) {
      return { ok: false, error: err.message, pushId: pushId, offline: true };
    }
  }

  async function pullAttempts(filters) {
    if (!backendEnabled()) {
      return { ok: false, error: 'Backend not configured' };
    }
    try {
      var body = { action: 'pullAttempts' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };

      var verified = [];
      for (var i = 0; i < (res.records || []).length; i++) {
        var r = res.records[i];
        var isValid = false;
        try { isValid = await verifyCanonical(r.payload, r.signature); }
        catch (e) { isValid = false; }
        var copy = {};
        Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
        copy.verified = isValid;
        verified.push(copy);
      }
      return { ok: true, count: verified.length, records: verified };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function markUsedBulk(pushIds, usedBy) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({
        action: 'markUsedBulk',
        pushIds: pushIds || [],
        usedBy: usedBy || 'teacher'
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function archiveUsed(opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({
        action: 'archiveUsed',
        olderThanDays: opts && opts.olderThanDays,
        archivedBy: (opts && opts.archivedBy) || 'teacher'
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * getSyncStatus — v2.0.1: switched from GET → POST to match doPost handler.
   */
  async function getSyncStatus(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({
        action: 'getSyncStatus',
        section: (filters && filters.section) || ''
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     Helpers
     ============================================================ */
  function _shortHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function _dateStamp() {
    var d = new Date();
    return d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  /* ============================================================
     Public API
     ============================================================ */
  return {
    // Canonical (new)
    canonicalize: canonicalize,
    signCanonical: signCanonical,
    verifyCanonical: verifyCanonical,

    // Backend
    backendEnabled: backendEnabled,
    pingBackend: pingBackend,

    // Legacy — sync codes
    buildPayload: buildPayload,
    generateSyncCode: generateSyncCode,
    lookupSyncCode: lookupSyncCode,
    exportAsFile: exportAsFile,
    importFromFile: importFromFile,
    importFromCode: importFromCode,
    pullAllPending: pullAllPending,
    markCodeUsed: markCodeUsed,

    // New — attempts (auto-push)
    buildAttemptPayload: buildAttemptPayload,
    makePushId: makePushId,
    pushAttempt: pushAttempt,
    pullAttempts: pullAttempts,
    markUsedBulk: markUsedBulk,
    archiveUsed: archiveUsed,
    getSyncStatus: getSyncStatus
  };
})();

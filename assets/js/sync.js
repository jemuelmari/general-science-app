/* ============================================================
   sync.js — Sync Code + JSON payload + backend bridge
   Version: 2.1.0
   Changelog v2.1.0: Added retake request wrappers:
     requestRetake, getStudentRequests, getUnlockRequests,
     approveRetake, cancelRequest, redeemUnlockCode.
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  function escapeNonAscii(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 128) out += str.charAt(i);
      else out += '\\u' + code.toString(16).padStart(4, '0');
    }
    return out;
  }

  function canonicalize(obj) {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number') {
      if (isNaN(obj) || !isFinite(obj)) return 'null';
      return String(obj);
    }
    if (typeof obj === 'boolean') return obj ? 'true' : 'false';
    if (typeof obj === 'string') {
      var jsonStr = JSON.stringify(obj);
      var inner = jsonStr.substring(1, jsonStr.length - 1);
      return '"' + escapeNonAscii(inner) + '"';
    }
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    if (typeof obj === 'object') {
      var keys = Object.keys(obj).filter(function (k) {
        if (k === 'signature') return false;
        return obj[k] !== undefined && typeof obj[k] !== 'function';
      });
      keys.sort();
      return '{' + keys.map(function (k) {
        return '"' + escapeNonAscii(k) + '":' + canonicalize(obj[k]);
      }).join(',') + '}';
    }
    return 'null';
  }

  function roundTrip(payload) {
    try { return JSON.parse(JSON.stringify(payload)); }
    catch (e) { return payload; }
  }

  async function signCanonical(payload) {
    if (typeof Security === 'undefined') throw new Error('Security module not loaded');
    if (typeof Security.signString !== 'function') throw new Error('Security.signString unavailable');
    return await Security.signString(canonicalize(roundTrip(payload)));
  }

  async function verifyCanonical(payload, signature) {
    if (typeof Security === 'undefined') throw new Error('Security module not loaded');
    var clean = roundTrip(payload);
    if (typeof Security.verifyString === 'function') {
      return await Security.verifyString(canonicalize(clean), signature);
    }
    if (typeof Security.verify === 'function') {
      return await Security.verify(clean, signature);
    }
    throw new Error('Security.verifyString unavailable');
  }

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

  function getTeacherToken() {
    try {
      var t = sessionStorage.getItem('gsa_teacher_token');
      if (t) return t;
      var session = sessionStorage.getItem('gsa_teacher_session');
      if (session) {
        var s = JSON.parse(session);
        if (s && s.token) return s.token;
      }
    } catch (e) {}
    return null;
  }

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
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '', gradeLevel: user.gradeLevel,
        section: user.section, sex: user.sex || ''
      },
      term: term || 'all',
      progress: term ? (function () { var o = {}; o[term] = progress[term]; return o; })() : progress,
      scores: term ? (function () { var o = {}; o[term] = scores[term]; return o; })() : scores,
      badges: term ? (function () { var o = {}; o[term] = badges[term]; return o; })() : badges
    };

    var signature = await signCanonical(payload);
    return { payload: payload, signature: signature };
  }

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
      var res = await backendPost({ action: 'registerSyncCode', code: code, lrn: lrn, payload: payload, signature: signature });
      if (res.ok) mode = 'backend';
      else throw new Error('Backend rejected sync code: ' + (res.error || 'unknown'));
    }

    _saveLocalCode(code, { payload: payload, signature: signature });

    return { code: code, payload: payload, signature: signature, mode: mode, createdAt: new Date().toISOString() };
  }

  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        var res = await backendPost({ action: 'resolveSyncCode', code: code });
        if (res.ok) return { payload: res.payload, signature: res.signature, source: 'backend', createdAt: res.createdAt };
      } catch (err) { console.warn('[Sync] Backend lookup failed:', err); }
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
    entries.sort(function (a, b) { return new Date(b[1].savedAt) - new Date(a[1].savedAt); });
    var trimmed = {};
    entries.slice(0, 10).forEach(function (pair) { trimmed[pair[0]] = pair[1]; });
    localStorage.setItem(NS + 'sync_codes', JSON.stringify(trimmed));
  }

  function _getLocalCode(code) {
    var codes = JSON.parse(localStorage.getItem(NS + 'sync_codes') || '{}');
    return codes[code] || null;
  }

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
          if (!envelope.payload || !envelope.signature) throw new Error('Missing payload or signature');
          var valid = await verifyCanonical(envelope.payload, envelope.signature);
          resolve({ payload: envelope.payload, signature: envelope.signature, valid: valid });
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('File read error')); };
      reader.readAsText(file);
    });
  }

  async function importFromCode(code) {
    var record = await lookupSyncCode(code);
    if (!record) {
      return { valid: false, error: backendEnabled() ? 'Code not found' : 'Code not found on this device.' };
    }
    var valid = await verifyCanonical(record.payload, record.signature);
    return { payload: record.payload, signature: record.signature, valid: valid, source: record.source };
  }

  async function pullAllPending(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      var body = { action: 'pullAllPending' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };
      return { ok: true, count: (res.records || []).length, records: res.records || [] };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function markCodeUsed(code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'deleteSyncCode', code: code }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try {
      var start = Date.now();
      var res = await backendGet({ action: 'ping' });
      return Object.assign({}, res, { ms: Date.now() - start });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  function buildAttemptPayload(lrn, term, assessment, attempt) {
    var user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');
    return {
      version: '2.0.0',
      student: { lrn: user.lrn, lastName: user.lastName, firstName: user.firstName, middleName: user.middleName || '', gradeLevel: user.gradeLevel, section: user.section },
      attempt: { term: term, assessment: assessment, score: attempt.score, total: attempt.total, itemResults: attempt.itemResults || [], set: attempt.set || '', timestamp: attempt.timestamp || new Date().toISOString() }
    };
  }

  function makePushId(lrn, term, assessment, timestamp) {
    var ts = timestamp ? new Date(timestamp).getTime() : Date.now();
    return lrn + '-' + term + '-' + assessment + '-' + ts;
  }

  async function pushAttempt(lrn, term, assessment, attempt) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured', offline: true };
    var payload = buildAttemptPayload(lrn, term, assessment, attempt);
    var signature = await signCanonical(payload);
    var pushId = makePushId(lrn, term, assessment, attempt.timestamp);

    try {
      var res = await backendPost({
        action: 'pushAttempt',
        pushId: pushId, lrn: lrn, term: term, assessment: assessment,
        score: attempt.score, total: attempt.total,
        itemResults: attempt.itemResults || [],
        set: attempt.set || '',
        clientTimestamp: attempt.timestamp || new Date().toISOString(),
        payload: payload, signature: signature
      });
      return Object.assign({ pushId: pushId }, res);
    } catch (err) { return { ok: false, error: err.message, pushId: pushId, offline: true }; }
  }

  async function pullAttempts(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      var body = { action: 'pullAttempts' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };
      var verified = [];
      for (var i = 0; i < (res.records || []).length; i++) {
        var r = res.records[i];
        var isValid = false;
        try { isValid = await verifyCanonical(r.payload, r.signature); } catch (e) { isValid = false; }
        var copy = {};
        Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
        copy.verified = isValid;
        verified.push(copy);
      }
      return { ok: true, count: verified.length, records: verified };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function markUsedBulk(pushIds, usedBy) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'markUsedBulk', pushIds: pushIds || [], usedBy: usedBy || 'teacher' }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function archiveUsed(opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({ action: 'archiveUsed', olderThanDays: opts && opts.olderThanDays, archivedBy: (opts && opts.archivedBy) || 'teacher' });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function getSyncStatus(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({ action: 'getSyncStatus', section: (filters && filters.section) || '' });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  /* ============================================================
     LOCK ACTIONS
     ============================================================ */

  async function pushLock(lrn, term, assessment, opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    opts = opts || {};
    try {
      return await backendPost({
        action: 'pushLock', lrn: lrn, term: term, assessment: assessment,
        reason: opts.reason || 'failed', score: opts.score || 0,
        lockedAt: opts.lockedAt || new Date().toISOString(),
        student: opts.student || {}
      });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function pullLocks(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      var body = { action: 'pullLocks' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };
      return { ok: true, count: (res.records || []).length, records: res.records || [] };
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function deleteLock(lockId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'deleteLock', lockId: lockId }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  /* ============================================================
     UNLOCK ACTIONS
     ============================================================ */

  async function pushUnlock(lrn, term, assessment, opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    opts = opts || {};
    try {
      return await backendPost({
        action: 'pushUnlock', token: getTeacherToken(),
        lrn: lrn, term: term, assessment: assessment,
        reason: opts.reason || 'retake-approved',
        unlockedBy: opts.unlockedBy || 'teacher',
        forceUnlock: !!opts.forceUnlock
      });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function pullUnlocks(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'pullUnlocks', lrn: lrn }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function markUnlockApplied(unlockId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'markUnlockApplied', unlockId: unlockId }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function revokeUnlock(unlockId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'revokeUnlock', token: getTeacherToken(), unlockId: unlockId }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function getAllUnlocks() {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'getAllUnlocks', token: getTeacherToken() }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function getUnlockStatus() {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'getUnlockStatus', token: getTeacherToken() }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  /* ============================================================
     REQUEST ACTIONS (NEW v2.1.0)
     ============================================================ */

  async function requestRetake(lrn, term, assessment, opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    opts = opts || {};
    var user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };
    try {
      return await backendPost({
        action: 'requestRetake',
        lrn: lrn,
        term: term,
        assessment: assessment,
        reason: opts.reason || 'failed-attempt',
        score: opts.score || 0,
        total: opts.total || 0,
        student: {
          lastName: user.lastName, firstName: user.firstName,
          middleName: user.middleName || '', section: user.section
        }
      });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function getStudentRequests(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try { return await backendPost({ action: 'getStudentRequests', lrn: lrn }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

  async function getUnlockRequests(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    filters = filters || {};
    try {
      return await backendPost({
        action: 'getUnlockRequests',
        token: getTeacherToken(),
        filterTerm: filters.term || '',
        filterSection: filters.section || ''
      });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function approveRetake(requestId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({ action: 'approveRetake', token: getTeacherToken(), requestId: requestId });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function cancelRequest(requestId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      return await backendPost({ action: 'cancelRequest', token: getTeacherToken(), requestId: requestId });
    } catch (err) { return { ok: false, error: err.message }; }
  }

  async function redeemUnlockCode(lrn, code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };
    try {
      var res = await backendPost({ action: 'redeemUnlockCode', lrn: lrn, code: code });
      if (res.ok && res.term && res.assessment) {
        var lockKey = res.term + '_' + res.assessment;
        Store.unlockAssessment(lrn, lockKey);
        console.log('[Sync] 🔓 Unlock applied via code:', lockKey);
      }
      return res;
    } catch (err) { return { ok: false, error: err.message }; }
  }

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
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  return {
    canonicalize: canonicalize,
    roundTrip: roundTrip,
    signCanonical: signCanonical,
    verifyCanonical: verifyCanonical,
    backendEnabled: backendEnabled,
    pingBackend: pingBackend,
    getTeacherToken: getTeacherToken,
    buildPayload: buildPayload,
    generateSyncCode: generateSyncCode,
    lookupSyncCode: lookupSyncCode,
    exportAsFile: exportAsFile,
    importFromFile: importFromFile,
    importFromCode: importFromCode,
    pullAllPending: pullAllPending,
    markCodeUsed: markCodeUsed,
    buildAttemptPayload: buildAttemptPayload,
    makePushId: makePushId,
    pushAttempt: pushAttempt,
    pullAttempts: pullAttempts,
    markUsedBulk: markUsedBulk,
    archiveUsed: archiveUsed,
    getSyncStatus: getSyncStatus,
    pushLock: pushLock,
    pullLocks: pullLocks,
    deleteLock: deleteLock,
    pushUnlock: pushUnlock,
    pullUnlocks: pullUnlocks,
    markUnlockApplied: markUnlockApplied,
    revokeUnlock: revokeUnlock,
    getAllUnlocks: getAllUnlocks,
    getUnlockStatus: getUnlockStatus,
    requestRetake: requestRetake,
    getStudentRequests: getStudentRequests,
    getUnlockRequests: getUnlockRequests,
    approveRetake: approveRetake,
    cancelRequest: cancelRequest,
    redeemUnlockCode: redeemUnlockCode
  };
})();

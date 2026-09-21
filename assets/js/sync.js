/* ============================================================
   sync.js — Sync Code + JSON payload + backend bridge
   Version: 2.0.3
   App: General Science · v1.0.2
   Changelog v2.0.3: signCanonical/verifyCanonical now JSON
   round-trip the payload BEFORE canonicalizing, so the signed
   string matches exactly what the backend receives after
   JSON.stringify/JSON.parse. Fixes persistent signature mismatches.
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gsa_v1_';

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
   * Round-trip through JSON so the payload we sign matches what
   * the backend will receive after its own JSON.parse().
   */
  function roundTrip(payload) {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (e) {
      return payload;
    }
  }

  async function signCanonical(payload) {
    if (typeof Security === 'undefined') {
      throw new Error('Security module not loaded — cannot sign payload');
    }
    if (typeof Security.signString !== 'function') {
      throw new Error('Security.signString unavailable — reload the page');
    }
    var clean = roundTrip(payload);
    var canonical = canonicalize(clean);
    return await Security.signString(canonical);
  }

  async function verifyCanonical(payload, signature) {
    if (typeof Security === 'undefined') {
      throw new Error('Security module not loaded');
    }
    var clean = roundTrip(payload);
    if (typeof Security.verifyString === 'function') {
      var canonical = canonicalize(clean);
      return await Security.verifyString(canonical, signature);
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
      var res = await backendPost({
        action: 'registerSyncCode',
        code: code, lrn: lrn, payload: payload, signature: signature
      });
      if (res.ok) {
        mode = 'backend';
      } else {
        throw new Error('Backend rejected sync code: ' + (res.error || 'unknown'));
      }
    }

    _saveLocalCode(code, { payload: payload, signature: signature });

    return {
      code: code, payload: payload, signature: signature,
      mode: mode, createdAt: new Date().toISOString()
    };
  }

  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        var res = await backendPost({ action: 'resolveSyncCode', code: code });
        if (res.ok) {
          return { payload: res.payload, signature: res.signature, source: 'backend', createdAt: res.createdAt };
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
          var payload = envelope.payload;
          var signature = envelope.signature;
          if (!payload || !signature) throw new Error('Missing payload or signature');
          var valid = await verifyCanonical(payload, signature);
          resolve({ payload: payload, signature: signature, valid: valid });
        } catch (err) { reject(err); }
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
          : 'Code not found on this device.'
      };
    }
    var valid = await verifyCanonical(record.payload, record.signature);
    return {
      payload: record.payload, signature: record.signature,
      valid: valid, source: record.source
    };
  }

  async function pullAllPending(filters) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      var body = { action: 'pullAllPending' };
      Object.keys(filters || {}).forEach(function (k) { body[k] = filters[k]; });
      var res = await backendPost(body);
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };
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

  function buildAttemptPayload(lrn, term, assessment, attempt) {
    var user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');
    return {
      version: '2.0.0',
      student: {
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel, section: user.section
      },
      attempt: {
        term: term, assessment: assessment,
        score: attempt.score, total: attempt.total,
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
        pushId: pushId, lrn: lrn, term: term, assessment: assessment,
        score: attempt.score, total: attempt.total,
        itemResults: attempt.itemResults || [],
        set: attempt.set || '',
        clientTimestamp: attempt.timestamp || new Date().toISOString(),
        payload: payload, signature: signature
      });
      return Object.assign({ pushId: pushId }, res);
    } catch (err) {
      return { ok: false, error: err.message, pushId: pushId, offline: true };
    }
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

  return {
    canonicalize: canonicalize,
    roundTrip: roundTrip,
    signCanonical: signCanonical,
    verifyCanonical: verifyCanonical,
    backendEnabled: backendEnabled,
    pingBackend: pingBackend,
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
    getSyncStatus: getSyncStatus
  };
})();

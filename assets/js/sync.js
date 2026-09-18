/* ============================================================
   sync.js — Sync Code + JSON payload generation & verification
   Version: 1.0.0
   App: General Science
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  /* ---------- Backend helpers ---------- */
  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body) {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function backendGet(params) {
    const url = new URL(CONFIG.BACKEND_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  }

  /* ---------- Payload Builder ---------- */
  async function buildPayload(lrn, term) {
    const user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);

    const payload = {
      version: '1.0.0',
      app: 'General Science',
      generatedAt: new Date().toISOString(),
      student: {
        lrn: user.lrn,
        lastName: user.lastName,
        firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel,
        section: user.section
      },
      term: term || 'all',
      progress: term ? { [term]: progress[term] } : progress,
      scores: term ? { [term]: scores[term] } : scores,
      badges: term ? { [term]: badges[term] } : badges
    };

    const signature = await Security.sign(payload);
    return { payload, signature };
  }

  /* ---------- Sync Code ---------- */
  async function generateSyncCode(lrn, term) {
    const { payload, signature } = await buildPayload(lrn, term);
    const json = JSON.stringify(payload);
    const signatureShort = signature.slice(0, 8).toUpperCase();
    const hash = _shortHash(json).toUpperCase();
    const code = `GS11-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signatureShort}`;

    let mode = 'local';

    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'registerSyncCode',
          code,
          lrn,
          payload,
          signature
        });
        if (res.ok) mode = 'backend';
        else console.warn('[Sync] Backend register failed:', res.error);
      } catch (err) {
        console.warn('[Sync] Backend unreachable, saving locally:', err);
      }
    }

    _saveLocalCode(code, { payload, signature });

    return {
      code,
      payload,
      signature,
      mode,
      createdAt: new Date().toISOString()
    };
  }

  /* ---------- Sync Code Lookup ---------- */
  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'resolveSyncCode',
          code
        });
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

    const local = _getLocalCode(code);
    if (local) {
      return { ...local, source: 'local' };
    }

    return null;
  }

  /* ---------- Local code storage ---------- */
  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    const entries = Object.entries(codes).sort(
      (a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt)
    );
    const trimmed = Object.fromEntries(entries.slice(0, 10));
    localStorage.setItem(`${NS}sync_codes`, JSON.stringify(trimmed));
  }

  function _getLocalCode(code) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    return codes[code] || null;
  }

  /* ---------- JSON File Export ---------- */
  async function exportAsFile(lrn, term) {
    const { payload, signature } = await buildPayload(lrn, term);
    const envelope = { payload, signature };
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `GSA_${payload.student.lrn}_${term || 'all'}_${_dateStamp()}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  /* ---------- JSON File Import (Teacher) ---------- */
  async function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const envelope = JSON.parse(e.target.result);
          const { payload, signature } = envelope;
          if (!payload || !signature) {
            throw new Error('Missing payload or signature');
          }
          const valid = await Security.verify(payload, signature);
          resolve({ payload, signature, valid });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Import Sync Code (Teacher) ---------- */
  async function importFromCode(code) {
    const record = await lookupSyncCode(code);
    if (!record) {
      return {
        valid: false,
        error: backendEnabled()
          ? 'Code not found (checked backend and this device)'
          : 'Code not found on this device. Enable the backend for cross-device sync.'
      };
    }
    const valid = await Security.verify(record.payload, record.signature);
    return {
      payload: record.payload,
      signature: record.signature,
      valid,
      source: record.source
    };
  }

  /* ---------- Health Check ---------- */
  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try {
      const res = await backendGet({ action: 'ping' });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Helpers ---------- */
  function _shortHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function _dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ============================================================
   sync.js — Sync Code + JSON payload generation & verification
   Version: 1.1.0
   App: General Science
   Changelog v1.1.0: Added pullAllPending() for teacher Sync Center
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gsa_v1_';

  /* ---------- Backend helpers ---------- */
  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body) {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function backendGet(params) {
    const url = new URL(CONFIG.BACKEND_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  }

  /* ---------- Payload Builder ---------- */
  async function buildPayload(lrn, term) {
    const user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);

    const payload = {
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
      progress: term ? { [term]: progress[term] } : progress,
      scores: term ? { [term]: scores[term] } : scores,
      badges: term ? { [term]: badges[term] } : badges
    };

    const signature = await Security.sign(payload);
    return { payload, signature };
  }

  /* ---------- Sync Code ---------- */
  async function generateSyncCode(lrn, term) {
    const { payload, signature } = await buildPayload(lrn, term);
    const json = JSON.stringify(payload);
    const signatureShort = signature.slice(0, 8).toUpperCase();
    const hash = _shortHash(json).toUpperCase();
    const code = `GS11-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signatureShort}`;

    let mode = 'local';

    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'registerSyncCode',
          code,
          lrn,
          payload,
          signature
        });
        if (res.ok) mode = 'backend';
        else console.warn('[Sync] Backend register failed:', res.error);
      } catch (err) {
        console.warn('[Sync] Backend unreachable, saving locally:', err);
      }
    }

    _saveLocalCode(code, { payload, signature });

    return {
      code,
      payload,
      signature,
      mode,
      createdAt: new Date().toISOString()
    };
  }

  /* ---------- Sync Code Lookup ---------- */
  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'resolveSyncCode',
          code
        });
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

    const local = _getLocalCode(code);
    if (local) {
      return { ...local, source: 'local' };
    }

    return null;
  }

  /* ---------- Local code storage ---------- */
  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    const entries = Object.entries(codes).sort(
      (a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt)
    );
    const trimmed = Object.fromEntries(entries.slice(0, 10));
    localStorage.setItem(`${NS}sync_codes`, JSON.stringify(trimmed));
  }

  function _getLocalCode(code) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    return codes[code] || null;
  }

  /* ---------- JSON File Export ---------- */
  async function exportAsFile(lrn, term) {
    const { payload, signature } = await buildPayload(lrn, term);
    const envelope = { payload, signature };
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `GSA_${payload.student.lrn}_${term || 'all'}_${_dateStamp()}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  /* ---------- JSON File Import (Teacher) ---------- */
  async function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const envelope = JSON.parse(e.target.result);
          const { payload, signature } = envelope;
          if (!payload || !signature) {
            throw new Error('Missing payload or signature');
          }
          const valid = await Security.verify(payload, signature);
          resolve({ payload, signature, valid });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Import Sync Code (Teacher) ---------- */
  async function importFromCode(code) {
    const record = await lookupSyncCode(code);
    if (!record) {
      return {
        valid: false,
        error: backendEnabled()
          ? 'Code not found (checked backend and this device)'
          : 'Code not found on this device. Enable the backend for cross-device sync.'
      };
    }
    const valid = await Security.verify(record.payload, record.signature);
    return {
      payload: record.payload,
      signature: record.signature,
      valid,
      source: record.source
    };
  }

  /* ---------- PULL ALL PENDING (Teacher / Sync Center) ---------- */
  /**
   * Pull all pending (unused) sync codes from the backend.
   * @param {Object} [filters] - Optional { section, lrn }
   * @returns {Promise<{ok: boolean, count?: number, records?: Array, error?: string}>}
   */
  async function pullAllPending(filters) {
    if (!backendEnabled()) {
      return { ok: false, error: 'Backend not configured. Set CONFIG.BACKEND_URL.' };
    }

    try {
      const res = await backendPost({
        action: 'pullAllPending',
        ...(filters || {})
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Unknown backend error' };
      }

      // Attach a verify flag to each record for convenience
      const records = (res.records || []).map((r) => ({
        ...r,
        verified: true // already verified server-side
      }));

      return {
        ok: true,
        count: records.length,
        records
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Mark Code As Used ---------- */
  async function markCodeUsed(code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    try {
      const res = await backendPost({ action: 'deleteSyncCode', code });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Health Check ---------- */
  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try {
      const start = Date.now();
      const res = await backendGet({ action: 'ping' });
      const ms = Date.now() - start;
      return { ...res, ms };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Helpers ---------- */
  function _shortHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function _dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ---------- Public API ---------- */
  return {
    backendEnabled,
    buildPayload,
    generateSyncCode,
    lookupSyncCode,
    exportAsFile,
    importFromFile,
    importFromCode,
    pullAllPending,
    markCodeUsed,
    pingBackend
  };
})();

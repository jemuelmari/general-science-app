/* ============================================================
   term-access.js — Teacher-controlled term access per section
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   RULES:
   - Access is stored PER SECTION (ACADEMIC A, ACADEMIC B)
   - Default: everything LOCKED until teacher opens it
   - Teacher override FORCES OPEN even if progress is incomplete
   - When a term is locked, students see read-only progress
   - Works locally (localStorage); syncs to backend if enabled
   ============================================================ */

const TermAccess = (() => {
  'use strict';

  const NS = 'gsa_v1_';
  const LOCAL_KEY = `${NS}term_access`;
  const CACHE_TTL_MS = 60000; // 60s cache for backend responses

  /* ============================================================
     DEFAULTS
     ============================================================ */
  const DEFAULT_ACCESS = {
    term1: 'locked',
    term2: 'locked',
    term3: 'locked'
  };

  /* ============================================================
     LOCAL STORAGE (structure: { 'ACADEMIC A': {...}, 'ACADEMIC B': {...} })
     ============================================================ */
  function _getLocalAll() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function _setLocalAll(obj) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(obj));
    } catch (e) {
      console.error('[TermAccess] Failed to save local state', e);
    }
  }

  /* ============================================================
     GET ACCESS FOR A SECTION
     - Returns { term1: 'open'|'locked', term2, term3 }
     - If no local/backend record exists → all LOCKED (default)
     ============================================================ */
  function getLocal(section) {
    const all = _getLocalAll();
    const record = all[section];
    if (!record) return { ...DEFAULT_ACCESS };
    return {
      term1: record.term1 === 'open' ? 'open' : 'locked',
      term2: record.term2 === 'open' ? 'open' : 'locked',
      term3: record.term3 === 'open' ? 'open' : 'locked'
    };
  }

  function setLocal(section, access) {
    const all = _getLocalAll();
    all[section] = {
      term1: access.term1 === 'open' ? 'open' : 'locked',
      term2: access.term2 === 'open' ? 'open' : 'locked',
      term3: access.term3 === 'open' ? 'open' : 'locked',
      updatedAt: new Date().toISOString()
    };
    _setLocalAll(all);
  }

  /* ============================================================
     GET ACCESS (async — tries backend first if enabled, falls back to local)
     ============================================================ */
  async function get(section) {
    // No backend → local only
    if (typeof Sync === 'undefined' || !Sync.backendEnabled()) {
      return getLocal(section);
    }

    // Check cache
    const cacheKey = `${NS}term_access_cache_${section}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.at < CACHE_TTL_MS) {
          return parsed.data;
        }
      }
    } catch (e) { /* ignore */ }

    // Fetch from backend
    try {
      const res = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getTermAccess', section })
      });
      const data = await res.json();

      if (data.ok && data.access) {
        // Cache it
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            at: Date.now(),
            data: data.access
          }));
        } catch (e) { /* ignore */ }

        // Also mirror to local for offline fallback
        setLocal(section, data.access);

        return data.access;
      }
    } catch (err) {
      console.warn('[TermAccess] Backend fetch failed, using local:', err);
    }

    // Fallback
    return getLocal(section);
  }

  /* ============================================================
     SET ACCESS (async — writes to local + backend if enabled)
     ============================================================ */
  async function set(section, access) {
    // Always write locally first
    setLocal(section, access);

    // Invalidate cache
    try {
      sessionStorage.removeItem(`${NS}term_access_cache_${section}`);
    } catch (e) { /* ignore */ }

    // Sync to backend if enabled
    if (typeof Sync === 'undefined' || !Sync.backendEnabled()) {
      return { ok: true, mode: 'local' };
    }

    try {
      const res = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'setTermAccess',
          section,
          access
        })
      });
      const data = await res.json();
      if (data.ok) {
        return { ok: true, mode: 'backend' };
      }
      return { ok: false, mode: 'backend', error: data.error };
    } catch (err) {
      console.warn('[TermAccess] Backend write failed, saved locally:', err);
      return { ok: true, mode: 'local-only', warning: err.message };
    }
  }

  /* ============================================================
     GET ALL SECTIONS (async — for teacher page)
     ============================================================ */
  async function getAll(sections) {
    const list = sections || (CONFIG && CONFIG.SECTIONS) || ['ACADEMIC A', 'ACADEMIC B'];
    const result = {};

    // Start with local
    list.forEach((sec) => {
      result[sec] = getLocal(sec);
    });

    // If backend enabled, try to fetch all at once
    if (typeof Sync !== 'undefined' && Sync.backendEnabled()) {
      try {
        const res = await fetch(CONFIG.BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'getTermAccess' })
        });
        const data = await res.json();

        if (data.ok && data.all) {
          list.forEach((sec) => {
            if (data.all[sec]) {
              result[sec] = data.all[sec];
              setLocal(sec, data.all[sec]);
            }
          });
        }
      } catch (err) {
        console.warn('[TermAccess] getAll backend failed, using local:', err);
      }
    }

    return result;
  }

  /* ============================================================
     CONVENIENCE: check if a specific term is open for a section
     ============================================================ */
  async function isOpen(section, term) {
    const access = await get(section);
    return access[term] === 'open';
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    get,
    set,
    getAll,
    isOpen,
    getLocal,
    setLocal,
    DEFAULT_ACCESS
  };
})();

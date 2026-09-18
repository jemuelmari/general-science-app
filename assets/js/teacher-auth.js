/* ============================================================
   teacher-auth-v2.js — Teacher password authentication
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Features:
   - SHA-256 password hashing (Web Crypto API)
   - Session-based auth (survives refresh, ends on tab close)
   - Rate limiting (3 attempts → 5-minute lockout)
   - Session timeout (30 min of inactivity)
   - Safe logout with confirmation
   - Cross-page auth check via TeacherAuth.require()
   ============================================================ */

const TeacherAuth = (() => {
  'use strict';

  const SESSION_KEY = 'gsa_teacher_session';
  const ATTEMPTS_KEY = 'gsa_teacher_attempts';
  const LOCKOUT_KEY = 'gsa_teacher_lockout';
  const LAST_ACTIVITY_KEY = 'gsa_teacher_last_activity';

  let heartbeatInterval = null;

  /* ============================================================
     INIT — call once per page that requires auth
     ============================================================ */
  function init() {
    // Setup session timeout heartbeat
    if (isAuthenticated()) {
      startHeartbeat();
      trackActivity();
    }

    // Handle storage events (logout in another tab)
    window.addEventListener('storage', (e) => {
      if (e.key === SESSION_KEY && !e.newValue) {
        // Logged out elsewhere
        window.location.replace('teacher-login.html');
      }
    });
  }

  /* ============================================================
     PASSWORD HASHING
     ============================================================ */
  async function hash(password) {
    const enc = new TextEncoder();
    const data = enc.encode(String(password));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /* ============================================================
     LOGIN
     ============================================================ */
  async function login(password) {
    if (isLockedOut()) {
      throw new Error('Too many attempts. Account is temporarily locked.');
    }

    const inputHash = await hash(password);

    // Get stored hash from config, or use default "teacher2026" hash
    const storedHash = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_PASSWORD_HASH)
      ? CONFIG.TEACHER_PASSWORD_HASH
      : '63a9f0ea7bb98050796b649e85481845'; // fallback hash of "teacher2026"

    if (inputHash === storedHash) {
      // Success — clear attempts and set session
      clearAttempts();
      clearLockout();
      setSession();
      startHeartbeat();
      trackActivity();
      return true;
    }

    // Failure — increment attempts
    incrementAttempts();

    // Check if this failure triggers lockout
    const attempts = getAttempts();
    if (attempts >= (CONFIG?.TEACHER_MAX_ATTEMPTS || 3)) {
      setLockout(CONFIG?.TEACHER_LOCKOUT_TIME || (5 * 60 * 1000));
    }

    return false;
  }

  /* ============================================================
     SESSION
     ============================================================ */
  function setSession() {
    const session = {
      authenticatedAt: Date.now(),
      lastActivity: Date.now(),
      // simple token (not cryptographic — session is local)
      token: Math.random().toString(36).slice(2) + Date.now().toString(36)
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function isAuthenticated() {
    const session = getSession();
    if (!session) return false;

    // Check session timeout
    const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || session.lastActivity);
    const timeout = CONFIG?.TEACHER_SESSION_TIMEOUT || (30 * 60 * 1000);
    const elapsed = Date.now() - lastActivity;

    if (elapsed > timeout) {
      clearSession();
      return false;
    }

    return true;
  }

  function trackActivity() {
    // Update last activity on user interaction
    const update = () => {
      if (isAuthenticated()) {
        sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      }
    };
    ['click', 'keydown', 'mousemove', 'scroll'].forEach((evt) => {
      document.addEventListener(evt, update, { passive: true });
    });
  }

  function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    heartbeatInterval = setInterval(() => {
      if (!isAuthenticated()) {
        stopHeartbeat();
        APP.toast('⏰ Session expired. Please log in again.', 'warning', 4000);
        setTimeout(() => {
          window.location.replace('teacher-login.html');
        }, 1500);
      }
    }, 60000); // check every minute
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    stopHeartbeat();
  }

  /* ============================================================
     LOGOUT
     ============================================================ */
  function logout() {
    if (!confirm('Log out of teacher access? You will need to enter the password again.')) {
      return false;
    }
    clearSession();
    window.location.replace('teacher-login.html');
    return true;
  }

  /* ============================================================
     REQUIRE AUTH (page guard)
     ============================================================ */
  function require() {
    if (!isAuthenticated()) {
      const here = window.location.pathname.split('/').pop();
      window.location.replace(`teacher-login.html?next=${encodeURIComponent(here)}`);
      return false;
    }
    return true;
  }

  /* ============================================================
     ATTEMPTS TRACKING
     ============================================================ */
  function getAttempts() {
    return Number(localStorage.getItem(ATTEMPTS_KEY) || 0);
  }

  function incrementAttempts() {
    const n = getAttempts() + 1;
    localStorage.setItem(ATTEMPTS_KEY, String(n));
    return n;
  }

  function clearAttempts() {
    localStorage.removeItem(ATTEMPTS_KEY);
  }

  function getAttemptsLeft() {
    const max = CONFIG?.TEACHER_MAX_ATTEMPTS || 3;
    return Math.max(0, max - getAttempts());
  }

  /* ============================================================
     LOCKOUT
     ============================================================ */
  function setLockout(durationMs) {
    const until = Date.now() + durationMs;
    localStorage.setItem(LOCKOUT_KEY, String(until));
  }

  function getLockout() {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    if (!raw) return null;
    const until = Number(raw);
    if (isNaN(until) || Date.now() >= until) {
      localStorage.removeItem(LOCKOUT_KEY);
      clearAttempts();
      return null;
    }
    return { until, remainingMs: until - Date.now() };
  }

  function isLockedOut() {
    return getLockout() !== null;
  }

  function clearLockout() {
    localStorage.removeItem(LOCKOUT_KEY);
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    init,
    hash,
    login,
    logout,
    require,
    isAuthenticated,
    getSession,
    clearSession,
    // For debugging
    _getAttempts: getAttempts,
    _getLockout: getLockout,
    getAttemptsLeft,
    isLockedOut
  };
})();
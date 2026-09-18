/* ============================================================
   teacher-auth.js — Teacher password authentication
   Version: 1.4.0
   App: General Science
   ============================================================ */

const TeacherAuth = (() => {
  'use strict';

  const SESSION_KEY = 'gsa_teacher_session';
  const ATTEMPTS_KEY = 'gsa_teacher_attempts';
  const LOCKOUT_KEY = 'gsa_teacher_lockout';
  const LAST_ACTIVITY_KEY = 'gsa_teacher_last_activity';

  // SHA-256 hash of "teacher2026"
  const DEFAULT_HASH = '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e';

  let heartbeatInterval = null;

  function init() {
    if (isAuthenticated()) {
      startHeartbeat();
      trackActivity();
    }
    window.addEventListener('storage', (e) => {
      if (e.key === SESSION_KEY && !e.newValue) {
        window.location.replace(loginUrl());
      }
    });
  }

  async function hash(password) {
    const enc = new TextEncoder();
    const data = enc.encode(String(password));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function login(password) {
    if (isLockedOut()) {
      throw new Error('Too many attempts. Account is temporarily locked.');
    }
    const inputHash = await hash(password);
    const storedHash = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_PASSWORD_HASH)
      ? CONFIG.TEACHER_PASSWORD_HASH
      : DEFAULT_HASH;

    if (inputHash === storedHash) {
      clearAttempts();
      clearLockout();
      setSession();
      startHeartbeat();
      trackActivity();
      return true;
    }
    incrementAttempts();
    const attempts = getAttempts();
    const maxAttempts = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_MAX_ATTEMPTS) || 3;
    if (attempts >= maxAttempts) {
      const lockTime = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_LOCKOUT_TIME) || (5 * 60 * 1000);
      setLockout(lockTime);
    }
    return false;
  }

  function setSession() {
    const session = {
      authenticatedAt: Date.now(),
      lastActivity: Date.now(),
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
    const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || session.lastActivity);
    const timeout = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_SESSION_TIMEOUT) || (30 * 60 * 1000);
    if (Date.now() - lastActivity > timeout) {
      clearSession();
      return false;
    }
    return true;
  }

  function trackActivity() {
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
        setTimeout(() => { window.location.replace(loginUrl()); }, 1500);
      }
    }, 60000);
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

  function logout() {
    if (!confirm('Log out of teacher access? You will need to enter the password again.')) {
      return false;
    }
    clearSession();
    window.location.replace(loginUrl());
    return true;
  }

  function loginUrl() {
    const path = window.location.pathname;
    if (path.includes('/teacher/') || path.includes('/classrecord/')) {
      return '../teacher-login.html';
    }
    return 'teacher-login.html';
  }

  function require() {
    if (!isAuthenticated()) {
      const here = window.location.pathname.split('/').pop();
      window.location.replace(loginUrl() + '?next=' + encodeURIComponent(here));
      return false;
    }
    return true;
  }

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
    const max = (typeof CONFIG !== 'undefined' && CONFIG.TEACHER_MAX_ATTEMPTS) || 3;
    return Math.max(0, max - getAttempts());
  }

  function setLockout(durationMs) {
    localStorage.setItem(LOCKOUT_KEY, String(Date.now() + durationMs));
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
    return { until: until, remainingMs: until - Date.now() };
  }

  function isLockedOut() {
    return getLockout() !== null;
  }

  function clearLockout() {
    localStorage.removeItem(LOCKOUT_KEY);
  }

  return {
    init: init,
    hash: hash,
    login: login,
    logout: logout,
    require: require,
    isAuthenticated: isAuthenticated,
    getSession: getSession,
    clearSession: clearSession,
    getAttempts: getAttempts,
    getAttemptsLeft: getAttemptsLeft,
    getLockout: getLockout,
    isLockedOut: isLockedOut,
    clearAttempts: clearAttempts,
    clearLockout: clearLockout
  };
})();

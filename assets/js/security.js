/* ============================================================
   security.js — HMAC-SHA256 signing + anti-cheat hooks
   Version: 1.0.3 (Canonical signing fix)
   App: General Science
   ============================================================ */

const Security = (() => {
  'use strict';

  const SECRET = 'GSA-2026-DEPED-SECRET-KEY-v1';

  async function _getKey() {
    const enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  function _bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function signString(rawString) {
    const key = await _getKey();
    const enc = new TextEncoder();
    const str = String(rawString == null ? '' : rawString);
    const data = enc.encode(str);
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bufToHex(sig);
  }

  async function verifyString(rawString, signature) {
    const expected = await signString(rawString);
    return expected === signature;
  }

  // ============================================================
  // CANONICALIZE — dapat parehas sa sync.js at Code.gs
  // ============================================================
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

  // ============================================================
  // SIGN & VERIFY — gamit ang canonicalize (tugma sa Code.gs)
  // ============================================================
  async function sign(payload) {
    const key = await _getKey();
    const enc = new TextEncoder();
    // GAMITIN ANG CANONICALIZE IMBES NA JSON.stringify
    const canonical = (typeof Sync !== 'undefined' && Sync.canonicalize)
      ? Sync.canonicalize(payload)
      : canonicalize(payload);
    const data = enc.encode(canonical);
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bufToHex(sig);
  }

  async function verify(payload, signature) {
    const expected = await sign(payload);
    // Constant-time comparison
    if (typeof expected !== 'string' || typeof signature !== 'string') return false;
    if (expected.length !== signature.length) return false;
    var diff = 0;
    for (var i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }

  function startTabMonitor(onViolation, threshold = 3) {
    let count = 0;
    let active = true;

    const handler = () => {
      if (!active) return;
      if (document.hidden) {
        count++;
        onViolation?.(count);
        if (count >= threshold) {
          stopTabMonitor();
          onViolation?.(count, true);
        }
      }
    };

    document.addEventListener('visibilitychange', handler);
    window.addEventListener('blur', handler);

    function stopTabMonitor() {
      active = false;
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('blur', handler);
    }

    return { stop: stopTabMonitor, getCount: () => count };
  }

  function disableCopyPaste(rootEl = document) {
    const block = (e) => {
      e.preventDefault();
      if (window.APP?.toast) {
        APP.toast('Copying is disabled during assessments.', 'warning', 2000);
      }
      return false;
    };
    rootEl.addEventListener('copy', block);
    rootEl.addEventListener('cut', block);
    rootEl.addEventListener('paste', block);
    rootEl.addEventListener('contextmenu', block);
  }

  function disableDevShortcuts() {
    document.addEventListener('keydown', (e) => {
      const blocked = ['c', 'v', 'x', 'a', 'p', 's', 'u'];
      if ((e.ctrlKey || e.metaKey) && blocked.includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      if (
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))
      ) {
        e.preventDefault();
      }
    });
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function shuffleQuestions(questions) {
    return shuffle(questions).map((q) => ({
      ...q,
      options: shuffle(q.options || [])
    }));
  }

  function createTimer(seconds, onTick, onExpire) {
    let remaining = seconds;
    const interval = setInterval(() => {
      remaining--;
      onTick?.(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return {
      stop: () => clearInterval(interval),
      getRemaining: () => remaining
    };
  }

  return {
    signString,
    verifyString,
    sign,
    verify,
    canonicalize,
    roundTrip,
    startTabMonitor,
    disableCopyPaste,
    disableDevShortcuts,
    shuffle,
    shuffleQuestions,
    createTimer
  };
})();

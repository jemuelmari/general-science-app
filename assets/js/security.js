/* ============================================================
   security.js — HMAC-SHA256 signing + anti-cheat hooks
   Version: 1.0.2
   App: General Science
   Changelog:
     v1.0.2: Exposed SECRET for debugging; signString now handles
             empty/undefined input gracefully.
     v1.0.1: Added signString()/verifyString() for canonical JSON.
     v1.0.0: Initial.
   ============================================================ */

const Security = (() => {
  'use strict';

  // v1: client-side secret (must match Code.gs HMAC_SECRET)
  const SECRET = 'GSA-2026-DEPED-SECRET-KEY-v1';

  /* ---------- HMAC-SHA256 ---------- */
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

  /* ---------- Raw-string signing (matches backend canonicalize) ---------- */
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

  /* ---------- Legacy: object signing (non-canonical) ---------- */
  async function sign(payload) {
    const key = await _getKey();
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bufToHex(sig);
  }

  async function verify(payload, signature) {
    const expected = await sign(payload);
    return expected === signature;
  }

  /* ---------- Anti-Cheat: Tab-Switch Detection ---------- */
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

  /* ---------- Anti-Cheat: Copy/Paste/Cut Disable ---------- */
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

  /* ---------- Anti-Cheat: Keyboard shortcuts ---------- */
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

  /* ---------- Question + Option Shuffle (legacy) ---------- */
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

  /* ---------- Timer ---------- */
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

  /* ---------- Public API ---------- */
  return {
    signString,
    verifyString,
    sign,
    verify,
    startTabMonitor,
    disableCopyPaste,
    disableDevShortcuts,
    shuffle,
    shuffleQuestions,
    createTimer
  };
})();

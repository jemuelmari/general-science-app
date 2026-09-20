/* ============================================================
   security.js — HMAC-SHA256 signing + anti-cheat hooks
   Version: 1.1.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.1.0 (Phase 2 / X5 + X39 fix):
     - shuffleQuestions() now preserves `originalIndex` on each
       question. This fixes the mapping bug that broke item
       analysis and TOS competency lookup.
     - Delegates shuffle to Randomize when available (deterministic
       by assessmentId + setLetter). Falls back to Fisher-Yates
       with a warning if Randomize is missing.
     - verify() uses constant-time comparison (timing attack fix).

   ⚠️ SECURITY NOTE: The SECRET below is client-side. It provides
   INTEGRITY (tamper detection) but NOT AUTHENTICITY, because
   anyone can read it in DevTools. Move to server-side HMAC in v2.
   ============================================================ */

const Security = (() => {
  'use strict';

  // v1: client-side secret (move to Apps Script backend in v2)
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

  async function sign(payload) {
    const key = await _getKey();
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bufToHex(sig);
  }

  /**
   * Constant-time string comparison to avoid timing attacks.
   * Always compares the full length, regardless of early mismatches.
   */
  function _constantTimeEqual(a, b) {
    const sa = String(a == null ? '' : a);
    const sb = String(b == null ? '' : b);
    if (sa.length !== sb.length) {
      // Still iterate to keep timing similar; result will be false.
      let diff = 1;
      const len = Math.max(sa.length, sb.length);
      for (let i = 0; i < len; i++) {
        diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
      }
      return false;
    }
    let diff = 0;
    for (let i = 0; i < sa.length; i++) {
      diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
    }
    return diff === 0;
  }

  async function verify(payload, signature) {
    const expected = await sign(payload);
    return _constantTimeEqual(expected, signature);
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
          onViolation?.(count, true); // final
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
      // Ctrl/Cmd + C, V, X, A, P, S, U
      const blocked = ['c', 'v', 'x', 'a', 'p', 's', 'u'];
      if ((e.ctrlKey || e.metaKey) && blocked.includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      // F12, Ctrl+Shift+I/J/C
      if (
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))
      ) {
        e.preventDefault();
      }
    });
  }

  /* ---------- Shuffle (fallback if Randomize missing) ---------- */
  function _fallbackShuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Shuffle a set of questions while preserving `originalIndex`.
   *
   * ⚠️ FIX (X39): Each returned question carries `originalIndex`,
   * so item analysis can map back to the master question bank
   * (and thus look up its competency + bloom level) regardless of
   * the shuffled position the student saw.
   *
   * ⚠️ X5 partial: Delegates to Randomize if available, so
   * Set A / Set B are deterministic and identical across devices.
   *
   * @param {Array} questions - array of question objects
   * @param {Object} [opts] - { assessmentId, setLetter }
   * @returns {Array} shuffled questions with originalIndex + shuffled options
   */
  function shuffleQuestions(questions, opts) {
    const list = Array.isArray(questions) ? questions : [];
    const options = opts || {};

    // Snapshot originals with originalIndex
    const withIndex = list.map((q, i) => ({
      ...q,
      originalIndex: q.originalIndex != null ? q.originalIndex : i
    }));

    // Deterministic path — uses Randomize if loaded
    if (
      typeof Randomize !== 'undefined' &&
      typeof Randomize.generateSet === 'function' &&
      options.assessmentId
    ) {
      const bank = { questions: list };
      const setLetter = options.setLetter || 'A';
      const set = Randomize.generateSet(bank, options.assessmentId, setLetter);
      // Randomize already returns originalIndex + shuffled options
      return set.questions;
    }

    // Fallback — nondeterministic Fisher-Yates, but still preserves originalIndex
    if (typeof Randomize === 'undefined') {
      console.warn('[Security] Randomize not loaded — using nondeterministic shuffle. ' +
        'Item analysis across sets will still work via originalIndex.');
    }
    const shuffled = _fallbackShuffle(withIndex);

    // Also shuffle each question's options
    return shuffled.map((q) => {
      const opts2 = Array.isArray(q.options) ? _fallbackShuffle(q.options) : q.options;
      return { ...q, options: opts2 };
    });
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
    sign,
    verify,
    startTabMonitor,
    disableCopyPaste,
    disableDevShortcuts,
    shuffle: _fallbackShuffle,
    shuffleQuestions,
    createTimer
  };
})();

/* ============================================================
   activity-gate.js — Simple per-day activity gate
   Version: 2.1.0
   App: General Science
   ------------------------------------------------------------
   Changelog v2.1.0 (Phase 2.7 / X46 fix):
     - Session restore logic: "running" and "failed" states now
       reset to "ready" on page reload. Only "passed" persists.
       This fixes the bug where a stuck "running" state prevented
       the activity from ever rendering.
     - render(): when status === 'running' but container is empty,
       re-dispatches activity:start to trigger lesson-engine render.
       Defensive fix for race conditions.

   Changelog v2.0.1: Re-detect visible container at every render.
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const KEY_PREFIX = 'gsa_gate_v2_';
  const PASS_THRESHOLD = 0.75;

  let session = null;

  /* ============================================================
     INIT
     ============================================================ */
  function init(config) {
    session = {
      key: `${KEY_PREFIX}${config.term}_w${config.week}_d${config.day}`,
      term: config.term,
      week: config.week,
      day: config.day,
      containerId: null,
      activityLabel: null
    };

    // ⚠️ FIX (X46): Restore only terminal states.
    // "running" and "failed" reset to "ready" on reload so the
    // activity always renders fresh. Only "passed" persists.
    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.status === 'passed') {
          session.status = 'passed';
        } else {
          session.status = 'ready';
        }
        session.score = parsed.score || 0;
        session.attempts = parsed.attempts || 0;
      } catch (e) {
        session.status = 'ready';
        session.score = 0;
        session.attempts = 0;
      }
    } else {
      session.status = 'ready';
      session.score = 0;
      session.attempts = 0;
    }

    // Render multiple times — day.html will hide unused cards
    // within the first few hundred milliseconds
    render();
    setTimeout(render, 50);
    setTimeout(render, 150);
    setTimeout(render, 400);
    setTimeout(render, 800);

    // Dispatch ready event for lesson-engine
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('activity-gate:ready'));
    }, 30);

    console.log('[ActivityGate] Init:', session.key, 'status:', session.status);
  }

  /* ============================================================
     DETECT VISIBLE ACTIVITY — run at every render
     ============================================================ */
  function detectVisibleActivity() {
    const candidates = [
      { containerId: 'activity-1', label: 'Activity 1 — Match the Pairs' },
      { containerId: 'activity-2', label: 'Activity 2 — Scenario Challenge' },
      { containerId: 'formative',  label: 'Formative Check — Escape the Lab' }
    ];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const el = document.getElementById(c.containerId);
      if (!el) continue;
      if (isHidden(el)) continue;
      return c;
    }

    return null;
  }

  function isHidden(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.style && node.style.display === 'none') return true;
      if (node.style && node.style.visibility === 'hidden') return true;
      if (node.classList && node.classList.contains('hidden')) return true;
      try {
        if (window.getComputedStyle && window.getComputedStyle(node).display === 'none') return true;
      } catch (e) { /* ignore */ }
      node = node.parentElement;
    }
    return false;
  }

  /* ============================================================
     STATE
     ============================================================ */
  function save() {
    if (!session) return;
    sessionStorage.setItem(session.key, JSON.stringify({
      term: session.term,
      week: session.week,
      day: session.day,
      status: session.status,
      score: session.score,
      attempts: session.attempts,
      updatedAt: new Date().toISOString()
    }));
  }

  function markRunning() {
    if (!session) return;
    if (session.status === 'passed') return;
    session.status = 'running';
    save();
    render();
  }

  function completeWithScore(activityId, scorePercent) {
    if (!session) return;

    session.attempts = (session.attempts || 0) + 1;
    session.score = Math.round(scorePercent);

    if (scorePercent >= PASS_THRESHOLD * 100) {
      session.status = 'passed';
      APP.toast('🎉 Activity passed! You can now go to the next day.', 'success', 4000);
    } else {
      session.status = 'failed';
      APP.toast('📖 Score: ' + Math.round(scorePercent) + '% — need 75% to pass.', 'warning', 4000);
    }

    save();
    render();
  }

  function resetActivity() {
    if (!session) return;
    session.status = 'ready';
    save();
    render();
  }

  /* ============================================================
     RENDER — re-detect visible container every time
     ============================================================ */
  function render() {
    if (!session) return;

    const visible = detectVisibleActivity();
    if (visible) {
      session.containerId = visible.containerId;
      session.activityLabel = visible.label;
    }

    if (!session.containerId) {
      console.log('[ActivityGate] No visible activity container found');
      return;
    }

    const container = document.getElementById(session.containerId);
    if (!container) return;
    const parentCard = container.closest('.activity-card') || container.parentElement;
    if (!parentCard) return;

    if (isHidden(parentCard)) return;

    parentCard.querySelectorAll('.gate-overlay').forEach(function (el) { el.remove(); });

    console.log('[ActivityGate] Render:', session.containerId, 'status:', session.status);

    if (session.status === 'ready') {
      container.style.display = 'none';
      parentCard.appendChild(buildReadyOverlay());
    } else if (session.status === 'running') {
      container.style.display = '';
      // ⚠️ FIX (X46b): if the container is empty, the lesson-engine
      // hasn't rendered the activity yet. Re-dispatch activity:start.
      if (container.innerHTML.trim() === '') {
        const stateKey = session.containerId === 'activity-1' ? 'activity1'
                       : session.containerId === 'activity-2' ? 'activity2'
                       : 'formative';
        setTimeout(function () {
          document.dispatchEvent(new CustomEvent('activity:start', { detail: { activity: stateKey } }));
        }, 50);
      }
    } else if (session.status === 'passed') {
      container.style.display = 'none';
      parentCard.appendChild(buildPassedOverlay());
    } else if (session.status === 'failed') {
      container.style.display = 'none';
      parentCard.appendChild(buildFailedOverlay());
    }
  }

  /* ============================================================
     OVERLAYS
     ============================================================ */
  function buildReadyOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#e3f2fd,#bbdefb);border:2px solid #1976d2;border-radius:8px;';

    const c = document.getElementById(session.containerId);
    const mins = (c && c.dataset.estimatedMinutes) || 5;

    el.innerHTML =
      '<div style="font-size:2.5rem;">▶️</div>' +
      '<div style="font-weight:700;margin-top:12px;color:#0d47a1;font-size:1.1rem;">' +
        session.activityLabel +
      '</div>' +
      '<div style="font-size:0.85rem;margin-top:8px;color:#1565c0;">' +
        '⏱️ Estimated time: <strong>' + mins + ' minutes</strong>' +
      '</div>' +
      '<div style="font-size:0.85rem;margin-top:4px;color:#1565c0;">' +
        '🎯 Passing score: <strong>75%</strong>' +
      '</div>' +
      '<div style="font-size:0.8rem;margin-top:4px;color:#42a5f5;">' +
        '♻️ Retakes: unlimited until you pass' +
      '</div>' +
      (session.attempts > 0 ?
        '<div style="font-size:0.8rem;margin-top:8px;color:#d84315;">Previous: <strong>' +
        session.score + '%</strong> (Attempt #' + session.attempts + ')</div>'
        : '') +
      '<button class="btn btn-primary" id="gate-start-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">▶️ Start Activity</button>';

    setTimeout(function () {
      const btn = el.querySelector('#gate-start-btn');
      if (btn) btn.addEventListener('click', function () { startActivity(); });
    }, 0);

    return el;
  }

  function buildPassedOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#a5d6a7);border:2px solid #2e7d32;border-radius:8px;';

    el.innerHTML =
      '<div style="font-size:2rem;">✅</div>' +
      '<div style="font-weight:700;margin-top:8px;color:#1b5e20;">Passed!</div>' +
      '<div style="font-size:0.9rem;margin-top:6px;color:#2e7d32;">Score: <strong>' +
        session.score + '%</strong> · Attempts: ' + session.attempts + '</div>' +
      '<div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">🎉 Great job! You can proceed to the next day.</div>' +
      '<button class="btn btn-outline" id="gate-retake-btn" style="margin-top:12px;font-size:0.8rem;padding:8px 18px;">♻️ Practice Again</button>';

    setTimeout(function () {
      const btn = el.querySelector('#gate-retake-btn');
      if (btn) btn.addEventListener('click', function () {
        if (confirm('Practice this activity again? Your pass status will NOT be affected.')) {
          resetActivity();
        }
      });
    }, 0);

    return el;
  }

  function buildFailedOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ed6c02;border-radius:8px;';

    el.innerHTML =
      '<div style="font-size:2.5rem;">🔁</div>' +
      '<div style="font-weight:700;margin-top:8px;color:#e65100;font-size:1.1rem;">Try Again!</div>' +
      '<div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">Score: <strong>' +
        session.score + '%</strong> — You need 75% to pass.</div>' +
      '<div style="font-size:0.85rem;margin-top:6px;color:#ef6c00;">Attempts so far: ' +
        session.attempts + ' · Retakes: unlimited</div>' +
      '<button class="btn btn-primary" id="gate-retry-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">🔁 Retake Activity</button>';

    setTimeout(function () {
      const btn = el.querySelector('#gate-retry-btn');
      if (btn) btn.addEventListener('click', function () { startActivity(); });
    }, 0);

    return el;
  }

  /* ============================================================
     START ACTIVITY
     ============================================================ */
  function startActivity() {
    markRunning();
    const stateKey = session.containerId === 'activity-1' ? 'activity1'
                   : session.containerId === 'activity-2' ? 'activity2'
                   : 'formative';
    document.dispatchEvent(new CustomEvent('activity:start', { detail: { activity: stateKey } }));
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    init: init,
    markRunning: markRunning,
    completeWithScore: completeWithScore,
    resetActivity: resetActivity,
    getState: function () {
      return session ? { status: session.status, score: session.score, attempts: session.attempts, containerId: session.containerId } : null;
    }
  };
})();

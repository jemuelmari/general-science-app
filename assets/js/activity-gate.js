/* ============================================================
   activity-gate.js — Simple per-day activity gate
   Version: 2.2.0 (Bulletproof Match)
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const KEY_PREFIX = 'gsa_gate_v2_';
  const PASS_THRESHOLD = 0.75;
  let session = null;

  function init(config) {
    session = {
      key: `${KEY_PREFIX}${config.term}_w${config.week}_d${config.day}`,
      term: config.term,
      week: config.week,
      day: config.day,
      containerId: null,
      activityLabel: null
    };

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

    render();
    setTimeout(render, 100);
    setTimeout(render, 300);
    setTimeout(render, 800);

    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('activity-gate:ready'));
    }, 50);
  }

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
      if (node.classList && node.classList.contains('hidden')) return true;
      try {
        if (window.getComputedStyle && window.getComputedStyle(node).display === 'none') return true;
      } catch (e) { }
      node = node.parentElement;
    }
    return false;
  }

  function save() {
    if (!session) return;
    sessionStorage.setItem(session.key, JSON.stringify({
      term: session.term,
      week: session.week,
      day: session.day,
      status: session.status,
      score: session.score,
      attempts: session.attempts
    }));
  }

  function markRunning() {
    if (!session || session.status === 'passed') return;
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
      APP.toast('🎉 Activity passed!', 'success', 4000);
    } else {
      session.status = 'failed';
      APP.toast('📖 Score: ' + Math.round(scorePercent) + '% — need 75%.', 'warning', 4000);
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

  function render() {
    if (!session) return;
    const visible = detectVisibleActivity();
    if (visible) {
      session.containerId = visible.containerId;
      session.activityLabel = visible.label;
    }
    if (!session.containerId) return;

    const container = document.getElementById(session.containerId);
    if (!container) return;
    const parentCard = container.closest('.activity-card') || container.parentElement;
    if (!parentCard || isHidden(parentCard)) return;

    parentCard.querySelectorAll('.gate-overlay').forEach(el => el.remove());

    if (session.status === 'ready') {
      container.style.display = 'none';
      parentCard.appendChild(buildReadyOverlay());
    } else if (session.status === 'running') {
      container.style.display = '';
      if (container.innerHTML.trim() === '') {
        const stateKey = session.containerId === 'activity-1' ? 'activity1'
                       : session.containerId === 'activity-2' ? 'activity2'
                       : 'formative';
        setTimeout(() => {
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

  function buildReadyOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#e3f2fd,#bbdefb);border:2px solid #1976d2;border-radius:8px;';
    const c = document.getElementById(session.containerId);
    const mins = (c && c.dataset.estimatedMinutes) || 5;
    el.innerHTML = `
      <div style="font-size:2.5rem;">▶️</div>
      <div style="font-weight:700;margin-top:12px;color:#0d47a1;font-size:1.1rem;">${session.activityLabel}</div>
      <div style="font-size:0.85rem;margin-top:8px;color:#1565c0;">⏱️ Estimated time: <strong>${mins} minutes</strong></div>
      <div style="font-size:0.85rem;margin-top:4px;color:#1565c0;">🎯 Passing score: <strong>75%</strong></div>
      <div style="font-size:0.8rem;margin-top:4px;color:#42a5f5;">♻️ Retakes: unlimited</div>
      ${session.attempts > 0 ? `<div style="font-size:0.8rem;margin-top:8px;color:#d84315;">Previous: <strong>${session.score}%</strong> (Attempt #${session.attempts})</div>` : ''}
      <button class="btn btn-primary" id="gate-start-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">▶️ Start Activity</button>
    `;
    setTimeout(() => {
      const btn = el.querySelector('#gate-start-btn');
      if (btn) btn.addEventListener('click', startActivity);
    }, 0);
    return el;
  }

  function buildPassedOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#a5d6a7);border:2px solid #2e7d32;border-radius:8px;';
    el.innerHTML = `
      <div style="font-size:2rem;">✅</div>
      <div style="font-weight:700;margin-top:8px;color:#1b5e20;">Passed!</div>
      <div style="font-size:0.9rem;margin-top:6px;color:#2e7d32;">Score: <strong>${session.score}%</strong> · Attempts: ${session.attempts}</div>
      <div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">🎉 Great job! You can proceed.</div>
    `;
    return el;
  }

  function buildFailedOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ed6c02;border-radius:8px;';
    el.innerHTML = `
      <div style="font-size:2.5rem;">🔁</div>
      <div style="font-weight:700;margin-top:8px;color:#e65100;font-size:1.1rem;">Try Again!</div>
      <div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">Score: <strong>${session.score}%</strong> — You need 75% to pass.</div>
      <div style="font-size:0.85rem;margin-top:6px;color:#ef6c00;">Attempts: ${session.attempts}</div>
      <button class="btn btn-primary" id="gate-retry-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">🔁 Retake Activity</button>
    `;
    setTimeout(() => {
      const btn = el.querySelector('#gate-retry-btn');
      if (btn) btn.addEventListener('click', startActivity);
    }, 0);
    return el;
  }

  function startActivity() {
    markRunning();
    const stateKey = session.containerId === 'activity-1' ? 'activity1'
                   : session.containerId === 'activity-2' ? 'activity2'
                   : 'formative';
    document.dispatchEvent(new CustomEvent('activity:start', { detail: { activity: stateKey } }));
  }

  return {
    init: init,
    markRunning: markRunning,
    completeWithScore: completeWithScore,
    resetActivity: resetActivity,
    getState: function () { return session ? { status: session.status, score: session.score, attempts: session.attempts, containerId: session.containerId } : null; }
  };
})();

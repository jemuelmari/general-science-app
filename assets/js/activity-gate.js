/* ============================================================
   activity-gate.js — Simple per-day activity gate
   Version: 2.2.3 (Sync + progress fix)
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const KEY_PREFIX = 'gsa_gate_v2_';
  const PASS_THRESHOLD = 0.75;
  const RESULT_DELAY_MS = 1500; // hayaan munang makita ang final result bago itago ang laro
  let session = null;

  function stateKeyFor(containerId) {
    return containerId === 'activity-1' ? 'activity1'
         : containerId === 'activity-2' ? 'activity2'
         : 'formative';
  }

  function init(config) {
    session = {
      key: `${KEY_PREFIX}${config.term}_w${config.week}_d${config.day}`,
      term: config.term,
      week: config.week,
      day: config.day,
      containerId: null,
      activityLabel: null,
      status: 'ready',
      score: 0,
      attempts: 0
    };

    try {
      const saved = sessionStorage.getItem(session.key);
      if (saved) {
        const parsed = JSON.parse(saved);
        session.status = parsed.status === 'passed' ? 'passed' : 'ready';
        session.score = parsed.score || 0;
        session.attempts = parsed.attempts || 0;
      }
    } catch (e) {
      session.status = 'ready'; session.score = 0; session.attempts = 0;
    }

    render();
    setTimeout(render, 100);
    setTimeout(render, 300);
    setTimeout(render, 800);

    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('activity-gate:ready'));
    }, 50);
  }

  /* Pinapabayaan ang display:none na ang gate mismo ang naglagay (data-gate-hidden) */
  function isHidden(el) {
    let node = el;
    while (node && node !== document.body) {
      const gateHidden = node.dataset && node.dataset.gateHidden === '1';
      if (!gateHidden) {
        if (node.style && node.style.display === 'none') return true;
        if (node.classList && node.classList.contains('hidden')) return true;
        try {
          if (window.getComputedStyle && window.getComputedStyle(node).display === 'none') return true;
        } catch (e) { }
      }
      node = node.parentElement;
    }
    return false;
  }

  function detectVisibleActivity() {
    const candidates = [
      { containerId: 'activity-1', label: 'Activity 1 — Match the Pairs' },
      { containerId: 'activity-2', label: 'Activity 2 — Scenario Challenge' },
      { containerId: 'formative',  label: 'Formative Check — Escape the Lab' }
    ];

    // Kapag may napili na, huwag nang lumipat sa ibang container
    if (session && session.containerId) {
      const current = candidates.find(c => c.containerId === session.containerId);
      const el = document.getElementById(session.containerId);
      if (current && el && !isHidden(el)) return current;
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const el = document.getElementById(c.containerId);
      if (!el) continue;
      if (isHidden(el)) continue;
      return c;
    }
    return null;
  }

  function save() {
    if (!session) return;
    try {
      sessionStorage.setItem(session.key, JSON.stringify({
        term: session.term, week: session.week, day: session.day,
        status: session.status, score: session.score, attempts: session.attempts
      }));
    } catch (e) { }
  }

  function markRunning() {
    if (!session || session.status === 'passed') return;
    session.status = 'running';
    save();
    render();
  }

  function completeWithScore(activityId, scorePercent) {
    if (!session) return;
    if (session.status === 'passed') return; // huwag nang baguhin ang naipasa na

    session.attempts = (session.attempts || 0) + 1;
    session.score = Math.round(scorePercent);
    session.status = scorePercent >= PASS_THRESHOLD * 100 ? 'passed' : 'failed';
    save();

    // Hayaan munang makita ang final na bilang ng matches/score bago ipakita ang overlay
    setTimeout(render, RESULT_DELAY_MS);
  }

  function resetActivity() {
    if (!session) return;
    session.status = 'ready';
    save();
    render();
  }

  function hideContainer(container) {
    container.dataset.gateHidden = '1';
    container.style.display = 'none';
  }

  function showContainer(container) {
    delete container.dataset.gateHidden;
    container.style.display = '';
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
      hideContainer(container);
      parentCard.appendChild(buildReadyOverlay());
    } else if (session.status === 'running') {
      showContainer(container);
      if (container.innerHTML.trim() === '') {
        const stateKey = stateKeyFor(session.containerId);
        setTimeout(() => {
          // Dispatch lang kung wala pa ring laman at running pa rin
          if (session && session.status === 'running' && container.innerHTML.trim() === '') {
            document.dispatchEvent(new CustomEvent('activity:start', { detail: { activity: stateKey } }));
          }
        }, 50);
      }
    } else if (session.status === 'passed') {
      hideContainer(container);
      parentCard.appendChild(buildPassedOverlay());
    } else if (session.status === 'failed') {
      hideContainer(container);
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
      ${session.attempts > 0 ? `<div style="font-size:0.8rem;margin-top:8px;color:#d84315;">Previous: <strong>${session.score}%</strong> (Attempt #${session.attempts})</div>` : ''}
      <button class="btn btn-primary" id="gate-start-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">▶️ Start Activity</button>
    `;
    const btn = el.querySelector('#gate-start-btn');
    if (btn) btn.addEventListener('click', startActivity);
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
      <div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">Score: <strong>${session.score}%</strong> — Need 75%.</div>
      <button class="btn btn-primary" id="gate-retry-btn" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;">🔁 Retake</button>
    `;
    const btn = el.querySelector('#gate-retry-btn');
    if (btn) btn.addEventListener('click', startActivity);
    return el;
  }

  function startActivity() {
    if (!session || !session.containerId) return;
    const container = document.getElementById(session.containerId);
    if (container) container.innerHTML = ''; // linisin ang lumang laro bago mag-retake
    markRunning();
    // Isang dispatch lang; ang render() ay nagche-check muna kung may laman na bago mag-dispatch
    document.dispatchEvent(new CustomEvent('activity:start', {
      detail: { activity: stateKeyFor(session.containerId) }
    }));
  }

  return {
    init, markRunning, completeWithScore, resetActivity,
    getState: () => session ? { status: session.status, score: session.score, attempts: session.attempts, containerId: session.containerId } : null
  };
})();

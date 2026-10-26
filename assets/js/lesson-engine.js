/* ============================================================
   lesson-engine.js — Shared gamified activity + formative check
   Version: 1.0.10 (Fixed NaN Timer & Registration)
   ============================================================ */

const Lesson = (() => {
  'use strict';

  let ctx = null;
  let pendingActivities = {};
  let currentAttempts = {};
  let readyFlag = false;
  let timeoutHandle = null;
  let hasActivities = false;

  function getGate() {
    try { if (typeof ActivityGate !== 'undefined') return ActivityGate; } catch (e) { }
    return null;
  }

  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) { window.location.href = '../../../student/login.html'; return; }

    ctx = { lrn: user.lrn, term: config.term, week: config.week, day: config.day, points: 0, maxPoints: config.maxPoints || 300, badges: [], startTime: Date.now() };
    hasActivities = false;
    renderScoreBar(config.title);
    startLiveTimer();
    showLoadingOverlay();

    timeoutHandle = setTimeout(() => { if (!readyFlag) showTimeoutError(); }, 15000);
    document.addEventListener('activity:start', (e) => startActivity(e.detail.activity));
    document.addEventListener('activity-gate:ready', () => {
      if (!readyFlag) { hideLoadingOverlay(); readyFlag = true; clearTimeout(timeoutHandle); }
    });

    waitForGateAndInit(config, 0, 2000);
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!readyFlag) { hideLoadingOverlay(); readyFlag = true; clearTimeout(timeoutHandle); }
        setTimeout(autoCompleteIfLessonOnly, 1000);
      }, 500);
    });
  }

  function autoCompleteIfLessonOnly() {
    if (hasActivities) return;
    try { Store.markDayComplete(ctx.lrn, ctx.term, ctx.week, ctx.day); } catch (err) { }
  }

  function waitForGateAndInit(config, waited, maxWait) {
    var gate = getGate();
    if (gate && typeof gate.init === 'function') {
      try { gate.init(config); } catch (err) { }
      return;
    }
    if (waited >= maxWait) {
      document.querySelectorAll('.gate-overlay').forEach(function (el) { el.remove(); });
      return;
    }
    setTimeout(function () { waitForGateAndInit(config, waited + 50, maxWait); }, 50);
  }

  // FIX: Ibinalik ang time limit calculation para sa bawat activity type
  function calculateTimeLimit(type, count) {
    const MIN_SECONDS = 300;
    if (type === 'match') return Math.max(MIN_SECONDS, count * 20);
    if (type === 'scenario') return Math.max(MIN_SECONDS, count * 25);
    if (type === 'escape') return Math.max(MIN_SECONDS, count * 60);
    return MIN_SECONDS;
  }

  function registerMatchGame(containerId, config) {
    hasActivities = true;
    const timeLimit = calculateTimeLimit('match', config.pairs.length);
    pendingActivities[containerId] = { type: 'match', config: Object.assign({}, config, { timeLimit: timeLimit }) };
  }

  function registerScenarioGame(containerId, config) {
    hasActivities = true;
    const timeLimit = calculateTimeLimit('scenario', config.scenarios.length);
    pendingActivities[containerId] = { type: 'scenario', config: Object.assign({}, config, { timeLimit: timeLimit }) };
  }

  function registerEscapeRoom(containerId, config) {
    hasActivities = true;
    const timeLimit = calculateTimeLimit('escape', config.questions.length);
    pendingActivities[containerId] = { type: 'escape', config: Object.assign({}, config, { timeLimit: timeLimit }) };
  }

  function startActivity(stateKey) {
    const containerId = stateKey === 'activity1' ? 'activity-1' : stateKey === 'activity2' ? 'activity-2' : 'formative';
    const pending = pendingActivities[containerId];
    if (!pending) {
      console.warn('[Lesson] No pending activity for', containerId);
      return;
    }
    currentAttempts[containerId] = (currentAttempts[containerId] || 0) + 1;
    if (pending.type === 'match') renderMatchGameNow(containerId, pending.config);
    else if (pending.type === 'scenario') renderScenarioGameNow(containerId, pending.config);
    else if (pending.type === 'escape') renderEscapeRoomNow(containerId, pending.config);
  }

  function reportScore(containerId, scorePercent) {
    var gate = getGate();
    if (gate && typeof gate.completeWithScore === 'function') {
      try { gate.completeWithScore(containerId, scorePercent); } catch (err) { }
    }
  }

  function markDayIfPassed(scorePercent) {
    if (scorePercent >= 75) {
      try { Store.markDayComplete(ctx.lrn, ctx.term, ctx.week, ctx.day); } catch (err) { }
    }
  }

  function renderScoreBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="score-bar-left"><span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span><span class="score-bar-title">${title}</span></div>
      <div class="score-bar-right">
        <div class="score-bar-stat"><span class="value" id="sb-points">0</span><span class="label">Points</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-badges">0</span><span class="label">Badges</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-timer">00:00</span><span class="label">Time</span></div>
      </div>
    `;
  }

  function startLiveTimer() {
    const el = document.getElementById('sb-timer');
    if (!el) return;
    setInterval(() => { const s = Math.floor((Date.now() - ctx.startTime) / 1000); el.textContent = APP.formatTime(s); }, 1000);
  }

  function addPts(n) {
    ctx.points += n;
    const el = document.getElementById('sb-points');
    if (el) { el.textContent = ctx.points; el.style.transform = 'scale(1.3)'; setTimeout(() => (el.style.transform = 'scale(1)'), 200); }
    Store.addDailyPoints(ctx.lrn, ctx.term, ctx.week, ctx.day, n);
  }

  function awardBadge(id, name, icon) {
    if (ctx.badges.includes(id)) return;
    if (Store.awardBadge(ctx.lrn, ctx.term, id)) {
      ctx.badges.push(id);
      const el = document.getElementById('sb-badges');
      if (el) el.textContent = ctx.badges.length;
      APP.toast(`🏆 Badge earned: ${icon} ${name}`, 'success', 4000);
    }
  }

  function showLoadingOverlay() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'lesson-loading-overlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:9998;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;`;
    overlay.innerHTML = `<div style="text-align:center;"><div style="font-size:2.5rem;">⏳</div><div style="font-size:1.1rem;font-weight:600;color:#0d47a1;margin-top:12px;">Loading activities...</div></div>`;
    document.body.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (overlay) overlay.remove();
  }

  function showTimeoutError() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (!overlay) return;
    overlay.innerHTML = `<div style="text-align:center;"><div style="font-size:2.5rem;">📡</div><div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection</div></div>`;
  }

  /* ============================================================
     MATCH GAME
     ============================================================ */
  function renderMatchGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const pairs = config.pairs;
    const timeLimit = config.timeLimit;

    let leftItems = pairs.map((p, i) => ({ ...p, id: i })).sort(() => Math.random() - 0.5);
    let rightItems = pairs.map((p, i) => ({ ...p, id: i })).sort(() => Math.random() - 0.5);

    let selectedLeft = null;
    let matches = 0;
    let timeLeft = timeLimit;
    let timerInterval = null;
    let finished = false;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🔗 Match the pairs</span>
        <span class="activity-timer" id="match-timer">${APP.formatTime(timeLeft)}</span>
      </div>
      <div class="match-grid">
        <div class="match-column"><h4>LEFT</h4><div id="match-left"></div></div>
        <div class="match-column"><h4>RIGHT</h4><div id="match-right"></div></div>
      </div>
      <div class="text-center mt-md">
        <span id="match-score" class="badge badge-info">Matches: 0 / ${pairs.length}</span>
      </div>
    `;

    const leftEl = container.querySelector('#match-left');
    const rightEl = container.querySelector('#match-right');
    const scoreEl = container.querySelector('#match-score');

    leftItems.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'match-item';
      el.textContent = item.left;
      el.dataset.id = item.id;
      el.addEventListener('click', () => {
        if (finished || el.classList.contains('correct')) return;
        leftEl.querySelectorAll('.match-item').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');
        selectedLeft = el;
      });
      leftEl.appendChild(el);
    });

    rightItems.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'match-item';
      el.textContent = item.right;
      el.dataset.id = item.id;
      el.addEventListener('click', () => {
        if (finished || !selectedLeft || el.classList.contains('correct')) return;
        
        if (selectedLeft.dataset.id === el.dataset.id) {
          selectedLeft.classList.remove('selected');
          selectedLeft.classList.add('correct');
          el.classList.add('correct');
          selectedLeft = null;
          
          matches++;
          if (scoreEl) scoreEl.textContent = `Matches: ${matches} / ${pairs.length}`;
          
          if (matches === pairs.length) {
            finished = true;
            clearInterval(timerInterval);
            reportScore(containerId, 100);
            markDayIfPassed(100);
            APP.toast('🎉 Perfect Match! You passed!', 'success', 4000);
          }
        } else {
          el.classList.add('wrong');
          selectedLeft.classList.add('wrong');
          setTimeout(() => {
            el.classList.remove('wrong');
            if (selectedLeft) selectedLeft.classList.remove('wrong', 'selected');
            selectedLeft = null;
          }, 500);
        }
      });
      rightEl.appendChild(el);
    });

    timerInterval = setInterval(() => {
      timeLeft--;
      const el = container.querySelector('#match-timer');
      if (el) el.textContent = APP.formatTime(Math.max(0, timeLeft));
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        finished = true;
        const score = Math.round((matches / pairs.length) * 100);
        reportScore(containerId, score);
        markDayIfPassed(score);
      }
    }, 1000);
  }

  /* ============================================================
     SCENARIO GAME (FIXED TIMER)
     ============================================================ */
  function renderScenarioGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const scenarios = config.scenarios;
    // Siguraduhing may timeLimit, kung wala, default sa 300 seconds (5 mins)
    const timeLimit = config.timeLimit || 300; 
    
    let index = 0, correct = 0, finished = false;
    let totalTimeLeft = timeLimit, overallTimer = null;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🎯 Scenario Challenge</span>
        <span class="activity-timer" id="scenario-overall-timer">${APP.formatTime(totalTimeLeft)}</span>
      </div>
      <div id="scenario-body"></div>
    `;

    renderCard();

    overallTimer = setInterval(() => {
      totalTimeLeft--;
      const el = container.querySelector('#scenario-overall-timer');
      if (el) el.textContent = APP.formatTime(Math.max(0, totalTimeLeft));
      if (totalTimeLeft <= 0) endGame('timeout');
    }, 1000);

    function renderCard() {
      if (finished) return;
      if (index >= scenarios.length) return endGame('complete');
      const sc = scenarios[index];
      const body = container.querySelector('#scenario-body');
      body.innerHTML = `
        <div class="scenario-card">
          <p class="scenario-text">${sc.text}</p>
          <div class="choice-row" id="choice-row"></div>
        </div>
        <div class="text-center mt-md"><span class="badge badge-info">Question ${index + 1} / ${scenarios.length}</span></div>
      `;
      const row = body.querySelector('#choice-row');
      sc.choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.label;
        btn.addEventListener('click', () => {
          if (finished) return;
          container.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
          if (choice.correct) { btn.classList.add('correct'); correct++; }
          else { btn.classList.add('wrong'); }
          setTimeout(() => { index++; renderCard(); }, 1000);
        });
        row.appendChild(btn);
      });
    }

    function endGame(reason) {
      if (finished) return;
      finished = true;
      clearInterval(overallTimer);
      const scorePercent = Math.round((correct / scenarios.length) * 100);
      reportScore(containerId, scorePercent);
      markDayIfPassed(scorePercent);
    }
  }

  /* ============================================================
     ESCAPE ROOM (FIXED TIMER)
     ============================================================ */
  function renderEscapeRoomNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const questions = config.questions;
    const lives = config.lives !== undefined ? config.lives : 3;
    const timeLimit = config.timeLimit || 300;
    
    let currentLives = lives, earnedKeys = 0, index = 0, locked = false, finished = false;
    let timeLeft = timeLimit, timerInterval = null;

    function renderQuestion() {
      if (finished) return;
      if (index >= questions.length) {
        finished = true;
        const scorePercent = Math.round((earnedKeys / questions.length) * 100);
        reportScore(containerId, scorePercent);
        markDayIfPassed(scorePercent);
        return;
      }
      const q = questions[index];
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div><div class="score-bar-label">Q ${index + 1} / ${questions.length}</div></div>
            <div class="activity-timer" id="escape-timer">${APP.formatTime(Math.max(0, timeLeft))}</div>
          </div>
          <div class="escape-question">
            <h4>${q.text}</h4>
            <div class="escape-options" id="escape-options"></div>
          </div>
        </div>
      `;
      const opts = container.querySelector('#escape-options');
      q.choices.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'escape-option';
        btn.textContent = `${String.fromCharCode(65 + i)}. ${c.label}`;
        btn.addEventListener('click', () => {
          if (locked) return;
          locked = true;
          container.querySelectorAll('.escape-option').forEach(b => b.disabled = true);
          if (c.correct) { btn.classList.add('correct'); earnedKeys++; }
          else { btn.classList.add('wrong'); currentLives--; }
          setTimeout(() => { index++; locked = false; renderQuestion(); }, 1000);
        });
        opts.appendChild(btn);
      });
    }

    renderQuestion();
    timerInterval = setInterval(() => {
      timeLeft--;
      const el = document.getElementById('escape-timer');
      if (el) el.textContent = APP.formatTime(Math.max(0, timeLeft));
    }, 1000);
  }

  return {
    init,
    renderMatchGame: registerMatchGame,
    renderScenarioGame: registerScenarioGame,
    renderEscapeRoom: registerEscapeRoom
  };
})();

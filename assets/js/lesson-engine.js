/* ============================================================
   lesson-engine.js — Shared gamified activity + formative check
   Version: 1.0.1
   App: General Science
   ------------------------------------------------------------
   Changelog v1.0.1: Hides loading overlay immediately after
   lesson JSON renders — no longer depends on activity-gate:ready
   ============================================================ */

const Lesson = (() => {
  'use strict';

  let ctx = null;
  let pendingActivities = {};
  let currentAttempts = {};
  let readyFlag = false;
  let timeoutHandle = null;

  const PASS_THRESHOLD = 0.75;

  /* ---------- Init ---------- */
  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../../student/login.html';
      return;
    }

    ctx = {
      lrn: user.lrn,
      term: config.term,
      week: config.week,
      day: config.day,
      points: 0,
      maxPoints: config.maxPoints || 300,
      badges: [],
      startTime: Date.now()
    };

    renderScoreBar(config.title);
    startLiveTimer();
    showLoadingOverlay();

    // Fallback timeout — only if something truly breaks
    timeoutHandle = setTimeout(() => {
      if (!readyFlag) showTimeoutError();
    }, 15000);

    // Activity start event — triggered by ActivityGate when the user clicks Start
    document.addEventListener('activity:start', (e) => {
      startActivity(e.detail.activity);
    });

    // Listen for activity-gate:ready (optional, non-blocking)
    document.addEventListener('activity-gate:ready', () => {
      if (!readyFlag) {
        hideLoadingOverlay();
        readyFlag = true;
        clearTimeout(timeoutHandle);
      }
    });

    // Init the gate (or gracefully continue without it)
    if (window.ActivityGate) {
      try {
        ActivityGate.init(config);
      } catch (err) {
        console.warn('[Lesson] ActivityGate init failed:', err);
      }
    } else {
      console.warn('[Lesson] ActivityGate not loaded — falling back to always-ready mode');
      if (window.ActivityGate === undefined && typeof ActivityGate === 'undefined') {
        // No gate at all — unlock everything immediately
        document.querySelectorAll('.gate-overlay').forEach((el) => el.remove());
      }
    }

    // *** NEW: Hide the overlay as soon as the current frame renders ***
    // The lesson JSON has already been fetched and rendered by the caller
    // (day.html or equivalent) before init() is called, so we can hide now.
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!readyFlag) {
          hideLoadingOverlay();
          readyFlag = true;
          clearTimeout(timeoutHandle);
        }
      }, 300);
    });
  }

  /* ---------- Difficulty-Based Timer ---------- */
  function calculateTimeLimit(type, count) {
    const MIN_SECONDS = 300;
    if (type === 'match') return Math.max(MIN_SECONDS, count * 20);
    if (type === 'scenario') return Math.max(MIN_SECONDS, count * 25);
    if (type === 'escape') return Math.max(MIN_SECONDS, count * 60);
    return MIN_SECONDS;
  }

  /* ---------- Register activities ---------- */
  function registerMatchGame(containerId, config) {
    const timeLimit = calculateTimeLimit('match', config.pairs.length);
    pendingActivities[containerId] = { type: 'match', config: { ...config, timeLimit } };
    const container = document.getElementById(containerId);
    if (container) container.dataset.estimatedMinutes = Math.round(timeLimit / 60);
  }

  function registerScenarioGame(containerId, config) {
    const timeLimit = calculateTimeLimit('scenario', config.scenarios.length);
    pendingActivities[containerId] = { type: 'scenario', config: { ...config, timeLimit } };
    const container = document.getElementById(containerId);
    if (container) container.dataset.estimatedMinutes = Math.round(timeLimit / 60);
  }

  function registerEscapeRoom(containerId, config) {
    const timeLimit = calculateTimeLimit('escape', config.questions.length);
    pendingActivities[containerId] = { type: 'escape', config: { ...config, timeLimit } };
    const container = document.getElementById(containerId);
    if (container) container.dataset.estimatedMinutes = Math.round(timeLimit / 60);
  }

  /* ---------- Start activity ---------- */
  function startActivity(stateKey) {
    const containerId = stateKey === 'activity1' ? 'activity-1'
                      : stateKey === 'activity2' ? 'activity-2'
                      : 'formative';
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

  /* ---------- Score Bar ---------- */
  function renderScoreBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="score-bar-left">
        <span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span>
        <span class="score-bar-title">${title}</span>
      </div>
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
    setInterval(() => {
      const s = Math.floor((Date.now() - ctx.startTime) / 1000);
      el.textContent = APP.formatTime(s);
    }, 1000);
  }

  function addPts(n) {
    ctx.points += n;
    const el = document.getElementById('sb-points');
    if (el) {
      el.textContent = ctx.points;
      el.style.transform = 'scale(1.3)';
      setTimeout(() => (el.style.transform = 'scale(1)'), 200);
    }
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

  /* ---------- Loading overlay ---------- */
  function showLoadingOverlay() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'lesson-loading-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9998;
      background:rgba(255,255,255,0.92);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,sans-serif;
      transition:opacity 0.3s ease;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:320px;padding:24px;">
        <div style="font-size:2.5rem;">⏳</div>
        <div style="font-size:1.1rem;font-weight:600;color:#0d47a1;margin-top:12px;">Loading activities...</div>
        <div style="font-size:0.85rem;color:#5f6368;margin-top:8px;">This may take a moment on slow connection.</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
  }

  function showTimeoutError() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (!overlay) return;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:380px;padding:24px;">
        <div style="font-size:2.5rem;">📡</div>
        <div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection</div>
        <div style="font-size:0.85rem;color:#5f6368;margin-top:8px;">The lesson is still loading.</div>
        <button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#0d47a1;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">🔄 Retry</button>
      </div>
    `;
  }

  /* ============================================================
     MATCH GAME
     ============================================================ */
  function renderMatchGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const { pairs, timeLimit, pointsCorrect = 10, pointsWrong = -3, bonusFast = 15,
            badgeId, badgeName, badgeIcon } = config;

    let leftItems = [...pairs].sort(() => Math.random() - 0.5);
    let rightItems = [...pairs].sort(() => Math.random() - 0.5);
    let selectedLeft = null;
    let matches = 0, wrongCount = 0, timeLeft = timeLimit, timerInterval = null, finished = false;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🔗 Match the pairs</span>
        <span class="activity-timer" id="match-timer">${APP.formatTime(timeLeft)}</span>
      </div>
      <div class="match-grid">
        <div class="match-column"><h4>Left</h4><div id="match-left"></div></div>
        <div class="match-column"><h4>Right</h4><div id="match-right"></div></div>
      </div>
      <div class="text-center mt-md">
        <span id="match-score" class="badge badge-info">Matches: 0 / ${pairs.length}</span>
      </div>
    `;

    const leftEl = container.querySelector('#match-left');
    const rightEl = container.querySelector('#match-right');

    leftItems.forEach((item) => {
      const el = APP.el('div', { class: 'match-item', 'data-key': item.key, text: item.left });
      el.addEventListener('click', () => onLeftClick(el));
      leftEl.appendChild(el);
    });

    rightItems.forEach((item) => {
      const el = APP.el('div', { class: 'match-item', 'data-key': item.key, text: item.right });
      el.addEventListener('click', () => onRightClick(el));
      rightEl.appendChild(el);
    });

    function onLeftClick(el) {
      if (finished || el.classList.contains('correct')) return;
      leftEl.querySelectorAll('.match-item').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');
      selectedLeft = el;
    }

    function onRightClick(el) {
      if (finished || !selectedLeft || el.classList.contains('correct')) return;
      const lk = selectedLeft.dataset.key, rk = el.dataset.key;
      if (lk === rk) {
        selectedLeft.classList.remove('selected');
        selectedLeft.classList.add('correct');
        el.classList.add('correct');
        addPts(pointsCorrect);
        matches++;
        updateScore();
        if (matches === pairs.length) endGame('complete');
      } else {
        el.classList.add('wrong');
        selectedLeft.classList.add('wrong');
        addPts(pointsWrong);
        wrongCount++;
        const l = selectedLeft;
        setTimeout(() => { l.classList.remove('wrong', 'selected'); el.classList.remove('wrong'); }, 500);
      }
      selectedLeft = null;
    }

    function updateScore() {
      const el2 = container.querySelector('#match-score');
      if (el2) el2.textContent = `Matches: ${matches} / ${pairs.length}`;
    }

    function endGame(reason) {
      if (finished) return;
      finished = true;
      clearInterval(timerInterval);
      const scorePercent = Math.round((matches / pairs.length) * 100);
      if (scorePercent >= 75) {
        if (wrongCount === 0) { awardBadge(badgeId + '-flawless', 'Flawless', '🎯'); addPts(bonusFast); }
        if ((timeLimit - timeLeft) < timeLimit * 0.5) awardBadge(badgeId + '-fast', 'Speed Scholar', '⚡');
        awardBadge(badgeId, badgeName, badgeIcon);
      }
      if (window.ActivityGate) window.ActivityGate.completeWithScore(containerId, scorePercent);
      if (reason === 'timeout') APP.toast(`⏰ Time's up! You scored ${scorePercent}%`, 'warning', 4000);
      else if (scorePercent >= 75) APP.toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else APP.toast(`📖 Score: ${scorePercent}% — need 75% to pass.`, 'warning', 4000);
    }

    timerInterval = setInterval(() => {
      timeLeft--;
      const el = container.querySelector('#match-timer');
      if (el) el.textContent = APP.formatTime(Math.max(0, timeLeft));
      if (timeLeft <= 0) endGame('timeout');
    }, 1000);
  }

  /* ============================================================
     SCENARIO GAME
     ============================================================ */
  function renderScenarioGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const { scenarios, timeLimit, pointsCorrect = 8, bonusFast = 3,
            badgeId, badgeName, badgeIcon } = config;

    let index = 0, correct = 0, fastAnswers = 0, cardStart = Date.now(), finished = false;
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
      cardStart = Date.now();
      const body = container.querySelector('#scenario-body');
      body.innerHTML = `
        <div class="scenario-card">
          <p class="scenario-text">${sc.text}</p>
          <div class="choice-row" id="choice-row"></div>
        </div>
        <div class="text-center mt-md">
          <span class="badge badge-info">Question ${index + 1} / ${scenarios.length}</span>
        </div>
      `;
      const row = body.querySelector('#choice-row');
      sc.choices.forEach((choice) => {
        const btn = APP.el('button', { class: 'choice-btn', text: choice.label });
        btn.addEventListener('click', () => onChoice(btn, choice, sc));
        row.appendChild(btn);
      });
    }

    function onChoice(btn, choice, sc) {
      if (finished) return;
      const elapsed = (Date.now() - cardStart) / 1000;
      container.querySelectorAll('.choice-btn').forEach((b) => (b.disabled = true));
      if (choice.correct) {
        btn.classList.add('correct');
        addPts(pointsCorrect);
        correct++;
        if (elapsed <= 5) { addPts(bonusFast); fastAnswers++; }
      } else {
        btn.classList.add('wrong');
        sc.choices.forEach((c, i) => {
          if (c.correct) container.querySelectorAll('.choice-btn')[i].classList.add('correct');
        });
      }
      setTimeout(() => { index++; renderCard(); }, 1200);
    }

    function endGame(reason) {
      if (finished) return;
      finished = true;
      clearInterval(overallTimer);
      const scorePercent = Math.round((correct / scenarios.length) * 100);
      if (scorePercent >= 75) {
        if (correct === scenarios.length) awardBadge(badgeId, badgeName, badgeIcon);
        if (fastAnswers >= Math.ceil(scenarios.length * 0.66)) awardBadge(badgeId + '-fast', 'Quick Thinker', '⚡');
      }
      if (window.ActivityGate) window.ActivityGate.completeWithScore(containerId, scorePercent);
      if (reason === 'timeout') APP.toast(`⏰ Time's up! You scored ${scorePercent}%`, 'warning', 4000);
      else if (scorePercent >= 75) APP.toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else APP.toast(`📖 Score: ${scorePercent}% — need 75% to pass.`, 'warning', 4000);
    }
  }

  /* ============================================================
     ESCAPE ROOM
     ============================================================ */
  function renderEscapeRoomNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const { questions, badgeId, badgeName, badgeIcon, lives = 3, timeLimit } = config;

    let currentLives = lives, earnedKeys = [], index = 0, locked = false, finished = false;
    let timeLeft = timeLimit, timerInterval = null;

    renderIntro();

    timerInterval = setInterval(() => {
      timeLeft--;
      const el = document.getElementById('escape-timer');
      if (el) el.textContent = APP.formatTime(Math.max(0, timeLeft));
      if (timeLeft <= 0) endGame('timeout');
    }, 1000);

    function renderIntro() {
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div>
              <div class="score-bar-label">Formative Check</div>
              <div style="font-size:1.2rem;font-weight:600;">🔐 Escape the Lab</div>
            </div>
            <div style="text-align:right;">
              <div class="escape-lives" id="escape-lives">❤️❤️❤️</div>
              <div class="activity-timer" id="escape-timer" style="margin-top:4px;font-size:0.9rem;">${APP.formatTime(timeLeft)}</div>
            </div>
          </div>
          <div class="escape-result">
            <div class="result-emoji">🗝️</div>
            <div class="result-title">Unlock ${questions.length} keys to escape!</div>
            <p class="result-message">Answer all questions. Wrong answers cost 1 life. You need 75% to pass.</p>
            <button id="escape-begin" class="btn btn-accent" style="margin-top:16px;">Begin Challenge →</button>
          </div>
        </div>
      `;
      container.querySelector('#escape-begin').addEventListener('click', renderQuestion);
    }

    function renderQuestion() {
      if (finished) return;
      if (index >= questions.length) return endGame('complete');
      const q = questions[index];

      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div>
              <div class="score-bar-label">Question ${index + 1} / ${questions.length}</div>
              <div style="font-size:1rem;">🔐 Escape the Lab</div>
            </div>
            <div style="text-align:right;">
              <div class="escape-lives" id="escape-lives">${'❤️'.repeat(currentLives)}${'🖤'.repeat(lives - currentLives)}</div>
              <div class="activity-timer" id="escape-timer" style="margin-top:4px;font-size:0.9rem;">${APP.formatTime(Math.max(0, timeLeft))}</div>
            </div>
          </div>
          <div class="escape-keys" style="justify-content:center;margin-bottom:12px;">
            ${questions.map((_, i) => `<span class="key-icon ${earnedKeys.includes(i) ? 'earned' : ''}">🗝️</span>`).join('')}
          </div>
          <div class="escape-question">
            <h4>${q.text}</h4>
            <div class="escape-options" id="escape-options"></div>
          </div>
        </div>
      `;

      const opts = container.querySelector('#escape-options');
      q.choices.forEach((c, i) => {
        const btn = APP.el('button', { class: 'escape-option', text: `${String.fromCharCode(65 + i)}. ${c.label}` });
        btn.addEventListener('click', () => onAnswer(btn, c));
        opts.appendChild(btn);
      });
    }

    function onAnswer(btn, choice) {
      if (locked || finished) return;
      locked = true;

      const all = container.querySelectorAll('.escape-option');
      all.forEach((b) => (b.disabled = true));

      if (choice.correct) {
        btn.classList.add('correct');
        earnedKeys.push(index);
        APP.toast('🔑 Key earned!', 'success', 1500);
        setTimeout(() => { index++; locked = false; renderQuestion(); }, 900);
      } else {
        btn.classList.add('wrong');
        currentLives--;
        const correctIdx = questions[index].choices.findIndex((c) => c.correct);
        all[correctIdx].classList.add('correct');
        if (currentLives <= 0) setTimeout(() => endGame('outoflives'), 1200);
        else setTimeout(() => { locked = false; index++; renderQuestion(); }, 1400);
      }
    }

    function endGame(reason) {
      if (finished) return;
      finished = true;
      clearInterval(timerInterval);
      const scorePercent = Math.round((earnedKeys.length / questions.length) * 100);
      if (scorePercent >= 75) {
        if (currentLives === lives) awardBadge(badgeId, badgeName, badgeIcon);
        markDayComplete();
      }
      if (window.ActivityGate) window.ActivityGate.completeWithScore(containerId, scorePercent);
      if (scorePercent >= 75) APP.toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else if (reason === 'timeout') APP.toast(`⏰ Time's up! You scored ${scorePercent}%`, 'warning', 4000);
      else if (reason === 'outoflives') APP.toast(`💀 Out of lives! You scored ${scorePercent}%`, 'warning', 4000);
      else APP.toast(`📖 Score: ${scorePercent}% — need 75% to pass.`, 'warning', 4000);
    }
  }

  function markDayComplete() {
    Store.markDayComplete(ctx.lrn, ctx.term, ctx.week, ctx.day);
  }

  /* ---------- Public API ---------- */
  return {
    init,
    addPoints: addPts,
    awardBadge,
    renderMatchGame: registerMatchGame,
    renderScenarioGame: registerScenarioGame,
    renderEscapeRoom: registerEscapeRoom,
    markDayComplete
  };
})();

/* ============================================================
   lesson-engine.js — Shared gamified activity + formative check
   Version: 1.0.19 (Store adapter: completed[] / scores / badges)
   ============================================================ */

const Lesson = (() => {
  'use strict';

  const PASS_PERCENT = 75;
  const ACTIVITY_IDS = ['activity-1', 'activity-2', 'formative'];

  let ctx = null;
  let pendingActivities = {};
  let currentAttempts = {};
  let activeGames = {};          // containerId -> { finished, stop() }
  let readyFlag = false;
  let timeoutHandle = null;
  let dayMarked = false;
  let initialized = false;
  let liveTimerHandle = null;

  /* ---------- helpers ---------- */

  function logError(where, err) {
    try { console.error('[Lesson] ' + where + ':', err); } catch (e) { }
  }

  function toast(msg, type, ms) {
    try { if (typeof APP !== 'undefined' && APP.toast) APP.toast(msg, type, ms); } catch (e) { }
  }

  function fmt(s) {
    try { return APP.formatTime(s); } catch (e) {
      const m = Math.floor(s / 60), r = s % 60;
      return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getGate() {
    try { if (typeof ActivityGate !== 'undefined') return ActivityGate; } catch (e) { }
    return null;
  }

  function hasActivities() {
    return Object.keys(pendingActivities).length > 0;
  }

  // Kung "passed" na ang gate (hal. galing sa sessionStorage) pero hindi pa nase-save sa Store,
  // i-save ngayon. Hindi nagre-redirect.
  function reconcilePassedState() {
    const gate = getGate();
    if (!gate || typeof gate.getState !== 'function') return;
    const st = gate.getState();
    if (st && st.status === 'passed') {
      if (markDayComplete()) toast('✅ Progress saved', 'success', 2500);
    }
  }

  /* ---------- init ---------- */

  function init(config) {
    if (initialized) return;
    const user = Store.getCurrentUser();
    if (!user) { window.location.href = '../../../student/login.html'; return; }
    initialized = true;

    ctx = {
      lrn: user.lrn, term: config.term, week: config.week, day: config.day,
      points: 0, maxPoints: config.maxPoints || 300, badges: [], startTime: Date.now()
    };
    dayMarked = false;

    renderScoreBar(config.title);
    startLiveTimer();
    showLoadingOverlay();

    timeoutHandle = setTimeout(() => { if (!readyFlag) showTimeoutError(); }, 15000);

    document.addEventListener('activity:start', (e) => startActivity(e.detail.activity));
    document.addEventListener('activity-gate:ready', () => {
      if (!readyFlag) { hideLoadingOverlay(); readyFlag = true; clearTimeout(timeoutHandle); }
      reconcilePassedState();
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
    if (hasActivities()) return;
    completeDayAndLeave();
  }

  function waitForGateAndInit(config, waited, maxWait) {
    const gate = getGate();
    if (gate && typeof gate.init === 'function') {
      try { gate.init(config); } catch (err) { logError('gate.init', err); }
      return;
    }
    if (waited >= maxWait) {
      document.querySelectorAll('.gate-overlay').forEach(el => el.remove());
      if (!readyFlag) { hideLoadingOverlay(); readyFlag = true; clearTimeout(timeoutHandle); }
      return;
    }
    setTimeout(() => waitForGateAndInit(config, waited + 50, maxWait), 50);
  }

  /* ---------- time limits ---------- */

  function calculateTimeLimit(type, count) {
    const MIN_SECONDS = 300;
    if (type === 'match') return Math.max(MIN_SECONDS, count * 20);
    if (type === 'scenario') return Math.max(MIN_SECONDS, count * 25);
    if (type === 'escape') return Math.max(MIN_SECONDS, count * 60);
    return MIN_SECONDS;
  }

  /* ---------- registration ---------- */

  function registerMatchGame(containerId, config) {
    const timeLimit = calculateTimeLimit('match', config.pairs.length);
    pendingActivities[containerId] = { type: 'match', config: Object.assign({}, config, { timeLimit }) };
  }

  function registerScenarioGame(containerId, config) {
    const timeLimit = calculateTimeLimit('scenario', config.scenarios.length);
    pendingActivities[containerId] = { type: 'scenario', config: Object.assign({}, config, { timeLimit }) };
  }

  function registerEscapeRoom(containerId, config) {
    const timeLimit = calculateTimeLimit('escape', config.questions.length);
    pendingActivities[containerId] = { type: 'escape', config: Object.assign({}, config, { timeLimit }) };
  }

  /* ---------- start ---------- */

  function startActivity(stateKey) {
    const containerId = stateKey === 'activity1' ? 'activity-1'
                      : stateKey === 'activity2' ? 'activity-2'
                      : 'formative';
    const pending = pendingActivities[containerId];
    if (!pending) return;

    // Ignore duplicate start events while a game is still running
    const active = activeGames[containerId];
    if (active && !active.finished) return;

    currentAttempts[containerId] = (currentAttempts[containerId] || 0) + 1;

    if (pending.type === 'match') renderMatchGameNow(containerId, pending.config);
    else if (pending.type === 'scenario') renderScenarioGameNow(containerId, pending.config);
    else if (pending.type === 'escape') renderEscapeRoomNow(containerId, pending.config);
  }

  /* ---------- scoring / progress ---------- */

  function reportScore(containerId, scorePercent) {
    const gate = getGate();
    if (gate && typeof gate.completeWithScore === 'function') {
      try { gate.completeWithScore(containerId, scorePercent); } catch (err) { logError('reportScore', err); }
    }
  }

  /* ---------- Store adapter (gumagamit lang ng tunay na Store API) ---------- */

  // term -> "term1", week/day -> numbers; dayId -> "term1-w1-d2" (format na binabasa ng index.html)
  function keys() {
    let term = String(ctx.term).trim();
    if (/^\d+$/.test(term)) term = 'term' + term;
    const week = parseInt(String(ctx.week).replace(/\D/g, ''), 10);
    const day = parseInt(String(ctx.day).replace(/\D/g, ''), 10);
    if (!term || isNaN(week) || isNaN(day)) {
      throw new Error('Invalid term/week/day: ' + [ctx.term, ctx.week, ctx.day].join('/'));
    }
    return { term, week, day, dayId: `${term}-w${week}-d${day}`, shortId: `w${week}-d${day}` };
  }

  function persistPoints() {
    if (!ctx) return;
    try {
      const k = keys();
      const termScores = Store.getScores(ctx.lrn)[k.term] || {};
      const existing = (termScores.daily || {})[k.shortId] || {};
      Store.saveScore(ctx.lrn, k.term, 'daily', k.shortId, {
        points: Math.max(existing.points || 0, ctx.points),
        week: k.week, day: k.day, updatedAt: new Date().toISOString()
      });
    } catch (err) { logError('persistPoints', err); }
  }

  function saveActivityScore(containerId, scorePercent) {
    if (!ctx) return;
    try {
      const k = keys();
      const termScores = Store.getScores(ctx.lrn)[k.term] || {};
      const existing = (termScores.activity || {})[k.shortId] || {};
      const pct = Math.round(scorePercent);
      Store.saveScore(ctx.lrn, k.term, 'activity', k.shortId, {
        activity: containerId,
        bestScore: Math.max(existing.bestScore || 0, pct),
        lastScore: pct,
        passed: !!existing.passed || pct >= PASS_PERCENT,
        attempts: (existing.attempts || 0) + 1,
        updatedAt: new Date().toISOString()
      });
    } catch (err) { logError('saveActivityScore', err); }
  }

  // true kung bagong badge
  function saveBadge(badgeId) {
    const k = keys();
    const all = Store.getBadges(ctx.lrn) || {};
    const current = Array.isArray(all[k.term]) ? all[k.term].slice() : [];
    if (current.includes(badgeId)) return false;
    current.push(badgeId);
    Store.saveBadges(ctx.lrn, k.term, current);
    return true;
  }

  // Marks the day in Store (once per page load) — returns true on success
  function markDayComplete() {
    if (!ctx) return false;
    if (dayMarked) return true;
    try {
      if (typeof Store === 'undefined' || typeof Store.getProgress !== 'function' || typeof Store.saveProgress !== 'function') {
        throw new Error('Store.getProgress/saveProgress is not available');
      }
      const k = keys();
      const progress = Store.getProgress(ctx.lrn) || {};
      const completed = Array.isArray((progress[k.term] || {}).completed) ? progress[k.term].completed.slice() : [];
      if (!completed.includes(k.dayId)) {
        completed.push(k.dayId);
        console.info('[Lesson] saving completed day', k.dayId);
        Store.saveProgress(ctx.lrn, k.term, { completed: completed });
      }
      // I-verify na talagang naisulat
      const check = ((Store.getProgress(ctx.lrn) || {})[k.term] || {}).completed || [];
      if (!check.includes(k.dayId)) throw new Error('Progress did not persist (' + k.dayId + ')');
      dayMarked = true;
      return true;
    } catch (err) {
      logError('markDayComplete', err);
      const detail = (err && err.message) ? err.message : String(err);
      toast('⚠️ Hindi na-save ang progress: ' + detail, 'error', 12000);
      return false;
    }
  }

  function completeDayAndLeave() {
    if (!markDayComplete()) return;
    toast('✅ Day completed!', 'success', 3000);
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
  }

  // Single exit point for every activity
  function finishActivity(containerId, scorePercent, config) {
    saveActivityScore(containerId, scorePercent);
    reportScore(containerId, scorePercent);
    if (scorePercent >= PASS_PERCENT) {
      if (config && config.badgeId) awardBadge(config.badgeId, config.badgeName || 'Badge', config.badgeIcon || '🏅');
      completeDayAndLeave();
    }
  }

  /* ---------- score bar ---------- */

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
    clearInterval(liveTimerHandle);
    liveTimerHandle = setInterval(() => {
      const s = Math.floor((Date.now() - ctx.startTime) / 1000);
      el.textContent = fmt(s);
    }, 1000);
  }

  function addPts(n) {
    if (!ctx || !n) return;
    ctx.points = Math.max(0, ctx.points + n);
    const el = document.getElementById('sb-points');
    if (el) {
      el.textContent = ctx.points;
      el.style.transform = 'scale(1.3)';
      setTimeout(() => (el.style.transform = 'scale(1)'), 200);
    }
    persistPoints();
  }

  function awardBadge(id, name, icon) {
    if (!ctx || ctx.badges.includes(id)) return;
    try {
      if (saveBadge(id)) {
        ctx.badges.push(id);
        const el = document.getElementById('sb-badges');
        if (el) el.textContent = ctx.badges.length;
        toast(`🏆 Badge earned: ${icon} ${name}`, 'success', 4000);
      }
    } catch (err) { logError('awardBadge', err); }
  }

  /* ---------- loading overlay ---------- */

  function showLoadingOverlay() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'lesson-loading-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
    overlay.innerHTML = '<div style="text-align:center;"><div style="font-size:2.5rem;">⏳</div><div style="font-size:1.1rem;font-weight:600;color:#0d47a1;margin-top:12px;">Loading activities...</div></div>';
    document.body.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (overlay) overlay.remove();
  }

  function showTimeoutError() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (!overlay) return;
    overlay.innerHTML = '<div style="text-align:center;"><div style="font-size:2.5rem;">📡</div><div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection</div></div>';
  }

  /* ============================================================
     MATCH GAME
     ============================================================ */
  function renderMatchGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const pairs = config.pairs;
    const timeLimit = config.timeLimit;
    const pointsCorrect = config.pointsCorrect !== undefined ? config.pointsCorrect : 10;
    const pointsWrong = config.pointsWrong !== undefined ? config.pointsWrong : -3;
    const bonusFast = config.bonusFast !== undefined ? config.bonusFast : 15;

    const leftItems = shuffle(pairs.map((p, i) => ({ left: p.left, right: p.right, id: i })));
    const rightItems = shuffle(pairs.map((p, i) => ({ left: p.left, right: p.right, id: i })));

    let selectedLeft = null;
    let matches = 0, timeLeft = timeLimit, timerInterval = null;
    let finished = false, busy = false;

    const handle = {
      finished: false,
      stop() { finished = true; handle.finished = true; clearInterval(timerInterval); }
    };
    activeGames[containerId] = handle;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🔗 Match the pairs</span>
        <span class="activity-timer" id="match-timer">${fmt(timeLeft)}</span>
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
    const timerEl = container.querySelector('#match-timer');

    leftItems.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'match-item';
      el.textContent = item.left;
      el.dataset.id = item.id;
      el.addEventListener('click', () => {
        if (finished || busy || el.classList.contains('correct')) return;
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
        if (finished || busy || !selectedLeft || el.classList.contains('correct')) return;

        const leftRef = selectedLeft;
        if (leftRef.dataset.id === el.dataset.id) {
          leftRef.classList.remove('selected');
          leftRef.classList.add('correct');
          el.classList.add('correct');
          selectedLeft = null;
          matches++;
          addPts(pointsCorrect);
          if (scoreEl) scoreEl.textContent = `Matches: ${matches} / ${pairs.length}`;
          if (matches === pairs.length) endGame('complete');
        } else {
          busy = true;
          selectedLeft = null;
          addPts(pointsWrong);
          el.classList.add('wrong');
          leftRef.classList.add('wrong');
          setTimeout(() => {
            el.classList.remove('wrong');
            leftRef.classList.remove('wrong', 'selected');
            busy = false;
          }, 500);
        }
      });
      rightEl.appendChild(el);
    });

    function endGame(reason) {
      if (finished) return;
      const timeRemaining = timeLeft;
      handle.stop();
      if (reason === 'complete' && timeRemaining > timeLimit / 2) addPts(bonusFast);
      const scorePercent = Math.round((matches / pairs.length) * 100);
      if (scorePercent >= PASS_PERCENT) toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else toast(`📖 Score: ${scorePercent}% — need ${PASS_PERCENT}% to pass.`, 'warning', 4000);
      finishActivity(containerId, scorePercent, config);
    }

    timerInterval = setInterval(() => {
      if (finished) return;
      timeLeft--;
      if (timerEl) timerEl.textContent = fmt(Math.max(0, timeLeft));
      if (timeLeft <= 0) endGame('timeout');
    }, 1000);
  }

  /* ============================================================
     SCENARIO GAME
     ============================================================ */
  function renderScenarioGameNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const scenarios = config.scenarios;
    const timeLimit = config.timeLimit || 300;
    const pointsCorrect = config.pointsCorrect !== undefined ? config.pointsCorrect : 10;
    let index = 0, correct = 0, finished = false;
    let totalTimeLeft = timeLimit, overallTimer = null;

    const handle = {
      finished: false,
      stop() { finished = true; handle.finished = true; clearInterval(overallTimer); }
    };
    activeGames[containerId] = handle;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🎯 Scenario Challenge</span>
        <span class="activity-timer" id="scenario-overall-timer">${fmt(totalTimeLeft)}</span>
      </div>
      <div id="scenario-body"></div>
    `;

    overallTimer = setInterval(() => {
      if (finished) return;
      totalTimeLeft--;
      const el = container.querySelector('#scenario-overall-timer');
      if (el) el.textContent = fmt(Math.max(0, totalTimeLeft));
      if (totalTimeLeft <= 0) endGame('timeout');
    }, 1000);

    renderCard();

    function renderCard() {
      if (finished) return;
      if (index >= scenarios.length) return endGame('complete');
      const sc = scenarios[index];
      const body = container.querySelector('#scenario-body');
      if (!body) return;
      body.innerHTML = `
        <div class="scenario-card">
          <p class="scenario-text">${sc.text}</p>
          <div class="choice-row" id="choice-row"></div>
        </div>
        <div class="text-center mt-md"><span class="badge badge-info">Question ${index + 1} / ${scenarios.length} · Correct: ${correct}</span></div>
      `;
      const row = body.querySelector('#choice-row');
      let answered = false;
      sc.choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice.label;
        btn.addEventListener('click', () => {
          if (finished || answered) return;
          answered = true;
          container.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
          if (choice.correct) { btn.classList.add('correct'); correct++; addPts(pointsCorrect); }
          else { btn.classList.add('wrong'); }
          setTimeout(() => { index++; renderCard(); }, 1000);
        });
        row.appendChild(btn);
      });
    }

    function endGame(reason) {
      if (finished) return;
      handle.stop();
      const scorePercent = Math.round((correct / scenarios.length) * 100);
      if (scorePercent >= PASS_PERCENT) toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else toast(`📖 Score: ${scorePercent}% — need ${PASS_PERCENT}% to pass.`, 'warning', 4000);
      finishActivity(containerId, scorePercent, config);
    }
  }

  /* ============================================================
     ESCAPE ROOM
     ============================================================ */
  function renderEscapeRoomNow(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const questions = config.questions;
    const lives = config.lives !== undefined ? config.lives : 3;
    const timeLimit = config.timeLimit || 300;
    const pointsCorrect = config.pointsCorrect !== undefined ? config.pointsCorrect : 10;
    let currentLives = lives, earnedKeys = 0, index = 0, locked = false, finished = false;
    let timeLeft = timeLimit, timerInterval = null;

    const handle = {
      finished: false,
      stop() { finished = true; handle.finished = true; clearInterval(timerInterval); }
    };
    activeGames[containerId] = handle;

    function renderQuestion() {
      if (finished) return;
      if (index >= questions.length) return endGame('complete');

      const q = questions[index];
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div><div class="score-bar-label">Q ${index + 1} / ${questions.length} · 🔑 ${earnedKeys} · ❤️ ${currentLives}</div></div>
            <div class="activity-timer" id="escape-timer">${fmt(Math.max(0, timeLeft))}</div>
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
          if (locked || finished) return;
          locked = true;
          container.querySelectorAll('.escape-option').forEach(b => b.disabled = true);
          if (c.correct) { btn.classList.add('correct'); earnedKeys++; addPts(pointsCorrect); }
          else { btn.classList.add('wrong'); currentLives--; }
          setTimeout(() => {
            locked = false;
            if (finished) return;
            if (currentLives <= 0) return endGame('no-lives');
            index++;
            renderQuestion();
          }, 1000);
        });
        opts.appendChild(btn);
      });
    }

    function endGame(reason) {
      if (finished) return;
      handle.stop();
      const scorePercent = Math.round((earnedKeys / questions.length) * 100);
      if (scorePercent >= PASS_PERCENT) toast(`🎉 Passed! ${scorePercent}%`, 'success', 4000);
      else toast(`📖 Score: ${scorePercent}% — need ${PASS_PERCENT}% to pass.`, 'warning', 4000);
      finishActivity(containerId, scorePercent, config);
    }

    renderQuestion();
    timerInterval = setInterval(() => {
      if (finished) return;
      timeLeft--;
      const el = container.querySelector('#escape-timer');
      if (el) el.textContent = fmt(Math.max(0, timeLeft));
      if (timeLeft <= 0) endGame('timeout');
    }, 1000);
  }

  return {
    init,
    renderMatchGame: registerMatchGame,
    renderScenarioGame: registerScenarioGame,
    renderEscapeRoom: registerEscapeRoom
  };
})();

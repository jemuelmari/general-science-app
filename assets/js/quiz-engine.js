/* ============================================================
   quiz-engine.js — Quiz / ST / TE engine
   Version: 2.3.0
   Changelog v2.3.0:
     - FIX: Term Exam score was never found (saved as scores.te.te) → a student
       who already passed the TE could take it again. Now read correctly.
     - FIX: when TIME RAN OUT the attempt was locked and labelled
       "tab-switch / Tampered" even if the student PASSED. Time-up now just
       submits; it locks only when the score is below passing.
     - FIX: reloading the page restarted the timer and the tab-switch count.
       The deadline, answers and switch count are now kept in localStorage
       (per student + assessment) and resumed; the timer uses the real clock,
       so it keeps running while the phone screen is off.
       If the deadline passed while away, the saved answers are submitted.
     - FIX: if randomize.js cannot load, the exam does NOT start with the old
       random shuffle any more (that made online ≠ printed Set A/B and broke
       the evidence). The student sees a "Retry" message instead.
     - Passing score from CONFIG.PASSING_PERCENT (70).
   Changelog v2.2.0 (Exam <-> Evidence <-> Print alignment):
     - FIX: assessment pages never loaded randomize.js, so every attempt
       silently used the legacy Math.random() shuffle (different question
       AND option order per student/attempt, not Set A/B, not equal to
       the printed copies). The engine now loads randomize.js itself.
     - FIX: legacy fallback wrote originalIndex = shown position (wrong).
       It now stores the real bank index.
     - FIX: "Review Your Answers" looked questions up by originalIndex,
       which showed the wrong question beside each result. It now
       resolves by questionId and shows choices in the order the student saw.
   Changelog v2.1.1: Pushes failed locks to backend via
                     Sync.pushLock so teacher's Locked Assessments
                     page sees them.
   ============================================================ */

const QuizEngine = (() => {
  'use strict';

  const PASS_THRESHOLD = (typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70;
  const AUTOSAVE_INTERVAL = 10000;

  let ctx = null;
  let timer = null;
  let autosaveTimer = null;
  let tabMonitor = null;
  let shuffledSet = null;
  let answers = {};
  let currentIndex = 0;
  let startTime = null;
  let submitting = false;

  async function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../login.html';
      return;
    }

    const setLetter = _getSetLetter(user.section);

    ctx = {
      lrn: user.lrn,
      section: user.section,
      setLetter: setLetter,
      term: config.term,
      type: config.type,
      id: config.id,
      title: config.title,
      questions: config.questions,
      timeLimit: config.timeLimit,
      passScore: config.passScore || PASS_THRESHOLD,
      showResults: config.showResults !== false,
      allowRetake: config.allowRetake === true
    };

    // Another device may already hold a score / lock for this assessment: pull first
    // (max 4s, silent when offline), THEN apply any teacher unlock on top of it.
    try {
      if (typeof Store.pullNow === 'function') {
        await Promise.race([Store.pullNow({ force: true }), new Promise(function (r) { setTimeout(r, 4000); })]);
      }
    } catch (e) { /* offline / server busy: continue with this device's data */ }

    await _checkBackendUnlocks(ctx.lrn);

    if (Store.isAssessmentLocked(ctx.lrn, `${ctx.term}_${ctx.id}`)) {
      renderLocked();
      return;
    }

    const scores = Store.getScores(ctx.lrn);
    const prev = _getPrevScore(scores, ctx.term, ctx.type, ctx.id);

    if (prev && prev.score !== undefined && prev.percent >= ctx.passScore) {
      renderPassedReview(prev);
      return;
    }

    if (prev && prev.percent !== undefined && prev.percent < ctx.passScore) {
      renderRetryScreen(prev);
      return;
    }

    renderIntro();
  }

  async function _checkBackendUnlocks(lrn) {
    if (typeof Sync === 'undefined' || typeof Sync.pullUnlocks !== 'function') return;
    if (typeof CONFIG === 'undefined' || !CONFIG.backendEnabled) return;

    try {
      var res = await Sync.pullUnlocks(lrn);
      if (!res || !res.ok || !res.records || !res.records.length) return;

      res.records.forEach(function (u) {
        var lockKey = u.term + '_' + u.assessment;
        // always apply (tombstone), even if this device holds no lock (see sync-auto.js v1.3.0)
        Store.unlockAssessment(lrn, lockKey);
        console.log('[QuizEngine] 🔓 Remote unlock applied:', lockKey);
        if (typeof Sync.markUnlockApplied === 'function') {
          Sync.markUnlockApplied(u.unlockId).catch(function () {});
        }
      });
    } catch (e) {
      console.warn('[QuizEngine] Unlock check failed:', e.message);
    }
  }

  /* ---------- v2.2.0 helpers ---------- */
  function _ensureRandomize() {
    if (typeof Randomize !== 'undefined' && Randomize.generateSet) return Promise.resolve(true);
    return new Promise(function (resolve) {
      try {
        var me = document.querySelector('script[src*="quiz-engine.js"]');
        if (!me) { resolve(false); return; }
        var el = document.createElement('script');
        el.src = me.src.replace(/quiz-engine\.js(\?.*)?$/, 'randomize.js?v=1.5.0');
        el.onload = function () { resolve(typeof Randomize !== 'undefined'); };
        el.onerror = function () { resolve(false); };
        document.head.appendChild(el);
      } catch (e) { resolve(false); }
    });
  }

  function _resolveQuestion(r) {
    var qs = (ctx && ctx.questions) || [];
    if (r.questionId != null) {
      var byId = qs.filter(function (q) { return String(q.id) === String(r.questionId); })[0];
      if (byId) return byId;
    }
    if (r.expected != null) {
      var byKey = qs.filter(function (q) { return q.correct === r.expected; });
      if (byKey.length === 1) return byKey[0];
    }
    return null;
  }

  function _displayOptions(q, r) {
    var oo = r && r.oo;
    if (Array.isArray(oo) && oo.length === q.options.length) {
      var ok = oo.every(function (k) { return k >= 0 && k < q.options.length; });
      if (ok) return oo.map(function (k) { return q.options[k]; });
    }
    return q.options;
  }

  function _getSetLetter(section) {
    if (typeof CONFIG !== 'undefined' && CONFIG.SET_ASSIGNMENT && CONFIG.SET_ASSIGNMENT[section]) {
      return CONFIG.SET_ASSIGNMENT[section];
    }
    return 'A';
  }

  function _getPrevScore(scores, term, type, id) {
    if (!scores || !scores[term]) return null;
    const t = scores[term];
    if (type === 'te') return (t.te && t.te.te) || (t.te && t.te.score !== undefined ? t.te : null);
    if ((type === 'st' || type === 'st1' || type === 'st2') && t.st) return t.st[id] || null;
    if (type === 'quizzes' && t.quizzes) return t.quizzes[id] || null;
    if (t[type] && t[type][id]) return t[type][id];
    return null;
  }

  function renderIntro() {
    const container = document.getElementById('quiz-root');
    if (!container) return;
    const mins = Math.round(ctx.timeLimit / 60);

    container.innerHTML = `
      <div class="card" style="max-width:640px;margin:0 auto;">
        <div class="card-header">
          <span class="card-title">📝 ${ctx.title}</span>
        </div>
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:3rem;">📝</div>
          <h2 style="color:var(--color-primary-dark);margin:12px 0;">${ctx.title}</h2>
          <p class="text-muted">${ctx.questions.length} items · ${mins} minutes · Set ${ctx.setLetter}</p>
        </div>
        <div class="alert alert-info">
          <strong>📋 Instructions</strong>
          <ul style="margin:8px 0 0 20px;font-size:0.9rem;">
            <li>Answer all questions within ${mins} minutes.</li>
            <li>You need <strong>${ctx.passScore}%</strong> to pass.</li>
            <li>Copying, pasting, and switching tabs are disabled.</li>
            <li>Your answers are saved on this device as you go. If the page reloads, you continue where you stopped — but the timer keeps running.</li>
            <li>3 tab-switches will lock your attempt.</li>
          </ul>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button id="quiz-start" class="btn btn-primary btn-full">▶️ Start Assessment</button>
          <a href="javascript:history.back()" class="btn btn-outline" style="flex:0 0 auto;">Cancel</a>
        </div>
      </div>
    `;
    document.getElementById('quiz-start').addEventListener('click', startQuiz);
  }

  function renderPassedReview(prev) {
    const container = document.getElementById('quiz-root');
    if (!container) return;
    const itemResults = prev.itemResults || [];
    const correctCount = prev.score || 0;
    const total = prev.total || ctx.questions.length;
    const percent = prev.percent || Math.round((correctCount / total) * 100);
    const timeUsed = prev.timeUsed != null ? APP.formatTime(prev.timeUsed) : '—';
    const completedAt = prev.timestamp ? APP.formatDate(prev.timestamp) : '—';
    const emoji = percent >= 90 ? '🏆' : '🎉';
    const titleText = percent >= 90 ? 'Mastered!' : 'Passed!';

    let itemAnalysisHTML = '';
    if (itemResults.length) {
      itemAnalysisHTML = itemResults.map((r, i) => {
        const q = _resolveQuestion(r);
        if (!q) return '';
        const isCorrect = r.correct;
        const given = r.given;
        const expected = r.expected || q.correct;
        return `
          <div style="padding:14px 16px;margin-bottom:10px;background:#fff;border-radius:10px;border-left:4px solid ${isCorrect ? '#2e7d32' : '#c62828'};box-shadow:0 1px 4px rgba(0,0,0,0.04);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
              <div style="font-weight:700;font-size:0.85rem;color:#5f6368;">Q${i + 1}</div>
              <span style="font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:999px;background:${isCorrect ? '#e8f5e9' : '#ffebee'};color:${isCorrect ? '#1b5e20' : '#b71c1c'};">
                ${isCorrect ? '✅ Correct' : '❌ Wrong'}
              </span>
            </div>
            <div style="font-size:0.9rem;color:#1a1a1a;line-height:1.5;margin-bottom:10px;">${q.text}</div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:0.82rem;">
              ${_displayOptions(q, r).map((opt) => {
                const isExpected = opt === expected;
                const isGiven = opt === given;
                let bg = '#f9fafb';
                let border = '1px solid #e0e0e0';
                let color = '#5f6368';
                let icon = '';
                if (isExpected) { bg = '#e8f5e9'; border = '1px solid #2e7d32'; color = '#1b5e20'; icon = ' ✓'; }
                else if (isGiven && !isCorrect) { bg = '#ffebee'; border = '1px solid #c62828'; color = '#b71c1c'; icon = ' ✗'; }
                return `<div style="padding:6px 10px;border-radius:6px;background:${bg};border:${border};color:${color};">${opt}${icon}</div>`;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');
    } else {
      itemAnalysisHTML = `<div class="alert alert-info"><strong>ℹ️ No item-level data</strong><p style="margin-top:6px;font-size:0.85rem;">This attempt was submitted before item tracking was enabled.</p></div>`;
    }

    container.innerHTML = `
      <div class="card quiz-result-card" style="max-width:800px;margin:0 auto;">
        <span class="quiz-result-emoji">${emoji}</span>
        <h2 class="quiz-result-title passed">${titleText}</h2>
        <p class="quiz-result-message">${ctx.title} · Completed ${completedAt}</p>
        <div class="quiz-result-stats">
          <div><div style="font-size:2rem;font-weight:800;color:#2e7d32;">${correctCount}</div><div class="text-small text-muted">Correct</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:#5f6368;">${total - correctCount}</div><div class="text-small text-muted">Wrong</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:#2e7d32;">${percent}%</div><div class="text-small text-muted">Score</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:#5f6368;">${timeUsed}</div><div class="text-small text-muted">Time Used</div></div>
        </div>
        <div class="alert alert-success" style="text-align:left;">
          <strong>✅ You have already passed this assessment.</strong>
          <p style="margin-top:6px;font-size:0.88rem;">This is a read-only review of your previous attempt.</p>
        </div>
        <div style="text-align:left;margin-top:28px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span style="display:inline-block;width:4px;height:20px;background:linear-gradient(180deg,#0d47a1,#00acc1);border-radius:2px;"></span>
            <h3 style="margin:0;font-size:1.1rem;color:#0d47a1;">📋 Review Your Answers</h3>
          </div>
          ${itemAnalysisHTML}
        </div>
        <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
          <a href="../../student/dashboard.html" class="btn btn-primary" style="flex:1;">🏠 Back to Dashboard</a>
          <a href="javascript:history.back()" class="btn btn-outline" style="flex:1;">← Back to Assessments</a>
        </div>
      </div>
    `;
  }

  function renderRetryScreen(prev) {
    const container = document.getElementById('quiz-root');
    if (!container) return;
    const percent = prev.percent || 0;

    container.innerHTML = `
      <div class="card" style="max-width:640px;margin:0 auto;">
        <div class="card-header"><span class="card-title">📝 ${ctx.title}</span></div>
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:3rem;">📖</div>
          <h2 style="color:var(--color-primary-dark);margin:12px 0;">Previous Attempt</h2>
          <p class="text-muted">Your previous score: <strong>${percent}%</strong> (${prev.score}/${prev.total})</p>
          <p class="text-muted text-small">Passing score: ${ctx.passScore}%</p>
        </div>
        <div class="alert alert-warning" style="text-align:left;">
          <strong>📖 Below passing score</strong>
          <p style="margin-top:6px;font-size:0.88rem;">Please review your previous attempt below, then try again when ready.</p>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button id="quiz-retry" class="btn btn-primary" style="flex:1;">🔄 Retake Now</button>
          <a href="javascript:history.back()" class="btn btn-outline" style="flex:1;">← Back to Assessments</a>
        </div>
      </div>
    `;
    document.getElementById('quiz-retry').addEventListener('click', () => renderIntro());
  }

  async function startQuiz() {
    const ok = await _ensureRandomize();
    shuffledSet = null;
    try {
      if (ok && typeof Randomize !== 'undefined' && Randomize.generateSet) {
        const assessmentId = ctx.term + '-' + ctx.id;
        shuffledSet = Randomize.generateSet({ questions: ctx.questions }, assessmentId, ctx.setLetter);
      }
    } catch (e) {
      console.warn('[QuizEngine] Randomize failed:', e.message);
      shuffledSet = null;
    }

    if (!shuffledSet) {
      // Never fall back to a random per-student shuffle: the online copy must
      // equal the printed Set A/B and the exam evidence.
      const container = document.getElementById('quiz-root');
      container.innerHTML = `
        <div class="card" style="max-width:560px;margin:0 auto;text-align:center;padding:32px;">
          <div style="font-size:2.5rem;">📶</div>
          <h3 style="margin:10px 0;">Could not prepare your test set</h3>
          <p class="text-muted">Please check your internet connection, then tap Retry. Your time has not started.</p>
          <button id="quiz-retry-load" class="btn btn-primary" style="margin-top:14px;">🔄 Retry</button>
        </div>`;
      document.getElementById('quiz-retry-load').addEventListener('click', startQuiz);
      return;
    }

    // Resume an attempt that was interrupted (reload, closed tab, dead battery)
    const saved = _loadAttemptState();
    answers = (saved && saved.answers) || {};
    currentIndex = (saved && saved.currentIndex) || 0;
    const now = Date.now();
    const deadline = (saved && saved.deadline) || (now + ctx.timeLimit * 1000);
    startTime = (saved && saved.startedAt) || now;
    const switches = (saved && saved.switches) || 0;
    _saveAttemptState({ deadline: deadline, startedAt: startTime, switches: switches });
    if (saved) APP.toast('💾 Resumed your attempt — the timer kept running.', 'info', 3500);

    document.body.classList.add('quiz-active');
    Security.disableCopyPaste(document);
    Security.disableDevShortcuts();

    if (deadline <= now) {
      // Time ran out while the student was away: submit what was saved
      renderQuizShell();
      renderQuestion();
      APP.toast('⏰ Time ran out while you were away. Submitting your saved answers…', 'warning', 4000);
      submitQuiz(false, 'time-up');
      return;
    }

    tabMonitor = Security.startTabMonitor((count, isFinal) => {
      _saveAttemptState({ switches: count });
      if (isFinal) {
        APP.toast('❌ Too many tab switches. Quiz locked.', 'danger', 4000);
        submitQuiz(true, 'tab-switch');
      } else {
        APP.toast(`⚠️ Tab switch detected (${count}/3)`, 'warning', 2500);
      }
    }, 3, switches);

    timer = _clockTimer(deadline, updateTimerDisplay, () => {
      APP.toast('⏰ Time is up! Submitting...', 'warning', 3000);
      submitQuiz(false, 'time-up');
    });

    autosaveTimer = setInterval(saveProgress, AUTOSAVE_INTERVAL);

    renderQuizShell();
    renderQuestion();
  }

  /* ---------- v2.3.0: attempt state that survives reloads ---------- */
  function _stateKey() { return 'gsa_v1_attempt_' + ctx.lrn + '_' + ctx.term + '_' + ctx.id; }
  function _loadAttemptState() {
    try {
      const raw = localStorage.getItem(_stateKey());
      if (!raw) return null;
      const st = JSON.parse(raw);
      // stale state (older than time limit + 1 day) is ignored
      if (!st || !st.deadline || (Date.now() - st.deadline) > 86400000) return null;
      if (st.setLetter && st.setLetter !== ctx.setLetter) return null;
      return st;
    } catch (e) { return null; }
  }
  function _saveAttemptState(patch) {
    try {
      const cur = _loadAttemptState() || {};
      const next = Object.assign(cur, patch, { setLetter: ctx.setLetter });
      localStorage.setItem(_stateKey(), JSON.stringify(next));
    } catch (e) { /* storage full: attempt still works, just not resumable */ }
  }
  function _clearAttemptState() { try { localStorage.removeItem(_stateKey()); } catch (e) {} }

  // Timer based on the real clock (keeps counting while the screen is off)
  function _clockTimer(deadline, onTick, onExpire) {
    let done = false;
    const left = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const tick = () => {
      if (done) return;
      const r = left();
      onTick && onTick(r);
      if (r <= 0) { done = true; clearInterval(iv); onExpire && onExpire(); }
    };
    const iv = setInterval(tick, 1000);
    setTimeout(tick, 0);
    return { stop: () => { done = true; clearInterval(iv); }, getRemaining: left };
  }

  function renderQuizShell() {
    const container = document.getElementById('quiz-root');
    container.innerHTML = `
      <div class="card" style="max-width:720px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:0.75rem;color:#5f6368;text-transform:uppercase;letter-spacing:0.5px;">${ctx.title} · Set ${ctx.setLetter}</div>
            <div style="font-weight:700;color:var(--color-primary-dark);">Question <span id="q-current">1</span> of ${shuffledSet.questions.length}</div>
          </div>
          <div class="activity-timer" id="quiz-timer" style="font-family:'Consolas',monospace;font-size:1.1rem;">--:--</div>
        </div>
        <div class="progress-bar" style="margin-bottom:20px;">
          <div class="progress-fill" id="quiz-progress" style="width:0%;"></div>
        </div>
        <div id="question-body"></div>
        <div id="quiz-nav" style="display:flex;gap:8px;margin-top:20px;"></div>
        <div class="autosave-indicator" id="autosave-indicator"></div>
        <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;">
          <button id="quiz-prev" class="btn btn-outline" style="flex:1;">← Previous</button>
          <button id="quiz-next" class="btn btn-primary" style="flex:1;">Next →</button>
        </div>
        <div style="text-align:center;margin-top:16px;">
          <button id="quiz-submit" class="btn btn-accent" style="padding:12px 32px;">✅ Submit Assessment</button>
        </div>
      </div>
    `;
    document.getElementById('quiz-prev').addEventListener('click', () => goTo(currentIndex - 1));
    document.getElementById('quiz-next').addEventListener('click', () => goTo(currentIndex + 1));
    document.getElementById('quiz-submit').addEventListener('click', confirmSubmit);
    renderNav();
  }

  function renderQuestion() {
    const q = shuffledSet.questions[currentIndex];
    const body = document.getElementById('question-body');
    if (!body) return;

    body.innerHTML = `
      <div style="padding:16px 0;">
        <div style="font-size:1.05rem;font-weight:600;color:#1a1a1a;margin-bottom:16px;">${currentIndex + 1}. ${q.text}</div>
        <div id="options" style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
    `;

    const optionsEl = document.getElementById('options');
    q.options.forEach((opt) => {
      const isSelected = answers[currentIndex] === opt;
      const optEl = document.createElement('label');
      optEl.className = 'quiz-option';
      optEl.style.cssText = `display:flex;align-items:center;gap:12px;padding:14px 16px;border:2px solid ${isSelected ? 'var(--color-primary)' : '#dadce0'};border-radius:10px;cursor:pointer;transition:all 0.15s ease;background:${isSelected ? 'var(--color-primary-light)' : '#fff'};`;
      optEl.innerHTML = `<input type="radio" name="q-${currentIndex}" value="${escapeHtml(opt)}" ${isSelected ? 'checked' : ''} /><span style="font-size:0.95rem;">${escapeHtml(opt)}</span>`;
      optEl.addEventListener('click', () => selectAnswer(opt));
      optionsEl.appendChild(optEl);
    });

    document.getElementById('q-current').textContent = currentIndex + 1;
    document.getElementById('quiz-progress').style.width = `${((currentIndex + 1) / shuffledSet.questions.length) * 100}%`;
    document.getElementById('quiz-prev').disabled = currentIndex === 0;
    document.getElementById('quiz-next').disabled = currentIndex === shuffledSet.questions.length - 1;
    renderNav();
  }

  function selectAnswer(opt) {
    answers[currentIndex] = opt;
    renderQuestion();
    saveProgress();
  }

  function goTo(index) {
    if (index < 0 || index >= shuffledSet.questions.length) return;
    currentIndex = index;
    renderQuestion();
  }

  function renderNav() {
    const nav = document.getElementById('quiz-nav');
    if (!nav) return;
    nav.innerHTML = '';
    nav.style.flexWrap = 'wrap';
    shuffledSet.questions.forEach((_, i) => {
      const dot = document.createElement('span');
      const isCurrent = i === currentIndex;
      const isAnswered = answers[i] !== undefined;
      dot.className = `quiz-dot ${isCurrent ? 'current' : isAnswered ? 'answered' : 'unanswered'}`;
      dot.textContent = i + 1;
      dot.addEventListener('click', () => goTo(i));
      nav.appendChild(dot);
    });
  }

  function updateTimerDisplay(remaining) {
    const el = document.getElementById('quiz-timer');
    if (!el) return;
    el.textContent = APP.formatTime(Math.max(0, remaining));
    if (remaining <= 60) { el.style.color = 'var(--color-danger)'; el.style.fontWeight = '800'; }
    else if (remaining <= 300) { el.style.color = 'var(--color-warning)'; }
  }

  function saveProgress() {
    if (!ctx) return;
    try {
      _saveAttemptState({ answers: answers, currentIndex: currentIndex, savedAt: Date.now() });
      const ind = document.getElementById('autosave-indicator');
      if (ind) { ind.textContent = '💾 Progress saved'; ind.style.opacity = '1'; setTimeout(() => { ind.style.opacity = '0'; }, 1500); }
    } catch (e) { /* ignore */ }
  }

  function confirmSubmit() {
    const unanswered = shuffledSet.questions.length - Object.keys(answers).length;
    const msg = unanswered > 0
      ? `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`
      : 'Submit your assessment now?';
    if (confirm(msg)) submitQuiz(false);
  }

  async function submitQuiz(forceLock, why) {
    if (submitting) return;
    submitting = true;

    timer?.stop();
    tabMonitor?.stop();
    clearInterval(autosaveTimer);

    let scoreResult;
    if (typeof Randomize !== 'undefined' && Randomize.scoreAttempt) {
      scoreResult = Randomize.scoreAttempt(answers, shuffledSet);
    } else {
      let correct = 0;
      const itemResults = [];
      shuffledSet.questions.forEach((q, i) => {
        const given = answers[i];
        const isCorrect = given === q.correct;
        if (isCorrect) correct++;
        itemResults.push({
          index: i, originalIndex: q.originalIndex != null ? q.originalIndex : i,
          questionId: q.id || null, correct: isCorrect, given: given || null,
          expected: q.correct, competency: q.competency || null, bloomLevel: q.bloomLevel || null
        });
      });
      const total = shuffledSet.questions.length;
      scoreResult = { correct, total, percent: Math.round((correct / total) * 100), itemResults };
    }

    const scorePercent = scoreResult.percent;
    const passed = scorePercent >= ctx.passScore;
    const timeUsed = Math.min(ctx.timeLimit, Math.round((Date.now() - (startTime || Date.now())) / 1000));
    const timestamp = new Date().toISOString();
    const user = Store.getCurrentUser();

    const payload = {
      score: scoreResult.correct, total: scoreResult.total, percent: scorePercent, passed,
      timeUsed, itemResults: scoreResult.itemResults, set: ctx.setLetter, timestamp
    };

    Store.saveScore(ctx.lrn, ctx.term, ctx.type, ctx.id, payload);
    console.log('[QuizEngine] Score saved:', ctx.term, ctx.id, '=', scorePercent + '%', passed ? '(PASS)' : '(FAIL)');

    try {
      if (typeof SyncAuto !== 'undefined' && SyncAuto.enqueue) {
        SyncAuto.enqueue(ctx.lrn, ctx.term, ctx.id, {
          score: payload.score, total: payload.total,
          itemResults: payload.itemResults, set: payload.set, timestamp: payload.timestamp
        });
      }
    } catch (e) {
      console.warn('[QuizEngine] Auto-enqueue failed:', e.message);
    }

    if (!passed || forceLock) {
      const lockKey = `${ctx.term}_${ctx.id}`;
      const reason = forceLock ? 'tab-switch' : 'failed';
      Store.lockAssessment(ctx.lrn, lockKey, reason, scorePercent);
      console.log('[QuizEngine] 🔒 Locked:', lockKey, 'at', scorePercent + '%', '| Reason:', reason);

      // Push lock to backend so teacher's Locked Assessments page sees it
      try {
        if (typeof Sync !== 'undefined' && typeof Sync.pushLock === 'function' && Sync.backendEnabled()) {
          Sync.pushLock(ctx.lrn, ctx.term, ctx.id, {
            reason: reason,
            score: scorePercent,
            lockedAt: timestamp,
            student: user ? {
              lrn: user.lrn,
              firstName: user.firstName,
              lastName: user.lastName,
              middleName: user.middleName || '',
              section: user.section
            } : {}
          }).then(function (res) {
            console.log('[QuizEngine] ✅ Lock pushed to backend:', res);
          }).catch(function (e) {
            console.warn('[QuizEngine] Lock push failed:', e.message);
          });
        }
      } catch (e) {
        console.warn('[QuizEngine] Lock push error:', e.message);
      }
    }

    _clearAttemptState();
    try { sessionStorage.removeItem(`gsa_quiz_${ctx.term}_${ctx.id}`); } catch (e) {}
    document.body.classList.remove('quiz-active');
    renderResults(payload);
    submitting = false;
  }

  function renderResults(result) {
    const container = document.getElementById('quiz-root');
    const emoji = result.percent >= 90 ? '🏆' : result.percent >= PASS_THRESHOLD ? '🎉' : '📖';
    const title = result.percent >= 90 ? 'Excellent!' : result.percent >= PASS_THRESHOLD ? 'Passed!' : 'Needs Review';

    container.innerHTML = `
      <div class="card quiz-result-card" style="max-width:600px;margin:0 auto;">
        <span class="quiz-result-emoji">${emoji}</span>
        <h2 class="quiz-result-title ${result.passed ? 'passed' : 'failed'}">${title}</h2>
        <p class="quiz-result-message">${ctx.title}</p>
        <div class="quiz-result-stats">
          <div><div style="font-size:2rem;font-weight:800;color:var(--color-primary);">${result.score}</div><div class="text-small text-muted">Correct</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:var(--color-text-muted);">${result.total - result.score}</div><div class="text-small text-muted">Wrong</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:${result.passed ? 'var(--color-success)' : 'var(--color-warning)'};">${result.percent}%</div><div class="text-small text-muted">Score</div></div>
          <div><div style="font-size:2rem;font-weight:800;color:var(--color-text-muted);">${APP.formatTime(result.timeUsed)}</div><div class="text-small text-muted">Time Used</div></div>
        </div>
        ${!result.passed ? `
          <div class="alert alert-warning" style="text-align:left;margin-top:16px;">
            <strong>📖 Below passing score</strong>
            <p style="margin-top:6px;font-size:0.9rem;">You need ${ctx.passScore}% to pass. Please review the lesson and ask your teacher to unlock this assessment for a retake.</p>
          </div>
        ` : `
          <div class="alert alert-success" style="text-align:left;margin-top:16px;">
            <strong>✅ Well done!</strong>
            <p style="margin-top:6px;font-size:0.9rem;">You have successfully completed this assessment.</p>
          </div>
        `}
        <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
          <a href="../../student/dashboard.html" class="btn btn-primary" style="flex:1;">🏠 Back to Dashboard</a>
          <a href="javascript:history.back()" class="btn btn-outline" style="flex:1;">← Back to Assessments</a>
        </div>
      </div>
    `;
  }

  function renderLocked() {
    const container = document.getElementById('quiz-root');
    container.innerHTML = `
      <div class="card quiz-locked" style="max-width:520px;margin:0 auto;">
        <span class="lock-icon">🔒</span>
        <h2 style="color:var(--color-danger);">Assessment Locked</h2>
        <p class="text-muted" style="margin:12px 0;">This assessment was locked because you did not reach the passing score, or a security violation was detected.</p>
        <p class="text-small text-muted">Please ask your teacher to unlock this assessment for a retake.</p>
        <a href="../../student/dashboard.html" class="btn btn-primary mt-lg">🏠 Back to Dashboard</a>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init };
})();

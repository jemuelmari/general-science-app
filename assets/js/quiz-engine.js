/* ============================================================
   quiz-engine.js — Quiz / ST / TE engine
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Features:
   - Timed assessments with autosave every 10s
   - Anti-cheat (tab-switch detection, copy/paste disabled)
   - Question + option shuffle
   - Lock-on-fail (below passing score locks the assessment)
   - Results screen with item analysis
   - Retake only if unlocked by teacher or passing score
   ============================================================ */

const QuizEngine = (() => {
  'use strict';

  const PASS_THRESHOLD = 75;
  const AUTOSAVE_INTERVAL = 10000;

  let ctx = null;
  let timer = null;
  let autosaveTimer = null;
  let tabMonitor = null;
  let shuffled = [];
  let answers = {};
  let currentIndex = 0;
  let startTime = null;
  let submitting = false;

  /* ============================================================
     INIT
     ============================================================ */
  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../student/login.html';
      return;
    }

    ctx = {
      lrn: user.lrn,
      term: config.term,
      type: config.type,           // 'quiz' | 'st' | 'te'
      id: config.id,               // e.g. 'quiz1', 'st1', 'te'
      title: config.title,
      questions: config.questions,
      timeLimit: config.timeLimit, // seconds
      passScore: config.passScore || PASS_THRESHOLD,
      showResults: config.showResults !== false,
      allowRetake: config.allowRetake === true
    };

    // Check if already locked
    if (Store.isAssessmentLocked(ctx.lrn, `${ctx.term}_${ctx.id}`)) {
      renderLocked();
      return;
    }

    // Check previous score
    const scores = Store.getScores(ctx.lrn);
    const prev = scores[ctx.term]?.[ctx.type]?.[ctx.id];
    if (prev && prev.score >= ctx.passScore) {
      renderAlreadyPassed(prev);
      return;
    }

    renderIntro();
  }

  /* ============================================================
     INTRO SCREEN
     ============================================================ */
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
          <p class="text-muted">${ctx.questions.length} items · ${mins} minutes</p>
        </div>

        <div class="alert alert-info">
          <strong>📋 Instructions</strong>
          <ul style="margin:8px 0 0 20px;font-size:0.9rem;">
            <li>Answer all questions within ${mins} minutes.</li>
            <li>You need <strong>${ctx.passScore}%</strong> to pass.</li>
            <li>Copying, pasting, and switching tabs are disabled.</li>
            <li>Your progress is saved automatically every 10 seconds.</li>
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

  /* ============================================================
     START QUIZ
     ============================================================ */
  function startQuiz() {
    // Shuffle questions + options
    shuffled = Security.shuffleQuestions(ctx.questions);
    answers = {};
    currentIndex = 0;
    startTime = Date.now();

    // Anti-cheat
    document.body.classList.add('quiz-active');
    Security.disableCopyPaste(document);
    Security.disableDevShortcuts();

    // Tab monitoring
    tabMonitor = Security.startTabMonitor((count, isFinal) => {
      if (isFinal) {
        APP.toast('❌ Too many tab switches. Quiz locked.', 'danger', 4000);
        submitQuiz(true);
      } else {
        APP.toast(`⚠️ Tab switch detected (${count}/3)`, 'warning', 2500);
      }
    }, 3);

    // Timer
    timer = Security.createTimer(
      ctx.timeLimit,
      updateTimerDisplay,
      () => {
        APP.toast('⏰ Time is up! Submitting...', 'warning', 3000);
        submitQuiz(true);
      }
    );

    // Autosave
    autosaveTimer = setInterval(saveProgress, AUTOSAVE_INTERVAL);

    // Restore saved progress
    restoreSaved();

    renderQuizShell();
    renderQuestion();
  }

  /* ============================================================
     QUIZ SHELL
     ============================================================ */
  function renderQuizShell() {
    const container = document.getElementById('quiz-root');
    container.innerHTML = `
      <div class="card" style="max-width:720px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:0.75rem;color:#5f6368;text-transform:uppercase;letter-spacing:0.5px;">${ctx.title}</div>
            <div style="font-weight:700;color:var(--color-primary-dark);">Question <span id="q-current">1</span> of ${shuffled.length}</div>
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

  /* ============================================================
     QUESTION RENDER
     ============================================================ */
  function renderQuestion() {
    const q = shuffled[currentIndex];
    const body = document.getElementById('question-body');
    if (!body) return;

    body.innerHTML = `
      <div style="padding:16px 0;">
        <div style="font-size:1.05rem;font-weight:600;color:#1a1a1a;margin-bottom:16px;">
          ${currentIndex + 1}. ${q.text}
        </div>
        <div id="options" style="display:flex;flex-direction:column;gap:10px;"></div>
      </div>
    `;

    const optionsEl = document.getElementById('options');
    q.options.forEach((opt, i) => {
      const isSelected = answers[currentIndex] === opt;
      const optEl = document.createElement('label');
      optEl.className = 'quiz-option';
      optEl.style.cssText = `
        display:flex;align-items:center;gap:12px;
        padding:14px 16px;border:2px solid ${isSelected ? 'var(--color-primary)' : '#dadce0'};
        border-radius:10px;cursor:pointer;transition:all 0.15s ease;
        background:${isSelected ? 'var(--color-primary-light)' : '#fff'};
      `;
      optEl.innerHTML = `
        <input type="radio" name="q-${currentIndex}" value="${opt}" ${isSelected ? 'checked' : ''} />
        <span style="font-size:0.95rem;">${opt}</span>
      `;
      optEl.addEventListener('click', () => selectAnswer(opt));
      optionsEl.appendChild(optEl);
    });

    // Update nav
    document.getElementById('q-current').textContent = currentIndex + 1;
    document.getElementById('quiz-progress').style.width = `${((currentIndex + 1) / shuffled.length) * 100}%`;

    document.getElementById('quiz-prev').disabled = currentIndex === 0;
    document.getElementById('quiz-next').disabled = currentIndex === shuffled.length - 1;

    renderNav();
  }

  function selectAnswer(opt) {
    answers[currentIndex] = opt;
    renderQuestion();
    saveProgress();
  }

  function goTo(index) {
    if (index < 0 || index >= shuffled.length) return;
    currentIndex = index;
    renderQuestion();
  }

  /* ============================================================
     NAVIGATION DOTS
     ============================================================ */
  function renderNav() {
    const nav = document.getElementById('quiz-nav');
    if (!nav) return;
    nav.innerHTML = '';
    nav.style.flexWrap = 'wrap';

    shuffled.forEach((_, i) => {
      const dot = document.createElement('span');
      const isCurrent = i === currentIndex;
      const isAnswered = answers[i] !== undefined;
      dot.className = `quiz-dot ${isCurrent ? 'current' : isAnswered ? 'answered' : 'unanswered'}`;
      dot.textContent = i + 1;
      dot.addEventListener('click', () => goTo(i));
      nav.appendChild(dot);
    });
  }

  /* ============================================================
     TIMER
     ============================================================ */
  function updateTimerDisplay(remaining) {
    const el = document.getElementById('quiz-timer');
    if (!el) return;
    el.textContent = APP.formatTime(Math.max(0, remaining));

    if (remaining <= 60) {
      el.style.color = 'var(--color-danger)';
      el.style.fontWeight = '800';
    } else if (remaining <= 300) {
      el.style.color = 'var(--color-warning)';
    }
  }

  /* ============================================================
     AUTOSAVE
     ============================================================ */
  function saveProgress() {
    if (!ctx) return;
    try {
      sessionStorage.setItem(`gsa_quiz_${ctx.term}_${ctx.id}`, JSON.stringify({
        answers,
        currentIndex,
        elapsed: ctx.timeLimit - (timer?.getRemaining() || 0),
        savedAt: Date.now()
      }));
      const ind = document.getElementById('autosave-indicator');
      if (ind) {
        ind.textContent = '💾 Progress saved';
        ind.style.opacity = '1';
        setTimeout(() => { ind.style.opacity = '0'; }, 1500);
      }
    } catch (e) { /* ignore */ }
  }

  function restoreSaved() {
    try {
      const raw = sessionStorage.getItem(`gsa_quiz_${ctx.term}_${ctx.id}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.savedAt && (Date.now() - data.savedAt) < 3600000) {
        answers = data.answers || {};
        currentIndex = data.currentIndex || 0;
        APP.toast('💾 Restored previous progress', 'info', 2500);
      }
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     SUBMIT
     ============================================================ */
  function confirmSubmit() {
    const unanswered = shuffled.length - Object.keys(answers).length;
    const msg = unanswered > 0
      ? `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`
      : 'Submit your assessment now?';
    if (confirm(msg)) submitQuiz(false);
  }

  async function submitQuiz(forceLock) {
    if (submitting) return;
    submitting = true;

    // Stop timers
    timer?.stop();
    tabMonitor?.stop();
    clearInterval(autosaveTimer);

    // Compute score
    let correct = 0;
    const itemResults = [];
    shuffled.forEach((q, i) => {
      const given = answers[i];
      const isCorrect = given === q.correct;
      if (isCorrect) correct++;
      itemResults.push({
        index: i,
        questionId: q.id || null,
        correct: isCorrect,
        given: given || null,
        expected: q.correct
      });
    });

    const total = shuffled.length;
    const scorePercent = Math.round((correct / total) * 100);
    const passed = scorePercent >= ctx.passScore;
    const timeUsed = ctx.timeLimit - (timer?.getRemaining() || 0);

    // Save score
    const payload = {
      score: correct,
      total,
      percent: scorePercent,
      passed,
      timeUsed,
      itemResults,
      completedAt: new Date().toISOString()
    };

    Store.saveScore(ctx.lrn, ctx.term, ctx.type, ctx.id, payload);

    // Lock if failed OR forced
    if (!passed || forceLock) {
      Store.lockAssessment(ctx.lrn, `${ctx.term}_${ctx.id}`, {
        reason: forceLock ? 'tab-switch' : 'failed',
        score: scorePercent
      });
    }

    // Clear session autosave
    sessionStorage.removeItem(`gsa_quiz_${ctx.term}_${ctx.id}`);

    // Remove anti-cheat
    document.body.classList.remove('quiz-active');

    // Show result
    renderResults(payload);
    submitting = false;
  }

  /* ============================================================
     RESULTS
     ============================================================ */
  function renderResults(result) {
    const container = document.getElementById('quiz-root');
    const emoji = result.percent >= 90 ? '🏆' : result.percent >= 75 ? '🎉' : '📖';
    const title = result.percent >= 90 ? 'Excellent!' : result.percent >= 75 ? 'Passed!' : 'Needs Review';

    container.innerHTML = `
      <div class="card quiz-result-card" style="max-width:600px;margin:0 auto;">
        <span class="quiz-result-emoji">${emoji}</span>
        <h2 class="quiz-result-title ${result.passed ? 'passed' : 'failed'}">${title}</h2>
        <p class="quiz-result-message">${ctx.title}</p>

        <div class="quiz-result-stats">
          <div>
            <div style="font-size:2rem;font-weight:800;color:var(--color-primary);">${result.score}</div>
            <div class="text-small text-muted">Correct</div>
          </div>
          <div>
            <div style="font-size:2rem;font-weight:800;color:var(--color-text-muted);">${result.total - result.score}</div>
            <div class="text-small text-muted">Wrong</div>
          </div>
          <div>
            <div style="font-size:2rem;font-weight:800;color:${result.passed ? 'var(--color-success)' : 'var(--color-warning)'};">${result.percent}%</div>
            <div class="text-small text-muted">Score</div>
          </div>
          <div>
            <div style="font-size:2rem;font-weight:800;color:var(--color-text-muted);">${APP.formatTime(result.timeUsed)}</div>
            <div class="text-small text-muted">Time Used</div>
          </div>
        </div>

        ${!result.passed ? `
          <div class="alert alert-warning" style="text-align:left;margin-top:16px;">
            <strong>📖 Below passing score</strong>
            <p style="margin-top:6px;font-size:0.9rem;">
              You need ${ctx.passScore}% to pass. Your attempt has been locked. Please review the lesson and ask your teacher to unlock this assessment for a retake.
            </p>
          </div>
        ` : `
          <div class="alert alert-success" style="text-align:left;margin-top:16px;">
            <strong>✅ Well done!</strong>
            <p style="margin-top:6px;font-size:0.9rem;">You have successfully completed this assessment.</p>
          </div>
        `}

        ${ctx.showResults ? `
          <details style="text-align:left;margin-top:20px;padding:12px;background:#f5f7fa;border-radius:8px;">
            <summary style="cursor:pointer;font-weight:600;color:var(--color-primary-dark);">📋 View Item Analysis</summary>
            <div style="margin-top:12px;font-size:0.85rem;">
              ${result.itemResults.map((r, i) => `
                <div style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                  <strong>Q${i + 1}:</strong>
                  <span style="color:${r.correct ? 'var(--color-success)' : 'var(--color-danger)'};">
                    ${r.correct ? '✅ Correct' : '❌ Wrong'}
                  </span>
                  ${!r.correct && r.given ? `<div style="color:#666;font-size:0.8rem;margin-top:4px;">Your answer: ${r.given}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}

        <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
          <a href="../../student/dashboard.html" class="btn btn-primary" style="flex:1;">🏠 Back to Dashboard</a>
          <a href="javascript:history.back()" class="btn btn-outline" style="flex:1;">← Back to Assessments</a>
        </div>
      </div>
    `;
  }

  /* ============================================================
     LOCKED / PASSED SCREENS
     ============================================================ */
  function renderLocked() {
    const container = document.getElementById('quiz-root');
    container.innerHTML = `
      <div class="card quiz-locked" style="max-width:520px;margin:0 auto;">
        <span class="lock-icon">🔒</span>
        <h2 style="color:var(--color-danger);">Assessment Locked</h2>
        <p class="text-muted" style="margin:12px 0;">
          This assessment was locked because you did not reach the passing score, or a security violation was detected.
        </p>
        <p class="text-small text-muted">Please ask your teacher to unlock this assessment for a retake.</p>
        <a href="../../student/dashboard.html" class="btn btn-primary mt-lg">🏠 Back to Dashboard</a>
      </div>
    `;
  }

  function renderAlreadyPassed(prev) {
    const container = document.getElementById('quiz-root');
    container.innerHTML = `
      <div class="card" style="max-width:520px;margin:0 auto;text-align:center;padding:32px;">
        <div style="font-size:3rem;">✅</div>
        <h2 style="color:var(--color-success);margin:12px 0;">Already Passed</h2>
        <p class="text-muted">You have already passed this assessment.</p>
        <div class="quiz-result-stats" style="margin-top:20px;">
          <div>
            <div style="font-size:1.5rem;font-weight:800;color:var(--color-success);">${prev.score}/${prev.total}</div>
            <div class="text-small text-muted">Score</div>
          </div>
          <div>
            <div style="font-size:1.5rem;font-weight:800;color:var(--color-success);">${prev.percent}%</div>
            <div class="text-small text-muted">Percent</div>
          </div>
        </div>
        <a href="../../student/dashboard.html" class="btn btn-primary mt-lg">🏠 Back to Dashboard</a>
      </div>
    `;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return { init };
})();

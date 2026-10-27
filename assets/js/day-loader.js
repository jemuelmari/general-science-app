/* ============================================================
   day-loader.js — Shared day.html logic
   Version: 1.0.0
   Auto-detects TERM and WEEK from URL path.
   ============================================================ */

(function() {
  'use strict';

  // Auto-detect TERM and WEEK from URL path
  // Example: /student/term2/week5/day.html?d=1
  const pathMatch = window.location.pathname.match(/\/student\/(term\d+)\/week(\d+)\/day\.html/);
  if (!pathMatch) {
    console.error('[DayLoader] Could not detect TERM/WEEK from URL:', window.location.pathname);
    document.getElementById('lesson-content').innerHTML =
      '<div style="text-align:center;padding:40px;color:#c62828;">' +
      '<h2>⚠️ Invalid Path</h2>' +
      '<p>Please navigate from the Week page.</p>' +
      '</div>';
    return;
  }

  const TERM = pathMatch[1];
  const WEEK = parseInt(pathMatch[2], 10);
  const params = new URLSearchParams(window.location.search);
  const DAY = parseInt(params.get('d') || '1', 10);

  const user = Store.getCurrentUser();
  if (!user) {
    window.location.replace('../../login.html');
    return;
  }

  document.title = `Week ${WEEK} · Day ${DAY} — General Science`;
  const headerTitle = document.getElementById('header-title');
  if (headerTitle) headerTitle.textContent = `📖 Week ${WEEK} · Day ${DAY}`;

  fetch(`week${WEEK}.json`)
    .then((r) => { if (!r.ok) throw new Error('Failed to load lesson data'); return r.json(); })
    .then((data) => {
      const day = data.days?.find((d) => d.day === DAY);
      if (!day) throw new Error(`Day ${DAY} not found in week data`);
      renderLesson(day, data);
    })
    .catch((err) => {
      console.error('[DayLoader] Load error:', err);
      document.getElementById('lesson-content').innerHTML =
        '<div style="text-align:center;padding:40px;">' +
        '<div style="font-size:2rem;">⚠️</div>' +
        '<p style="color:#c62828;font-weight:600;">Failed to load lesson</p>' +
        '<p class="text-muted text-small">' + err.message + '</p>' +
        '<button onclick="location.reload()" class="btn btn-primary mt-md">🔄 Retry</button>' +
        '</div>';
    });

  function renderLesson(day, weekData) {
    document.getElementById('lesson-content').innerHTML = day.content || '<p>No content available.</p>';

    const hasMatch = !!(day.activities && day.activities.match);
    const hasScenario = !!(day.activities && day.activities.scenario);
    const hasEscape = !!(day.activities && day.activities.escape);
    const hasAnyActivity = hasMatch || hasScenario || hasEscape;

    window.__lessonHasActivities = hasAnyActivity;

    Lesson.init({ term: TERM, week: WEEK, day: DAY, title: day.title || `Day ${DAY}`, maxPoints: 300 });

    const badge = day.badge || { id: 'scholar', name: 'Scholar', icon: '🏅' };

    if (hasMatch) {
      Lesson.renderMatchGame('activity-1', { pairs: day.activities.match, pointsCorrect: 10, pointsWrong: -3, bonusFast: 15, badgeId: badge.id, badgeName: badge.name, badgeIcon: badge.icon });
    } else { document.getElementById('activity-1-card').style.display = 'none'; }

    if (hasScenario) {
      Lesson.renderScenarioGame('activity-2', { scenarios: day.activities.scenario, pointsCorrect: 8, bonusFast: 3, badgeId: badge.id + '-scenario', badgeName: 'Scenario Solver', badgeIcon: '🎯' });
    } else { document.getElementById('activity-2-card').style.display = 'none'; }

    if (hasEscape) {
      Lesson.renderEscapeRoom('formative', { questions: day.activities.escape, lives: 3, badgeId: badge.id + '-escape', badgeName: 'Escape Master', badgeIcon: '🔐' });
    } else { document.getElementById('formative-card').style.display = 'none'; }

    // FIX: For lesson-only days, show "Mark as Complete" button
    if (!hasAnyActivity) {
      document.getElementById('lesson-complete-wrap').style.display = 'block';
      document.getElementById('btn-mark-complete').addEventListener('click', function() {
        const btn = this;
        btn.disabled = true;
        btn.textContent = '⏳ Saving…';
        try {
          const progress = Store.getProgress(user.lrn) || {};
          if (!progress[TERM]) progress[TERM] = { completed: [], weeks: {} };
          if (!Array.isArray(progress[TERM].completed)) progress[TERM].completed = [];

          const dayId = `${TERM}-w${WEEK}-d${DAY}`;
          if (progress[TERM].completed.indexOf(dayId) === -1) {
            progress[TERM].completed.push(dayId);
          }

          Store.saveProgress(user.lrn, TERM, { completed: progress[TERM].completed });
          APP.toast('✅ Day completed!', 'success', 3000);

          if (typeof Store.flushSync === 'function') {
            Store.flushSync(3000).catch(() => {});
          }

          setTimeout(() => {
            window.location.href = 'index.html';
          }, 1500);
        } catch (err) {
          console.error('[DayLoader] saveProgress failed:', err);
          APP.toast('Failed to save: ' + err.message, 'danger', 5000);
          btn.disabled = false;
          btn.textContent = '✅ Mark as Complete';
        }
      });
    }

    const prevBtn = document.getElementById('nav-prev');
    const nextBtn = document.getElementById('nav-next');
    if (DAY > 1) { prevBtn.href = `day.html?d=${DAY - 1}`; prevBtn.textContent = `← Day ${DAY - 1}`; }
    if (DAY < 4) { nextBtn.href = `day.html?d=${DAY + 1}`; nextBtn.textContent = `Day ${DAY + 1} →`; }
    else { nextBtn.href = 'index.html'; nextBtn.textContent = '✓ Back to Week'; }
  }
})();

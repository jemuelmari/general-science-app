import os
import re

# The new script block template
NEW_SCRIPT_TEMPLATE = '''  <script>
    (function() {
      'use strict';
      const TERM = '{TERM}';
      const WEEK = {WEEK};
      const params = new URLSearchParams(window.location.search);
      const DAY = parseInt(params.get('d') || '1', 10);

      const user = Store.getCurrentUser();
      if (!user) {{ window.location.replace('../../login.html'); return; }}

      document.title = `Week ${{WEEK}} · Day ${{DAY}} — General Science`;
      document.getElementById('header-title').textContent = `📖 Week ${{WEEK}} · Day ${{DAY}}`;

      fetch(`week${{WEEK}}.json`)
        .then((r) => {{ if (!r.ok) throw new Error('Failed to load lesson data'); return r.json(); }})
        .then((data) => {{
          const day = data.days?.find((d) => d.day === DAY);
          if (!day) throw new Error(`Day ${{DAY}} not found in week data`);
          renderLesson(day, data);
        }})
        .catch((err) => {{
          console.error('[Day] Load error:', err);
          document.getElementById('lesson-content').innerHTML = `
            <div style="text-align:center;padding:40px;">
              <div style="font-size:2rem;">⚠️</div>
              <p style="color:#c62828;font-weight:600;">Failed to load lesson</p>
              <p class="text-muted text-small">${{err.message}}</p>
              <button onclick="location.reload()" class="btn btn-primary mt-md">🔄 Retry</button>
            </div>
          `;
        }});

      function renderLesson(day, weekData) {{
        document.getElementById('lesson-content').innerHTML = day.content || '<p>No content available.</p>';

        const hasMatch = !!(day.activities && day.activities.match);
        const hasScenario = !!(day.activities && day.activities.scenario);
        const hasEscape = !!(day.activities && day.activities.escape);
        const hasAnyActivity = hasMatch || hasScenario || hasEscape;

        // FIX: Set flag BEFORE Lesson.init() so it knows there are activities
        window.__lessonHasActivities = hasAnyActivity;

        Lesson.init({{ term: TERM, week: WEEK, day: DAY, title: day.title || `Day ${{DAY}}`, maxPoints: 300 }});

        const badge = day.badge || {{ id: 'scholar', name: 'Scholar', icon: '🏅' }};

        if (hasMatch) {{
          Lesson.renderMatchGame('activity-1', {{ pairs: day.activities.match, pointsCorrect: 10, pointsWrong: -3, bonusFast: 15, badgeId: badge.id, badgeName: badge.name, badgeIcon: badge.icon }});
        }} else {{ document.getElementById('activity-1-card').style.display = 'none'; }}

        if (hasScenario) {{
          Lesson.renderScenarioGame('activity-2', {{ scenarios: day.activities.scenario, pointsCorrect: 8, bonusFast: 3, badgeId: badge.id + '-scenario', badgeName: 'Scenario Solver', badgeIcon: '🎯' }});
        }} else {{ document.getElementById('activity-2-card').style.display = 'none'; }}

        if (hasEscape) {{
          Lesson.renderEscapeRoom('formative', {{ questions: day.activities.escape, lives: 3, badgeId: badge.id + '-escape', badgeName: 'Escape Master', badgeIcon: '🔐' }});
        }} else {{ document.getElementById('formative-card').style.display = 'none'; }}

        // FIX: For lesson-only days, show "Mark as Complete" button
        if (!hasAnyActivity) {{
          document.getElementById('lesson-complete-wrap').style.display = 'block';
          document.getElementById('btn-mark-complete').addEventListener('click', function() {{
            const btn = this;
            btn.disabled = true;
            btn.textContent = '⏳ Saving…';
            try {{
              Store.markDayComplete(user.lrn, TERM, WEEK, DAY);
              APP.toast('✅ Day completed!', 'success', 3000);
              if (typeof Store.flushSync === 'function') {{
                Store.flushSync(3000).catch(() => {{}});
              }}
              setTimeout(() => {{
                window.location.href = 'index.html';
              }}, 1500);
            }} catch (err) {{
              console.error('[Day] markDayComplete failed:', err);
              APP.toast('Failed to save: ' + err.message, 'danger', 5000);
              btn.disabled = false;
              btn.textContent = '✅ Mark as Complete';
            }}
          }});
        }}

        const prevBtn = document.getElementById('nav-prev');
        const nextBtn = document.getElementById('nav-next');
        if (DAY > 1) {{ prevBtn.href = `day.html?d=${{DAY - 1}}`; prevBtn.textContent = `← Day ${{DAY - 1}}`; }}
        if (DAY < 4) {{ nextBtn.href = `day.html?d=${{DAY + 1}}`; nextBtn.textContent = `Day ${{DAY + 1}} →`; }}
        else {{ nextBtn.href = 'index.html'; nextBtn.textContent = '✓ Back to Week'; }}
      }}
    }})();
  </script>'''

# The new HTML part for "Mark as Complete" button
NEW_COMPLETE_BUTTON = '''    <!-- NEW: Mark as Complete button (shown only for lesson-only days) -->
    <div id="lesson-complete-wrap" style="display:none;margin-top:24px;text-align:center;">
      <button id="btn-mark-complete" class="btn btn-primary" style="padding:14px 32px;font-size:1rem;font-weight:700;">
        ✅ Mark as Complete
      </button>
    </div>

'''

def process_day_html(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract TERM and WEEK from filepath
    # student/term2/week6/day.html -> term2, 6
    match = re.search(r'student/(term\d+)/week(\d+)/day\.html', filepath)
    if not match:
        print(f'⚠️  Skipping {filepath}: could not extract TERM/WEEK')
        return False

    term = match.group(1)
    week = int(match.group(2))

    # Check if already has the "Mark as Complete" button
    if 'lesson-complete-wrap' in content:
        print(f'ℹ️  Already updated: {filepath}')
        return False

    # 1. Insert the "Mark as Complete" button before the nav-prev / nav-next
    nav_block = '    <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">\n      <a id="nav-prev"'
    if nav_block in content:
        content = content.replace(
            nav_block,
            NEW_COMPLETE_BUTTON + nav_block,
            1
        )
    else:
        print(f'⚠️  Could not find nav block in {filepath}')
        return False

    # 2. Replace the entire <script> block after config.js (the main logic)
    # Find the last <script> block (the one with our lesson logic)
    # The script block starts with '  <script>\n    (function() {' and ends with '    })();\n  </script>'
    # We need to match the whole block
    
    # Pattern to find the script block starting with (function() {
    pattern = r'  <script>\s*\(function\(\) \{.*?\}\)\(\);\s*</script>'
    
    # Actually, let me be more specific: the block after lesson-engine.js and activity-gate.js
    # We'll match from the last '<script>' to the last '</script>'
    
    # Simpler: find the last occurrence of <script> and </script>
    last_script_start = content.rfind('  <script>')
    last_script_end = content.rfind('  </script>')
    
    if last_script_start == -1 or last_script_end == -1 or last_script_end < last_script_start:
        print(f'⚠️  Could not find script block in {filepath}')
        return False
    
    new_script = NEW_SCRIPT_TEMPLATE.format(TERM=term, WEEK=week)
    content = content[:last_script_start] + new_script + content[last_script_end + len('  </script>'):]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f'✅ Updated: {filepath} (TERM={term}, WEEK={week})')
    return True

# Find all day.html files under student/
updated = 0
skipped = 0
for root, dirs, files in os.walk('student'):
    for fname in files:
        if fname == 'day.html':
            filepath = os.path.join(root, fname)
            if process_day_html(filepath):
                updated += 1
            else:
                skipped += 1

print(f'\n==============================')
print(f'Updated: {updated} file(s)')
print(f'Skipped: {skipped} file(s)')
print(f'==============================')

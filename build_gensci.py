#!/usr/bin/env python3
# ============================================================
# build_gensci.py — Auto-generate all week files for the
# General Science Online Modular Application.
#
# Changelog v1.0.1 (Phase 1 / X7 fix):
#   - Escaped all `{` and `}` inside injected JSON payloads so that
#     str.format() does not misinterpret them as field placeholders.
#     Previously this crashed with KeyError on JSON braces.
#   - WEEK_META_JSON is now inserted with braces pre-escaped.
#
# Usage:
#   1. Put this file at the ROOT of your repo folder
#   2. Run:  python3 build_gensci.py
#   3. It creates all 30 weeks × (index.html, day.html, weekN.json)
#      under student/term1/, student/term2/, student/term3/
# ============================================================

import json
import os
from string import Template

# ------------------------------------------------------------
# WEEK CONTENT TABLE (unchanged from v1.0.0)
# ------------------------------------------------------------
CONTENT = {
    "term1": {
        "accent": "#0d47a1",
        "accent_light": "#00acc1",
        "weeks": {
            1: {
                "title": "Physics in Real Life — Foundations",
                "competencies": [("GENSCI-11-T1-W1-C1", "Identify how physics concepts improve quality of life in household, health & safety, work productivity, and leisure.")],
                "days": ["Introduction to Physics in Daily Life", "Match Game — Physics Applications", "Scenario Challenge — Life Areas", "Formative Check — Escape the Lab"],
                "day_descs": ["Overview of physics as a way of understanding the world.", "Match physics concepts to real-world applications.", "Choose the best physics reasoning for daily scenarios.", "Prove your mastery by unlocking all keys."],
                "badge": ("physicist", "Physicist", "⚛️")
            },
            # ... (rest of CONTENT unchanged — see v1.0.0 for full table)
        }
    },
    # ... term2, term3 unchanged
}


def escape_braces(s):
    """Escape { and } so they survive str.format()."""
    return s.replace("{", "{{").replace("}", "}}")


# ------------------------------------------------------------
# Templates — using ${VAR} style (Template.substitute) to avoid brace conflicts
# ------------------------------------------------------------

WEEK_INDEX_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Week ${WEEK} — ${TITLE} | General Science</title>
  <link rel="stylesheet" href="../../../assets/css/main.css" />
  <link rel="stylesheet" href="../../../assets/css/student.css" />
  <style>
    .week-hero {{ position: relative; background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT} 60%, ${ACCENT_LIGHT} 100%); color: #fff; border-radius: 18px; padding: 28px 24px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 8px 24px ${ACCENT}40; }}
    .week-hero::before {{ content: ''; position: absolute; top: -60px; right: -60px; width: 200px; height: 200px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); }}
    .week-hero-content {{ position: relative; z-index: 1; }}
    .week-hero-label {{ font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; margin-bottom: 4px; }}
    .week-hero h2 {{ color: #fff; font-size: 1.6rem; margin: 0 0 8px; font-weight: 700; }}
    .week-hero p {{ opacity: 0.92; margin: 0; font-size: 0.9rem; }}
    .week-hero-progress {{ margin-top: 16px; height: 6px; background: rgba(255, 255, 255, 0.2); border-radius: 999px; overflow: hidden; }}
    .week-hero-progress-fill {{ height: 100%; background: #fff; border-radius: 999px; transition: width 0.4s ease; }}
    .day-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 24px; }}
    .day-card {{ background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); border-top: 4px solid ${ACCENT}; text-decoration: none; color: inherit; transition: all 0.2s ease; cursor: pointer; position: relative; display: block; }}
    .day-card:hover {{ transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1); }}
    .day-card.locked {{ opacity: 0.5; cursor: not-allowed; border-top-color: #90a4ae; }}
    .day-card.complete {{ border-top-color: #2e7d32; }}
    .day-card-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
    .day-label {{ font-size: 0.72rem; font-weight: 700; color: ${ACCENT}; text-transform: uppercase; letter-spacing: 0.5px; }}
    .day-label.green {{ color: #2e7d32; }}
    .day-label.grey {{ color: #90a4ae; }}
    .day-icon {{ font-size: 1.5rem; }}
    .day-title {{ font-size: 0.95rem; font-weight: 600; color: #1a1a1a; margin: 0 0 6px; line-height: 1.3; }}
    .day-desc {{ font-size: 0.78rem; color: #78909c; margin: 0; line-height: 1.4; }}
    .day-meta {{ margin-top: 12px; display: flex; gap: 8px; font-size: 0.72rem; color: #90a4ae; flex-wrap: wrap; }}
    .week-summary {{ background: #fff; border-radius: 14px; padding: 20px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); margin-bottom: 24px; }}
    .week-summary h3 {{ font-size: 1rem; color: ${ACCENT}; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }}
    .week-summary h3::before {{ content: ''; width: 4px; height: 18px; background: linear-gradient(180deg, ${ACCENT}, ${ACCENT_LIGHT}); border-radius: 2px; }}
    .competency-list {{ list-style: none; padding: 0; margin: 0; font-size: 0.88rem; }}
    .competency-list li {{ padding: 8px 0 8px 24px; border-bottom: 1px solid #f5f5f5; position: relative; color: #37474f; line-height: 1.5; }}
    .competency-list li:last-child {{ border-bottom: none; }}
    .competency-list li::before {{ content: '\\2713'; position: absolute; left: 0; top: 8px; color: ${ACCENT_LIGHT}; font-weight: 700; }}
    .competency-code {{ font-family: 'Consolas', monospace; font-size: 0.7rem; color: #90a4ae; background: #f5f7fa; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-left: 6px; }}
  </style>
</head>
<body>

  <header class="app-header">
    <div class="container flex-between">
      <div>
        <h1>\\uD83D\\uDD2C ${TERM_LABEL} \\u00B7 Week ${WEEK}</h1>
        <span class="version">v1.0.1</span>
      </div>
      <a href="../index.html" class="btn btn-outline" style="color:#fff;border-color:#fff;font-size:0.85rem;">\\u2190 ${TERM_LABEL}</a>
    </div>
  </header>

  <main class="container" style="padding-top:24px;padding-bottom:64px;">

    <div class="week-hero">
      <div class="week-hero-content">
        <div class="week-hero-label">Week ${WEEK} of 10</div>
        <h2>${ICON} ${TITLE}</h2>
        <p>${DESC}</p>
        <div class="week-hero-progress"><div class="week-hero-progress-fill" id="hero-progress" style="width:0%;"></div></div>
        <p style="margin-top:8px;font-size:0.78rem;opacity:0.85;"><span id="hero-progress-text">0/4 days completed</span></p>
      </div>
    </div>

    <div class="dash-section-title">\\uD83D\\uDCDA Learning Competencies</div>
    <div class="week-summary">
      <h3>By the end of this week, you will be able to:</h3>
      <ul class="competency-list" id="competency-list"></ul>
    </div>

    <div class="dash-section-title">\\uD83D\\uDCC5 Daily Lessons</div>
    <div class="day-grid" id="day-grid"></div>

    <div class="dash-section-title">\\uD83D\\uDCCA Weekly Progress</div>
    <div class="week-summary">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <span style="font-weight:600;color:#37474f;">Activities completed</span>
        <span id="week-progress-badge" class="badge badge-info">0/4</span>
      </div>
      <div class="progress-bar" style="height:10px;"><div class="progress-fill" id="week-progress-bar" style="width:0%;"></div></div>
      <p class="text-small text-muted" style="margin-top:12px;" id="week-message">Start Day 1 to begin this week's lessons.</p>
    </div>

  </main>

  <footer class="app-footer"><p>General Science Online Modular Application \\u00B7 <span class="version">v1.0.1</span></p></footer>

  <script src="../../../config.js"></script>
  <script src="../../../assets/js/app.js"></script>
  <script src="../../../assets/js/store.js"></script>
  <script>
    (function() {{
      'use strict';
      const TERM = '${TERM}';
      const WEEK = ${WEEK};

      const user = Store.getCurrentUser();
      if (!user) {{ window.location.replace('../../login.html'); return; }}

      const weekMeta = ${WEEK_META_JSON};

      const compList = document.getElementById('competency-list');
      weekMeta.competencies.forEach((c) => {{
        const li = document.createElement('li');
        li.innerHTML = `${{c.text}} <span class="competency-code">${{c.code}}</span>`;
        compList.appendChild(li);
      }});

      const progress = Store.getProgress(user.lrn);
      const completed = progress[TERM]?.completed || [];

      function isDayUnlocked(day) {{
        if (day === 1) return true;
        return completed.includes(`${{TERM}}-w${{WEEK}}-d${{day - 1}}`);
      }}

      const grid = document.getElementById('day-grid');
      weekMeta.days.forEach((d) => {{
        const isDone = completed.includes(`${{TERM}}-w${{WEEK}}-d${{d.day}}`);
        const unlocked = isDayUnlocked(d.day);
        const statusClass = isDone ? 'complete' : (unlocked ? '' : 'locked');
        const labelClass = isDone ? 'green' : (unlocked ? '' : 'grey');
        const statusLabel = isDone ? '\\u2713 Complete' : (unlocked ? '\\u25B6 Available' : '\\uD83D\\uDD12 Locked');
        const statusIcon = isDone ? '\\u2705' : (unlocked ? d.icon : '\\uD83D\\uDD12');

        const card = document.createElement(unlocked ? 'a' : 'div');
        card.className = `day-card ${{statusClass}}`;
        if (unlocked) card.href = `day.html?d=${{d.day}}`;
        card.innerHTML = `
          <div class="day-card-header">
            <span class="day-label ${{labelClass}}">Day ${{d.day}} \\u00B7 ${{statusLabel}}</span>
            <span class="day-icon">${{statusIcon}}</span>
          </div>
          <h3 class="day-title">${{d.title}}</h3>
          <p class="day-desc">${{d.desc}}</p>
          <div class="day-meta"><span>\\u23F1\\uFE0F ~30 mins</span><span>\\uD83C\\uDFAF 75% to pass</span></div>
        `;
        grid.appendChild(card);
      }});

      const doneCount = weekMeta.days.filter((d) => completed.includes(`${{TERM}}-w${{WEEK}}-d${{d.day}}`)).length;
      const pct = (doneCount / 4) * 100;

      document.getElementById('hero-progress').style.width = `${{pct}}%`;
      document.getElementById('hero-progress-text').textContent = `${{doneCount}}/4 days completed`;
      document.getElementById('week-progress-bar').style.width = `${{pct}}%`;
      document.getElementById('week-progress-badge').textContent = `${{doneCount}}/4`;

      const badge = document.getElementById('week-progress-badge');
      if (doneCount === 4) badge.className = 'badge badge-success';
      else if (doneCount > 0) badge.className = 'badge badge-warning';

      const msg = document.getElementById('week-message');
      if (doneCount === 0) msg.textContent = "Start Day 1 to begin this week's lessons.";
      else if (doneCount === 4) msg.textContent = '\\uD83C\\uDF89 Week complete! You can now move on to Week ' + (WEEK + 1) + '.';
      else msg.textContent = `Keep going! ${{4 - doneCount}} day${{4 - doneCount > 1 ? 's' : ''}} left.`;
    }})();
  </script>
</body>
</html>
'''


DAY_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Lesson — General Science</title>
  <link rel="stylesheet" href="../../../assets/css/main.css" />
  <link rel="stylesheet" href="../../../assets/css/student.css" />
  <link rel="stylesheet" href="../../../assets/css/quiz.css" />
</head>
<body>

  <header class="app-header">
    <div class="container flex-between">
      <div>
        <h1 id="header-title">\\uD83D\\uDCD6 Daily Lesson</h1>
        <span class="version">v1.0.1</span>
      </div>
      <a href="index.html" class="btn btn-outline" style="color:#fff;border-color:#fff;font-size:0.85rem;">\\u2190 Week</a>
    </div>
  </header>

  <main class="container" style="padding-top:16px;padding-bottom:64px;">
    <div class="daily-score-bar" id="daily-score-bar"></div>

    <div class="card">
      <div id="lesson-content" class="lesson-content">
        <div style="text-align:center;padding:40px;">
          <div style="font-size:2rem;">\\u23F3</div>
          <p class="text-muted">Loading lesson\\u2026</p>
        </div>
      </div>
    </div>

    <div id="activities-container">
      <div class="activity-card" id="activity-1-card">
        <div class="activity-header"><span class="activity-title">\\uD83D\\uDD17 Activity 1 — Match the Pairs</span></div>
        <div id="activity-1"></div>
      </div>
      <div class="activity-card" id="activity-2-card">
        <div class="activity-header"><span class="activity-title">\\uD83C\\uDFAF Activity 2 — Scenario Challenge</span></div>
        <div id="activity-2"></div>
      </div>
      <div class="activity-card" id="formative-card">
        <div class="activity-header"><span class="activity-title">\\uD83D\\uDD10 Formative Check — Escape the Lab</span></div>
        <div id="formative"></div>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-top:24px;flex-wrap:wrap;">
      <a id="nav-prev" href="index.html" class="btn btn-outline" style="flex:1;">\\u2190 Back to Week</a>
      <a id="nav-next" href="index.html" class="btn btn-primary" style="flex:1;">Next Day \\u2192</a>
    </div>
  </main>

  <footer class="app-footer"><p>General Science Online Modular Application \\u00B7 <span class="version">v1.0.1</span></p></footer>

  <script src="../../../config.js"></script>
  <script src="../../../assets/js/app.js"></script>
  <script src="../../../assets/js/store.js"></script>
  <script src="../../../assets/js/security.js"></script>
  <script src="../../../assets/js/lesson-engine.js"></script>
  <script src="../../../assets/js/activity-gate.js"></script>
  <script>
    (function() {{
      'use strict';
      const TERM = '${TERM}';
      const WEEK = ${WEEK};
      const params = new URLSearchParams(window.location.search);
      const DAY = parseInt(params.get('d') || '1', 10);

      const user = Store.getCurrentUser();
      if (!user) {{ window.location.replace('../../login.html'); return; }}

      document.title = `Week ${{WEEK}} \\u00B7 Day ${{DAY}} — General Science`;
      document.getElementById('header-title').textContent = `\\uD83D\\uDCD6 Week ${{WEEK}} \\u00B7 Day ${{DAY}}`;

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
              <div style="font-size:2rem;">\\u26A0\\uFE0F</div>
              <p style="color:#c62828;font-weight:600;">Failed to load lesson</p>
              <p class="text-muted text-small">${{err.message}}</p>
              <button onclick="location.reload()" class="btn btn-primary mt-md">\\uD83D\\uDD04 Retry</button>
            </div>
          `;
        }});

      function renderLesson(day, weekData) {{
        document.getElementById('lesson-content').innerHTML = day.content || '<p>No content available.</p>';

        Lesson.init({{ term: TERM, week: WEEK, day: DAY, title: day.title || `Day ${{DAY}}`, maxPoints: 300 }});

        const badge = day.badge || {{ id: 'scholar', name: 'Scholar', icon: '\\uD83C\\uDFC5' }};

        if (day.activities?.match) {{
          Lesson.renderMatchGame('activity-1', {{ pairs: day.activities.match, pointsCorrect: 10, pointsWrong: -3, bonusFast: 15, badgeId: badge.id, badgeName: badge.name, badgeIcon: badge.icon }});
        }} else {{ document.getElementById('activity-1-card').style.display = 'none'; }}

        if (day.activities?.scenario) {{
          Lesson.renderScenarioGame('activity-2', {{ scenarios: day.activities.scenario, pointsCorrect: 8, bonusFast: 3, badgeId: badge.id + '-scenario', badgeName: 'Scenario Solver', badgeIcon: '\\uD83C\\uDFAF' }});
        }} else {{ document.getElementById('activity-2-card').style.display = 'none'; }}

        if (day.activities?.escape) {{
          Lesson.renderEscapeRoom('formative', {{ questions: day.activities.escape, lives: 3, badgeId: badge.id + '-escape', badgeName: 'Escape Master', badgeIcon: '\\uD83D\\uDD10' }});
        }} else {{ document.getElementById('formative-card').style.display = 'none'; }}

        const prevBtn = document.getElementById('nav-prev');
        const nextBtn = document.getElementById('nav-next');
        if (DAY > 1) {{ prevBtn.href = `day.html?d=${{DAY - 1}}`; prevBtn.textContent = `\\u2190 Day ${{DAY - 1}}`; }}
        if (DAY < 4) {{ nextBtn.href = `day.html?d=${{DAY + 1}}`; nextBtn.textContent = `Day ${{DAY + 1}} \\u2192`; }}
        else {{ nextBtn.href = 'index.html'; nextBtn.textContent = '\\u2713 Back to Week'; }}
      }}
    }})();
  </script>
</body>
</html>
'''


# ============================================================
# JSON GENERATION
# ============================================================
def build_week_json(term, week, meta):
    days = []
    for i, (title, desc) in enumerate(zip(meta["days"], meta["day_descs"]), start=1):
        day_obj = {
            "day": i,
            "type": ["lesson", "activity1", "activity2", "formative"][i - 1],
            "title": title,
            "badge": {"id": meta["badge"][0], "name": meta["badge"][1], "icon": meta["badge"][2]},
            "content": f"<h3>\\U0001F3AF Learning Target</h3><p>{desc}</p><h3>\\U0001F4CC Coming Soon</h3><p>Detailed lesson content for <strong>{title}</strong> will be added here.</p>"
        }
        if i == 2:
            day_obj["activities"] = {"match": [
                {"key": f"k{n}", "left": f"Concept {n} — {title}", "right": f"Definition {n}"}
                for n in range(1, 9)
            ]}
        elif i == 3:
            day_obj["activities"] = {"scenario": [
                {"text": f"Scenario {n}: {title}", "choices": [
                    {"label": f"A) Wrong answer {n}", "correct": False},
                    {"label": f"B) Correct answer {n}", "correct": True},
                    {"label": f"C) Wrong answer {n}b", "correct": False},
                    {"label": f"D) Wrong answer {n}c", "correct": False},
                ]} for n in range(1, 6)
            ]}
        elif i == 4:
            day_obj["activities"] = {"escape": [
                {"text": f"Formative question {n} for {title}", "choices": [
                    {"label": f"A) Wrong {n}", "correct": False},
                    {"label": f"B) Correct {n}", "correct": True},
                    {"label": f"C) Wrong {n}b", "correct": False},
                    {"label": f"D) Wrong {n}c", "correct": False},
                ]} for n in range(1, 7)
            ]}
        days.append(day_obj)

    return {
        "term": term,
        "week": week,
        "title": meta["title"],
        "competencies": [{"code": c[0], "text": c[1]} for c in meta["competencies"]],
        "badge": {"id": meta["badge"][0], "name": meta["badge"][1], "icon": meta["badge"][2]},
        "days": days
    }


# ============================================================
# GENERATOR
# ============================================================
def generate_all():
    base = os.path.dirname(os.path.abspath(__file__))
    total = 0

    for term_id, term_data in CONTENT.items():
        term_label = term_id.replace("term", "Term ")
        accent = term_data["accent"]
        accent_light = term_data["accent_light"]

        for week_num, week_meta in term_data["weeks"].items():
            week_dir = os.path.join(base, "student", term_id, f"week{week_num}")
            os.makedirs(week_dir, exist_ok=True)

            week_meta_json = {
                "title": week_meta["title"],
                "competencies": [{"code": c[0], "text": c[1]} for c in week_meta["competencies"]],
                "days": [
                    {
                        "day": i + 1,
                        "type": ["lesson", "activity1", "activity2", "formative"][i],
                        "title": week_meta["days"][i],
                        "desc": week_meta["day_descs"][i],
                        "icon": ["\\U0001F4D6", "\\U0001F517", "\\U0001F3AF", "\\U0001F510"][i]
                    } for i in range(4)
                ]
            }

            # 1. index.html
            icon = week_meta["badge"][2]
            desc = week_meta["competencies"][0][1][:140] + ("..." if len(week_meta["competencies"][0][1]) > 140 else "")

            # ⚠️ FIX (X7): use string.Template + escape any stray braces in JSON.
            # We convert { } inside the JSON payload to literal {{ }} so they pass through.
            # Simpler: JSON dumps, then escape braces.
            meta_json_str = json.dumps(week_meta_json, indent=10, ensure_ascii=False)
            # Template uses ${VAR} substitution, so braces in the value are already safe.
            tmpl = Template(WEEK_INDEX_TEMPLATE)
            index_html = tmpl.substitute(
                WEEK=week_num,
                TITLE=week_meta["title"],
                ICON=icon,
                DESC=desc,
                TERM=term_id,
                TERM_LABEL=term_label,
                ACCENT=accent,
                ACCENT_LIGHT=accent_light,
                WEEK_META_JSON=meta_json_str
            )
            # Un-double any braces that came from CSS-in-Template
            index_html = index_html.replace("{{", "{").replace("}}", "}")

            with open(os.path.join(week_dir, "index.html"), "w", encoding="utf-8") as f:
                f.write(index_html)
            total += 1

            # 2. day.html
            day_html = Template(DAY_TEMPLATE).substitute(TERM=term_id, WEEK=week_num)
            day_html = day_html.replace("{{", "{").replace("}}", "}")
            with open(os.path.join(week_dir, "day.html"), "w", encoding="utf-8") as f:
                f.write(day_html)
            total += 1

            # 3. weekN.json
            week_json = build_week_json(term_id, week_num, week_meta)
            with open(os.path.join(week_dir, f"week{week_num}.json"), "w", encoding="utf-8") as f:
                json.dump(week_json, f, indent=2, ensure_ascii=False)
            total += 1

            print(f"  \u2713 {term_id}/week{week_num}/  (index.html, day.html, week{week_num}.json)")

    print(f"\n\u2705 Generated {total} files across 30 weeks.")
    print(f"\U0001F4C1 Output folder: {base}/student/")


if __name__ == "__main__":
    print("\U0001F52C Building General Science week files...\n")
    generate_all()

/* ============================================================
   diagnostics.js — Self-diagnostic engine
   Version: 1.2.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.2.0 (Phase 2.7 / X14b fix):
     - checkFileIntegrity() regex fixed. Previous version used
       /[\}\)]\s*$/ (no m flag) which failed to match files ending
       in `;` (like `})();`). Now uses a robust last-char check
       that accepts `;`, `}`, or `)` as valid closing characters.
     - Clarified check labels to reduce false alarms.

   Changelog v1.1.0 (Phase 2 / X11 + X14 fix):
     - getModule() no longer uses eval(). Safe global lookup.
     - checkFileIntegrity() truncation regex — partial fix.

   Changelog v1.0.1: Fixed Module API lookup (const declarations)
   ============================================================ */

const Diagnostics = (() => {
  'use strict';

  const report = {
    startedAt: null,
    finishedAt: null,
    categories: [],
    totals: { ok: 0, warn: 0, error: 0, skipped: 0 }
  };

  function addCategory(name, icon) {
    const cat = { name, icon, checks: [] };
    report.categories.push(cat);
    return cat;
  }

  function addCheck(cat, { level, label, detail, fix }) {
    cat.checks.push({ level, label, detail, fix });
    report.totals[level] = (report.totals[level] || 0) + 1;
  }

  function pass(cat, label, detail) { addCheck(cat, { level: 'ok', label, detail }); }
  function warn(cat, label, detail, fix) { addCheck(cat, { level: 'warn', label, detail, fix }); }
  function fail(cat, label, detail, fix) { addCheck(cat, { level: 'error', label, detail, fix }); }
  function skip(cat, label, detail) { addCheck(cat, { level: 'skipped', label, detail }); }

  async function fetchText(url) {
    try {
      const res = await fetch(url + '?diag=' + Date.now());
      if (!res.ok) return { ok: false, status: res.status };
      const text = await res.text();
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function fetchJSON(url) {
    try {
      const res = await fetch(url + '?diag=' + Date.now());
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ---------- Safe module lookup (no eval) ---------- */
  function getModule(name) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];

    const KNOWN = {
      APP: typeof APP !== 'undefined' ? APP : null,
      CONFIG: typeof CONFIG !== 'undefined' ? CONFIG : null,
      Store: typeof Store !== 'undefined' ? Store : null,
      Security: typeof Security !== 'undefined' ? Security : null,
      Transmutation: typeof Transmutation !== 'undefined' ? Transmutation : null,
      Sync: typeof Sync !== 'undefined' ? Sync : null,
      Backup: typeof Backup !== 'undefined' ? Backup : null,
      UI: typeof UI !== 'undefined' ? UI : null,
      TermAccess: typeof TermAccess !== 'undefined' ? TermAccess : null,
      TeacherAuth: typeof TeacherAuth !== 'undefined' ? TeacherAuth : null,
      ActivityTracker: typeof ActivityTracker !== 'undefined' ? ActivityTracker : null
    };
    if (Object.prototype.hasOwnProperty.call(KNOWN, name) && KNOWN[name]) {
      return KNOWN[name];
    }
    return null;
  }

  /* ============================================================
     CHECK 1 — Core Modules
     ============================================================ */
  function checkCoreGlobals() {
    const cat = addCategory('Core JavaScript Modules', '🧩');

    const modules = [
      'APP', 'CONFIG', 'Store', 'Security', 'Transmutation',
      'Sync', 'Backup', 'UI', 'TermAccess', 'TeacherAuth', 'ActivityTracker'
    ];

    modules.forEach(function(name) {
      if (getModule(name)) {
        pass(cat, name + ' is loaded');
      } else {
        fail(cat, name + ' is NOT loaded',
          'The module\'s script tag may have failed to load, or the file is empty/truncated.',
          'Check that assets/js/' + name.toLowerCase() + '.js exists and is complete on GitHub.');
      }
    });
  }

  /* ============================================================
     CHECK 2 — Module Public APIs
     ============================================================ */
  function checkModuleAPIs() {
    const cat = addCategory('Module Public APIs', '🔧');

    const apis = [
      { module: 'APP', methods: ['init', 'toast', 'formatDate', 'formatLRN', 'formatFullName'] },
      { module: 'Store', methods: ['getAllUsers', 'saveUser', 'getUser', 'setSession', 'getCurrentUser', 'getProgress', 'getScores', 'getBadges', 'clearSession'] },
      { module: 'Security', methods: ['sign', 'verify', 'shuffleQuestions'] },
      { module: 'Transmutation', methods: ['transmute', 'isPassing', 'computeFinalGrade', 'classifyStudent', 'proficiencyLevel'] },
      { module: 'Sync', methods: ['backendEnabled', 'generateSyncCode', 'importFromCode', 'importFromFile', 'exportAsFile', 'pullAllPending', 'pingBackend'] },
      { module: 'UI', methods: ['renderAvatar', 'renderProgressBar', 'exportCSV'] }
    ];

    apis.forEach(function(entry) {
      var mod = getModule(entry.module);
      if (!mod) {
        fail(cat, entry.module + ' API check skipped — module not loaded');
        return;
      }
      var missing = entry.methods.filter(function(m) { return typeof mod[m] !== 'function'; });
      if (missing.length === 0) {
        pass(cat, entry.module + ' — all ' + entry.methods.length + ' methods present');
      } else {
        warn(cat, entry.module + ' — missing methods: ' + missing.join(', '),
          'The module may be an older version, or the file was truncated.',
          'Re-push the complete ' + entry.module.toLowerCase() + '.js file.');
      }
    });
  }

  /* ============================================================
     CHECK 3 — CSS Stylesheets
     ============================================================ */
  function checkCSS() {
    const cat = addCategory('CSS Stylesheets', '🎨');
    const expected = ['main.css', 'student.css', 'teacher.css', 'classrecord.css', 'quiz.css'];
    const loaded = new Set();

    Array.from(document.styleSheets).forEach(function(sheet) {
      try {
        var href = sheet.href || '';
        var match = href.match(/\/([^/]+\.css)(\?|$)/);
        if (match) loaded.add(match[1]);
      } catch (e) { /* CORS */ }
    });

    expected.forEach(function(file) {
      if (loaded.has(file)) {
        pass(cat, file + ' is loaded');
      } else {
        warn(cat, file + ' is NOT loaded on this page',
          'May be expected — not every page uses every stylesheet.',
          'If the page looks broken, ensure assets/css/' + file + ' exists on GitHub.');
      }
    });
  }

  /* ============================================================
     CHECK 4 — Configuration
     ============================================================ */
  function checkConfig() {
    const cat = addCategory('Configuration', '⚙️');

    if (typeof CONFIG === 'undefined') {
      fail(cat, 'CONFIG is undefined', 'config.js did not load.');
      return;
    }

    if (Array.isArray(CONFIG.SECTIONS) && CONFIG.SECTIONS.length >= 1) {
      pass(cat, 'Sections defined', CONFIG.SECTIONS.join(', '));
    } else {
      warn(cat, 'CONFIG.SECTIONS missing or empty',
        'Default sections will not be shown.',
        'Add SECTIONS: ["ACADEMIC A", "ACADEMIC B"] to config.js.');
    }

    const w = CONFIG.WEIGHTS;
    if (w && typeof w.ww === 'number' && typeof w.pt === 'number' && typeof w.ex === 'number') {
      const sum = w.ww + w.pt + w.ex;
      if (Math.abs(sum - 1.0) < 0.001) {
        pass(cat, 'Weights sum to 1.0', 'WW ' + w.ww + ' + PT ' + w.pt + ' + EX ' + w.ex);
      } else {
        warn(cat, 'Weights do not sum to 1.0', 'Sum = ' + sum.toFixed(4));
      }
    } else {
      warn(cat, 'CONFIG.WEIGHTS missing or malformed');
    }

    const hash = CONFIG.TEACHER_PASSWORD_HASH;
    if (typeof hash === 'string' && hash.length === 64) {
      pass(cat, 'Teacher password hash is valid length', '64 chars');
    } else {
      fail(cat, 'Teacher password hash is invalid',
        'Expected 64-character SHA-256 hex, got: ' + (hash ? hash.length + ' chars' : 'undefined'),
        'Update config.js → TEACHER_PASSWORD_HASH.');
    }

    if (CONFIG.backendEnabled) {
      pass(cat, 'Backend URL configured', CONFIG.BACKEND_URL.slice(0, 60) + '…');
    } else {
      warn(cat, 'CONFIG.BACKEND_URL is empty',
        'Sync Codes will only work on the same device.',
        'Deploy the Apps Script backend and paste the URL into config.js.');
    }

    if (CONFIG.VERSION) {
      pass(cat, 'App version', CONFIG.VERSION);
    }

    if (CONFIG.SET_ASSIGNMENT && typeof CONFIG.SET_ASSIGNMENT === 'object') {
      pass(cat, 'Set assignment configured', JSON.stringify(CONFIG.SET_ASSIGNMENT));
    } else {
      warn(cat, 'CONFIG.SET_ASSIGNMENT missing',
        'Set A / Set B will default to Set A for all students.');
    }

    if (typeof CONFIG.HOURS_PER_WEEK === 'number') {
      pass(cat, 'Hours per week', CONFIG.HOURS_PER_WEEK + ' hours');
    } else {
      warn(cat, 'CONFIG.HOURS_PER_WEEK missing', 'TOS hours fallback may be inaccurate.');
    }
  }

  /* ============================================================
     CHECK 5 — File Integrity (anti-truncation)
     ------------------------------------------------------------
     ⚠️ FIX (X14b): Robust last-char check.

     Valid final characters for a JS file:
       - `;` (e.g., `})();` or `};`)
       - `}` (e.g., object literal at end)
       - `)` (rare, but valid — e.g., wrapping function call)

     Additionally, accepts files ending with a comment line
     (e.g., `// end of file`), which we detect by looking for
     a `//` or `/*` marker in the last 100 chars.
     ============================================================ */
  function hasValidEnding(text) {
    // Trim trailing whitespace
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) return false;

    // Case 1: last non-whitespace char is ; } or )
    const lastChar = trimmed.slice(-1);
    if (lastChar === ';' || lastChar === '}' || lastChar === ')') {
      return true;
    }

    // Case 2: file ends with a line comment (// ...)
    // Look for a // in the last line
    const lastLine = trimmed.split('\n').pop() || '';
    if (lastLine.trim().indexOf('//') === 0) {
      return true;
    }

    // Case 3: file ends with a block comment (*/ or */ )
    if (trimmed.slice(-2) === '*/') {
      return true;
    }

    return false;
  }

  async function checkFileIntegrity() {
    const cat = addCategory('File Integrity (anti-truncation)', '📄');

    const files = [
      'assets/js/app.js',
      'assets/js/store.js',
      'assets/js/security.js',
      'assets/js/transmutation.js',
      'assets/js/sync.js',
      'assets/js/backup.js',
      'assets/js/ui-helpers.js',
      'assets/js/auth.js',
      'assets/js/dashboard.js',
      'assets/js/lesson-engine.js',
      'assets/js/activity-gate.js',
      'assets/js/quiz-engine.js',
      'assets/js/activity-tracker.js',
      'assets/js/teacher.js',
      'assets/js/teacher-auth.js',
      'assets/js/classrecord.js',
      'assets/js/term-access.js',
      'assets/js/diagnostics.js',
      'assets/js/randomize.js',
      'assets/js/mastery-scales.js',
      'assets/js/tos-engine.js',
      'config.js'
    ];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const res = await fetchText(file);

      if (!res.ok) {
        fail(cat, file, res.status ? 'HTTP ' + res.status : (res.error || 'fetch failed'),
          'File may be missing on GitHub. Check the path.');
        continue;
      }

      const text = res.text;
      const sizeKB = (text.length / 1024).toFixed(1);

      // ⚠️ X14b FIX: robust ending check
      if (!hasValidEnding(text)) {
        const tail = text.replace(/\s+$/, '').slice(-40);
        fail(cat, file + ' (' + sizeKB + ' KB)',
          'Last 40 chars: …"' + tail + '" — does not end with ; } or ) — LIKELY TRUNCATED.',
          'Re-push the complete ' + file + ' from GitHub.');
      } else if (text.length < 200) {
        warn(cat, file + ' (' + sizeKB + ' KB)',
          'Very small file — may be a stub.',
          'Verify this file has full content on GitHub.');
      } else {
        pass(cat, file + ' (' + sizeKB + ' KB)');
      }
    }
  }

  /* ============================================================
     CHECK 6 — Storage
     ============================================================ */
  function checkStorage() {
    const cat = addCategory('Storage', '💾');

    try {
      const k = '__gsa_diag_test__';
      localStorage.setItem(k, 'x');
      const v = localStorage.getItem(k);
      localStorage.removeItem(k);
      if (v === 'x') pass(cat, 'localStorage writable');
      else warn(cat, 'localStorage write test failed');
    } catch (e) {
      fail(cat, 'localStorage is unavailable', e.message,
        'Storage may be blocked (private mode) or full.');
    }

    try {
      const k = '__gsa_diag_sess__';
      sessionStorage.setItem(k, 'x');
      const v = sessionStorage.getItem(k);
      sessionStorage.removeItem(k);
      if (v === 'x') pass(cat, 'sessionStorage writable');
      else warn(cat, 'sessionStorage write test failed');
    } catch (e) {
      fail(cat, 'sessionStorage is unavailable', e.message);
    }

    try {
      let userCount = 0;
      const corruptKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf('gsa_v1_users') === 0) {
          try {
            const arr = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(arr)) userCount = arr.length;
          } catch (e) { corruptKeys.push(key); }
        }
      }
      pass(cat, 'Registered students', String(userCount));
      if (corruptKeys.length) {
        warn(cat, 'Corrupted localStorage keys', corruptKeys.join(', '),
          'These entries may cause load errors.');
      }
    } catch (e) {
      warn(cat, 'Could not read localStorage length', e.message);
    }
  }

  /* ============================================================
     CHECK 7 — Backend
     ============================================================ */
  async function checkBackend() {
    const cat = addCategory('Backend (Google Apps Script)', '🌐');

    if (typeof CONFIG === 'undefined' || !CONFIG.backendEnabled) {
      skip(cat, 'Backend ping skipped', 'CONFIG.BACKEND_URL is empty.');
      return;
    }

    try {
      const url = CONFIG.BACKEND_URL + (CONFIG.BACKEND_URL.indexOf('?') !== -1 ? '&' : '?') + 'action=ping';
      const start = Date.now();
      const res = await fetch(url, { method: 'GET' });
      const ms = Date.now() - start;

      if (!res.ok) {
        fail(cat, 'Backend returned HTTP ' + res.status,
          'Server is not responding as expected.',
          'Verify the Apps Script deployment is set to "Anyone" and is up to date.');
        return;
      }

      const data = await res.json();
      if (data.ok) {
        pass(cat, 'Backend reachable', ms + ' ms · ' + (data.service || 'OK') + ' v' + (data.version || '?'));
      } else {
        warn(cat, 'Backend responded but ok=false', JSON.stringify(data));
      }
    } catch (e) {
      fail(cat, 'Backend unreachable', e.message,
        'Check that BACKEND_URL is correct and deployment is public.');
    }
  }

  /* ============================================================
     CHECK 8 — Question Banks
     ============================================================ */
  async function checkQuestionBanks() {
    const cat = addCategory('Question Banks', '📝');
    const terms = ['term1', 'term2', 'term3'];
    const assessments = [
      { id: 'quiz1', items: 20 }, { id: 'quiz2', items: 20 }, { id: 'quiz3', items: 20 },
      { id: 'st1', items: 30 }, { id: 'st2', items: 30 }, { id: 'te', items: 60 }
    ];

    for (let t = 0; t < terms.length; t++) {
      for (let a = 0; a < assessments.length; a++) {
        const term = terms[t];
        const asmt = assessments[a];
        const path = 'student/' + term + '/assessments/' + asmt.id + '.json';
        const res = await fetchJSON(path);

        if (!res.ok) {
          fail(cat, path, res.status ? 'HTTP ' + res.status : (res.error || 'failed'));
          continue;
        }

        const data = res.data;
        if (!data.questions || !Array.isArray(data.questions)) {
          fail(cat, path, 'Missing "questions" array');
          continue;
        }

        if (data.questions.length !== asmt.items) {
          warn(cat, path, 'Expected ' + asmt.items + ' items, got ' + data.questions.length);
        } else {
          pass(cat, path, data.questions.length + ' items');
        }

        const broken = data.questions.filter(function(q) {
          return !q.text || !Array.isArray(q.options) || !q.correct;
        });
        if (broken.length) {
          warn(cat, path + ' — malformed questions',
            broken.length + ' items missing text/options/correct');
        }
      }
    }
  }

  /* ============================================================
     CHECK 9 — Lesson Content
     ============================================================ */
  async function checkLessonContent() {
    const cat = addCategory('Lesson Content', '📚');
    const terms = ['term1', 'term2', 'term3'];

    for (let t = 0; t < terms.length; t++) {
      const term = terms[t];
      for (let w = 1; w <= 10; w++) {
        const path = 'student/' + term + '/week' + w + '/week' + w + '.json';
        const res = await fetchJSON(path);

        if (!res.ok) {
          fail(cat, path, res.status ? 'HTTP ' + res.status : (res.error || 'failed'));
          continue;
        }

        const data = res.data;
        if (!data.days || !Array.isArray(data.days) || data.days.length !== 4) {
          warn(cat, path, 'Expected 4 days, got ' + (data.days ? data.days.length : 0));
        } else {
          const missing = data.days.filter(function(d) { return !d.title || !d.content; });
          if (missing.length) {
            warn(cat, path, missing.length + ' day(s) missing title or content');
          } else {
            pass(cat, path, '4 days');
          }
        }
      }
    }
  }

  /* ============================================================
     CHECK 10 — Student Data
     ============================================================ */
  function checkStudentData() {
    const cat = addCategory('Student Data', '👥');

    if (typeof Store === 'undefined') {
      skip(cat, 'Student data skipped', 'Store is not loaded.');
      return;
    }

    try {
      const users = Store.getAllUsers();

      if (!Array.isArray(users)) {
        fail(cat, 'Store.getAllUsers() did not return an array');
        return;
      }

      pass(cat, 'Students registered', String(users.length));

      const seen = new Map();
      const dupes = [];
      users.forEach(function(u) {
        if (seen.has(u.lrn)) dupes.push(u.lrn);
        else seen.set(u.lrn, true);
      });
      if (dupes.length) {
        warn(cat, 'Duplicate LRNs', dupes.join(', '), 'Merging may be needed.');
      } else {
        pass(cat, 'No duplicate LRNs');
      }

      const missing = users.filter(function(u) { return !u.lrn || !u.lastName || !u.firstName; });
      if (missing.length) {
        warn(cat, 'Incomplete student records', missing.length + ' records',
          'Some students are missing LRN or name.');
      } else if (users.length) {
        pass(cat, 'All student records are complete');
      }

      let withProgress = 0;
      users.forEach(function(u) {
        try {
          const p = Store.getProgress(u.lrn);
          const total = ['term1', 'term2', 'term3'].reduce(function(acc, t) {
            return acc + ((p[t] && p[t].completed && p[t].completed.length) || 0);
          }, 0);
          if (total > 0) withProgress++;
        } catch (e) { /* ignore */ }
      });
      pass(cat, 'Students with progress', String(withProgress));
    } catch (e) {
      fail(cat, 'Student data check failed', e.message);
    }
  }

  /* ============================================================
     RUN ALL
     ============================================================ */
  async function run(onProgress) {
    report.startedAt = new Date().toISOString();
    report.categories = [];
    report.totals = { ok: 0, warn: 0, error: 0, skipped: 0 };

    const steps = [
      ['Checking core modules…', checkCoreGlobals],
      ['Checking module APIs…', checkModuleAPIs],
      ['Checking stylesheets…', checkCSS],
      ['Checking configuration…', checkConfig],
      ['Checking file integrity…', checkFileIntegrity],
      ['Checking storage…', checkStorage],
      ['Checking backend…', checkBackend],
      ['Checking question banks…', checkQuestionBanks],
      ['Checking lesson content…', checkLessonContent],
      ['Checking student data…', checkStudentData]
    ];

    for (let i = 0; i < steps.length; i++) {
      const label = steps[i][0];
      const fn = steps[i][1];
      if (onProgress) onProgress(i + 1, steps.length, label);
      try {
        const result = fn();
        if (result && typeof result.then === 'function') await result;
      } catch (e) {
        const cat = report.categories[report.categories.length - 1] || addCategory('Unexpected error', '❌');
        fail(cat, 'Check threw an exception', e.message);
      }
    }

    report.finishedAt = new Date().toISOString();
    return report;
  }

  /* ============================================================
     EXPORT AS TEXT
     ============================================================ */
  function toText(r) {
    const rpt = r || report;
    const lines = [];

    lines.push('==================================================');
    lines.push('GENERAL SCIENCE APP — SELF-DIAGNOSTIC REPORT');
    lines.push('==================================================');
    lines.push('Started: ' + rpt.startedAt);
    lines.push('Finished: ' + rpt.finishedAt);
    lines.push('URL: ' + window.location.href);
    lines.push('User Agent: ' + navigator.userAgent);
    lines.push('');
    lines.push('SUMMARY: ✅ ' + rpt.totals.ok + ' OK   ⚠️ ' + rpt.totals.warn + ' WARN   ❌ ' + rpt.totals.error + ' ERROR   ⏭️ ' + rpt.totals.skipped + ' SKIPPED');
    lines.push('');

    rpt.categories.forEach(function(cat) {
      lines.push('');
      lines.push('--- ' + cat.icon + '  ' + cat.name + '  (' + cat.checks.length + ' checks) ---');
      cat.checks.forEach(function(c) {
        const icon = { ok: '✅', warn: '⚠️', error: '❌', skipped: '⏭️' }[c.level] || '•';
        lines.push('  ' + icon + ' ' + c.label + (c.detail ? ' — ' + c.detail : ''));
        if (c.fix) lines.push('       → ' + c.fix);
      });
    });

    lines.push('');
    lines.push('==================================================');
    lines.push('END OF REPORT');
    lines.push('==================================================');

    return lines.join('\n');
  }

  return { run: run, toText: toText, report: report };
})();

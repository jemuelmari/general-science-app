/* ============================================================
   diagnostics.js — Self-diagnostic engine
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Runs a comprehensive health check on the app and reports:
   - Core file loading status
   - CSS file availability
   - JS module availability + public API
   - Config sanity
   - File integrity (fetch + check endings — catches truncation)
   - Storage availability
   - Backend reachability
   - Question bank validity (27 JSON files)
   - Lesson content validity (30 JSON files)
   - Student data integrity
   ============================================================ */

const Diagnostics = (() => {
  'use strict';

  /* ============================================================
     REPORT STORE
     ============================================================ */
  const report = {
    startedAt: null,
    finishedAt: null,
    categories: [],
    totals: { ok: 0, warn: 0, error: 0, skipped: 0 }
  };

  /* ============================================================
     UTILITIES
     ============================================================ */
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

  /* ============================================================
     CHECK 1 — Core Files Loaded (globals defined)
     ============================================================ */
  function checkCoreGlobals() {
    const cat = addCategory('Core JavaScript Modules', '🧩');

    const modules = [
      { name: 'APP',          test: () => typeof APP !== 'undefined' },
      { name: 'CONFIG',       test: () => typeof CONFIG !== 'undefined' },
      { name: 'Store',        test: () => typeof Store !== 'undefined' },
      { name: 'Security',     test: () => typeof Security !== 'undefined' },
      { name: 'Transmutation',test: () => typeof Transmutation !== 'undefined' },
      { name: 'Sync',         test: () => typeof Sync !== 'undefined' },
      { name: 'Backup',       test: () => typeof Backup !== 'undefined' },
      { name: 'UI',           test: () => typeof UI !== 'undefined' },
      { name: 'TermAccess',   test: () => typeof TermAccess !== 'undefined' },
      { name: 'TeacherAuth',  test: () => typeof TeacherAuth !== 'undefined' },
      { name: 'ActivityTracker', test: () => typeof ActivityTracker !== 'undefined' }
    ];

    modules.forEach((m) => {
      if (m.test()) {
        pass(cat, m.name + ' is loaded');
      } else {
        fail(cat, m.name + ' is NOT loaded',
          'The module\'s script tag may have failed to load, or the file is empty/truncated.',
          'Check that assets/js/' + m.name.toLowerCase() + '.js exists and is complete on GitHub.');
      }
    });
  }

  /* ============================================================
     CHECK 2 — Public API of each module
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

    apis.forEach(({ module, methods }) => {
      // Try multiple lookup methods to handle const declarations
      let mod = null;
      try { mod = eval(module); } catch (e) { mod = null; }
      if (!mod && typeof window !== 'undefined') mod = window[module];
      if (!mod && typeof globalThis !== 'undefined') mod = globalThis[module];

      if (!mod) {
        fail(cat, module + ' API check skipped — module not loaded');
        return;
      }

      const missing = methods.filter((m) => typeof mod[m] !== 'function');
      if (missing.length === 0) {
        pass(cat, module + ' — all ' + methods.length + ' methods present');
      } else {
        warn(cat, module + ' — missing methods: ' + missing.join(', '),
          'The module may be an older version, or the file was truncated.',
          'Re-push the complete ' + module.toLowerCase() + '.js file.');
      }
    });
  }

  /* ============================================================
     CHECK 3 — CSS loaded
     ============================================================ */
  function checkCSS() {
    const cat = addCategory('CSS Stylesheets', '🎨');

    const expected = ['main.css', 'student.css', 'teacher.css', 'classrecord.css', 'quiz.css'];
    const loaded = new Set();

    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        const href = sheet.href || '';
        const match = href.match(/\/([^/]+\.css)(\?|$)/);
        if (match) loaded.add(match[1]);
      } catch (e) { /* CORS-restricted */ }
    });

    expected.forEach((file) => {
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
     CHECK 4 — Config sanity
     ============================================================ */
  function checkConfig() {
    const cat = addCategory('Configuration', '⚙️');

    if (typeof CONFIG === 'undefined') {
      fail(cat, 'CONFIG is undefined', 'config.js did not load.');
      return;
    }

    // Sections
    if (Array.isArray(CONFIG.SECTIONS) && CONFIG.SECTIONS.length >= 1) {
      pass(cat, 'Sections defined', CONFIG.SECTIONS.join(', '));
    } else {
      warn(cat, 'CONFIG.SECTIONS missing or empty',
        'Default sections will not be shown.',
        'Add SECTIONS: ["ACADEMIC A", "ACADEMIC B"] to config.js.');
    }

    // Weights
    const w = CONFIG.WEIGHTS;
    if (w && typeof w.ww === 'number' && typeof w.pt === 'number' && typeof w.ex === 'number') {
      const sum = w.ww + w.pt + w.ex;
      if (Math.abs(sum - 1.0) < 0.001) {
        pass(cat, 'Weights sum to 1.0', `WW ${w.ww} + PT ${w.pt} + EX ${w.ex}`);
      } else {
        warn(cat, 'Weights do not sum to 1.0', 'Sum = ' + sum.toFixed(4));
      }
    } else {
      warn(cat, 'CONFIG.WEIGHTS missing or malformed');
    }

    // Teacher password hash
    const hash = CONFIG.TEACHER_PASSWORD_HASH;
    if (typeof hash === 'string' && hash.length === 64) {
      pass(cat, 'Teacher password hash is valid length', '64 chars');
    } else {
      fail(cat, 'Teacher password hash is invalid',
        'Expected 64-character SHA-256 hex, got: ' + (hash ? hash.length + ' chars' : 'undefined'),
        'Update config.js → TEACHER_PASSWORD_HASH.');
    }

    // Backend
    if (CONFIG.backendEnabled) {
      pass(cat, 'Backend URL configured', CONFIG.BACKEND_URL.slice(0, 60) + '…');
    } else {
      warn(cat, 'CONFIG.BACKEND_URL is empty',
        'Sync Codes will only work on the same device.',
        'Deploy the Apps Script backend and paste the URL into config.js.');
    }

    // Version
    if (CONFIG.VERSION) {
      pass(cat, 'App version', CONFIG.VERSION);
    }
  }

  /* ============================================================
     CHECK 5 — File Integrity (fetch and verify endings)
     ============================================================ */
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
      'config.js'
    ];

    for (const file of files) {
      const res = await fetchText(file);

      if (!res.ok) {
        fail(cat, file,
          res.status ? `HTTP ${res.status}` : (res.error || 'fetch failed'),
          'File may be missing on GitHub. Check the path.');
        continue;
      }

      const text = res.text;
      const trimmed = text.trimEnd();
      const sizeKB = (text.length / 1024).toFixed(1);

      // Truncation heuristic: file must end with `})();`, `};`, `}`, or `;`
      const endsOK = /(\}\)\(\)|}\)\(\);|};|})$/m.test(trimmed);

      if (!endsOK) {
        fail(cat, file + ' (' + sizeKB + ' KB)',
          'Does not end with a valid closing brace — LIKELY TRUNCATED.',
          'Re-push the complete ' + file + ' from your Codespace.');
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

    // localStorage
    try {
      const k = '__gsa_diag_test__';
      localStorage.setItem(k, 'x');
      const v = localStorage.getItem(k);
      localStorage.removeItem(k);
      if (v === 'x') pass(cat, 'localStorage writable');
      else warn(cat, 'localStorage write test failed');
    } catch (e) {
      fail(cat, 'localStorage is unavailable',
        e.message,
        'Storage may be blocked (private mode) or full.');
    }

    // sessionStorage
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

    // Count stored records
    try {
      let userCount = 0;
      let corruptKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('gsa_v1_users')) {
          try {
            const arr = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(arr)) userCount = arr.length;
          } catch (e) { corruptKeys.push(key); }
        }
      }
      pass(cat, 'Registered students', String(userCount));
      if (corruptKeys.length) {
        warn(cat, 'Corrupted localStorage keys',
          corruptKeys.join(', '),
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
      const url = CONFIG.BACKEND_URL + (CONFIG.BACKEND_URL.includes('?') ? '&' : '?') + 'action=ping';
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
        pass(cat, 'Backend reachable', ms + ' ms · ' + (data.service || 'OK'));
      } else {
        warn(cat, 'Backend responded but ok=false', JSON.stringify(data));
      }
    } catch (e) {
      fail(cat, 'Backend unreachable',
        e.message,
        'Check that BACKEND_URL is correct and deployment is public.');
    }
  }

  /* ============================================================
     CHECK 8 — Question banks (27 JSON files)
     ============================================================ */
  async function checkQuestionBanks() {
    const cat = addCategory('Question Banks', '📝');

    const terms = ['term1', 'term2', 'term3'];
    const assessments = [
      { id: 'quiz1', type: 'quiz', items: 20 },
      { id: 'quiz2', type: 'quiz', items: 20 },
      { id: 'quiz3', type: 'quiz', items: 20 },
      { id: 'st1',   type: 'st',   items: 30 },
      { id: 'st2',   type: 'st',   items: 30 },
      { id: 'te',    type: 'te',   items: 60 }
    ];

    for (const term of terms) {
      for (const a of assessments) {
        const path = `student/${term}/assessments/${a.id}.json`;
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

        if (data.questions.length !== a.items) {
          warn(cat, path,
            `Expected ${a.items} items, got ${data.questions.length}`);
        } else {
          pass(cat, path, `${data.questions.length} items`);
        }

        // Check that each question has choices and a correct answer
        const broken = data.questions.filter((q) =>
          !q.text || !Array.isArray(q.options) || !q.correct
        );
        if (broken.length) {
          warn(cat, path + ' — malformed questions',
            broken.length + ' items missing text/options/correct');
        }
      }
    }
  }

  /* ============================================================
     CHECK 9 — Lesson content (30 weeks)
     ============================================================ */
  async function checkLessonContent() {
    const cat = addCategory('Lesson Content', '📚');

    const terms = ['term1', 'term2', 'term3'];

    for (const term of terms) {
      for (let w = 1; w <= 10; w++) {
        const path = `student/${term}/week${w}/week${w}.json`;
        const res = await fetchJSON(path);

        if (!res.ok) {
          fail(cat, path, res.status ? 'HTTP ' + res.status : (res.error || 'failed'));
          continue;
        }

        const data = res.data;
        if (!data.days || !Array.isArray(data.days) || data.days.length !== 4) {
          warn(cat, path,
            'Expected 4 days, got ' + (data.days ? data.days.length : 0));
        } else {
          const missing = data.days.filter((d) => !d.title || !d.content);
          if (missing.length) {
            warn(cat, path,
              missing.length + ' day(s) missing title or content');
          } else {
            pass(cat, path, '4 days');
          }
        }
      }
    }
  }

  /* ============================================================
     CHECK 10 — Student data integrity
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

      // Duplicate LRNs
      const seen = new Map();
      const dupes = [];
      users.forEach((u) => {
        if (seen.has(u.lrn)) dupes.push(u.lrn);
        else seen.set(u.lrn, true);
      });
      if (dupes.length) {
        warn(cat, 'Duplicate LRNs', dupes.join(', '),
          'Merging may be needed.');
      } else {
        pass(cat, 'No duplicate LRNs');
      }

      // Missing fields
      const missing = users.filter((u) => !u.lrn || !u.lastName || !u.firstName);
      if (missing.length) {
        warn(cat, 'Incomplete student records', missing.length + ' records',
          'Some students are missing LRN or name.');
      } else if (users.length) {
        pass(cat, 'All student records are complete');
      }

      // Count progress
      let withProgress = 0;
      users.forEach((u) => {
        try {
          const p = Store.getProgress(u.lrn);
          const total = ['term1', 'term2', 'term3'].reduce(
            (acc, t) => acc + ((p[t] && p[t].completed && p[t].completed.length) || 0), 0);
          if (total > 0) withProgress++;
        } catch (e) { /* ignore */ }
      });
      pass(cat, 'Students with progress', String(withProgress));
    } catch (e) {
      fail(cat, 'Student data check failed', e.message);
    }
  }

  /* ============================================================
     RUN ALL CHECKS
     ============================================================ */
  async function run(onProgress) {
    report.startedAt = new Date().toISOString();
    report.categories = [];
    report.totals = { ok: 0, warn: 0, error: 0, skipped: 0 };

    const steps = [
      ['Checking core modules…',        checkCoreGlobals],
      ['Checking module APIs…',         checkModuleAPIs],
      ['Checking stylesheets…',         checkCSS],
      ['Checking configuration…',       checkConfig],
      ['Checking file integrity…',      checkFileIntegrity],
      ['Checking storage…',             checkStorage],
      ['Checking backend…',             checkBackend],
      ['Checking question banks…',      checkQuestionBanks],
      ['Checking lesson content…',      checkLessonContent],
      ['Checking student data…',        checkStudentData]
    ];

    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      if (onProgress) onProgress(i + 1, steps.length, label);
      try {
        const result = fn();
        if (result && typeof result.then === 'function') await result;
      } catch (e) {
        fail(report.categories[report.categories.length - 1] || addCategory('Unexpected error', '❌'),
          'Check threw an exception', e.message);
      }
    }

    report.finishedAt = new Date().toISOString();
    return report;
  }

  /* ============================================================
     EXPORT REPORT AS TEXT
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
    lines.push(`SUMMARY: ✅ ${rpt.totals.ok} OK   ⚠️ ${rpt.totals.warn} WARN   ❌ ${rpt.totals.error} ERROR   ⏭️ ${rpt.totals.skipped} SKIPPED`);
    lines.push('');

    rpt.categories.forEach((cat) => {
      lines.push('');
      lines.push(`--- ${cat.icon}  ${cat.name}  (${cat.checks.length} checks) ---`);
      cat.checks.forEach((c) => {
        const icon = { ok: '✅', warn: '⚠️', error: '❌', skipped: '⏭️' }[c.level] || '•';
        lines.push(`  ${icon} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
        if (c.fix) lines.push(`       → ${c.fix}`);
      });
    });

    lines.push('');
    lines.push('==================================================');
    lines.push('END OF REPORT');
    lines.push('==================================================');

    return lines.join('\n');
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return { run, toText, report };
})();

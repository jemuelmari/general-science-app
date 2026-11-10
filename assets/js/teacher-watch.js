/* ============================================================
   teacher-watch.js — "New student data" banner for teacher pages
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Students sync their progress to the Google Sheet. A teacher page only reads the
   sheet when it loads, so the data on screen can be stale. This script asks the
   backend (action: getDataVersion — a tiny request, no sheet scan) every 30s whether
   anything changed since the page loaded. If so it shows a banner:

        "New student data is available. Refresh the page to see it.   [Refresh]"

   - The page is NEVER reloaded automatically (the teacher may be typing / grading).
   - Loaded automatically by teacher-auth.js on every authenticated teacher page.
   - Baseline: TeacherCloud.fetchStudents() passes the dataVersion that came with the data
     (setBaseline). Pages that do not use TeacherCloud use the first poll as baseline.
   - Token: the teacher password saved at login (sessionStorage 'gsa_teacher_token').
   - Public API: window.TeacherWatch.{ setBaseline(v), checkNow(), last() }
   ============================================================ */
(function () {
  'use strict';
  if (window.__GSA_TWATCH_LOADED) return;
  window.__GSA_TWATCH_LOADED = true;

  var TOKEN_KEY = 'gsa_teacher_token';
  var INTERVAL_MS = 30 * 1000;
  var BANNER_ID = 'gsa-twatch-banner';

  var baseline = null;      // dataVersion the data on screen belongs to
  var latest = null;        // newest version seen from the server
  var dismissedFor = null;  // version the teacher chose "Later" for
  var running = false;
  var failures = 0;

  // TeacherCloud may have loaded before this script
  if (typeof window.__gsaDataVersion === 'string' && window.__gsaDataVersion) baseline = window.__gsaDataVersion;

  function enabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.BACKEND_URL;
  }

  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function loggedIn() {
    try {
      if (typeof TeacherAuth !== 'undefined' && TeacherAuth.isAuthenticated) return TeacherAuth.isAuthenticated();
    } catch (e) { /* fall through */ }
    return true;
  }

  async function fetchVersion() {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    try {
      var res = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getDataVersion', token: token() }),
        signal: ctrl ? ctrl.signal : undefined
      });
      var text = await res.text();
      var data = JSON.parse(text);
      if (!data || !data.ok) throw new Error((data && data.error) || 'getDataVersion failed');
      return String(data.version || '');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------- banner ---------- */
  function showBanner() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showBanner, { once: true }); return; }
    var el = document.getElementById(BANNER_ID);
    if (el) return;
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'background:#0d47a1;color:#fff;padding:10px 14px;border-radius:10px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.28);font:600 13px/1.35 system-ui,sans-serif;' +
      'display:flex;gap:10px;align-items:center;max-width:min(560px,calc(100vw - 24px));';

    var msg = document.createElement('span');
    msg.textContent = '🔄 New student data is available. Refresh the page to see it.';
    msg.style.flex = '1';
    el.appendChild(msg);

    var refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.style.cssText = 'background:#fff;color:#0d47a1;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;';
    refresh.addEventListener('click', function () { location.reload(); });
    el.appendChild(refresh);

    var later = document.createElement('button');
    later.type = 'button';
    later.textContent = '✕';
    later.title = 'Later';
    later.setAttribute('aria-label', 'Dismiss');
    later.style.cssText = 'background:transparent;color:#fff;border:0;font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;opacity:.85;';
    later.addEventListener('click', function () { dismissedFor = latest; hideBanner(); });
    el.appendChild(later);

    document.body.appendChild(el);
  }

  function hideBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ---------- logic ---------- */
  // The data on screen was just (re)loaded together with this version
  function setBaseline(v) {
    if (!v) return;
    baseline = String(v);
    dismissedFor = null;
    if (latest === null || latest === baseline) hideBanner();
    else if (latest !== baseline && dismissedFor !== latest) showBanner();
  }

  async function checkNow() {
    if (running) return;
    if (!enabled() || !token() || !loggedIn()) return;
    running = true;
    try {
      var v = await fetchVersion();
      failures = 0;
      latest = v;
      if (baseline === null) { baseline = v; return; }   // first poll = baseline
      if (v !== baseline) { if (dismissedFor !== v) showBanner(); }
      else hideBanner();
    } catch (e) {
      failures++;
      if (failures === 1) console.warn('[TeacherWatch]', e && e.message);
    } finally {
      running = false;
    }
  }

  function tick() {
    if (document.hidden) return;
    checkNow();
  }

  window.TeacherWatch = {
    setBaseline: setBaseline,
    checkNow: checkNow,
    last: function () { return { baseline: baseline, latest: latest }; }
  };

  function start() {
    setTimeout(tick, 1500);
    setInterval(tick, INTERVAL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(tick, 300); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

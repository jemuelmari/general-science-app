/* ============================================================
   app.js — Router, state, and global initialization
   Version: 1.0.0
   App: General Science Online Modular Application
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '1.0.0';
  const APP_NAME = (typeof CONFIG !== 'undefined' && CONFIG.APP_NAME) || 'General Science Online Modular Application';

  /* ---------- State ---------- */
  const state = {
    currentUser: null,
    currentSubject: null,
    currentTerm: null,
    currentWeek: null,
    currentDay: null,
    sessionStart: null
  };

  /* ---------- Router ---------- */
  const Router = {
    routes: {},
    current: null,

    register(path, handler) {
      this.routes[path] = handler;
    },

    navigate(path, params = {}) {
      const [base] = path.split('?');
      const handler = this.routes[base];
      if (!handler) {
        console.warn(`[Router] No route for: ${base}`);
        return;
      }
      this.current = base;
      window.history.pushState({ path: base, params }, '', `#${base}`);
      handler(params);
    },

    init() {
      window.addEventListener('popstate', (e) => {
        const path = e.state?.path || window.location.hash.slice(1) || '/';
        const handler = this.routes[path];
        if (handler) handler(e.state?.params || {});
      });

      const initial = window.location.hash.slice(1) || '/';
      const handler = this.routes[initial];
      if (handler) handler({});
    }
  };

  /* ---------- Helpers ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        node.setAttribute(k, v);
      }
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  /* ---------- Toast Notifications ---------- */
  function toast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container') || (() => {
      const c = el('div', {
        id: 'toast-container',
        style: 'position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;'
      });
      document.body.appendChild(c);
      return c;
    })();

    const colors = {
      success: '#2e7d32',
      warning: '#ed6c02',
      danger: '#c62828',
      info: '#0277bd'
    };

    const t = el('div', {
      style: `
        background:${colors[type] || colors.info};
        color:#fff;
        padding:12px 20px;
        border-radius:8px;
        box-shadow:0 4px 16px rgba(0,0,0,0.2);
        font-size:0.9rem;
        font-weight:500;
        animation:slideIn 0.3s ease-out;
        max-width:320px;
      `,
      text: message
    });

    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  /* ---------- Formatters ---------- */
  function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatLRN(lrn) {
    return String(lrn).replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  /* ---------- Name Formatting Helpers ---------- */
  function toTitleCase(str) {
    if (!str) return '';
    return str
      .toString()
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function toLastNameFormat(str) {
    if (!str) return '';
    return str.toString().trim().toUpperCase();
  }

  function formatFullName(lastName, firstName, middleName) {
    const last = toLastNameFormat(lastName);
    const first = toTitleCase(firstName);
    const middle = middleName ? ' ' + toTitleCase(middleName) : '';
    return `${last}, ${first}${middle}`.trim();
  }

  function formatFullNameFML(lastName, firstName, middleName) {
    const last = toLastNameFormat(lastName);
    const first = toTitleCase(firstName);
    const middle = middleName ? ' ' + toTitleCase(middleName) : '';
    return `${first}${middle} ${last}`.trim();
  }

  /* ---------- Sex Helpers ---------- */
  function getSexValue(sex) {
    if (!sex) return '';
    const s = String(sex).trim().toLowerCase();
    if (s === 'male' || s === 'm') return 'Male';
    if (s === 'female' || s === 'f') return 'Female';
    return '';
  }

  function getSexCode(sex) {
    const v = getSexValue(sex);
    if (v === 'Male') return 'M';
    if (v === 'Female') return 'F';
    return '—';
  }

  function getSexIcon(sex) {
    const v = getSexValue(sex);
    if (v === 'Male') return '♂️';
    if (v === 'Female') return '♀️';
    return '';
  }

  function getSexBadge(sex) {
    const v = getSexValue(sex);
    if (!v) return '<span style="color:#bdbdbd;">—</span>';
    if (v === 'Male') {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:#e3f2fd;color:#0d47a1;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;">♂ M</span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:#fce4ec;color:#ad1457;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;">♀ F</span>';
  }

  /* ---------- Sorting Helpers ---------- */
  function sortStudents(list, order = 'last', dir = 'asc') {
    const arr = [...list];
    const dirMult = dir === 'desc' ? -1 : 1;

    return arr.sort((a, b) => {
      const ua = a.user || a;
      const ub = b.user || b;

      const aLast = (ua.lastName || '').toUpperCase();
      const bLast = (ub.lastName || '').toUpperCase();
      const aFirst = (ua.firstName || '').toUpperCase();
      const bFirst = (ub.firstName || '').toUpperCase();

      if (order === 'first') {
        if (aFirst !== bFirst) return aFirst.localeCompare(bFirst) * dirMult;
        if (aLast !== bLast) return aLast.localeCompare(bLast) * dirMult;
      } else {
        if (aLast !== bLast) return aLast.localeCompare(bLast) * dirMult;
        if (aFirst !== bFirst) return aFirst.localeCompare(bFirst) * dirMult;
      }

      const aMid = (ua.middleName || '').toUpperCase();
      const bMid = (ub.middleName || '').toUpperCase();
      return aMid.localeCompare(bMid) * dirMult;
    });
  }

  /* ---------- Validation ---------- */
  function validateLRN(lrn) {
    return /^\d{12}$/.test(String(lrn).replace(/\D/g, ''));
  }

  function validateName(name) {
    return typeof name === 'string' && name.trim().length >= 2;
  }

  /* ---------- Version Rendering ---------- */
  function renderVersions() {
    const v = `v${VERSION}`;

    document.querySelectorAll('.version').forEach((e) => {
      e.textContent = v;
    });

    document.querySelectorAll('[data-version]').forEach((e) => {
      e.textContent = v;
    });

    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      footer.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const updated = node.textContent.replace(/v\d+\.\d+\.\d+/g, v);
          if (updated !== node.textContent) {
            node.textContent = updated;
          }
        }
        node.querySelectorAll?.('p').forEach((p) => {
          const updated = p.textContent.replace(/v\d+\.\d+\.\d+/g, v);
          if (updated !== p.textContent) {
            p.textContent = updated;
          }
        });
      });
    });

    if (document.title.includes('v')) {
      document.title = document.title.replace(/v\d+\.\d+\.\d+/g, v);
    }
  }

  /* ---------- Developer Footer ---------- */
  function renderDeveloperFooter() {
    if (typeof CONFIG === 'undefined' || !CONFIG.DEVELOPER) return;
    const dev = CONFIG.DEVELOPER;

    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      if (footer.querySelector('.dev-credit')) return;

      const credit = document.createElement('div');
      credit.className = 'dev-credit';
      credit.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);font-size:0.75rem;line-height:1.6;';
      credit.innerHTML = `
        <div style="font-weight:600;color:var(--color-primary-dark);">${dev.name}</div>
        <div>${dev.position}</div>
        <div>${dev.school} · ${dev.district}</div>
        <div>${dev.division} · ${dev.region}</div>
        <div>${dev.department}</div>
      `;
      footer.appendChild(credit);
    });
  }

  /* ---------- Inject Manifest Meta ---------- */
    function injectManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;

    // Compute depth-based path to root
    const path = window.location.pathname;
    let depth = 0;

    // Count directory depth below the app root
    // Examples:
    //   /general-science-app/                                     → 0
    //   /general-science-app/student/dashboard.html               → 1  (../)
    //   /general-science-app/student/term2/index.html             → 2  (../../)
    //   /general-science-app/student/term2/week1/day.html         → 3  (../../../)
    //   /general-science-app/student/term2/week1/assessments/...  → 4  (../../../../)
    //   /general-science-app/teacher/xxx.html                     → 2  (../../)
    //   /general-science-app/classrecord/xxx.html                 → 2  (../../)

    // Strip leading slash + repo name (first path segment)
    let parts = path.split('/').filter(Boolean);

    // Remove the leading repo name (e.g., "general-science-app")
    // If the app is deployed at the domain root, there is no repo name —
    // in that case `parts` is just the sub-path.
    // We detect by checking if the last part contains a '.html' or is empty.
    // Safer: use document.baseURI or a known anchor.
    // Simpler heuristic: the repo name is the first segment when the path
    // does NOT start with the app root. This handles both GitHub Pages
    // sub-path deployments and custom-domain root deployments.
    if (parts.length > 0) parts = parts.slice(1); // remove repo name or first segment

    // Remove the last segment if it's a file
    if (parts.length > 0 && /\.(html|htm)$/i.test(parts[parts.length - 1])) {
      parts.pop();
    }

    depth = parts.length;

    const prefix = depth > 0 ? '../'.repeat(depth) : './';
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = prefix + 'manifest.json';
    document.head.appendChild(link);

    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0d47a1';
    document.head.appendChild(meta);
  }

  /* ---------- Init ---------- */
  function init() {
    console.log(`[${APP_NAME}] v${VERSION}`);
    renderVersions();
    injectManifest();
    renderDeveloperFooter();
    Router.init();
  }

  /* ---------- Public API ---------- */
  return {
    VERSION,
    APP_NAME,
    state,
    Router,
    $, $$, el,
    toast,
    formatDate,
    formatTime,
    formatLRN,
    toTitleCase,
    toLastNameFormat,
    formatFullName,
    formatFullNameFML,
    getSexValue,
    getSexCode,
    getSexIcon,
    getSexBadge,
    sortStudents,
    validateLRN,
    validateName,
    renderVersions,
    renderDeveloperFooter,
    init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);

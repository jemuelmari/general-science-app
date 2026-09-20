/* ============================================================
   app.js — Router, state, and global initialization
   Version: 1.2.0
   App: General Science Online Modular Application
   ------------------------------------------------------------
   Changelog v1.2.0 (Phase 2 / X13 + X15 fix):
     - formatLRN() regex now uses 12 digits (was 11) to match
       auth.js and Philippine LRN format.
     - injectManifest() computes correct relative path using
       document.baseURI — no more broken manifest on week pages.
     - renderVersions() uses stricter regex on <title>.
     - renderDeveloperFooter() handles missing DEVELOPER gracefully.
     - Added getSetLetterForSection() helper (Set A / Set B).

   Changelog v1.1.0: Enhanced version rendering.
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '1.0.0';
  const BUILD_DATE = (typeof CONFIG !== 'undefined' && CONFIG.BUILD_DATE) || '';
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

  /**
   * ⚠️ X13 FIX: Philippine LRN is 12 digits. Format as 1234-5678-9012.
   * Previously used 11-digit regex which produced malformed output.
   */
  function formatLRN(lrn) {
    return String(lrn).replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3');
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

  /* ---------- Set A / Set B Helper ---------- */
  /**
   * Returns 'A' or 'B' based on student section.
   * Uses CONFIG.SET_ASSIGNMENT if available.
   */
  function getSetLetterForSection(section) {
    if (typeof CONFIG !== 'undefined' && CONFIG.SET_ASSIGNMENT && CONFIG.SET_ASSIGNMENT[section]) {
      return CONFIG.SET_ASSIGNMENT[section];
    }
    // Fallback default
    return 'A';
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

  /* ---------- Version String Builder ---------- */
  function versionString() {
    const v = 'v' + VERSION;
    return BUILD_DATE ? v + ' · build ' + BUILD_DATE : v;
  }

  /* ---------- Version Rendering ---------- */
  function renderVersions() {
    const vDisplay = versionString();
    const vSimple = 'v' + VERSION;

    document.querySelectorAll('.version, [data-version]').forEach((e) => {
      const attr = e.getAttribute('data-version');
      if (attr === 'simple') {
        e.textContent = vSimple;
      } else {
        e.textContent = vDisplay;
      }
    });

    // Footer text — replace version pattern
    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      footer.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const updated = node.textContent.replace(/v\d+\.\d+\.\d+/g, vDisplay);
          if (updated !== node.textContent) node.textContent = updated;
        }
        node.querySelectorAll?.('p').forEach((p) => {
          const updated = p.textContent.replace(/v\d+\.\d+\.\d+/g, vDisplay);
          if (updated !== p.textContent) p.textContent = updated;
        });
      });
    });

    // ⚠️ X13: stricter regex on <title>
    if (/v\d+\.\d+\.\d+/.test(document.title)) {
      document.title = document.title.replace(/v\d+\.\d+\.\d+/g, vSimple);
    }

    // meta name="app-version"
    let metaV = document.querySelector('meta[name="app-version"]');
    if (!metaV) {
      metaV = document.createElement('meta');
      metaV.name = 'app-version';
      document.head.appendChild(metaV);
    }
    metaV.content = versionString();

    if (!window.__versionLogged) {
      console.log(`[${APP_NAME}] ${versionString()}`);
      window.__versionLogged = true;
    }
  }

  /* ---------- Developer Footer ---------- */
  function renderDeveloperFooter() {
    // ⚠️ Guard: only render if CONFIG.DEVELOPER exists
    if (typeof CONFIG === 'undefined') return;
    const dev = CONFIG.DEVELOPER;
    if (!dev) return;

    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      if (footer.querySelector('.dev-credit')) return;

      const credit = document.createElement('div');
      credit.className = 'dev-credit';
      credit.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);font-size:0.75rem;line-height:1.6;';
      credit.innerHTML = `
        <div style="font-weight:600;color:var(--color-primary-dark);">${dev.name || ''}</div>
        <div>${dev.position || ''}</div>
        <div>${dev.school || ''} · ${dev.district || ''}</div>
        <div>${dev.division || ''} · ${dev.region || ''}</div>
        <div>${dev.department || ''}</div>
      `;
      footer.appendChild(credit);
    });
  }

  /* ---------- Inject Manifest Meta ---------- */
  /**
   * ⚠️ X15 FIX: Compute correct relative path using document.baseURI
   * so manifest.json resolves correctly from any page depth
   * (root, /student/, /student/term1/week1/, etc.).
   */
  function injectManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;

    // Compute path to repo root relative to the current page
    // by finding the common ancestor between document.baseURI and the repo root.
    const base = document.baseURI || window.location.href;
    // We assume manifest.json is at repo root. Walk up from current dir
    // to find repo root (which contains config.js).
    const scripts = document.querySelectorAll('script[src*="config.js"]');
    let manifestHref = 'manifest.json';
    if (scripts.length) {
      const cfgSrc = scripts[0].getAttribute('src');
      // config.js is at repo root → strip "config.js" to get path to root
      manifestHref = cfgSrc.replace(/config\.js.*$/, '') + 'manifest.json';
    }

    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = manifestHref;
    document.head.appendChild(link);

    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0d47a1';
    document.head.appendChild(meta);
  }

  /* ---------- Init ---------- */
  function init() {
    renderVersions();
    injectManifest();
    renderDeveloperFooter();
    Router.init();
  }

  /* ---------- Public API ---------- */
  return {
    VERSION,
    BUILD_DATE,
    APP_NAME,
    versionString,
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
    getSetLetterForSection,
    sortStudents,
    validateLRN,
    validateName,
    renderVersions,
    renderDeveloperFooter,
    init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);

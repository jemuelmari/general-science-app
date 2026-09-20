/* ============================================================
   version-sync.js — Centralized version display writer
   Version: 1.0.0
   ------------------------------------------------------------
   Include this AFTER config.js and BEFORE any inline scripts
   that display the version. It writes the current version
   everywhere on the page.
   ============================================================ */

(function() {
  'use strict';

  function computeVersionString() {
    var v = 'v1.0.0';
    var build = '';

    try {
      if (typeof CONFIG !== 'undefined' && CONFIG) {
        if (CONFIG.VERSION) v = 'v' + CONFIG.VERSION;
        if (CONFIG.BUILD_DATE) build = ' · build ' + CONFIG.BUILD_DATE;
      }
    } catch (e) { /* ignore */ }

    return v + build;
  }

  function applyVersion() {
    var full = computeVersionString();
    var simple = full.split(' · ')[0];

    document.querySelectorAll('.version').forEach(function(el) {
      el.textContent = full;
    });

    document.querySelectorAll('[data-version]').forEach(function(el) {
      var attr = el.getAttribute('data-version');
      el.textContent = (attr === 'simple') ? simple : full;
    });

    document.querySelectorAll('.app-footer p, footer p').forEach(function(p) {
      var updated = p.innerHTML.replace(/v\d+\.\d+\.\d+(\s·\sbuild\s\d{4}-\d{2}-\d{2})?/g, full);
      if (updated !== p.innerHTML) p.innerHTML = updated;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion);
  } else {
    applyVersion();
  }

  // Also update any dynamically-added .version elements
  var observer = new MutationObserver(function(mutations) {
    var shouldUpdate = false;
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          if (node.classList && node.classList.contains('version')) shouldUpdate = true;
          if (node.querySelector && node.querySelector('.version')) shouldUpdate = true;
        }
      });
    });
    if (shouldUpdate) applyVersion();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Expose for manual refresh
  window.VersionSync = { apply: applyVersion, get: computeVersionString };
})();

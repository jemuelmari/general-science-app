/* ============================================================
   teacher-auth-boot.js — Shared auth bootloader for teacher pages
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Problem solved: teacher-auth.js declares `const TeacherAuth`,
   which does NOT become a window property. Pages that check
   `window.TeacherAuth` fail even when the module loaded fine.
   Also, script tag timing can cause checks to run before
   teacher-auth.js finishes executing.

   Usage on any teacher page:

     <script src="../assets/js/teacher-auth-boot.js?v=1"></script>
     <script>
       TeacherAuthBoot.ready(function(auth) {
         // auth === TeacherAuth
         if (!auth.require()) return;
         // ...rest of page logic
       }, function() {
         // called if auth never loads (optional)
         document.getElementById('error-slot').innerHTML = '...';
       });
     </script>
   ============================================================ */

const TeacherAuthBoot = (() => {
  'use strict';

  const MAX_ATTEMPTS = 50;   // 50 × 100ms = 5 seconds max wait
  const INTERVAL_MS = 100;

  /**
   * Wait for TeacherAuth to be defined, then call onReady(auth).
   * If it never loads within 5s, call onFail().
   */
  function ready(onReady, onFail) {
    var attempts = 0;

    function check() {
      var auth = null;

      // Reference the bare identifier to catch `const` declarations
      try {
        if (typeof TeacherAuth !== 'undefined' && TeacherAuth) {
          auth = TeacherAuth;
        }
      } catch (e) {
        auth = null;
      }

      // Fallback to window property (in case someone assigns it there)
      if (!auth && typeof window !== 'undefined' && window.TeacherAuth) {
        auth = window.TeacherAuth;
      }

      // Must have init + require to be considered usable
      if (auth && typeof auth.init === 'function' && typeof auth.require === 'function') {
        try {
          auth.init();
        } catch (err) {
          console.error('[TeacherAuthBoot] auth.init() failed:', err);
        }
        onReady(auth);
        return;
      }

      attempts++;
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(check, INTERVAL_MS);
      } else {
        console.error('[TeacherAuthBoot] TeacherAuth never loaded after ' + (MAX_ATTEMPTS * INTERVAL_MS / 1000) + 's');
        if (typeof onFail === 'function') onFail();
      }
    }

    check();
  }

  return { ready };
})();

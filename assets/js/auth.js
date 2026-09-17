/* ============================================================
   auth.js — Login, register, multi-user session handling
   Version: 1.0.0
   App: General Science
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Handle pending logout prompt ---------- */
  function checkPendingLogout() {
    const pending = sessionStorage.getItem('gsa_logout_pending');
    if (!pending) return;
    sessionStorage.removeItem('gsa_logout_pending');

    try {
      const { lrn, at } = JSON.parse(pending);
      if (Date.now() - at > 60000) return;

      const user = Store.getUser(lrn);
      if (!user) return;

      setTimeout(() => {
        Backup.promptOnLogout(user).then((choice) => {
          if (choice === 'keep' || choice === 'delete') {
            APP.toast('Done!', 'success');
          }
        });
      }, 300);
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     Tab switching
     ============================================================ */
  const tabs = APP.$$('.login-tab');
  const panels = {
    login: APP.$('#tab-login'),
    register: APP.$('#tab-register'),
    saved: APP.$('#tab-saved')
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach((p) => p?.classList.add('hidden'));
      const key = tab.dataset.tab;
      panels[key]?.classList.remove('hidden');
      if (key === 'saved') renderSavedUsers();
    });
  });

  /* ---------- LRN input formatting ---------- */
  function attachLRNFormatter(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      let v = input.value.replace(/\D/g, '').slice(0, 12);
      v = v.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3');
      input.value = v;
    });
  }

  attachLRNFormatter(APP.$('#login-lrn'));
  attachLRNFormatter(APP.$('#reg-lrn'));

  /* ---------- Name auto-formatting (live, on blur) ---------- */
  function attachNameFormatter(input, mode) {
    if (!input) return;
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (!v) return;
      if (mode === 'last') {
        input.value = APP.toLastNameFormat(v);
      } else {
        input.value = APP.toTitleCase(v);
      }
    });
  }

  attachNameFormatter(APP.$('#reg-lastname'), 'last');
  attachNameFormatter(APP.$('#reg-firstname'), 'title');
  attachNameFormatter(APP.$('#reg-middlename'), 'title');

  /* ============================================================
     Login
     ============================================================ */
  const loginForm = APP.$('#login-form');
  const loginError = APP.$('#login-error');

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      loginError.classList.add('hidden');

      const lrn = APP.$('#login-lrn').value.replace(/\D/g, '');

      if (!APP.validateLRN(lrn)) {
        return showError(loginError, 'LRN must be exactly 12 digits.');
      }

      const user = Store.getUser(lrn);
      if (!user) {
        return showError(loginError, 'No saved profile found for this LRN. Please register as a new student.');
      }

      Store.setSession(lrn);
      APP.toast(`Welcome back, ${user.firstName}!`, 'success');
      setTimeout(() => window.location.replace('dashboard.html'), 300);
    });
  }

  /* ============================================================
     Register
     ============================================================ */
  const registerForm = APP.$('#register-form');
  const registerError = APP.$('#register-error');

  if (registerForm) {
    registerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      registerError.classList.add('hidden');

      const lastName = APP.toLastNameFormat(APP.$('#reg-lastname').value.trim());
      const firstName = APP.toTitleCase(APP.$('#reg-firstname').value.trim());
      const middleName = APP.toTitleCase(APP.$('#reg-middlename').value.trim());
      const lrn = APP.$('#reg-lrn').value.replace(/\D/g, '');
      const gradeLevel = APP.$('#reg-grade').value;
      const section = APP.$('#reg-section').value;
      const sex = APP.getSexValue(APP.$('#reg-sex')?.value);

      if (!APP.validateName(lastName)) return showError(registerError, 'Please enter a valid last name.');
      if (!APP.validateName(firstName)) return showError(registerError, 'Please enter a valid first name.');
      if (!APP.validateLRN(lrn)) return showError(registerError, 'LRN must be exactly 12 digits.');
      if (!gradeLevel) return showError(registerError, 'Please select a grade level.');
      if (!section) return showError(registerError, 'Please select a section.');
      if (!sex) return showError(registerError, 'Please select your sex.');

      if (Store.getUser(lrn)) {
        return showError(registerError, 'A profile with this LRN already exists. Please log in instead.');
      }

      const user = {
        lrn,
        lastName,
        firstName,
        middleName,
        gradeLevel,
        section,
        sex,
        createdAt: new Date().toISOString()
      };

      Store.saveUser(user);
      Store.setSession(lrn);
      APP.toast(`Profile created! Welcome, ${firstName}.`, 'success');
      setTimeout(() => window.location.replace('dashboard.html'), 300);
    });
  }

  /* ============================================================
     Saved Users
     ============================================================ */
  function renderSavedUsers() {
    const list = APP.$('#saved-users-list');
    if (!list) return;
    let users = Store.getAllUsers();

    if (!users.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:32px 16px;">
          <div style="font-size:2.5rem;opacity:0.4;">👤</div>
          <p style="color:#90a4ae;font-size:0.9rem;margin:8px 0 0;">No saved users on this device yet.</p>
        </div>
      `;
      return;
    }

    users = APP.sortStudents(users, 'last', 'asc');

    list.innerHTML = '';
    users.forEach((u) => {
      const card = document.createElement('div');
      card.className = 'saved-user-card';
      const initials = `${(u.firstName || '?').charAt(0)}${(u.lastName || '?').charAt(0)}`.toUpperCase();
      card.innerHTML = `
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#0d47a1,#00acc1);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;flex-shrink:0;">
          ${initials}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${APP.formatFullName(u.lastName, u.firstName, u.middleName)}
          </div>
          <div style="font-size:0.75rem;color:#78909c;margin-top:2px;">
            LRN: ${APP.formatLRN(u.lrn)} · ${u.section}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary" data-login="${u.lrn}" style="font-size:0.8rem;padding:6px 12px;">Log In</button>
          <button class="btn btn-outline" data-delete="${u.lrn}" style="font-size:0.8rem;padding:6px 10px;color:#c62828;border-color:#c62828;">🗑️</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-login]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lrn = btn.dataset.login;
        Store.setSession(lrn);
        APP.toast('Logged in!', 'success');
        setTimeout(() => window.location.replace('dashboard.html'), 200);
      });
    });

    list.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lrn = btn.dataset.delete;
        if (!confirm('Delete this profile and all its progress on this device?')) return;
        Store.deleteUser(lrn);
        APP.toast('Profile deleted.', 'info');
        renderSavedUsers();
      });
    });
  }

  /* ---------- Helpers ---------- */
  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    APP.toast(msg, 'danger', 3000);
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const loginInput = APP.$('#login-lrn');
    if (loginInput) loginInput.focus();
    checkPendingLogout();
  });
})();

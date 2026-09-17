/* ============================================================
   profile.js — Student profile edit logic
   Version: 1.0.0
   App: General Science
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Auth guard ---------- */
  const user = Store.getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  /* ---------- Cache DOM ---------- */
  const form = document.getElementById('profile-form');
  const fLrn = document.getElementById('pf-lrn');
  const fLast = document.getElementById('pf-lastname');
  const fFirst = document.getElementById('pf-firstname');
  const fMiddle = document.getElementById('pf-middlename');
  const fSex = document.getElementById('pf-sex');
  const fGrade = document.getElementById('pf-grade');
  const fSection = document.getElementById('pf-section');
  const preview = document.getElementById('pf-preview');
  const errEl = document.getElementById('profile-error');
  const okEl = document.getElementById('profile-success');

  /* ---------- Render header ---------- */
  function renderHeader() {
    const initials = `${(user.firstName || '?').charAt(0)}${(user.lastName || '?').charAt(0)}`.toUpperCase();
    document.getElementById('profile-avatar').textContent = initials;
    document.getElementById('profile-name').textContent =
      APP.formatFullName(user.lastName, user.firstName, user.middleName);
    document.getElementById('profile-meta').innerHTML =
      `LRN: ${APP.formatLRN(user.lrn)} · Grade ${user.gradeLevel} — ${user.section}` +
      (user.sex ? ` · ${APP.getSexBadge(user.sex)}` : '');
  }

  /* ---------- Populate form ---------- */
  function populateForm() {
    fLrn.value = APP.formatLRN(user.lrn);
    fLast.value = user.lastName || '';
    fFirst.value = user.firstName || '';
    fMiddle.value = user.middleName || '';
    fSex.value = APP.getSexValue(user.sex) || '';
    fGrade.value = user.gradeLevel || '';
    fSection.value = user.section || '';
    updatePreview();
  }

  /* ---------- Live preview ---------- */
  function updatePreview() {
    const last = APP.toLastNameFormat(fLast.value.trim());
    const first = APP.toTitleCase(fFirst.value.trim());
    const middle = APP.toTitleCase(fMiddle.value.trim());
    const sex = APP.getSexValue(fSex.value);
    if (!last && !first) {
      preview.textContent = '—';
      return;
    }
    const sexIcon = sex === 'Female' ? '♀' : sex === 'Male' ? '♂' : '';
    preview.textContent = `${sexIcon ? sexIcon + ' ' : ''}${APP.formatFullName(last, first, middle)}`;
  }

  /* ---------- Auto-format on blur ---------- */
  fLast.addEventListener('blur', () => { fLast.value = APP.toLastNameFormat(fLast.value); updatePreview(); });
  fFirst.addEventListener('blur', () => { fFirst.value = APP.toTitleCase(fFirst.value); updatePreview(); });
  fMiddle.addEventListener('blur', () => { fMiddle.value = APP.toTitleCase(fMiddle.value); updatePreview(); });
  fSex.addEventListener('change', updatePreview);

  /* ---------- Live preview on input ---------- */
  [fLast, fFirst, fMiddle].forEach((el) => el.addEventListener('input', updatePreview));

  /* ---------- Alerts ---------- */
  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    okEl.classList.add('hidden');
    APP.toast(msg, 'danger', 3000);
  }

  function showSuccess(msg) {
    okEl.textContent = msg;
    okEl.classList.remove('hidden');
    errEl.classList.add('hidden');
    APP.toast(msg, 'success', 3000);
  }

  function clearAlerts() {
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
  }

  /* ---------- Validate ---------- */
  function validate() {
    const last = APP.toLastNameFormat(fLast.value.trim());
    const first = APP.toTitleCase(fFirst.value.trim());
    const middle = APP.toTitleCase(fMiddle.value.trim());
    const sex = APP.getSexValue(fSex.value);
    const grade = fGrade.value;
    const section = fSection.value;

    if (!APP.validateName(last)) return { error: 'Please enter a valid last name (at least 2 characters).' };
    if (!APP.validateName(first)) return { error: 'Please enter a valid first name (at least 2 characters).' };
    if (!sex) return { error: 'Please select your sex.' };
    if (!grade) return { error: 'Please select a grade level.' };
    if (!section) return { error: 'Please select a section.' };

    return { last, first, middle, sex, grade, section };
  }

  /* ---------- Submit ---------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearAlerts();

    const v = validate();
    if (v.error) return showError(v.error);

    const changed =
      user.lastName !== v.last ||
      user.firstName !== v.first ||
      (user.middleName || '') !== v.middle ||
      (user.sex || '') !== v.sex ||
      user.gradeLevel !== v.grade ||
      user.section !== v.section;

    if (!changed) return showError('No changes to save.');

    const updated = {
      ...user,
      lastName: v.last,
      firstName: v.first,
      middleName: v.middle,
      sex: v.sex,
      gradeLevel: v.grade,
      section: v.section,
      updatedAt: new Date().toISOString()
    };

    Store.saveUser(updated);
    Object.assign(user, updated);

    renderHeader();
    showSuccess('✅ Profile updated successfully!');
    APP.toast('Profile saved!', 'success', 2500);
  });

  /* ---------- Reset ---------- */
  document.getElementById('btn-reset').addEventListener('click', () => {
    clearAlerts();
    populateForm();
    APP.toast('Form reset to saved values.', 'info', 2000);
  });

  /* ---------- Log out with prompt ---------- */
  document.getElementById('btn-logout-clean').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(255,255,255,0.95);
      display:flex;align-items:center;justify-content:center;
      z-index:99999;font-family:'Segoe UI',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:2rem;">👋</div>
        <div style="font-weight:600;color:#0d47a1;margin-top:8px;">Logging out...</div>
      </div>
    `;
    document.body.appendChild(overlay);

    sessionStorage.setItem('gsa_logout_pending', JSON.stringify({
      lrn: user.lrn,
      at: Date.now()
    }));

    Store.clearSession();
    setTimeout(() => window.location.replace('login.html'), 150);
  });

  /* ---------- Init ---------- */
  renderHeader();
  populateForm();
})();

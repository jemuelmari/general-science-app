/* ============================================================
   backup.js — Student backup file (download / upload)
   Version: 1.0.0
   App: General Science
   ============================================================ */

const Backup = (() => {
  'use strict';

  /* ---------- Download Backup ---------- */
  function downloadBackup(lrn) {
    const data = Store.exportAll(lrn);
    if (!data) throw new Error('No data to export');

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const filename = `GSA_Backup_${data.user.lrn}_${stamp}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  /* ---------- Upload Backup ---------- */
  function uploadBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.user || !data.user.lrn) {
            throw new Error('Invalid backup file');
          }
          Store.importAll(data);
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Prompt: Keep or Delete on Logout ---------- */
  function promptOnLogout(user) {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(autoTimer);
        overlay.remove();
        resolve(value);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
        z-index:9999;padding:20px;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background:#fff;border-radius:12px;padding:24px;
        max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3);
        font-family:'Segoe UI',sans-serif;
      `;

      modal.innerHTML = `
        <h2 style="margin:0 0 8px;color:#0d47a1;">Before you go, ${user.firstName}!</h2>
        <p style="margin:0 0 16px;color:#5f6368;font-size:0.9rem;">
          Do you want to keep your progress on this device, or delete it?
        </p>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:16px;font-size:0.85rem;">
          <strong>${user.lastName}, ${user.firstName} ${user.middleName || ''}</strong><br>
          LRN: ${APP.formatLRN(user.lrn)}<br>
          Grade ${user.gradeLevel} — ${user.section}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="bk-keep" style="padding:12px;background:#0d47a1;color:#fff;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer;">
            💾 Keep my data (I'll download a backup file)
          </button>
          <button id="bk-delete" style="padding:12px;background:#c62828;color:#fff;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer;">
            🗑️ Delete my data from this device
          </button>
          <button id="bk-cancel" style="padding:10px;background:transparent;color:#5f6368;border:1px solid #dadce0;border-radius:6px;font-size:0.9rem;cursor:pointer;">
            Cancel
          </button>
        </div>
        <p style="margin:12px 0 0;font-size:0.75rem;color:#9aa0a6;text-align:center;">
          Auto-logging out in <span id="bk-countdown">10</span>s...
        </p>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      let secondsLeft = 10;
      const countdownEl = modal.querySelector('#bk-countdown');
      const countdownInterval = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = secondsLeft;
        if (secondsLeft <= 0) {
          clearInterval(countdownInterval);
          finish('timeout');
        }
      }, 1000);

      const autoTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        finish('timeout');
      }, 11000);

      modal.querySelector('#bk-keep').onclick = () => {
        clearInterval(countdownInterval);
        try {
          const fn = downloadBackup(user.lrn);
          APP.toast(`Backup saved: ${fn}`, 'success', 3000);
        } catch (e) {
          APP.toast('Backup failed: ' + e.message, 'danger');
        }
        finish('keep');
      };

      modal.querySelector('#bk-delete').onclick = () => {
        clearInterval(countdownInterval);
        if (confirm('Are you sure? This will delete ALL progress for this student on this device.')) {
          Store.deleteUser(user.lrn);
          finish('delete');
        }
      };

      modal.querySelector('#bk-cancel').onclick = () => {
        clearInterval(countdownInterval);
        finish('cancel');
      };
    });
  }

  /* ---------- Public API ---------- */
  return { downloadBackup, uploadBackup, promptOnLogout };
})();

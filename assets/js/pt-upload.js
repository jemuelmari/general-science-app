/* ============================================================
   pt-upload.js — Performance Task upload + grade display
   Version: 1.0.0
   Shared logic for all 9 ptN.html files.
   ============================================================ */

const PTUpload = (() => {
  'use strict';

  /* ============================================================
     UPLOAD FILE TO DRIVE
     ------------------------------------------------------------
     file: File object
     term: 'term1' | 'term2' | 'term3'
     ptId: 'pt1' | 'pt2' | 'pt3'
     meta: { id, file } from PT_META
     Returns: { ok, fileId, driveFileId, driveUrl, renamedFilename }
     ============================================================ */
  async function uploadFile(file, term, ptId) {
    if (!file) throw new Error('No file provided');
    if (file.size > 25 * 1024 * 1024) throw new Error('File too large (max 25 MB)');
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend not configured');
    }
    if (typeof Sync === 'undefined' || typeof Sync.backendPost !== 'function') {
      // Fallback: use fetch directly (same pattern as Sync.backendPost)
      return _directUpload(file, term, ptId);
    }

    // Use Sync.backendPost if available
    var base64 = await _fileToBase64(file);
    var user = Store.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    var response = await Sync.backendPost({
      action: 'uploadPT',
      lrn: user.lrn,
      term: term,
      ptId: ptId,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: base64,
      student: {
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        section: user.section || ''
      }
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || 'Upload failed');
    }
    return response;
  }

  async function _directUpload(file, term, ptId) {
    var base64 = await _fileToBase64(file);
    var user = Store.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    var res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'uploadPT',
        lrn: user.lrn,
        term: term,
        ptId: ptId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64: base64,
        student: {
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          section: user.section || ''
        }
      })
    });
    var result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Upload failed');
    return result;
  }

  function _fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        var result = reader.result;
        var comma = result.indexOf(',');
        resolve(comma >= 0 ? result.substring(comma + 1) : result);
      };
      reader.onerror = function() { reject(new Error('File read failed')); };
      reader.readAsDataURL(file);
    });
  }

  /* ============================================================
     PULL GRADES (called on PT page load)
     Returns: { ok, records: [ { gradeId, term, ptId, rubricScores,
              totalScore, teacherNotes, gradedAt, gradedBy } ] }
     ============================================================ */
  async function pullMyGrades(lrn) {
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) return { ok: false };
    if (!lrn) {
      var user = Store.getCurrentUser();
      lrn = user && user.lrn;
    }
    if (!lrn) return { ok: false };

    try {
      var body = { action: 'pullPTGrades', lrn: lrn };
      var res;
      if (typeof Sync !== 'undefined' && typeof Sync.backendPost === 'function') {
        res = await Sync.backendPost(body);
      } else {
        var raw = await fetch(CONFIG.BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
        res = await raw.json();
      }
      if (!res || !res.ok) return { ok: false, error: res && res.error };
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     REQUEST RE-UPLOAD (post-grade)
     ============================================================ */
  async function requestReupload(term, ptId, currentGrade, reason) {
    var user = Store.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    var body = {
      action: 'requestPTReupload',
      lrn: user.lrn,
      term: term,
      ptId: ptId,
      reason: reason || 'wants-to-improve',
      currentGrade: Number(currentGrade || 0),
      student: {
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        section: user.section || ''
      }
    };

    var res;
    if (typeof Sync !== 'undefined' && typeof Sync.backendPost === 'function') {
      res = await Sync.backendPost(body);
    } else {
      var raw = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      res = await raw.json();
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Request failed');
    return res;
  }

  /* ============================================================
     REDEEM RE-UPLOAD CODE
     ============================================================ */
  async function redeemReuploadCode(code) {
    var user = Store.getCurrentUser();
    if (!user) throw new Error('Not logged in');

    var body = { action: 'redeemPTReuploadCode', lrn: user.lrn, code: code };

    var res;
    if (typeof Sync !== 'undefined' && typeof Sync.backendPost === 'function') {
      res = await Sync.backendPost(body);
    } else {
      var raw = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      res = await raw.json();
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Redeem failed');
    return res;
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function findGradeFor(records, term, ptId) {
    if (!Array.isArray(records)) return null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].term === term && records[i].ptId === ptId) return records[i];
    }
    return null;
  }

  return {
    uploadFile: uploadFile,
    pullMyGrades: pullMyGrades,
    requestReupload: requestReupload,
    redeemReuploadCode: redeemReuploadCode,
    formatFileSize: formatFileSize,
    findGradeFor: findGradeFor
  };
})();

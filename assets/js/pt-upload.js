/* ============================================================
   pt-upload.js — Performance Task upload + grade display
   Version: 1.1.0
   Changelog v1.1.0: Added reflection + option to upload payload
   ============================================================ */

const PTUpload = (() => {
  'use strict';

  async function uploadFile(file, term, ptId, reflection, option) {
    if (!file) throw new Error('No file provided');
    if (file.size > 25 * 1024 * 1024) throw new Error('File too large (max 25 MB)');
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      throw new Error('Backend not configured');
    }
    if (typeof Sync === 'undefined' || typeof Sync.backendPost !== 'function') {
      return _directUpload(file, term, ptId, reflection, option);
    }

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
      reflection: reflection || '',
      option: option || null,
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

  async function _directUpload(file, term, ptId, reflection, option) {
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
        reflection: reflection || '',
        option: option || null,
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

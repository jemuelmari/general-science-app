/* ============================================================
   pt-grade.js — Teacher-side PT grading module
   Version: 1.0.0
   Used by: teacher/pt-submissions.html, teacher/pt-grade.html
   ============================================================ */

const PTGrade = (() => {
  'use strict';

  /* ============================================================
     LIST SUBMISSIONS (teacher)
     filters: { term, ptId, section, includeLegacy }
     ============================================================ */
  async function listSubmissions(filters) {
    if (typeof CONFIG === 'undefined' || !CONFIG.BACKEND_URL) {
      return { ok: false, error: 'Backend not configured' };
    }
    filters = filters || {};
    var body = {
      action: 'listPTFiles',
      term: filters.term || '',
      ptId: filters.ptId || '',
      section: filters.section || '',
      includeLegacy: !!filters.includeLegacy
    };
    try {
      var res = await _post(body);
      if (!res.ok) return { ok: false, error: res.error };
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     SAVE GRADE (teacher)
     data: { lrn, term, ptId, rubricScores, totalScore,
             teacherNotes, gradedBy, student }
     ============================================================ */
  async function saveGrade(data) {
    if (!data || !data.lrn || !data.term || !data.ptId) {
      return { ok: false, error: 'Missing lrn/term/ptId' };
    }
    if (!Array.isArray(data.rubricScores) || !data.rubricScores.length) {
      return { ok: false, error: 'rubricScores required' };
    }
    try {
      return await _post({
        action: 'savePTGrade',
        lrn: data.lrn,
        term: data.term,
        ptId: data.ptId,
        rubricScores: data.rubricScores,
        totalScore: Number(data.totalScore || 0),
        teacherNotes: data.teacherNotes || '',
        gradedBy: data.gradedBy || 'JEMUEL C. MARI',
        student: data.student || {}
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     PULL GRADES (teacher)
     ============================================================ */
  async function pullGrades(filters) {
    filters = filters || {};
    try {
      return await _post({
        action: 'pullPTGrades',
        lrn: filters.lrn || '',
        term: filters.term || '',
        ptId: filters.ptId || ''
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     RE-UPLOAD REQUESTS (teacher)
     ============================================================ */
  async function getReuploadRequests(filters) {
    filters = filters || {};
    try {
      return await _post({
        action: 'getPTReuploadRequests',
        token: _token(),
        filterTerm: filters.term || '',
        filterSection: filters.section || ''
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function approveReupload(requestId) {
    try {
      return await _post({
        action: 'approvePTReupload',
        token: _token(),
        requestId: requestId
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     GRADE STATUS (dashboard widget)
     ============================================================ */
  async function getGradeStatus(filters) {
    filters = filters || {};
    try {
      return await _post({
        action: 'getPTGradeStatus',
        term: filters.term || '',
        ptId: filters.ptId || '',
        section: filters.section || ''
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ============================================================
     RENDER HELPERS
     ============================================================ */

  /**
   * Build a rubric input UI.
   * rubric: [{ criterion, points }]
   * existingScores: [{ criterion, score, max }] (optional)
   * Returns HTML string.
   */
  function renderRubricInputs(rubric, existingScores) {
    if (!Array.isArray(rubric)) return '';
    var map = {};
    if (Array.isArray(existingScores)) {
      existingScores.forEach(function(s) { map[s.criterion] = s.score; });
    }

    var html = '<table class="rubric-table" style="width:100%;border-collapse:collapse;font-size:0.9rem;">';
    html += '<thead><tr style="background:#f5f7fa;"><th style="padding:10px;text-align:left;border-bottom:2px solid #cfd8dc;">Criterion</th><th style="padding:10px;text-align:center;border-bottom:2px solid #cfd8dc;width:80px;">Max</th><th style="padding:10px;text-align:center;border-bottom:2px solid #cfd8dc;width:120px;">Score</th></tr></thead><tbody>';

    rubric.forEach(function(r, i) {
      var max = Number(r.points) || 0;
      var score = map[r.criterion] != null ? map[r.criterion] : '';
      html += '<tr>';
      html += '<td style="padding:10px;border-bottom:1px solid #e0e0e0;">' + _esc(r.criterion) + '</td>';
      html += '<td style="padding:10px;text-align:center;border-bottom:1px solid #e0e0e0;color:#5f6368;font-weight:600;">' + max + '</td>';
      html += '<td style="padding:6px;text-align:center;border-bottom:1px solid #e0e0e0;">';
      html += '<input type="number" class="rubric-input" data-criterion="' + _esc(r.criterion) + '" data-max="' + max + '" min="0" max="' + max + '" value="' + score + '" style="width:70px;padding:6px 8px;border:1.5px solid #cfd8dc;border-radius:6px;text-align:center;font-family:inherit;font-size:0.9rem;" />';
      html += '</td></tr>';
    });

    html += '</tbody></table>';
    html += '<div style="margin-top:12px;padding:12px 14px;background:#f5f7fa;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:1rem;">';
    html += '<strong style="color:#0d47a1;">Total Score</strong>';
    html += '<strong id="rubric-total" style="font-size:1.3rem;color:#0d47a1;">0 / 100</strong>';
    html += '</div>';
    return html;
  }

  /**
   * Compute total from rubric inputs on the page.
   */
  function computeTotal() {
    var inputs = document.querySelectorAll('.rubric-input');
    var total = 0, max = 0;
    inputs.forEach(function(inp) {
      var v = Number(inp.value || 0);
      var m = Number(inp.getAttribute('data-max') || 0);
      if (isNaN(v)) v = 0;
      if (v < 0) v = 0;
      if (v > m) { v = m; inp.value = m; }
      total += v;
      max += m;
    });
    return { total: total, max: max };
  }

  function wireRubricTotal() {
    var inputs = document.querySelectorAll('.rubric-input');
    var totalEl = document.getElementById('rubric-total');
    if (!totalEl) return;
    function update() {
      var r = computeTotal();
      totalEl.textContent = r.total + ' / ' + r.max;
    }
    inputs.forEach(function(inp) { inp.addEventListener('input', update); });
    update();
  }

  function collectRubricScores() {
    var inputs = document.querySelectorAll('.rubric-input');
    var scores = [];
    inputs.forEach(function(inp) {
      scores.push({
        criterion: inp.getAttribute('data-criterion'),
        score: Number(inp.value || 0),
        max: Number(inp.getAttribute('data-max') || 0)
      });
    });
    return scores;
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  async function _post(body) {
    var res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  function _token() {
    if (typeof Sync !== 'undefined' && typeof Sync.getTeacherToken === 'function') {
      return Sync.getTeacherToken();
    }
    try {
      var t = sessionStorage.getItem('gsa_teacher_token');
      if (t) return t;
      var session = sessionStorage.getItem('gsa_teacher_session');
      if (session) {
        var s = JSON.parse(session);
        if (s && s.token) return s.token;
      }
    } catch (e) {}
    return null;
  }

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    listSubmissions: listSubmissions,
    saveGrade: saveGrade,
    pullGrades: pullGrades,
    getReuploadRequests: getReuploadRequests,
    approveReupload: approveReupload,
    getGradeStatus: getGradeStatus,
    renderRubricInputs: renderRubricInputs,
    wireRubricTotal: wireRubricTotal,
    computeTotal: computeTotal,
    collectRubricScores: collectRubricScores
  };
})();

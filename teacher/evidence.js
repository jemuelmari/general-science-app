/* ============================================================
   evidence.js — Phase 4.5
   Individual Exam Evidence Generator (.docx)
   Depends: docx@8.5.0 (UMD), config.js, randomize.js, store.js
   ============================================================ */
(function () {
  'use strict';

  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
          WidthType, AlignmentType, BorderStyle, HeadingLevel } = window.docx;

  const SCORES_PREFIX = 'gsa_v1_scores_';

  /* ------------------------------------------------------------
     STATE
     ------------------------------------------------------------ */
  let _students = [];
  let _studentMap = {};      // LRN -> student object
  let _lastPayload = null;   // for preview

  /* ------------------------------------------------------------
     HELPERS
     ------------------------------------------------------------ */
  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fmtTime(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function lastFirstMiddle(stu) {
    // Expected shape: { lastName, firstName, middleName } OR { name: "LAST, First Middle" }
    if (stu.lastName) {
      const mid = stu.middleName ? ' ' + stu.middleName : '';
      return stu.lastName + ', ' + (stu.firstName || '') + mid;
    }
    return stu.name || stu.fullName || '(Unnamed)';
  }

  function getLrn(stu) {
    return stu.lrn || stu.LRN || stu.id || '';
  }

  function getSection(stu) {
    return stu.section || stu.Section || '';
  }

  function loadStudents() {
    // Try multiple known sources — adapt to whatever store.js exposes.
    let roster = [];
    try {
      if (window.Store && typeof Store.getStudents === 'function') {
        roster = Store.getStudents() || [];
      }
    } catch (e) { /* ignore */ }

    if (!roster.length) {
      try {
        const raw = localStorage.getItem('gsa_v1_students');
        if (raw) roster = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }

    if (!roster.length) {
      try {
        const raw = localStorage.getItem('gsa_v1_roster');
        if (raw) roster = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }

    if (!Array.isArray(roster)) roster = [];
    return roster;
  }

  function loadScores(lrn) {
    try {
      const raw = localStorage.getItem(SCORES_PREFIX + lrn);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[Evidence] Bad scores JSON for', lrn, e);
      return null;
    }
  }

  /* ------------------------------------------------------------
     ASSESSMENT RESOLUTION
     ------------------------------------------------------------ */
  function resolveAssessment(scores, term, type, index) {
    /**
     * Returns { record, label, filename, bankFolder } or null.
     * Scores shape:
     *   scores.term1.st.st1  = { itemResults:[], score, total, percent, ... }
     *   scores.term1.quizzes.quiz1 = {...}
     *   scores.term1.te = {...}
     */
    if (!scores) return null;
    const t = scores['term' + term];
    if (!t) return null;

    if (type === 'te') {
      if (!t.te) return null;
      return {
        record: t.te,
        label: 'Term Exam — Term ' + term,
        filename: 'term' + term + '-term-exam',
        bankFolder: 'term' + term
      };
    }

    if (type === 'quiz') {
      const q = t.quizzes && t.quizzes['quiz' + index];
      if (!q) return null;
      return {
        record: q,
        label: 'Quiz ' + index + ' — Term ' + term,
        filename: 'term' + term + '-quiz' + index,
        bankFolder: 'term' + term
      };
    }

    if (type === 'st') {
      const st = t.st && t.st['st' + index];
      if (!st) return null;
      return {
        record: st,
        label: 'Summative Test ' + index + ' — Term ' + term,
        filename: 'term' + term + '-st' + index,
        bankFolder: 'term' + term
      };
    }

    return null;
  }

  async function loadQuestionBank(bankFolder, filename) {
    const base = (window.Randomize && Randomize.getRepoBase) ? Randomize.getRepoBase() : '../';
    const candidates = [
      base + 'student/' + bankFolder + '/assessments/' + filename + '.json',
      '../student/' + bankFolder + '/assessments/' + filename + '.json',
      'student/' + bankFolder + '/assessments/' + filename + '.json',
      '/general-science-app/student/' + bankFolder + '/assessments/' + filename + '.json'
    ];

    const seen = new Set();
    for (const path of candidates) {
      if (seen.has(path)) continue;
      seen.add(path);
      try {
        const res = await fetch(path + '?v=1.5.0');
        if (!res.ok) continue;
        const text = await res.text();
        return JSON.parse(text);
      } catch (e) { /* try next */ }
    }
    return null;
  }

  /* ------------------------------------------------------------
     BUILD DOCX
     ------------------------------------------------------------ */
  function border() {
    return { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  }

  function cell(text, opts) {
    opts = opts || {};
    return new TableCell({
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      borders: opts.borders,
      shading: opts.shading,
      children: [new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        children: [new TextRun({
          text: text == null ? '' : String(text),
          bold: !!opts.bold,
          size: opts.size || 22,
          font: 'Calibri'
        })]
      })]
    });
  }

  function p(text, opts) {
    opts = opts || {};
    return new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: opts.spacing || { after: 60 },
      children: [new TextRun({
        text: text == null ? '' : String(text),
        bold: !!opts.bold,
        italics: !!opts.italics,
        size: opts.size || 22,
        font: opts.font || 'Calibri',
        color: opts.color
      })]
    });
  }

  function buildHeader() {
    const s = window.SCHOOL_INFO || {};
    const lines = [
      ['REPUBLIC OF THE PHILIPPINES', { bold: true, align: AlignmentType.CENTER, size: 22 }],
      ['DEPARTMENT OF EDUCATION', { bold: true, align: AlignmentType.CENTER, size: 22 }],
      [(s.region || '') + ' — ' + (s.division || ''), { align: AlignmentType.CENTER, size: 20 }],
      [s.schoolName || '', { bold: true, align: AlignmentType.CENTER, size: 26 }],
      [s.schoolAddress || '', { align: AlignmentType.CENTER, size: 20 }],
      [s.schoolYear || '', { align: AlignmentType.CENTER, size: 20 }],
      ['', {}],
      ['EXAMINATION EVIDENCE RECORD', { bold: true, align: AlignmentType.CENTER, size: 28 }],
      ['', {}]
    ];
    return lines.map(function (l) { return p(l[0], l[1]); });
  }

  function buildStudentInfoTable(stu, assessment) {
    const s = window.SCHOOL_INFO || {};
    const rows = [
      ['Student Name', lastFirstMiddle(stu)],
      ['LRN', getLrn(stu)],
      ['Grade & Section', (s.gradeLevel || 'Grade 11') + ' - ' + getSection(stu)],
      ['Subject', s.subject || 'General Science'],
      ['Assessment', assessment.label],
      ['Date Taken', fmtDate(assessment.record.date || assessment.record.takenAt)],
      ['Time Started', fmtTime(assessment.record.startedAt)],
      ['Time Finished', fmtTime(assessment.record.finishedAt)],
      ['Time Used', fmtDuration(assessment.record.durationMs)]
    ];

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: border(), bottom: border(), left: border(), right: border(),
        insideHorizontal: border(), insideVertical: border()
      },
      rows: rows.map(function (r) {
        return new TableRow({
          children: [
            cell(r[0], { bold: true, width: 30, shading: 'F5F5F5' }),
            cell(r[1], { width: 70 })
          ]
        });
      })
    });
  }

  function buildItemAnalysis(bank, record) {
    const out = [];
    const items = record.itemResults || [];
    const questions = (bank && bank.questions) || [];

    out.push(new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: 'ITEM ANALYSIS', bold: true, size: 24 })]
    }));

    items.forEach(function (r, i) {
      const q = questions[r.originalIndex] || questions[r.index] || {};
      const qText = q.text || '(Question text unavailable)';
      const opts = q.options || [];
      const givenText = r.given != null ? String(r.given) : '(no answer)';
      const expectedText = r.expected != null ? String(r.expected) : '(unknown)';
      const mark = r.correct ? '✅' : '❌';

      out.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [new TextRun({
          text: 'Q' + (i + 1) + '. ' + qText,
          bold: true, size: 22
        })]
      }));

      opts.forEach(function (opt, idx) {
        const isCorrect = (opt === expectedText);
        out.push(new Paragraph({
          spacing: { after: 20 },
          indent: { left: 400 },
          children: [new TextRun({
            text: '   ' + (idx + 1) + '. ' + opt + (isCorrect ? '  ✓' : ''),
            size: 20
          })]
        }));
      });

      out.push(new Paragraph({
        spacing: { before: 40, after: 0 },
        indent: { left: 400 },
        children: [new TextRun({
          text: "Student's Answer: " + givenText + '  ' + mark,
          size: 20, color: r.correct ? '1B5E20' : 'B71C1C'
        })]
      }));

      out.push(new Paragraph({
        spacing: { after: 100 },
        indent: { left: 400 },
        children: [new TextRun({
          text: 'Correct Answer:   ' + expectedText,
          size: 20, color: '1B5E20'
        })]
      }));
    });

    return out;
  }

  function buildSummary(record) {
    const correct = record.correct != null ? record.correct : 0;
    const total = record.total != null ? record.total : (record.itemResults || []).length;
    const wrong = Math.max(0, total - correct);
    const percent = record.percent != null ? record.percent : (total ? Math.round(correct / total * 100) : 0);
    const passed = percent >= 75;

    return [
      new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'SUMMARY', bold: true, size: 24 })]
      }),
      new Paragraph({
        children: [new TextRun({
          text: 'Correct: ' + correct + '   |   Wrong: ' + wrong +
                '   |   Score: ' + percent + '%   |   Remarks: ' + (passed ? 'PASSED' : 'FAILED'),
          bold: true, size: 22,
          color: passed ? '1B5E20' : 'B71C1C'
        })]
      })
    ];
  }

  function buildSignatures() {
    const s = window.SCHOOL_INFO || {};
    return [
      new Paragraph({ spacing: { before: 400 }, children: [] }),
      new Paragraph({ children: [new TextRun({ text: 'Teacher:', bold: true, size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: '_________________________', size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: s.teacherName || '', bold: true, size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: s.teacherPosition || '', size: 20 })] }),
      new Paragraph({ spacing: { before: 320 }, children: [] }),
      new Paragraph({ children: [new TextRun({ text: 'Parent/Guardian:', bold: true, size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: '_________________________', size: 22 })] }),
      new Paragraph({ children: [new TextRun({ text: 'Signature over printed name', size: 20, italics: true })] }),
      new Paragraph({ spacing: { before: 320 }, children: [] }),
      new Paragraph({ children: [new TextRun({ text: 'Date: _____________', size: 22 })] })
    ];
  }

  async function buildDocx(stu, assessment, bank) {
    const children = []
      .concat(buildHeader())
      .concat([buildStudentInfoTable(stu, assessment)])
      .concat(buildItemAnalysis(bank, assessment.record))
      .concat(buildSummary(assessment.record))
      .concat(buildSignatures());

    const doc = new Document({
      creator: (window.SCHOOL_INFO && SCHOOL_INFO.teacherName) || 'Teacher',
      title: 'Exam Evidence — ' + lastFirstMiddle(stu),
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // Letter
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
          }
        },
        children: children
      }]
    });

    return Packer.toBlob(doc);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function safeFilename(s) {
    return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  }

  /* ------------------------------------------------------------
     PREVIEW RENDER (screen only — not part of docx)
     ------------------------------------------------------------ */
  function renderPreview(stu, assessment, bank) {
    const wrap = document.getElementById('ev-preview-wrap');
    const el = document.getElementById('ev-preview');
    const r = assessment.record;
    const total = r.total != null ? r.total : (r.itemResults || []).length;
    const correct = r.correct != null ? r.correct : 0;
    const percent = r.percent != null ? r.percent : (total ? Math.round(correct / total * 100) : 0);

    const lines = [
      'REPUBLIC OF THE PHILIPPINES',
      'DEPARTMENT OF EDUCATION',
      (SCHOOL_INFO.region || '') + ' — ' + (SCHOOL_INFO.division || ''),
      (SCHOOL_INFO.schoolName || ''),
      (SCHOOL_INFO.schoolAddress || ''),
      (SCHOOL_INFO.schoolYear || ''),
      '',
      'EXAMINATION EVIDENCE RECORD',
      '',
      'Student: ' + lastFirstMiddle(stu),
      'LRN: ' + getLrn(stu) + '   Section: ' + getSection(stu),
      'Assessment: ' + assessment.label,
      'Items: ' + (r.itemResults || []).length,
      'Correct: ' + correct + '   Wrong: ' + (total - correct) +
        '   Score: ' + percent + '%   ' + (percent >= 75 ? 'PASSED' : 'FAILED'),
      '',
      '→ Downloading full .docx with per-item analysis…'
    ];

    el.textContent = lines.join('\n');
    wrap.style.display = 'block';
  }

  /* ------------------------------------------------------------
     MAIN ENTRY
     ------------------------------------------------------------ */
  async function generateOne(stu, term, type, index) {
    const lrn = getLrn(stu);
    const scores = loadScores(lrn);
    if (!scores) {
      alert('No scores found for ' + lastFirstMiddle(stu) + ' (LRN ' + lrn + ').');
      return false;
    }

    const assessment = resolveAssessment(scores, term, type, index);
    if (!assessment) {
      alert('Assessment not found for this student.');
      return false;
    }

    const bank = await loadQuestionBank(assessment.bankFolder, assessment.filename);
    if (!bank) {
      alert('Could not load question bank: ' + assessment.filename + '.json\n' +
            'Make sure /student/' + assessment.bankFolder + '/assessments/' + assessment.filename + '.json exists.');
      return false;
    }

    renderPreview(stu, assessment, bank);

    const blob = await buildDocx(stu, assessment, bank);
    const fname = 'Evidence_' +
      safeFilename(getLrn(stu) || lastFirstMiddle(stu)) + '_' +
      safeFilename(assessment.filename) + '.docx';
    downloadBlob(blob, fname);
    return true;
  }

  /* ------------------------------------------------------------
     UI WIRING
     ------------------------------------------------------------ */
  function populateStudents() {
    _students = loadStudents();
    _studentMap = {};
    const sel = document.getElementById('ev-student');
    sel.innerHTML = '<option value="">— Select student —</option>';

    _students.forEach(function (stu) {
      const lrn = getLrn(stu);
      if (!lrn) return;
      _studentMap[lrn] = stu;
      const opt = document.createElement('option');
      opt.value = lrn;
      opt.textContent = lastFirstMiddle(stu) + '  ·  ' + getSection(stu) + '  ·  ' + lrn;
      sel.appendChild(opt);
    });
  }

  function refreshIndexOptions() {
    const type = document.getElementById('ev-type').value;
    const wrap = document.getElementById('ev-index-wrap');
    const sel = document.getElementById('ev-index');

    if (type === 'st' || type === 'quiz') {
      wrap.style.display = 'block';
      const max = type === 'st' ? 6 : 3;
      sel.innerHTML = '<option value="">— Select # —</option>';
      for (let i = 1; i <= max; i++) {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = (type === 'st' ? 'ST' : 'Quiz') + ' ' + i;
        sel.appendChild(o);
      }
    } else {
      wrap.style.display = 'none';
      sel.innerHTML = '';
    }
  }

  function setStatus(msg, isErr) {
    const el = document.getElementById('ev-status');
    el.textContent = msg;
    el.style.color = isErr ? '#c62828' : '#2e7d32';
  }

  async function handleGenerateOne() {
    const lrn = document.getElementById('ev-student').value;
    const term = document.getElementById('ev-term').value;
    const type = document.getElementById('ev-type').value;
    const index = document.getElementById('ev-index').value;

    if (!lrn) return setStatus('Please select a student.', true);
    if (!type) return setStatus('Please select an assessment type.', true);
    if ((type === 'st' || type === 'quiz') && !index)
      return setStatus('Please select an assessment #.', true);

    const stu = _studentMap[lrn];
    setStatus('Generating…', false);
    try {
      const ok = await generateOne(stu, term, type, index);
      setStatus(ok ? '✅ Evidence generated.' : '⚠️ Not generated.', !ok);
    } catch (e) {
      console.error(e);
      setStatus('❌ Error: ' + e.message, true);
    }
  }

  async function handleGenerateAll() {
    const lrn = document.getElementById('ev-student').value;
    const term = document.getElementById('ev-term').value;
    const type = document.getElementById('ev-type').value;
    const index = document.getElementById('ev-index').value;

    if (!type) return setStatus('Please select an assessment type first.', true);
    if ((type === 'st' || type === 'quiz') && !index)
      return setStatus('Please select an assessment #.', true);

    // Determine target section: from selected student, or all students
    let targets = _students;
    if (lrn && _studentMap[lrn]) {
      const sec = getSection(_studentMap[lrn]);
      targets = _students.filter(function (s) { return getSection(s) === sec; });
    }

    if (!targets.length) return setStatus('No students to process.', true);

    const confirmed = confirm(
      'Generate evidence for ' + targets.length + ' student(s)?\n' +
      'Your browser may ask to allow multiple downloads.'
    );
    if (!confirmed) return;

    setStatus('Generating ' + targets.length + ' files…', false);
    let ok = 0, fail = 0;

    for (let i = 0; i < targets.length; i++) {
      try {
        const success = await generateOne(targets[i], term, type, index);
        if (success) ok++; else fail++;
      } catch (e) {
        console.warn('[Evidence] Failed for', targets[i], e);
        fail++;
      }
      // Small delay so browser allows multiple downloads
      await new Promise(function (r) { setTimeout(r, 350); });
    }

    setStatus('✅ Done — ' + ok + ' generated, ' + fail + ' skipped.', fail > 0);
  }

  /* ------------------------------------------------------------
     BOOT
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.docx) {
      alert('docx.js failed to load. Check your internet connection.');
      return;
    }
    if (!window.SCHOOL_INFO) {
      console.warn('[Evidence] SCHOOL_INFO missing from config.js');
    }

    populateStudents();
    refreshIndexOptions();

    document.getElementById('ev-type').addEventListener('change', refreshIndexOptions);
    document.getElementById('ev-generate').addEventListener('click', handleGenerateOne);
    document.getElementById('ev-generate-all').addEventListener('click', handleGenerateAll);

    // Logout
    const btn = document.getElementById('btn-logout');
    if (btn) {
      btn.addEventListener('click', function () {
        try {
          if (window.TeacherAuth && TeacherAuth.logout) TeacherAuth.logout();
          else { sessionStorage.clear(); location.href = '../instructor.html'; }
        } catch (e) { location.href = '../instructor.html'; }
      });
    }
  });

})();

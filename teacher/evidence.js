/* ============================================================
   evidence.js — Phase 4.5
   Individual Exam Evidence Generator (.docx)
   Version: 1.2.0 (Cloud-First Fixed)
   ============================================================ */
window.Evidence = (function () {
  'use strict';

  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
          WidthType, AlignmentType, BorderStyle } = window.docx;

  function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function fmtDuration(ms) { if (!ms || ms < 0) return '—'; const total = Math.floor(ms / 1000); return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'); }
  function lastFirstMiddle(stu) { if (!stu) return '(Unknown)'; if (stu.lastName) return stu.lastName + ', ' + (stu.firstName || '') + (stu.middleName ? ' ' + stu.middleName : ''); return stu.name || '(Unnamed)'; }
  function getLrn(stu) { return stu.lrn || stu.LRN || stu.id || ''; }
  function getSection(stu) { return stu.section || stu.Section || ''; }

  function border() { return { style: BorderStyle.SINGLE, size: 4, color: '000000' }; }
  function cell(text, opts) { opts = opts || {}; return new TableCell({ width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined, borders: opts.borders, shading: opts.shading ? { fill: opts.shading } : undefined, children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: [new TextRun({ text: text == null ? '' : String(text), bold: !!opts.bold, size: opts.size || 22, font: 'Calibri' })] })] }); }
  function p(text, opts) { opts = opts || {}; return new Paragraph({ alignment: opts.align || AlignmentType.LEFT, spacing: opts.spacing || { after: 60 }, children: [new TextRun({ text: text == null ? '' : String(text), bold: !!opts.bold, italics: !!opts.italics, size: opts.size || 22, font: opts.font || 'Calibri', color: opts.color })] }); }

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
    return lines.map(l => p(l[0], l[1]));
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
      borders: { top: border(), bottom: border(), left: border(), right: border(), insideHorizontal: border(), insideVertical: border() },
      rows: rows.map(r => new TableRow({ children: [cell(r[0], { bold: true, width: 30, shading: 'F5F5F5' }), cell(r[1], { width: 70 })] }))
    });
  }

  function buildItemAnalysis(bank, record) {
    const out = [];
    const items = record.itemResults || [];
    const questions = (bank && bank.questions) || [];
    const byId = {};
    questions.forEach(q => { if (q && q.id != null) byId[String(q.id)] = q; });

    out.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: 'ITEM ANALYSIS', bold: true, size: 24 })] }));

    items.forEach((r, i) => {
      let q = (r.questionId != null) ? byId[String(r.questionId)] : null;
      if (!q && r.originalIndex != null) q = questions[r.originalIndex] || null;
      if (!q && r.index != null) q = questions[r.index] || null;
      if (!q) q = {};

      const opts = q.options || [];
      const givenText = r.given != null ? String(r.given) : '(no answer)';
      const expectedText = r.expected != null ? String(r.expected) : '(unknown)';
      const mark = r.correct ? '✅' : '❌';

      out.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: 'Q' + (i + 1) + '. ' + (q.text || '(Question unavailable)'), bold: true, size: 22 })] }));
      opts.forEach((opt, idx) => { out.push(new Paragraph({ spacing: { after: 20 }, indent: { left: 400 }, children: [new TextRun({ text: '   ' + (idx + 1) + '. ' + opt + (opt === expectedText ? '  ✓' : ''), size: 20 })] })); });
      out.push(new Paragraph({ spacing: { before: 40, after: 0 }, indent: { left: 400 }, children: [new TextRun({ text: "Student's Answer: " + givenText + '  ' + mark, size: 20, color: r.correct ? '1B5E20' : 'B71C1C' })] }));
      out.push(new Paragraph({ spacing: { after: 100 }, indent: { left: 400 }, children: [new TextRun({ text: 'Correct Answer:   ' + expectedText, size: 20, color: '1B5E20' })] }));
    });
    return out;
  }

  function buildSummary(record) {
    const correct = record.correct != null ? record.correct : (record.score || 0);
    const total = record.total != null ? record.total : (record.itemResults || []).length;
    const wrong = Math.max(0, total - correct);
    const percent = record.percent != null ? record.percent : (total ? Math.round((correct / total) * 100) : 0);
    const passed = percent >= 75;
    return [
      new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: 'SUMMARY', bold: true, size: 24 })] }),
      new Paragraph({ children: [new TextRun({ text: 'Correct: ' + correct + '   |   Wrong: ' + wrong + '   |   Score: ' + percent + '%   |   Remarks: ' + (passed ? 'PASSED' : 'FAILED'), bold: true, size: 22, color: passed ? '1B5E20' : 'B71C1C' })] })
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
    const children = [].concat(buildHeader()).concat([buildStudentInfoTable(stu, assessment)]).concat(buildItemAnalysis(bank, assessment.record)).concat(buildSummary(assessment.record)).concat(buildSignatures());
    const doc = new Document({ creator: (window.SCHOOL_INFO && SCHOOL_INFO.teacherName) || 'Teacher', title: 'Exam Evidence — ' + lastFirstMiddle(stu), sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children: children }] });
    return Packer.toBlob(doc);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function loadQuestionBank(bankFolder, filename) {
    const candidates = [
      `../student/${bankFolder}/assessments/${filename}.json`,
      `student/${bankFolder}/assessments/${filename}.json`
    ];
    for (const path of candidates) {
      try {
        const res = await fetch(path + '?v=1.2.0');
        if (res.ok) return await res.json();
      } catch (e) { }
    }
    return null;
  }

  async function generateOne(stu, term, type, index) {
    // Kunin ang progress JSON mula sa Cloud data ng student
    const progress = stu.progress || {};
    const termScores = progress.scores && progress.scores['term' + term];
    
    if (!termScores) {
      alert('Walang exam record si ' + lastFirstMiddle(stu) + ' para sa Term ' + term + '.');
      return false;
    }

    let record = null;
    let filename = '';
    let label = '';

    if (type === 'te') {
      record = termScores.te;
      filename = 'te';
      label = 'Term Exam — Term ' + term;
    } else if (type === 'quiz') {
      record = termScores.quizzes && termScores.quizzes['quiz' + index];
      filename = 'quiz' + index;
      label = 'Quiz ' + index + ' — Term ' + term;
    } else if (type === 'st') {
      record = termScores.st && termScores.st['st' + index];
      filename = 'st' + index;
      label = 'Summative Test ' + index + ' — Term ' + term;
    }

    if (!record || !record.itemResults) {
      alert('Walang sagot na naitala para sa ' + label + '.');
      return false;
    }

    const bank = await loadQuestionBank('term' + term, filename);
    if (!bank) {
      alert('Hindi ma-load ang questions JSON para sa ' + label);
      return false;
    }

    const assessment = { record: record, label: label, filename: filename };
    
    // I-update ang Preview sa screen
    const wrap = document.getElementById('ev-preview-wrap');
    const el = document.getElementById('ev-preview');
    if (wrap && el) {
      wrap.style.display = 'block';
      el.textContent = `STUDENT: ${lastFirstMiddle(stu)}\nASSESSMENT: ${label}\nSCORE: ${record.percent || 0}%\n\nIni-generate ang .docx file...`;
    }

    const blob = await buildDocx(stu, assessment, bank);
    const fname = 'Evidence_' + (getLrn(stu) || 'Student') + '_' + filename + '.docx';
    downloadBlob(blob, fname);
    return true;
  }

  return { generateOne };
})();

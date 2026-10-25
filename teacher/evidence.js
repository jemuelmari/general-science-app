/* ============================================================
   evidence.js — Phase 4.5
   Individual Exam Evidence Generator (.docx)
   Version: 1.3.0 (Bulletproof)
   ============================================================ */
window.Evidence = (function () {
  'use strict';

  function fmtDate(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function fmtTime(d) { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? '—' : dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  function fmtDuration(ms) { if (!ms || ms < 0) return '—'; const total = Math.floor(ms / 1000); return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'); }
  function lastFirstMiddle(stu) { if (!stu) return '(Unknown)'; if (stu.lastName) return stu.lastName + ', ' + (stu.firstName || '') + (stu.middleName ? ' ' + stu.middleName : ''); return stu.name || '(Unnamed)'; }
  function getLrn(stu) { return stu.lrn || stu.LRN || stu.id || ''; }
  function getSection(stu) { return stu.section || stu.Section || ''; }

  async function generateOne(stu, term, type, index) {
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = window.docx;
      if (!Document) throw new Error("Hindi naka-load ang docx library. I-check ang internet.");

      function border() { return { style: BorderStyle.SINGLE, size: 4, color: '000000' }; }
      function cell(text, opts) { opts = opts || {}; return new TableCell({ width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined, borders: opts.borders, shading: opts.shading ? { fill: opts.shading } : undefined, children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: [new TextRun({ text: text == null ? '' : String(text), bold: !!opts.bold, size: opts.size || 22, font: 'Calibri' })] })] }); }
      function p(text, opts) { opts = opts || {}; return new Paragraph({ alignment: opts.align || AlignmentType.LEFT, spacing: opts.spacing || { after: 60 }, children: [new TextRun({ text: text == null ? '' : String(text), bold: !!opts.bold, italics: !!opts.italics, size: opts.size || 22, font: opts.font || 'Calibri', color: opts.color })] }); }

      // 1. KUNIN ANG DATA
      const progress = stu.progress || {};
      const termScores = progress.scores && progress.scores['term' + term];
      
      if (!termScores) {
        throw new Error('Walang exam record si ' + lastFirstMiddle(stu) + ' para sa Term ' + term + '.');
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

      if (!record || !record.itemResults || record.itemResults.length === 0) {
        throw new Error('Walang item results na naitala para sa ' + label + '.');
      }

      // 2. KUNIN ANG QUESTION BANK
      let bank = null;
      const paths = [
        `../student/term${term}/assessments/${filename}.json`,
        `student/term${term}/assessments/${filename}.json`,
        `../data/term${term}/${filename}.json`
      ];
      
      for (let path of paths) {
        try {
          const res = await fetch(path + '?v=' + Date.now());
          if (res.ok) { bank = await res.json(); break; }
        } catch(e) {}
      }
      
      if (!bank) throw new Error('Hindi ma-load ang questions JSON (' + filename + '.json).');

      // 3. BUUIN ANG DOCX
      const s = window.SCHOOL_INFO || {};
      const header = [
        p('REPUBLIC OF THE PHILIPPINES', { bold: true, align: AlignmentType.CENTER, size: 22 }),
        p('DEPARTMENT OF EDUCATION', { bold: true, align: AlignmentType.CENTER, size: 22 }),
        p((s.region || '') + ' — ' + (s.division || ''), { align: AlignmentType.CENTER, size: 20 }),
        p(s.schoolName || '', { bold: true, align: AlignmentType.CENTER, size: 26 }),
        p(s.schoolAddress || '', { align: AlignmentType.CENTER, size: 20 }),
        p(s.schoolYear || '', { align: AlignmentType.CENTER, size: 20 }),
        p(''),
        p('EXAMINATION EVIDENCE RECORD', { bold: true, align: AlignmentType.CENTER, size: 28 }),
        p('')
      ];

      const rows = [
        ['Student Name', lastFirstMiddle(stu)],
        ['LRN', getLrn(stu)],
        ['Grade & Section', (s.gradeLevel || 'Grade 11') + ' - ' + getSection(stu)],
        ['Subject', s.subject || 'General Science'],
        ['Assessment', label],
        ['Date Taken', fmtDate(record.date || record.takenAt)]
      ];

      const infoTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: border(), bottom: border(), left: border(), right: border(), insideHorizontal: border(), insideVertical: border() },
        rows: rows.map(r => new TableRow({ children: [cell(r[0], { bold: true, width: 30, shading: 'F5F5F5' }), cell(r[1], { width: 70 })] }))
      });

      const items = record.itemResults || [];
      const questions = (bank && bank.questions) || [];
      const byId = {};
      questions.forEach(q => { if (q && q.id != null) byId[String(q.id)] = q; });
      const analysis = [];
      
      analysis.push(p('ITEM ANALYSIS', { bold: true, size: 24, spacing: { before: 200, after: 100 } }));

      items.forEach((r, i) => {
        let q = (r.questionId != null) ? byId[String(r.questionId)] : null;
        if (!q && r.originalIndex != null) q = questions[r.originalIndex] || null;
        if (!q && r.index != null) q = questions[r.index] || null;
        if (!q) q = {};

        const opts = q.options || [];
        const givenText = r.given != null ? String(r.given) : '(no answer)';
        const expectedText = r.expected != null ? String(r.expected) : '(unknown)';

        analysis.push(p('Q' + (i + 1) + '. ' + (q.text || '(Question unavailable)'), { bold: true, size: 22, spacing: { before: 120, after: 40 } }));
        opts.forEach((opt, idx) => {
          analysis.push(p('   ' + (idx + 1) + '. ' + opt + (opt === expectedText ? '  ✓' : ''), { size: 20, spacing: { after: 20 }, indent: { left: 400 } }));
        });
        analysis.push(p("Student's Answer: " + givenText + '  ' + (r.correct ? '✅' : '❌'), { size: 20, color: r.correct ? '1B5E20' : 'B71C1C', spacing: { before: 40, after: 0 }, indent: { left: 400 } }));
        analysis.push(p('Correct Answer:   ' + expectedText, { size: 20, color: '1B5E20', spacing: { after: 100 }, indent: { left: 400 } }));
      });

      const correct = record.correct != null ? record.correct : (record.score || 0);
      const total = record.total != null ? record.total : items.length;
      const percent = record.percent != null ? record.percent : (total ? Math.round((correct / total) * 100) : 0);
      
      const summary = [
        p('SUMMARY', { bold: true, size: 24, spacing: { before: 240, after: 80 } }),
        p('Correct: ' + correct + ' | Wrong: ' + Math.max(0, total - correct) + ' | Score: ' + percent + '% | Remarks: ' + (percent >= 75 ? 'PASSED' : 'FAILED'), { bold: true, size: 22, color: percent >= 75 ? '1B5E20' : 'B71C1C' })
      ];

      const signatures = [
        p('', { spacing: { before: 400 } }),
        p('Teacher:', { bold: true, size: 22 }),
        p('_________________________', { size: 22 }),
        p(s.teacherName || '', { bold: true, size: 22 }),
        p(s.teacherPosition || '', { size: 20 }),
        p('', { spacing: { before: 320 } }),
        p('Parent/Guardian:', { bold: true, size: 22 }),
        p('_________________________', { size: 22 }),
        p('Signature over printed name', { size: 20, italics: true }),
        p('', { spacing: { before: 320 } }),
        p('Date: _____________', { size: 22 })
      ];

      const doc = new Document({
        creator: s.teacherName || 'Teacher',
        title: 'Exam Evidence — ' + lastFirstMiddle(stu),
        sections: [{
          properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
          children: [].concat(header).concat([infoTable]).concat(analysis).concat(summary).concat(signatures)
        }]
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Evidence_' + getLrn(stu) + '_' + filename + '.docx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      return true;
    } catch (err) {
      alert('❌ Error: ' + err.message);
      console.error(err);
      return false;
    }
  }

  return { generateOne };
})();

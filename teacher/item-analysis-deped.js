/* ============================================================
   item-analysis-deped.js — DepEd-format Item Analysis (school template)
   Version: 1.0.0 (General Science)
   ------------------------------------------------------------
   Same layout and logic as the school's "ITEM ANALYSIS" workbook:
     Item No. · Learning Competency · Cognitive Domain · Correct Responses ·
     % Success (= correct / total examinees) · Mastery Level · Intervention Plan
     Mastery: ≥85% Exceeds · ≥70% Meets · ≥50% Approaching · <50% Needs Intervention
   - Shown on screen (with Copy buttons for pasting into the school file), and
   - Downloadable as the school's own .xlsx (data/templates/item-analysis-template.xlsx):
     the matrix is rebuilt for the test's number of items (20 / 30 / 60), competency
     cells are merged per competency, and the Dashboard, chart and formulas are
     pointed at the new rows. Excel recalculates everything when opened.
   ============================================================ */
const ItemAnalysisDepEd = (() => {
  'use strict';

  const TEMPLATE = '../data/templates/item-analysis-template.xlsx';
  const LEVELS = [
    { min: 0.85, level: 'Exceeds Standard', short: 'ES', plan: 'Enrichment & Peer Tutoring', color: '#c8e6c9' },
    { min: 0.70, level: 'Meets Standard', short: 'MS', plan: 'Standard Reinforcement', color: '#e3f2fd' },
    { min: 0.50, level: 'Approaching Standard', short: 'AS', plan: 'Targeted Practice Worksheets', color: '#fff9c4' },
    { min: 0, level: 'Needs Intervention', short: 'NI', plan: 'Reteach & Intensive Remediation', color: '#ffcdd2' }
  ];
  const levelOf = (p) => LEVELS.find((l) => p >= l.min) || LEVELS[3];
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1) + '%';
  const LS_APPROVER = 'gsa_ia_approved_by';
  const LS_GRADE = 'gsa_ia_grade_level';
  let last = null;

  // consecutive items with the same competency -> one merged block
  function groups(rows) {
    const out = [];
    rows.forEach((r, i) => {
      const g = out[out.length - 1];
      if (g && g.code === r.code) g.end = i; else out.push({ code: r.code, start: i, end: i });
    });
    return out;
  }

  function summary(rows) {
    const n = rows.length || 1;
    const avgCorrect = rows.reduce((a, r) => a + r.correct, 0) / n;
    const avgP = rows.reduce((a, r) => a + r.p, 0) / n;
    const mastered = rows.filter((r) => r.p >= 0.7).length;
    const dist = LEVELS.map((L) => ({ ...L, count: rows.filter((r) => r.level === L.level).length }));
    return { avgCorrect, avgP, mastered, dist };
  }

  function findings(rows, desc) {
    const by = {};
    rows.forEach((r) => { (by[r.code] = by[r.code] || []).push(r); });
    const comps = Object.keys(by).map((code) => ({ code, p: by[code].reduce((a, r) => a + r.p, 0) / by[code].length, items: by[code].map((r) => r.no) }))
      .sort((a, b) => b.p - a.p);
    const name = (c) => (desc[c.code] || c.code).replace(/\.$/, '');
    const short = (c) => { const t = name(c); return t.length > 90 ? t.slice(0, 87) + '…' : t; };
    const top = comps.filter((c) => c.p >= 0.7).slice(0, 2);
    const low = comps.slice().reverse().filter((c) => c.p < 0.5).slice(0, 2);
    const weakItems = rows.filter((r) => r.p < 0.5).map((r) => r.no);
    const domains = {};
    rows.forEach((r) => { const d = domains[r.domain] = domains[r.domain] || { s: 0, n: 0 }; d.s += r.p; d.n++; });
    const hotsLow = ['Applying', 'Analyzing', 'Evaluating', 'Creating'].filter((d) => domains[d] && domains[d].s / domains[d].n < 0.5);
    const f1 = top.length
      ? `1. High Mastery Areas: Learners performed best in ${top.map((c) => `"${short(c)}" (${pct(c.p)})`).join(' and ')}.`
      : `1. High Mastery Areas: No competency reached 70% mastery yet; the highest was "${short(comps[0])}" (${pct(comps[0].p)}).`;
    const f2 = low.length
      ? `2. Critical Gaps: ${low.map((c) => `"${short(c)}" (${pct(c.p)})`).join(' and ')} registered below 50% mastery${hotsLow.length ? `; ${hotsLow.join('/')} items were the weakest cognitive domain` : ''}.`
      : `2. Critical Gaps: No competency fell below 50% mastery; the lowest was "${short(comps[comps.length - 1])}" (${pct(comps[comps.length - 1].p)}).`;
    const f3 = weakItems.length
      ? `3. Next Steps: Reteach and conduct targeted small-group remediation on item${weakItems.length > 1 ? 's' : ''} ${weakItems.join(', ')}; give enrichment and peer tutoring to learners who mastered the high-mastery competencies.`
      : '3. Next Steps: Continue standard reinforcement and give enrichment and peer tutoring; review items between 50% and 69% before the next test.';
    return [f1, f2, f3];
  }

  /* ---------- on-screen report ---------- */
  /**
   * o = { box, subjectName, examTitle, section, examinees, older, fileTag,
   *       rows: [{ no, code, desc, domain, correct }] }   (rows in master-copy order)
   */
  async function render(o) {
    const box = o.box || document.getElementById('ia-deped');
    if (!box) return;
    const desc = {};
    const n = o.examinees || 0;
    const rowsIn = (o.rows || []).map((r) => {
      if (r.desc) desc[r.code] = r.desc;
      const p = n ? r.correct / n : 0;
      const L = levelOf(p);
      return { no: r.no, code: r.code, domain: r.domain || '', correct: r.correct, p, level: L.level, plan: L.plan, color: L.color };
    });
    const res = { examinees: n, older: o.older || 0, rows: rowsIn };
    const dev = CONFIG.DEVELOPER || {};
    const subjName = o.subjectName;
    const examTitle = (o.examTitle || '').toUpperCase();
    const grade = localStorage.getItem(LS_GRADE) || String(CONFIG.GRADE_LEVEL || '11');
    const gradeSection = (grade + ' ' + (o.section || '')).trim();
    last = { o, res, desc, subjName, examTitle, gradeSection };
    if (!res.examinees) {
      box.innerHTML = `<div style="padding:20px;color:#78909c;text-align:center;">Walang submission sa kasalukuyang bersyon ng test na ito${o.section ? ' para sa ' + esc(o.section) : ''}.${res.older ? ` (${res.older} ang kumuha ng lumang bersyon — hindi kasama.)` : ''}</div>`;
      return;
    }
    const s = summary(res.rows);
    const f = findings(res.rows, desc);
    last.summary = s; last.findings = f;
    const gs = groups(res.rows);
    const startOf = {}; gs.forEach((g) => { startOf[g.start] = g; });
    const body = res.rows.map((r, i) => {
      const g = startOf[i];
      return `<tr>
        <td class="num">${r.no}</td>
        ${g ? `<td rowspan="${g.end - g.start + 1}" class="dep-comp">${esc(desc[r.code] || r.code)}<div class="dep-code">${esc(r.code)}</div></td>` : ''}
        <td>${esc(r.domain)}</td><td class="num">${r.correct}</td>
        <td class="num" style="background:${r.color};">${pct(r.p)}</td><td>${esc(r.level)}</td><td>${esc(r.plan)}</td></tr>`;
    }).join('');
    box.innerHTML = `
      <div class="dep-head">
        <div><b>School:</b> ${esc(dev.school || '')}</div><div><b>Learning Area:</b> ${esc(subjName)}</div>
        <div><b>Grade &amp; Section:</b> <input id="dep-grade" class="form-control dep-in" value="${esc(grade)}" title="Grade level"> ${esc(o.section || 'All sections')}</div>
        <div><b>Exam:</b> ${esc(examTitle)}</div><div><b>Total Examinees:</b> ${res.examinees}</div><div><b>Total Items:</b> ${res.rows.length}</div>
        <div><b>Subject Teacher:</b> ${esc(dev.name || '')}</div>
        <div><b>Approved by:</b> <input id="dep-approver" class="form-control dep-in" style="width:220px;" placeholder="School Head / Principal" value="${esc(localStorage.getItem(LS_APPROVER) || '')}"></div>
      </div>
      ${res.older ? `<div class="alert alert-info">ℹ️ ${res.older} estudyante ang kumuha ng lumang bersyon ng test — hindi sila kasama sa bilang.</div>` : ''}
      <div class="dep-actions">
        <button class="btn btn-primary" id="dep-download">⬇️ I-download ang Excel (school format)</button>
        <button class="btn btn-outline" id="dep-copy-d">📋 Copy "Correct Responses" lang</button>
        <button class="btn btn-outline" id="dep-copy-all">📋 Copy buong table</button>
        <span id="dep-status" class="text-small"></span>
      </div>
      <div style="overflow:auto;"><table class="ia-table dep-table">
        <thead><tr><th>Item No.</th><th>Learning Competency / Skill Description</th><th>Cognitive Domain</th><th>Correct Responses</th><th>% Success</th><th>Mastery Level</th><th>Intervention Plan</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="3"><b>AVERAGE / OVERALL</b></td><td class="num"><b>${s.avgCorrect.toFixed(2)}</b></td><td class="num"><b>${pct(s.avgP)}</b></td><td colspan="2"></td></tr></tfoot>
      </table></div>
      <h3 style="margin:22px 0 8px;">Executive Item Analysis Dashboard</h3>
      <div class="dep-stats">
        <div><span>Class Average Score</span><b>${s.avgCorrect.toFixed(2)}</b></div>
        <div><span>Overall Mean Mastery</span><b>${pct(s.avgP)}</b></div>
        <div><span>Mastered Items (≥70%)</span><b>${s.mastered} / ${res.rows.length}</b></div>
      </div>
      <table class="ia-table" style="margin-top:12px;max-width:640px;">
        <thead><tr><th>Mastery Category</th><th>Benchmark Range</th><th>Item Count</th><th>% of Test</th></tr></thead>
        <tbody>${s.dist.map((d, k) => `<tr><td style="background:${d.color};">${esc(d.level)} (${d.short})</td><td>${['85% - 100%', '70% - 84%', '50% - 69%', 'Below 50%'][k]}</td><td class="num">${d.count}</td><td class="num">${pct(d.count / res.rows.length)}</td></tr>`).join('')}
          <tr><td colspan="2"><b>TOTAL TEST ITEMS</b></td><td class="num"><b>${res.rows.length}</b></td><td class="num"><b>100.0%</b></td></tr></tbody>
      </table>
      <h4 style="margin:16px 0 6px;">Key Pedagogical Findings &amp; Action Plan</h4>
      ${f.map((x) => `<p style="margin:4px 0;">${esc(x)}</p>`).join('')}
      <p class="text-small text-muted" style="margin-top:10px;">Ang "Copy Correct Responses" ay ang mga numero lang (isa kada item, Item 1 pababa). I-paste ito sa D18 ng Item Analysis Matrix ng file mo. Ang ibang column doon ay formula na.</p>`;
    document.getElementById('dep-copy-d').onclick = () => copy(res.rows.map((r) => r.correct).join('\n'), 'Correct Responses');
    document.getElementById('dep-copy-all').onclick = () => copy(['Item No.\tLearning Competency / Skill Description\tCognitive Domain\tCorrect Responses\t% Success\tMastery Level\tIntervention Plan']
      .concat(res.rows.map((r) => [r.no, desc[r.code] || r.code, r.domain, r.correct, pct(r.p), r.level, r.plan].join('\t'))).join('\n'), 'table');
    document.getElementById('dep-download').onclick = download;
    document.getElementById('dep-approver').onchange = (e) => { try { localStorage.setItem(LS_APPROVER, e.target.value); } catch (x) { /* ignore */ } };
    document.getElementById('dep-grade').onchange = (e) => { try { localStorage.setItem(LS_GRADE, e.target.value); } catch (x) { /* ignore */ } last.gradeSection = (e.target.value + ' ' + (o.section || '')).trim(); };
  }

  async function copy(text, what) {
    const st = document.getElementById('dep-status');
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } finally { t.remove(); }
    }
    st.textContent = `✅ Na-copy ang ${what}. I-paste sa Excel.`;
  }

  /* ---------- Excel (school template) ---------- */
  function cellXml(ref, s, v, kind) {
    if (v === '' || v === null || v === undefined) return `<c r="${ref}" s="${s}"/>`;
    if (kind === 'n') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${XlsxLite.xmlEsc(v)}</t></is></c>`;
  }

  async function buildXlsx() {
    const { res, desc, subjName, examTitle, gradeSection, findings: f } = last;
    const N = res.rows.length, END = 17 + N, DELTA = N - 60;
    const buf = await fetch(TEMPLATE + '?v=' + encodeURIComponent(CONFIG.VERSION)).then((r) => { if (!r.ok) throw new Error('Hindi ma-load ang template.'); return r.arrayBuffer(); });
    const wb = await XlsxLite.openWorkbook(buf);
    const dev = CONFIG.DEVELOPER || {};

    /* ---- Item Analysis Matrix ---- */
    const m = await wb.sheet('Item Analysis Matrix');
    if (dev.region) m.set('A3', dev.region);
    if (dev.division) m.set('A4', dev.division);
    if (dev.district) m.set('A5', dev.district);
    if (dev.school) m.set('A6', dev.school);
    m.set('A7', 'S.Y. 2026-2027');
    m.set('B12', dev.school || '');
    m.set('B13', subjName);
    m.set('E13', examTitle);
    m.set('B14', gradeSection);
    m.set('E14', res.examinees);
    m.set('B15', dev.name || '');
    m.set('E15', N);
    let xml = m.xml;
    const sdStart = xml.indexOf('<sheetData>') + '<sheetData>'.length, sdEnd = xml.indexOf('</sheetData>');
    const rowsXml = xml.slice(sdStart, sdEnd).match(/<row [\s\S]*?<\/row>|<row [^>]*\/>/g) || [];
    const rowNo = (r) => Number(/<row r="(\d+)"/.exec(r)[1]);
    const head = rowsXml.filter((r) => rowNo(r) <= 17);
    const tail = rowsXml.filter((r) => rowNo(r) >= 78);
    const shiftRefs = (txt) => txt
      .replace(/(<row r=")(\d+)"/g, (x, a, n) => a + (Number(n) + DELTA) + '"')
      .replace(/(\sr=")([A-Z]+)(\d+)"/g, (x, a, c, n) => a + c + (Number(n) >= 78 ? Number(n) + DELTA : n) + '"')
      .replace(/(\sref=")([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (x, a, c1, n1, c2, n2) => a + c1 + (Number(n1) >= 78 ? Number(n1) + DELTA : n1) + ':' + c2 + (Number(n2) >= 78 ? Number(n2) + DELTA : n2) + '"')
      .replace(/(\$?[A-G]\$?18:\$?[A-G]\$?)77\b/g, '$1' + END)
      .replace(/(<f[^>]*>[^<]*<\/f>|<f[^>]*\/>)<v>[^<]*<\/v>/g, '$1');      // stale cached results
    // generated item rows
    const gs = groups(res.rows);
    const gIndex = new Array(N);
    gs.forEach((g, gi) => { for (let i = g.start; i <= g.end; i++) gIndex[i] = { g, gi }; });
    const items = res.rows.map((r, i) => {
      const row = 18 + i, odd = i % 2 === 0;
      const S = odd ? { a: 6, c: 6, d: 7, e: 8, f: 6, g: 9 } : { a: 10, c: 10, d: 11, e: 12, f: 10, g: 13 };
      const { g, gi } = gIndex[i];
      const first = i === g.start, lastRow = i === g.end;
      const bS = gi === 0 ? (first ? 41 : lastRow ? 43 : 42) : (first ? 44 : lastRow ? 46 : 45);
      const text = desc[r.code] || r.code;
      const lines = Math.max(1, Math.ceil(text.length / 62));
      const span = g.end - g.start + 1;
      const ht = Math.max(15.75, Math.ceil(lines * 15 / span * 4) / 4);
      return `<row r="${row}" spans="1:7" ht="${ht}" customHeight="1" x14ac:dyDescent="0.2">` +
        cellXml('A' + row, S.a, r.no, 'n') +
        cellXml('B' + row, bS, first ? text : '', 's') +
        cellXml('C' + row, S.c, r.domain, 's') +
        cellXml('D' + row, S.d, r.correct, 'n') +
        `<c r="E${row}" s="${S.e}"><f>D${row}/$E$14</f><v>${r.p}</v></c>` +
        `<c r="F${row}" s="${S.f}" t="str"><f>IF(E${row}&gt;=0.85,"Exceeds Standard",IF(E${row}&gt;=0.7,"Meets Standard",IF(E${row}&gt;=0.5,"Approaching Standard","Needs Intervention")))</f><v>${XlsxLite.xmlEsc(r.level)}</v></c>` +
        `<c r="G${row}" s="${S.g}" t="str"><f>IF(E${row}&gt;=0.85,"Enrichment &amp; Peer Tutoring",IF(E${row}&gt;=0.7,"Standard Reinforcement",IF(E${row}&gt;=0.5,"Targeted Practice Worksheets","Reteach &amp; Intensive Remediation")))</f><v>${XlsxLite.xmlEsc(r.plan)}</v></c>` +
        '</row>';
    });
    let rest = xml.slice(sdEnd);
    // merges: drop the template's competency blocks, shift the ones below the table, add ours
    rest = rest.replace(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/, (all, inner) => {
      const refs = (inner.match(/ref="([^"]+)"/g) || []).map((x) => x.slice(5, -1)).filter((ref) => {
        const mm = /^B(\d+):B(\d+)$/.exec(ref); return !(mm && Number(mm[1]) >= 18 && Number(mm[2]) <= 77);
      }).map((ref) => ref.replace(/([A-Z]+)(\d+)/g, (x, c, n) => c + (Number(n) >= 78 ? Number(n) + DELTA : n)));
      gs.forEach((g) => { if (g.end > g.start) refs.push(`B${18 + g.start}:B${18 + g.end}`); });
      return `<mergeCells count="${refs.length}">` + refs.map((r) => `<mergeCell ref="${r}"/>`).join('') + '</mergeCells>';
    });
    rest = rest.replace(/sqref="E18:E77"/g, `sqref="E18:E${END}"`)
      .replace(/(<rowBreaks[^>]*>[\s\S]*?<brk id=")(\d+)"/, (x, a, n) => a + (Number(n) + DELTA) + '"');
    let pre = xml.slice(0, sdStart)
      .replace(/topLeftCell="[A-Z]+\d+"/, 'topLeftCell="A18"')
      .replace(/activeCell="[A-Z]+\d+" sqref="[^"]*"/, 'activeCell="D18" sqref="D18"');
    m.setXml(pre + head.join('') + items.join('') + tail.map(shiftRefs).join('') + rest);

    /* ---- Dashboard & Summary ---- */
    const d = await wb.sheet('Dashboard & Summary');
    let dx = d.xml.replace(/(\$?[A-G]\$?18:\$?[A-G]\$?)77\b/g, '$1' + END)
      .replace(/(<f[^>]*>[^<]*<\/f>|<f[^>]*\/>)<v>[^<]*<\/v>/g, '$1');
    d.setXml(dx);
    d.set('E14', examTitle);
    f.forEach((t, k) => d.set('A' + (55 + k), t));
    // taller rows so the wrapped findings are fully visible
    d.setXml(d.xml.replace(/<row r="(55|56|57)"([^>]*?) ht="[^"]*"/g, (x, r, attrs) => {
      const lines = Math.max(1, Math.ceil(f[Number(r) - 55].length / 95));
      return `<row r="${r}"${attrs} ht="${(lines * 15.75).toFixed(2)}"`;
    }));
    d.set('A61', dev.name || '');
    const approver = (document.getElementById('dep-approver') || {}).value || '';
    d.set('E61', approver || '______________________');

    /* ---- chart: new ranges, drop stale caches ---- */
    const chartPath = 'xl/charts/chart1.xml';
    const cx = await wb.readText(chartPath);
    if (cx) {
      wb.writeText(chartPath, cx.replace(/(\$A\$18:\$A\$|\$E\$18:\$E\$)77/g, '$1' + END)
        .replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, '').replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, ''));
    }
    return wb.save();
  }

  async function download() {
    const st = document.getElementById('dep-status');
    const btn = document.getElementById('dep-download');
    btn.disabled = true; st.textContent = '⏳ Ginagawa ang Excel...';
    try {
      const blob = await buildXlsx();
      const o = last.o;
      const name = `Item Analysis - ${last.subjName} - ${o.fileTag || o.examTitle}${o.section ? ' - ' + o.section : ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      st.textContent = '✅ Na-download. Buksan sa Excel (pindutin ang Enable Editing para mag-compute). Sa WPS/LibreOffice: Ctrl+Shift+F9.';
    } catch (e) {
      st.textContent = '❌ ' + e.message;
    } finally { btn.disabled = false; }
  }

  return { render, buildXlsx, _last: () => last };
})();
if (typeof window !== 'undefined') window.ItemAnalysisDepEd = ItemAnalysisDepEd;

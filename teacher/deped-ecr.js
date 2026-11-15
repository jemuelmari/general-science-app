/* ============================================================
   deped-ecr.js — Fill the official DepEd SHS ECR (.xlsx) with app scores
   Version: 1.1.0 (General Science — one ECR file per section, Term 1–3 sheets)
   ------------------------------------------------------------
   - The teacher's own ECR file is opened IN THE BROWSER (JSZip) and never uploaded.
   - Only input cells are written (learners' LRN/names in INPUT DATA, highest
     possible scores and raw scores in the Term sheet). Every formula, the
     protection, validation and formatting of the DepEd file stay as they are;
     Excel recomputes the grades when the file is opened (fullCalcOnLoad).
   - Layout (SHS ECR 2026, "ECRSHS2026"):
       INPUT DATA  N/O = male LRN/name, R/S = female LRN/name, rows 11–60
                   F25 section, F30 subject, F33 no. of terms, H33 term block
       Term n      row 14 = highest possible score
                   males rows 17–66, females rows 68–117
                   WW D–M, PT Q–Z, ST1 AD, ST2 AE, TE AF
   ============================================================ */
(function () {
  'use strict';

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const L = {
    input: { maleLrn: 'N', maleName: 'O', femaleLrn: 'R', femaleName: 'S', first: 11, slots: 50,
             section: 'F25', subject: 'F30', terms: 'F33', block: 'H33', teacher: 'F22' },
    term: { hps: 14, male: 17, female: 68, slots: 50, ww: 'D', pt: 'Q', st1: 'AD', st2: 'AE', te: 'AF', wwSlots: 10, ptSlots: 10 }
  };
  const TERM_BLOCKS = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'];

  // App assessments (in ECR column order). Scores live in progress.scores[term].
  const A = {
    ww: [1, 2, 3].map((n) => ({ id: 'quiz' + n, key: 'q' + n, label: 'Quiz ' + n })),
    pt: [1, 2, 3].map((n) => ({ id: 'pt' + n, key: 'pt' + n, label: 'PT ' + n, isPt: true })),
    ex: [{ key: 'st1', id: 'st1', label: 'ST 1' }, { key: 'st2', id: 'st2', label: 'ST 2' }, { key: 'te', id: 'te', label: 'TE' }]
  };
  let CLOUD = [];   // students from TeacherCloud.fetchStudents()

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const shiftCol = (c, k) => colName(colNum(c) + k);
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const norm = (v) => String(v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ñ/g, 'N').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

  const openWorkbook = (file) => XlsxLite.openWorkbook(file);

  /* ============================================================
     State
     ============================================================ */
  const state = { file: null, wb: null, info: null, plan: null };

  function users(section) {
    return CLOUD.filter((u) => !section || u.section === section);
  }
  const recOf = (u, term, id) => TeacherCloud.getRecord((u.progress && u.progress.scores) || {}, term, id);
  const numScore = (r) => (r && r.score !== null && r.score !== undefined && r.score !== '' && isFinite(Number(r.score))) ? Number(r.score) : null;
  const sexOf = (u) => /^m/i.test(String(u.sex || '').trim()) ? 'M' : /^f/i.test(String(u.sex || '').trim()) ? 'F' : '';
  const ecrName = (u) => {
    const first = [u.firstName, u.middleName].filter(Boolean).join(' ').trim();
    return (String(u.lastName || '').trim().toUpperCase() + (first ? ', ' + first : '')).trim();
  };

  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const COMP = {
    WW: Array.from({ length: L.term.wwSlots }, (_, k) => shiftCol(L.term.ww, k)),
    PT: Array.from({ length: L.term.ptSlots }, (_, k) => shiftCol(L.term.pt, k)),
    EX: [L.term.st1, L.term.st2, L.term.te]
  };
  const ALLCOLS = [].concat(COMP.WW, COMP.PT, COMP.EX);
  const rowOf = (sx, i) => (sx === 'M' ? L.term.male : L.term.female) + i;

  // Everything already typed in a Term sheet: HPS row, learners' scores, the weights.
  async function readTerm(wb, n) {
    const ws = await wb.sheet('Term ' + n);
    const T = L.term;
    const hps = {}, vals = {};
    ALLCOLS.forEach((c) => { const v = ws.get(c + T.hps); if (isNum(v)) hps[c] = v; });
    ['M', 'F'].forEach((sx) => { for (let i = 0; i < T.slots; i++) {
      const r = rowOf(sx, i); const o = {};
      ALLCOLS.forEach((c) => { const v = ws.get(c + r); if (isNum(v)) o[c] = v; });
      vals[r] = o;
    } });
    const num = (ref, d) => { const v = ws.get(ref); return isNum(v) ? v : d; };
    const W = (CONFIG && CONFIG.WEIGHTS) || {};
    const weights = {
      ww: num('D12', (W.WW || W.ww || 20) / 100), pt: num('Q12', (W.PT || W.pt || 50) / 100), ex: num('AD12', (W.QA || W.EX || W.ex || 30) / 100),
      st1: num('AG14', 30), st2: num('AH14', 30), te: num('AI14', 40)
    };
    return { hps, vals, weights };
  }

  async function readTemplate(file) {
    const wb = await openWorkbook(file);
    const need = ['INPUT DATA', 'Term 1', 'Term 2', 'Term 3'];
    const missing = need.filter((n) => !wb.sheetPaths[n]);
    if (missing.length) throw new Error('Hindi ito ang DepEd SHS ECR template (wala ang sheet: ' + missing.join(', ') + ').');
    const inp = await wb.sheet('INPUT DATA');
    const I = L.input;
    const learners = { M: [], F: [] };
    for (let i = 0; i < I.slots; i++) {
      const r = I.first + i;
      learners.M.push({ slot: i, lrn: digits(inp.get(I.maleLrn + r)), name: String(inp.get(I.maleName + r) || '').trim() });
      learners.F.push({ slot: i, lrn: digits(inp.get(I.femaleLrn + r)), name: String(inp.get(I.femaleName + r) || '').trim() });
    }
    const subjectText = String(inp.get(I.subject) || '');
    const subject = /SCIENCE/i.test(subjectText) ? 'gensci' : '';
    const block = String(inp.get(I.block) || '').trim().toUpperCase();
    const terms = Number(inp.get(I.terms)) || 1;
    const termIdx = TERM_BLOCKS.indexOf(block);
    const sheets = {};
    for (const n of [1, 2, 3]) sheets[n] = await readTerm(wb, n);
    // Suggested term: the last Term sheet that already has something in it.
    let lastUsed = 1;
    [1, 2, 3].forEach((n) => { if (Object.keys(sheets[n].hps).length) lastUsed = n; });
    return {
      wb, learners, subject, subjectText, sheets,
      section: String(inp.get(I.section) || '').trim(),
      teacher: String(inp.get(I.teacher) || '').trim(),
      terms, block, termNo: terms === 1 && termIdx >= 0 ? termIdx + 1 : lastUsed
    };
  }

  /* ECR grade of one row, computed exactly like the Term-sheet formulas
     (N/O/P, AA/AB/AC, AG–AK, AL, AM). Returns null when the ECR shows no grade. */
  function ecrGrade(hps, row, w) {
    const comp = (cols) => {
      const tot = cols.reduce((a, c) => a + (hps[c] || 0), 0);
      const got = cols.filter((c) => isNum(row[c]));
      if (!got.length || !tot) return null;
      return r2(r2(got.reduce((a, c) => a + row[c], 0) / tot * 100) * 1);
    };
    const wwPs = comp(COMP.WW), ptPs = comp(COMP.PT);
    const ww = wwPs === null ? null : r2(wwPs * w.ww), pt = ptPs === null ? null : r2(ptPs * w.pt);
    let ex = null;
    if (w.ex > 0) {
      const parts = [[L.term.st1, w.st1], [L.term.st2, w.st2], [L.term.te, w.te]];
      const ws = parts.map(([c, k]) => isNum(row[c]) && hps[c] ? r2(row[c] / hps[c] * k) : null);
      if (ws.some((v) => v !== null)) {
        const pct = ws.reduce((a, v) => a + (v || 0), 0) / (w.st1 + w.st2 + w.te) * 100;
        ex = r2(pct * w.ex);
      }
    }
    if (ww === null || pt === null) return null;
    if (w.ex > 0 && ex === null) return null;
    const ig = r2(ww + pt + (w.ex > 0 ? ex : 0));
    return { ig, tg: Transmutation.transmute(ig) };
  }

  function nameMatches(slotName, u) {
    const parts = slotName.split(',');
    const tl = norm(parts[0]), tf = norm(parts.slice(1).join(' '));
    const fl = norm(u.lastName), ff = norm(u.firstName);
    if (!tl || tl !== fl || !tf || !ff) return false;
    return tf.startsWith(ff) || ff.startsWith(tf) || tf.split(' ')[0] === ff.split(' ')[0];
  }

  /* ============================================================
     Plan: who goes in which row, what goes in which cell
     ============================================================ */
  function buildPlan() {
    const info = state.info;
    const subject = 'gensci';
    const section = $('ecr-section').value;
    const termNo = Number($('ecr-term').value) || info.termNo;
    const term = 'term' + termNo;
    const sheet = info.sheets[termNo];
    const addMissing = $('ecr-add-missing').checked;
    const zeroMissing = $('ecr-zero-missing').checked;
    const roster = users(section);
    const all = [].concat(A.ww, A.pt, A.ex);
    // given = taken by anyone in the class (all sections); HPS = the record's total
    const givenSet = {}, hpsOf = {};
    CLOUD.forEach((u) => all.forEach((a) => {
      const r = recOf(u, term, a.id); const sc = numScore(r);
      if (sc === null) return;
      givenSet[a.key] = true;
      const tot = Number(r.total) || (a.isPt ? 100 : 0);
      hpsOf[a.id] = Math.max(hpsOf[a.id] || 0, tot);
    }));
    const pctsOf = (u) => { const o = {}; all.forEach((a) => { o[a.key] = TeacherCloud.percentOf(recOf(u, term, a.id)); }); return o; };
    const warnings = [];

    // ---- assign learners to slots ----
    const slots = { M: info.learners.M.map((x) => ({ ...x, user: null })), F: info.learners.F.map((x) => ({ ...x, user: null })) };
    const hasNames = slots.M.some((x) => x.name) || slots.F.some((x) => x.name);
    const used = new Set();
    const noSex = [];
    const overrideSex = state.sexOverride || {};
    const manual = state.manualMatch || {};
    const userSex = (u) => overrideSex[u.lrn] || sexOf(u);

    if (hasNames) {
      // 1) teacher's own pairings, 2) LRN, 3) name
      ['M', 'F'].forEach((sx) => slots[sx].forEach((slot, i) => {
        const pick = manual[sx + i];
        if (!pick) return;
        const u = roster.find((x) => x.lrn === pick && !used.has(x.lrn));
        if (u) { slot.user = u; slot.manual = true; used.add(u.lrn); }
      }));
      ['M', 'F'].forEach((sx) => slots[sx].forEach((slot) => {
        if (slot.user || !slot.lrn) return;
        const u = roster.find((x) => !used.has(x.lrn) && digits(x.lrn) === slot.lrn);
        if (u) { slot.user = u; used.add(u.lrn); }
      }));
      ['M', 'F'].forEach((sx) => slots[sx].forEach((slot, i) => {
        if (slot.user || !slot.name || manual[sx + i] === '-') return;
        const cands = roster.filter((x) => !used.has(x.lrn) && nameMatches(slot.name, x));
        const u = cands.find((x) => userSex(x) === sx) || cands[0];
        if (u) { slot.user = u; used.add(u.lrn); }
      }));
    }
    // ECR names still without a match: app students with the same last name are probably them,
    // so they are offered for pairing instead of being added as new learners.
    const openSlots = ['M', 'F'].flatMap((sx) => slots[sx].map((s, i) => ({ s, sx, i })).filter((o) => (o.s.name || o.s.lrn) && !o.s.user && manual[o.sx + o.i] !== '-'));
    const openLast = new Set(openSlots.map((o) => norm(String(o.s.name).split(',')[0])).filter(Boolean));
    const probable = new Set(roster.filter((u) => !used.has(u.lrn) && openLast.has(norm(u.lastName))).map((u) => u.lrn));
    const rest = roster.filter((u) => !used.has(u.lrn) && !probable.has(u.lrn))
      .sort((a, b) => ecrName(a).localeCompare(ecrName(b)));
    const notPlaced = [];
    if (!hasNames || addMissing) {
      rest.forEach((u) => {
        const sx = userSex(u);
        if (!sx) { noSex.push(u); return; }
        const free = slots[sx].find((s) => !s.name && !s.lrn && !s.user);
        if (!free) { notPlaced.push(u); return; }
        free.user = u; free.isNew = true; used.add(u.lrn);
      });
    } else {
      rest.forEach((u) => notPlaced.push(u));
    }
    const unplaced = roster.filter((u) => !used.has(u.lrn));
    if (probable.size) warnings.push(`${probable.size} estudyante sa app ang posibleng nasa ECR na pero iba ang pagkakasulat ng pangalan — ipares sila sa ibaba para maisama: ${roster.filter((u) => probable.has(u.lrn)).map(ecrName).join('; ')}`);
    if (noSex.length) warnings.push(`${noSex.length} estudyante ang walang Sex sa app — piliin sa ibaba para maisama.`);
    if (notPlaced.length) warnings.push(`${notPlaced.length} estudyante ang hindi nailagay${hasNames && !addMissing ? ' (wala sila sa listahan ng ECR)' : ' (puno na ang 50 slots)'}: ${notPlaced.map(ecrName).join('; ')}`);
    const unmatched = ['M', 'F'].flatMap((sx) => slots[sx].map((s, i) => ({ s, sx, i })).filter((o) => (o.s.name || o.s.lrn) && (!o.s.user || o.s.manual)));
    if (info.subjectText && !info.subject) warnings.push(`Ang subject sa ECR ay "${info.subjectText}" — siguraduhing General Science ang file na ito.`);
    if (info.section && section && norm(info.section) !== norm(section)) warnings.push(`Ang section sa ECR ay "${info.section}", pero "${section}" ang napili mo.`);

    // ---- columns: each given app test goes to one ECR column ----
    const placed = ['M', 'F'].flatMap((sx) => slots[sx].map((s, i) => ({ s, row: rowOf(sx, i) })).filter((o) => o.s.user));
    const appScore = (u, a) => { const v = numScore(recOf(u, term, a.id)); return v === null ? null : Math.max(0, Math.round(v)); };
    const occupied = (c) => (c in sheet.hps) || placed.some((o) => c in sheet.vals[o.row]) ||
      Object.keys(sheet.vals).some((r) => c in sheet.vals[r]);
    // Is column c already this app test? (same HPS and the scores agree)
    const sameAs = (c, a) => {
      if (sheet.hps[c] !== hpsOf[a.id]) return false;
      let both = 0, agree = 0;
      placed.forEach((o) => { const x = sheet.vals[o.row][c], y = appScore(o.s.user, a);
        if (isNum(x) && y !== null) { both++; if (x === y) agree++; } });
      return both > 0 && agree / both >= 0.8;
    };
    const ov = (state.colOverride = state.colOverride || {})[termNo] = (state.colOverride[termNo] || {});
    const cols = [];
    const taken = new Set();
    const groups = [['WW', A.ww], ['PT', A.pt], ['EX', A.ex]];
    groups.forEach(([comp, list]) => list.forEach((a, k) => {
      const c = { ...a, comp, isPt: comp === 'PT', given: !!givenSet[a.key] };
      c.hps = c.given ? hpsOf[a.id] : null;
      if (comp === 'EX') c.col = L.term[a.key];
      cols.push(c);
    }));
    // fixed exam columns first, then manual picks, then auto-detected, then the next free column
    cols.filter((c) => c.comp === 'EX').forEach((c) => taken.add(c.col));
    cols.filter((c) => c.comp !== 'EX' && c.given && ov[c.key]).forEach((c) => { if (ov[c.key] !== 'skip') { c.col = ov[c.key]; taken.add(c.col); } else c.skip = true; });
    cols.filter((c) => c.comp !== 'EX' && c.given && !c.col && !c.skip).forEach((c) => {
      const hit = COMP[c.comp].find((col) => !taken.has(col) && sameAs(col, c));
      if (hit) { c.col = hit; c.detected = true; taken.add(hit); }
    });
    cols.filter((c) => c.comp !== 'EX' && c.given && !c.col && !c.skip).forEach((c) => {
      const free = COMP[c.comp].find((col) => !taken.has(col) && !occupied(col));
      if (free) { c.col = free; taken.add(free); } else { c.skip = true; warnings.push(`Wala nang bakanteng ${c.comp} column para sa ${c.label}.`); }
    });
    cols.forEach((c) => {
      if (!c.given || c.skip || !c.col) { c.write = false; return; }
      c.write = true;
      c.detected = c.detected || (c.comp === 'EX' ? sameAs(c.col, c) : sameAs(c.col, c));
      c.overwrites = !c.detected && occupied(c.col);
      if (c.overwrites) warnings.push(`May laman na ang column ${c.col} (${c.comp}${sheet.hps[c.col] ? ', HPS ' + sheet.hps[c.col] : ''}) na iba sa ${c.label} ng app — papalitan ito. Kung hindi ito ang gusto mo, pumili ng ibang column sa itaas ng table.`);
    });
    const used4 = cols.filter((c) => c.write);
    // other things already in the sheet that the app does not know about
    const extra = ALLCOLS.filter((col) => (col in sheet.hps) && !used4.some((c) => c.col === col));

    // ---- values ----
    const scoreCell = (u, c, existing) => {
      const v = appScore(u, c);
      if (v === null) return isNum(existing) ? undefined : (zeroMissing ? 0 : undefined); // keep what the teacher typed
      return Math.min(v, c.hps || v);
    };
    const rows = [];
    placed.forEach(({ s, row }) => {
      const before = sheet.vals[row] || {};
      const after = { ...before };
      const values = used4.map((c) => { const v = scoreCell(s.user, c, before[c.col]); if (v !== undefined) after[c.col] = v; return v; });
      const hpsAfter = { ...sheet.hps }; used4.forEach((c) => { hpsAfter[c.col] = c.hps; });
      const t = Transmutation.computeTermGrade(pctsOf(s.user), givenSet);
      const app = { final: t.final && !t.final.insufficient ? t.final.transmuted : (t.partialTransmuted == null ? null : t.partialTransmuted),
        complete: !!(t.final && !t.final.insufficient) };
      const ecr = ecrGrade(hpsAfter, after, sheet.weights);
      rows.push({ sx: row >= L.term.female ? 'F' : 'M', slot: s, row, user: s.user, values, grade: app, ecr });
    });
    return { subject, section, termNo, cols: used4, allCols: cols, rows, slots, hasNames, noSex, unmatched, unplaced, probable, extra, sheet, warnings };
  }

  /* ============================================================
     Render
     ============================================================ */
  function renderInfo() {
    const i = state.info;
    const named = i.learners.M.filter((x) => x.name).length + i.learners.F.filter((x) => x.name).length;
    $('ecr-info').innerHTML = `
      <div class="ecr-facts">
        <div><span>Subject sa ECR</span><b>${esc(i.subjectText || '—')}</b></div>
        <div><span>Section</span><b>${esc(i.section || '—')}</b></div>
        <div><span>Teacher</span><b>${esc(i.teacher || '—')}</b></div>
        <div><span>Term</span><b>${esc(i.block || '—')} (${i.terms} term)</b></div>
        <div><span>Learners sa ECR</span><b>${named ? named + ' na pangalan' : 'Blangko — pupunuin mula sa app'}</b></div>
      </div>`;
  }

  function colOptions(p, c) {
    const sh = p.sheet;
    const opts = COMP[c.comp].map((col, k) => {
      const busy = (col in sh.hps) ? `may laman, HPS ${sh.hps[col]}` : 'bakante';
      return `<option value="${col}"${c.col === col ? ' selected' : ''}>${c.comp} ${k + 1} (${col}) — ${busy}</option>`;
    }).join('');
    return `<select class="colpick" data-key="${esc(c.key)}"><option value="skip"${c.skip ? ' selected' : ''}>Huwag isama</option>${opts}</select>`;
  }

  function renderPlan() {
    const p = state.plan = buildPlan();
    const cols = p.cols;
    const head = cols.map((c) => `<th title="${esc(c.comp)} · ${esc(c.col)}">${esc(c.label)}<br><small>${esc(c.col)} · HPS ${c.hps}${c.detected ? ' · nasa ECR na' : ''}</small></th>`).join('');
    const body = p.rows.map((r) => {
      const diff = r.ecr && r.grade.final !== null && r.grade.complete && r.ecr.tg !== r.grade.final;
      return `<tr>
        <td class="n">${r.sx === 'M' ? '♂' : '♀'} ${r.slot.slot + 1}</td>
        <td>${esc(r.slot.name || ecrName(r.user))}${r.slot.isNew ? ' <span class="tag">bago</span>' : ''}${r.slot.manual ? ' <span class="tag">pinili mo</span>' : ''}${r.slot.name && !r.slot.isNew && norm(r.slot.name) !== norm(ecrName(r.user)) ? `<br><small class="muted">app: ${esc(ecrName(r.user))}</small>` : ''}</td>
        ${r.values.map((v) => `<td class="n">${v === undefined ? '<span class="muted" title="Hindi gagalawin">·</span>' : esc(v)}</td>`).join('')}
        <td class="n">${r.grade.final === null ? '—' : esc(r.grade.final)}${r.grade.complete ? '' : '<sup title="Projection: may hindi pa naibigay">*</sup>'}</td>
        <td class="n"><b${diff ? ' style="color:#c62828;"' : ''}>${r.ecr ? esc(r.ecr.tg) : '—'}</b>${r.ecr ? `<br><small class="muted">${r.ecr.ig.toFixed(2)}</small>` : ''}</td>
      </tr>`; }).join('');
    const sexPick = p.noSex.map((u) => `<label class="sexpick">${esc(ecrName(u))}
        <select data-lrn="${esc(u.lrn)}"><option value="">—</option><option value="M">Male</option><option value="F">Female</option></select></label>`).join('');
    const pool = p.unplaced.concat(p.rows.filter((r) => r.slot.manual).map((r) => r.user)).sort((a, b) => (p.probable.has(b.lrn) - p.probable.has(a.lrn)) || ecrName(a).localeCompare(ecrName(b)));
    const pairPick = p.unmatched.map(({ s, sx, i }) => `<label class="sexpick">${sx === 'M' ? '♂' : '♀'} ${esc(s.name || s.lrn)}
        <select data-slot="${sx}${i}"><option value="">— walang katugma —</option><option value="-">Hindi ito estudyante sa app</option>${pool.map((u) => `<option value="${esc(u.lrn)}"${state.manualMatch && state.manualMatch[sx + i] === u.lrn ? ' selected' : ''}>${esc(ecrName(u))}${p.probable.has(u.lrn) && norm(String(s.name).split(',')[0]) === norm(u.lastName) ? ' (posible)' : ''}</option>`).join('')}</select></label>`).join('');
    const picks = p.allCols.filter((c) => c.comp !== 'EX' && c.given).map((c) => `<label class="sexpick"><span>${esc(c.label)} <small class="muted">HPS ${c.hps}</small></span>${colOptions(p, c)}</label>`).join('');
    const notGiven = p.allCols.filter((c) => !c.given).map((c) => c.label);
    const extra = p.extra.map((c) => `${c} (HPS ${p.sheet.hps[c]})`);
    const anyDiff = p.rows.some((r) => r.ecr && r.grade.complete && r.grade.final !== null && r.ecr.tg !== r.grade.final);
    $('ecr-plan').innerHTML = `
      ${p.warnings.map((w) => `<div class="alert alert-warning">⚠️ ${esc(w)}</div>`).join('')}
      ${sexPick ? `<div class="card" style="padding:12px;"><b>Sex ng mga estudyanteng ito:</b><div class="sexgrid">${sexPick}</div></div>` : ''}
      ${pairPick && !pool.length ? `<div class="alert alert-warning">⚠️ ${p.unmatched.length} pangalan sa ECR ang walang katugma sa app (walang estudyante sa napiling section na puwedeng ipares). Hindi gagalawin ang row nila. Tingnan kung tama ang Section sa itaas.</div>` : ''}
      ${pairPick && pool.length ? `<div class="card" style="padding:12px;"><b>${p.unmatched.length} pangalan sa ECR ang walang awtomatikong katugma sa app.</b> Piliin kung sino sila (o iwan kung wala talaga sa app; hindi gagalawin ang row nila):<div class="sexgrid">${pairPick}</div></div>` : ''}
      ${picks ? `<div class="card" style="padding:12px;"><b>Saang column ilalagay?</b> <span class="text-small text-muted">Awtomatiko itong pinili: kung nasa ECR na ang test (pareho ang HPS at scores), doon din; kung wala pa, sa susunod na bakanteng column.</span><div class="sexgrid">${picks}</div></div>` : ''}
      <p class="text-small text-muted">Ilalagay sa sheet na <b>Term ${p.termNo}</b>: ${p.rows.length} estudyante.
        ${notGiven.length ? `Hindi pa naibigay (hindi isasama): ${esc(notGiven.join(', '))}.` : ''}
        ${extra.length ? `Mga score na nasa ECR na hindi galing sa app (hindi gagalawin, pero kasama sa grade): ${esc(extra.join(', '))}.` : ''}
        Ang <b>·</b> ay hindi gagalawin.</p>
      ${anyDiff ? '<p class="text-small" style="color:#c62828;">Pula = iba ang grade sa ECR sa grade sa app, kadalasan dahil may ibang scores sa ECR na wala sa app.</p>' : ''}
      <div style="overflow:auto;"><table class="ecr-table"><thead><tr><th>#</th><th>Learner (sa ECR)</th>${head}<th>Grade<br><small>app</small></th><th>Grade<br><small>sa ECR</small></th></tr></thead><tbody>${body || `<tr><td colspan="${cols.length + 4}" class="muted">Walang estudyanteng tugma.</td></tr>`}</tbody></table></div>`;
    $('ecr-plan').querySelectorAll('select[data-lrn]').forEach((sel) => sel.addEventListener('change', () => {
      state.sexOverride = state.sexOverride || {};
      state.sexOverride[sel.dataset.lrn] = sel.value;
      renderPlan();
    }));
    $('ecr-plan').querySelectorAll('select[data-slot]').forEach((sel) => sel.addEventListener('change', () => {
      state.manualMatch = state.manualMatch || {};
      state.manualMatch[sel.dataset.slot] = sel.value;
      renderPlan();
    }));
    $('ecr-plan').querySelectorAll('select.colpick').forEach((sel) => sel.addEventListener('change', () => {
      const ov = state.colOverride[p.termNo];
      // a column can hold one test only
      Object.keys(ov).forEach((k) => { if (k !== sel.dataset.key && ov[k] === sel.value) delete ov[k]; });
      ov[sel.dataset.key] = sel.value;
      renderPlan();
    }));
    $('ecr-download').disabled = !p.rows.length;
  }

  /* ============================================================
     Write + download
     ============================================================ */
  async function download() {
    const p = state.plan; const btn = $('ecr-download');
    btn.disabled = true; btn.textContent = '⏳ Ginagawa...';
    try {
      // Re-open the original file so repeated downloads start clean.
      const info = await readTemplate(state.file);
      const wb = info.wb;
      const inp = await wb.sheet('INPUT DATA');
      const I = L.input;
      // Term setting so the chosen Term sheet is the valid one
      if (info.terms === 1 && TERM_BLOCKS[p.termNo - 1] !== info.block) inp.set(I.block, TERM_BLOCKS[p.termNo - 1]);
      // Learners added by the app
      ['M', 'F'].forEach((sx) => p.slots[sx].forEach((s, i) => {
        if (!s.user || !s.isNew) return;
        const r = I.first + i;
        inp.set((sx === 'M' ? I.maleLrn : I.femaleLrn) + r, String(s.user.lrn));
        inp.set((sx === 'M' ? I.maleName : I.femaleName) + r, ecrName(s.user));
      }));
      const term = await wb.sheet('Term ' + p.termNo);
      p.cols.forEach((c) => term.set(c.col + L.term.hps, c.hps));
      p.rows.forEach((r) => p.cols.forEach((c, k) => { if (r.values[k] !== undefined) term.set(c.col + r.row, r.values[k]); }));
      const blob = await wb.save();
      const a = document.createElement('a');
      const base = (state.file.name || 'ECR.xlsx').replace(/\.xlsx$/i, '');
      a.href = URL.createObjectURL(blob);
      a.download = `${base} - filled ${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      $('ecr-status').innerHTML = `<div class="alert alert-success">✅ Na-download na. Buksan sa Excel at i-check ang Term ${p.termNo} at FINAL GRADES. Kapag lumabas ang "Enable Editing", pindutin ito para mag-compute ang grades. (Sa WPS o LibreOffice: pindutin ang Ctrl+Shift+F9 para mag-recalculate.)</div>`;
    } catch (e) {
      $('ecr-status').innerHTML = `<div class="alert alert-danger">❌ ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = '⬇️ I-download ang napunang ECR';
    }
  }

  /* ============================================================
     Wire up
     ============================================================ */
  function fillSections() {
    const sel = $('ecr-section'); const cur = sel.value;
    const secs = Array.from(new Set(CLOUD.map((u) => u.section).filter(Boolean).concat(CONFIG.SECTIONS || []))).sort();
    sel.innerHTML = '<option value="">Lahat ng section</option>' + secs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (cur && secs.includes(cur)) sel.value = cur;
  }

  async function onFile(file) {
    if (!file) return;
    $('ecr-status').innerHTML = '';
    $('ecr-plan').innerHTML = '<p class="text-muted">Binabasa ang ECR...</p>';
    try {
      state.file = file;
      state.info = await readTemplate(file);
      state.sexOverride = {}; state.manualMatch = {}; state.colOverride = {};
      $('ecr-term').value = String(state.info.termNo);
      const sec = Array.from($('ecr-section').options).find((o) => o.value && norm(o.value) === norm(state.info.section));
      if (sec) $('ecr-section').value = sec.value;
      renderInfo();
      $('ecr-step2').style.display = '';
      renderPlan();
    } catch (e) {
      state.info = null;
      $('ecr-step2').style.display = 'none';
      $('ecr-plan').innerHTML = `<div class="alert alert-danger">❌ ${esc(e.message)}</div>`;
    }
  }

  async function loadCloud() {
    const st = $('ecr-cloud');
    try {
      st.textContent = '⏳ Kinukuha ang scores ng klase mula sa cloud…';
      CLOUD = await TeacherCloud.fetchStudents();
      st.textContent = '✅ ' + CLOUD.length + ' estudyante ang na-load mula sa cloud.';
      fillSections();
      if (state.info) renderPlan();
    } catch (e) {
      st.innerHTML = '<span style="color:#c62828;">⚠️ ' + esc(e.message) + '</span>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    fillSections();
    if (window.TeacherAuthBoot) {
      TeacherAuthBoot.ready((auth) => {
        if (!auth.isAuthenticated()) { window.location.replace('../teacher-login.html'); return; }
        const lo = document.getElementById('btn-logout'); if (lo) lo.addEventListener('click', () => auth.logout());
        loadCloud();
      });
    } else { loadCloud(); }
    $('ecr-file').addEventListener('change', (e) => onFile(e.target.files[0]));
    ['ecr-section', 'ecr-term', 'ecr-add-missing', 'ecr-zero-missing'].forEach((id) =>
      $(id).addEventListener('change', () => { if (state.info) renderPlan(); }));
    $('ecr-download').addEventListener('click', download);
  });

  window.DepEdECR = { openWorkbook, readTemplate, buildPlan, ecrGrade, _state: state };
})();

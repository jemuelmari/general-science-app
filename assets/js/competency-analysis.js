/* ============================================================
   competency-analysis.js — shared item / competency analytics
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   Used by: Item Analysis, TOS Generator (Most & Least Learned,
   Term Exam basis) and Class Record (MLL tab).

   Item → competency mapping (in this order):
     1. itemResult.competency           (saved at exam time)
     2. bank question with the same questionId
     3. NEVER the shuffled position (`index`) and never the old
        `originalIndex` of legacy records (it was the shown position).

   Students are TeacherCloud.fetchStudents() objects (progress.scores
   already merged with PT grades and teacher overrides). Records that
   came from a paper override have no itemResults and are skipped for
   item/competency statistics (their scores still count in grades).
   ============================================================ */

const CompetencyAnalysis = (() => {
  'use strict';

  const ASSESSMENTS = ['quiz1', 'quiz2', 'quiz3', 'st1', 'st2', 'te'];
  let _comp = null;
  const _banks = {};

  function _base() {
    // Works from /, /teacher/, /classrecord/ (GitHub Pages sub-path safe)
    const p = window.location.pathname;
    const m = p.match(/^(.*?\/)(teacher|classrecord|student)\//);
    if (m) return m[1];
    return p.substring(0, p.lastIndexOf('/') + 1);
  }

  async function _json(rel) {
    const res = await fetch(_base() + rel + '?v=' + ((typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '1'));
    if (!res.ok) throw new Error('Could not load ' + rel + ' (HTTP ' + res.status + ')');
    return res.json();
  }

  async function loadCompetencies() {
    if (_comp) return _comp;
    const d = await _json('data/competencies.json');
    const map = {};
    ['term1', 'term2', 'term3'].forEach(t => ((d[t] && d[t].competencies) || []).forEach(c => {
      map[c.code] = { code: c.code, term: t, description: c.description || '', shortLabel: c.shortLabel || '', weeks: c.weeks || [] };
    }));
    _comp = { raw: d, byCode: map };
    return _comp;
  }

  async function loadBank(term, id) {
    const k = term + '/' + id;
    if (!_banks[k]) _banks[k] = _json('student/' + term + '/assessments/' + id + '.json');
    return _banks[k];
  }

  function _record(student, term, id) {
    const scores = (student.progress && student.progress.scores) || {};
    if (typeof TeacherCloud !== 'undefined' && TeacherCloud.getRecord) return TeacherCloud.getRecord(scores, term, id);
    const t = scores[term] || {};
    if (id === 'te') return (t.te && t.te.te) || t.te || null;
    const b = /^quiz/.test(id) ? 'quizzes' : 'st';
    return (t[b] || {})[id] || null;
  }

  function _bankIndex(bank) {
    const byId = {};
    (bank.questions || []).forEach((q, i) => { byId[String(q.id)] = { q: q, i: i }; });
    return byId;
  }

  /** Map one itemResult to { q, bankIndex, competency } or null. */
  function resolveItem(r, byId) {
    const hit = r && r.questionId != null ? byId[String(r.questionId)] : null;
    const comp = (r && r.competency) || (hit && hit.q.competency) || null;
    return { q: hit ? hit.q : null, bankIndex: hit ? hit.i : -1, competency: comp };
  }

  /**
   * Per-competency MPS from the chosen assessments of one term.
   * Returns only competencies that have data, each with code, description,
   * shortLabel, correct, total (item responses), mps (0-100), students.
   */
  async function competencyMPS(students, term, ids) {
    ids = ids || ['st1', 'st2'];
    const comp = await loadCompetencies();
    const agg = {};
    for (const id of ids) {
      let bank;
      try { bank = await loadBank(term, id); } catch (e) { continue; }
      const byId = _bankIndex(bank);
      students.forEach(s => {
        const rec = _record(s, term, id);
        if (!rec || !Array.isArray(rec.itemResults) || !rec.itemResults.length) return;
        const seen = {};
        rec.itemResults.forEach(r => {
          const it = resolveItem(r, byId);
          if (!it.competency) return;
          const a = agg[it.competency] = agg[it.competency] || { correct: 0, total: 0, students: {} };
          a.total++;
          if (r.correct === true || (r.given != null && r.given === r.expected)) a.correct++;
          seen[it.competency] = 1;
        });
        Object.keys(seen).forEach(c => { agg[c].students[s.lrn] = 1; });
      });
    }
    return Object.keys(agg).filter(c => agg[c].total > 0).map(code => {
      const c = comp.byCode[code] || {};
      return {
        code: code, description: c.description || code, shortLabel: c.shortLabel || '', weeks: c.weeks || [],
        correct: agg[code].correct, total: agg[code].total,
        mps: Math.round(agg[code].correct / agg[code].total * 1000) / 10,
        students: Object.keys(agg[code].students).length
      };
    });
  }

  /**
   * Top-n least and most learned, never the same competency in both lists.
   * Least learned is filled first (it is the Term Exam basis).
   */
  function mostLeast(list, n) {
    n = n || 5;
    const asc = list.slice().sort((a, b) => a.mps - b.mps || a.code.localeCompare(b.code));
    const least = asc.slice(0, Math.min(n, asc.length));
    const used = {}; least.forEach(x => { used[x.code] = 1; });
    const most = asc.slice().reverse().filter(x => !used[x.code]).slice(0, n);
    return { least: least, most: most, available: list.length };
  }

  /**
   * Full item analysis for one assessment.
   * Returns { items:[...], competencies:[...], students:n, summary }
   * Item stats: difficulty p (0-1), discrimination D (upper/lower 27%),
   * option counts (distractor analysis), MPS.
   */
  async function itemAnalysis(students, term, id, opts) {
    opts = opts || {};
    const bank = await loadBank(term, id);
    const comp = await loadCompetencies();
    const byId = _bankIndex(bank);
    const qs = bank.questions || [];
    const items = qs.map((q, i) => ({
      no: i + 1, id: q.id, text: q.text, correctText: q.correct, options: q.options || [],
      competency: q.competency || '', bloomLevel: q.bloomLevel || '',
      correct: 0, total: 0, optionCounts: {}, blank: 0, _resp: []
    }));

    const takers = [];
    students.forEach(s => {
      if (opts.section && s.section !== opts.section) return;
      const rec = _record(s, term, id);
      if (!rec || !Array.isArray(rec.itemResults) || !rec.itemResults.length) return;
      if (opts.setLetter && rec.set && rec.set !== opts.setLetter) return;
      const resp = {};
      rec.itemResults.forEach(r => {
        const it = resolveItem(r, byId);
        if (it.bankIndex < 0) return;
        resp[it.bankIndex] = { correct: r.correct === true || (r.given != null && r.given === r.expected), given: r.given };
      });
      const score = Object.keys(resp).filter(k => resp[k].correct).length;
      takers.push({ lrn: s.lrn, score: score, resp: resp });
    });

    takers.forEach(t => Object.keys(t.resp).forEach(k => {
      const it = items[k]; const r = t.resp[k];
      it.total++;
      if (r.correct) it.correct++;
      if (r.given == null || r.given === '') it.blank++;
      else it.optionCounts[r.given] = (it.optionCounts[r.given] || 0) + 1;
    }));

    // Discrimination: upper 27% vs lower 27% by score on this assessment
    const sorted = takers.slice().sort((a, b) => b.score - a.score);
    const g = Math.max(1, Math.round(sorted.length * 0.27));
    const upper = sorted.slice(0, g), lower = sorted.slice(-g);

    items.forEach((it, k) => {
      it.p = it.total ? it.correct / it.total : null;
      it.mps = it.p == null ? null : Math.round(it.p * 1000) / 10;
      const uc = upper.filter(t => t.resp[k] && t.resp[k].correct).length;
      const lc = lower.filter(t => t.resp[k] && t.resp[k].correct).length;
      it.D = sorted.length >= 4 ? (uc - lc) / g : null;
      it.difficultyLabel = it.p == null ? 'No data' : it.p > 0.80 ? 'Easy' : it.p < 0.20 ? 'Difficult' : 'Average';
      it.discriminationLabel = it.D == null ? 'Too few takers' : it.D < 0 ? 'Negative — revise' : it.D < 0.20 ? 'Poor' : it.D < 0.30 ? 'Fair' : it.D < 0.40 ? 'Good' : 'Very good';
      // A distractor nobody picked does not work
      const wrong = it.options.filter(o => o !== it.correctText);
      it.nonFunctioning = it.total >= 10 ? wrong.filter(o => !it.optionCounts[o]) : [];
      it.decision = it.p == null ? '' : (it.D != null && it.D < 0) ? 'Reject / rewrite' :
        (it.D != null && it.D < 0.20) || it.p < 0.20 || it.p > 0.90 ? 'Revise' : 'Retain';
      const c = comp.byCode[it.competency] || {};
      it.competencyText = c.description || it.competency;
      it.shortLabel = c.shortLabel || '';
      delete it._resp;
    });

    // Per competency
    const byC = {};
    items.forEach(it => {
      if (!it.competency) return;
      const a = byC[it.competency] = byC[it.competency] || { code: it.competency, description: it.competencyText, shortLabel: it.shortLabel, itemNos: [], correct: 0, total: 0 };
      a.itemNos.push(it.no); a.correct += it.correct; a.total += it.total;
    });
    const competencies = Object.keys(byC).map(k => {
      const a = byC[k]; a.mps = a.total ? Math.round(a.correct / a.total * 1000) / 10 : null; return a;
    });

    const allC = items.reduce((s, i) => s + i.correct, 0), allT = items.reduce((s, i) => s + i.total, 0);
    return {
      term: term, assessment: id, title: bank.title || id, items: items, competencies: competencies,
      students: takers.length,
      summary: { mps: allT ? Math.round(allC / allT * 1000) / 10 : null, items: items.length }
    };
  }

  function mpsLevel(mps) {
    if (typeof Transmutation !== 'undefined' && Transmutation.proficiencyLevel) return Transmutation.proficiencyLevel(mps).level;
    return '';
  }

  return { loadCompetencies, loadBank, competencyMPS, mostLeast, itemAnalysis, resolveItem, mpsLevel, ASSESSMENTS };
})();

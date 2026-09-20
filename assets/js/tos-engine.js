/* ============================================================
   tos-engine.js — Table of Specification computation engine
   Version: 1.1.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.1.0 (Phase 2.5 / X43 fix):
     - Added getRepoBase() helper that computes the repo root
       path dynamically from the config.js script tag URL.
     - loadCompetencies() and loadQuestionBank() now use
       ${base} prefix so paths resolve correctly from ANY page
       depth (root, /teacher/, /classrecord/, /student/term1/week1/).
     - Fetch error messages now include the fully-resolved URL
       for easier debugging.
     - Added fallback path chain when detection fails.

   Responsibilities:
     1. Load data/competencies.json
     2. Determine covered competencies per assessment
        - ST1  → weeks 1-4
        - ST2  → weeks 5-8
        - TE   → Top 5 Least Learned (ST1+ST2) + Weeks 9-10
     3. Compute hours, weight %, item count per competency
     4. Distribute items across Bloom's levels (30% LOTS / 70% HOTS)
     5. Assign item numbers sequentially
     6. Read the question bank (Q1–3, ST1–2, TE) for the answer key
     7. Generate the "Most & Least Learned Competencies" table

   All outputs are plain JS objects; the page (tos-generator.html)
   handles rendering.
   ============================================================ */

const TOSEngine = (() => {
  'use strict';

  const BLOOMS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
  const LOTS = ['Remembering', 'Understanding'];
  const HOTS = ['Applying', 'Analyzing', 'Evaluating', 'Creating'];

  const LOTS_RATIO = 0.30;
  const HOTS_RATIO = 0.70;

  let _compData = null;
  let _repoBase = null;  // cached repo-base path

  /* ============================================================
     REPO BASE DETECTION
     ------------------------------------------------------------
     ⚠️ FIX (X43): Computes the repo root path dynamically.

     Strategy:
       1. Look for a <script src="...config.js..."> tag. config.js
          lives at the repo root, so stripping "config.js" gives
          the base path.
       2. If config.js not found, try <script src="...app.js...">.
       3. If neither works, fall back to a heuristic: count path
          segments and prepend "../" the appropriate number of times.
   ============================================================ */
  function getRepoBase() {
    if (_repoBase !== null) return _repoBase;

    // Strategy 1: find script tag containing "config.js"
    const scripts = document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('config.js') !== -1) {
        // Strip "config.js" and any query string
        _repoBase = src.replace(/config\.js(\?.*)?$/, '');
        return _repoBase;
      }
    }

    // Strategy 2: find script tag containing "app.js"
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src') || '';
      const m = src.match(/^(.*?)assets\/js\/app\.js/);
      if (m) {
        _repoBase = m[1];
        return _repoBase;
      }
    }

    // Strategy 3: heuristic — use depth of current pathname
    // Assume pages live at most 3 levels deep from repo root
    // (e.g., /student/term1/week1/index.html = 3 levels)
    const path = window.location.pathname;
    const repoMatch = path.match(/^(.*?\/general-science-app\/)/i);
    if (repoMatch) {
      // Use absolute-ish relative base computed from current dir
      const depthMatch = path.replace(repoMatch[1], '').split('/');
      const depth = Math.max(0, depthMatch.length - 1);
      _repoBase = '../'.repeat(depth) || './';
      return _repoBase;
    }

    // Final fallback — assume one level up (works from /teacher/*.html)
    console.warn('[TOSEngine] Could not detect repo base — using ../ fallback');
    _repoBase = '../';
    return _repoBase;
  }

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadCompetencies() {
    if (_compData) return _compData;

    const base = getRepoBase();
    const candidates = [
      base + 'data/competencies.json',
      // Fallback candidates in case base detection is off
      '../data/competencies.json',
      '../../data/competencies.json',
      './data/competencies.json',
      'data/competencies.json'
    ];

    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i] + '?ts=' + Date.now();
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status + ' for ' + candidates[i]);
          continue;
        }
        _compData = await res.json();
        console.log('[TOSEngine] Loaded competencies from: ' + candidates[i]);
        return _compData;
      } catch (e) {
        lastErr = e;
        // Continue to next candidate
      }
    }

    // All failed
    const triedList = candidates.join(', ');
    const msg = 'Failed to load competencies.json. Tried: ' + triedList +
                (lastErr ? ' (last error: ' + lastErr.message + ')' : '');
    console.error('[TOSEngine]', msg);
    throw new Error(msg);
  }

  async function loadQuestionBank(term, assessment) {
    // assessment is one of: quiz1, quiz2, quiz3, st1, st2, te
    const base = getRepoBase();
    const candidates = [
      base + 'student/' + term + '/assessments/' + assessment + '.json',
      '../student/' + term + '/assessments/' + assessment + '.json',
      '../../student/' + term + '/assessments/' + assessment + '.json',
      './student/' + term + '/assessments/' + assessment + '.json'
    ];

    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i] + '?ts=' + Date.now();
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status + ' for ' + candidates[i]);
          continue;
        }
        const data = await res.json();
        console.log('[TOSEngine] Loaded ' + assessment + ' from: ' + candidates[i]);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }

    const triedList = candidates.join(', ');
    const msg = 'Failed to load ' + assessment + '.json. Tried: ' + triedList +
                (lastErr ? ' (last error: ' + lastErr.message + ')' : '');
    console.error('[TOSEngine]', msg);
    throw new Error(msg);
  }

  /* ============================================================
     COMPETENCY SELECTION
     ============================================================ */
  function getCompetenciesForST1(termData) {
    return termData.competencies.filter((c) =>
      c.weeks.some((w) => w >= 1 && w <= 4)
    );
  }

  function getCompetenciesForST2(termData) {
    return termData.competencies.filter((c) =>
      c.weeks.some((w) => w >= 5 && w <= 8)
    );
  }

  /**
   * Determine TE competencies:
   *   = Top 5 Least Learned (from ST1+ST2 combined)
   *   + Weeks 9-10 competencies not already in Top 5
   */
  function getCompetenciesForTE(termData, stRanking) {
    const weeks910 = termData.competencies.filter((c) =>
      c.weeks.some((w) => w >= 9 && w <= 10)
    );

    const stCodes = new Set([
      ...getCompetenciesForST1(termData).map((c) => c.code),
      ...getCompetenciesForST2(termData).map((c) => c.code)
    ]);

    const top5Least = (stRanking || [])
      .filter((r) => stCodes.has(r.code))
      .slice(0, 5)
      .map((r) => termData.competencies.find((c) => c.code === r.code))
      .filter(Boolean);

    const merged = [...top5Least];
    const seen = new Set(top5Least.map((c) => c.code));
    weeks910.forEach((c) => {
      if (!seen.has(c.code)) {
        merged.push(c);
        seen.add(c.code);
      }
    });

    return merged;
  }

  /* ============================================================
     WEIGHT + ITEM COUNT COMPUTATION
     ============================================================ */
  function computeWeights(competencies, totalItems) {
    const totalHours = competencies.reduce((sum, c) => sum + (c.hours || 0), 0);
    if (totalHours === 0) throw new Error('Total hours is zero — cannot compute weights.');

    const rows = competencies.map((c) => {
      const weight = (c.hours / totalHours) * 100;
      const rawItems = (weight / 100) * totalItems;
      const items = Math.round(rawItems);
      return {
        code: c.code,
        description: c.description,
        shortLabel: c.shortLabel,
        hours: c.hours,
        weeks: c.weeks,
        bloomLevels: c.bloomLevels,
        termExamPriority: c.termExamPriority,
        weightPercent: Math.round(weight * 100) / 100,
        rawItems: rawItems,
        items: items
      };
    });

    let sum = rows.reduce((s, r) => s + r.items, 0);
    const diff = totalItems - sum;

    if (diff !== 0) {
      const withRemainder = rows.map((r) => ({
        row: r,
        remainder: r.rawItems - Math.floor(r.rawItems)
      }));

      if (diff > 0) {
        withRemainder
          .sort((a, b) => b.remainder - a.remainder)
          .slice(0, diff)
          .forEach((x) => x.row.items++);
      } else {
        withRemainder
          .sort((a, b) => a.remainder - b.remainder)
          .filter((x) => x.row.items > 1)
          .slice(0, Math.abs(diff))
          .forEach((x) => x.row.items--);
      }
    }

    return rows;
  }

  /* ============================================================
     BLOOM'S DISTRIBUTION
     ============================================================ */
  function distributeBlooms(rows) {
    return rows.map((row) => {
      const items = row.items;
      const allowed = row.bloomLevels && row.bloomLevels.length
        ? row.bloomLevels
        : BLOOMS;

      const allowedLOTS = LOTS.filter((l) => allowed.indexOf(l) !== -1);
      const allowedHOTS = HOTS.filter((l) => allowed.indexOf(l) !== -1);

      let lotsTarget, hotsTarget;
      if (allowedLOTS.length === 0) {
        lotsTarget = 0;
        hotsTarget = items;
      } else if (allowedHOTS.length === 0) {
        lotsTarget = items;
        hotsTarget = 0;
      } else {
        lotsTarget = Math.round(items * LOTS_RATIO);
        hotsTarget = items - lotsTarget;
      }

      const distribution = {};
      BLOOMS.forEach((b) => { distribution[b] = 0; });

      // LOTS spread
      const lotsBase = allowedLOTS.length > 0 ? Math.floor(lotsTarget / allowedLOTS.length) : 0;
      let lotsRemaining = lotsTarget - (lotsBase * allowedLOTS.length);
      allowedLOTS.forEach((lvl) => { distribution[lvl] = lotsBase; });
      for (let i = 0; i < lotsRemaining; i++) {
        distribution[allowedLOTS[i % allowedLOTS.length]]++;
      }

      // HOTS spread
      const hotsBase = allowedHOTS.length > 0 ? Math.floor(hotsTarget / allowedHOTS.length) : 0;
      let hotsRemaining = hotsTarget - (hotsBase * allowedHOTS.length);
      allowedHOTS.forEach((lvl) => { distribution[lvl] = hotsBase; });
      for (let i = 0; i < hotsRemaining; i++) {
        distribution[allowedHOTS[i % allowedHOTS.length]]++;
      }

      return {
        ...row,
        bloomDistribution: distribution,
        lotsCount: lotsTarget,
        hotsCount: hotsTarget
      };
    });
  }

  /* ============================================================
     ITEM NUMBER ASSIGNMENT
     ============================================================ */
  function assignItemNumbers(rows) {
    let next = 1;
    return rows.map((row) => {
      const from = next;
      const to = next + row.items - 1;
      next = to + 1;
      return { ...row, itemFrom: from, itemTo: to };
    });
  }

  /* ============================================================
     ANSWER KEY GENERATION
     ============================================================ */
  function buildAnswerKey(rows, questionBank) {
    const key = [];
    const questions = questionBank.questions || [];

    rows.forEach((row) => {
      const startIdx = row.itemFrom - 1;
      const endIdx = row.itemTo;
      for (let i = startIdx; i < endIdx && i < questions.length; i++) {
        const q = questions[i] || {};
        key.push({
          itemNo: i + 1,
          answer: q.correct || '—',
          options: q.options || [],
          competency: row.code,
          shortLabel: row.shortLabel,
          bloomLevel: q.bloomLevel || row.bloomLevels[0] || 'Understanding'
        });
      }
    });

    return key;
  }

  /* ============================================================
     AGGREGATE STATS
     ============================================================ */
  function computeTotals(rows) {
    const totals = {
      hours: 0,
      weightPercent: 0,
      items: 0,
      blooms: {}
    };
    BLOOMS.forEach((b) => { totals.blooms[b] = 0; });

    rows.forEach((r) => {
      totals.hours += r.hours;
      totals.weightPercent += r.weightPercent;
      totals.items += r.items;
      BLOOMS.forEach((b) => {
        totals.blooms[b] += (r.bloomDistribution[b] || 0);
      });
    });

    totals.weightPercent = Math.round(totals.weightPercent * 100) / 100;
    totals.lotsCount = totals.blooms.Remembering + totals.blooms.Understanding;
    totals.hotsCount = totals.items - totals.lotsCount;
    totals.lotsPercent = totals.items ? Math.round((totals.lotsCount / totals.items) * 100) : 0;
    totals.hotsPercent = 100 - totals.lotsPercent;

    return totals;
  }

  /* ============================================================
     MOST / LEAST LEARNED RANKING
     ============================================================ */
  function rankByMPS(competencyMPS) {
    return [...competencyMPS].sort((a, b) => a.mps - b.mps);
  }

  function computeCompetencyMPS(students, term, type, assessment) {
    const result = {};
    const questions = assessment.questions || [];

    const byComp = {};
    questions.forEach((q, i) => {
      const code = q.competency || 'UNKNOWN';
      if (!byComp[code]) byComp[code] = [];
      byComp[code].push(i);
    });

    Object.keys(byComp).forEach((code) => {
      result[code] = { correct: 0, total: 0, mps: 0 };
    });

    students.forEach((s) => {
      const scores = Store.getScores(s.lrn);
      const record = type === 'te'
        ? (scores[term] && scores[term].te)
        : (scores[term] && scores[term][type] && scores[term][type][assessment.id]);

      if (!record || !record.itemResults) return;

      record.itemResults.forEach((r) => {
        // ⚠️ Prefer originalIndex when present (Phase 2 X39)
        const idx = (r.originalIndex != null) ? r.originalIndex : r.index;
        const code = (questions[idx] && questions[idx].competency) || 'UNKNOWN';
        if (!result[code]) result[code] = { correct: 0, total: 0, mps: 0 };
        result[code].total++;
        if (r.correct) result[code].correct++;
      });
    });

    Object.keys(result).forEach((code) => {
      const v = result[code];
      v.mps = v.total ? v.correct / v.total : 0;
    });

    return result;
  }

  /* ============================================================
     MAIN ENTRY POINT
     ============================================================ */
  async function generateTOS(opts) {
    const compData = await loadCompetencies();
    const termData = compData[opts.term];
    if (!termData) throw new Error('Unknown term: ' + opts.term);

    let competencies = [];
    let coverage = '';

    if (opts.assessment === 'st1') {
      competencies = getCompetenciesForST1(termData);
      coverage = 'Weeks 1–4';
    } else if (opts.assessment === 'st2') {
      competencies = getCompetenciesForST2(termData);
      coverage = 'Weeks 5–8';
    } else if (opts.assessment === 'te') {
      competencies = getCompetenciesForTE(termData, opts.stRanking || []);
      coverage = 'Top 5 Least Learned (ST1+ST2) + Weeks 9–10';
    } else {
      throw new Error('Unknown assessment: ' + opts.assessment);
    }

    let rows = computeWeights(competencies, opts.totalItems);
    rows = distributeBlooms(rows);
    rows = assignItemNumbers(rows);

    let questionBank = { questions: [] };
    try {
      questionBank = await loadQuestionBank(opts.term, opts.assessment);
    } catch (e) {
      console.warn('[TOSEngine] Question bank not found:', e.message);
    }

    const answerKey = buildAnswerKey(rows, questionBank);
    const totals = computeTotals(rows);

    return {
      term: opts.term,
      termTitle: termData.title,
      assessment: opts.assessment,
      coverage: coverage,
      totalItems: opts.totalItems,
      rows: rows,
      totals: totals,
      answerKey: answerKey
    };
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    getRepoBase,
    loadCompetencies,
    loadQuestionBank,
    getCompetenciesForST1,
    getCompetenciesForST2,
    getCompetenciesForTE,
    computeWeights,
    distributeBlooms,
    assignItemNumbers,
    buildAnswerKey,
    computeTotals,
    rankByMPS,
    computeCompetencyMPS,
    generateTOS
  };
})();

/* ============================================================
   tos-engine.js — Table of Specification computation engine
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
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

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadCompetencies() {
    if (_compData) return _compData;
    const res = await fetch('../../data/competencies.json?ts=' + Date.now());
    if (!res.ok) throw new Error('Failed to load competencies.json (HTTP ' + res.status + ')');
    _compData = await res.json();
    return _compData;
  }

  async function loadQuestionBank(term, assessment) {
    // assessment is one of: quiz1, quiz2, quiz3, st1, st2, te
    const path = `../../student/${term}/assessments/${assessment}.json?ts=${Date.now()}`;
    const res = await fetch(path);
    if (!res.ok) throw new Error('Failed to load ' + assessment + '.json');
    return res.json();
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
   *
   * @param {Object} termData - competencies for the term
   * @param {Array}  stRanking - array of { code, mps } sorted ascending (least → most)
   */
  function getCompetenciesForTE(termData, stRanking) {
    const weeks910 = termData.competencies.filter((c) =>
      c.weeks.some((w) => w >= 9 && w <= 10)
    );

    // Top 5 least learned (from provided ranking, filtered to ST1+ST2 competencies only)
    const stCodes = new Set([
      ...getCompetenciesForST1(termData).map((c) => c.code),
      ...getCompetenciesForST2(termData).map((c) => c.code)
    ]);

    const top5Least = (stRanking || [])
      .filter((r) => stCodes.has(r.code))
      .slice(0, 5)
      .map((r) => termData.competencies.find((c) => c.code === r.code))
      .filter(Boolean);

    // Merge with weeks 9-10, avoiding duplicates
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
  /**
   * Compute hours, weight %, item count per competency.
   * Ensures items sum to totalItems exactly.
   */
  function computeWeights(competencies, totalItems) {
    const totalHours = competencies.reduce((sum, c) => sum + (c.hours || 0), 0);
    if (totalHours === 0) throw new Error('Total hours is zero — cannot compute weights.');

    // Step 1 — provisional item counts using rounding
    const rows = competencies.map((c) => {
      const weight = (c.hours / totalHours) * 100;           // percent (0-100)
      const rawItems = (weight / 100) * totalItems;           // exact
      const items = Math.round(rawItems);                     // nearest
      return {
        code: c.code,
        description: c.description,
        shortLabel: c.shortLabel,
        hours: c.hours,
        weeks: c.weeks,
        bloomLevels: c.bloomLevels,
        termExamPriority: c.termExamPriority,
        weightPercent: Math.round(weight * 100) / 100,        // 2 decimals
        rawItems: rawItems,
        items: items
      };
    });

    // Step 2 — adjust to make total match exactly
    let sum = rows.reduce((s, r) => s + r.items, 0);
    const diff = totalItems - sum;

    if (diff !== 0) {
      // Sort by fractional remainder (largest first)
      const withRemainder = rows.map((r) => ({
        row: r,
        remainder: r.rawItems - Math.floor(r.rawItems)
      }));

      if (diff > 0) {
        // Need to add items — add to rows with largest remainders
        withRemainder
          .sort((a, b) => b.remainder - a.remainder)
          .slice(0, diff)
          .forEach((x) => x.row.items++);
      } else {
        // Need to remove items — subtract from rows with smallest remainders
        // but never below 1 item
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
  /**
   * For each competency, distribute items across Bloom's levels.
   * Target: 30% LOTS, 70% HOTS.
   * Respects each competency's achievable bloomLevels array.
   */
  function distributeBlooms(rows) {
    return rows.map((row) => {
      const items = row.items;
      const allowed = row.bloomLevels && row.bloomLevels.length
        ? row.bloomLevels
        : BLOOMS;

      const allowedLOTS = LOTS.filter((l) => allowed.indexOf(l) !== -1);
      const allowedHOTS = HOTS.filter((l) => allowed.indexOf(l) !== -1);

      // If competency allows only LOTS or only HOTS, adjust the ratio
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

      // Distribute LOTS items across allowedLOTS (balanced)
      const distribution = {};
      BLOOMS.forEach((b) => { distribution[b] = 0; });

      let remainingLOTS = lotsTarget;
      allowedLOTS.forEach((lvl, i) => {
        const share = Math.floor(lotsTarget / allowedLOTS.length);
        distribution[lvl] = share;
        remainingLOTS -= share;
      });
      // Distribute remainder to first LOTS
      for (let i = 0; i < remainingLOTS; i++) {
        distribution[allowedLOTS[i % allowedLOTS.length]]++;
      }

      let remainingHOTS = hotsTarget;
      allowedHOTS.forEach((lvl) => {
        const share = Math.floor(hotsTarget / allowedHOTS.length);
        distribution[lvl] = share;
        remainingHOTS -= share;
      });
      for (let i = 0; i < remainingHOTS; i++) {
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
  /**
   * Builds the answer key from the question bank.
   * Result: array of { itemNo, answer, competency, bloomLevel }
   */
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
  /**
   * Given per-competency MPS values, return sorted rankings.
   * @param {Array} competencyMPS - array of { code, mps, description }
   * @returns {Array} sorted ascending (least → most)
   */
  function rankByMPS(competencyMPS) {
    return [...competencyMPS].sort((a, b) => a.mps - b.mps);
  }

  /**
   * Compute per-competency MPS from student attempts.
   * @param {Array} students - array of student objects
   * @param {String} term - 'term1' | 'term2' | 'term3'
   * @param {String} type - 'st1' | 'st2' | 'te' | 'quizzes'
   * @param {Object} assessment - the question bank object
   * @returns {Object} map code → { correct, total, mps }
   */
  function computeCompetencyMPS(students, term, type, assessment) {
    const result = {};
    const questions = assessment.questions || [];

    // Group questions by competency
    const byComp = {};
    questions.forEach((q, i) => {
      const code = q.competency || 'UNKNOWN';
      if (!byComp[code]) byComp[code] = [];
      byComp[code].push(i);
    });

    // Initialize
    Object.keys(byComp).forEach((code) => {
      result[code] = { correct: 0, total: 0, mps: 0 };
    });

    // Count correct / total per competency across all students
    students.forEach((s) => {
      const scores = Store.getScores(s.lrn);
      const record = type === 'te'
        ? (scores[term] && scores[term].te)
        : (scores[term] && scores[term][type] && scores[term][type][assessment.id]);

      if (!record || !record.itemResults) return;
      record.itemResults.forEach((r) => {
        const idx = r.index;
        const code = (questions[idx] && questions[idx].competency) || 'UNKNOWN';
        if (!result[code]) result[code] = { correct: 0, total: 0, mps: 0 };
        result[code].total++;
        if (r.correct) result[code].correct++;
      });
    });

    // Compute MPS
    Object.keys(result).forEach((code) => {
      const v = result[code];
      v.mps = v.total ? v.correct / v.total : 0;
    });

    return result;
  }

  /* ============================================================
     MAIN ENTRY POINT
     ============================================================ */
  /**
   * Generate a full TOS for a given assessment.
   *
   * @param {Object} opts
   * @param {String} opts.term         'term1' | 'term2' | 'term3'
   * @param {String} opts.assessment   'st1' | 'st2' | 'te'
   * @param {Number} opts.totalItems   30 for STs, 60 for TE
   * @param {Array}  opts.stRanking    Required only for TE — array of { code, mps }
   * @returns {Object} { term, assessment, rows, totals, answerKey, coverage }
   */
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

    // Compute weights + item counts
    let rows = computeWeights(competencies, opts.totalItems);

    // Distribute Bloom's levels
    rows = distributeBlooms(rows);

    // Assign item numbers
    rows = assignItemNumbers(rows);

    // Load the question bank for the answer key
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

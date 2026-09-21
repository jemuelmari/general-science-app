/* ============================================================
   item-analysis-engine.js — Per-item + per-competency analytics
   Version: 1.0.0
   App: General Science · v1.0.2
   ------------------------------------------------------------
   Responsibilities:
     1. Load question bank (Phase 2.5 path detection)
     2. Collect all student attempts for a given assessment
     3. Un-shuffle per-item data using originalIndex
     4. Compute per-item: difficulty (p-value), discrimination (D)
     5. Analyze distractors: count per option text, flag dysfunctional
     6. Aggregate per-competency: MPS, mastery level, intervention
     7. Flag: too easy, too hard, weak discrimination, negative discrimination,
              dysfunctional distractors, HOTS weak distractors

   Depends on:
     - Store.getScores(lrn)
     - MasteryScales.getLevel(mps) / .summarize(values)
     - Randomize.scoreAttempt() — itemResults include originalIndex, given, competency
   ============================================================ */

const ItemAnalysisEngine = (() => {
  'use strict';

  const CACHE_VERSION = '1.2.0';

  // Thresholds (locked)
  const DIFFICULTY_MIN = 0.20;
  const DIFFICULTY_MAX = 0.80;
  const DISCRIMINATION_MIN = 0.20;      // Below this = "weak"
  const DISCRIMINATION_NEGATIVE = 0.00; // Below this = "negative"
  const UPPER_PCT = 0.27;
  const LOWER_PCT = 0.27;
  const DYSFUNCTIONAL_MIN_ATTEMPTS = 10;
  const HOTS_WEAK_MIN_PCT = 0.05;       // 5% — no wrong option above this = weak

  /* ============================================================
     PHASE 2.5 — REPO BASE PATH DETECTION
     ============================================================ */
  function getRepoBase() {
    var path = window.location.pathname;
    var knownSubdirs = ['/teacher/', '/classrecord/', '/student/', '/assets/', '/data/'];
    for (var i = 0; i < knownSubdirs.length; i++) {
      var idx = path.indexOf(knownSubdirs[i]);
      if (idx > 0) return path.substring(0, idx) + '/';
    }
    if (path.endsWith('/')) return path;
    return path.substring(0, path.lastIndexOf('/') + 1);
  }

  function getAssetUrl(relativePath) {
    return getRepoBase() + relativePath + '?v=' + CACHE_VERSION;
  }

  /* ============================================================
     LOAD QUESTION BANK
     ============================================================ */
  async function loadQuestionBank(term, assessment) {
    var url = getAssetUrl('student/' + term + '/assessments/' + assessment + '.json');
    var res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load ' + assessment + '.json (HTTP ' + res.status + ')');
    var text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON from ' + assessment + '.json: ' + e.message);
    }
  }

  /* ============================================================
     COLLECT ATTEMPTS
     ============================================================ */
  /**
   * Get the attempt record for a student for a given (term, assessment).
   * Handles the three storage shapes.
   */
  function getAttemptFor(scores, term, assessment) {
    if (!scores || !scores[term]) return null;
    var t = scores[term];

    if (assessment === 'te') return t.te || null;

    if (assessment === 'st1' || assessment === 'st2') {
      if (t.st && t.st[assessment]) return t.st[assessment];
    }

    if (assessment === 'quiz1' || assessment === 'quiz2' || assessment === 'quiz3') {
      if (t.quizzes && t.quizzes[assessment]) return t.quizzes[assessment];
    }

    // Legacy: t[type][assessment]
    if (t[assessment]) return t[assessment];

    return null;
  }

  /**
   * Collect all attempts (matching filters) for the given assessment.
   * Returns array of { student, record, set }.
   */
  function collectAttempts(students, term, assessment, opts) {
    opts = opts || {};
    var out = [];
    students.forEach(function (s) {
      if (opts.section && s.section !== opts.section) return;
      var scores = (typeof Store !== 'undefined' && Store.getScores) ? Store.getScores(s.lrn) : null;
      if (!scores) return;
      var record = getAttemptFor(scores, term, assessment);
      if (!record || !record.itemResults) return;

      // Optional set filter
      if (opts.setLetter && record.set && record.set !== opts.setLetter) return;

      out.push({
        student: s,
        record: record,
        set: record.set || null,
        score: record.correct != null ? record.correct : (record.score || 0),
        total: record.total != null ? record.total : (record.itemResults.length || 0)
      });
    });
    return out;
  }

  /* ============================================================
     BUILD ITEM AGGREGATES
     ============================================================ */
  /**
   * Build per-item aggregates keyed by ORIGINAL bank index.
   * itemResults[i].originalIndex is used to un-shuffle across sets.
   */
  function buildItemAggregates(bank, attempts) {
    var questions = bank.questions || [];
    var items = questions.map(function (q, i) {
      return {
        originalIndex: i,
        itemNo: i + 1,               // display number (matches original bank)
        text: q.text || '',
        options: (q.options || []).slice(),
        correct: q.correct,
        competency: q.competency || 'UNKNOWN',
        bloomLevel: q.bloomLevel || '—',
        optionCounts: {},            // keyed by option text
        correctCount: 0,
        totalAttempts: 0,
        givenCounts: {},             // student answers keyed by option text
        perStudentCorrect: []        // [{ lrn, correct, score }] — for discrimination
      };
    });

    // Initialize option counts
    items.forEach(function (it) {
      it.options.forEach(function (opt) {
        it.optionCounts[opt] = 0;
      });
      it.optionCounts[it.correct] = it.optionCounts[it.correct] || 0;
    });

    // Aggregate
    attempts.forEach(function (a) {
      var lrn = a.student.lrn;
      var totalScore = a.score;      // used for discrimination
      a.record.itemResults.forEach(function (r) {
        var oi = (typeof r.originalIndex === 'number') ? r.originalIndex : r.index;
        if (oi == null || oi < 0 || oi >= items.length) return;
        var it = items[oi];
        it.totalAttempts++;
        if (r.correct) it.correctCount++;
        var given = r.given != null ? r.given : null;
        if (given != null) {
          it.givenCounts[given] = (it.givenCounts[given] || 0) + 1;
          if (it.optionCounts[given] != null) {
            it.optionCounts[given]++;
          } else {
            // Option text not in bank (student somehow submitted non-listed text)
            it.optionCounts[given] = (it.optionCounts[given] || 0) + 1;
          }
        }
        it.perStudentCorrect.push({
          lrn: lrn,
          correct: !!r.correct,
          totalScore: totalScore
        });
      });
    });

    return items;
  }

  /* ============================================================
     DIFFICULTY
     ============================================================ */
  function computeDifficulty(item) {
    if (!item.totalAttempts) {
      return { p: null, flag: 'no_data', label: 'No Data' };
    }
    var p = item.correctCount / item.totalAttempts;
    var flag = 'ok';
    var label = 'Acceptable';
    if (p < DIFFICULTY_MIN) { flag = 'too_hard'; label = 'Too Difficult (p < 0.20)'; }
    else if (p > DIFFICULTY_MAX) { flag = 'too_easy'; label = 'Too Easy (p > 0.80)'; }
    return { p: p, flag: flag, label: label };
  }

  /* ============================================================
     DISCRIMINATION  (upper 27% vs lower 27%)
     ============================================================ */
  /**
   * For a given item, compute D = (U_correct/U_total) − (L_correct/L_total)
   * where U = upper 27% of students by total score and L = lower 27%.
   * Requires at least ~10 attempts for a stable estimate; below that,
   * we still compute but tag as 'small_sample'.
   */
  function computeDiscrimination(item, attempts) {
    var n = attempts.length;
    if (!n || item.perStudentCorrect.length !== n) {
      return { d: null, flag: 'no_data', label: 'No Data', upperN: 0, lowerN: 0 };
    }

    // Rank attempts by total score descending
    var ranked = attempts.slice().sort(function (a, b) { return b.score - a.score; });
    var upperN = Math.max(1, Math.round(n * UPPER_PCT));
    var lowerN = Math.max(1, Math.round(n * LOWER_PCT));

    var upperSet = {};
    var lowerSet = {};
    ranked.slice(0, upperN).forEach(function (a) { upperSet[a.student.lrn] = true; });
    ranked.slice(-lowerN).forEach(function (a) { lowerSet[a.student.lrn] = true; });

    var uCorrect = 0, uTotal = 0, lCorrect = 0, lTotal = 0;
    item.perStudentCorrect.forEach(function (r) {
      if (upperSet[r.lrn]) { uTotal++; if (r.correct) uCorrect++; }
      if (lowerSet[r.lrn]) { lTotal++; if (r.correct) lCorrect++; }
    });

    if (!uTotal || !lTotal) {
      return { d: null, flag: 'no_data', label: 'No Data', upperN: uTotal, lowerN: lTotal };
    }

    var d = (uCorrect / uTotal) - (lCorrect / lTotal);
    d = Math.round(d * 1000) / 1000;

    var flag, label;
    if (n < 10) { flag = 'small_sample'; label = 'Small sample'; }
    else if (d < DISCRIMINATION_NEGATIVE) { flag = 'negative'; label = 'Negative discrimination'; }
    else if (d < DISCRIMINATION_MIN) { flag = 'weak'; label = 'Weak discrimination'; }
    else { flag = 'ok'; label = 'Acceptable'; }

    return { d: d, flag: flag, label: label, upperN: uTotal, lowerN: lTotal };
  }

  /* ============================================================
     DISTRACTOR ANALYSIS
     ============================================================ */
  function analyzeDistractors(item, opts) {
    opts = opts || {};
    var total = item.totalAttempts;
    var correct = item.correct;

    var options = item.options.map(function (opt) {
      var count = item.optionCounts[opt] || 0;
      var pct = total ? count / total : 0;
      return {
        text: opt,
        count: count,
        pct: pct,
        isCorrect: opt === correct,
        dysfunctional: false
      };
    });

    // Ensure correct option present (edge case)
    if (!options.some(function (o) { return o.isCorrect; })) {
      options.push({
        text: correct,
        count: item.optionCounts[correct] || 0,
        pct: total ? (item.optionCounts[correct] || 0) / total : 0,
        isCorrect: true,
        dysfunctional: false
      });
    }

    // Flag dysfunctional distractors
    // Rule: a wrong option chosen by 0 students, on an item with >= threshold attempts
    var dysfunctionalList = [];
    options.forEach(function (o) {
      if (o.isCorrect) return;
      if (o.count === 0 && total >= DYSFUNCTIONAL_MIN_ATTEMPTS) {
        o.dysfunctional = true;
        dysfunctionalList.push(o.text);
      }
    });

    // HOTS weak-distractor check
    var isHOTS = (item.bloomLevel === 'Applying' ||
                  item.bloomLevel === 'Analyzing' ||
                  item.bloomLevel === 'Evaluating' ||
                  item.bloomLevel === 'Creating');
    var hotsWeak = false;
    if (isHOTS && total >= DYSFUNCTIONAL_MIN_ATTEMPTS) {
      var maxWrongPct = 0;
      options.forEach(function (o) {
        if (!o.isCorrect && o.pct > maxWrongPct) maxWrongPct = o.pct;
      });
      if (maxWrongPct < HOTS_WEAK_MIN_PCT) hotsWeak = true;
    }

    return {
      options: options,
      dysfunctional: dysfunctionalList,
      hotsWeak: hotsWeak
    };
  }

  /* ============================================================
     FULL ITEM ANALYSIS
     ============================================================ */
  function analyzeItems(bank, attempts) {
    var items = buildItemAggregates(bank, attempts);

    return items.map(function (it) {
      var difficulty = computeDifficulty(it);
      var discrimination = computeDiscrimination(it, attempts);
      var distractor = analyzeDistractors(it);

      var flags = [];
      if (difficulty.flag === 'too_hard') flags.push('too_hard');
      if (difficulty.flag === 'too_easy') flags.push('too_easy');
      if (discrimination.flag === 'weak') flags.push('weak_discrimination');
      if (discrimination.flag === 'negative') flags.push('negative_discrimination');
      if (distractor.dysfunctional.length) flags.push('dysfunctional_distractor');
      if (distractor.hotsWeak) flags.push('hots_weak_distractors');

      return {
        originalIndex: it.originalIndex,
        itemNo: it.itemNo,
        text: it.text,
        options: it.options,
        correct: it.correct,
        competency: it.competency,
        bloomLevel: it.bloomLevel,
        correctCount: it.correctCount,
        totalAttempts: it.totalAttempts,
        difficulty: difficulty,
        discrimination: discrimination,
        distractor: distractor,
        flags: flags
      };
    });
  }

  /* ============================================================
     COMPETENCY AGGREGATION
     ============================================================ */
  function groupByCompetency(items) {
    var byComp = {};
    items.forEach(function (it) {
      if (!byComp[it.competency]) {
        byComp[it.competency] = {
          code: it.competency,
          itemNos: [],
          correct: 0,
          total: 0,
          mps: 0,
          level: null,
          mastery: null
        };
      }
      var g = byComp[it.competency];
      g.itemNos.push(it.itemNo);
      g.correct += it.correctCount;
      g.total += it.totalAttempts;
    });

    var out = Object.keys(byComp).map(function (code) {
      var g = byComp[code];
      g.mps = g.total ? g.correct / g.total : 0;
      if (typeof MasteryScales !== 'undefined' && MasteryScales.getLevel) {
        g.level = MasteryScales.getLevel(g.mps);
        g.mastery = {
          code: g.level.code,
          label: g.level.label,
          action: g.level.action,
          description: g.level.description,
          color: g.level.color,
          colorLight: g.level.colorLight
        };
      } else {
        g.level = { code: '—', label: 'MasteryScales unavailable', color: '#90a4ae', colorLight: '#f5f5f5', action: '' };
      }
      return g;
    });

    out.sort(function (a, b) { return a.mps - b.mps; });
    return out;
  }

  /* ============================================================
     FLAG AGGREGATION
     ============================================================ */
  function aggregateFlags(items, competencies) {
    var tooEasy = [], tooHard = [];
    var weakDisc = [], negDisc = [];
    var dysfunctional = [], hotsWeak = [];

    items.forEach(function (it) {
      if (it.difficulty.flag === 'too_easy') tooEasy.push(it);
      if (it.difficulty.flag === 'too_hard') tooHard.push(it);
      if (it.discrimination.flag === 'weak') weakDisc.push(it);
      if (it.discrimination.flag === 'negative') negDisc.push(it);
      if (it.distractor.dysfunctional.length) {
        dysfunctional.push({ item: it, options: it.distractor.dysfunctional });
      }
      if (it.distractor.hotsWeak) hotsWeak.push(it);
    });

    // Weakest competencies = lowest MPS
    var weakest = competencies.slice(0, 5);
    var strongest = competencies.slice().sort(function (a, b) { return b.mps - a.mps; }).slice(0, 5);

    return {
      tooEasy: tooEasy,
      tooHard: tooHard,
      weakDiscrimination: weakDisc,
      negativeDiscrimination: negDisc,
      dysfunctionalDistractors: dysfunctional,
      hotsWeakDistractors: hotsWeak,
      weakestCompetencies: weakest,
      strongestCompetencies: strongest
    };
  }

  /* ============================================================
     INTERVENTION BUILDER
     ============================================================ */
  function buildInterventions(competencies) {
    return competencies.map(function (c) {
      return {
        code: c.code,
        mps: c.mps,
        levelCode: c.level.code,
        levelLabel: c.level.label,
        action: c.level.action,
        description: c.level.description,
        itemNos: c.itemNos
      };
    });
  }

  /* ============================================================
     MAIN ENTRY POINT
     ============================================================ */
  async function analyzeAssessment(opts) {
    var term = opts.term;
    var assessment = opts.assessment;
    var opts2 = {
      section: opts.section || '',
      setLetter: opts.setLetter || null
    };

    // Load bank
    var bank = await loadQuestionBank(term, assessment);

    // Collect attempts
    var allStudents = (typeof Store !== 'undefined' && Store.getAllUsers) ? Store.getAllUsers() : [];
    var attempts = collectAttempts(allStudents, term, assessment, opts2);

    // Analyze
    var items = analyzeItems(bank, attempts);
    var competencies = groupByCompetency(items);
    var flags = aggregateFlags(items, competencies);
    var interventions = buildInterventions(competencies);

    // Summary
    var overallCorrect = items.reduce(function (a, i) { return a + i.correctCount; }, 0);
    var overallTotal = items.reduce(function (a, i) { return a + i.totalAttempts; }, 0);
    var overallMPS = overallTotal ? overallCorrect / overallTotal : 0;
    var overallLevel = (typeof MasteryScales !== 'undefined' && MasteryScales.getLevel)
      ? MasteryScales.getLevel(overallMPS)
      : { code: '—', label: '—', color: '#90a4ae', colorLight: '#f5f5f5', action: '' };

    var distribution = (typeof MasteryScales !== 'undefined' && MasteryScales.summarize)
      ? MasteryScales.summarize(competencies.map(function (c) { return c.mps; }))
      : { ES: 0, MS: 0, AS: 0, NI: 0, total: 0 };

    return {
      term: term,
      assessment: assessment,
      section: opts2.section,
      setLetter: opts2.setLetter,
      bankSize: (bank.questions || []).length,
      attempts: attempts.length,
      students: attempts.map(function (a) {
        return {
          lrn: a.student.lrn,
          name: (a.student.lastName || '') + ', ' + (a.student.firstName || ''),
          section: a.student.section || '',
          score: a.score,
          total: a.total,
          set: a.set
        };
      }),
      items: items,
      competencies: competencies,
      interventions: interventions,
      flags: flags,
      summary: {
        overallMPS: overallMPS,
        overallLevel: overallLevel,
        distribution: distribution,
        itemCount: items.length,
        competencyCount: competencies.length,
        attemptCount: attempts.length
      }
    };
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    getRepoBase: getRepoBase,
    getAssetUrl: getAssetUrl,
    loadQuestionBank: loadQuestionBank,
    getAttemptFor: getAttemptFor,
    collectAttempts: collectAttempts,
    buildItemAggregates: buildItemAggregates,
    computeDifficulty: computeDifficulty,
    computeDiscrimination: computeDiscrimination,
    analyzeDistractors: analyzeDistractors,
    analyzeItems: analyzeItems,
    groupByCompetency: groupByCompetency,
    aggregateFlags: aggregateFlags,
    buildInterventions: buildInterventions,
    analyzeAssessment: analyzeAssessment,

    // Constants (for tests / UI)
    DIFFICULTY_MIN: DIFFICULTY_MIN,
    DIFFICULTY_MAX: DIFFICULTY_MAX,
    DISCRIMINATION_MIN: DISCRIMINATION_MIN,
    DISCRIMINATION_NEGATIVE: DISCRIMINATION_NEGATIVE
  };
})();

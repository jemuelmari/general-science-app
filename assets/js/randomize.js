/* ============================================================
   randomize.js — Set A / Set B shuffle engine
   Version: 1.0.0
   App: General Science
   ------------------------------------------------------------
   DESIGN DECISIONS (locked):
   - Same questions for both sets, different fixed shuffle
   - Deterministic: same seed → same order across all devices
   - Question order shuffled per set
   - Option order shuffled per question per set
   - Correct answer tracked per (set, question index)
   - No "All of the above" / "None of the above" (they can't shuffle)

   USAGE:
     // Generate the two sets once
     const sets = Randomize.generateSets(questionBank, 'term1-st1');

     // Get one set for a student
     const setA = Randomize.getSet('term1-st1', 'A');
     const setB = Randomize.getSet('term1-st1', 'B');

     // Score a student's attempt against the shuffled set
     const result = Randomize.scoreAttempt(studentAnswers, setA);

   The seed is derived from (assessmentId + setLetter) so both
   teacher and student devices produce the identical shuffle.
   ============================================================ */

const Randomize = (() => {
  'use strict';

  const STORAGE_KEY = 'gsa_v1_shuffled_sets';

  /* ============================================================
     SEEDED RNG — Mulberry32
     Deterministic across all devices
     ============================================================ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFromString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function hashSeed(assessmentId, setLetter) {
    return seedFromString(assessmentId + '#set-' + setLetter);
  }

  /* ============================================================
     SHUFFLE (with seed)
     ============================================================ */
  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /* ============================================================
     GENERATE SETS
     ============================================================ */
  /**
   * Generate a shuffled set for a given assessment.
   * @param {Object} questionBank — { questions: [ { id, text, options, correct, ... } ] }
   * @param {String} assessmentId — e.g. 'term1-st1'
   * @param {String} setLetter — 'A' or 'B'
   * @returns {Object} — { assessmentId, setLetter, questions, answerKey }
   */
  function generateSet(questionBank, assessmentId, setLetter) {
    const questions = questionBank.questions || [];
    const rng = mulberry32(hashSeed(assessmentId, setLetter));

    // Shuffle the question order
    const order = seededShuffle(questions.map(function(_, i) { return i; }), rng);

    const setQuestions = order.map(function(originalIndex, newIndex) {
      const q = questions[originalIndex];

      // Shuffle the option order for this question
      const optionOrder = seededShuffle(q.options.slice(), mulberry32(hashSeed(assessmentId + '-q' + originalIndex, setLetter)));

      return {
        setIndex: newIndex,            // position within this set (0-based)
        originalIndex: originalIndex,  // position in the master bank
        id: q.id,
        text: q.text,
        options: optionOrder,          // options in shuffled order
        correct: q.correct,            // original correct answer (text)
        competency: q.competency || null,
        bloomLevel: q.bloomLevel || null
      };
    });

    // Build the answer key for this set (used for auto-scoring)
    const answerKey = setQuestions.map(function(q, i) {
      return {
        setIndex: i,
        originalIndex: q.originalIndex,
        correctText: q.correct,
        correctIndex: q.options.indexOf(q.correct)
      };
    });

    return {
      assessmentId: assessmentId,
      setLetter: setLetter,
      generatedAt: new Date().toISOString(),
      questions: setQuestions,
      answerKey: answerKey
    };
  }

  /**
   * Generate both Set A and Set B for an assessment.
   */
  function generateSets(questionBank, assessmentId) {
    return {
      A: generateSet(questionBank, assessmentId, 'A'),
      B: generateSet(questionBank, assessmentId, 'B')
    };
  }

  /* ============================================================
     PERSISTENCE
     ============================================================ */
  function _loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function _saveAll(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('[Randomize] Could not persist sets:', e);
    }
  }

  function persistSets(assessmentId, sets) {
    const all = _loadAll();
    all[assessmentId] = sets;
    _saveAll(all);
  }

  function getStoredSets(assessmentId) {
    const all = _loadAll();
    return all[assessmentId] || null;
  }

  /**
   * Get a specific set — regenerates deterministically if not stored.
   */
  async function getSet(assessmentId, setLetter, term, bankFilename) {
    let sets = getStoredSets(assessmentId);
    if (sets && sets[setLetter]) return sets[setLetter];

    // Regenerate from the question bank
    if (!term || !bankFilename) {
      throw new Error('Sets not stored and no bank info provided to regenerate.');
    }

    const res = await fetch('../student/' + term + '/assessments/' + bankFilename + '.json?ts=' + Date.now());
    if (!res.ok) throw new Error('Failed to load question bank: ' + bankFilename);
    const bank = await res.json();

    const fresh = generateSets(bank, assessmentId);
    persistSets(assessmentId, fresh);
    return fresh[setLetter];
  }

  /* ============================================================
     SCORE ATTEMPT
     ============================================================ */
  /**
   * Score a student's answers against a specific set.
   * @param {Object} answers — { setIndex: "chosen option text" }
   * @param {Object} set — output from generateSet()
   * @returns {Object} — { correct, total, percent, itemResults }
   */
  function scoreAttempt(answers, set) {
    let correct = 0;
    const itemResults = [];

    set.questions.forEach(function(q, i) {
      const given = answers[i] != null ? answers[i] : null;
      const isCorrect = given === q.correct;
      if (isCorrect) correct++;

      itemResults.push({
        index: i,
        originalIndex: q.originalIndex,
        questionId: q.id,
        correct: isCorrect,
        given: given,
        expected: q.correct,
        competency: q.competency,
        bloomLevel: q.bloomLevel
      });
    });

    const total = set.questions.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    return {
      correct: correct,
      total: total,
      percent: percent,
      itemResults: itemResults
    };
  }

  /* ============================================================
     UN-SHUFFLE (for cross-set comparison in item analysis)
     ============================================================ */
  /**
   * Given a set and a set of answers, remap to the original index.
   * Useful when the teacher wants to compare across Set A and Set B.
   */
  function remapToOriginal(answers, set) {
    const remapped = {};
    set.questions.forEach(function(q, i) {
      remapped[q.originalIndex] = answers[i];
    });
    return remapped;
  }

  /**
   * Given item results from a shuffled set, remap to original indices.
   */
  function remapItemResults(itemResults, set) {
    return itemResults.map(function(r) {
      const q = set.questions[r.index];
      return {
        ...r,
        originalIndex: q ? q.originalIndex : r.index
      };
    });
  }

  /* ============================================================
     DETECT "ALL OF THE ABOVE" TYPE OPTIONS
     ============================================================ */
  function hasUnshuffleableOption(options) {
    const phrases = ['all of the above', 'none of the above', 'both a and b', 'all the above'];
    return options.some(function(o) {
      const s = String(o).toLowerCase().trim();
      return phrases.some(function(p) { return s.indexOf(p) !== -1; });
    });
  }

  /**
   * Validate a question bank — warns if any question can't be shuffled.
   */
  function validateBank(questionBank) {
    const warnings = [];
    (questionBank.questions || []).forEach(function(q, i) {
      if (hasUnshuffleableOption(q.options || [])) {
        warnings.push({
          itemIndex: i,
          id: q.id,
          reason: 'Contains an unshuffleable option (e.g., "All of the above").'
        });
      }
      if (!q.options || q.options.length !== 4) {
        warnings.push({
          itemIndex: i,
          id: q.id,
          reason: 'Question does not have exactly 4 options.'
        });
      }
      if (q.correct === undefined || q.correct === null) {
        warnings.push({
          itemIndex: i,
          id: q.id,
          reason: 'Missing correct answer.'
        });
      }
    });
    return warnings;
  }

  /* ============================================================
     CLEAR STORED SETS (admin / dev)
     ============================================================ */
  function clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function clearOne(assessmentId) {
    const all = _loadAll();
    delete all[assessmentId];
    _saveAll(all);
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    // Generation
    generateSet,
    generateSets,

    // Persistence
    persistSets,
    getStoredSets,
    getSet,

    // Scoring
    scoreAttempt,
    remapToOriginal,
    remapItemResults,

    // Validation
    hasUnshuffleableOption,
    validateBank,

    // Admin
    clearAll,
    clearOne
  };
})();

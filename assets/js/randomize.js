/* ============================================================
   randomize.js — Set A / Set B shuffle engine
   Version: 1.2.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.2.0 (Phase 2.5 / X44 fix):
     - Added getRepoBase() helper (same strategy as tos-engine.js)
       so getSet() resolves question-bank paths correctly from
       ANY page depth (root, /teacher/, /classrecord/,
       /student/term1/week1/, etc.).
     - getSet() now tries multiple candidate paths in a fallback
       chain for robustness.
     - Fetch error messages include the fully-resolved URL.

   Changelog v1.1.0 (Phase 2):
     - scoreAttempt() now includes originalIndex in itemResults.
     - Added getOriginalIndex(set, setIndex) helper.
     - Added validateSets() to confirm Set A / Set B contain the
       same questions in different order.

   DESIGN DECISIONS (locked):
   - Same questions for both sets, different fixed shuffle
   - Deterministic: same seed → same order across all devices
   - Question order shuffled per set
   - Option order shuffled per question per set
   - Correct answer tracked per (set, question index)
   - No "All of the above" / "None of the above" (can't shuffle)
   ============================================================ */

const Randomize = (() => {
  'use strict';

  const STORAGE_KEY = 'gsa_v1_shuffled_sets';

  let _repoBase = null;  // cached repo-base path

  /* ============================================================
     REPO BASE DETECTION (same strategy as tos-engine.js)
     ============================================================ */
  function getRepoBase() {
    if (_repoBase !== null) return _repoBase;

    const scripts = document.querySelectorAll('script[src]');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('config.js') !== -1) {
        _repoBase = src.replace(/config\.js(\?.*)?$/, '');
        return _repoBase;
      }
    }

    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src') || '';
      const m = src.match(/^(.*?)assets\/js\/app\.js/);
      if (m) {
        _repoBase = m[1];
        return _repoBase;
      }
    }

    const path = window.location.pathname;
    const repoMatch = path.match(/^(.*?\/general-science-app\/)/i);
    if (repoMatch) {
      const depthMatch = path.replace(repoMatch[1], '').split('/');
      const depth = Math.max(0, depthMatch.length - 1);
      _repoBase = '../'.repeat(depth) || './';
      return _repoBase;
    }

    console.warn('[Randomize] Could not detect repo base — using ../ fallback');
    _repoBase = '../';
    return _repoBase;
  }

  /* ============================================================
     SEEDED RNG — Mulberry32
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
     SEEDED SHUFFLE
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
     GENERATE SET
     ============================================================ */
  function generateSet(questionBank, assessmentId, setLetter) {
    const questions = questionBank.questions || [];
    const rng = mulberry32(hashSeed(assessmentId, setLetter));

    const order = seededShuffle(questions.map(function(_, i) { return i; }), rng);

    const setQuestions = order.map(function(originalIndex, newIndex) {
      const q = questions[originalIndex];
      const optionRng = mulberry32(hashSeed(assessmentId + '-q' + originalIndex, setLetter));
      const optionOrder = seededShuffle(q.options.slice(), optionRng);

      return {
        setIndex: newIndex,
        originalIndex: originalIndex,
        id: q.id,
        text: q.text,
        options: optionOrder,
        correct: q.correct,
        competency: q.competency || null,
        bloomLevel: q.bloomLevel || null
      };
    });

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

  function generateSets(questionBank, assessmentId) {
    return {
      A: generateSet(questionBank, assessmentId, 'A'),
      B: generateSet(questionBank, assessmentId, 'B')
    };
  }

  function validateSets(sets) {
    if (!sets || !sets.A || !sets.B) return false;
    const aIds = sets.A.questions.map(q => q.id).sort();
    const bIds = sets.B.questions.map(q => q.id).sort();
    if (aIds.length !== bIds.length) return false;
    for (let i = 0; i < aIds.length; i++) {
      if (aIds[i] !== bIds[i]) return false;
    }
    return true;
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
   *
   * ⚠️ FIX (X44): uses getRepoBase() to build candidate paths.
   * Tries each candidate until one works.
   */
  async function getSet(assessmentId, setLetter, term, bankFilename) {
    let sets = getStoredSets(assessmentId);
    if (sets && sets[setLetter]) return sets[setLetter];

    if (!term || !bankFilename) {
      throw new Error('Sets not stored and no bank info provided to regenerate.');
    }

    const base = getRepoBase();
    const candidates = [
      base + 'student/' + term + '/assessments/' + bankFilename + '.json',
      '../student/' + term + '/assessments/' + bankFilename + '.json',
      '../../student/' + term + '/assessments/' + bankFilename + '.json',
      './student/' + term + '/assessments/' + bankFilename + '.json'
    ];

    let bank = null;
    let lastErr = null;

    for (let i = 0; i < candidates.length; i++) {
      try {
        const res = await fetch(candidates[i] + '?ts=' + Date.now());
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status + ' for ' + candidates[i]);
          continue;
        }
        bank = await res.json();
        console.log('[Randomize] Loaded bank from: ' + candidates[i]);
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!bank) {
      const triedList = candidates.join(', ');
      throw new Error('Failed to load question bank: ' + bankFilename +
        '. Tried: ' + triedList +
        (lastErr ? ' (last error: ' + lastErr.message + ')' : ''));
    }

    const fresh = generateSets(bank, assessmentId);
    persistSets(assessmentId, fresh);
    return fresh[setLetter];
  }

  /* ============================================================
     SCORE ATTEMPT
     ============================================================ */
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
        competency: q.competency || null,
        bloomLevel: q.bloomLevel || null
      });
    });

    const total = set.questions.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    return {
      correct: correct,
      total: total,
      percent: percent,
      setLetter: set.setLetter,
      itemResults: itemResults
    };
  }

  /* ============================================================
     UN-SHUFFLE HELPERS
     ============================================================ */
  function remapToOriginal(answers, set) {
    const remapped = {};
    set.questions.forEach(function(q, i) {
      remapped[q.originalIndex] = answers[i];
    });
    return remapped;
  }

  function remapItemResults(itemResults, set) {
    return itemResults.map(function(r) {
      const q = set.questions[r.index];
      return {
        ...r,
        originalIndex: q ? q.originalIndex : (r.originalIndex != null ? r.originalIndex : r.index)
      };
    });
  }

  function getOriginalIndex(set, setIndex) {
    if (!set || !set.questions || !set.questions[setIndex]) return null;
    return set.questions[setIndex].originalIndex;
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
    // Path helper
    getRepoBase,

    // Generation
    generateSet,
    generateSets,
    validateSets,

    // Persistence
    persistSets,
    getStoredSets,
    getSet,

    // Scoring
    scoreAttempt,
    remapToOriginal,
    remapItemResults,
    getOriginalIndex,

    // Validation
    hasUnshuffleableOption,
    validateBank,

    // Admin
    clearAll,
    clearOne
  };
})();

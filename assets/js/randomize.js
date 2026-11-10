/* ============================================================
   randomize.js — Set A / Set B shuffle engine
   Version: 1.5.0
   App: General Science
   ------------------------------------------------------------
   Changelog v1.5.0 (Exam <-> Evidence <-> Print alignment):
     - Choices are placed by the SAME seeded, evenly-spread algorithm
       that teacher/print-exam.js used for paper copies (correct
       answer is option #1 in all 540 bank items, so un-shuffled
       online exams were "always pick A"). Seed per set:
       <assessmentId>#choices-<setLetter>  => online == paper.
     - Each set question carries optionOrder (displayed position ->
       original option index). scoreAttempt() now records it as `oo`
       plus a content hash `qh`, so Exam Evidence can rebuild the
       EXACT screen the student saw and detect later bank edits.
     - Exposes shuffleChoices(), itemHash(), CHOICES_SEEDED.
   Changelog v1.4.0:
     - DISABLED option shuffling. Options stay in original JSON
       order. Question order is still shuffled (anti-cheat).
       Reason: students report confusion when option positions
       change between attempts. Score correctness is unaffected.
   Changelog v1.3.0 (Phase 2.6 / X45 fix):
     - getSet() now uses res.text() + JSON.parse() with deduped
       candidates and static ?v=1.3.0 cache-bust.
     - Matches tos-engine.js loading strategy for consistency.
   Changelog v1.2.0 (Phase 2.5 / X44 fix):
     - Added getRepoBase() helper.
   Changelog v1.1.0 (Phase 2):
     - scoreAttempt() includes originalIndex.
     - Added getOriginalIndex() and validateSets().

   DESIGN DECISIONS (locked):
   - Same questions for both sets, different fixed shuffle
   - Deterministic: same seed → same order across all devices
   - Correct answer tracked per (set, question index)
   - Options NOT shuffled (v1.4.0)
   ============================================================ */

const Randomize = (() => {
  'use strict';

  const STORAGE_KEY = 'gsa_v1_shuffled_sets';
  const CACHE_BUST = '?v=1.5.0';

  let _repoBase = null;

  /* ============================================================
     REPO BASE DETECTION
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
     SEEDED CHOICE PLACEMENT (identical to print-exam.js v1.0.0)
     ------------------------------------------------------------
     Correct answer gets a balanced target position (A-D evenly
     spread, no 3-in-a-row); distractors are shuffled around it.
     Works on index arrays, consuming the RNG exactly like the
     text-based version in print-exam.js, so layouts are identical.
     ============================================================ */
  const CHOICES_SEEDED = true;

  function _hasRun(positions, len) {
    let run = 1;
    for (let i = 1; i < positions.length; i++) {
      run = positions[i] === positions[i - 1] ? run + 1 : 1;
      if (run >= len) return true;
    }
    return false;
  }

  /** items: [{options:[...], correct:'text'}]  ->  [[origIdx...], ...] (displayed pos -> original option idx) */
  function shuffleChoices(items, seedStr) {
    const rng = mulberry32(seedFromString(seedStr));
    const n = items.length;
    const base = [];
    for (let i = 0; i < n; i++) base.push(i % 4);
    let positions = seededShuffle(base, rng);
    for (let tries = 0; tries < 200 && _hasRun(positions, 3); tries++) positions = seededShuffle(base, rng);

    return items.map(function(it, i) {
      const opts = it.options || [];
      const idx = opts.map(function(_, k) { return k; });
      const correctIdx = opts.indexOf(it.correct);
      const locked = opts.length < 2 || correctIdx < 0 || hasUnshuffleableOption(opts);
      if (locked) return idx;
      const others = seededShuffle(idx.filter(function(k) { return k !== correctIdx; }), rng);
      const target = Math.min(positions[i], opts.length - 1);
      const order = others.slice();
      order.splice(target, 0, correctIdx);
      return order;
    });
  }

  /** 8-char fingerprint of a bank item (text + options + correct). Same function lives in teacher/evidence.js */
  function itemHash(q) {
    const str = [q.text, (q.options || []).join('\u241F'), q.correct].join('\u241E');
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  /* ============================================================
     GENERATE SET
     ------------------------------------------------------------
     v1.4.0: Options are NOT shuffled. Only questions are shuffled.
     ============================================================ */
  function generateSet(questionBank, assessmentId, setLetter, genOpts) {
    const questions = questionBank.questions || [];
    const rng = mulberry32(hashSeed(assessmentId, setLetter));
    const order = seededShuffle(questions.map(function(_, i) { return i; }), rng);
    const placeChoices = !(genOpts && genOpts.shuffleChoices === false);

    const picked = order.map(function(originalIndex) { return questions[originalIndex]; });
    const optionOrders = placeChoices
      ? shuffleChoices(picked, assessmentId + '#choices-' + setLetter)
      : picked.map(function(q) { return (q.options || []).map(function(_, k) { return k; }); });

    const setQuestions = order.map(function(originalIndex, newIndex) {
      const q = questions[originalIndex];
      const oo = optionOrders[newIndex];
      const optionList = oo.map(function(k) { return q.options[k]; });

      return {
        setIndex: newIndex,
        originalIndex: originalIndex,
        id: q.id,
        text: q.text,
        options: optionList,
        optionOrder: oo,
        hash: itemHash(q),
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

  /* ============================================================
     GET SET — deterministic regenerate with deduped fallback
     ============================================================ */
  async function getSet(assessmentId, setLetter, term, bankFilename) {
    let sets = getStoredSets(assessmentId);
    if (sets && sets[setLetter]) return sets[setLetter];

    if (!term || !bankFilename) {
      throw new Error('Sets not stored and no bank info provided to regenerate.');
    }

    const base = getRepoBase();
    const rawCandidates = [
      base + 'student/' + term + '/assessments/' + bankFilename + '.json',
      'student/' + term + '/assessments/' + bankFilename + '.json',
      '../student/' + term + '/assessments/' + bankFilename + '.json',
      '/general-science-app/student/' + term + '/assessments/' + bankFilename + '.json'
    ];

    // Dedupe
    const candidates = [];
    const seen = new Set();
    for (let i = 0; i < rawCandidates.length; i++) {
      if (!seen.has(rawCandidates[i])) {
        seen.add(rawCandidates[i]);
        candidates.push(rawCandidates[i]);
      }
    }

    let bank = null;
    let lastErr = null;

    for (let i = 0; i < candidates.length; i++) {
      const path = candidates[i];
      const url = path + CACHE_BUST;
      console.log('[Randomize] Trying bank at: ' + url);

      try {
        const res = await fetch(url);
        console.log('[Randomize]   → Status ' + res.status);
        if (!res.ok) {
          lastErr = new Error('HTTP ' + res.status + ' for ' + path);
          continue;
        }
        const text = await res.text();
        try {
          bank = JSON.parse(text);
          console.log('[Randomize]   → ✅ Loaded from: ' + path);
          break;
        } catch (parseErr) {
          console.error('[Randomize]   → JSON parse failed: ' + parseErr.message);
          throw new Error('Invalid JSON from ' + path + ': ' + parseErr.message);
        }
      } catch (e) {
        if (e.message && e.message.indexOf('Invalid JSON') === 0) throw e;
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
        bloomLevel: q.bloomLevel || null,
        oo: q.optionOrder || null,
        qh: q.hash || null
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
     VALIDATION
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
     ADMIN
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
    getRepoBase,
    generateSet,
    generateSets,
    shuffleChoices,
    itemHash,
    CHOICES_SEEDED,
    validateSets,
    persistSets,
    getStoredSets,
    getSet,
    scoreAttempt,
    remapToOriginal,
    remapItemResults,
    getOriginalIndex,
    hasUnshuffleableOption,
    validateBank,
    clearAll,
    clearOne
  };
})();

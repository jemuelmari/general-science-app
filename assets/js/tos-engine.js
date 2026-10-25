/* ============================================================
   tos-engine.js — Table of Specification computation engine
   Version: 2.0.1
   App: General Science · v1.0.3
   ------------------------------------------------------------
   Changelog v2.0.1:
     - Fixed getRepoBase() to support Vercel and GitHub Pages
       without producing double-slash `//` URLs.
     - Updated MPS computation to work with Cloud-First
       StudentsMaster data structure (async fetching).
   ============================================================ */

const TOSEngine = (() => {
  'use strict';

  const BLOOMS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
  const LOTS = ['Remembering', 'Understanding'];
  const HOTS = ['Applying', 'Analyzing', 'Evaluating', 'Creating'];

  const LOTS_RATIO = 0.30;
  const HOTS_RATIO = 0.70;

  const CACHE_VERSION = '1.2.1';
  const SIG_KEY = 'gsa_v1_signatories';

  const DEFAULT_SIGS = {
    prepared: { name: 'JEMUEL C. MARI, MAN, RN, LPT', position: 'Teacher II' },
    checked:  { name: '', position: '' },
    noted:    { name: '', position: '' }
  };

  let _compData = null;

  /* ============================================================
     REPO BASE PATH DETECTION  (Vercel & GitHub Pages safe)
     ============================================================ */
  function getRepoBase() {
    var path = window.location.pathname;
    var parts = path.split('/');
    
    // Kung ang huling bahagi ay may .html, ibig sabihin file ito.
    // Tatanggalin natin para makuha ang directory.
    if (parts[parts.length - 1].includes('.html')) {
      parts.pop();
    }

    // Hahanapin natin kung nasa loob ba tayo ng subdirectory
    var knownSubdirs = ['teacher', 'classrecord', 'student', 'assets', 'data'];
    
    // Kung ang unang directory ay isa sa mga ito, nasa ROOT tayo (Vercel, custom domain)
    if (parts.length > 0 && knownSubdirs.includes(parts[0])) {
      return '/';
    }

    // Kung hindi, malamang nasa GitHub Pages subpath tayo (e.g. /general-science-app/teacher/)
    // Ibabalik natin hanggang sa root ng project
    for (var i = 0; i < parts.length; i++) {
      if (knownSubdirs.includes(parts[i])) {
        return parts.slice(0, i).join('/') + '/';
      }
    }

    // Fallback kung wala sa mga known subdirs (root parin)
    return '/';
  }

  function getAssetUrl(relativePath) {
    var base = getRepoBase();
    // Tinitiyak na walang dobleng slash (//) sa URL
    var safeBase = base.endsWith('/') ? base : base + '/';
    return safeBase + relativePath + '?v=' + CACHE_VERSION;
  }

  /* ============================================================
     DATA LOADING
     ============================================================ */
  async function loadCompetencies() {
    if (_compData) return _compData;
    var url = getAssetUrl('data/competencies.json');
    var res = await fetch(url);
    if (!res.ok) {
      throw new Error('Failed to load competencies.json (HTTP ' + res.status + ')');
    }
    var text = await res.text();
    try {
      _compData = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON from competencies.json: ' + e.message);
    }
    return _compData;
  }

  async function loadQuestionBank(term, assessment) {
    var url = getAssetUrl('student/' + term + '/assessments/' + assessment + '.json');
    var res = await fetch(url);
    if (!res.ok) {
      throw new Error('Failed to load ' + assessment + '.json (HTTP ' + res.status + ')');
    }
    var text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON from ' + assessment + '.json: ' + e.message);
    }
  }

  /* ============================================================
     COMPETENCY SELECTION
     ============================================================ */
  function getCompetenciesForST1(termData) {
    return termData.competencies.filter(function (c) {
      return c.weeks.some(function (w) { return w >= 1 && w <= 4; });
    });
  }

  function getCompetenciesForST2(termData) {
    return termData.competencies.filter(function (c) {
      return c.weeks.some(function (w) { return w >= 5 && w <= 8; });
    });
  }

  function getCompetenciesForTE(termData, stRanking) {
    var weeks910 = termData.competencies.filter(function (c) {
      return c.weeks.some(function (w) { return w >= 9 && w <= 10; });
    });

    var stCodes = {};
    getCompetenciesForST1(termData).forEach(function (c) { stCodes[c.code] = true; });
    getCompetenciesForST2(termData).forEach(function (c) { stCodes[c.code] = true; });

    var top5Least = (stRanking || [])
      .filter(function (r) { return stCodes[r.code]; })
      .slice(0, 5)
      .map(function (r) {
        return termData.competencies.find(function (c) { return c.code === r.code; });
      })
      .filter(Boolean);

    var merged = top5Least.slice();
    var seen = {};
    top5Least.forEach(function (c) { seen[c.code] = true; });
    weeks910.forEach(function (c) {
      if (!seen[c.code]) {
        merged.push(c);
        seen[c.code] = true;
      }
    });

    return merged;
  }

  /* ============================================================
     WEIGHT + ITEM COUNT
     ============================================================ */
  function computeWeights(competencies, totalItems) {
    var totalHours = competencies.reduce(function (sum, c) { return sum + (c.hours || 0); }, 0);
    if (totalHours === 0) throw new Error('Total hours is zero — cannot compute weights.');

    var rows = competencies.map(function (c) {
      var weight = (c.hours / totalHours) * 100;
      var rawItems = (weight / 100) * totalItems;
      var items = Math.round(rawItems);
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

    var sum = rows.reduce(function (s, r) { return s + r.items; }, 0);
    var diff = totalItems - sum;

    if (diff !== 0) {
      var withRemainder = rows.map(function (r) {
        return { row: r, remainder: r.rawItems - Math.floor(r.rawItems) };
      });

      if (diff > 0) {
        withRemainder
          .sort(function (a, b) { return b.remainder - a.remainder; })
          .slice(0, diff)
          .forEach(function (x) { x.row.items++; });
      } else {
        withRemainder
          .sort(function (a, b) { return a.remainder - b.remainder; })
          .filter(function (x) { return x.row.items > 1; })
          .slice(0, Math.abs(diff))
          .forEach(function (x) { x.row.items--; });
      }
    }

    return rows;
  }

  /* ============================================================
     BLOOM'S DISTRIBUTION
     ============================================================ */
  function distributeBlooms(rows) {
    return rows.map(function (row) {
      var items = row.items;
      var allowed = (row.bloomLevels && row.bloomLevels.length) ? row.bloomLevels : BLOOMS;

      var allowedLOTS = LOTS.filter(function (l) { return allowed.indexOf(l) !== -1; });
      var allowedHOTS = HOTS.filter(function (l) { return allowed.indexOf(l) !== -1; });

      var lotsTarget, hotsTarget;
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

      var distribution = {};
      BLOOMS.forEach(function (b) { distribution[b] = 0; });

      var remainingLOTS = lotsTarget;
      allowedLOTS.forEach(function (lvl) {
        var share = Math.floor(lotsTarget / allowedLOTS.length);
        distribution[lvl] = share;
        remainingLOTS -= share;
      });
      for (var i = 0; i < remainingLOTS; i++) {
        distribution[allowedLOTS[i % allowedLOTS.length]]++;
      }

      var remainingHOTS = hotsTarget;
      allowedHOTS.forEach(function (lvl) {
        var share = Math.floor(hotsTarget / allowedHOTS.length);
        distribution[lvl] = share;
        remainingHOTS -= share;
      });
      for (var j = 0; j < remainingHOTS; j++) {
        distribution[allowedHOTS[j % allowedHOTS.length]]++;
      }

      return {
        code: row.code,
        description: row.description,
        shortLabel: row.shortLabel,
        hours: row.hours,
        weeks: row.weeks,
        bloomLevels: row.bloomLevels,
        termExamPriority: row.termExamPriority,
        weightPercent: row.weightPercent,
        rawItems: row.rawItems,
        items: row.items,
        bloomDistribution: distribution,
        lotsCount: lotsTarget,
        hotsCount: hotsTarget,
        bloomSource: 'auto'
      };
    });
  }

  /* ============================================================
     MANUAL BLOOM'S OVERRIDES
     ============================================================ */
  function applyManualBlooms(rows, overrides) {
    if (!overrides) return rows;

    return rows.map(function (row) {
      var ov = overrides[row.code];
      if (!ov) return row;

      var sum = 0;
      var allowed = row.bloomLevels || BLOOMS;
      var invalid = [];
      BLOOMS.forEach(function (b) {
        var v = parseInt(ov[b], 10);
        if (isNaN(v) || v < 0) v = 0;
        sum += v;
        if (v > 0 && allowed.indexOf(b) === -1) {
          invalid.push(b);
        }
      });

      if (invalid.length > 0) {
        throw new Error(
          'Manual Bloom\'s override for ' + row.code +
          ' uses levels not allowed: ' + invalid.join(', ') +
          '. Allowed: ' + allowed.join(', ')
        );
      }

      if (sum !== row.items) {
        throw new Error(
          'Manual Bloom\'s override for ' + row.code +
          ' sums to ' + sum + ' but the competency has ' + row.items + ' items. ' +
          'Adjust the cells so the sum matches exactly.'
        );
      }

      var dist = {};
      BLOOMS.forEach(function (b) {
        var v = parseInt(ov[b], 10);
        dist[b] = (isNaN(v) || v < 0) ? 0 : v;
      });

      var lotsCount = dist.Remembering + dist.Understanding;
      var hotsCount = row.items - lotsCount;

      return {
        code: row.code,
        description: row.description,
        shortLabel: row.shortLabel,
        hours: row.hours,
        weeks: row.weeks,
        bloomLevels: row.bloomLevels,
        termExamPriority: row.termExamPriority,
        weightPercent: row.weightPercent,
        rawItems: row.rawItems,
        items: row.items,
        bloomDistribution: dist,
        lotsCount: lotsCount,
        hotsCount: hotsCount,
        bloomSource: 'manual'
      };
    });
  }

  /* ============================================================
     ITEM NUMBER ASSIGNMENT
     ============================================================ */
  function assignItemNumbers(rows) {
    var next = 1;
    return rows.map(function (row) {
      var from = next;
      var to = next + row.items - 1;
      next = to + 1;
      return {
        code: row.code,
        description: row.description,
        shortLabel: row.shortLabel,
        hours: row.hours,
        weeks: row.weeks,
        bloomLevels: row.bloomLevels,
        termExamPriority: row.termExamPriority,
        weightPercent: row.weightPercent,
        rawItems: row.rawItems,
        items: row.items,
        bloomDistribution: row.bloomDistribution,
        lotsCount: row.lotsCount,
        hotsCount: row.hotsCount,
        bloomSource: row.bloomSource,
        itemFrom: from,
        itemTo: to
      };
    });
  }

  /* ============================================================
     ANSWER KEY GENERATION
     ============================================================ */
  function buildAnswerKey(rows, questionBank) {
    var key = [];
    var questions = questionBank.questions || [];
    var mismatches = [];

    rows.forEach(function (row) {
      var startIdx = row.itemFrom - 1;
      var endIdx = row.itemTo;
      for (var i = startIdx; i < endIdx && i < questions.length; i++) {
        var q = questions[i] || {};
        if (q.competency && q.competency !== row.code) {
          mismatches.push({
            itemNo: i + 1,
            expected: row.code,
            actual: q.competency
          });
        }
        key.push({
          itemNo: i + 1,
          answer: q.correct || '—',
          options: q.options || [],
          competency: q.competency || row.code,
          shortLabel: row.shortLabel,
          bloomLevel: q.bloomLevel || row.bloomLevels[0] || 'Understanding'
        });
      }
    });

    if (mismatches.length > 0) {
      console.warn('[TOSEngine] Answer key competency mismatches:', mismatches);
    }

    return { key: key, mismatches: mismatches };
  }

  /* ============================================================
     AGGREGATE STATS
     ============================================================ */
  function computeTotals(rows) {
    var totals = {
      hours: 0,
      weightPercent: 0,
      items: 0,
      blooms: {}
    };
    BLOOMS.forEach(function (b) { totals.blooms[b] = 0; });

    rows.forEach(function (r) {
      totals.hours += r.hours;
      totals.weightPercent += r.weightPercent;
      totals.items += r.items;
      BLOOMS.forEach(function (b) {
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
     MPS COMPUTATION (Cloud-First Ready)
     ============================================================ */
  function rankByMPS(competencyMPS) {
    return competencyMPS.slice().sort(function (a, b) { return a.mps - b.mps; });
  }

  /**
   * Compute per-competency MPS from a single assessment.
   * Updated to support async Store methods (Cloud-First).
   */
  async function computeCompetencyMPS(students, term, type, assessment) {
    var result = {};
    var questions = assessment.questions || [];

    var byComp = {};
    questions.forEach(function (q, i) {
      var code = q.competency || 'UNKNOWN';
      if (!byComp[code]) byComp[code] = [];
      byComp[code].push(i);
    });

    Object.keys(byComp).forEach(function (code) {
      result[code] = { correct: 0, total: 0, mps: 0 };
    });

    for (var i = 0; i < students.length; i++) {
      var s = students[i];
      if (typeof Store === 'undefined' || !Store.getScores) continue;

      // Check kung async ang getScores (Cloud-First store)
      var scores;
      try {
        scores = await Store.getScores(s.lrn);
      } catch (e) {
        console.warn('Error fetching scores for', s.lrn, e);
        continue;
      }

      if (!scores) continue;
      var termScores = scores[term];
      if (!termScores) continue;

      var record = null;
      // Shape A — ST
      if (type === 'st' || type === 'st1' || type === 'st2') {
        if (termScores.st) {
          var key = (type === 'st1') ? 'st1' : (type === 'st2') ? 'st2' : assessment.id;
          record = termScores.st[key];
        }
      }
      // Shape B — TE
      if (!record && type === 'te') {
        record = termScores.te;
      }
      // Shape C — legacy
      if (!record && termScores[type] && termScores[type][assessment.id]) {
        record = termScores[type][assessment.id];
      }

      if (!record || !record.itemResults) continue;

      record.itemResults.forEach(function (r) {
        var idx = (typeof r.index === 'number') ? r.index : r.originalIndex;
        if (typeof idx !== 'number') return;
        var code = (questions[idx] && questions[idx].competency) || 'UNKNOWN';
        if (!result[code]) result[code] = { correct: 0, total: 0, mps: 0 };
        result[code].total++;
        if (r.correct) result[code].correct++;
      });
    }

    Object.keys(result).forEach(function (code) {
      var v = result[code];
      v.mps = v.total ? v.correct / v.total : 0;
    });

    return result;
  }

  async function computeAllCompetencyMPS(students, term) {
    var st1Bank, st2Bank;
    try {
      st1Bank = await loadQuestionBank(term, 'st1');
      st2Bank = await loadQuestionBank(term, 'st2');
    } catch (e) {
      console.warn('[TOSEngine] Could not load ST banks:', e);
      return [];
    }

    st1Bank.id = 'st1';
    st2Bank.id = 'st2';

    var mps1 = await computeCompetencyMPS(students, term, 'st1', st1Bank);
    var mps2 = await computeCompetencyMPS(students, term, 'st2', st2Bank);

    var merged = {};
    Object.keys(mps1).forEach(function (code) {
      merged[code] = { code: code, correct: mps1[code].correct, total: mps1[code].total };
    });
    Object.keys(mps2).forEach(function (code) {
      if (!merged[code]) merged[code] = { code: code, correct: 0, total: 0 };
      merged[code].correct += mps2[code].correct;
      merged[code].total += mps2[code].total;
    });

    var ranking = Object.keys(merged).map(function (code) {
      var r = merged[code];
      return { code: code, correct: r.correct, total: r.total, mps: r.total ? r.correct / r.total : 0 };
    });

    ranking.sort(function (a, b) { return a.mps - b.mps; });
    return ranking;
  }

  /* ============================================================
     SIGNATORIES
     ============================================================ */
  function loadLocalSignatories() {
    try {
      var raw = localStorage.getItem(SIG_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SIGS));
      var parsed = JSON.parse(raw);
      return {
        prepared: Object.assign({}, DEFAULT_SIGS.prepared, parsed.prepared || {}),
        checked:  Object.assign({}, DEFAULT_SIGS.checked,  parsed.checked  || {}),
        noted:    Object.assign({}, DEFAULT_SIGS.noted,    parsed.noted    || {})
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_SIGS));
    }
  }

  function saveLocalSignatories(sigs) {
    try { localStorage.setItem(SIG_KEY, JSON.stringify(sigs)); } catch (e) {}
  }

  async function getSignatories() {
    if (typeof Sync !== 'undefined' && typeof Sync.getSignatories === 'function') {
      try {
        var remote = await Sync.getSignatories();
        if (remote) {
          var merged = {
            prepared: Object.assign({}, DEFAULT_SIGS.prepared, remote.prepared || {}),
            checked:  Object.assign({}, DEFAULT_SIGS.checked,  remote.checked  || {}),
            noted:    Object.assign({}, DEFAULT_SIGS.noted,    remote.noted    || {})
          };
          saveLocalSignatories(merged);
          return { sigs: merged, source: 'backend' };
        }
      } catch (e) {
        console.warn('[TOSEngine] Backend signatory fetch failed, using local:', e.message);
      }
    }
    return { sigs: loadLocalSignatories(), source: 'local' };
  }

  async function saveSignatories(sigs) {
    saveLocalSignatories(sigs);

    if (typeof Sync !== 'undefined' && typeof Sync.saveSignatories === 'function') {
      try {
        await Sync.saveSignatories(sigs);
        return { source: 'backend' };
      } catch (e) {
        console.warn('[TOSEngine] Backend signatory save failed, saved locally:', e.message);
        return { source: 'local', warning: 'Saved locally — backend sync unavailable.' };
      }
    }
    return { source: 'local', warning: 'Saved locally — backend sync unavailable.' };
  }

  /* ============================================================
     MAIN ENTRY POINT
     ============================================================ */
  async function generateTOS(opts) {
    var compData = await loadCompetencies();
    var termData = compData[opts.term];
    if (!termData) throw new Error('Unknown term: ' + opts.term);

    var competencies = [];
    var coverage = '';

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

    var rows = computeWeights(competencies, opts.totalItems);
    rows = distributeBlooms(rows);

    if (opts.manualOverrides) {
      rows = applyManualBlooms(rows, opts.manualOverrides);
    }

    rows = assignItemNumbers(rows);

    var questionBank = { questions: [] };
    try {
      questionBank = await loadQuestionBank(opts.term, opts.assessment);
    } catch (e) {
      console.warn('[TOSEngine] Question bank not found:', e.message);
    }

    var akResult = buildAnswerKey(rows, questionBank);
    var totals = computeTotals(rows);

    return {
      term: opts.term,
      termTitle: termData.title,
      assessment: opts.assessment,
      coverage: coverage,
      totalItems: opts.totalItems,
      rows: rows,
      totals: totals,
      answerKey: akResult.key,
      answerKeyMismatches: akResult.mismatches
    };
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    getRepoBase: getRepoBase,
    getAssetUrl: getAssetUrl,
    loadCompetencies: loadCompetencies,
    loadQuestionBank: loadQuestionBank,
    getCompetenciesForST1: getCompetenciesForST1,
    getCompetenciesForST2: getCompetenciesForST2,
    getCompetenciesForTE: getCompetenciesForTE,
    computeWeights: computeWeights,
    distributeBlooms: distributeBlooms,
    applyManualBlooms: applyManualBlooms,
    assignItemNumbers: assignItemNumbers,
    buildAnswerKey: buildAnswerKey,
    computeTotals: computeTotals,
    rankByMPS: rankByMPS,
    computeCompetencyMPS: computeCompetencyMPS,
    computeAllCompetencyMPS: computeAllCompetencyMPS,
    getSignatories: getSignatories,
    saveSignatories: saveSignatories,
    loadLocalSignatories: loadLocalSignatories,
    saveLocalSignatories: saveLocalSignatories,
    generateTOS: generateTOS,
    BLOOMS: BLOOMS,
    LOTS: LOTS,
    HOTS: HOTS
  };
})();

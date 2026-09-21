/* ============================================================
   Code.gs — Google Apps Script backend for General Science App
   Version: 1.2.1
   ------------------------------------------------------------
   Changelog:
     v1.2.1: Fixed canonicalize() — removed arguments.callee hack
             that caused inconsistent canonical strings on V8.
             Now matches frontend sync.js exactly.
     v1.2.0: Added Attempts + History sheets, 5 new actions.
     v1.1.0: Added TermAccess sheet + 2 actions.
     v1.0.0: Initial — SyncCodes + Log.

   REDEPLOY (CRITICAL):
     Deploy → Manage deployments → (pencil) → Version: New version → Deploy
   The Web App URL stays the same. No config.js change needed.
   ============================================================ */

const CONFIG = {
  SYNC_CODES_SHEET: 'SyncCodes',
  TERM_ACCESS_SHEET: 'TermAccess',
  LOG_SHEET: 'Log',
  ATTEMPTS_SHEET: 'Attempts',
  HISTORY_SHEET: 'History',

  CODE_EXPIRY_DAYS: 30,
  ATTEMPT_EXPIRY_DAYS: 90,
  MAX_CODES_PER_STUDENT: 5,

  RATE_LIMIT_WINDOW_SEC: 60,
  RATE_LIMIT_MAX_PER_WINDOW: 30,

  HMAC_SECRET: 'GSA-2026-DEPED-SECRET-KEY-v1',

  ALLOWED_ORIGINS: '*',
  VALID_SECTIONS: ['ACADEMIC A', 'ACADEMIC B'],
  VALID_ASSESSMENTS: ['quiz1', 'quiz2', 'quiz3', 'st1', 'st2', 'te', 'pt1', 'pt2', 'pt3'],
  VALID_TERMS: ['term1', 'term2', 'term3']
};

// ============================================================
// MAIN ROUTER — POST
// ============================================================

function doPost(e) {
  var startedAt = Date.now();
  try {
    var body = parseBody(e);
    var action = body.action;

    logAction(action, body.lrn, body.pushId || body.code, 'received');

    if (action !== 'health') {
      var rl = checkRateLimit(body.lrn || body.ip || 'anonymous', action);
      if (!rl.ok) {
        logAction(action, body.lrn, '', 'rate_limited', rl.reason);
        return respond({ ok: false, error: 'Rate limit exceeded. Try again shortly.', retryAfterSec: rl.retryAfter });
      }
    }

    var response;
    switch (action) {
      case 'registerSyncCode':  response = registerSyncCode(body); break;
      case 'resolveSyncCode':   response = resolveSyncCode(body); break;
      case 'pullAllPending':    response = pullAllPending(body); break;
      case 'deleteSyncCode':    response = deleteSyncCode(body); break;
      case 'getTermAccess':     response = getTermAccess(body); break;
      case 'setTermAccess':     response = setTermAccess(body); break;
      case 'health':
        response = { ok: true, message: 'GSA backend is running', version: '1.2.1', time: new Date().toISOString() };
        break;
      case 'pushAttempt':       response = pushAttempt(body); break;
      case 'pullAttempts':      response = pullAttempts(body); break;
      case 'markUsedBulk':      response = markUsedBulk(body); break;
      case 'archiveUsed':       response = archiveUsed(body); break;
      case 'getSyncStatus':     response = getSyncStatus(body); break;
      default:
        response = { ok: false, error: 'Unknown action: ' + action };
    }

    response.serverMs = Date.now() - startedAt;
    logAction(action, body.lrn, body.pushId || body.code, response.ok ? 'success' : 'error', response.error || '');

    return respond(response);

  } catch (err) {
    logAction('doPost', '', '', 'exception', err.message);
    return respond({ ok: false, error: err.message, serverMs: Date.now() - startedAt });
  }
}

// ============================================================
// MAIN ROUTER — GET
// ============================================================

function doGet(e) {
  var action = e.parameter.action;

  if (action === 'ping') {
    return respond({ ok: true, service: 'GSA Sync Backend', version: '1.2.1', time: new Date().toISOString() });
  }
  if (action === 'count') {
    var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
    return respond({ ok: true, totalCodes: Math.max(0, sheet.getLastRow() - 1) });
  }
  if (action === 'termAccess') {
    return respond(getTermAccess({ section: e.parameter.section }));
  }
  if (action === 'attemptsCount') {
    var aSheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
    return respond({ ok: true, totalAttempts: Math.max(0, aSheet.getLastRow() - 1) });
  }

  return respond({ ok: false, error: 'Unknown action' });
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (err) { throw new Error('Invalid JSON body: ' + err.message); }
}

// ============================================================
// CANONICAL JSON + HMAC  (v1.2.1 — matches frontend exactly)
// ============================================================

function canonicalize(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'number') {
    if (isNaN(obj) || !isFinite(obj)) return 'null';
    return String(obj);
  }
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  if (typeof obj === 'object') {
    var keys = Object.keys(obj).filter(function (k) {
      if (k === 'signature') return false;
      return obj[k] !== undefined && typeof obj[k] !== 'function';
    });
    keys.sort();
    var parts = keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonicalize(obj[k]);
    });
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

function computeHMAC(message, secret) {
  var rawHmac = Utilities.computeHmacSha256Signature(message, secret);
  return rawHmac
    .map(function (byte) { return ((byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')); })
    .join('');
}

function verifyCanonicalSignature(payload, signature) {
  try {
    if (!payload || !signature) return false;
    var canonical = canonicalize(payload);
    var expected = computeHMAC(canonical, CONFIG.HMAC_SECRET);
    return constantTimeEquals(expected, signature);
  } catch (e) {
    return false;
  }
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// RATE LIMITING
// ============================================================

var _rateCache = {};

function checkRateLimit(key, action) {
  var now = Date.now();
  var windowMs = CONFIG.RATE_LIMIT_WINDOW_SEC * 1000;
  var cacheKey = key + '::' + action;

  if (!_rateCache[cacheKey]) {
    _rateCache[cacheKey] = { count: 1, windowStart: now };
    return { ok: true };
  }

  var entry = _rateCache[cacheKey];
  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    return { ok: true };
  }

  entry.count++;
  if (entry.count > CONFIG.RATE_LIMIT_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: 'Exceeded ' + CONFIG.RATE_LIMIT_MAX_PER_WINDOW + ' per ' + CONFIG.RATE_LIMIT_WINDOW_SEC + 's',
      retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000)
    };
  }
  return { ok: true };
}

// ============================================================
// ACTION: pushAttempt
// ============================================================

function pushAttempt(body) {
  var required = ['pushId', 'lrn', 'term', 'assessment', 'payload', 'signature'];
  for (var i = 0; i < required.length; i++) {
    if (!body[required[i]]) {
      return { ok: false, error: 'Missing required field: ' + required[i] };
    }
  }

  if (CONFIG.VALID_TERMS.indexOf(body.term) === -1) {
    return { ok: false, error: 'Invalid term: ' + body.term };
  }
  if (CONFIG.VALID_ASSESSMENTS.indexOf(body.assessment) === -1) {
    return { ok: false, error: 'Invalid assessment: ' + body.assessment };
  }

  if (!verifyCanonicalSignature(body.payload, body.signature)) {
    return { ok: false, error: 'Signature verification failed' };
  }

  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();

  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === body.pushId) {
      return { ok: true, pushId: body.pushId, duplicate: true, message: 'Attempt already recorded' };
    }
  }

  var student = (body.payload && body.payload.student) || {};
  var attempt = (body.payload && body.payload.attempt) || {};
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');
  var section = student.section || '';
  var serverTimestamp = new Date().toISOString();
  var clientTimestamp = body.clientTimestamp || attempt.timestamp || '';

  sheet.appendRow([
    body.pushId, body.lrn, studentName, section,
    body.term, body.assessment,
    Number(body.score || 0), Number(body.total || 0),
    JSON.stringify(body.itemResults || []),
    body.set || '',
    clientTimestamp, serverTimestamp,
    body.signature,
    'false', '', ''
  ]);

  return { ok: true, pushId: body.pushId, serverTimestamp: serverTimestamp, message: 'Attempt recorded' };
}

// ============================================================
// ACTION: pullAttempts
// ============================================================

function pullAttempts(body) {
  body = body || {};
  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var cutoffMs = Date.now() - (CONFIG.ATTEMPT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowLrn = row[1];
    var rowSection = row[3];
    var rowTerm = row[4];
    var rowAssessment = row[5];
    var used = row[13] === 'true' || row[13] === true;

    if (body.lrn && rowLrn !== body.lrn) continue;
    if (body.section && rowSection !== body.section) continue;
    if (body.term && rowTerm !== body.term) continue;
    if (body.assessment && rowAssessment !== body.assessment) continue;
    if (body.includeUsed !== true && used) continue;

    var serverTs = row[11];
    var serverMs = serverTs ? new Date(serverTs).getTime() : 0;
    if (serverMs && serverMs < cutoffMs) continue;

    var itemResults;
    try { itemResults = JSON.parse(row[8] || '[]'); }
    catch (e) { itemResults = []; }

    var payload = {
      student: { lrn: rowLrn, name: row[2], section: rowSection },
      attempt: {
        term: rowTerm, assessment: rowAssessment,
        score: Number(row[6] || 0), total: Number(row[7] || 0),
        itemResults: itemResults,
        set: row[9] || '',
        timestamp: row[10] || ''
      }
    };

    records.push({
      pushId: row[0], lrn: rowLrn, studentName: row[2], section: rowSection,
      term: rowTerm, assessment: rowAssessment,
      score: Number(row[6] || 0), total: Number(row[7] || 0),
      itemResults: itemResults, set: row[9] || '',
      clientTimestamp: row[10] || '', serverTimestamp: serverTs,
      signature: row[12], payload: payload,
      verified: verifyCanonicalSignature(payload, row[12])
    });
  }

  return { ok: true, count: records.length, records: records };
}

// ============================================================
// ACTION: markUsedBulk
// ============================================================

function markUsedBulk(body) {
  if (!body || !body.pushIds || !body.pushIds.length) {
    return { ok: false, error: 'Missing pushIds array' };
  }

  var usedBy = body.usedBy || 'teacher';
  var now = new Date().toISOString();
  var ids = {};
  body.pushIds.forEach(function (id) { ids[id] = true; });

  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var marked = 0;

  for (var i = 1; i < data.length; i++) {
    if (ids[data[i][0]]) {
      sheet.getRange(i + 1, 14).setValue('true');
      sheet.getRange(i + 1, 15).setValue(now);
      sheet.getRange(i + 1, 16).setValue(usedBy);
      marked++;
    }
  }

  return { ok: true, marked: marked, usedBy: usedBy, usedAt: now };
}

// ============================================================
// ACTION: archiveUsed
// ============================================================

function archiveUsed(body) {
  body = body || {};
  var olderThanDays = body.olderThanDays;
  var archivedBy = body.archivedBy || 'system';
  var cutoffMs = olderThanDays ? Date.now() - (olderThanDays * 24 * 60 * 60 * 1000) : Infinity;

  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var histSheet = getOrCreateSheet(CONFIG.HISTORY_SHEET);
  var data = sheet.getDataRange().getValues();

  var toArchive = [];
  var rowIndices = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var used = row[13] === 'true' || row[13] === true;
    if (!used) continue;
    var serverMs = row[11] ? new Date(row[11]).getTime() : 0;
    if (serverMs && serverMs > cutoffMs) continue;
    toArchive.push(row);
    rowIndices.push(i + 1);
  }

  if (!toArchive.length) return { ok: true, archived: 0, message: 'Nothing to archive' };

  var archivedAt = new Date().toISOString();
  toArchive.forEach(function (row) {
    histSheet.appendRow(row.concat([archivedAt, archivedBy]));
  });

  rowIndices.reverse().forEach(function (idx) { sheet.deleteRow(idx); });

  return { ok: true, archived: toArchive.length, archivedAt: archivedAt, archivedBy: archivedBy };
}

// ============================================================
// ACTION: getSyncStatus
// ============================================================

function getSyncStatus(body) {
  body = body || {};
  var attempts = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var aData = attempts.getDataRange().getValues();

  var totalPending = 0, totalUsed = 0;
  var perSection = {};

  for (var i = 1; i < aData.length; i++) {
    var row = aData[i];
    var section = row[3] || 'UNKNOWN';
    var used = row[13] === 'true' || row[13] === true;
    if (body.section && section !== body.section) continue;

    if (!perSection[section]) perSection[section] = { pending: 0, used: 0 };
    if (used) { totalUsed++; perSection[section].used++; }
    else { totalPending++; perSection[section].pending++; }
  }

  var hist = getOrCreateSheet(CONFIG.HISTORY_SHEET);
  var totalArchived = Math.max(0, hist.getLastRow() - 1);

  return {
    ok: true,
    totalPending: totalPending, totalUsed: totalUsed, totalArchived: totalArchived,
    perSection: perSection, serverTime: new Date().toISOString()
  };
}

// ============================================================
// EXISTING ACTIONS
// ============================================================

function registerSyncCode(body) {
  var code = body.code, lrn = body.lrn, payload = body.payload, signature = body.signature;
  if (!code || !lrn || !payload || !signature) {
    return { ok: false, error: 'Missing required fields (code, lrn, payload, signature)' };
  }
  if (!verifyCanonicalSignature(payload, signature)) {
    return { ok: false, error: 'Signature verification failed' };
  }

  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  if (findRowByCode(code)) return { ok: false, error: 'Code already exists' };

  var student = payload.student || {};
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');
  var section = student.section || '';
  var createdAt = new Date().toISOString();

  sheet.appendRow([code, lrn, studentName, section, JSON.stringify(payload), signature, createdAt, 'false']);
  trimOldCodes(lrn);

  return { ok: true, code: code, createdAt: createdAt, message: 'Sync code registered' };
}

function resolveSyncCode(body) {
  var code = body.code;
  if (!code) return { ok: false, error: 'Missing code' };

  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      var createdAt = new Date(data[i][6]);
      var ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > CONFIG.CODE_EXPIRY_DAYS) return { ok: false, error: 'Sync code has expired' };

      var payload = JSON.parse(data[i][4]);
      var signature = data[i][5];
      if (!verifyCanonicalSignature(payload, signature)) {
        return { ok: false, error: 'Stored data failed verification' };
      }
      return { ok: true, payload: payload, signature: signature, createdAt: data[i][6] };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function pullAllPending(body) {
  body = body || {};
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var used = row[7] === 'true' || row[7] === true;
    if (body.lrn && row[1] !== body.lrn) continue;
    if (body.section && row[3] !== body.section) continue;
    if (used) continue;

    var createdAt = new Date(row[6]);
    var ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > CONFIG.CODE_EXPIRY_DAYS) continue;

    var payload, signature;
    try { payload = JSON.parse(row[4]); signature = row[5]; }
    catch (e) { continue; }

    records.push({
      code: row[0], lrn: row[1], studentName: row[2], section: row[3],
      payload: payload, signature: signature, createdAt: row[6]
    });
  }

  return { ok: true, count: records.length, records: records };
}

function deleteSyncCode(body) {
  var code = body.code;
  if (!code) return { ok: false, error: 'Missing code' };
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      sheet.getRange(i + 1, 8).setValue('true');
      return { ok: true, message: 'Sync code marked as used' };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function getTermAccess(body) {
  var sheet = getOrCreateSheet(CONFIG.TERM_ACCESS_SHEET);
  var data = sheet.getDataRange().getValues();
  var sections = CONFIG.VALID_SECTIONS;
  var latest = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var section = row[1];
    if (sections.indexOf(section) === -1) continue;
    var ts = new Date(row[0]).getTime();
    if (!latest[section] || ts > latest[section].at) {
      latest[section] = {
        at: ts,
        access: {
          term1: row[2] === 'open' ? 'open' : 'locked',
          term2: row[3] === 'open' ? 'open' : 'locked',
          term3: row[4] === 'open' ? 'open' : 'locked'
        }
      };
    }
  }

  var all = {};
  sections.forEach(function (sec) {
    all[sec] = latest[sec] ? latest[sec].access : { term1: 'locked', term2: 'locked', term3: 'locked' };
  });

  if (body && body.section) {
    return { ok: true, section: body.section, access: all[body.section] || { term1: 'locked', term2: 'locked', term3: 'locked' } };
  }
  return { ok: true, all: all };
}

function setTermAccess(body) {
  var section = body.section, access = body.access;
  if (!section || !access) return { ok: false, error: 'Missing section or access' };
  if (CONFIG.VALID_SECTIONS.indexOf(section) === -1) return { ok: false, error: 'Invalid section: ' + section };

  var sheet = getOrCreateSheet(CONFIG.TERM_ACCESS_SHEET);
  sheet.appendRow([
    new Date().toISOString(), section,
    access.term1 === 'open' ? 'open' : 'locked',
    access.term2 === 'open' ? 'open' : 'locked',
    access.term3 === 'open' ? 'open' : 'locked',
    body.updatedBy || 'teacher',
    body.notes || ''
  ]);

  return {
    ok: true, section: section,
    access: {
      term1: access.term1 === 'open' ? 'open' : 'locked',
      term2: access.term2 === 'open' ? 'open' : 'locked',
      term3: access.term3 === 'open' ? 'open' : 'locked'
    }
  };
}

// ============================================================
// SHEET HELPERS
// ============================================================

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === CONFIG.SYNC_CODES_SHEET) {
      sheet.appendRow(['code', 'lrn', 'studentName', 'section', 'payload', 'signature', 'createdAt', 'used']);
      sheet.setFrozenRows(1);
    } else if (name === CONFIG.TERM_ACCESS_SHEET) {
      sheet.appendRow(['timestamp', 'section', 'term1', 'term2', 'term3', 'updatedBy', 'notes']);
      sheet.setFrozenRows(1);
    } else if (name === CONFIG.LOG_SHEET) {
      sheet.appendRow(['timestamp', 'action', 'lrn', 'code', 'status', 'notes']);
      sheet.setFrozenRows(1);
    } else if (name === CONFIG.ATTEMPTS_SHEET) {
      sheet.appendRow([
        'pushId', 'lrn', 'studentName', 'section',
        'term', 'assessment', 'score', 'total',
        'itemResults', 'set', 'clientTimestamp', 'serverTimestamp',
        'signature', 'used', 'usedAt', 'usedBy'
      ]);
      sheet.setFrozenRows(1);
    } else if (name === CONFIG.HISTORY_SHEET) {
      sheet.appendRow([
        'pushId', 'lrn', 'studentName', 'section',
        'term', 'assessment', 'score', 'total',
        'itemResults', 'set', 'clientTimestamp', 'serverTimestamp',
        'signature', 'used', 'usedAt', 'usedBy',
        'archivedAt', 'archivedBy'
      ]);
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

function findRowByCode(code) {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code) return { row: i + 1, data: data[i] };
  }
  return null;
}

function trimOldCodes(lrn) {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === lrn) {
      rows.push({ rowIndex: i + 1, createdAt: new Date(data[i][6]) });
    }
  }

  if (rows.length > CONFIG.MAX_CODES_PER_STUDENT) {
    rows.sort(function (a, b) { return a.createdAt - b.createdAt; });
    var toDelete = rows.slice(0, rows.length - CONFIG.MAX_CODES_PER_STUDENT);
    toDelete.reverse().forEach(function (r) { sheet.deleteRow(r.rowIndex); });
  }
}

// ============================================================
// LOGGING
// ============================================================

function logAction(action, lrn, code, status, notes) {
  try {
    var sheet = getOrCreateSheet(CONFIG.LOG_SHEET);
    if (sheet.getLastRow() > 5000) {
      var toDelete = sheet.getLastRow() - 5000;
      sheet.deleteRows(2, toDelete);
    }
    sheet.appendRow([
      new Date().toISOString(),
      action || '', lrn || '', code || '',
      status || '', notes || ''
    ]);
  } catch (e) {
    console.error('Log error:', e);
  }
}

// ============================================================
// MANUAL MAINTENANCE
// ============================================================

function cleanupOldCodes() {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  var cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
  var toDelete = [];
  for (var i = 1; i < data.length; i++) {
    if (new Date(data[i][6]).getTime() < cutoff) toDelete.push(i + 1);
  }
  toDelete.reverse().forEach(function (idx) { sheet.deleteRow(idx); });
  return { deleted: toDelete.length };
}

function clearLog() {
  var sheet = getOrCreateSheet(CONFIG.LOG_SHEET);
  sheet.clear();
  sheet.appendRow(['timestamp', 'action', 'lrn', 'code', 'status', 'notes']);
  return { cleared: true };
}

function testSignatureCheck(code) {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      var payload = JSON.parse(data[i][4]);
      var signature = data[i][5];
      var expected = computeHMAC(canonicalize(payload), CONFIG.HMAC_SECRET);
      return {
        code: code,
        matches: expected === signature,
        storedSignature: signature,
        computedSignature: expected,
        canonical: canonicalize(payload)
      };
    }
  }
  return { error: 'Code not found' };
}

function viewTermAccess() { return getTermAccess({}); }

function resetTermAccess(section) {
  var sheet = getOrCreateSheet(CONFIG.TERM_ACCESS_SHEET);
  sheet.appendRow([
    new Date().toISOString(),
    section || 'ACADEMIC A',
    'locked', 'locked', 'locked',
    'system-reset', 'Manual reset'
  ]);
  return { ok: true, message: 'Reset ' + (section || 'ACADEMIC A') + ' to all locked' };
}

function manualArchiveOld() {
  return archiveUsed({ olderThanDays: 60, archivedBy: 'manual' });
}

function testCanonicalSigning() {
  var sample = {
    version: '2.0.0',
    student: { lrn: '123456789012', lastName: 'Dela Cruz', firstName: 'Juan', section: 'ACADEMIC A' },
    attempt: { term: 'term1', assessment: 'quiz1', score: 18, total: 20 }
  };
  var canonical = canonicalize(sample);
  var sig = computeHMAC(canonical, CONFIG.HMAC_SECRET);
  return {
    canonical: canonical,
    signature: sig,
    verified: verifyCanonicalSignature(sample, sig)
  };
}

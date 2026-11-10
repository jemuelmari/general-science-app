/* ============================================================
   Code.gs — Google Apps Script backend for General Science App
   Version: 1.9.3 (Ghost-row, Merge, UNIDENTIFIED Repair & Faster Sync)
   ------------------------------------------------------------
   Changelog v1.9.3:
     - PERF: loginStudent/syncStudentProgress read only column A to find
       the student, then just that one row (was: whole sheet incl. every
       50KB progress cell) -> far fewer 'Server busy' errors when the
       whole class syncs at once.
   Changelog v1.9.2:
     - FIX: loginStudent() treats UNIDENTIFIED placeholder as 'not registered'.
     - ADDED: previewUnidentified() / repairUnidentified() to resolve
       placeholder students from other sheets or remove empty ones.
   Changelog v1.9.1:
     - FIX: loginStudent() is now READ-ONLY. It no longer inserts
       blank rows (source of ghost / "missing" LRNs).
     - FIX: syncStudentProgress() rejects unregistered LRNs that
       come without a name, ignores "New Student" placeholder,
       validates section, writes cells as text (no Date coercion).
     - FIX: mergeProgressData() keeps ONE whole score record
       (highest percent) instead of a hybrid; locks/unlocks are
       replaced, not Object.assign'ed (deleted locks now vanish).
     - ADDED: _iso(), _isPlaceholderName(), deleteEmptyGhostRows().
   Changelog v1.9.0:
     - ADDED: fixEmptyStudentNames(), fixSpecificMissingLRNs().
   ============================================================ */

const CONFIG = {
  SYNC_CODES_SHEET: 'SyncCodes',
  TERM_ACCESS_SHEET: 'TermAccess',
  LOG_SHEET: 'Log',
  ATTEMPTS_SHEET: 'Attempts',
  HISTORY_SHEET: 'History',
  UNLOCKS_SHEET: 'Unlocks',
  LOCKS_SHEET: 'Locks',
  REQUESTS_SHEET: 'UnlockRequests',
  PT_FILES_SHEET: 'PTFiles',
  PT_GRADES_SHEET: 'PTGrades',
  PT_UNLOCK_REQUESTS_SHEET: 'PTUnlockRequests',
  STUDENTS_MASTER_SHEET: 'StudentsMaster',

  PT_DRIVE_FOLDER_ID: '1ecTB98tuU6mVElteVVKJavQRv2xgz21t',

  CODE_EXPIRY_DAYS: 30,
  ATTEMPT_EXPIRY_DAYS: 90,
  UNLOCK_EXPIRY_DAYS: 60,
  LOCK_EXPIRY_DAYS: 120,
  REQUEST_CODE_EXPIRY_DAYS: 7,
  PT_REUPLOAD_CODE_EXPIRY_DAYS: 7,
  MAX_CODES_PER_STUDENT: 5,
  PT_MAX_FILE_BYTES: 25 * 1024 * 1024,

  RATE_LIMIT_WINDOW_SEC: 60,
  RATE_LIMIT_MAX_PER_WINDOW: 100,

  HMAC_SECRET: 'GSA-2026-DEPED-SECRET-KEY-v1',
  TEACHER_TOKEN_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  ALLOWED_ORIGINS: '*',
  VALID_SECTIONS: ['ACADEMIC A', 'ACADEMIC B'],
  VALID_ASSESSMENTS: ['quiz1', 'quiz2', 'quiz3', 'st1', 'st2', 'te', 'pt1', 'pt2', 'pt3'],
  VALID_TERMS: ['term1', 'term2', 'term3']
};

const LEGACY_CUTOFF = '2026-10-29T00:00:00Z';

var UNLOCKS_HEADERS = ['unlockId','lrn','term','assessment','reason','pushedAt','status','appliedAt','unlockedBy','forceUnlock'];
var LOCKS_HEADERS = ['lockId','lrn','term','assessment','reason','score','lockedAt','studentName','section'];
var REQUESTS_HEADERS = ['requestId','lrn','studentName','section','term','assessment','reason','score','total','requestedAt','status','unlockCode','codeGeneratedAt','codeExpiresAt','appliedAt'];
var PT_FILES_HEADERS = ['fileId','lrn','studentName','section','term','ptId','driveFileId','driveUrl','originalFilename','renamedFilename','mimeType','fileSize','uploadedAt','syncedFrom','isLegacy','reflection','option'];
var PT_GRADES_HEADERS = ['gradeId','lrn','studentName','section','term','ptId','rubricScores','totalScore','teacherNotes','gradedAt','gradedBy','syncedToStudent','syncedAt'];
var PT_UNLOCK_REQUESTS_HEADERS = ['requestId','lrn','studentName','section','term','ptId','reason','currentGrade','requestedAt','status','unlockCode','codeGeneratedAt','codeExpiresAt','appliedAt'];
var STUDENTS_MASTER_HEADERS = ['lrn','lastName','firstName','middleName','sex','section','progressJSON','lastSyncedAt','createdAt','updatedAt','integrityHash','deviceId'];

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
        return respond({ ok: false, error: 'Rate limit exceeded.', retryAfterSec: rl.retryAfter });
      }
    }

    var response;
    switch (action) {
      case 'loginStudent':           response = loginStudent(body); break;
      case 'syncStudentProgress':    response = syncStudentProgress(body); break;
      case 'pullTeacherDashboard':   response = pullTeacherDashboard(body); break;
      case 'registerSyncCode':       response = registerSyncCode(body); break;
      case 'resolveSyncCode':        response = resolveSyncCode(body); break;
      case 'pullAllPending':         response = pullAllPending(body); break;
      case 'deleteSyncCode':         response = deleteSyncCode(body); break;
      case 'getTermAccess':          response = getTermAccess(body); break;
      case 'setTermAccess':          response = setTermAccess(body); break;
      case 'health':                 response = { ok: true, message: 'GSA backend is running', version: '1.9.3', time: new Date().toISOString() }; break;
      case 'pushAttempt':            response = pushAttempt(body); break;
      case 'pullAttempts':           response = pullAttempts(body); break;
      case 'markUsedBulk':           response = markUsedBulk(body); break;
      case 'archiveUsed':            response = archiveUsed(body); break;
      case 'getSyncStatus':          response = getSyncStatus(body); break;
      case 'pushUnlock':             response = pushUnlock(body); break;
      case 'pullUnlocks':            response = pullUnlocks(body); break;
      case 'markUnlockApplied':      response = markUnlockApplied(body); break;
      case 'revokeUnlock':           response = revokeUnlock(body); break;
      case 'getAllUnlocks':          response = getAllUnlocks(body); break;
      case 'getUnlockStatus':        response = getUnlockStatus(body); break;
      case 'pushLock':               response = pushLock(body); break;
      case 'pullLocks':              response = pullLocks(body); break;
      case 'deleteLock':             response = deleteLock(body); break;
      case 'requestRetake':          response = requestRetake(body); break;
      case 'getStudentRequests':     response = getStudentRequests(body); break;
      case 'getUnlockRequests':      response = getUnlockRequests(body); break;
      case 'approveRetake':          response = approveRetake(body); break;
      case 'cancelRequest':          response = cancelRequest(body); break;
      case 'redeemUnlockCode':       response = redeemUnlockCode(body); break;
      case 'uploadPT':               response = uploadPT(body); break;
      case 'listPTFiles':            response = listPTFiles(body); break;
      case 'savePTGrade':            response = savePTGrade(body); break;
      case 'pullPTGrades':           response = pullPTGrades(body); break;
      case 'getPTGradeStatus':       response = getPTGradeStatus(body); break;
      case 'markPTLegacy':           response = markPTLegacy(body); break;
      case 'requestPTReupload':      response = requestPTReupload(body); break;
      case 'getPTReuploadRequests':  response = getPTReuploadRequests(body); break;
      case 'approvePTReupload':      response = approvePTReupload(body); break;
      case 'redeemPTReuploadCode':   response = redeemPTReuploadCode(body); break;
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

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'ping') return respond({ ok: true, service: 'GSA Sync Backend', version: '1.9.3', time: new Date().toISOString() });
  if (action === 'count') {
    var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
    return respond({ ok: true, totalCodes: Math.max(0, sheet.getLastRow() - 1) });
  }
  if (action === 'termAccess') return respond(getTermAccess({ section: e.parameter.section }));
  if (action === 'attemptsCount') {
    var aSheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
    return respond({ ok: true, totalAttempts: Math.max(0, aSheet.getLastRow() - 1) });
  }
  return respond({ ok: false, error: 'Unknown action' });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (err) { throw new Error('Invalid JSON body: ' + err.message); }
}

function requireTeacherToken(token) {
  if (!token) throw new Error('Teacher token required');
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  var hex = hash.map(function (b) { return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0'); }).join('');
  if (hex !== CONFIG.TEACHER_TOKEN_HASH) throw new Error('Invalid teacher token');
}

/* ===== HELPER FUNCTIONS ===== */
function _withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); }
  catch (e) { return { ok: false, error: 'Server busy. Please try again.', busy: true }; }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function _lrnKey(v) {
  var d = String(v === null || v === undefined ? '' : v).trim().replace(/\.0$/, '').replace(/\D/g, '');
  if (d.length > 0 && d.length < 12) d = ('000000000000' + d).slice(-12);
  return d;
}

// Finds the sheet row (1-based) of an LRN by reading ONLY column A. 0 = not found.
function _findStudentRow(sheet, cleanLrn) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var col = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (_lrnKey(col[i][0]) === cleanLrn) return i + 2;
  }
  return 0;
}

// Sheets may auto-convert ISO strings to Date objects. Always return a string.
function _iso(v) {
  if (v instanceof Date) return v.toISOString();
  return v || '';
}

// "New Student" is only a placeholder from the old frontend, not a real name.
function _isPlaceholderName(info) {
  return String(info.lastName || '').trim().toUpperCase() === 'NEW' &&
         String(info.firstName || '').trim().toUpperCase() === 'STUDENT';
}

function _stripHeavy(obj) {
  var HEAVY = { itemResults: 1, breakdown: 1, items: 1, answers: 1 };
  function walk(o) {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      var out = {};
      Object.keys(o).forEach(function (k) { if (!HEAVY[k]) out[k] = walk(o[k]); });
      return out;
    }
    return o;
  }
  return walk(obj);
}

function _safeJson(obj, lrn) {
  var s = JSON.stringify(obj);
  if (s.length <= 45000) return s;
  s = JSON.stringify(_stripHeavy(obj));
  logAction('syncStudentProgress', lrn, '', 'oversize', 'progress stripped, len=' + s.length);
  if (s.length > 49000) throw new Error('Progress data too large to store.');
  return s;
}

/* ===== CORE AUTH & SYNC ===== */

// READ-ONLY. Never inserts a row. Registration (syncStudentProgress with a
// name) is the only thing that creates a student row.
function loginStudent(body) {
  var lrn = String(body.lrn || '').trim();
  if (!lrn) return { ok: false, error: 'Missing LRN' };
  var cleanLrn = _lrnKey(lrn);
  if (cleanLrn.length !== 12) return { ok: false, error: 'Invalid LRN format. Must be 12 digits.' };

  var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var foundRow = _findStudentRow(sheet, cleanLrn);

  if (foundRow) {
    var r = sheet.getRange(foundRow, 1, 1, 12).getValues()[0];
    var progressJSON = {};
    try { progressJSON = JSON.parse(r[6] || '{}'); } catch (e) { progressJSON = {}; }
    if (!progressJSON || typeof progressJSON !== 'object') progressJSON = {};

    var hasName = (String(r[1] || '').trim() || String(r[2] || '').trim()) &&
                  String(r[1] || '').trim().toUpperCase() !== 'UNIDENTIFIED';
    return {
      ok: true,
      // A row without a real name (ghost / UNIDENTIFIED) = registration never completed
      isNew: !hasName,
      student: {
        lrn: cleanLrn, lastName: r[1], firstName: r[2], middleName: r[3],
        sex: r[4], section: r[5], progress: progressJSON, lastSyncedAt: _iso(r[7])
      }
    };
  }

  return {
    ok: true, isNew: true,
    student: { lrn: cleanLrn, lastName: '', firstName: '', middleName: '', sex: '', section: '', progress: {}, lastSyncedAt: '' }
  };
}

function syncStudentProgress(body) {
  var cleanLrn = _lrnKey(body.lrn);
  var progressJSON = body.progressJSON || {};
  var deviceId = String(body.deviceId || '');
  var integrityHash = String(body.integrityHash || '');
  var studentInfo = body.studentInfo || {};

  if (!cleanLrn) return { ok: false, error: 'Missing LRN' };

  if (_isPlaceholderName(studentInfo)) studentInfo = {};
  if (studentInfo.section) {
    var sec = String(studentInfo.section).trim().toUpperCase();
    if (CONFIG.VALID_SECTIONS.indexOf(sec) === -1) delete studentInfo.section;
    else studentInfo.section = sec;
  }

  var expectedHash = computeSimpleHash(JSON.stringify(progressJSON));
  if (integrityHash && integrityHash !== expectedHash) {
    return { ok: false, error: 'Integrity check failed.', expectedHash: expectedHash, receivedHash: integrityHash };
  }

  return _withScriptLock(function () {
    var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
    var now = new Date().toISOString();
    var incomingProgress = (progressJSON && typeof progressJSON === 'object') ? progressJSON : {};
    var foundRow = _findStudentRow(sheet, cleanLrn);

    if (foundRow) {
      var rowIndex = foundRow;
      var row = sheet.getRange(foundRow, 1, 1, 12).getValues()[0];
      while (row.length < 12) row.push('');

      if (studentInfo.lastName)   row[1] = studentInfo.lastName;
      if (studentInfo.firstName)  row[2] = studentInfo.firstName;
      if (studentInfo.middleName) row[3] = studentInfo.middleName;
      if (studentInfo.sex)        row[4] = studentInfo.sex;
      if (studentInfo.section)    row[5] = studentInfo.section;

      var existingProgress = {};
      try {
        var rawExisting = row[6];
        if (rawExisting && rawExisting !== 'null' && rawExisting !== 'undefined') {
          var parsed = JSON.parse(rawExisting);
          existingProgress = (parsed && typeof parsed === 'object') ? parsed : {};
        }
      } catch (e) { existingProgress = {}; }

      var merged = mergeProgressData(existingProgress, incomingProgress);
      row[6]  = _safeJson(merged, cleanLrn);
      row[7]  = now;
      row[8]  = _iso(row[8]) || now;
      row[9]  = now;
      row[10] = expectedHash;
      row[11] = deviceId;

      // '@' = plain text, so Sheets does not turn ISO strings into Date objects
      sheet.getRange(rowIndex, 2, 1, 11).setNumberFormat('@').setValues([row.slice(1, 12)]);
      return { ok: true, syncedAt: now, hash: expectedHash, merged: true };
    }

    // Unknown LRN without a name would become a ghost row — refuse it.
    if (!studentInfo.lastName || !studentInfo.firstName) {
      logAction('syncStudentProgress', cleanLrn, '', 'rejected', 'Unregistered LRN without name');
      return { ok: false, notRegistered: true, error: 'Student is not registered yet. Please register first.' };
    }

    var newRowIdx = sheet.getLastRow() + 1;
    sheet.getRange(newRowIdx, 1, 1, 12).setNumberFormat('@');
    sheet.getRange(newRowIdx, 1, 1, 12).setValues([[
      cleanLrn,
      String(studentInfo.lastName).trim(),
      String(studentInfo.firstName).trim(),
      String(studentInfo.middleName || '').trim(),
      String(studentInfo.sex || '').trim(),
      String(studentInfo.section || '').trim(),
      _safeJson(incomingProgress, cleanLrn), now, now, now, expectedHash, deviceId
    ]]);

    return { ok: true, syncedAt: now, hash: expectedHash, isNew: true };
  });
}

function mergeProgressData(existing, incoming) {
  if (!existing || typeof existing !== 'object') existing = {};
  if (!incoming || typeof incoming !== 'object') incoming = {};

  var merged = {};
  try { merged = JSON.parse(JSON.stringify(existing)); } catch (e) { merged = {}; }
  if (!merged || typeof merged !== 'object') merged = {};

  // progress (completed days): union
  if (incoming.progress && typeof incoming.progress === 'object') {
    if (!merged.progress || typeof merged.progress !== 'object') merged.progress = {};
    Object.keys(incoming.progress).forEach(function (term) {
      var incTerm = incoming.progress[term];
      if (!incTerm || typeof incTerm !== 'object') return;
      if (!merged.progress[term] || typeof merged.progress[term] !== 'object') {
        merged.progress[term] = { completed: [], weeks: {} };
      }
      if (!Array.isArray(merged.progress[term].completed)) merged.progress[term].completed = [];
      var incomingCompleted = Array.isArray(incTerm.completed) ? incTerm.completed : [];
      incomingCompleted.forEach(function (dayId) {
        if (merged.progress[term].completed.indexOf(dayId) === -1) merged.progress[term].completed.push(dayId);
      });
      if (incTerm.weeks && typeof incTerm.weeks === 'object') {
        if (!merged.progress[term].weeks) merged.progress[term].weeks = {};
        Object.assign(merged.progress[term].weeks, incTerm.weeks);
      }
    });
  }

  // scores: keep ONE whole record (the higher percent). Previously a hybrid
  // (score/percent from one attempt, passed/timestamp/itemResults from another).
  if (incoming.scores && typeof incoming.scores === 'object') {
    if (!merged.scores) merged.scores = {};
    Object.keys(incoming.scores).forEach(function (term) {
      if (!merged.scores[term]) merged.scores[term] = {};
      var incTermScores = incoming.scores[term];
      if (!incTermScores || typeof incTermScores !== 'object') return;
      Object.keys(incTermScores).forEach(function (type) {
        if (!merged.scores[term][type]) merged.scores[term][type] = {};
        var incTypeScores = incTermScores[type];
        if (!incTypeScores || typeof incTypeScores !== 'object') return;
        Object.keys(incTypeScores).forEach(function (id) {
          var inc = incTypeScores[id];
          if (!inc || typeof inc !== 'object') return;
          var ex = merged.scores[term][type][id];
          if (!ex || typeof ex !== 'object' || (ex.percent === undefined && ex.score === undefined)) {
            merged.scores[term][type][id] = inc;
            return;
          }
          var incPct = Number(inc.percent !== undefined ? inc.percent : (inc.total ? inc.score / inc.total * 100 : 0)) || 0;
          var exPct = Number(ex.percent !== undefined ? ex.percent : (ex.total ? ex.score / ex.total * 100 : 0)) || 0;
          if (incPct > exPct) merged.scores[term][type][id] = inc;
          else if (incPct === exPct && String(inc.timestamp || '') > String(ex.timestamp || '')) merged.scores[term][type][id] = inc;
        });
      });
    });
  }

  if (incoming.badges && typeof incoming.badges === 'object') {
    if (!merged.badges) merged.badges = {};
    Object.keys(incoming.badges).forEach(function (term) {
      if (!merged.badges[term]) merged.badges[term] = [];
      var incBadges = Array.isArray(incoming.badges[term]) ? incoming.badges[term] : [];
      incBadges.forEach(function (b) {
        if (merged.badges[term].indexOf(b) === -1) merged.badges[term].push(b);
      });
    });
  }

  // locks/unlocks: the device sends its full state, so REPLACE (an unlocked
  // assessment must disappear from the server too).
  if (incoming.locks && typeof incoming.locks === 'object') merged.locks = incoming.locks;
  if (incoming.unlocks && typeof incoming.unlocks === 'object') merged.unlocks = incoming.unlocks;

  return merged;
}

function pullTeacherDashboard(body) {
  requireTeacherToken(body.token);
  var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var data = sheet.getDataRange().getValues();
  var students = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    var progress = {};
    try { progress = JSON.parse(row[6] || '{}'); } catch(e) {}
    if (!progress || typeof progress !== 'object') progress = {};

    var cleanLrn = _lrnKey(row[0]);
    if (!cleanLrn) continue;

    students.push({
      lrn: cleanLrn,
      lastName: row[1] || '',
      firstName: row[2] || '',
      middleName: row[3] || '',
      sex: row[4] || '',
      section: row[5] || '',
      progress: progress,
      lastSyncedAt: _iso(row[7]),
      createdAt: _iso(row[8]),
      updatedAt: _iso(row[9]),
      integrityHash: row[10] || '',
      deviceId: row[11] || ''
    });
  }
  return { ok: true, count: students.length, students: students };
}

function computeSimpleHash(str) {
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

/* ===== ATTEMPTS ===== */
function isLegacyAttempt(serverTimestamp) {
  if (!serverTimestamp) return false;
  var cutoff = new Date(LEGACY_CUTOFF);
  var attemptTime = new Date(serverTimestamp);
  return attemptTime < cutoff;
}

function pushAttempt(body) {
  var required = ['pushId', 'lrn', 'term', 'assessment', 'payload', 'signature'];
  for (var i = 0; i < required.length; i++) if (!body[required[i]]) return { ok: false, error: 'Missing ' + required[i] };
  if (CONFIG.VALID_TERMS.indexOf(body.term) === -1) return { ok: false, error: 'Invalid term' };
  if (CONFIG.VALID_ASSESSMENTS.indexOf(body.assessment) === -1) return { ok: false, error: 'Invalid assessment' };

  var cleanLrn = _lrnKey(body.lrn);
  if (!cleanLrn) return { ok: false, error: 'Invalid LRN' };

  var serverTimestamp = new Date().toISOString();
  var isLegacy = isLegacyAttempt(serverTimestamp);
  if (!isLegacy) {
    if (!verifyCanonicalSignature(body.payload, body.signature)) return { ok: false, error: 'Signature verification failed' };
  }

  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) if (data[r][0] === body.pushId) return { ok: true, pushId: body.pushId, duplicate: true };
  var student = (body.payload && body.payload.student) || {};
  var attempt = (body.payload && body.payload.attempt) || {};

  sheet.appendRow([
    body.pushId,
    cleanLrn,
    (student.lastName || '') + ', ' + (student.firstName || ''),
    student.section || '',
    body.term,
    body.assessment,
    Number(body.score || 0),
    Number(body.total || 0),
    JSON.stringify(body.itemResults || []),
    body.set || '',
    body.clientTimestamp || attempt.timestamp || '',
    serverTimestamp,
    body.signature,
    'false',
    '',
    '',
    JSON.stringify(body.payload)
  ]);
  return { ok: true, pushId: body.pushId, serverTimestamp: serverTimestamp };
}

function pullAttempts(body) {
  body = body || {};
  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var cutoffMs = Date.now() - (CONFIG.ATTEMPT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  var searchLrn = body.lrn ? _lrnKey(body.lrn) : null;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var used = row[13] === 'true' || row[13] === true;
    if (searchLrn && _lrnKey(row[1]) !== searchLrn) continue;
    if (body.section && row[3] !== body.section) continue;
    if (body.term && row[4] !== body.term) continue;
    if (body.assessment && row[5] !== body.assessment) continue;
    if (body.includeUsed !== true && used) continue;
    var serverMs = row[11] ? new Date(row[11]).getTime() : 0;
    if (serverMs && serverMs < cutoffMs) continue;

    var itemResults; try { itemResults = JSON.parse(row[8] || '[]'); } catch (e) { itemResults = []; }

    var originalPayloadJSON = row[16];
    var payload;
    var canVerify = false;

    if (originalPayloadJSON) {
      try {
        payload = JSON.parse(originalPayloadJSON);
        canVerify = true;
      } catch (e) {
        payload = null;
      }
    }

    if (!payload) {
      payload = {
        student: { lrn: String(row[1]), name: row[2], section: row[3] },
        attempt: {
          term: row[4], assessment: row[5], score: Number(row[6] || 0), total: Number(row[7] || 0),
          itemResults: itemResults, set: row[9] || '', timestamp: row[10] || ''
        }
      };
    }

    var isLegacy = isLegacyAttempt(row[11]);
    var isValid = canVerify ? verifyCanonicalSignature(payload, row[12]) : false;

    records.push({
      pushId: row[0], lrn: _lrnKey(row[1]), studentName: row[2], section: row[3],
      term: row[4], assessment: row[5], score: Number(row[6] || 0), total: Number(row[7] || 0),
      itemResults: itemResults, set: row[9] || '', clientTimestamp: row[10] || '',
      serverTimestamp: row[11], signature: row[12], payload: payload,
      verified: isValid, legacyAmnesty: isLegacy && !isValid && !canVerify
    });
  }
  return { ok: true, count: records.length, records: records };
}

function markUsedBulk(body) {
  if (!body || !body.pushIds || !body.pushIds.length) return { ok: false, error: 'Missing pushIds' };
  var usedBy = body.usedBy || 'teacher';
  var now = new Date().toISOString();
  var ids = {}; body.pushIds.forEach(function (id) { ids[id] = true; });
  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var marked = 0;
  for (var i = 1; i < data.length; i++) {
    if (ids[data[i][0]]) { sheet.getRange(i + 1, 14).setValue('true'); sheet.getRange(i + 1, 15).setValue(now); sheet.getRange(i + 1, 16).setValue(usedBy); marked++; }
  }
  return { ok: true, marked: marked, usedBy: usedBy, usedAt: now };
}

function archiveUsed(body) {
  body = body || {};
  var olderThanDays = body.olderThanDays;
  var archivedBy = body.archivedBy || 'system';
  var cutoffMs = olderThanDays ? Date.now() - (olderThanDays * 24 * 60 * 60 * 1000) : Infinity;
  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var histSheet = getOrCreateSheet(CONFIG.HISTORY_SHEET);
  var data = sheet.getDataRange().getValues();
  var toArchive = [], rowIndices = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var used = row[13] === 'true' || row[13] === true;
    if (!used) continue;
    var serverMs = row[11] ? new Date(row[11]).getTime() : 0;
    if (serverMs && serverMs > cutoffMs) continue;
    toArchive.push(row); rowIndices.push(i + 1);
  }
  if (!toArchive.length) return { ok: true, archived: 0 };
  var archivedAt = new Date().toISOString();
  toArchive.forEach(function (row) { histSheet.appendRow(row.concat([archivedAt, archivedBy])); });
  rowIndices.reverse().forEach(function (idx) { sheet.deleteRow(idx); });
  return { ok: true, archived: toArchive.length, archivedAt: archivedAt, archivedBy: archivedBy };
}

function getSyncStatus(body) {
  body = body || {};
  var attempts = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var aData = attempts.getDataRange().getValues();
  var totalPending = 0, totalUsed = 0;
  var perSection = {};
  for (var i = 1; i < aData.length; i++) {
    var section = aData[i][3] || 'UNKNOWN';
    var used = aData[i][13] === 'true' || aData[i][13] === true;
    if (body.section && section !== body.section) continue;
    if (!perSection[section]) perSection[section] = { pending: 0, used: 0 };
    if (used) { totalUsed++; perSection[section].used++; } else { totalPending++; perSection[section].pending++; }
  }
  var hist = getOrCreateSheet(CONFIG.HISTORY_SHEET);
  var totalArchived = Math.max(0, hist.getLastRow() - 1);
  var unlocks = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var uData = unlocks.getDataRange().getValues();
  var totalUnlocksPending = 0, totalUnlocksApplied = 0;
  for (var j = 1; j < uData.length; j++) {
    if (uData[j][6] === 'applied') totalUnlocksApplied++;
    else if (uData[j][6] === 'pending') totalUnlocksPending++;
  }
  var locks = getOrCreateSheet(CONFIG.LOCKS_SHEET);
  var totalLocks = Math.max(0, locks.getLastRow() - 1);
  var reqs = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var rData = reqs.getDataRange().getValues();
  var totalReqPending = 0, totalReqApproved = 0, totalReqApplied = 0;
  for (var k = 1; k < rData.length; k++) {
    if (rData[k][10] === 'pending') totalReqPending++;
    else if (rData[k][10] === 'approved') totalReqApproved++;
    else if (rData[k][10] === 'applied') totalReqApplied++;
  }
  return { ok: true, totalPending: totalPending, totalUsed: totalUsed, totalArchived: totalArchived, totalUnlocksPending: totalUnlocksPending, totalUnlocksApplied: totalUnlocksApplied, totalLocks: totalLocks, totalReqPending: totalReqPending, totalReqApproved: totalReqApproved, totalReqApplied: totalReqApplied, perSection: perSection, serverTime: new Date().toISOString() };
}

function registerSyncCode(body) {
  var code = body.code, lrn = _lrnKey(body.lrn), payload = body.payload, signature = body.signature;
  if (!code || !lrn || !payload || !signature) return { ok: false, error: 'Missing fields' };
  if (!verifyCanonicalSignature(payload, signature)) return { ok: false, error: 'Signature verification failed' };
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  if (findRowByCode(code)) return { ok: false, error: 'Code already exists' };
  var student = payload.student || {};
  sheet.appendRow([code, lrn, (student.lastName || '') + ', ' + (student.firstName || ''), student.section || '', JSON.stringify(payload), signature, new Date().toISOString(), 'false']);
  trimOldCodes(lrn);
  return { ok: true, code: code, createdAt: new Date().toISOString() };
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
      if (ageDays > CONFIG.CODE_EXPIRY_DAYS) return { ok: false, error: 'Code expired' };
      var payload = JSON.parse(data[i][4]);
      if (!verifyCanonicalSignature(payload, data[i][5])) return { ok: false, error: 'Verification failed' };
      return { ok: true, payload: payload, signature: data[i][5], createdAt: data[i][6] };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function pullAllPending(body) {
  body = body || {};
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var searchLrn = body.lrn ? _lrnKey(body.lrn) : null;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var used = row[7] === 'true' || row[7] === true;
    if (searchLrn && _lrnKey(row[1]) !== searchLrn) continue;
    if (body.section && row[3] !== body.section) continue;
    if (used) continue;
    var createdAt = new Date(row[6]);
    var ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > CONFIG.CODE_EXPIRY_DAYS) continue;
    var payload, signature; try { payload = JSON.parse(row[4]); signature = row[5]; } catch (e) { continue; }
    records.push({ code: row[0], lrn: _lrnKey(row[1]), studentName: row[2], section: row[3], payload: payload, signature: signature, createdAt: row[6] });
  }
  return { ok: true, count: records.length, records: records };
}

function deleteSyncCode(body) {
  if (!body.code) return { ok: false, error: 'Missing code' };
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === body.code) { sheet.getRange(i + 1, 8).setValue('true'); return { ok: true }; }
  }
  return { ok: false, error: 'Not found' };
}

function getTermAccess(body) {
  var sheet = getOrCreateSheet(CONFIG.TERM_ACCESS_SHEET);
  var data = sheet.getDataRange().getValues();
  var sections = CONFIG.VALID_SECTIONS;
  var latest = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (sections.indexOf(row[1]) === -1) continue;
    var ts = new Date(row[0]).getTime();
    if (!latest[row[1]] || ts > latest[row[1]].at) {
      latest[row[1]] = { at: ts, access: { term1: row[2] === 'open' ? 'open' : 'locked', term2: row[3] === 'open' ? 'open' : 'locked', term3: row[4] === 'open' ? 'open' : 'locked' } };
    }
  }
  var all = {};
  sections.forEach(function (sec) { all[sec] = latest[sec] ? latest[sec].access : { term1: 'locked', term2: 'locked', term3: 'locked' }; });
  if (body && body.section) return { ok: true, section: body.section, access: all[body.section] || { term1: 'locked', term2: 'locked', term3: 'locked' } };
  return { ok: true, all: all };
}

function setTermAccess(body) {
  if (!body.section || !body.access) return { ok: false, error: 'Missing section or access' };
  if (CONFIG.VALID_SECTIONS.indexOf(body.section) === -1) return { ok: false, error: 'Invalid section' };
  var sheet = getOrCreateSheet(CONFIG.TERM_ACCESS_SHEET);
  var a = body.access;
  sheet.appendRow([new Date().toISOString(), body.section, a.term1 === 'open' ? 'open' : 'locked', a.term2 === 'open' ? 'open' : 'locked', a.term3 === 'open' ? 'open' : 'locked', body.updatedBy || 'teacher', body.notes || '']);
  return { ok: true, section: body.section, access: a };
}

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = null;
    if (name === CONFIG.SYNC_CODES_SHEET) headers = ['code','lrn','studentName','section','payload','signature','createdAt','used'];
    else if (name === CONFIG.TERM_ACCESS_SHEET) headers = ['timestamp','section','term1','term2','term3','updatedBy','notes'];
    else if (name === CONFIG.LOG_SHEET) headers = ['timestamp','action','lrn','code','status','notes'];
    else if (name === CONFIG.ATTEMPTS_SHEET) headers = ['pushId','lrn','studentName','section','term','assessment','score','total','itemResults','set','clientTimestamp','serverTimestamp','signature','used','usedAt','usedBy','originalPayload'];
    else if (name === CONFIG.HISTORY_SHEET) headers = ['pushId','lrn','studentName','section','term','assessment','score','total','itemResults','set','clientTimestamp','serverTimestamp','signature','used','usedAt','usedBy','archivedAt','archivedBy'];
    else if (name === CONFIG.UNLOCKS_SHEET) headers = UNLOCKS_HEADERS;
    else if (name === CONFIG.LOCKS_SHEET) headers = LOCKS_HEADERS;
    else if (name === CONFIG.REQUESTS_SHEET) headers = REQUESTS_HEADERS;
    else if (name === CONFIG.PT_FILES_SHEET) headers = PT_FILES_HEADERS;
    else if (name === CONFIG.PT_GRADES_SHEET) headers = PT_GRADES_HEADERS;
    else if (name === CONFIG.PT_UNLOCK_REQUESTS_SHEET) headers = PT_UNLOCK_REQUESTS_HEADERS;
    else if (name === CONFIG.STUDENTS_MASTER_SHEET) headers = STUDENTS_MASTER_HEADERS;
    if (headers) { sheet.appendRow(headers); sheet.setFrozenRows(1); }
  }
  return sheet;
}

function findRowByCode(code) {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][0] === code) return { row: i + 1, data: data[i] };
  return null;
}

function trimOldCodes(lrn) {
  var sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) if (String(data[i][1]) === String(lrn)) rows.push({ rowIndex: i + 1, createdAt: new Date(data[i][6]) });
  if (rows.length > CONFIG.MAX_CODES_PER_STUDENT) {
    rows.sort(function (a, b) { return a.createdAt - b.createdAt; });
    rows.slice(0, rows.length - CONFIG.MAX_CODES_PER_STUDENT).reverse().forEach(function (r) { sheet.deleteRow(r.rowIndex); });
  }
}

function logAction(action, lrn, code, status, notes) {
  try {
    var sheet = getOrCreateSheet(CONFIG.LOG_SHEET);
    if (sheet.getLastRow() > 5000) sheet.deleteRows(2, sheet.getLastRow() - 5000);
    sheet.appendRow([new Date().toISOString(), action || '', lrn || '', code || '', status || '', notes || '']);
  } catch (e) { console.error('Log error:', e); }
}

function cleanupOldUnlocks() {
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var cutoff = Date.now() - (CONFIG.UNLOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  var toDelete = [];
  for (var i = 1; i < data.length; i++) if (data[i][6] === 'applied') { var ms = data[i][7] ? new Date(data[i][7]).getTime() : 0; if (ms && ms < cutoff) toDelete.push(i + 1); }
  toDelete.reverse().forEach(function (idx) { sheet.deleteRow(idx); });
  return { deleted: toDelete.length };
}

function cleanupOldLocks() {
  var sheet = getOrCreateSheet(CONFIG.LOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var cutoff = Date.now() - (CONFIG.LOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  var toDelete = [];
  for (var i = 1; i < data.length; i++) { var ms = data[i][6] ? new Date(data[i][6]).getTime() : 0; if (ms && ms < cutoff) toDelete.push(i + 1); }
  toDelete.reverse().forEach(function (idx) { sheet.deleteRow(idx); });
  return { deleted: toDelete.length };
}

function cleanupOldRequests() {
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
  var toDelete = [];
  for (var i = 1; i < data.length; i++) { var ms = data[i][14] ? new Date(data[i][14]).getTime() : 0; if (ms && ms < cutoff) toDelete.push(i + 1); }
  toDelete.reverse().forEach(function (idx) { sheet.deleteRow(idx); });
  return { deleted: toDelete.length };
}

function createStudentsMasterSheet() {
  var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  Logger.log('✅ Sheet created/verified: ' + sheet.getName());
  Logger.log('Headers: ' + STUDENTS_MASTER_HEADERS.join(', '));
}

/* ===== PT FILES ===== */
function uploadPT(body) {
  var lrn = _lrnKey(body.lrn);
  var term = String(body.term || '');
  var ptId = String(body.ptId || '');
  var filename = String(body.filename || '');
  var mimeType = String(body.mimeType || 'application/octet-stream');
  var base64 = String(body.base64 || '');
  var reflection = String(body.reflection || '');
  var option = body.option || null;
  var student = body.student || {};

  if (!lrn || !term || !ptId || !filename || !base64) return { ok: false, error: 'Missing lrn, term, ptId, filename, or base64' };
  if (CONFIG.VALID_TERMS.indexOf(term) === -1) return { ok: false, error: 'Invalid term' };
  if (['pt1','pt2','pt3'].indexOf(ptId) === -1) return { ok: false, error: 'Invalid PT id' };

  var approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > CONFIG.PT_MAX_FILE_BYTES) return { ok: false, error: 'File too large (max 25 MB). Actual: ' + Math.round(approxBytes/1024/1024) + ' MB' };

  var lastName = sanitizeName(student.lastName || 'Unknown');
  var firstName = sanitizeName(student.firstName || 'Student');
  var section = sanitizeSection(student.section || 'NoSection');
  var ext = getFileExtension(filename);
  var ptLabel = ptId.toUpperCase();
  var renamedFilename = ptLabel + '_' + section + '_' + lastName + '_' + firstName + ext;

  var rootFolder;
  try { rootFolder = DriveApp.getFolderById(CONFIG.PT_DRIVE_FOLDER_ID); }
  catch (e) { return { ok: false, error: 'Root Drive folder not found.' }; }

  var termFolder = getOrCreateFolder(rootFolder, term);
  var ptFolder = getOrCreateFolder(termFolder, ptId);

  var blob;
  try { blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, renamedFilename); }
  catch (e) { return { ok: false, error: 'Invalid base64: ' + e.message }; }

  var existing = ptFolder.getFilesByName(renamedFilename);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var file = ptFolder.createFile(blob);

  var uploadedAt = new Date().toISOString();
  var sheet = getOrCreateSheet(CONFIG.PT_FILES_SHEET);
  var fileId = 'PT-' + lrn + '-' + term + '-' + ptId + '-' + Date.now();
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');

  removeOldPTFileRow(sheet, lrn, term, ptId);

  sheet.appendRow([
    fileId, lrn, studentName.trim().replace(/,$/, ''), section, term, ptId, file.getId(), file.getUrl(),
    filename, renamedFilename, mimeType, approxBytes, uploadedAt, body.syncedFrom || 'student', 'false', reflection, option || ''
  ]);

  return { ok: true, fileId: fileId, driveFileId: file.getId(), driveUrl: file.getUrl(), renamedFilename: renamedFilename, fileSize: approxBytes, uploadedAt: uploadedAt, message: 'File uploaded to Drive' };
}

function listPTFiles(body) {
  var sheet = getOrCreateSheet(CONFIG.PT_FILES_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var searchLrn = body.lrn ? _lrnKey(body.lrn) : null;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var legacy = row[14] === 'true' || row[14] === true;
    if (legacy && !body.includeLegacy) continue;
    if (searchLrn && _lrnKey(row[1]) !== searchLrn) continue;
    if (body.term && row[4] !== body.term) continue;
    if (body.ptId && row[5] !== body.ptId) continue;

    if (body.section) {
      var rowSec = String(row[3] || '').replace(/_/g, ' ').trim().toUpperCase();
      var filterSec = String(body.section || '').replace(/_/g, ' ').trim().toUpperCase();
      if (rowSec !== filterSec) continue;
    }

    records.push({
      fileId: row[0], lrn: _lrnKey(row[1]), studentName: row[2], section: row[3], term: row[4], ptId: row[5],
      driveFileId: row[6], driveUrl: row[7], originalFilename: row[8], renamedFilename: row[9], mimeType: row[10],
      fileSize: Number(row[11]) || 0, uploadedAt: row[12], syncedFrom: row[13], isLegacy: legacy,
      reflection: row[15] || '', option: row[16] || null
    });
  }

  records.sort(function (a, b) {
    var ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    var tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return tb - ta;
  });
  return { ok: true, count: records.length, records: records };
}

function savePTGrade(body) {
  var lrn = _lrnKey(body.lrn);
  var term = String(body.term || '');
  var ptId = String(body.ptId || '');
  var rubricScores = body.rubricScores || [];
  var totalScore = Number(body.totalScore || 0);
  var teacherNotes = String(body.teacherNotes || '');
  var gradedBy = String(body.gradedBy || 'Teacher');
  var student = body.student || {};

  if (!lrn || !term || !ptId) return { ok: false, error: 'Missing lrn, term, or ptId' };
  if (!Array.isArray(rubricScores) || !rubricScores.length) return { ok: false, error: 'rubricScores required' };

  var sheet = getOrCreateSheet(CONFIG.PT_GRADES_SHEET);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();
  var gradeId = 'GRD-' + lrn + '-' + term + '-' + ptId + '-' + Date.now();
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');
  var section = student.section || '';

  for (var i = data.length - 1; i >= 1; i--) {
    if (_lrnKey(data[i][1]) === lrn && data[i][4] === term && data[i][5] === ptId) sheet.deleteRow(i + 1);
  }

  sheet.appendRow([
    gradeId, lrn, studentName.trim().replace(/,$/, ''), section, term, ptId,
    JSON.stringify(rubricScores), totalScore, teacherNotes, now, gradedBy, 'false', ''
  ]);
  return { ok: true, gradeId: gradeId, gradedAt: now, message: 'Grade saved' };
}

function pullPTGrades(body) {
  var searchLrn = body.lrn ? _lrnKey(body.lrn) : null;
  var term = String(body.term || '');
  var ptId = String(body.ptId || '');
  var teacherMode = !searchLrn;

  var sheet = getOrCreateSheet(CONFIG.PT_GRADES_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!teacherMode && _lrnKey(row[1]) !== searchLrn) continue;
    if (term && row[4] !== term) continue;
    if (ptId && row[5] !== ptId) continue;

    var rubricScores;
    try { rubricScores = JSON.parse(row[6] || '[]'); } catch (e) { rubricScores = []; }
    records.push({
      gradeId: row[0], lrn: _lrnKey(row[1]), studentName: row[2], section: row[3],
      term: row[4], ptId: row[5], rubricScores: rubricScores,
      totalScore: Number(row[7]) || 0, teacherNotes: row[8] || '', gradedAt: row[9], gradedBy: row[10]
    });
  }

  if (searchLrn) {
    for (var j = 1; j < data.length; j++) {
      if (_lrnKey(data[j][1]) === searchLrn && (data[j][11] !== 'true' && data[j][11] !== true)) {
        sheet.getRange(j + 1, 12).setValue('true');
        sheet.getRange(j + 1, 13).setValue(new Date().toISOString());
      }
    }
  }
  return { ok: true, count: records.length, records: records };
}

function getPTGradeStatus(body) {
  var sheet = getOrCreateSheet(CONFIG.PT_GRADES_SHEET);
  var data = sheet.getDataRange().getValues();
  var total = 0, synced = 0;
  for (var i = 1; i < data.length; i++) {
    if (body.term && data[i][4] !== body.term) continue;
    if (body.ptId && data[i][5] !== body.ptId) continue;
    if (body.section && data[i][3] !== body.section) continue;
    total++;
    if (data[i][11] === 'true' || data[i][11] === true) synced++;
  }
  return { ok: true, total: total, synced: synced, pending: total - synced, serverTime: new Date().toISOString() };
}

function markPTLegacy(body) {
  var sheet = getOrCreateSheet(CONFIG.PT_FILES_SHEET);
  var data = sheet.getDataRange().getValues();
  var marked = 0;
  for (var i = 1; i < data.length; i++) {
    if (body.fileId && String(data[i][0]) === String(body.fileId)) {
      sheet.getRange(i + 1, 15).setValue('true');
      marked++;
    } else if (body.lrn && _lrnKey(data[i][1]) === _lrnKey(body.lrn) && body.term && data[i][4] === body.term && body.ptId && data[i][5] === body.ptId) {
      sheet.getRange(i + 1, 15).setValue('true');
      marked++;
    }
  }
  return { ok: true, marked: marked };
}

function requestPTReupload(body) {
  var lrn = _lrnKey(body.lrn);
  var term = String(body.term || '');
  var ptId = String(body.ptId || '');
  var reason = String(body.reason || 'wants-to-improve');
  var currentGrade = Number(body.currentGrade || 0);
  var student = body.student || {};

  if (!lrn || !term || !ptId) return { ok: false, error: 'Missing lrn, term, or ptId' };

  var sheet = getOrCreateSheet(CONFIG.PT_UNLOCK_REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var now = new Date();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (_lrnKey(row[1]) === lrn && row[4] === term && row[5] === ptId && (row[9] === 'pending' || row[9] === 'approved')) {
      if (row[9] === 'approved' && row[12]) {
        var expiresAt = new Date(row[12]);
        if (expiresAt < now) { sheet.getRange(i + 1, 10).setValue('cancelled'); continue; }
      }
      return { ok: true, existing: true, requestId: row[0], status: row[9], unlockCode: row[9] === 'approved' ? row[10] : null };
    }
  }

  var requestId = 'PTREQ-' + lrn + '-' + term + '-' + ptId + '-' + Date.now();
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');
  var section = student.section || '';
  var nowIso = new Date().toISOString();

  sheet.appendRow([requestId, lrn, studentName.trim().replace(/,$/, ''), section, term, ptId, reason, currentGrade, nowIso, 'pending', '', '', '', '']);
  return { ok: true, requestId: requestId, requestedAt: nowIso, message: 'Re-upload request created' };
}

function getPTReuploadRequests(body) {
  requireTeacherToken(body.token);
  var sheet = getOrCreateSheet(CONFIG.PT_UNLOCK_REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (body.filterTerm && row[4] !== body.filterTerm) continue;
    if (body.filterSection && row[3] !== body.filterSection) continue;
    records.push({
      requestId: row[0], lrn: _lrnKey(row[1]), studentName: row[2], section: row[3], term: row[4], ptId: row[5],
      reason: row[6], currentGrade: Number(row[7]) || 0, requestedAt: row[8], status: row[9],
      unlockCode: row[10] || null, codeGeneratedAt: row[11] || null, codeExpiresAt: row[12] || null, appliedAt: row[13] || null
    });
  }
  records.sort(function (a, b) {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return new Date(b.requestedAt) - new Date(a.requestedAt);
  });
  return { ok: true, count: records.length, records: records };
}

function approvePTReupload(body) {
  requireTeacherToken(body.token);
  var requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };

  var sheet = getOrCreateSheet(CONFIG.PT_UNLOCK_REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      var status = String(data[i][9]);
      if (status === 'applied') return { ok: false, error: 'Already applied' };
      if (status === 'cancelled') return { ok: false, error: 'Cancelled' };

      var code = generateUniqueCode(sheet, 10, 'PTRK-');
      var now = new Date();
      var expiresAt = new Date(now.getTime() + CONFIG.PT_REUPLOAD_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      sheet.getRange(i + 1, 10).setValue('approved');
      sheet.getRange(i + 1, 11).setValue(code);
      sheet.getRange(i + 1, 12).setValue(now.toISOString());
      sheet.getRange(i + 1, 13).setValue(expiresAt.toISOString());

      return { ok: true, requestId: requestId, unlockCode: code, codeGeneratedAt: now.toISOString(), codeExpiresAt: expiresAt.toISOString() };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function redeemPTReuploadCode(body) {
  var lrn = _lrnKey(body.lrn);
  var code = String(body.code || '').toUpperCase().trim();
  if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };

  var sheet = getOrCreateSheet(CONFIG.PT_UNLOCK_REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[10]).toUpperCase() !== code) continue;
    if (_lrnKey(row[1]) !== lrn) continue;
    var status = String(row[9]);
    if (status === 'applied') return { ok: false, error: 'Code already used' };
    if (status === 'cancelled') return { ok: false, error: 'Cancelled' };
    if (status !== 'approved') return { ok: false, error: 'Not yet approved' };

    var expiresAt = row[12] ? new Date(row[12]) : null;
    if (expiresAt && expiresAt < new Date()) return { ok: false, error: 'Code expired' };

    var now = new Date().toISOString();
    sheet.getRange(i + 1, 10).setValue('applied');
    sheet.getRange(i + 1, 14).setValue(now);
    return { ok: true, requestId: row[0], term: row[4], ptId: row[5], appliedAt: now };
  }
  return { ok: false, error: 'Code not found or not linked to this student' };
}

function getOrCreateFolder(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(name);
}

function removeOldPTFileRow(sheet, lrn, term, ptId) {
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (_lrnKey(data[i][1]) === _lrnKey(lrn) && data[i][4] === term && data[i][5] === ptId) sheet.deleteRow(i + 1);
  }
}

/* ===== UTILS ===== */
function sanitizeName(str) {
  return String(str).replace(/[^a-zA-Z0-9\-\s]/g, '').trim().replace(/\s+/g, '_').substring(0, 40) || 'Unknown';
}

function sanitizeSection(str) {
  return String(str).replace(/[^a-zA-Z0-9\-\s]/g, '').trim().replace(/\s+/g, '_').substring(0, 20) || 'NoSection';
}

function getFileExtension(filename) {
  var m = String(filename).match(/\.([a-zA-Z0-9]{1,6})$/);
  return m ? '.' + m[1].toLowerCase() : '';
}

function escapeNonAscii(str) {
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 128) out += str.charAt(i);
    else out += '\\u' + code.toString(16).padStart(4, '0');
  }
  return out;
}

function canonicalize(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'number') { if (isNaN(obj) || !isFinite(obj)) return 'null'; return String(obj); }
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'string') { var j = JSON.stringify(obj); return '"' + escapeNonAscii(j.substring(1, j.length - 1)) + '"'; }
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  if (typeof obj === 'object') {
    var keys = Object.keys(obj).filter(function (k) { return k !== 'signature' && obj[k] !== undefined && typeof obj[k] !== 'function'; });
    keys.sort();
    return '{' + keys.map(function (k) { return '"' + escapeNonAscii(k) + '":' + canonicalize(obj[k]); }).join(',') + '}';
  }
  return 'null';
}

function computeHMAC(message, secret) {
  var raw = Utilities.computeHmacSha256Signature(message, secret);
  return raw.map(function (b) { return ((b < 0 ? b + 256 : b).toString(16).padStart(2, '0')); }).join('');
}

function verifyCanonicalSignature(payload, signature) {
  try {
    if (!payload || !signature) return false;
    return constantTimeEquals(computeHMAC(canonicalize(payload), CONFIG.HMAC_SECRET), signature);
  } catch (e) { return false; }
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkRateLimit(key, action) {
  try {
    if (!key || key === 'anonymous') return { ok: true };
    var cache = CacheService.getScriptCache();
    var k = 'rl_' + String(key).substring(0, 40) + '_' + String(action || '').substring(0, 40);
    var count = Number(cache.get(k) || 0) + 1;
    if (count > CONFIG.RATE_LIMIT_MAX_PER_WINDOW) return { ok: false, reason: 'Exceeded rate limit', retryAfter: CONFIG.RATE_LIMIT_WINDOW_SEC };
    cache.put(k, String(count), CONFIG.RATE_LIMIT_WINDOW_SEC);
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

/* ===== REQUESTS / RETAKES ===== */
function requestRetake(body) {
  var lrn = _lrnKey(body.lrn), term = String(body.term || ''), assessment = String(body.assessment || '');
  if (!lrn || !term || !assessment) return { ok: false, error: 'Missing fields' };
  if (CONFIG.VALID_TERMS.indexOf(term) === -1) return { ok: false, error: 'Invalid term' };
  if (CONFIG.VALID_ASSESSMENTS.indexOf(assessment) === -1) return { ok: false, error: 'Invalid assessment' };

  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (_lrnKey(data[i][1]) === lrn && data[i][4] === term && data[i][5] === assessment && (data[i][10] === 'pending' || data[i][10] === 'approved')) {
      return { ok: true, existing: true, requestId: data[i][0], status: data[i][10], unlockCode: data[i][10] === 'approved' ? data[i][11] : null };
    }
  }
  var requestId = 'REQ-' + lrn + '-' + term + '-' + assessment + '-' + Date.now();
  var student = body.student || {};
  var studentName = (student.lastName || '') + ', ' + (student.firstName || '');
  var now = new Date().toISOString();
  sheet.appendRow([requestId, lrn, studentName.trim().replace(/,$/, ''), student.section || '', term, assessment, body.reason || 'failed-attempt', Number(body.score || 0), Number(body.total || 0), now, 'pending', '', '', '', '']);
  return { ok: true, requestId: requestId, requestedAt: now };
}

function getStudentRequests(body) {
  var lrn = _lrnKey(body.lrn);
  if (!lrn) return { ok: false, error: 'Missing lrn' };
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < data.length; i++) {
    if (_lrnKey(data[i][1]) !== lrn) continue;
    records.push({ requestId: data[i][0], lrn: lrn, term: data[i][4], assessment: data[i][5], reason: data[i][6], score: Number(data[i][7]) || 0, total: Number(data[i][8]) || 0, requestedAt: data[i][9], status: data[i][10], unlockCode: data[i][11] || null, codeGeneratedAt: data[i][12] || null, codeExpiresAt: data[i][13] || null, appliedAt: data[i][14] || null });
  }
  return { ok: true, count: records.length, records: records };
}

function getUnlockRequests(body) {
  requireTeacherToken(body.token);
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < data.length; i++) {
    if (body.filterTerm && data[i][4] !== body.filterTerm) continue;
    if (body.filterSection && data[i][3] !== body.filterSection) continue;
    records.push({ requestId: data[i][0], lrn: _lrnKey(data[i][1]), studentName: data[i][2], section: data[i][3], term: data[i][4], assessment: data[i][5], reason: data[i][6], score: Number(data[i][7]) || 0, total: Number(data[i][8]) || 0, requestedAt: data[i][9], status: data[i][10], unlockCode: data[i][11] || null, codeGeneratedAt: data[i][12] || null, codeExpiresAt: data[i][13] || null, appliedAt: data[i][14] || null });
  }
  records.sort(function (a, b) { if (a.status === 'pending' && b.status !== 'pending') return -1; if (b.status === 'pending' && a.status !== 'pending') return 1; return new Date(b.requestedAt) - new Date(a.requestedAt); });
  return { ok: true, count: records.length, records: records };
}

function approveRetake(body) {
  requireTeacherToken(body.token);
  var requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      var status = String(data[i][10]);
      if (status === 'applied') return { ok: false, error: 'Already applied' };
      if (status === 'cancelled') return { ok: false, error: 'Cancelled' };
      var code = generateUniqueCode(sheet, 8, 'RTK-');
      var now = new Date();
      var expiresAt = new Date(now.getTime() + CONFIG.REQUEST_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      sheet.getRange(i + 1, 11).setValue('approved');
      sheet.getRange(i + 1, 12).setValue(code);
      sheet.getRange(i + 1, 13).setValue(now.toISOString());
      sheet.getRange(i + 1, 14).setValue(expiresAt.toISOString());
      return { ok: true, requestId: requestId, unlockCode: code, codeGeneratedAt: now.toISOString(), codeExpiresAt: expiresAt.toISOString() };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function cancelRequest(body) {
  requireTeacherToken(body.token);
  var requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      if (String(data[i][10]) === 'applied') return { ok: false, error: 'Cannot cancel' };
      sheet.getRange(i + 1, 11).setValue('cancelled');
      return { ok: true, requestId: requestId };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function redeemUnlockCode(body) {
  var lrn = _lrnKey(body.lrn);
  var code = String(body.code || '').toUpperCase().trim();
  if (!lrn || !code) return { ok: false, error: 'Missing fields' };
  var sheet = getOrCreateSheet(CONFIG.REQUESTS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[11]).toUpperCase() !== code) continue;
    if (_lrnKey(row[1]) !== lrn) continue;
    var status = String(row[10]);
    if (status === 'applied') return { ok: false, error: 'Code already used' };
    if (status === 'cancelled') return { ok: false, error: 'Cancelled' };
    if (status !== 'approved') return { ok: false, error: 'Not approved yet' };
    var expiresAt = row[13] ? new Date(row[13]) : null;
    if (expiresAt && expiresAt < new Date()) return { ok: false, error: 'Code expired' };
    var now = new Date().toISOString();
    sheet.getRange(i + 1, 11).setValue('applied');
    sheet.getRange(i + 1, 15).setValue(now);
    return { ok: true, requestId: row[0], term: row[4], assessment: row[5], appliedAt: now };
  }
  return { ok: false, error: 'Code not found' };
}

function generateUniqueCode(sheet, length, prefix) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var data = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < data.length; i++) {
    for (var c = 0; c < 15; c++) { if (data[i][c]) existing[String(data[i][c]).toUpperCase()] = true; }
  }
  var len = length || 8;
  var pfx = prefix || 'RTK-';
  for (var attempt = 0; attempt < 30; attempt++) {
    var code = pfx;
    for (var k = 0; k < len; k++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
      if (k === Math.floor(len/2) - 1) code += '-';
    }
    if (!existing[code]) return code;
  }
  throw new Error('Could not generate unique code');
}

/* ===== LOCKS ===== */
function pushLock(body) {
  var required = ['lrn', 'term', 'assessment'];
  for (var i = 0; i < required.length; i++) if (!body[required[i]]) return { ok: false, error: 'Missing ' + required[i] };
  if (CONFIG.VALID_TERMS.indexOf(body.term) === -1) return { ok: false, error: 'Invalid term' };
  if (CONFIG.VALID_ASSESSMENTS.indexOf(body.assessment) === -1) return { ok: false, error: 'Invalid assessment' };
  var searchLrn = _lrnKey(body.lrn);
  var sheet = getOrCreateSheet(CONFIG.LOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();
  var lockId = searchLrn + '-' + body.term + '-' + body.assessment;
  for (var r = 1; r < data.length; r++) {
    if (_lrnKey(data[r][1]) === searchLrn && data[r][2] === body.term && data[r][3] === body.assessment) {
      sheet.getRange(r + 1, 5).setValue(body.reason || 'failed');
      sheet.getRange(r + 1, 6).setValue(body.score || 0);
      sheet.getRange(r + 1, 7).setValue(body.lockedAt || now);
      return { ok: true, lockId: data[r][0], updated: true };
    }
  }
  var student = body.student || {};
  sheet.appendRow([lockId, searchLrn, body.term, body.assessment, body.reason || 'failed', body.score || 0, body.lockedAt || now, (student.lastName || '') + ', ' + (student.firstName || ''), student.section || '']);
  return { ok: true, lockId: lockId, pushedAt: now };
}

function pullLocks(body) {
  body = body || {};
  var sheet = getOrCreateSheet(CONFIG.LOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var cutoffMs = Date.now() - (CONFIG.LOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  var searchLrn = body.lrn ? _lrnKey(body.lrn) : null;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (searchLrn && _lrnKey(row[1]) !== searchLrn) continue;
    if (body.term && row[2] !== body.term) continue;
    if (body.assessment && row[3] !== body.assessment) continue;
    if (body.section && row[8] !== body.section) continue;
    var lockedMs = row[6] ? new Date(row[6]).getTime() : 0;
    if (lockedMs && lockedMs < cutoffMs) continue;
    records.push({ lockId: row[0], lrn: _lrnKey(row[1]), term: row[2], assessment: row[3], reason: row[4], score: Number(row[5]) || 0, lockedAt: row[6], studentName: row[7], section: row[8] });
  }
  return { ok: true, count: records.length, records: records };
}

function deleteLock(body) {
  if (!body || !body.lockId) return { ok: false, error: 'Missing lockId' };
  var sheet = getOrCreateSheet(CONFIG.LOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.lockId)) { sheet.deleteRow(i + 1); return { ok: true, lockId: body.lockId }; }
  }
  return { ok: false, error: 'Lock not found' };
}

/* ===== UNLOCKS ===== */
function pushUnlock(body) {
  requireTeacherToken(body.token);
  var required = ['lrn', 'term', 'assessment'];
  for (var i = 0; i < required.length; i++) if (!body[required[i]]) return { ok: false, error: 'Missing ' + required[i] };
  if (CONFIG.VALID_TERMS.indexOf(body.term) === -1) return { ok: false, error: 'Invalid term' };
  if (CONFIG.VALID_ASSESSMENTS.indexOf(body.assessment) === -1) return { ok: false, error: 'Invalid assessment' };
  var searchLrn = _lrnKey(body.lrn);
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();
  var unlockId = searchLrn + '-' + body.term + '-' + body.assessment + '-' + Date.now();
  for (var r = 1; r < data.length; r++) {
    if (_lrnKey(data[r][1]) === searchLrn && data[r][2] === body.term && data[r][3] === body.assessment && data[r][6] !== 'applied' && data[r][6] !== 'revoked') {
      return { ok: true, unlockId: data[r][0], duplicate: true };
    }
  }
  sheet.appendRow([unlockId, searchLrn, body.term, body.assessment, body.reason || 'retake-approved', now, 'pending', '', body.unlockedBy || 'teacher', body.forceUnlock ? 'TRUE' : 'FALSE']);
  try {
    var lockSheet = getOrCreateSheet(CONFIG.LOCKS_SHEET);
    var lockData = lockSheet.getDataRange().getValues();
    for (var l = lockData.length - 1; l >= 1; l--) {
      if (_lrnKey(lockData[l][1]) === searchLrn && lockData[l][2] === body.term && lockData[l][3] === body.assessment) lockSheet.deleteRow(l + 1);
    }
  } catch (e) {}
  return { ok: true, unlockId: unlockId, pushedAt: now, forceUnlock: !!body.forceUnlock };
}

function pullUnlocks(body) {
  body = body || {};
  if (!body.lrn) return { ok: false, error: 'Missing lrn' };
  var searchLrn = _lrnKey(body.lrn);
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  var cutoffMs = Date.now() - (CONFIG.UNLOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (_lrnKey(row[1]) !== searchLrn) continue;
    if (row[6] === 'applied' || row[6] === 'revoked') continue;
    var pushedMs = row[5] ? new Date(row[5]).getTime() : 0;
    if (pushedMs && pushedMs < cutoffMs) continue;
    records.push({ unlockId: row[0], lrn: _lrnKey(row[1]), term: row[2], assessment: row[3], reason: row[4], pushedAt: row[5], status: row[6], unlockedBy: row[8], forceUnlock: row[9] === 'TRUE' });
  }
  return { ok: true, count: records.length, records: records };
}

function markUnlockApplied(body) {
  if (!body || !body.unlockId) return { ok: false, error: 'Missing unlockId' };
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.unlockId)) {
      sheet.getRange(i + 1, 7).setValue('applied');
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());
      return { ok: true, unlockId: body.unlockId };
    }
  }
  return { ok: false, error: 'Not found' };
}

function revokeUnlock(body) {
  requireTeacherToken(body.token);
  if (!body || !body.unlockId) return { ok: false, error: 'Missing unlockId' };
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.unlockId)) {
      if (data[i][6] === 'applied') return { ok: false, error: 'Cannot revoke' };
      sheet.getRange(i + 1, 7).setValue('revoked');
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());
      return { ok: true, unlockId: body.unlockId };
    }
  }
  return { ok: false, error: 'Not found' };
}

function getAllUnlocks(body) {
  requireTeacherToken(body.token);
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    records.push({ unlockId: row[0], lrn: _lrnKey(row[1]), term: row[2], assessment: row[3], reason: row[4], pushedAt: row[5], status: row[6], appliedAt: row[7], unlockedBy: row[8], forceUnlock: row[9] === 'TRUE' });
  }
  return { ok: true, count: records.length, records: records };
}

function getUnlockStatus(body) {
  requireTeacherToken(body.token);
  var sheet = getOrCreateSheet(CONFIG.UNLOCKS_SHEET);
  var data = sheet.getDataRange().getValues();
  var pending = 0, applied = 0, revoked = 0, expired = 0;
  var cutoffMs = Date.now() - (CONFIG.UNLOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  for (var i = 1; i < data.length; i++) {
    var status = data[i][6];
    if (status === 'applied') applied++;
    else if (status === 'revoked') revoked++;
    else { var pushedMs = data[i][5] ? new Date(data[i][5]).getTime() : 0; if (pushedMs && pushedMs < cutoffMs) expired++; else pending++; }
  }
  return { ok: true, pending: pending, applied: applied, revoked: revoked, expired: expired, total: pending + applied + revoked + expired };
}

/* ===== DIAGNOSTICS & FIXES (run manually in the Apps Script editor) ===== */
function fixCorruptedAttempts() {
  var sheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var data = sheet.getDataRange().getValues();
  var fixed = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var pushId = row[0];
    var originalPayloadJSON = row[16];

    if (!originalPayloadJSON) continue;

    try {
      var payload = JSON.parse(originalPayloadJSON);
      var payloadLrn = payload.student && payload.student.lrn;
      var payloadTerm = payload.attempt && payload.attempt.term;
      var payloadAssessment = payload.attempt && payload.attempt.assessment;

      if (_lrnKey(payloadLrn) !== _lrnKey(row[1]) || payloadTerm !== row[4] || payloadAssessment !== row[5]) {
        sheet.getRange(i + 1, 17).setValue('');
        Logger.log('Fixed: ' + pushId + ' (payload mismatch)');
        fixed++;
      }
    } catch (e) {
      sheet.getRange(i + 1, 17).setValue('');
      Logger.log('Fixed (parse error): ' + pushId);
      fixed++;
    }
  }

  Logger.log('Total fixed: ' + fixed);
  return { fixed: fixed };
}

/**
 * Fills empty names/sections in StudentsMaster using the Attempts sheet.
 */
function fixEmptyStudentNames() {
  var masterSheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var masterData = masterSheet.getDataRange().getValues();

  var attemptsSheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var attemptsData = attemptsSheet.getDataRange().getValues();

  var lrnToName = {};
  var lrnToSection = {};

  for (var i = 1; i < attemptsData.length; i++) {
    var lrn = _lrnKey(attemptsData[i][1]);
    var name = attemptsData[i][2];
    var section = attemptsData[i][3];

    if (lrn && name && name.trim() !== ',' && name.trim().length > 1) {
      lrnToName[lrn] = name;
      if (section) lrnToSection[lrn] = section;
    }
  }

  var fixedCount = 0;

  for (var j = 1; j < masterData.length; j++) {
    var currentLrn = _lrnKey(masterData[j][0]);
    var currentLastName = masterData[j][1];
    var currentFirstName = masterData[j][2];

    if ((!currentLastName || String(currentLastName).trim() === '') &&
        (!currentFirstName || String(currentFirstName).trim() === '') &&
        lrnToName[currentLrn]) {

      var parts = lrnToName[currentLrn].split(',');
      var newLastName = parts[0] ? parts[0].trim() : '';
      var newFirstName = parts[1] ? parts[1].trim() : '';
      var newSection = lrnToSection[currentLrn] || '';

      if (newLastName) masterSheet.getRange(j + 1, 2).setValue(newLastName);
      if (newFirstName) masterSheet.getRange(j + 1, 3).setValue(newFirstName);
      if (newSection && (!masterData[j][5] || String(masterData[j][5]).trim() === '')) {
        masterSheet.getRange(j + 1, 6).setValue(newSection);
      }

      Logger.log('✅ Fixed LRN ' + currentLrn + ' → ' + newLastName + ', ' + newFirstName + ' (' + newSection + ')');
      fixedCount++;
    }
  }

  Logger.log('Total fixed: ' + fixedCount);
  return { fixed: fixedCount };
}

/**
 * Manual patch for known ghost LRNs. Prefer fixEmptyStudentNames() first.
 * Replace placeholder names with real ones in the sheet afterwards.
 */
function fixSpecificMissingLRNs() {
  var targetLRNs = ['401545150047', '106645000018', '106645150041', '106637150037', '106645150039', '106645180041'];
  var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var data = sheet.getDataRange().getValues();
  var fixed = 0;

  for (var i = 1; i < data.length; i++) {
    var lrn = _lrnKey(data[i][0]);
    if (targetLRNs.indexOf(lrn) !== -1) {
      var lastName = String(data[i][1] || '').trim();
      var firstName = String(data[i][2] || '').trim();

      if (!lastName || !firstName) {
        sheet.getRange(i + 1, 2).setValue('UNIDENTIFIED');
        sheet.getRange(i + 1, 3).setValue('Student-' + lrn.slice(-4));
        if (!data[i][5]) sheet.getRange(i + 1, 6).setValue('ACADEMIC A');
        Logger.log('✅ Patched placeholder for ' + lrn);
        fixed++;
      }
    }
  }
  Logger.log('Total patched: ' + fixed);
  return { patched: fixed };
}

/**
 * Run ONCE after deploying v1.9.1: deletes StudentsMaster rows that have
 * no name AND no progress (ghost rows created by the old loginStudent).
 * Run fixEmptyStudentNames() first so real students are not removed.
 */
function deleteEmptyGhostRows() {
  var sheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var data = sheet.getDataRange().getValues();
  var deleted = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var noName = !String(data[i][1] || '').trim() && !String(data[i][2] || '').trim();
    var emptyProgress = !data[i][6] || data[i][6] === '{}';
    if (noName && emptyProgress) { sheet.deleteRow(i + 1); deleted++; }
  }
  Logger.log('Deleted ghost rows: ' + deleted);
  return { deleted: deleted };
}

/**
 * Resolves UNIDENTIFIED / nameless rows in StudentsMaster.
 *  1. Looks for the real name in Attempts, History, PTFiles, PTGrades,
 *     UnlockRequests, PTUnlockRequests, SyncCodes (format "Last, First")
 *     and Locks. If found -> fills name + section.
 *  2. Not found + NO progress at all -> row deleted (student just registers again).
 *  3. Not found + HAS progress -> kept, listed in the log. Ask that student to
 *     log in once: the app sends them to Register and the name is filled in
 *     while their progress is kept.
 * Run previewUnidentified() first (changes nothing), then repairUnidentified().
 */
function previewUnidentified() { return _repairUnidentified(true); }
function repairUnidentified()  { return _repairUnidentified(false); }

function _repairUnidentified(dryRun) {
  var master = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var mData = master.getDataRange().getValues();

  // lrn col, name col, section col
  var sources = [
    [CONFIG.ATTEMPTS_SHEET, 1, 2, 3], [CONFIG.HISTORY_SHEET, 1, 2, 3],
    [CONFIG.PT_FILES_SHEET, 1, 2, 3], [CONFIG.PT_GRADES_SHEET, 1, 2, 3],
    [CONFIG.REQUESTS_SHEET, 1, 2, 3], [CONFIG.PT_UNLOCK_REQUESTS_SHEET, 1, 2, 3],
    [CONFIG.SYNC_CODES_SHEET, 1, 2, 3], [CONFIG.LOCKS_SHEET, 1, 7, 8]
  ];
  var names = {};
  sources.forEach(function (src) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(src[0]);
    if (!sh) return;
    var d = sh.getDataRange().getValues();
    for (var r = 1; r < d.length; r++) {
      var lrn = _lrnKey(d[r][src[1]]);
      var nm = String(d[r][src[2]] || '').trim();
      if (!lrn || nm.length < 3 || nm === ',' || nm.toUpperCase().indexOf('UNIDENTIFIED') === 0) continue;
      names[lrn] = { name: nm, section: d[r][src[3]] || '', from: src[0] };
    }
  });

  var report = { resolved: [], deleted: [], needsStudent: [] };
  var toDelete = [];

  for (var i = 1; i < mData.length; i++) {
    var last = String(mData[i][1] || '').trim();
    var first = String(mData[i][2] || '').trim();
    var isPlaceholder = last.toUpperCase() === 'UNIDENTIFIED' || (!last && !first);
    if (!isPlaceholder) continue;

    var lrnKey = _lrnKey(mData[i][0]);
    var found = names[lrnKey];

    if (found) {
      var parts = found.name.split(',');
      var ln = (parts[0] || '').trim(), fn = (parts.slice(1).join(',') || '').trim();
      if (ln && fn) {
        if (!dryRun) {
          master.getRange(i + 1, 2).setNumberFormat('@').setValue(ln);
          master.getRange(i + 1, 3).setNumberFormat('@').setValue(fn);
          var sec = String(found.section || '').trim().toUpperCase();
          if (CONFIG.VALID_SECTIONS.indexOf(sec) !== -1) master.getRange(i + 1, 6).setValue(sec);
        }
        report.resolved.push(lrnKey + ' → ' + ln + ', ' + fn + ' (from ' + found.from + ')');
        continue;
      }
    }

    var hasProgress = false;
    try {
      var p = JSON.parse(mData[i][6] || '{}');
      Object.keys((p && p.progress) || {}).forEach(function (t) {
        if (p.progress[t] && p.progress[t].completed && p.progress[t].completed.length) hasProgress = true;
      });
      if (p && p.scores && Object.keys(p.scores).length) hasProgress = true;
    } catch (e) {}

    if (hasProgress) report.needsStudent.push(lrnKey + ' (row ' + (i + 1) + ') — may progress, walang pangalan sa ibang sheet');
    else { toDelete.push(i + 1); report.deleted.push(lrnKey + ' (row ' + (i + 1) + ')'); }
  }

  if (!dryRun) toDelete.reverse().forEach(function (idx) { master.deleteRow(idx); });

  Logger.log((dryRun ? '=== PREVIEW (walang binago) ===' : '=== REPAIR DONE ==='));
  Logger.log('Resolved (' + report.resolved.length + '):\n' + report.resolved.join('\n'));
  Logger.log((dryRun ? 'Buburahin' : 'Binura') + ' - walang progress (' + report.deleted.length + '):\n' + report.deleted.join('\n'));
  Logger.log('Kailangan ng student mag-login/register ulit (' + report.needsStudent.length + '):\n' + report.needsStudent.join('\n'));
  return report;
}

/**
 * DIAGNOSTIC: scans sheets for LRNs with wrong format or missing in StudentsMaster.
 * Run in Apps Script Editor (Run > auditLRNs).
 */
function auditLRNs() {
  var masterSheet = getOrCreateSheet(CONFIG.STUDENTS_MASTER_SHEET);
  var masterData = masterSheet.getDataRange().getValues();
  var masterLRNs = {};

  for (var i = 1; i < masterData.length; i++) {
    var key = _lrnKey(masterData[i][0]);
    if (key) masterLRNs[key] = {
      row: i + 1,
      raw: masterData[i][0],
      name: (masterData[i][1] || '') + ', ' + (masterData[i][2] || '')
    };
  }

  Logger.log('=== MASTER LIST ===');
  Logger.log('Total valid LRNs: ' + Object.keys(masterLRNs).length);

  var attemptsSheet = getOrCreateSheet(CONFIG.ATTEMPTS_SHEET);
  var attemptsData = attemptsSheet.getDataRange().getValues();
  var orphanAttempts = {};

  for (var j = 1; j < attemptsData.length; j++) {
    var rawLrn = attemptsData[j][1];
    var cleanLrn = _lrnKey(rawLrn);
    if (!cleanLrn) {
      Logger.log('❌ INVALID LRN in Attempts row ' + (j+1) + ': "' + rawLrn + '"');
      continue;
    }
    if (!masterLRNs[cleanLrn]) {
      if (!orphanAttempts[cleanLrn]) orphanAttempts[cleanLrn] = { raw: rawLrn, count: 0, rows: [] };
      orphanAttempts[cleanLrn].count++;
      orphanAttempts[cleanLrn].rows.push(j + 1);
    }
  }

  Logger.log('\n=== ORPHAN ATTEMPTS (wala sa Master List) ===');
  Object.keys(orphanAttempts).forEach(function(lrn) {
    var o = orphanAttempts[lrn];
    Logger.log('⚠️ LRN: ' + lrn + ' (raw: "' + o.raw + '") — ' + o.count + ' attempts, rows: ' + o.rows.join(','));
  });

  Logger.log('\n=== MASTER LIST FORMAT CHECK ===');
  for (var m = 1; m < masterData.length; m++) {
    var raw = masterData[m][0];
    var cleaned = _lrnKey(raw);
    if (String(raw) !== cleaned) {
      Logger.log('⚠️ Row ' + (m+1) + ': raw="' + raw + '" → cleaned="' + cleaned + '"');
    }
  }

  Logger.log('\n=== DONE ===');
  Logger.log('Orphan LRNs found: ' + Object.keys(orphanAttempts).length);
}

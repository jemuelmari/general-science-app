/* ============================================================
   Code.gs — Google Apps Script backend for General Science App
   Version: 1.0.0
   ------------------------------------------------------------
   PURPOSE:
   - Enables cross-device Sync Codes for students
   - Stores student data in a Google Sheet
   - Lets teacher pull all pending records at once
   - Handles HMAC signature verification server-side

   SETUP INSTRUCTIONS:
   1. Create a new Google Sheet (e.g., "GSA Sync Backend")
   2. Go to Extensions → Apps Script
   3. Delete the default code, paste this entire file
   4. Click "Deploy" → "New deployment"
   5. Select type: "Web app"
   6. Description: "GSA Backend v1"
   7. Execute as: "Me"
   8. Who has access: "Anyone"
   9. Click Deploy → Authorize → Copy the Web App URL
   10. Paste that URL into config.js → BACKEND_URL
   11. Done! Sync Center can now pull data across devices.

   SHEETS STRUCTURE (auto-created):
   - Sheet 1: "SyncCodes"
     Columns: code | lrn | studentName | section | payload | signature | createdAt | used
   - Sheet 2: "Log"
     Columns: timestamp | action | lrn | code | status | notes
   ============================================================ */

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  SYNC_CODES_SHEET: 'SyncCodes',
  LOG_SHEET: 'Log',
  CODE_EXPIRY_DAYS: 30,
  MAX_CODES_PER_STUDENT: 5,
  // Secret must match SECRET in assets/js/security.js
  HMAC_SECRET: 'GSA-2026-DEPED-SECRET-KEY-v1',
  ALLOWED_ORIGINS: '*' // Restrict to your domain in production
};

// ============================================================
// MAIN ROUTER
// ============================================================

function doPost(e) {
  try {
    const body = parseBody(e);
    const action = body.action;

    logAction(action, body.lrn, body.code, 'received');

    let response;
    switch (action) {
      case 'registerSyncCode':
        response = registerSyncCode(body);
        break;
      case 'resolveSyncCode':
        response = resolveSyncCode(body);
        break;
      case 'pullAllPending':
        response = pullAllPending(body);
        break;
      case 'deleteSyncCode':
        response = deleteSyncCode(body);
        break;
      case 'health':
        response = { ok: true, message: 'GSA backend is running', time: new Date().toISOString() };
        break;
      default:
        response = { ok: false, error: 'Unknown action: ' + action };
    }

    logAction(action, body.lrn, body.code, response.ok ? 'success' : 'error', response.error || '');

    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logAction('doPost', '', '', 'exception', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'ping') {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        service: 'GSA Sync Backend',
        version: '1.0.0',
        time: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'count') {
    const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
    const count = Math.max(0, sheet.getLastRow() - 1);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, totalCodes: count }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ACTION: registerSyncCode
// ============================================================

function registerSyncCode(body) {
  const { code, lrn, payload, signature } = body;

  if (!code || !lrn || !payload || !signature) {
    return { ok: false, error: 'Missing required fields (code, lrn, payload, signature)' };
  }

  // Verify signature server-side
  if (!verifySignature(payload, signature)) {
    return { ok: false, error: 'Signature verification failed' };
  }

  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);

  // Check if code already exists
  const existing = findRowByCode(code);
  if (existing) {
    return { ok: false, error: 'Code already exists' };
  }

  // Add row
  const student = payload.student || {};
  const studentName = `${student.lastName || ''}, ${student.firstName || ''}`;
  const section = student.section || '';
  const createdAt = new Date().toISOString();

  sheet.appendRow([
    code,
    lrn,
    studentName,
    section,
    JSON.stringify(payload),
    signature,
    createdAt,
    'false'
  ]);

  // Trim old codes (keep only latest N per student)
  trimOldCodes(lrn);

  return {
    ok: true,
    code: code,
    createdAt: createdAt,
    message: 'Sync code registered'
  };
}

// ============================================================
// ACTION: resolveSyncCode
// ============================================================

function resolveSyncCode(body) {
  const { code } = body;
  if (!code) return { ok: false, error: 'Missing code' };

  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();

  // Skip header
  for (let i = 1; i < data.length; i++) {
    const rowCode = data[i][0];
    if (rowCode === code) {
      // Check expiry
      const createdAt = new Date(data[i][6]);
      const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > CONFIG.CODE_EXPIRY_DAYS) {
        return { ok: false, error: 'Sync code has expired' };
      }

      const payload = JSON.parse(data[i][4]);
      const signature = data[i][5];

      // Verify again before returning
      if (!verifySignature(payload, signature)) {
        return { ok: false, error: 'Stored data failed verification' };
      }

      return {
        ok: true,
        payload: payload,
        signature: signature,
        createdAt: data[i][6]
      };
    }
  }

  return { ok: false, error: 'Code not found' };
}

// ============================================================
// ACTION: pullAllPending (Teacher pulls all unused codes)
// ============================================================

function pullAllPending(body) {
  const { section, lrn } = body;

  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowLrn = row[1];
    const rowSection = row[3];
    const used = row[7] === 'true' || row[7] === true;

    // Filter by optional params
    if (lrn && rowLrn !== lrn) continue;
    if (section && rowSection !== section) continue;
    if (used) continue;

    // Check expiry
    const createdAt = new Date(row[6]);
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > CONFIG.CODE_EXPIRY_DAYS) continue;

    let payload, signature;
    try {
      payload = JSON.parse(row[4]);
      signature = row[5];
    } catch (e) {
      continue;
    }

    records.push({
      code: row[0],
      lrn: rowLrn,
      studentName: row[2],
      section: rowSection,
      payload: payload,
      signature: signature,
      createdAt: row[6]
    });
  }

  return {
    ok: true,
    count: records.length,
    records: records
  };
}

// ============================================================
// ACTION: deleteSyncCode (mark as used)
// ============================================================

function deleteSyncCode(body) {
  const { code } = body;
  if (!code) return { ok: false, error: 'Missing code' };

  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      sheet.getRange(i + 1, 8).setValue('true'); // mark used
      return { ok: true, message: 'Sync code marked as used' };
    }
  }

  return { ok: false, error: 'Code not found' };
}

// ============================================================
// HMAC SIGNATURE VERIFICATION (SHA-256)
// ============================================================

function verifySignature(payload, signature) {
  try {
    const json = JSON.stringify(payload);
    const expected = computeHMAC(json, CONFIG.HMAC_SECRET);
    return expected === signature;
  } catch (e) {
    return false;
  }
}

function computeHMAC(message, secret) {
  const rawHmac = Utilities.computeHmacSha256Signature(message, secret);
  return rawHmac
    .map((byte) => ((byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')))
    .join('');
}

// ============================================================
// SHEET HELPERS
// ============================================================

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === CONFIG.SYNC_CODES_SHEET) {
      sheet.appendRow([
        'code', 'lrn', 'studentName', 'section',
        'payload', 'signature', 'createdAt', 'used'
      ]);
      sheet.setFrozenRows(1);
    } else if (name === CONFIG.LOG_SHEET) {
      sheet.appendRow(['timestamp', 'action', 'lrn', 'code', 'status', 'notes']);
      sheet.setFrozenRows(1);
    }
  }

  return sheet;
}

function findRowByCode(code) {
  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) return { row: i + 1, data: data[i] };
  }
  return null;
}

function trimOldCodes(lrn) {
  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === lrn) {
      rows.push({ rowIndex: i + 1, createdAt: new Date(data[i][6]) });
    }
  }

  // If more than max, delete oldest
  if (rows.length > CONFIG.MAX_CODES_PER_STUDENT) {
    rows.sort((a, b) => a.createdAt - b.createdAt);
    const toDelete = rows.slice(0, rows.length - CONFIG.MAX_CODES_PER_STUDENT);
    // Delete in reverse order so indices don't shift
    toDelete.reverse().forEach((r) => sheet.deleteRow(r.rowIndex));
  }
}

// ============================================================
// LOGGING
// ============================================================

function logAction(action, lrn, code, status, notes) {
  try {
    const sheet = getOrCreateSheet(CONFIG.LOG_SHEET);
    sheet.appendRow([
      new Date().toISOString(),
      action || '',
      lrn || '',
      code || '',
      status || '',
      notes || ''
    ]);
  } catch (e) {
    // Logging failure should not break the main flow
    console.error('Log error:', e);
  }
}

// ============================================================
// OPTIONAL: MANUAL CLEANUP / MAINTENANCE
// Run these functions manually from the Apps Script editor.
// ============================================================

/**
 * Delete all rows older than 60 days (manual cleanup).
 */
function cleanupOldCodes() {
  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();
  const cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
  const toDelete = [];

  for (let i = 1; i < data.length; i++) {
    const createdAt = new Date(data[i][6]).getTime();
    if (createdAt < cutoff) toDelete.push(i + 1);
  }

  toDelete.reverse().forEach((idx) => sheet.deleteRow(idx));
  return { deleted: toDelete.length };
}

/**
 * Reset the Log sheet (manual trigger).
 */
function clearLog() {
  const sheet = getOrCreateSheet(CONFIG.LOG_SHEET);
  sheet.clear();
  sheet.appendRow(['timestamp', 'action', 'lrn', 'code', 'status', 'notes']);
  return { cleared: true };
}

/**
 * Manually verify that a specific code's signature matches the payload.
 * Useful for debugging.
 */
function testSignatureCheck(code) {
  const sheet = getOrCreateSheet(CONFIG.SYNC_CODES_SHEET);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      const payload = JSON.parse(data[i][4]);
      const signature = data[i][5];
      const expected = computeHMAC(JSON.stringify(payload), CONFIG.HMAC_SECRET);
      return {
        code: code,
        matches: expected === signature,
        storedSignature: signature,
        computedSignature: expected
      };
    }
  }

  return { error: 'Code not found' };
}
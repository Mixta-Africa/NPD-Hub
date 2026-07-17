/**
 * ═══════════════════════════════════════════════════════════════
 *  MIXTA AFRICA — NPD HUB  |  Google Apps Script Backend
 *  Version: 1.0 (Phase 1 stub — ready for Phase 4 Drive/email logic)
 * ═══════════════════════════════════════════════════════════════
 *
 *  SETUP INSTRUCTIONS (one-time):
 *  1. Go to https://script.google.com → New project
 *  2. Paste this entire file, save as "NPD Hub Backend"
 *  3. Click Deploy → New deployment
 *     - Type: Web app
 *     - Execute as: Me (your Mixta Workspace account)
 *     - Who has access: Anyone  (the Firebase Auth in the frontend
 *       is the security layer — GAS just needs to receive requests)
 *  4. Copy the Web App URL → add to GitHub Secrets as GAS_ENDPOINT
 *  5. IMPORTANT: if you ever redeploy, copy the NEW URL and update
 *     the GitHub Secret — the URL changes on every new deployment.
 *
 *  HOW IT WORKS:
 *  - Frontend (index.html) calls this endpoint via POST with JSON
 *  - GitHub Actions cron also calls this endpoint for deadline checks
 *  - This script routes to the right function based on `action` field
 * ═══════════════════════════════════════════════════════════════
 */

// ─── CORS + POST HANDLER ───────────────────────────────────────
function doPost(e) {
  const origin  = e.parameter.origin || '*';
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };

  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    let result   = {};

    switch (action) {
      // ── Phase 4: Drive + onboarding email ──────────────────
      case 'createProductDrive':
        result = createProductDriveFolder(body);
        break;
      case 'sendOnboardingEmails':
        result = sendOnboardingEmails(body);
        break;

      // ── Phase 5: Deadline alert emails ─────────────────────
      case 'checkDeadlines':
        result = checkAndSendDeadlineAlerts(body);
        break;

      // ── Phase 6: Progress report ────────────────────────────
      case 'sendProgressReport':
        result = sendProgressReport(body);
        break;
      case 'logToAuditSheet':
        result = logToAuditSheet(body);
        break;

      // ── Phase 1: Health check ───────────────────────────────
      case 'ping':
        result = { ok: true, message: 'NPD Hub GAS backend is live.', timestamp: new Date().toISOString() };
        break;

      default:
        result = { ok: false, error: `Unknown action: ${action}` };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle GET for health check from browser
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'NPD Hub GAS is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4 — DRIVE FOLDER CREATION
//  Called when admin creates a new product.
//  Creates a structured folder tree in the NPD Hub parent folder,
//  then shares it with all stakeholder emails.
// ─────────────────────────────────────────────────────────────
function createProductDriveFolder(body) {
  /* TODO Phase 4 — implement:
  
  const { productName, launchDate, stakeholderEmails } = body;
  
  // 1. Find or create root NPD Hub folder
  const rootName   = 'NPD Hub — Mixta Africa';
  const rootFolder = getOrCreateFolder(rootName, DriveApp.getRootFolder());
  
  // 2. Create product subfolder
  const folderName    = `${productName} — Launch ${launchDate}`;
  const productFolder = rootFolder.createFolder(folderName);
  
  // 3. Create pillar subfolders
  const subfolders = [
    '01 - Market Research & Survey',
    '02 - Design & Development Docs',
    '03 - Financial Model',
    '04 - AMC Presentation Deck',
    '05 - Legal Documentation',
    '06 - Factsheet & Brief',
    '07 - Marketing Materials',
    '08 - Progress Reports'
  ];
  subfolders.forEach(name => productFolder.createFolder(name));
  
  // 4. Share with stakeholders (viewer access)
  stakeholderEmails.forEach(email => {
    try {
      productFolder.addViewer(email);
    } catch(e) {
      Logger.log('Share failed for: ' + email + ' — ' + e.message);
    }
  });
  
  return { ok: true, folderId: productFolder.getId(), folderUrl: productFolder.getUrl() };
  */
  
  return { ok: true, stub: true, message: 'createProductDrive — Phase 4 implementation pending.' };
}

function getOrCreateFolder(name, parent) {
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4 — ONBOARDING EMAILS
//  Sends a structured email to each stakeholder department
//  outlining their specific SOP pillar responsibilities.
// ─────────────────────────────────────────────────────────────
function sendOnboardingEmails(body) {
  /* TODO Phase 4 — implement:
  
  const { productName, launchDate, folderUrl, pillars } = body;
  
  // Group pillars by owner department
  // For each department, email all contacts in that department
  // Template: product overview + their specific pillars + folder link
  
  */
  
  return { ok: true, stub: true, message: 'sendOnboardingEmails — Phase 4 implementation pending.' };
}

// ─────────────────────────────────────────────────────────────
//  PHASE 5 — DEADLINE ALERT ENGINE
//  Called daily by GitHub Actions cron.
//  Reads overdue/warning pillar data passed from Actions
//  (Actions fetches from Firebase REST API, passes here).
// ─────────────────────────────────────────────────────────────
function checkAndSendDeadlineAlerts(body) {
  /* TODO Phase 5 — implement:
  
  const { alerts } = body;
  // alerts = [{ productName, pillarName, deptEmails, daysUntil, status }]
  // status: 'warning' (3 days), 'due' (today), 'overdue' (N days late)
  
  alerts.forEach(alert => {
    const subject = buildAlertSubject(alert);
    const html    = buildAlertEmail(alert);
    alert.deptEmails.forEach(email => {
      GmailApp.sendEmail(email, subject, '', { htmlBody: html, name: 'Mixta Africa NPD Hub' });
    });
  });
  
  */
  
  return { ok: true, stub: true, message: 'checkDeadlines — Phase 5 implementation pending.' };
}

// ─────────────────────────────────────────────────────────────
//  PHASE 6 — PROGRESS REPORT + AUDIT LOG
// ─────────────────────────────────────────────────────────────
function sendProgressReport(body) {
  return { ok: true, stub: true, message: 'sendProgressReport — Phase 6 implementation pending.' };
}

function logToAuditSheet(body) {
  /* TODO Phase 6 — implement:
  
  const ss     = SpreadsheetApp.openById('YOUR_AUDIT_SHEET_ID');
  const sheet  = ss.getSheetByName('Audit Log') || ss.insertSheet('Audit Log');
  const { productName, event, user, timestamp, data } = body;
  sheet.appendRow([timestamp, productName, event, user, JSON.stringify(data)]);
  
  */
  
  return { ok: true, stub: true, message: 'logToAuditSheet — Phase 6 implementation pending.' };
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  MIXTA AFRICA — NPD HUB  |  Google Apps Script Backend
 *  Version: 2.0 (Phase 4 — Drive + Onboarding Emails LIVE)
 * ═══════════════════════════════════════════════════════════════
 *
 *  IMPORTANT — REDEPLOYMENT REQUIRED FOR PHASE 4:
 *  1. Open script.google.com → your NPD Hub Backend project
 *  2. Replace ALL code with this file
 *  3. Deploy → Manage deployments → Edit (pencil) → New version → Deploy
 *  4. The URL stays the same when you edit an existing deployment ✅
 *     (Only changes if you create a brand new deployment — don't do that)
 * ═══════════════════════════════════════════════════════════════
 */

// ─── ROOT FOLDER NAME in Google Drive ─────────────────────────
const NPD_ROOT_FOLDER = 'NPD Hub — Mixta Africa';

// ─── SENDER NAME shown in outgoing emails ─────────────────────
const SENDER_NAME  = 'Mixta Africa NPD Hub';

// ─── TEST MODE ─────────────────────────────────────────────────
// When testMode=true in the payload, ALL emails redirect to TEST_EMAIL
// Real mailing lists are untouched — only the recipients change
const TEST_EMAIL = 'o.olasunkanmi@mixtafrica.com';

function resolveRecipients(emails, testMode) {
  if (testMode) {
    Logger.log('TEST MODE: redirecting ' + emails.length + ' email(s) to ' + TEST_EMAIL);
    return [TEST_EMAIL];
  }
  return emails;
}

// ─── CORS + POST HANDLER ──────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    let result   = {};

    switch (action) {
      case 'createProductDrive':    result = createProductDriveFolder(body);  break;
      case 'sendOnboardingEmails':  result = sendOnboardingEmails(body);       break;
      case 'checkDeadlines':        result = checkAndSendDeadlineAlerts(body); break;
      case 'sendProgressReport':    result = sendProgressReport(body);         break;
      case 'logToAuditSheet':       result = logToAuditSheet(body);            break;
      case 'uploadDocument':        result = uploadDocument(body);               break;
      case 'sendDeadlineReminder':  result = sendDeadlineReminder(body);         break;
      case 'sendHandoverPackage':   result = sendHandoverPackage(body);          break;
      case 'ping':                  result = { ok: true, message: 'NPD Hub GAS v2.0 is live.', ts: new Date().toISOString() }; break;
      default:                      result = { ok: false, error: 'Unknown action: ' + action };
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

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'NPD Hub GAS v2.0 running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4 ── DRIVE FOLDER CREATION
// ─────────────────────────────────────────────────────────────
function createProductDriveFolder(body) {
  try {
    const { productName, productId, launchDate, stakeholderEmails } = body;

    // 1. Find or create root NPD Hub folder
    const rootFolder = getOrCreateFolder(NPD_ROOT_FOLDER, DriveApp.getRootFolder());

    // 2. Create product subfolder
    const folderName    = productName + ' — Launch ' + launchDate;
    const productFolder = rootFolder.createFolder(folderName);

    // 3. Create the 8 standard document subfolders
    const subfolders = [
      '01 - Market Research & Survey',
      '02 - Design & Development Docs',
      '03 - Financial Model',
      '04 - AMC Presentation Deck',
      '05 - Legal Documentation',
      '06 - Factsheet & Brief',
      '07 - Marketing Materials',
      '08 - Progress Reports',
    ];
    subfolders.forEach(function(name) {
      productFolder.createFolder(name);
    });

    // 4. Share with each stakeholder as Viewer
    var shareErrors = [];
    (stakeholderEmails || []).forEach(function(email) {
      try {
        productFolder.addViewer(email);
      } catch(e) {
        shareErrors.push(email + ': ' + e.message);
        Logger.log('Share failed for ' + email + ': ' + e.message);
      }
    });

    // 5. Log to audit
    logEvent('Drive folder created', productName, productFolder.getUrl());

    return {
      ok:          true,
      folderId:    productFolder.getId(),
      folderUrl:   productFolder.getUrl(),
      folderName:  folderName,
      shareErrors: shareErrors,
    };

  } catch(err) {
    Logger.log('createProductDriveFolder error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function getOrCreateFolder(name, parent) {
  var iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

// ─────────────────────────────────────────────────────────────
//  PHASE 4 ── ONBOARDING EMAILS
// ─────────────────────────────────────────────────────────────
function sendOnboardingEmails(body) {
  try {
    const { productName, productId, launchDate, folderUrl, createdBy, stakeholders, pillars } = body;

    // Build a dept→pillars responsibility map for personalised emails
    var deptPillarMap = {};
    (stakeholders || []).forEach(function(s) {
      if (!deptPillarMap[s.dept]) deptPillarMap[s.dept] = [];
      // Find pillar names for this stakeholder's pillar IDs
      (s.pillarIds || []).forEach(function(pid) {
        var pl = (pillars || []).find(function(p) { return p.id === pid; });
        if (pl && !deptPillarMap[s.dept].includes(pl.name)) {
          deptPillarMap[s.dept].push(pl.name);
        }
      });
    });

    var sent = 0, errors = [];

    var onboardingRecipients = resolveRecipients(
      (stakeholders || []).map(function(s) { return s.email; }),
      body.testMode
    );
    var onboardingStakeholders = (stakeholders || []).filter(function(s) {
      return onboardingRecipients.includes(s.email) ||
             (body.testMode && s.email === (stakeholders[0] || {}).email);
    });
    // In test mode send one email summarising all recipients
    var effectiveStakeholders = body.testMode
      ? [{ email: TEST_EMAIL, name: 'Test Recipient', dept: 'TEST', pillarIds: [] }]
      : (stakeholders || []);

    effectiveStakeholders.forEach(function(s) {
      try {
        var myPillars = deptPillarMap[s.dept] || [];
        var pillarLine = myPillars.length > 0
          ? '<p><strong>Your department\'s SOP responsibilities:</strong></p><ul>' +
            myPillars.map(function(p) { return '<li>' + p + '</li>'; }).join('') + '</ul>'
          : '<p>You have been added as a key stakeholder for this product launch.</p>';

        var subject = (body.testMode ? '[TEST] ' : '') + 'New Product Launch: ' + productName + ' — Action Required';
        var htmlBody = buildOnboardingEmail(productName, launchDate, folderUrl, createdBy, pillarLine, s.name);

        GmailApp.sendEmail(s.email, subject, '', {
          htmlBody: htmlBody,
          name:     SENDER_NAME,
        });
        sent++;
      } catch(e) {
        errors.push(s.email + ': ' + e.message);
        Logger.log('Email failed for ' + s.email + ': ' + e.message);
      }
    });

    logEvent('Onboarding emails sent (' + sent + ')', productName, '');

    return { ok: true, sent: sent, errors: errors };

  } catch(err) {
    Logger.log('sendOnboardingEmails error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function buildOnboardingEmail(productName, launchDate, folderUrl, createdBy, pillarLine, recipientName) {
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
  '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +

  // Header
  '<div style="background:#C0282D;padding:24px 28px;">' +
    '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Mixta Africa — New Product Development Hub</div>' +
    '<div style="color:white;font-size:22px;font-weight:700;">New Product Launch Initiated</div>' +
  '</div>' +

  // Body
  '<div style="padding:28px;">' +
    '<p style="margin:0 0 16px;color:#1a1a18;">Dear ' + recipientName + ',</p>' +
    '<p style="color:#6b6b67;line-height:1.7;margin:0 0 16px;">A new product has been launched on the Mixta Africa NPD Hub. Your department has been identified as a key stakeholder and has been given access to the shared product drive folder.</p>' +

    // Product card
    '<div style="background:#f8f8f7;border-radius:8px;padding:16px 20px;margin-bottom:20px;">' +
      '<div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Product</div>' +
      '<div style="font-size:18px;font-weight:700;color:#1a1a18;margin-bottom:12px;">' + productName + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;"><strong>Target Launch Date:</strong> ' + launchDate + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;margin-top:4px;"><strong>Initiated by:</strong> ' + createdBy + '</div>' +
    '</div>' +

    // Responsibilities
    '<div style="margin-bottom:20px;font-size:14px;color:#1a1a18;line-height:1.7;">' +
      pillarLine +
    '</div>' +

    // Drive link
    '<div style="text-align:center;margin:24px 0;">' +
      '<a href="' + folderUrl + '" style="background:#C0282D;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Open Product Drive Folder</a>' +
    '</div>' +

    '<p style="font-size:12px;color:#9a9a96;line-height:1.6;margin:0;">You are receiving this email because your team has been identified as a stakeholder for this product launch. Please log in to the NPD Hub to track milestones and update your pillar status.</p>' +
  '</div>' +

  // Footer
  '<div style="background:#f8f8f7;padding:16px 28px;border-top:1px solid #e5e4e0;">' +
    '<div style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; This is an automated notification</div>' +
  '</div>' +

  '</div></body></html>';
}

// ─────────────────────────────────────────────────────────────
//  PHASE 5 ── DEADLINE ALERTS (stub — implemented in Phase 5)
// ─────────────────────────────────────────────────────────────
function checkAndSendDeadlineAlerts(body) {
  try {
    const alerts = body.alerts || [];
    if (alerts.length === 0) return { ok: true, sent: 0, message: 'No alerts to send.' };

    var sent = 0, errors = [];

    alerts.forEach(function(alert) {
      try {
        var subject = buildAlertSubject(alert);
        var html    = buildAlertEmail(alert);
        var alertRecipients = resolveRecipients(alert.deptEmails || [], body.testMode);
        var alertSubject = (body.testMode ? '[TEST] ' : '') + subject;
        alertRecipients.forEach(function(email) {
          try {
            GmailApp.sendEmail(email, alertSubject, '', { htmlBody: html, name: SENDER_NAME });
            sent++;
          } catch(e) {
            errors.push(email + ': ' + e.message);
            Logger.log('Alert email failed for ' + email + ': ' + e.message);
          }
        });
      } catch(e) {
        errors.push('Alert processing failed: ' + e.message);
      }
    });

    logEvent('Deadline alerts sent (' + sent + ')', 'All products', errors.length + ' errors');
    return { ok: true, sent: sent, errors: errors };

  } catch(err) {
    Logger.log('checkAndSendDeadlineAlerts error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function buildAlertSubject(alert) {
  var prefix = alert.alertType === 'overdue'  ? '🔴 OVERDUE'
             : alert.alertType === 'due'      ? '🟡 DUE TODAY'
             : '⚠️ DEADLINE IN 3 DAYS';
  return prefix + ': ' + alert.pillarName + ' — ' + alert.productName;
}

function buildAlertEmail(alert) {
  var daysText = alert.daysUntil < 0
    ? Math.abs(alert.daysUntil) + ' day' + (Math.abs(alert.daysUntil) > 1 ? 's' : '') + ' overdue'
    : alert.daysUntil === 0 ? 'Due today'
    : 'Due in ' + alert.daysUntil + ' day' + (alert.daysUntil > 1 ? 's' : '');

  var headerBg = alert.alertType === 'overdue' ? '#C0282D'
               : alert.alertType === 'due'     ? '#D97706'
               : '#D97706';

  var urgencyMsg = alert.alertType === 'overdue'
    ? 'This pillar is <strong>overdue</strong>. Immediate action is required to update the task status or escalate.'
    : alert.alertType === 'due'
    ? 'This pillar is <strong>due today</strong>. Please update the task status on the NPD Hub.'
    : 'This pillar deadline is <strong>3 days away</strong>. Please review progress and ensure it is on track.';

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
  '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +

  '<div style="background:' + headerBg + ';padding:20px 28px;">' +
    '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Mixta Africa — NPD Hub Deadline Alert</div>' +
    '<div style="color:white;font-size:20px;font-weight:700;">' + daysText + '</div>' +
  '</div>' +

  '<div style="padding:24px 28px;">' +
    '<div style="background:#f8f8f7;border-radius:8px;padding:16px 20px;margin-bottom:20px;">' +
      '<div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Product</div>' +
      '<div style="font-size:16px;font-weight:700;color:#1a1a18;margin-bottom:10px;">' + alert.productName + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;"><strong>Pillar:</strong> ' + alert.pillarName + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;margin-top:4px;"><strong>Owner:</strong> ' + alert.ownerDept + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;margin-top:4px;"><strong>Deadline:</strong> ' + alert.deadline + '</div>' +
    '</div>' +

    '<p style="font-size:14px;color:#1a1a18;line-height:1.7;margin:0 0 20px;">' + urgencyMsg + '</p>' +

    '<p style="font-size:12px;color:#9a9a96;line-height:1.6;margin:0;">This is an automated alert from the Mixta Africa NPD Hub deadline monitoring system. Only your department received this alert.</p>' +
  '</div>' +

  '<div style="background:#f8f8f7;padding:14px 28px;border-top:1px solid #e5e4e0;">' +
    '<div style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Automated Deadline Alert</div>' +
  '</div>' +

  '</div></body></html>';
}

// ─────────────────────────────────────────────────────────────
//  PHASE 6 ── PROGRESS REPORT + AUDIT LOG
// ─────────────────────────────────────────────────────────────
function sendProgressReport(body) {
  try {
    const {
      productName, productId, launchDate, reportDate, generatedBy,
      pctComplete, complete, inProgress, notStarted, overdue,
      notes, pillarSummary, onboardedEmails, driveUrl
    } = body;

    // Fall back to all enabled stakeholders if product hasn't been formally onboarded
    var recipients = (onboardedEmails && onboardedEmails.length > 0)
      ? onboardedEmails
      : (body.allStakeholderEmails || []);

    if (!recipients || recipients.length === 0) {
      return { ok: false, error: 'No recipients found. Please onboard this product first or provide stakeholder emails.' };
    }

    const subject  = (body.testMode ? '[TEST] ' : '') + 'NPD Progress Report: ' + productName + ' — ' + reportDate;
    const htmlBody = buildProgressReportEmail(body);

    var sent = 0, errors = [];
    var effectiveRecipients = resolveRecipients(recipients, body.testMode);
    effectiveRecipients.forEach(function(email) {
      try {
        GmailApp.sendEmail(email, subject, '', { htmlBody: htmlBody, name: SENDER_NAME });
        sent++;
      } catch(e) {
        errors.push(email + ': ' + e.message);
        Logger.log('Progress report email failed for ' + email + ': ' + e.message);
      }
    });

    // Save report copy to Drive progress reports folder if driveUrl exists
    if (driveUrl) {
      try {
        var productFolder = DriveApp.getFolderById(getFolderIdFromUrl(driveUrl));
        var reportsIter   = productFolder.getFoldersByName('08 - Progress Reports');
        var reportsFolder = reportsIter.hasNext() ? reportsIter.next() : productFolder.createFolder('08 - Progress Reports');
        var reportContent = buildProgressReportText(body);
        reportsFolder.createFile(
          'Progress Report — ' + productName + ' — ' + reportDate + '.txt',
          reportContent,
          MimeType.PLAIN_TEXT
        );
      } catch(e) {
        Logger.log('Drive report save failed: ' + e.message);
      }
    }

    logEvent('Progress report sent (' + sent + ' recipients)', productName, reportDate);
    return { ok: true, sent: sent, errors: errors };

  } catch(err) {
    Logger.log('sendProgressReport error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function getFolderIdFromUrl(url) {
  // Extract folder ID from Drive URL: https://drive.google.com/drive/folders/FOLDER_ID
  var match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function buildProgressReportEmail(data) {
  var statusColor = data.pctComplete >= 75 ? '#16A34A' : data.pctComplete >= 40 ? '#D97706' : '#C0282D';
  var pillarRows  = (data.pillarSummary || []).map(function(pl, i) {
    var stColor = pl.status === 'complete'    ? '#16A34A'
                : pl.status === 'in-progress' ? '#2563EB'
                : '#6B7280';
    return '<tr style="border-bottom:1px solid #e5e4e0;">' +
      '<td style="padding:8px 12px;font-size:12px;color:#6b6b67;">' + (i+1) + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;font-weight:500;color:#1a1a18;">' + pl.pillar + '</td>' +
      '<td style="padding:8px 12px;font-size:12px;color:#6b6b67;">' + pl.owner + '</td>' +
      '<td style="padding:8px 12px;"><span style="font-size:11px;font-weight:600;color:' + stColor + ';text-transform:uppercase;letter-spacing:.04em;">' + pl.status.replace('-',' ') + '</span></td>' +
      '<td style="padding:8px 12px;font-size:12px;color:#6b6b67;">' + (pl.deadline || '—') + '</td>' +
    '</tr>';
  }).join('');

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
  '<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +

  '<div style="background:#C0282D;padding:22px 28px;">' +
    '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Mixta Africa — NPD Hub Progress Report</div>' +
    '<div style="color:white;font-size:20px;font-weight:700;">' + data.productName + '</div>' +
    '<div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Report date: ' + data.reportDate + ' &nbsp;·&nbsp; Generated by: ' + data.generatedBy + '</div>' +
  '</div>' +

  '<div style="padding:24px 28px;">' +
    // Summary stats
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">' +
      '<div style="background:#f8f8f7;border-radius:6px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:700;color:' + statusColor + ';">' + data.pctComplete + '%</div><div style="font-size:11px;color:#9a9a96;margin-top:2px;">Complete</div></div>' +
      '<div style="background:#f8f8f7;border-radius:6px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#16A34A;">' + data.complete + '</div><div style="font-size:11px;color:#9a9a96;margin-top:2px;">Done</div></div>' +
      '<div style="background:#f8f8f7;border-radius:6px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#2563EB;">' + data.inProgress + '</div><div style="font-size:11px;color:#9a9a96;margin-top:2px;">In Progress</div></div>' +
      '<div style="background:#f8f8f7;border-radius:6px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:700;color:#C0282D;">' + data.overdue + '</div><div style="font-size:11px;color:#9a9a96;margin-top:2px;">Overdue</div></div>' +
    '</div>' +

    (data.notes ? '<div style="background:#FEF3C7;border-radius:6px;padding:14px 16px;margin-bottom:20px;font-size:13px;color:#92400E;line-height:1.6;"><strong>Notes:</strong> ' + data.notes + '</div>' : '') +

    // Pillar table
    '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">' +
      '<thead><tr style="background:#f8f8f7;">' +
        '<th style="padding:10px 12px;text-align:left;font-size:11px;color:#9a9a96;font-weight:600;text-transform:uppercase;letter-spacing:.05em;width:32px;">#</th>' +
        '<th style="padding:10px 12px;text-align:left;font-size:11px;color:#9a9a96;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Pillar</th>' +
        '<th style="padding:10px 12px;text-align:left;font-size:11px;color:#9a9a96;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Owner</th>' +
        '<th style="padding:10px 12px;text-align:left;font-size:11px;color:#9a9a96;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Status</th>' +
        '<th style="padding:10px 12px;text-align:left;font-size:11px;color:#9a9a96;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Deadline</th>' +
      '</tr></thead>' +
      '<tbody>' + pillarRows + '</tbody>' +
    '</table>' +

    '<p style="font-size:12px;color:#9a9a96;line-height:1.6;">This is an automated progress report from the Mixta Africa NPD Hub.</p>' +
  '</div>' +
  '<div style="background:#f8f8f7;padding:14px 28px;border-top:1px solid #e5e4e0;"><div style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Automated Progress Report</div></div>' +
  '</div></body></html>';
}

function buildProgressReportText(data) {
  var lines = [
    'MIXTA AFRICA — NPD HUB PROGRESS REPORT',
    '==========================================',
    'Product: ' + data.productName,
    'Report Date: ' + data.reportDate,
    'Generated by: ' + data.generatedBy,
    '',
    'SUMMARY',
    '--------',
    'Overall completion: ' + data.pctComplete + '%',
    'Complete: ' + data.complete + '/12',
    'In Progress: ' + data.inProgress,
    'Overdue: ' + data.overdue,
    '',
  ];
  if (data.notes) lines.push('Notes: ' + data.notes, '');
  lines.push('PILLAR STATUS', '-------------');
  (data.pillarSummary || []).forEach(function(pl, i) {
    lines.push((i+1) + '. ' + pl.pillar + ' [' + pl.status + '] — ' + (pl.deadline || 'No date') + ' — ' + pl.owner);
    if (pl.notes) lines.push('   Note: ' + pl.notes);
  });
  return lines.join('\n');
}

function logToAuditSheet(body) {
  try {
    // Uses a dedicated Audit Log Google Sheet
    // First run: create the sheet manually or let this auto-create it
    var AUDIT_SHEET_NAME = 'NPD Hub Audit Log';
    var files = DriveApp.getFilesByName(AUDIT_SHEET_NAME);
    var ss;
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create(AUDIT_SHEET_NAME);
      var sh = ss.getActiveSheet();
      sh.appendRow(['Timestamp', 'Event', 'Product', 'Product ID', 'User', 'Data']);
      sh.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    var sheet = ss.getActiveSheet();
    sheet.appendRow([
      body.timestamp || new Date().toISOString(),
      body.event     || '',
      body.productName || '',
      body.productId   || '',
      body.user        || '',
      JSON.stringify(body.data || {}),
    ]);
    return { ok: true, sheetUrl: ss.getUrl() };
  } catch(err) {
    Logger.log('logToAuditSheet error: ' + err.message);
    return { ok: false, error: err.message };
  }
}


// ─────────────────────────────────────────────────────────────
//  PHASE 6 ── DOCUMENT UPLOAD
// ─────────────────────────────────────────────────────────────
function uploadDocument(body) {
  try {
    const { productName, folderId, folderName, fileName, fileType, fileBase64, driveUrl } = body;

    // Decode base64
    var decoded  = Utilities.base64Decode(fileBase64);
    var blob     = Utilities.newBlob(decoded, fileType || 'application/octet-stream', fileName);

    var targetFolder;
    if (driveUrl) {
      // Find the specific subfolder inside the product folder
      var productFolder = DriveApp.getFolderById(getFolderIdFromUrl(driveUrl));
      var subIter       = productFolder.getFoldersByName(folderName);
      targetFolder      = subIter.hasNext() ? subIter.next() : productFolder.createFolder(folderName);
    } else {
      // Fallback: upload to root NPD Hub folder
      targetFolder = getOrCreateFolder(NPD_ROOT_FOLDER, DriveApp.getRootFolder());
    }

    var file    = targetFolder.createFile(blob);
    var fileUrl = file.getUrl();
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    logEvent('Document uploaded', productName, fileName);
    return { ok: true, fileUrl: fileUrl, fileId: file.getId() };

  } catch(err) {
    Logger.log('uploadDocument error: ' + err.message);
    return { ok: false, error: err.message };
  }
}


// ─────────────────────────────────────────────────────────────
//  PHASE 7 ── HANDOVER PACKAGE
// ─────────────────────────────────────────────────────────────
function sendHandoverPackage(body) {
  try {
    const {
      productName, productId, launchDate, ownerName, ownerEmail,
      relieverName, relieverEmail, returnDate, notes,
      pillars, pillarData, weeklyLogs, driveUrl
    } = body;

    if (!relieverEmail) return { ok: false, error: 'No reliever email provided.' };

    var subject  = 'Handover Package: ' + productName + ' — until ' + returnDate;
    var htmlBody = buildHandoverEmail(body);

    var handoverTo = resolveRecipients([relieverEmail], body.testMode)[0];
    var handoverCC = resolveRecipients([ownerEmail], body.testMode)[0];
    var handoverSubject = (body.testMode ? '[TEST] ' : '') + subject;

    GmailApp.sendEmail(handoverTo, handoverSubject, '', {
      htmlBody: htmlBody,
      name:     SENDER_NAME,
    });
    GmailApp.sendEmail(handoverCC, '[CC] ' + handoverSubject, '', {
      htmlBody: htmlBody,
      name:     SENDER_NAME,
    });

    logEvent('Handover package sent', productName, relieverName + ' until ' + returnDate);
    return { ok: true, sent: 2 };

  } catch(err) {
    Logger.log('sendHandoverPackage error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function buildHandoverEmail(data) {
  var { productName, launchDate, ownerName, relieverName, returnDate, notes,
        pillars, pillarData, weeklyLogs, driveUrl } = data;

  // Pillar status rows
  var pillarRows = (pillars || []).map(function(pl, i) {
    var pd      = pillarData[pl.id] || {};
    var st      = pd.taskStatus || 'not-started';
    var stColor = st === 'complete'    ? '#16A34A'
                : st === 'in-progress' ? '#2563EB' : '#6B7280';
    return '<tr style="border-bottom:1px solid #e5e4e0;">' +
      '<td style="padding:7px 10px;font-size:12px;color:#6b6b67;">' + (i+1) + '</td>' +
      '<td style="padding:7px 10px;font-size:13px;font-weight:500;">' + pl.name + '</td>' +
      '<td style="padding:7px 10px;font-size:12px;color:#6b6b67;">' + (pd.deadline || '—') + '</td>' +
      '<td style="padding:7px 10px;"><span style="font-size:11px;font-weight:600;color:' + stColor + ';">' + st.replace('-',' ').toUpperCase() + '</span></td>' +
      '<td style="padding:7px 10px;font-size:12px;color:#6b6b67;">' + (pd.notes || '—') + '</td>' +
    '</tr>';
  }).join('');

  // Weekly log rows (last 4 weeks)
  var logHtml = '';
  if (weeklyLogs && weeklyLogs.length > 0) {
    weeklyLogs.forEach(function(log) {
      logHtml += '<div style="margin-bottom:16px;padding:14px;background:#f8f8f7;border-radius:6px;">';
      logHtml += '<div style="font-size:12px;font-weight:700;color:#9a9a96;margin-bottom:8px;">' + log.week + '</div>';
      if (log.summary) logHtml += '<p style="font-size:13px;color:#1a1a18;margin-bottom:8px;">' + log.summary + '</p>';
      if (log.tasksCompleted && log.tasksCompleted.length > 0) {
        logHtml += '<div style="font-size:12px;font-weight:600;color:#16A34A;margin-bottom:4px;">✅ Completed</div>';
        logHtml += '<ul style="margin:0 0 8px 16px;">' + log.tasksCompleted.map(function(t){ return '<li style="font-size:13px;color:#1a1a18;">' + t + '</li>'; }).join('') + '</ul>';
      }
      if (log.tasksOpen && log.tasksOpen.length > 0) {
        logHtml += '<div style="font-size:12px;font-weight:600;color:#D97706;margin-bottom:4px;">⏳ Still open</div>';
        logHtml += '<ul style="margin:0 0 0 16px;">' + log.tasksOpen.map(function(t){ return '<li style="font-size:13px;color:#1a1a18;">' + t + '</li>'; }).join('') + '</ul>';
      }
      logHtml += '</div>';
    });
  } else {
    logHtml = '<p style="font-size:13px;color:#9a9a96;">No weekly logs recorded yet.</p>';
  }

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
  '<div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +

  '<div style="background:#C0282D;padding:22px 28px;">' +
    '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Mixta Africa — NPD Hub Handover Package</div>' +
    '<div style="color:white;font-size:20px;font-weight:700;">' + productName + '</div>' +
    '<div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">From: ' + ownerName + ' &nbsp;·&nbsp; Covering until: ' + returnDate + '</div>' +
  '</div>' +

  '<div style="padding:24px 28px;">' +

    '<div style="background:#f8f8f7;border-radius:8px;padding:16px 20px;margin-bottom:20px;">' +
      '<div style="font-size:13px;color:#6b6b67;margin-bottom:4px;"><strong>Reliever:</strong> ' + relieverName + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;margin-bottom:4px;"><strong>Target launch:</strong> ' + launchDate + '</div>' +
      '<div style="font-size:13px;color:#6b6b67;"><strong>Return date:</strong> ' + returnDate + '</div>' +
    '</div>' +

    (notes ? '<div style="background:#FEF3C7;border-radius:6px;padding:14px;margin-bottom:20px;font-size:13px;color:#92400E;line-height:1.6;"><strong>Owner notes:</strong> ' + notes + '</div>' : '') +

    '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#1a1a18;">Current pillar status</h3>' +
    '<div style="overflow:auto;margin-bottom:24px;">' +
      '<table style="width:100%;border-collapse:collapse;min-width:500px;">' +
        '<thead><tr style="background:#f8f8f7;">' +
          '<th style="padding:8px 10px;font-size:11px;color:#9a9a96;text-align:left;">#</th>' +
          '<th style="padding:8px 10px;font-size:11px;color:#9a9a96;text-align:left;">Pillar</th>' +
          '<th style="padding:8px 10px;font-size:11px;color:#9a9a96;text-align:left;">Deadline</th>' +
          '<th style="padding:8px 10px;font-size:11px;color:#9a9a96;text-align:left;">Status</th>' +
          '<th style="padding:8px 10px;font-size:11px;color:#9a9a96;text-align:left;">Notes</th>' +
        '</tr></thead>' +
        '<tbody>' + pillarRows + '</tbody>' +
      '</table>' +
    '</div>' +

    '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#1a1a18;">Weekly log (last 4 weeks)</h3>' +
    logHtml +

    (driveUrl ? '<div style="text-align:center;margin:24px 0;"><a href="' + driveUrl + '" style="background:#C0282D;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Open Product Drive Folder</a></div>' : '') +

    '<p style="font-size:12px;color:#9a9a96;line-height:1.6;margin:0;">This handover package was generated by the Mixta Africa NPD Hub. You have been granted temporary edit access to this product until ' + returnDate + '.</p>' +
  '</div>' +

  '<div style="background:#f8f8f7;padding:14px 28px;border-top:1px solid #e5e4e0;"><div style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Automated Handover Package</div></div>' +
  '</div></body></html>';
}


// ─────────────────────────────────────────────────────────────
//  DEADLINE REMINDER — sent manually from dashboard
// ─────────────────────────────────────────────────────────────
function sendDeadlineReminder(body) {
  try {
    var { productName, pillarName, deadline, customMessage, deptEmails, testMode } = body;
    if (!deptEmails || deptEmails.length === 0) {
      return { ok: false, error: 'No recipients — no department assigned to this pillar.' };
    }

    var recipients = resolveRecipients(deptEmails, testMode);
    var subject    = (testMode ? '[TEST] ' : '') + 'Reminder: ' + pillarName + ' — ' + productName + ' due ' + deadline;

    var htmlBody = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
      '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +
      '<div style="background:#C0282D;padding:20px 28px;">' +
        '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Mixta Africa — NPD Hub Reminder</div>' +
        '<div style="color:white;font-size:20px;font-weight:700;">' + pillarName + '</div>' +
        '<div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">' + productName + ' — Due: ' + deadline + '</div>' +
      '</div>' +
      '<div style="padding:24px 28px;">' +
        '<p style="font-size:14px;color:#1a1a18;line-height:1.7;margin:0 0 16px;">This is a reminder that the above pillar is due soon. Please update your task status on the NPD Hub and ensure all deliverables are on track.</p>' +
        (customMessage ? '<div style="background:#FEF3C7;border-radius:6px;padding:14px;margin-bottom:16px;font-size:13px;color:#92400E;line-height:1.6;"><strong>Message from admin:</strong> ' + customMessage + '</div>' : '') +
        '<p style="font-size:12px;color:#9a9a96;margin:0;">This reminder was sent manually from the Mixta Africa NPD Hub.</p>' +
      '</div>' +
      '<div style="background:#f8f8f7;padding:14px 28px;border-top:1px solid #e5e4e0;"><div style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Deadline Reminder</div></div>' +
      '</div></body></html>';

    var sent = 0, errors = [];
    recipients.forEach(function(email) {
      try {
        GmailApp.sendEmail(email, subject, '', { htmlBody: htmlBody, name: SENDER_NAME });
        sent++;
      } catch(e) {
        errors.push(email + ': ' + e.message);
      }
    });

    logEvent('Deadline reminder sent (' + sent + ')', productName, pillarName);
    return { ok: true, sent: sent, errors: errors };

  } catch(err) {
    Logger.log('sendDeadlineReminder error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  INTERNAL UTILITIES
// ─────────────────────────────────────────────────────────────
function logEvent(event, productName, detail) {
  try {
    Logger.log('[NPD Hub] ' + event + ' | ' + productName + (detail ? ' | ' + detail : ''));
  } catch(e) {}
}

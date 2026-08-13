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

// ─────────────────────────────────────────────────────────────
//  DAILY DEADLINE CHECK — GAS Time-Based Trigger
//  
//  HOW TO SET UP (one-time, 2 minutes):
//  1. Open this script in script.google.com
//  2. Click the clock icon (Triggers) in the left sidebar
//  3. Click "+ Add Trigger" (bottom right)
//  4. Choose function: dailyDeadlineCheck
//  5. Event source: Time-driven
//  6. Type: Day timer
//  7. Time: 7am to 8am (WAT)
//  8. Save
//
//  OR run installDailyTrigger() once from the Run menu to do it automatically.
// ─────────────────────────────────────────────────────────────

var FIREBASE_DB_URL = 'https://mixta-npd-hub-default-rtdb.firebaseio.com'; // Set this — paste your Firebase RTDB URL here
// e.g. 'https://your-project-default-rtdb.firebaseio.com'
// Get it from Firebase Console → Realtime Database → copy the URL

var FIREBASE_DB_SECRET = 'pdz1ORn2cMha71Xft2NzbJcaR8nv2RYoTRdgTM0z';

function installDailyTrigger() {
  // Delete any existing daily triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyDeadlineCheck') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Create new daily trigger at 7am
  ScriptApp.newTrigger('dailyDeadlineCheck')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone('Africa/Lagos')
    .create();
  Logger.log('Daily trigger installed: dailyDeadlineCheck fires every day at 7am WAT');
}

function dailyDeadlineCheck() {
  if (!FIREBASE_DB_URL) {
    Logger.log('FIREBASE_DB_URL not set — open gas-backend.js and set it at the top');
    return;
  }

  var today = new Date(); today.setHours(0,0,0,0);
  var THRESHOLD_DAYS = 3;

  // Fetch products from Firebase
  var authParam    = FIREBASE_DB_SECRET ? '?auth=' + FIREBASE_DB_SECRET : '';
  var productsResp = UrlFetchApp.fetch(FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true });
  var usersResp    = UrlFetchApp.fetch(FIREBASE_DB_URL + '/users.json'    + authParam, { muteHttpExceptions: true });

  if (productsResp.getResponseCode() !== 200) {
    Logger.log('Failed to fetch products: ' + productsResp.getContentText());
    return;
  }

  var products = JSON.parse(productsResp.getContentText()) || {};
  var users    = JSON.parse(usersResp.getContentText())    || {};
  var alerts   = [];

  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived') return;
    if (prod.alertsEnabled === false) return;

    // Determine recipient
    var deptEmails = [];
    if (prod.alertRecipients && prod.alertRecipients.length > 0) {
      deptEmails = prod.alertRecipients;
    } else if (prod.ownerId && users[prod.ownerId] && users[prod.ownerId].email) {
      deptEmails = [users[prod.ownerId].email];
    } else {
      Logger.log('No recipient for ' + prod.name + ' — skipping');
      return;
    }

    // Get tasks — handle both new tasks{} and legacy pillars{}
    var tasks = [];
    if (prod.tasks && Object.keys(prod.tasks).length > 0) {
      tasks = Object.values(prod.tasks);
    } else if (prod.pillars) {
      Object.entries(prod.pillars).forEach(function(entry) {
        var pillarId = entry[0];
        var pd       = entry[1];
        tasks.push({
          id:       pillarId,
          title:    pd.name || pillarId,
          deadline: pd.deadline,
          status:   pd.taskStatus || 'on-track',
        });
      });
    }

    tasks.forEach(function(task) {
      var taskStatus = task.status || task.taskStatus || 'on-track';
      // Never alert on complete tasks
      if (taskStatus === 'complete') return;
      // Always alert on explicitly delayed tasks (regardless of deadline date)
      var isDelayed = taskStatus === 'delayed';
      if (!task.deadline && !isDelayed) return;

      var diff = null;
      var daysOverdue = 0;
      if (task.deadline) {
        var due  = new Date(task.deadline); due.setHours(0,0,0,0);
        diff = Math.round((due - today) / 86400000);
        daysOverdue = diff < 0 ? Math.abs(diff) : 0;
      }

      // Skip future tasks that are not delayed and not within threshold
      if (!isDelayed && diff !== null && diff > THRESHOLD_DAYS) return;
      // Skip tasks with no deadline that are not delayed
      if (!isDelayed && diff === null) return;

      var alertType = diff === null
        ? 'delayed'
        : diff < 0  ? 'overdue'
        : diff === 0 ? 'due'
        : isDelayed  ? 'delayed'
        : 'warning';

      alerts.push({
        productName: prod.name,
        productId:   prod.id,
        pillarName:  task.title || task.name || 'Unknown task',
        pillarId:    task.id,
        ownerDept:   task.owner || '',
        deptEmails:  deptEmails,
        daysUntil:   diff,
        daysOverdue: daysOverdue,
        deadline:    task.deadline || null,
        taskStatus:  taskStatus,
        alertType:   alertType,
      });
    });
  });

  if (alerts.length === 0) {
    Logger.log('No alerts — all tasks on track.');
    return;
  }

  var overdue  = alerts.filter(function(a) { return a.alertType === 'overdue'; }).length;
  var dueToday = alerts.filter(function(a) { return a.alertType === 'due'; }).length;
  var warning  = alerts.filter(function(a) { return a.alertType === 'warning'; }).length;
  Logger.log('Sending ' + alerts.length + ' alerts: ' + overdue + ' overdue, ' + dueToday + ' due today, ' + warning + ' warnings');

  // Group alerts by product and route through Gmail thread when available
  var alertsByProduct = {};
  alerts.forEach(function(a) {
    if (!alertsByProduct[a.productId]) alertsByProduct[a.productId] = [];
    alertsByProduct[a.productId].push(a);
  });

  var totalSent = 0;
  Object.keys(alertsByProduct).forEach(function(productId) {
    var prodAlerts = alertsByProduct[productId];
    var prod       = products[productId];
    var threadId   = prod ? prod.gmailThreadId : null;

    if (threadId) {
      try {
        var thread = GmailApp.getThreadById(threadId);
        if (thread) {
          var alertLines = prodAlerts.map(function(a) {
            var prefix = a.alertType === 'overdue'
              ? '[OVERDUE ' + a.daysOverdue + 'd]'
              : a.alertType === 'due'
              ? '[DUE TODAY]'
              : '[DUE IN ' + a.daysUntil + 'D]';
            return prefix + ' ' + a.pillarName + ' (' + a.ownerDept + ') — ' + a.deadline;
          }).join('\n');
          var bodyText = 'Daily NPD Hub deadline update for ' + (prod.name || productId) + ':\n\n' + alertLines + '\n\nPlease update task statuses on the NPD Hub.';

          var allRecips = [];
          prodAlerts.forEach(function(a) {
            (a.deptEmails || []).forEach(function(e) {
              if (allRecips.indexOf(e) < 0) allRecips.push(e);
            });
          });

          var replyOpts = {
            htmlBody: buildThreadReplyHTML(bodyText, prod.name || productId, null),
            name:     SENDER_NAME,
          };
          if (allRecips.length > 0) replyOpts.to = allRecips.join(',');
          thread.reply('', replyOpts);
          totalSent += allRecips.length;
          Logger.log('Thread reply: ' + (prod.name || productId) + ' -> ' + allRecips.length + ' recipients');
          return;
        }
      } catch(threadErr) {
        Logger.log('Thread reply failed: ' + threadErr.message + ' — falling back to alert emails');
      }
    }

    // No thread or thread failed — send as individual alert emails
    var result = checkAndSendDeadlineAlerts({ alerts: prodAlerts });
    totalSent += (result.sent || 0);
    Logger.log('Alert emails: ' + (prod ? prod.name : productId) + ' -> ' + (result.sent || 0) + ' sent');
  });

  Logger.log('Total emails sent: ' + totalSent);

  // ── Check for products that launched today → generate retrospective ──
  Object.values(products).forEach(function(prod) {
    if (!prod.launchDate || prod.status === 'archived') return;
    var launch = new Date(prod.launchDate); launch.setHours(0,0,0,0);
    if (launch.getTime() === today.getTime()) {
      try {
        generateRetrospective(prod, authParam);
        Logger.log('Retrospective generated for: ' + prod.name);
      } catch(e) {
        Logger.log('Retrospective failed for ' + prod.name + ': ' + e.message);
      }
    }
  });
}

// ── TODO DIGEST ─────────────────────────────────────────────
function installTodoTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyTodoCheck') ScriptApp.deleteTrigger(t);
  });
  // Read configured hour from Firebase (default 8am)
  var authParam = '?auth=' + FIREBASE_DB_SECRET;
  var schedSnap = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/emailSchedule.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
  var hour = schedSnap.todoHour !== undefined ? parseInt(schedSnap.todoHour) : 8;
  ScriptApp.newTrigger('dailyTodoCheck').timeBased().atHour(hour).everyDays(1).inTimezone('Africa/Lagos').create();
  Logger.log('Todo trigger installed at ' + hour + ':00 WAT');
}

function dailyTodoCheck() {
  var authParam  = '?auth=' + FIREBASE_DB_SECRET;
  var today      = new Date(); today.setHours(0,0,0,0);
  var dayOfWeek  = today.getDay(); // 0=Sun, 1=Mon
  var schedSnap  = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/emailSchedule.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
  var weeklyDay  = schedSnap.todoDay !== undefined ? parseInt(schedSnap.todoDay) : 1; // default Monday

  var products = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
  var users    = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/users.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
  var isWeekly = dayOfWeek === weeklyDay;

  // Build a per-user task map
  var userTasks = {}; // { email: { overdue:[], dueSoon:[], onTrack:[] } }

  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived') return;
    var tasks = Object.values(prod.tasks || prod.pillars || {});
    tasks.forEach(function(task) {
      if ((task.status || task.taskStatus) === 'complete') return;
      var ownerEmail = '';
      // Try to match task owner to a stakeholder email
      var STAKEDB = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/stakeholders.json' + authParam, { muteHttpExceptions: true }).getContentText());
      var stakeArr = STAKEDB ? (Array.isArray(STAKEDB) ? STAKEDB : Object.values(STAKEDB)) : [];
      var matched = stakeArr.find(function(s) { return s.name === (task.owner || '') || s.dept === (task.owner || ''); });
      if (matched) ownerEmail = matched.email;
      if (!ownerEmail) return;
      if (!userTasks[ownerEmail]) userTasks[ownerEmail] = { overdue: [], dueSoon: [], onTrack: [], productName: prod.name };
      var d = task.deadline ? new Date(task.deadline) : null;
      if (d) d.setHours(0,0,0,0);
      var daysUntil = d ? Math.round((d - today) / 86400000) : null;
      var entry = { title: task.title || task.name || 'Untitled', product: prod.name, deadline: task.deadline, daysUntil: daysUntil, status: task.status || task.taskStatus || '' };
      if (daysUntil !== null && daysUntil < 0) userTasks[ownerEmail].overdue.push(entry);
      else if (daysUntil !== null && daysUntil <= 7) userTasks[ownerEmail].dueSoon.push(entry);
      else userTasks[ownerEmail].onTrack.push(entry);
    });
  });

  var digestType = isWeekly ? 'Weekly' : 'Daily';
  Object.keys(userTasks).forEach(function(email) {
    try {
      var data = userTasks[email];
      var all  = data.overdue.concat(data.dueSoon).concat(data.onTrack);
      if (all.length === 0) return;
      var html = buildTodoEmail(email, data, digestType, today);
      var subject = '[' + digestType + ' Tasks] Your NPD Hub action list — ' + Utilities.formatDate(today, 'Africa/Lagos', 'dd MMM yyyy');
      GmailApp.sendEmail(email, subject, '', { htmlBody: html, name: SENDER_NAME });
      Logger.log('Todo digest sent to ' + email);
    } catch(e) { Logger.log('Todo digest failed for ' + email + ': ' + e.message); }
  });
}

function sendTodoDigest(body) {
  // Manual trigger from dashboard — sends to requesting user
  try {
    var authParam = '?auth=' + FIREBASE_DB_SECRET;
    var today     = new Date(); today.setHours(0,0,0,0);
    var email     = body.email || '';
    if (!email) return { ok: false, error: 'No email provided' };
    var products  = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
    var data      = { overdue: [], dueSoon: [], onTrack: [] };
    Object.values(products).forEach(function(prod) {
      if (prod.status === 'archived') return;
      var tasks = Object.values(prod.tasks || prod.pillars || {});
      tasks.forEach(function(task) {
        if ((task.status || task.taskStatus) === 'complete') return;
        var d = task.deadline ? new Date(task.deadline) : null;
        if (d) d.setHours(0,0,0,0);
        var daysUntil = d ? Math.round((d - today) / 86400000) : null;
        var entry = { title: task.title || task.name || 'Untitled', product: prod.name, deadline: task.deadline, daysUntil: daysUntil, status: task.status || '' };
        if (daysUntil !== null && daysUntil < 0) data.overdue.push(entry);
        else if (daysUntil !== null && daysUntil <= 7) data.dueSoon.push(entry);
        else data.onTrack.push(entry);
      });
    });
    var html    = buildTodoEmail(email, data, 'On-demand', today);
    var subject = '[Task Digest] Your NPD Hub tasks — ' + Utilities.formatDate(today, 'Africa/Lagos', 'dd MMM yyyy');
    GmailApp.sendEmail(email, subject, '', { htmlBody: html, name: SENDER_NAME });
    return { ok: true, message: 'Digest sent to ' + email };
  } catch(err) { return { ok: false, error: err.message }; }
}

function buildTodoEmail(email, data, digestType, today) {
  var totalCount = data.overdue.length + data.dueSoon.length + data.onTrack.length;
  var dateStr = Utilities.formatDate(today, 'Africa/Lagos', 'EEEE, dd MMMM yyyy');

  var buildSection = function(items, label, color) {
    if (!items.length) return '';
    return '<div style="margin-bottom:20px;">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:' + color + ';margin-bottom:8px;">' + label + ' (' + items.length + ')</div>' +
      items.map(function(t) {
        var dueStr = t.deadline ? (t.daysUntil < 0 ? Math.abs(t.daysUntil) + 'd overdue' : t.daysUntil === 0 ? 'Due today' : 'Due in ' + t.daysUntil + 'd') : 'No date';
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #F0F0EE;">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';margin-top:4px;flex-shrink:0;"></div>' +
          '<div style="flex:1;">' +
            '<div style="font-size:13px;font-weight:600;color:#1A1A18;">' + t.title + '</div>' +
            '<div style="font-size:11px;color:#9A9A96;margin-top:2px;">' + t.product + ' · ' + dueStr + '</div>' +
          '</div></div>';
      }).join('') +
    '</div>';
  };

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#F8F8F7;margin:0;padding:24px;">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #E5E4E0;">' +
    '<div style="background:#1A1A18;padding:20px 28px;">' +
      '<div style="color:rgba(255,255,255,.6);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Mixta Africa NPD Hub · ' + digestType + ' Task Digest</div>' +
      '<div style="color:white;font-size:20px;font-weight:700;">' + totalCount + ' task' + (totalCount !== 1 ? 's' : '') + ' on your list</div>' +
      '<div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:4px;">' + dateStr + '</div>' +
    '</div>' +
    '<div style="padding:24px 28px;">' +
      buildSection(data.overdue,  'Overdue',       '#C0282D') +
      buildSection(data.dueSoon,  'Due this week', '#D97706') +
      buildSection(data.onTrack,  'Coming up',     '#16A34A') +
      (totalCount === 0 ? '<p style="font-size:14px;color:#16A34A;text-align:center;padding:20px 0;">You\'re all clear — no active tasks assigned to you.</p>' : '') +
      '<p style="font-size:12px;color:#9A9A96;margin-top:20px;">Auto-generated by the Mixta Africa NPD Hub. Log in to update your task statuses.</p>' +
    '</div></div></body></html>';
}

function generateRetrospective(prod, authParam) {
  var tasks = Object.values(prod.tasks || prod.pillars || {});
  var total = tasks.length;
  if (total === 0) return;

  var complete  = tasks.filter(function(t) { return (t.status || t.taskStatus) === 'complete'; });
  var delayed   = tasks.filter(function(t) { return (t.status || t.taskStatus) === 'delayed'; });
  var overdueTasks = tasks.filter(function(t) {
    if ((t.status || t.taskStatus) === 'complete') return false;
    if (!t.deadline) return false;
    var d = new Date(t.deadline); d.setHours(0,0,0,0);
    return d < new Date();
  });
  var onTime    = tasks.filter(function(t) {
    return (t.status || t.taskStatus) === 'complete' && t.deadline;
  });

  var pct  = Math.round((complete.length / total) * 100);
  var slip = 0;
  if (prod.baselineLaunchDate && prod.baselineLaunchDate !== prod.launchDate) {
    var bl  = new Date(prod.baselineLaunchDate); bl.setHours(0,0,0,0);
    var cur = new Date(prod.launchDate);         cur.setHours(0,0,0,0);
    slip    = Math.round((cur - bl) / 86400000);
  }

  var today = new Date();
  var weekKey = 'retro_' + today.getFullYear() + '_' + (today.getMonth() + 1) + '_' + today.getDate();

  var retro = {
    type:            'retrospective',
    generatedAt:     today.toISOString(),
    launchDate:      prod.launchDate,
    totalTasks:      total,
    completedTasks:  complete.length,
    pctComplete:     pct,
    delayedTasks:    delayed.length,
    overdueTasks:    overdueTasks.length,
    slipDays:        slip,
    completedNames:  complete.map(function(t) { return t.title || t.name || ''; }).filter(Boolean),
    openNames:       overdueTasks.concat(delayed).map(function(t) { return t.title || t.name || ''; }).filter(Boolean),
    summary:         prod.name + ' reached its launch date with ' + pct + '% of tasks complete.' +
                     (overdueTasks.length > 0 ? ' ' + overdueTasks.length + ' task(s) remain overdue.' : '') +
                     (slip > 0 ? ' Launch slipped by ' + slip + ' days from baseline.' : slip < 0 ? ' Launch was ' + Math.abs(slip) + ' days ahead of baseline.' : ' Launched on the original target date.'),
  };

  // Store in weeklyLog
  UrlFetchApp.fetch(
    FIREBASE_DB_URL + '/products/' + prod.id + '/weeklyLog/' + weekKey + '.json' + authParam,
    { method: 'put', contentType: 'application/json', payload: JSON.stringify(retro), muteHttpExceptions: true }
  );

  // Email retrospective to owner/alert recipients
  var users     = JSON.parse(UrlFetchApp.fetch(FIREBASE_DB_URL + '/users.json' + authParam, { muteHttpExceptions: true }).getContentText()) || {};
  var recipients = [];
  if (prod.alertRecipients && prod.alertRecipients.length > 0) {
    recipients = prod.alertRecipients;
  } else if (prod.ownerId && users[prod.ownerId] && users[prod.ownerId].email) {
    recipients = [users[prod.ownerId].email];
  }
  if (recipients.length === 0) return;

  var html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +
    '<div style="background:#2563EB;padding:20px 28px;">' +
      '<div style="color:rgba(255,255,255,.8);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Mixta Africa — NPD Hub</div>' +
      '<div style="color:white;font-size:20px;font-weight:700;">Launch Retrospective</div>' +
      '<div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">' + prod.name + ' · ' + prod.launchDate + '</div>' +
    '</div>' +
    '<div style="padding:24px 28px;">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;">' +
        '<div style="background:#f8f8f7;border-radius:8px;padding:14px 16px;text-align:center;">' +
          '<div style="font-size:24px;font-weight:700;color:#1a1a18;">' + pct + '%</div>' +
          '<div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;">Complete</div>' +
        '</div>' +
        '<div style="background:#f8f8f7;border-radius:8px;padding:14px 16px;text-align:center;">' +
          '<div style="font-size:24px;font-weight:700;color:' + (overdueTasks.length > 0 ? '#C0282D' : '#16A34A') + ';">' + overdueTasks.length + '</div>' +
          '<div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;">Overdue</div>' +
        '</div>' +
        '<div style="background:#f8f8f7;border-radius:8px;padding:14px 16px;text-align:center;">' +
          '<div style="font-size:24px;font-weight:700;color:' + (slip > 0 ? '#D97706' : '#16A34A') + ';">' + (slip > 0 ? '+' + slip + 'd' : slip < 0 ? Math.abs(slip) + 'd early' : 'On time') + '</div>' +
          '<div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;">vs Baseline</div>' +
        '</div>' +
      '</div>' +
      '<p style="font-size:14px;color:#1a1a18;line-height:1.7;margin:0 0 20px;">' + retro.summary + '</p>' +
      (retro.completedNames.length > 0
        ? '<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#16A34A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Completed tasks</div>' +
          retro.completedNames.map(function(n) { return '<div style="font-size:13px;color:#1a1a18;padding:4px 0;border-bottom:1px solid #f0f0ee;">' + n + '</div>'; }).join('') + '</div>'
        : '') +
      (retro.openNames.length > 0
        ? '<div><div style="font-size:11px;font-weight:700;color:#C0282D;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Still open / overdue</div>' +
          retro.openNames.map(function(n) { return '<div style="font-size:13px;color:#1a1a18;padding:4px 0;border-bottom:1px solid #f0f0ee;">' + n + '</div>'; }).join('') + '</div>'
        : '') +
      '<p style="font-size:12px;color:#9a9a96;margin-top:20px;">Auto-generated by Mixta Africa NPD Hub on launch date. Full history is in the product\'s weekly log.</p>' +
    '</div></div></body></html>';

  var subject = '[Launched] Retrospective: ' + prod.name + ' — ' + prod.launchDate;
  recipients.forEach(function(email) {
    try { GmailApp.sendEmail(email, subject, '', { htmlBody: html, name: SENDER_NAME }); } catch(e) { Logger.log('Retro email failed: ' + e.message); }
  });
}



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
      case 'sendComposedEmail':     result = sendComposedEmail(body);             break;
      case 'replyToThread':         result = replyToThread(body);                break;
      case 'getThreadSubject':      result = getThreadSubject(body);             break;
      case 'gccoGenerateLink':      result = gccoGenerateLink(body);             break;
      case 'sendTodoDigest':        result = sendTodoDigest(body);              break;
      case 'ping':                  result = { ok: true, message: 'NPD Hub GAS v2.1 is live.', ts: new Date().toISOString() }; break;
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

function gccoGenerateLink(body) {
  try {
    var authParam = '?auth=' + FIREBASE_DB_SECRET;
    var token = Utilities.getUuid();
    UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/gccoToken.json' + authParam, {
      method: 'put', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ token: token, generatedAt: new Date().toISOString(), generatedBy: body.generatedBy || '' }),
    });
    // Use the deployed web app URL directly — ScriptApp.getService().getUrl()
    // can fail if called from doPost context; fall back to manual URL construction
    var gasUrl;
    try { gasUrl = ScriptApp.getService().getUrl(); } catch(e) { gasUrl = ''; }
    if (!gasUrl) {
      // Derive from the script ID
      gasUrl = 'https://script.google.com/macros/s/' + ScriptApp.getScriptId() + '/exec';
    }
    var url = gasUrl + '?action=gcco&token=' + token;
    return { ok: true, url: url };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action ? e.parameter.action : '';

  // ── Action: acknowledge a task alert ──────────────────────────
    if (action === 'ack') {
    var productId = e.parameter.p || '';
    var taskId    = e.parameter.t || '';
    var ackType   = e.parameter.type || 'acknowledged';
    var email     = e.parameter.email || '';

    if (!productId || !taskId) {
      return HtmlService.createHtmlOutput(buildSimplePage(
        'Invalid link',
        'This acknowledgement link is missing required information. Please contact your team lead.',
        '#C0282D'
      )).setTitle('NPD Hub');
    }

    try {
      var authParam = '?auth=' + FIREBASE_DB_SECRET;
      var ackPath   = FIREBASE_DB_URL + '/products/' + productId + '/tasks/' + taskId + '/acknowledgement.json' + authParam;
      var payload   = JSON.stringify({
        type:        ackType,
        acknowledgedBy: email,
        acknowledgedAt: new Date().toISOString(),
      });
      UrlFetchApp.fetch(ackPath, { method: 'put', contentType: 'application/json', payload: payload, muteHttpExceptions: true });

      var actId    = 'ack_' + Date.now();
      var actPath  = FIREBASE_DB_URL + '/products/' + productId + '/activity/' + actId + '.json' + authParam;
      var actLabel = ackType === 'needs_more_time' ? 'Requested more time' : 'Acknowledged';
      UrlFetchApp.fetch(actPath, {
        method: 'put', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          id: actId, type: 'acknowledgement',
          message: actLabel + ': alert for task ' + taskId,
          user: email, userName: email.split('@')[0], timestamp: Date.now(),
        }),
      });

      var title   = ackType === 'needs_more_time' ? 'Request received' : 'Alert acknowledged';
      var msg     = ackType === 'needs_more_time'
        ? 'Your request for more time has been logged. Your team lead will follow up.'
        : 'Thank you. This alert has been marked as acknowledged and logged in the NPD Hub.';
      return HtmlService.createHtmlOutput(buildSimplePage(title, msg, '#16A34A')).setTitle('NPD Hub');
    } catch(err) {
      return HtmlService.createHtmlOutput(buildSimplePage(
        'Something went wrong',
        'Could not log your acknowledgement. Please reply directly to this email instead.',
        '#C0282D'
      )).setTitle('NPD Hub');
    }
  }

  // ── Action: GCCO read-only dashboard ─────────────────────────
  if (action === 'gcco') {
    var token = e.parameter.token || '';
    if (!token) {
      return HtmlService.createHtmlOutput(buildSimplePage(
        'Access denied',
        'This link is invalid or has expired. Please request a new one from your team lead.',
        '#C0282D'
      )).setTitle('NPD Hub — Access Denied');
    }
    try {
      var authParam = '?auth=' + FIREBASE_DB_SECRET;
      var tokenSnap = JSON.parse(UrlFetchApp.fetch(
        FIREBASE_DB_URL + '/config/gccoToken.json' + authParam, { muteHttpExceptions: true }
      ).getContentText());
      if (!tokenSnap || tokenSnap.token !== token) {
        return HtmlService.createHtmlOutput(buildSimplePage(
          'Access denied',
          'This link is invalid or has expired.',
          '#C0282D'
        )).setTitle('NPD Hub — Access Denied');
      }
      var prodData = JSON.parse(UrlFetchApp.fetch(
        FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true }
      ).getContentText()) || {};
      return HtmlService.createHtmlOutput(buildGCCODashboard(prodData))
        .setTitle('NPD Portfolio — Mixta Africa')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch(err) {
      return HtmlService.createHtmlOutput(buildSimplePage(
        'Error loading dashboard',
        'Could not load portfolio data. Please try again later.',
        '#C0282D'
      )).setTitle('NPD Hub — Error');
    }
  }

  // ── Default: health check ─────────────────────────────────────
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: 'NPD Hub GAS v2.1 running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildSimplePage(title, message, color) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:Arial,sans-serif;background:#F8F8F7;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}' +
    '.card{background:#fff;border-radius:12px;padding:40px 36px;max-width:420px;width:100%;text-align:center;border:1px solid #E5E4E0;}' +
    '.dot{width:52px;height:52px;border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;}' +
    'h2{font-size:18px;font-weight:700;color:#1A1A18;margin:0 0 10px;}p{font-size:14px;color:#6B6B67;line-height:1.7;margin:0;}' +
    '.brand{font-size:11px;color:#9A9A96;margin-top:24px;text-transform:uppercase;letter-spacing:.06em;}</style></head><body>' +
    '<div class="card">' +
      '<div class="dot" style="background:' + color + '20;">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          (color === '#16A34A'
            ? '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>') +
        '</svg>' +
      '</div>' +
      '<h2>' + title + '</h2>' +
      '<p>' + message + '</p>' +
      '<div class="brand">Mixta Africa — NPD Hub</div>' +
    '</div></body></html>';
}

function buildGCCODashboard(prodData) {
  var today    = new Date(); today.setHours(0,0,0,0);
  var products = Object.values(prodData || {}).filter(function(p) { return p.status !== 'archived'; });
  var totalActive = products.length;
  var totalOverdue = 0;
  var totalOnTrack = 0;

  var rows = products.map(function(p) {
    var tasks = Object.values(p.tasks || p.pillars || {});
    var done = 0, overdue = 0, delayed = 0, onTrack = 0, total = tasks.length;
    tasks.forEach(function(t) {
      var st = t.status || t.taskStatus || '';
      if (st === 'complete') { done++; return; }
      if (st === 'delayed')  { delayed++; overdue++; return; }
      if (t.deadline) {
        var d = new Date(t.deadline); d.setHours(0,0,0,0);
        if (d < today) { overdue++; return; }
      }
      onTrack++;
    });
    totalOverdue += overdue;
    totalOnTrack += onTrack;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    var launch = p.launchDate ? new Date(p.launchDate) : null;
    var daysLeft = launch ? Math.round((launch - today) / 86400000) : null;
    var launchStr = daysLeft === null ? '—'
      : daysLeft < 0  ? Math.abs(daysLeft) + 'd overdue'
      : daysLeft === 0 ? 'Today'
      : daysLeft + 'd to go';
    var launchColor = daysLeft !== null && daysLeft < 0 ? '#C0282D' : daysLeft !== null && daysLeft <= 14 ? '#D97706' : '#16A34A';
    var healthColor = overdue > 0 ? '#C0282D' : pct > 50 ? '#16A34A' : '#D97706';
    return '<tr>' +
      '<td style="padding:12px 16px;font-weight:600;color:#1A1A18;">' + (p.name || '—') + '</td>' +
      '<td style="padding:12px 16px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + healthColor + ';margin-right:6px;"></span>' + pct + '% done</td>' +
      '<td style="padding:12px 16px;color:' + (overdue > 0 ? '#C0282D' : '#16A34A') + ';font-weight:' + (overdue > 0 ? '600' : '400') + ';">' +
        (overdue > 0 ? overdue + ' overdue' + (delayed > 0 ? ' (' + delayed + ' delayed)' : '') : 'On track') +
      '</td>' +
      '<td style="padding:12px 16px;color:' + launchColor + ';font-weight:500;">' + launchStr + '</td>' +
      '<td style="padding:12px 16px;color:#6B6B67;font-size:12px;">' + (p.ownerName || '—') + '</td>' +
    '</tr>';
  }).join('');

  var genTime = Utilities.formatDate(new Date(), 'Africa/Lagos', 'dd MMM yyyy, hh:mm a') + ' WAT';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>NPD Portfolio — Mixta Africa</title>' +
    '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;background:#F8F8F7;padding:24px;}' +
    '.header{background:#C0282D;border-radius:10px;padding:20px 28px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;}' +
    '.header h1{color:#fff;font-size:18px;font-weight:700;}.header p{color:#FFD5D5;font-size:12px;margin-top:3px;}' +
    '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}' +
    '.stat{background:#fff;border-radius:8px;padding:16px 20px;border:1px solid #E5E4E0;}' +
    '.stat-lbl{font-size:11px;color:#9A9A96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}' +
    '.stat-val{font-size:28px;font-weight:700;}' +
    'table{width:100%;background:#fff;border-radius:8px;border:1px solid #E5E4E0;border-collapse:collapse;overflow:hidden;}' +
    'thead{background:#F8F8F7;}th{padding:10px 16px;text-align:left;font-size:11px;color:#9A9A96;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}' +
    'tr:not(:last-child){border-bottom:1px solid #F0F0EE;}' +
    '.footer{text-align:center;font-size:11px;color:#9A9A96;margin-top:20px;}' +
    '.ro-badge{background:#FEF2F2;color:#C0282D;font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;letter-spacing:.04em;}</style></head><body>' +
    '<div class="header">' +
      '<div><h1>NPD Portfolio Overview</h1><p>Mixta Africa — Commercial Strategy</p></div>' +
      '<span class="ro-badge">READ ONLY</span>' +
    '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="stat-lbl">Active Products</div><div class="stat-val">' + totalActive + '</div></div>' +
      '<div class="stat"><div class="stat-lbl">Overdue Tasks</div><div class="stat-val" style="color:#C0282D;">' + totalOverdue + '</div></div>' +
      '<div class="stat"><div class="stat-lbl">On Track Tasks</div><div class="stat-val" style="color:#16A34A;">' + totalOnTrack + '</div></div>' +
    '</div>' +
    '<table><thead><tr><th>Product</th><th>Progress</th><th>Status</th><th>Launch</th><th>Owner</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="footer">Generated ' + genTime + ' &nbsp;·&nbsp; Mixta Africa NPD Hub &nbsp;·&nbsp; Read-only view</div>' +
    '</body></html>';
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
        var alertRecipients = resolveRecipients(alert.deptEmails || [], body.testMode);
        var alertSubject = (body.testMode ? '[TEST] ' : '') + subject;
        alertRecipients.forEach(function(email) {
          try {
            // Pass recipient email and taskId so acknowledge links are personalised
            var alertWithRecipient = Object.assign({}, alert, {
              recipientEmail: email,
              taskId: alert.pillarId || alert.taskId || '',
            });
            var html = buildAlertEmail(alertWithRecipient);
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
  var daysStr = alert.daysOverdue > 0 ? ' (' + alert.daysOverdue + 'd overdue)' : '';
  var prefix  = alert.alertType === 'overdue' ? '[OVERDUE' + daysStr + ']'
              : alert.alertType === 'due'     ? '[DUE TODAY]'
              : '[DUE IN ' + alert.daysUntil + 'D]';
  return prefix + ' ' + alert.pillarName + ' — ' + alert.productName;
}

function buildAlertEmail(alert) {
  var daysText = alert.daysUntil === null
    ? 'Marked as delayed'
    : alert.daysUntil < 0
    ? Math.abs(alert.daysUntil) + ' day' + (Math.abs(alert.daysUntil) > 1 ? 's' : '') + ' overdue'
    : alert.daysUntil === 0 ? 'Due today'
    : 'Due in ' + alert.daysUntil + ' day' + (alert.daysUntil > 1 ? 's' : '');

  var headerBg = alert.alertType === 'overdue' || alert.alertType === 'delayed' ? '#C0282D'
               : alert.alertType === 'due'     ? '#D97706'
               : '#D97706';

  var urgencyMsg = alert.alertType === 'overdue'
    ? 'This task is <strong>' + Math.abs(alert.daysUntil) + ' day' + (Math.abs(alert.daysUntil) > 1 ? 's' : '') + ' overdue</strong>. Immediate action is required — update the status or escalate.'
    : alert.alertType === 'delayed'
    ? 'This task has been <strong>marked as delayed</strong>. Please provide an updated timeline and communicate the impact to your team lead.'
    : alert.alertType === 'due'
    ? 'This task is <strong>due today</strong>. Please update the status on the NPD Hub.'
    : 'This task deadline is <strong>' + alert.daysUntil + ' day' + (alert.daysUntil > 1 ? 's' : '') + ' away</strong>. Please review progress and ensure it is on track.';

  // Build acknowledge URLs using ScriptApp.getService().getUrl()
  var baseUrl = ScriptApp.getService().getUrl();
  var ackUrl  = baseUrl + '?action=ack&p=' + encodeURIComponent(alert.productId || '') +
    '&t=' + encodeURIComponent(alert.taskId || '') +
    '&type=acknowledged&email=' + encodeURIComponent(alert.recipientEmail || '');
  var moreUrl = baseUrl + '?action=ack&p=' + encodeURIComponent(alert.productId || '') +
    '&t=' + encodeURIComponent(alert.taskId || '') +
    '&type=needs_more_time&email=' + encodeURIComponent(alert.recipientEmail || '');

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

    '<p style="font-size:14px;color:#1a1a18;line-height:1.7;margin:0 0 24px;">' + urgencyMsg + '</p>' +

    '<div style="display:flex;gap:12px;margin-bottom:24px;">' +
      '<a href="' + ackUrl + '" style="flex:1;display:inline-block;background:#16A34A;color:#ffffff;text-align:center;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;">I have seen this</a>' +
      '<a href="' + moreUrl + '" style="flex:1;display:inline-block;background:#F8F8F7;color:#1A1A18;text-align:center;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid #E5E4E0;">I need more time</a>' +
    '</div>' +

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
//  SEND COMPOSED EMAIL — final send after AI draft + user edit
// ─────────────────────────────────────────────────────────────
function sendComposedEmail(body) {
  try {
    var { subject, body: emailBody, toEmails, ccEmails, testMode, productName, folderUrl, isThreadStarter } = body;

    if (!toEmails || toEmails.length === 0) {
      return { ok: false, error: 'No recipients.' };
    }
    if (!subject || !emailBody) {
      return { ok: false, error: 'Subject and body are required.' };
    }

    var to  = resolveRecipients(toEmails, testMode);
    var cc  = testMode ? [] : (ccEmails || []);
    var finalSubject = (testMode ? '[TEST] ' : '') + subject;

    // Build branded HTML wrapper around the plain text body
    var htmlBody = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
      '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +
      '<div style="background:#C0282D;padding:18px 28px;">' +
        '<div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px;">Mixta Africa — NPD Hub</div>' +
        '<div style="color:white;font-size:18px;font-weight:700;">' + (productName || subject) + '</div>' +
      '</div>' +
      '<div style="padding:26px 28px;font-size:14px;color:#1a1a18;line-height:1.8;white-space:pre-wrap;">' +
        emailBody.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') +
      '</div>' +
      (folderUrl ? '<div style="padding:0 28px 24px;"><a href="' + folderUrl + '" style="display:inline-block;background:#C0282D;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open Drive Folder</a></div>' : '') +
      '<div style="background:#f8f8f7;padding:12px 28px;border-top:1px solid #e5e4e0;font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Sent via Email Composer</div>' +
      '</div></body></html>';

    var sent = 0, errors = [];
    to.forEach(function(email) {
      try {
        GmailApp.sendEmail(email, finalSubject, emailBody, {
          htmlBody: htmlBody,
          name:     SENDER_NAME,
          cc:       cc.join(','),
        });
        sent++;
      } catch(e) {
        errors.push(email + ': ' + e.message);
      }
    });

    logEvent('Composed email sent (' + sent + ')', productName || subject, 'CC: ' + (cc.length || 0));

    // Capture Gmail thread ID when this is the first email for a product
    var threadId = null;
    if (isThreadStarter && sent > 0) {
      try {
        Utilities.sleep(2000);
        var searchTerm = 'subject:"' + subject.slice(0, 50).replace(/"/g, '') + '" in:sent';
        var threads = GmailApp.search(searchTerm, 0, 1);
        if (threads.length > 0) {
          threadId = threads[0].getId();
          Logger.log('Thread ID captured: ' + threadId);
        }
      } catch(e) {
        Logger.log('Could not capture thread ID: ' + e.message);
      }
    }

    return { ok: true, sent: sent, errors: errors, threadId: threadId };

  } catch(err) {
    Logger.log('sendComposedEmail error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  REPLY TO THREAD — adds reply to existing Gmail thread
// ─────────────────────────────────────────────────────────────
function replyToThread(body) {
  try {
    var { threadId, emailBody, subject, toEmails, ccEmails, testMode, productName } = body;
    if (!threadId)   return { ok: false, error: 'No thread ID provided.' };
    if (!emailBody)  return { ok: false, error: 'Email body is empty.' };

    var thread = GmailApp.getThreadById(threadId);
    if (!thread) return { ok: false, error: 'Thread not found — it may have been deleted.' };

    var to  = resolveRecipients(toEmails || [], testMode);
    var cc  = testMode ? [] : (ccEmails || []);

    var htmlBody = buildThreadReplyHTML(emailBody, productName, subject);
    var replyOpts = { htmlBody: htmlBody, name: SENDER_NAME };
    if (to.length > 0) replyOpts.to = to.join(',');
    if (cc.length > 0) replyOpts.cc = cc.join(',');

    thread.reply('', replyOpts);
    logEvent('Thread reply sent', productName || 'unknown', 'Thread: ' + threadId);
    return { ok: true, threadId: threadId };

  } catch(err) {
    Logger.log('replyToThread error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function getThreadSubject(body) {
  try {
    var thread = GmailApp.getThreadById(body.threadId);
    if (!thread) return { ok: false, error: 'Thread not found.' };
    var messages = thread.getMessages();
    return { ok: true, subject: messages.length > 0 ? messages[0].getSubject() : '', messageCount: messages.length };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

function buildAlertEmailText(alert) {
  var daysText = alert.daysOverdue > 0
    ? alert.daysOverdue + ' day' + (alert.daysOverdue > 1 ? 's' : '') + ' overdue'
    : 'Due today';
  return daysText + ': ' + alert.pillarName + '\n' +
    'Product: ' + alert.productName + '\n' +
    'Owner: '   + alert.ownerDept + '\n' +
    'Deadline: '+ alert.deadline + '\n\n' +
    'Please update the task status on the NPD Hub immediately.';
}

function buildThreadReplyHTML(body, productName, subject) {
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:24px;">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e4e0;">' +
    '<div style="background:#1a1a18;padding:16px 28px;display:flex;align-items:center;gap:12px;">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:#C0282D;flex-shrink:0;"></div>' +
      '<div style="color:white;font-size:13px;font-weight:500;">' + (productName || 'NPD Hub') + '</div>' +
      (subject ? '<div style="color:rgba(255,255,255,.5);font-size:12px;margin-left:auto;">' + subject + '</div>' : '') +
    '</div>' +
    '<div style="padding:24px 28px;font-size:14px;color:#1a1a18;line-height:1.8;white-space:pre-wrap;">' +
      body.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') +
    '</div>' +
    '<div style="background:#f8f8f7;padding:12px 28px;border-top:1px solid #e5e4e0;font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Reply in thread</div>' +
    '</div></body></html>';
}

// ─────────────────────────────────────────────────────────────
//  INTERNAL UTILITIES
// ─────────────────────────────────────────────────────────────
function logEvent(event, productName, detail) {
  try {
    Logger.log('[NPD Hub] ' + event + ' | ' + productName + (detail ? ' | ' + detail : ''));
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  TEST SUITE — Run these directly from the Apps Script editor
//  Select function name → click Run → check Execution Log
//
//  SETUP BEFORE TESTING:
//  1. Set FIREBASE_DB_URL at the top of this file
//  2. All tests send to TEST_EMAIL only (safe to run anytime)
// ═══════════════════════════════════════════════════════════════

var TEST_EMAIL_OVERRIDE = 'o.olasunkanmi@mixtafrica.com';

// ─────────────────────────────────────────────────────────────
//  TEST 1: Verify GAS is reachable (no Firebase needed)
// ─────────────────────────────────────────────────────────────
function test_ping() {
  Logger.log('=== TEST: ping ===');
  Logger.log('GAS is alive ✅');
  Logger.log('FIREBASE_DB_URL: ' + (FIREBASE_DB_URL ? FIREBASE_DB_URL.slice(0,40) + '...' : '❌ NOT SET'));
  Logger.log('SENDER_NAME: ' + SENDER_NAME);
  Logger.log('TEST_EMAIL: ' + TEST_EMAIL);

  // Send a test email to confirm Gmail works
  try {
    GmailApp.sendEmail(TEST_EMAIL_OVERRIDE, '[NPD Hub Test] GAS Ping', '',  {
      htmlBody: '<p style="font-family:Arial;padding:20px;">✅ GAS backend is reachable and Gmail is working.<br/><br/>Sent at: ' + new Date().toISOString() + '</p>',
      name: SENDER_NAME,
    });
    Logger.log('✅ Test email sent to ' + TEST_EMAIL_OVERRIDE);
  } catch(e) {
    Logger.log('❌ Gmail send failed: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  TEST 2: Daily deadline check (reads real Firebase data)
// ─────────────────────────────────────────────────────────────
function test_dailyDeadlineCheck() {
  Logger.log('=== TEST: dailyDeadlineCheck ===');

  if (!FIREBASE_DB_URL) {
    Logger.log('❌ Set FIREBASE_DB_URL at the top of this file first');
    return;
  }

  Logger.log('Fetching from Firebase: ' + FIREBASE_DB_URL);
  dailyDeadlineCheck(); // runs the real function — emails go to product owner
  Logger.log('Done — check Execution Log above for alert count');
}

// ─────────────────────────────────────────────────────────────
//  TEST 3: Deadline check with forced test mode
//          (overrides recipients → sends only to TEST_EMAIL)
// ─────────────────────────────────────────────────────────────
function test_deadlineCheck_testMode() {
  Logger.log('=== TEST: deadline check (TEST MODE) ===');

  if (!FIREBASE_DB_URL) {
    Logger.log('❌ Set FIREBASE_DB_URL first'); return;
  }

  var today    = new Date(); today.setHours(0,0,0,0);
  var THRESHOLD_DAYS = 3;

  var authParam    = FIREBASE_DB_SECRET ? '?auth=' + FIREBASE_DB_SECRET : '';
  var productsResp = UrlFetchApp.fetch(FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true });
  var usersResp    = UrlFetchApp.fetch(FIREBASE_DB_URL + '/users.json'    + authParam, { muteHttpExceptions: true });
  var products     = JSON.parse(productsResp.getContentText()) || {};
  var users        = JSON.parse(usersResp.getContentText())    || {};

  var alerts = [];
  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived' || prod.alertsEnabled === false) return;

    var tasks = [];
    if (prod.tasks && Object.keys(prod.tasks).length > 0) {
      tasks = Object.values(prod.tasks);
    } else if (prod.pillars) {
      Object.entries(prod.pillars).forEach(function(entry) {
        tasks.push({ id: entry[0], title: entry[1].name || entry[0],
                     deadline: entry[1].deadline, status: entry[1].taskStatus || 'on-track' });
      });
    }

    tasks.forEach(function(task) {
      if (!task.deadline || task.status === 'complete') return;
      var due  = new Date(task.deadline); due.setHours(0,0,0,0);
      var diff = Math.round((due - today) / 86400000);
      if (diff > THRESHOLD_DAYS) return;

      alerts.push({
        productName: prod.name,
        productId:   prod.id,
        pillarName:  task.title || task.id,
        pillarId:    task.id,
        ownerDept:   task.owner || 'Unknown',
        deptEmails:  [TEST_EMAIL_OVERRIDE], // FORCE to test email
        daysUntil:   diff,
        daysOverdue: diff < 0 ? Math.abs(diff) : 0,
        deadline:    task.deadline,
        alertType:   diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'warning',
      });
    });
  });

  Logger.log('Found ' + alerts.length + ' alerts');
  alerts.forEach(function(a) {
    Logger.log('  [' + a.alertType + '] ' + a.pillarName + ' — ' + a.productName + ' (' + (a.daysOverdue > 0 ? a.daysOverdue + 'd overdue' : 'due ' + a.deadline) + ')');
  });

  if (alerts.length === 0) {
    Logger.log('No alerts — no overdue/upcoming tasks found');
    return;
  }

  // Send — all go to TEST_EMAIL_OVERRIDE
  var result = checkAndSendDeadlineAlerts({ alerts: alerts, testMode: false });
  // testMode:false here because we already forced deptEmails to test address
  Logger.log('Result: sent=' + result.sent + ' errors=' + JSON.stringify(result.errors));
  Logger.log('✅ Check your inbox at ' + TEST_EMAIL_OVERRIDE);
}

// ─────────────────────────────────────────────────────────────
//  TEST 4: Single alert email for a specific task
//          (edit the variables below to match your data)
// ─────────────────────────────────────────────────────────────
function test_singleAlert() {
  Logger.log('=== TEST: single alert email ===');

  // ← EDIT THESE to match a real product/task in your Firebase
  var testAlert = {
    productName: 'ACOT4U',
    productId:   'your_product_id',
    pillarName:  'Product Financial & Profitability Analysis',
    pillarId:    'p5',
    ownerDept:   'Financial Planning',
    deptEmails:  [TEST_EMAIL_OVERRIDE],
    daysUntil:   -8,    // negative = overdue
    daysOverdue: 8,
    deadline:    '2026-07-18',
    alertType:   'overdue',
  };

  var result = checkAndSendDeadlineAlerts({ alerts: [testAlert], testMode: false });
  Logger.log('Sent: ' + result.sent + ' | Errors: ' + JSON.stringify(result.errors));
  Logger.log('✅ Check inbox at ' + TEST_EMAIL_OVERRIDE);
}

// ─────────────────────────────────────────────────────────────
//  TEST 5: Onboarding email (static version without AI)
// ─────────────────────────────────────────────────────────────
function test_onboardingEmail() {
  Logger.log('=== TEST: onboarding email ===');

  var result = sendOnboardingEmails({
    productName: 'ACOT4U [TEST]',
    productId:   'test_001',
    launchDate:  '2026-12-31',
    folderUrl:   'https://drive.google.com',
    createdBy:   'o.olasunkanmi@mixtafrica.com',
    testMode:    true,  // → sends to TEST_EMAIL only
    stakeholders: [
      { name: 'Design Team', email: 'd.team@mixtafrica.com', dept: 'Design', pillarIds: ['p4'] },
      { name: 'Tola Akinsulire', email: 't.akinsulire@mixtafrica.com', dept: 'AMC', pillarIds: ['p6','p7'] },
    ],
    pillars: [
      { id: 'p4', name: 'Product Design & Development', owner: 'Design' },
      { id: 'p6', name: 'Product AMC Meetings', owner: 'AMC' },
      { id: 'p7', name: 'AMC Product Presentations', owner: 'AMC' },
    ],
  });

  Logger.log('Result: ' + JSON.stringify(result));
  Logger.log('✅ Check inbox at ' + TEST_EMAIL_OVERRIDE);
}

// ─────────────────────────────────────────────────────────────
//  TEST 6: Composed email (the new AI-draft email format)
// ─────────────────────────────────────────────────────────────
function test_composedEmail() {
  Logger.log('=== TEST: composed email (sendComposedEmail) ===');

  var result = sendComposedEmail({
    subject:     '[NPD Hub Test] Composed Email Format',
    body:        'Dear team,\n\nThis is a test of the new composed email format from the NPD Hub.\n\n**Key points:**\n- The AI draft is generated in the browser via Groq\n- You review and edit before sending\n- GAS wraps it in the branded HTML template\n- CC support is now included\n\nThis email was sent from the Apps Script test suite.\n\nBest regards,\nNPD Hub',
    toEmails:    [TEST_EMAIL_OVERRIDE],
    ccEmails:    [],
    testMode:    false,  // already sending to test address directly
    productName: 'ACOT4U',
    folderUrl:   null,
  });

  Logger.log('Result: ' + JSON.stringify(result));
  Logger.log('✅ Check inbox at ' + TEST_EMAIL_OVERRIDE);
}

// ─────────────────────────────────────────────────────────────
//  TEST 7: Progress report email
// ─────────────────────────────────────────────────────────────
function test_progressReport() {
  Logger.log('=== TEST: progress report email ===');

  var result = sendProgressReport({
    productName:     'ACOT4U [TEST]',
    productId:       'test_001',
    launchDate:      '2026-12-31',
    reportDate:      new Date().toISOString().split('T')[0],
    generatedBy:     'o.olasunkanmi@mixtafrica.com',
    pctComplete:     33,
    complete:        4,
    inProgress:      3,
    notStarted:      4,
    overdue:         2,
    notes:           'Test run from Apps Script editor',
    testMode:        true,
    onboardedEmails: ['test@mixtafrica.com'],
    allStakeholderEmails: [TEST_EMAIL_OVERRIDE],
    pillarSummary: [
      { pillar: 'Market Survey & Research',      owner: 'Commercial Strategy', status: 'complete',     deadline: '2026-05-01', notes: '' },
      { pillar: 'Product Design & Development',  owner: 'Design',             status: 'in-progress',  deadline: '2026-07-30', notes: 'Awaiting architect sign-off' },
      { pillar: 'Financial & Profitability',     owner: 'Financial Planning', status: 'delayed',      deadline: '2026-07-18', notes: 'Model not yet submitted' },
      { pillar: 'AMC Meetings',                  owner: 'AMC',                status: 'not-started',  deadline: '2026-08-15', notes: '' },
    ],
  });

  Logger.log('Result: ' + JSON.stringify(result));
  Logger.log('✅ Check inbox at ' + TEST_EMAIL_OVERRIDE);
}

// ─────────────────────────────────────────────────────────────
//  TEST 8: Verify trigger is installed
// ─────────────────────────────────────────────────────────────
function test_checkTrigger() {
  Logger.log('=== TEST: check installed triggers ===');

  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('❌ No triggers installed. Run installDailyTrigger() to set up daily alerts.');
    return;
  }

  triggers.forEach(function(t) {
    Logger.log('  Trigger: ' + t.getHandlerFunction() +
               ' | Type: '  + t.getEventType() +
               ' | Source: '+ t.getTriggerSource());
  });

  var hasDailyCheck = triggers.some(function(t) {
    return t.getHandlerFunction() === 'dailyDeadlineCheck';
  });

  if (hasDailyCheck) {
    Logger.log('✅ dailyDeadlineCheck trigger is installed — will fire daily at 7am WAT');
  } else {
    Logger.log('⚠ dailyDeadlineCheck trigger NOT found. Run installDailyTrigger()');
  }
}

// ─────────────────────────────────────────────────────────────
//  TEST 9: Firebase connectivity check
// ─────────────────────────────────────────────────────────────
function test_firebaseConnection() {
  Logger.log('=== TEST: Firebase connection ===');

  if (!FIREBASE_DB_URL) {
    Logger.log('❌ FIREBASE_DB_URL not set at top of file'); return;
  }

  try {
    var authQ = FIREBASE_DB_SECRET ? '&auth=' + FIREBASE_DB_SECRET : '';
    var resp = UrlFetchApp.fetch(FIREBASE_DB_URL + '/.json?shallow=true' + authQ, { muteHttpExceptions: true });
    Logger.log('Status code: ' + resp.getResponseCode());
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      Logger.log('✅ Firebase connected. Top-level keys: ' + Object.keys(data || {}).join(', '));
    } else {
      Logger.log('❌ Firebase returned: ' + resp.getContentText().slice(0,200));
    }
  } catch(e) {
    Logger.log('❌ Connection failed: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  TEST 10: Full end-to-end — Firebase → alerts → email
//           This is the closest simulation of the real daily run
// ─────────────────────────────────────────────────────────────
function test_fullEndToEnd() {
  Logger.log('=== TEST: full end-to-end (Firebase → email) ===');
  Logger.log('This simulates the exact daily cron but routes all emails to ' + TEST_EMAIL_OVERRIDE);

  if (!FIREBASE_DB_URL) {
    Logger.log('❌ Set FIREBASE_DB_URL first'); return;
  }

  // Run the real dailyDeadlineCheck but patch recipients after
  var today = new Date(); today.setHours(0,0,0,0);

  var authParam    = FIREBASE_DB_SECRET ? '?auth=' + FIREBASE_DB_SECRET : '';
  var productsResp = UrlFetchApp.fetch(FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true });
  var usersResp    = UrlFetchApp.fetch(FIREBASE_DB_URL + '/users.json'    + authParam, { muteHttpExceptions: true });
  var products     = JSON.parse(productsResp.getContentText()) || {};
  var users        = JSON.parse(usersResp.getContentText())    || {};

  Logger.log('Products found: ' + Object.keys(products).length);

  var alerts = [];
  var skipped = [];

  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived') { skipped.push(prod.name + ' (archived)'); return; }
    if (prod.alertsEnabled === false) { skipped.push(prod.name + ' (alerts off)'); return; }

    var tasks = [];
    if (prod.tasks && Object.keys(prod.tasks).length > 0) {
      tasks = Object.values(prod.tasks);
    } else if (prod.pillars) {
      Object.entries(prod.pillars).forEach(function(e) {
        tasks.push({ id: e[0], title: e[1].name || e[0], deadline: e[1].deadline, status: e[1].taskStatus || 'on-track' });
      });
    }

    Logger.log('Product: ' + prod.name + ' (' + tasks.length + ' tasks)');

    tasks.forEach(function(task) {
      if (!task.deadline || task.status === 'complete') return;
      var due  = new Date(task.deadline); due.setHours(0,0,0,0);
      var diff = Math.round((due - today) / 86400000);
      if (diff > 3) return;

      var daysOverdue = diff < 0 ? Math.abs(diff) : 0;
      alerts.push({
        productName: prod.name,
        pillarName:  task.title || task.id,
        ownerDept:   task.owner || '?',
        deptEmails:  [TEST_EMAIL_OVERRIDE], // ALL go to test email
        daysUntil:   diff,
        daysOverdue: daysOverdue,
        deadline:    task.deadline,
        alertType:   diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'warning',
      });

      Logger.log('  Alert: [' + (diff < 0 ? daysOverdue + 'd OVERDUE' : diff === 0 ? 'DUE TODAY' : 'DUE IN ' + diff + 'd') + '] ' + (task.title || task.id));
    });
  });

  if (skipped.length > 0) Logger.log('Skipped: ' + skipped.join(', '));
  Logger.log('Total alerts to send: ' + alerts.length);

  if (alerts.length === 0) {
    Logger.log('✅ No overdue/upcoming tasks — nothing to send');
    return;
  }

  var result = checkAndSendDeadlineAlerts({ alerts: alerts });
  Logger.log('Emails sent: ' + result.sent);
  Logger.log('Errors: ' + JSON.stringify(result.errors));
  Logger.log('✅ Check inbox at ' + TEST_EMAIL_OVERRIDE);
}

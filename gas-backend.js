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

/* ══════════════════════════════════════════════════════════════
   OWNER → EMAIL RESOLUTION
   Single source of truth for "who should receive an alert about
   this task". Reads task.owners[] (multi-dept) first, then the
   legacy task.owner string, then falls back to product-level
   recipients. This is what makes reassignment actually route mail.
   ══════════════════════════════════════════════════════════════ */
/* Sender identity.
   Apps Script always sends from the script owner's mailbox — that cannot
   be changed without domain-wide delegation. What we CAN control is the
   display name and the reply-to address, so a reminder sent by Ada reads
   as "Ada Obi (NPD Hub)" and replies go back to Ada, not the script owner. */
/* Email visibility log.
   Every send — automated or user-initiated — writes a record so the
   product owner can see what left the system without being CC'd on
   everything. Surfaced in the product modal's Comms tab and on the
   dashboard. Failures here never block the send. */
function logEmailSent(productId, record) {
  if (!productId) return;
  try {
    var authParam = '?auth=' + FIREBASE_DB_SECRET;
    var id = 'em_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    record.id = id;
    record.sentAt = record.sentAt || Date.now();
    UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/emailLog/' + productId + '/' + id + '.json' + authParam,
      { method: 'put', contentType: 'application/json',
        payload: JSON.stringify(record), muteHttpExceptions: true }
    );
  } catch(e) {
    Logger.log('logEmailSent failed: ' + e.message);
  }
}

function buildSenderOpts(body, htmlBody) {
  var opts = { htmlBody: htmlBody };
  var who  = body && (body.sentByName || body.senderName);
  var mail = body && (body.sentByEmail || body.senderEmail);
  opts.name = who ? who + ' (NPD Hub)' : SENDER_NAME;
  if (mail && mail.indexOf('@') > -1) opts.replyTo = mail;
  return opts;
}

function getStakeholderIndex(authParam) {
  // Fetch stakeholders ONCE and build lookup maps. Never call inside a loop.
  var byName = {}, byDept = {};
  try {
    var raw = JSON.parse(UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/config/stakeholders.json' + authParam,
      { muteHttpExceptions: true }
    ).getContentText());
    var arr = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
    arr.forEach(function(s) {
      if (!s || !s.email || s.enabled === false) return;
      if (s.name) byName[String(s.name).trim().toLowerCase()] = s.email;
      if (s.dept) {
        if (!byDept[s.dept]) byDept[s.dept] = [];
        byDept[s.dept].push({ email: s.email, isDeptEmail: !!s.isDeptEmail });
      }
    });
  } catch(e) {
    Logger.log('getStakeholderIndex failed: ' + e.message);
  }
  return { byName: byName, byDept: byDept };
}

/* Mirrors the frontend rule: an unset visibility field means PRIVATE.
   Private tasks are never named in a batched product-wide thread reply —
   they send as individual emails to their own owners instead. */
function isTaskPrivate(task) {
  var v = task && task.visibility;
  return !(v === 'public' || v === 'department' || v === 'restricted');
}

function isPrivateAlert_(a) {
  var v = a && a.visibility;
  return !(v === 'public' || v === 'department' || v === 'restricted');
}

function resolveTaskRecipients(task, index, productFallback) {
  var emails = [];
  var push = function(e) { if (e && emails.indexOf(e) < 0) emails.push(e); };

  // Normalise owners into a uniform array
  var owners = [];
  if (task.owners && task.owners.length > 0) {
    owners = task.owners;
  } else if (task.ownerEmail || task.owner) {
    owners = [{ dept: task.ownerDept || '', email: task.ownerEmail || '', individual: task.owner || '' }];
  }

  owners.forEach(function(o) {
    var dept = (o.dept || '').trim();

    // 1. CANONICAL: owner carries an email — no name matching involved
    if (o.email && o.email.indexOf('@') > -1) { push(o.email); return; }

    // 2. LEGACY fallback for rows not yet migrated
    var ind = (o.individual || o.nameCache || '').trim();
    if (ind && index.byName[ind.toLowerCase()]) { push(index.byName[ind.toLowerCase()]); return; }
    if (ind && ind.indexOf('@') > -1) { push(ind); return; }

    // 3. Whole-department assignment → dept alias, or every member
    var target = dept || ind;
    if (target && index.byDept[target]) {
      var alias = index.byDept[target].filter(function(m) { return m.isDeptEmail; });
      if (alias.length > 0) alias.forEach(function(m) { push(m.email); });
      else index.byDept[target].forEach(function(m) { push(m.email); });
    }
  });

  // Only fall back to the product owner when the task has no resolvable owner
  if (emails.length === 0 && productFallback && productFallback.length > 0) {
    productFallback.forEach(push);
  }
  return emails;
}

/* ══════════════════════════════════════════════════════════════
   MIGRATION: name-based owners → canonical email identity

   RUN ORDER — do not skip step 1:
     1. migrateOwnersToEmail_DRYRUN()  → prints the resolution table,
                                          writes NOTHING. Read the log.
     2. migrateOwnersToEmail_APPLY()   → writes only after you've read it.

   Anything under UNRESOLVED needs a human decision. The migration will
   never guess: unresolved owners are left exactly as they are, so the
   legacy name-matching fallback keeps them working until you fix them.
   ══════════════════════════════════════════════════════════════ */
function migrateOwnersToEmail_DRYRUN() { return runOwnerMigration_(true); }
function migrateOwnersToEmail_APPLY()  { return runOwnerMigration_(false); }

function runOwnerMigration_(dryRun) {
  var authParam = '?auth=' + FIREBASE_DB_SECRET;
  var index     = getStakeholderIndex(authParam);
  var products  = JSON.parse(UrlFetchApp.fetch(
    FIREBASE_DB_URL + '/products.json' + authParam, { muteHttpExceptions: true }
  ).getContentText()) || {};

  var resolved = [], unresolved = [], alreadyOk = 0, writes = 0;

  Object.keys(products).forEach(function(pid) {
    var prod  = products[pid];
    var tasks = prod.tasks || {};
    Object.keys(tasks).forEach(function(tid) {
      var task = tasks[tid];

      // Build the legacy owner list for this task
      var legacy = [];
      if (task.owners && task.owners.length > 0) legacy = task.owners;
      else if (task.owner) legacy = [{ dept: task.ownerDept || '', individual: task.owner }];
      if (legacy.length === 0) return;

      var migrated = [], changed = false;

      legacy.forEach(function(o) {
        if (o.email && o.email.indexOf('@') > -1) {   // already canonical
          migrated.push(o); alreadyOk++; return;
        }
        var name = (o.individual || o.nameCache || '').trim();
        var dept = (o.dept || '').trim();

        var email = '';
        var matchKind = 'exact';
        if (name && index.byName[name.toLowerCase()]) {
          email = index.byName[name.toLowerCase()];
        } else if (name && name.indexOf('@') > -1) {
          email = name;
        } else if (name && !index.byDept[name]) {
          // Partial match — accepted ONLY when exactly one directory entry
          // matches on a shared word of 3+ characters. Two or more candidates
          // means we cannot tell them apart, so we decline rather than guess.
          //
          // Guarded by !index.byDept[name]: if the owner field holds a
          // DEPARTMENT name it must stay a department assignment, otherwise a
          // bare "MCC" would partial-match the "MCC Team" alias and be stored
          // as an individual — which breaks the privacy gate's department
          // check and hides that department's own tasks from its members.
          var words = name.toLowerCase().split(/[\s.,]+/).filter(function(w) { return w.length > 2; });
          if (words.length > 0) {
            var cands = [];
            Object.keys(index.byName).forEach(function(n) {
              var nWords = n.split(/[\s.,]+/);
              var shares = words.some(function(w) {
                return nWords.some(function(nw) { return nw === w; });
              });
              if (shares && cands.indexOf(index.byName[n]) < 0) cands.push(index.byName[n]);
            });
            if (cands.length === 1) { email = cands[0]; matchKind = 'partial'; }
            else if (cands.length > 1) { matchKind = 'ambiguous:' + cands.length; }
          }
        }

        if (email) {
          migrated.push({ dept: dept, email: email, nameCache: name });
          resolved.push(prod.name + ' | ' + (task.title || tid) + ' | "' + name + '" -> ' + email +
                        (matchKind === 'partial' ? '   [PARTIAL MATCH — verify]' : ''));
          changed = true;
        } else if (dept && index.byDept[dept]) {
          // Whole-department assignment with the dept field already set
          migrated.push({ dept: dept, email: '', nameCache: name });
          alreadyOk++;
        } else if (!dept && name && index.byDept[name]) {
          // The owner field holds a DEPARTMENT name with no dept field set.
          // The runtime resolver already handles this (target = dept || ind),
          // so these route correctly today — but normalise them so the dept
          // lives in the right field and the legacy path is no longer needed.
          migrated.push({ dept: name, email: '', nameCache: '' });
          resolved.push(prod.name + ' | ' + (task.title || tid) + ' | "' + name + '" -> department "' + name + '"');
          changed = true;
        } else {
          migrated.push(o);   // leave untouched — legacy fallback still handles it
          unresolved.push(prod.name + ' | ' + (task.title || tid) + ' | "' + name + '" (dept: "' + dept + '")' +
                          (matchKind.indexOf('ambiguous') === 0
                            ? '  — ' + matchKind.split(':')[1] + ' possible matches, too ambiguous to pick'
                            : ''));
        }
      });

      if (!changed) return;
      writes++;
      if (dryRun) return;

      var first = migrated[0] || {};
      var base  = FIREBASE_DB_URL + '/products/' + pid + '/tasks/' + tid;
      UrlFetchApp.fetch(base + '/owners.json' + authParam,
        { method: 'put', contentType: 'application/json', payload: JSON.stringify(migrated), muteHttpExceptions: true });
      UrlFetchApp.fetch(base + '/ownerEmail.json' + authParam,
        { method: 'put', contentType: 'application/json', payload: JSON.stringify(first.email || ''), muteHttpExceptions: true });
    });
  });

  Logger.log('═══════════════════════════════════════════');
  Logger.log(dryRun ? 'DRY RUN — nothing was written' : 'APPLIED — ' + writes + ' task(s) updated');
  Logger.log('Already canonical : ' + alreadyOk);
  Logger.log('Resolved          : ' + resolved.length);
  Logger.log('UNRESOLVED        : ' + unresolved.length);
  Logger.log('═══════════════════════════════════════════');
  if (resolved.length) {
    Logger.log('--- RESOLVED ---');
    resolved.forEach(function(r) { Logger.log('  ' + r); });
  }
  if (unresolved.length) {
    Logger.log('--- UNRESOLVED (left untouched — they still work via legacy name matching) ---');
    unresolved.forEach(function(u) { Logger.log('  ' + u); });
    // Suggest close matches so the fix is obvious rather than guesswork.
    Logger.log('');
    Logger.log('--- SUGGESTIONS (NOT applied — confirm before acting) ---');
    var seen = {};
    unresolved.forEach(function(u) {
      var m = u.match(/\| "([^"]*)"/);
      if (!m || !m[1] || seen[m[1]]) return;
      seen[m[1]] = true;
      var needle = m[1].toLowerCase();
      var hits = [];
      Object.keys(index.byName).forEach(function(n) {
        // match on any shared word of 3+ chars
        var words = needle.split(/[\s.]+/).filter(function(w) { return w.length > 2; });
        if (words.some(function(w) { return n.indexOf(w) > -1; })) {
          hits.push(index.byName[n] + '  (' + n + ')');
        }
      });
      Logger.log('  "' + m[1] + '" -> ' + (hits.length ? hits.join('  |  ') : 'no close match in the directory'));
    });
    Logger.log('');
    Logger.log('  To fix: add the person in Circuit Box > People, or reassign the task in the UI.');
    Logger.log('  Re-run this dry run afterwards. Nothing breaks in the meantime.');
  }
  return { dryRun: dryRun, resolved: resolved.length, unresolved: unresolved.length, writes: writes };
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

  var stakeIndex = getStakeholderIndex(authParam);

  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived') return;
    if (prod.alertsEnabled === false) return;

    // Product-level fallback ONLY — used when a task has no resolvable owner
    var productFallback = [];
    if (prod.alertRecipients && prod.alertRecipients.length > 0) {
      productFallback = prod.alertRecipients;
    } else if (prod.ownerId && users[prod.ownerId] && users[prod.ownerId].email) {
      productFallback = [users[prod.ownerId].email];
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

      // Resolve recipients from the TASK's owners — this is what makes
      // reassignment actually change who gets the email.
      var taskRecipients = resolveTaskRecipients(task, stakeIndex, productFallback);
      if (taskRecipients.length === 0) {
        Logger.log('No recipient for task "' + (task.title || task.id) + '" in ' + prod.name + ' — skipping');
        return;
      }

      // Display label: show every owner, not just the first
      var ownerLabel = '';
      if (task.owners && task.owners.length > 0) {
        ownerLabel = task.owners.map(function(o) { return o.individual || o.dept; }).join(', ');
      } else {
        ownerLabel = task.owner || '';
      }

      alerts.push({
        productName: prod.name,
        productId:   prod.id,
        pillarName:  task.title || task.name || 'Unknown task',
        pillarId:    task.id,
        ownerDept:   ownerLabel,
        deptEmails:  taskRecipients,
        visibility:  task.visibility || 'private',
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
        // Private tasks never go into the shared thread — strip them out and
    // let them fall through to the individual-email path below.
    var privateAlerts = prodAlerts.filter(isPrivateAlert_);
    prodAlerts        = prodAlerts.filter(function(a) { return !isPrivateAlert_(a); });
    if (privateAlerts.length > 0) {
      Logger.log(privateAlerts.length + ' private task alert(s) excluded from thread reply for ' + productId);
    }
    if (thread && prodAlerts.length > 0) {
          // Build tabular alert email for thread reply
          var today2 = new Date();
          var dateStr = Utilities.formatDate(today2, 'Africa/Lagos', 'EEEE, dd MMMM yyyy');
          var tableRows = prodAlerts.map(function(a) {
            var deadlineDisplay = a.deadline
              ? new Date(a.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
              : '—';
            var daysStr = a.daysUntil === null ? '—'
              : a.daysUntil < 0 ? Math.abs(a.daysUntil) + 'd overdue'
              : a.daysUntil === 0 ? 'Due today' : a.daysUntil + 'd remaining';
            var statusLabel = a.alertType === 'overdue' ? 'OVERDUE'
              : a.alertType === 'delayed' ? 'DELAYED'
              : a.alertType === 'due' ? 'DUE TODAY'
              : 'DUE IN ' + a.daysUntil + 'D';
            var statusColor = (a.alertType === 'overdue' || a.alertType === 'delayed') ? '#C0282D' : '#D97706';
            return '<tr style="border-bottom:1px solid #f0f0ee;">' +
              '<td style="padding:10px 14px;font-size:12px;color:#1a1a18;font-weight:500;">' + a.pillarName + '</td>' +
              '<td style="padding:10px 14px;font-size:11px;color:#6b6b67;">' + (a.ownerDept || '—') + '</td>' +
              '<td style="padding:10px 14px;font-size:12px;color:#1a1a18;">' + deadlineDisplay +
                '<div style="font-size:10px;color:' + statusColor + ';">' + daysStr + '</div></td>' +
              '<td style="padding:10px 14px;"><span style="background:' + statusColor + '18;color:' + statusColor + ';font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;text-transform:uppercase;">' + statusLabel + '</span></td>' +
            '</tr>';
          }).join('');

          var htmlBody = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:20px;">' +
            '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e4e0;">' +
            '<div style="background:#C0282D;padding:16px 28px;">' +
              '<div style="color:rgba(255,255,255,.75);font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:2px;">Mixta Africa — NPD Hub Deadline Alert</div>' +
              '<div style="color:#fff;font-size:17px;font-weight:700;">' + (prod ? prod.name : productId) + '</div>' +
            '</div>' +
            '<div style="padding:20px 28px 0;">' +
              '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e4e0;">' +
                '<thead><tr style="background:#1a1a18;">' +
                  '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.06em;width:38%;">Task / Milestone</th>' +
                  '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.06em;">Owner</th>' +
                  '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.06em;">Deadline</th>' +
                  '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.06em;">Status</th>' +
                '</tr></thead>' +
                '<tbody>' + tableRows + '</tbody>' +
              '</table>' +
            '</div>' +
            '<div style="padding:16px 28px;">' +
              '<p style="font-size:11px;color:#9a9a96;margin:0;">Kindly update task statuses on the NPD Hub. If any item is blocked, flag it immediately.</p>' +
            '</div>' +
            '<div style="background:#f8f8f7;padding:10px 28px;border-top:1px solid #e5e4e0;display:flex;justify-content:space-between;">' +
              '<span style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub · Automated Alert</span>' +
              '<span style="font-size:11px;color:#9a9a96;">' + dateStr + '</span>' +
            '</div></div></body></html>';

          var allRecips = [];
          prodAlerts.forEach(function(a) {
            (a.deptEmails || []).forEach(function(e) {
              if (allRecips.indexOf(e) < 0) allRecips.push(e);
            });
          });

          var replyOpts = {
            htmlBody: htmlBody,
            name:     SENDER_NAME,
          };
          if (allRecips.length > 0) replyOpts.to = allRecips.join(',');
          thread.reply('', replyOpts);
          totalSent += allRecips.length;
          logEmailSent(productId, {
            type: 'deadline_alert', trigger: 'automated',
            subject: 'Deadline alert — ' + (prod ? prod.name : productId),
            to: allRecips, cc: [],
            taskTitles: prodAlerts.map(function(a) { return a.pillarName; }),
            sentBy: 'NPD Hub (automated daily check)',
          });
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

  // Fetch stakeholders ONCE — not once per task
  var stakeIndex = getStakeholderIndex(authParam);

  var fileTask = function(email, entry) {
    if (!userTasks[email]) userTasks[email] = { overdue: [], dueSoon: [], onTrack: [] };
    if (entry.daysUntil !== null && entry.daysUntil < 0)       userTasks[email].overdue.push(entry);
    else if (entry.daysUntil !== null && entry.daysUntil <= 7) userTasks[email].dueSoon.push(entry);
    else                                                        userTasks[email].onTrack.push(entry);
  };

  Object.values(products).forEach(function(prod) {
    if (prod.status === 'archived') return;
    var tasks = Object.values(prod.tasks || prod.pillars || {});
    tasks.forEach(function(task) {
      if ((task.status || task.taskStatus) === 'complete') return;
      // Skip empty placeholder rows — no title and no deadline means nothing to chase
      if (!task.title && !task.name && !task.deadline) return;

      // Multi-owner aware: every assigned party gets the task on their list
      var recipients = resolveTaskRecipients(task, stakeIndex, []);
      if (recipients.length === 0) return;

      var d = task.deadline ? new Date(task.deadline) : null;
      if (d) d.setHours(0,0,0,0);
      var daysUntil = d ? Math.round((d - today) / 86400000) : null;
      var entry = {
        title: task.title || task.name || 'Untitled',
        product: prod.name,
        deadline: task.deadline,
        daysUntil: daysUntil,
        status: task.status || task.taskStatus || '',
      };
      recipients.forEach(function(email) { fileTask(email, entry); });
    });
  });

  // Standalone personal tasks — the built-in to-do list
  try {
    var standalone = JSON.parse(UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/standaloneTasks.json' + authParam,
      { muteHttpExceptions: true }
    ).getContentText()) || {};
    Object.keys(standalone).forEach(function(userKey) {
      var bucket = standalone[userKey] || {};
      Object.values(bucket).forEach(function(task) {
        if (!task || task.status === 'complete' || !task.ownerEmail) return;
        var d = task.deadline ? new Date(task.deadline) : null;
        if (d) d.setHours(0,0,0,0);
        var daysUntil = d ? Math.round((d - today) / 86400000) : null;
        fileTask(task.ownerEmail, {
          title: task.title || 'Untitled',
          product: 'Personal',
          deadline: task.deadline,
          daysUntil: daysUntil,
          status: task.status || '',
        });
      });
    });
  } catch(e) {
    Logger.log('Standalone task fetch failed: ' + e.message);
  }

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
        if (!task.title && !task.name && !task.deadline) return; // skip empty placeholders
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

  var buildTableSection = function(items, sectionLabel, sectionColor) {
    if (!items.length) return '';
    var rows = items.map(function(t) {
      var deadlineDisplay = t.deadline
        ? new Date(t.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
        : '—';
      var daysStr = t.daysUntil === null ? '—'
        : t.daysUntil < 0 ? Math.abs(t.daysUntil) + 'd overdue'
        : t.daysUntil === 0 ? 'Due today' : t.daysUntil + 'd left';
      var statusLabel = t.status === 'delayed' ? 'DELAYED'
        : t.daysUntil !== null && t.daysUntil < 0 ? 'OVERDUE'
        : t.daysUntil === 0 ? 'DUE TODAY' : 'ON TRACK';
      var statusColor = (statusLabel === 'OVERDUE' || statusLabel === 'DELAYED') ? '#C0282D'
        : statusLabel === 'DUE TODAY' ? '#D97706' : '#16A34A';
      return '<tr style="border-bottom:1px solid #f0f0ee;">' +
        '<td style="padding:10px 14px;font-size:12px;color:#1a1a18;font-weight:500;">' + t.title + '</td>' +
        '<td style="padding:10px 14px;font-size:11px;color:#6b6b67;">' + t.product + '</td>' +
        '<td style="padding:10px 14px;font-size:12px;color:#1a1a18;">' + deadlineDisplay + '<div style="font-size:10px;color:' + sectionColor + ';">' + daysStr + '</div></td>' +
        '<td style="padding:10px 14px;"><span style="background:' + statusColor + '18;color:' + statusColor + ';font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;">' + statusLabel + '</span></td>' +
      '</tr>';
    }).join('');

    return '<div style="margin-bottom:20px;">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:' + sectionColor + ';margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sectionColor + ';"></span>' +
        sectionLabel + ' — ' + (sectionColor === '#16A34A' ? 'ON TRACK' : sectionColor === '#D97706' ? 'DUE SOON' : 'NEEDS ACTION') +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e4e0;">' +
        '<thead><tr style="background:#1a1a18;">' +
          '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;width:38%;">Task / Action Item</th>' +
          '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Product</th>' +
          '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Due Date</th>' +
          '<th style="padding:8px 14px;text-align:left;font-size:10px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Status</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  };

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:20px;">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e4e0;">' +

    '<div style="background:#1a1a18;padding:18px 28px;">' +
      '<div style="color:rgba(255,255,255,.6);font-size:10px;text-transform:uppercase;letter-spacing:.12em;margin-bottom:3px;">Mixta Africa NPD Hub &nbsp;·&nbsp; ' + digestType + ' Task Digest</div>' +
      '<div style="color:#fff;font-size:18px;font-weight:700;">' + totalCount + ' task' + (totalCount !== 1 ? 's' : '') + ' require your attention</div>' +
      '<div style="color:rgba(255,255,255,.5);font-size:11px;margin-top:3px;">' + dateStr + '</div>' +
    '</div>' +

    '<div style="padding:20px 28px;">' +
      (totalCount === 0
        ? '<p style="font-size:13px;color:#16A34A;text-align:center;padding:24px 0;font-weight:500;">You\'re all clear — no active tasks assigned to you.</p>'
        : buildTableSection(data.overdue, 'Overdue', '#C0282D') +
          buildTableSection(data.dueSoon, 'Due this week', '#D97706') +
          buildTableSection(data.onTrack, 'Coming up', '#16A34A')) +
      '<p style="font-size:11px;color:#9a9a96;margin-top:16px;line-height:1.6;">Kindly review your tasks and update statuses on the NPD Hub. If any item is blocked or requires escalation, flag it on the dashboard immediately.</p>' +
    '</div>' +

    '<div style="background:#f8f8f7;padding:12px 28px;border-top:1px solid #e5e4e0;display:flex;justify-content:space-between;">' +
      '<span style="font-size:11px;color:#9a9a96;">Mixta Africa — NPD Hub</span>' +
      '<span style="font-size:11px;color:#9a9a96;">' + dateStr + '</span>' +
    '</div>' +

    '</div></body></html>';
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
      case 'exportProjectTracker':  result = exportProjectTracker(body);         break;
      case 'syncProjectToSheet':    result = syncProjectToSheet(body);           break;
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

/* ══════════════════════════════════════════════════════════════
   PROJECT TRACKER EXPORT

   Builds a formatted, shareable Google Sheet for one project.

   PRIVACY: this function never reads Firebase for tasks. The caller
   sends a pre-filtered list containing only what THAT user is allowed
   to see (canViewTask runs in the browser, where the user identity
   exists). GAS cannot widen the set because it never sees the rest.
   ══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   PROJECT SHEET SYNC  —  Hub ⇄ Google Sheets

   MODEL
     One spreadsheet per project. Bidirectional on the operational
     fields. Private tasks NEVER leave Firebase, so a shared sheet
     can only ever contain rows its viewers were already entitled to.

   WHY POLLING, NOT onEdit
     Apps Script caps a script at 20 triggers. A per-spreadsheet
     onEdit trigger would break at the 21st project. One time-based
     poll scales to any number of sheets and — because it writes only
     when the sheet value DIFFERS from Firebase — is idempotent, so
     Hub→Sheet→Hub feedback loops cannot form.

   COLUMNS
     A TaskID(locked)  B Task  C Owner(locked)  D Dept(locked)
     E Deadline  F Status  G Notes  H LastSync(locked)
     Editable from the sheet: B, E, F, G.
   ══════════════════════════════════════════════════════════════ */
var SHEET_COLS   = ['TaskID', 'Task', 'Owner', 'Department', 'Deadline', 'Status', 'Notes', 'Last sync'];
var SHEET_STATUS = ['On Track', 'Due Soon', 'Delayed', 'Overdue', 'Complete'];
var SYNC_ROOT    = 'NPD Hub — Project Sheets';

function statusToSheet(s) {
  return ({ 'on-track':'On Track', 'due-soon':'Due Soon', delayed:'Delayed',
            overdue:'Overdue', complete:'Complete' })[s] || 'On Track';
}
function statusFromSheet(s) {
  var k = String(s || '').trim().toLowerCase();
  return ({ 'on track':'on-track', 'due soon':'due-soon', delayed:'delayed',
            overdue:'overdue', complete:'complete', done:'complete' })[k] || null;
}

/* Only department- and public-visibility tasks are eligible for a shared
   sheet. Mirrors isTaskPrivate() used by the alert path. */
function isSyncable(task) {
  var v = task && task.visibility;
  return v === 'public' || v === 'department' || v === 'restricted';
}

function getSheetRegistry(authParam) {
  try {
    return JSON.parse(UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/config/projectSheets.json' + authParam,
      { muteHttpExceptions: true }).getContentText()) || {};
  } catch(e) { return {}; }
}

function ensureProjectSheet(productId, productName, authParam) {
  var reg = getSheetRegistry(authParam);
  if (reg[productId] && reg[productId].sheetId) {
    try { SpreadsheetApp.openById(reg[productId].sheetId); return reg[productId].sheetId; }
    catch(e) { /* deleted — fall through and recreate */ }
  }

  var root = getOrCreateFolder(SYNC_ROOT, DriveApp.getRootFolder());
  var ss   = SpreadsheetApp.create(productName + ' — Live Tracker');
  DriveApp.getFileById(ss.getId()).moveTo(root);

  var sh = ss.getActiveSheet();
  sh.setName('Tasks');
  sh.getRange(1, 1, 1, SHEET_COLS.length).setValues([SHEET_COLS])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1A1A18').setFontSize(10);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 150);
  sh.setColumnWidth(4, 120); sh.setColumnWidth(5, 105); sh.setColumnWidth(6, 105);
  sh.setColumnWidth(7, 280); sh.setColumnWidth(8, 140);

  // Status dropdown stops free-text garbage arriving on the return path
  sh.getRange(2, 6, 500).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SHEET_STATUS, true)
      .setAllowInvalid(false).build());

  // Guidance row so people know which columns are live
  sh.getRange(1, 9).setValue(
    'Editable here: Task, Deadline, Status, Notes. Changes sync back to the NPD Hub within 10 minutes. ' +
    'TaskID, Owner and Department are managed in the Hub. Private tasks are never shown here.');
  sh.getRange(1, 9).setFontSize(8).setFontColor('#9A9A96');

  UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/projectSheets/' + productId + '.json' + authParam, {
    method: 'put', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      sheetId: ss.getId(), url: ss.getUrl(), productName: productName,
      createdAt: new Date().toISOString(), lastPolledAt: 0,
    }),
  });
  Logger.log('Created project sheet for ' + productName + ': ' + ss.getUrl());
  return ss.getId();
}

/* ── FORWARD: Hub → Sheet ─────────────────────────────────── */
function syncProjectToSheet(body) {
  try {
    var authParam = '?auth=' + FIREBASE_DB_SECRET;
    var productId = body.productId;
    if (!productId) return { ok: false, error: 'No productId' };

    var prod = JSON.parse(UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/products/' + productId + '.json' + authParam,
      { muteHttpExceptions: true }).getContentText());
    if (!prod) return { ok: false, error: 'Product not found' };

    var sheetId = ensureProjectSheet(productId, prod.name || productId, authParam);
    var sh = SpreadsheetApp.openById(sheetId).getSheetByName('Tasks');

    var tasks = Object.values(prod.tasks || {}).filter(isSyncable);
    var stamp = Utilities.formatDate(new Date(), 'Africa/Lagos', 'dd MMM yyyy HH:mm');

    // Wipe the body and rewrite — simplest correct approach at this scale
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, SHEET_COLS.length).clearContent().setBackground(null);

    if (tasks.length > 0) {
      var rows = tasks.map(function(t) {
        var owners = (t.owners && t.owners.length) ? t.owners
          : [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner || '' }];
        return [
          t.id,
          t.title || 'Untitled',
          owners.map(function(o) { return o.nameCache || o.email || o.dept || ''; }).filter(String).join(', '),
          owners.map(function(o) { return o.dept; }).filter(String).join(', '),
          t.deadline || '',
          statusToSheet(t.status || 'on-track'),
          t.notes || '',
          stamp,
        ];
      });
      sh.getRange(2, 1, rows.length, SHEET_COLS.length).setValues(rows);

      // Colour the status column so the sheet reads like the Hub
      var bg = { 'Complete':'#EFF6FF', 'Delayed':'#FEF2F2', 'Overdue':'#FEF2F2',
                 'Due Soon':'#FFFBEB', 'On Track':'#F0FDF4' };
      var fg = { 'Complete':'#2563EB', 'Delayed':'#C0282D', 'Overdue':'#C0282D',
                 'Due Soon':'#D97706', 'On Track':'#16A34A' };
      rows.forEach(function(r, i) {
        sh.getRange(2 + i, 6).setBackground(bg[r[5]] || null).setFontColor(fg[r[5]] || null).setFontWeight('bold');
      });
    }

    // Record the push so the very next poll does not treat our own write as a user edit
    UrlFetchApp.fetch(FIREBASE_DB_URL + '/config/projectSheets/' + productId + '/lastPushAt.json' + authParam, {
      method: 'put', contentType: 'application/json',
      payload: JSON.stringify(Date.now()), muteHttpExceptions: true });

    var skipped = Object.keys(prod.tasks || {}).length - tasks.length;
    return { ok: true, url: SpreadsheetApp.openById(sheetId).getUrl(),
             synced: tasks.length, skippedPrivate: skipped };
  } catch(err) {
    Logger.log('syncProjectToSheet error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/* ── RETURN: Sheet → Hub ──────────────────────────────────── */
function installSheetSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollSheetsToFirebase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollSheetsToFirebase').timeBased().everyMinutes(10).create();
  Logger.log('Sheet sync poll installed — runs every 10 minutes');
}

function pollSheetsToFirebase() {
  var authParam = '?auth=' + FIREBASE_DB_SECRET;
  var reg = getSheetRegistry(authParam);
  var ids = Object.keys(reg);
  if (ids.length === 0) { Logger.log('No project sheets registered.'); return; }

  var totalChanged = 0, sheetsScanned = 0;

  ids.forEach(function(productId) {
    var entry = reg[productId];
    if (!entry || !entry.sheetId) return;
    var file;
    try { file = DriveApp.getFileById(entry.sheetId); } catch(e) {
      Logger.log('Sheet missing for ' + productId + ' — skipping'); return;
    }

    // Cheap gate: skip sheets untouched since the last poll
    var modified = file.getLastUpdated().getTime();
    if (entry.lastPolledAt && modified <= entry.lastPolledAt) return;
    sheetsScanned++;

    var sh = SpreadsheetApp.openById(entry.sheetId).getSheetByName('Tasks');
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) { markPolled_(productId, modified, authParam); return; }

    var values = sh.getRange(2, 1, last - 1, SHEET_COLS.length).getValues();
    var prod = JSON.parse(UrlFetchApp.fetch(
      FIREBASE_DB_URL + '/products/' + productId + '.json' + authParam,
      { muteHttpExceptions: true }).getContentText());
    if (!prod || !prod.tasks) { markPolled_(productId, modified, authParam); return; }

    values.forEach(function(row) {
      var taskId = String(row[0] || '').trim();
      if (!taskId) return;
      var task = prod.tasks[taskId];
      if (!task) return;                 // row for a deleted task — ignore
      if (!isSyncable(task)) return;     // never accept edits to a private task

      var updates = {};

      // Title
      var newTitle = String(row[1] || '').trim();
      if (newTitle && newTitle !== (task.title || '')) updates.title = newTitle;

      // Deadline — normalise whatever the cell holds to YYYY-MM-DD
      var newDeadline = normaliseSheetDate_(row[4]);
      if (newDeadline !== (task.deadline || '')) updates.deadline = newDeadline;

      // Status
      var newStatus = statusFromSheet(row[5]);
      if (newStatus && newStatus !== (task.status || 'on-track')) updates.status = newStatus;

      // Notes
      var newNotes = String(row[6] || '').trim();
      if (newNotes !== (task.notes || '')) updates.notes = newNotes;

      // Value comparison means an unchanged row writes nothing — this is
      // what makes the whole loop safe.
      if (Object.keys(updates).length === 0) return;

      Object.keys(updates).forEach(function(field) {
        UrlFetchApp.fetch(
          FIREBASE_DB_URL + '/products/' + productId + '/tasks/' + taskId + '/' + field + '.json' + authParam,
          { method: 'put', contentType: 'application/json',
            payload: JSON.stringify(updates[field]), muteHttpExceptions: true });
      });

      var actId = 'sheet_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      UrlFetchApp.fetch(
        FIREBASE_DB_URL + '/products/' + productId + '/activity/' + actId + '.json' + authParam,
        { method: 'put', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify({
            id: actId, type: 'sheet_sync',
            message: 'Updated from Google Sheet: ' + (task.title || taskId),
            detail: Object.keys(updates).map(function(f) { return f + ' → ' + updates[f]; }).join(', '),
            user: 'sheet-sync', userName: 'Google Sheet', timestamp: Date.now(),
          }) });
      totalChanged++;
    });

    markPolled_(productId, modified, authParam);
  });

  Logger.log('Sheet poll: ' + sheetsScanned + ' sheet(s) changed, ' + totalChanged + ' task field group(s) written back');
}

function markPolled_(productId, modified, authParam) {
  UrlFetchApp.fetch(
    FIREBASE_DB_URL + '/config/projectSheets/' + productId + '/lastPolledAt.json' + authParam,
    { method: 'put', contentType: 'application/json',
      payload: JSON.stringify(modified), muteHttpExceptions: true });
}

function normaliseSheetDate_(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, 'Africa/Lagos', 'yyyy-MM-dd');
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, 'Africa/Lagos', 'yyyy-MM-dd');
}

// Manual run for testing the return path without waiting for the trigger
function test_pollSheets() { pollSheetsToFirebase(); }

function exportProjectTracker(body) {
  try {
    var name    = body.productName || 'Untitled';
    var tasks   = body.tasks || [];
    var isProj  = (body.itemType || 'product') === 'project';
    var stamp   = Utilities.formatDate(new Date(), 'Africa/Lagos', 'dd MMM yyyy');
    var fileName = name + ' — Tracker — ' + stamp;

    var ss = SpreadsheetApp.create(fileName);
    var sh = ss.getActiveSheet();
    sh.setName('Tracker');

    // ── Title block ──────────────────────────────────────────
    sh.getRange('A1').setValue(name);
    sh.getRange('A1:G1').merge()
      .setFontSize(16).setFontWeight('bold').setFontColor('#FFFFFF')
      .setBackground('#C0282D').setVerticalAlignment('middle');
    sh.setRowHeight(1, 38);

    var meta = (isProj ? 'Project' : 'Product') +
      '   |   ' + (isProj ? 'Target completion' : 'Target launch') + ': ' + (body.launchDate || 'not set') +
      '   |   Owner: ' + (body.ownerName || 'unassigned') +
      '   |   Generated ' + stamp + ' by ' + (body.generatedBy || '');
    sh.getRange('A2').setValue(meta);
    sh.getRange('A2:G2').merge()
      .setFontSize(9).setFontColor('#6B6B67').setBackground('#F8F8F7')
      .setVerticalAlignment('middle');
    sh.setRowHeight(2, 26);

    // ── Summary counts ───────────────────────────────────────
    var counts = { complete: 0, delayed: 0, overdue: 0, 'due-soon': 0, 'on-track': 0 };
    tasks.forEach(function(t) { if (counts[t.status] !== undefined) counts[t.status]++; });
    var pct = tasks.length ? Math.round((counts.complete / tasks.length) * 100) : 0;
    sh.getRange('A3').setValue(
      tasks.length + ' tasks   |   ' + pct + '% complete   |   ' +
      counts.complete + ' done, ' + counts['on-track'] + ' on track, ' +
      counts['due-soon'] + ' due soon, ' + (counts.overdue + counts.delayed) + ' need action'
    );
    sh.getRange('A3:G3').merge().setFontSize(9).setFontColor('#1A1A18').setFontWeight('bold');
    sh.setRowHeight(3, 22);

    // ── Header row ───────────────────────────────────────────
    var headers = ['#', 'Task', 'Owner', 'Department', 'Deadline', 'Status', 'Notes'];
    sh.getRange(5, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1A1A18')
      .setFontSize(10).setVerticalAlignment('middle');
    sh.setRowHeight(5, 28);

    // ── Rows ─────────────────────────────────────────────────
    var STATUS_LABEL = {
      complete:   'Complete',   delayed:  'Delayed',  overdue: 'Overdue',
      'due-soon': 'Due Soon',   'on-track': 'On Track',
    };
    var STATUS_BG = {
      complete:   ['#EFF6FF', '#2563EB'],
      delayed:    ['#FEF2F2', '#C0282D'],
      overdue:    ['#FEF2F2', '#C0282D'],
      'due-soon': ['#FFFBEB', '#D97706'],
      'on-track': ['#F0FDF4', '#16A34A'],
    };

    if (tasks.length > 0) {
      var rows = tasks.map(function(t, i) {
        return [
          i + 1,
          t.title    || 'Untitled',
          t.owner    || 'Unassigned',
          t.dept     || '',
          t.deadline || 'No date',
          STATUS_LABEL[t.status] || 'On Track',
          t.notes    || '',
        ];
      });
      sh.getRange(6, 1, rows.length, headers.length).setValues(rows)
        .setFontSize(10).setVerticalAlignment('top').setWrap(true);

      // Colour the status cell per row
      tasks.forEach(function(t, i) {
        var pair = STATUS_BG[t.status] || STATUS_BG['on-track'];
        sh.getRange(6 + i, 6)
          .setBackground(pair[0]).setFontColor(pair[1])
          .setFontWeight('bold').setHorizontalAlignment('center');
      });

      // Banding on the task rows only
      sh.getRange(6, 1, rows.length, headers.length)
        .setBorder(true, true, true, true, true, true, '#E5E4E0', SpreadsheetApp.BorderStyle.SOLID);
    } else {
      sh.getRange(6, 1).setValue('No tasks visible to you on this item.')
        .setFontColor('#9A9A96').setFontStyle('italic');
    }

    // ── Layout ───────────────────────────────────────────────
    sh.setColumnWidth(1, 40);   sh.setColumnWidth(2, 340);
    sh.setColumnWidth(3, 150);  sh.setColumnWidth(4, 120);
    sh.setColumnWidth(5, 100);  sh.setColumnWidth(6, 100);
    sh.setColumnWidth(7, 260);
    sh.setFrozenRows(5);
    sh.getRange(1, 1, 3, headers.length).setHorizontalAlignment('left');

    // Footer note
    var footRow = 6 + Math.max(tasks.length, 1) + 1;
    sh.getRange(footRow, 1).setValue(
      'Generated from the Mixta Africa NPD Hub on ' + stamp +
      '. Shows only items visible to ' + (body.generatedBy || 'the requester') + '.'
    );
    sh.getRange(footRow, 1, 1, headers.length).merge()
      .setFontSize(8).setFontColor('#9A9A96').setFontStyle('italic');

    // Anyone with the link can view — it is a point-in-time snapshot
    var file = DriveApp.getFileById(ss.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    logEvent('Tracker exported', name, tasks.length + ' rows');
    return {
      ok: true,
      url: ss.getUrl(),
      xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx',
      pdfUrl:  'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&portrait=false&fitw=true&gridlines=false',
      rows: tasks.length,
    };
  } catch(err) {
    Logger.log('exportProjectTracker error: ' + err.message);
    return { ok: false, error: err.message };
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

      // If more time was requested, drop a visible comment on the product so
      // the owner sees it on the dashboard, not just in the activity log.
      if (ackType === 'needs_more_time') {
        var commentId = 'c_time_' + Date.now();
        UrlFetchApp.fetch(FIREBASE_DB_URL + '/products/' + productId + '/comments/' + commentId + '.json' + authParam, {
          method: 'put', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify({
            id: commentId,
            text: '**Time Extension Requested**\n' + email.split('@')[0] +
                  ' has requested more time to complete their assigned task. Please review the timeline and reach out to them.',
            userEmail: 'system@mixtafrica.com',
            userName:  'System Alert',
            type:      'time_extension',
            createdAt: Date.now(),
          }),
        });
      }

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
            logEmailSent(alert.productId, {
              type: 'deadline_alert', trigger: body.testMode ? 'test' : 'automated',
              subject: alertSubject, to: [email], cc: [],
              taskTitles: [alert.pillarName], taskId: alert.pillarId,
              sentBy: 'NPD Hub (automated)',
            });
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
  var headerBg = alert.alertType === 'overdue' || alert.alertType === 'delayed' ? '#C0282D'
               : alert.alertType === 'due'     ? '#D97706' : '#D97706';

  var statusLabel = alert.alertType === 'overdue' ? 'OVERDUE'
                  : alert.alertType === 'delayed' ? 'DELAYED'
                  : alert.alertType === 'due'     ? 'DUE TODAY'
                  : 'DUE IN ' + alert.daysUntil + 'D';

  var statusColor = alert.alertType === 'overdue' || alert.alertType === 'delayed' ? '#C0282D' : '#D97706';

  var deadlineDisplay = alert.deadline
    ? new Date(alert.deadline).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : 'No date set';

  var daysStr = alert.daysUntil === null ? '—'
    : alert.daysUntil < 0 ? Math.abs(alert.daysUntil) + 'd overdue'
    : alert.daysUntil === 0 ? 'Due today'
    : alert.daysUntil + 'd remaining';

  // getUrl() can return the editor URL in some execution contexts, which
  // produces dead acknowledge links. Guard and fall back to the /exec form.
  var baseUrl;
  try { baseUrl = ScriptApp.getService().getUrl(); } catch(e) { baseUrl = ''; }
  if (!baseUrl || baseUrl.indexOf('/edit') !== -1 || baseUrl.indexOf('/d/') !== -1) {
    baseUrl = 'https://script.google.com/macros/s/' + ScriptApp.getScriptId() + '/exec';
  }
  var ackUrl  = baseUrl + '?action=ack&p=' + encodeURIComponent(alert.productId || '') +
    '&t=' + encodeURIComponent(alert.taskId || '') +
    '&type=acknowledged&email=' + encodeURIComponent(alert.recipientEmail || '');
  var moreUrl = baseUrl + '?action=ack&p=' + encodeURIComponent(alert.productId || '') +
    '&t=' + encodeURIComponent(alert.taskId || '') +
    '&type=needs_more_time&email=' + encodeURIComponent(alert.recipientEmail || '');

  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f8f7;margin:0;padding:20px;">' +
  '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e4e0;">' +

  // Header
  '<div style="background:' + headerBg + ';padding:18px 28px;">' +
    '<div style="color:rgba(255,255,255,.75);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px;">Mixta Africa — NPD Hub Deadline Alert</div>' +
    '<div style="color:#fff;font-size:18px;font-weight:700;">' + alert.productName + '</div>' +
  '</div>' +

  // Task table
  '<div style="padding:20px 28px 0;">' +
    '<table style="width:100%;border-collapse:collapse;border:1px solid #e5e4e0;border-radius:4px;overflow:hidden;">' +
      '<thead>' +
        '<tr style="background:#1a1a18;">' +
          '<th style="padding:9px 14px;text-align:left;font-size:11px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;width:40%;">Task / Milestone</th>' +
          '<th style="padding:9px 14px;text-align:left;font-size:11px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Owner</th>' +
          '<th style="padding:9px 14px;text-align:left;font-size:11px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Deadline</th>' +
          '<th style="padding:9px 14px;text-align:left;font-size:11px;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Status</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' +
        '<tr style="background:#fff;">' +
          '<td style="padding:12px 14px;font-size:13px;font-weight:600;color:#1a1a18;border-top:1px solid #f0f0ee;">' + alert.pillarName + '</td>' +
          '<td style="padding:12px 14px;font-size:12px;color:#4a4a46;border-top:1px solid #f0f0ee;">' + (alert.ownerDept || '—') + '</td>' +
          '<td style="padding:12px 14px;font-size:12px;color:#4a4a46;border-top:1px solid #f0f0ee;">' + deadlineDisplay + '<div style="font-size:11px;color:' + statusColor + ';margin-top:2px;">' + daysStr + '</div></td>' +
          '<td style="padding:12px 14px;border-top:1px solid #f0f0ee;"><span style="background:' + statusColor + '18;color:' + statusColor + ';font-size:11px;font-weight:700;padding:3px 9px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;">' + statusLabel + '</span></td>' +
        '</tr>' +
      '</tbody>' +
    '</table>' +
  '</div>' +

  // Action buttons
  '<div style="padding:18px 28px;display:flex;gap:10px;">' +
    '<a href="' + ackUrl + '" style="display:inline-block;background:#16A34A;color:#fff;text-align:center;padding:10px 20px;border-radius:4px;font-size:12px;font-weight:700;text-decoration:none;">Acknowledge</a>' +
    '<a href="' + moreUrl + '" style="display:inline-block;background:#fff;color:#1a1a18;text-align:center;padding:10px 20px;border-radius:4px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #e5e4e0;">Request more time</a>' +
  '</div>' +

  // Footer
  '<div style="background:#f8f8f7;padding:12px 28px;border-top:1px solid #e5e4e0;display:flex;justify-content:space-between;align-items:center;">' +
    '<span style="font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub · Automated Alert</span>' +
    '<span style="font-size:11px;color:#9a9a96;">' + new Date().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) + '</span>' +
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
        GmailApp.sendEmail(email, subject, '', buildSenderOpts(body, htmlBody));
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
        GmailApp.sendEmail(email, subject, '', buildSenderOpts(body, htmlBody));
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
      '<div style="padding:26px 28px;font-size:14px;color:#1a1a18;line-height:1.8;">' +
        parseMarkdownToEmailHtml(emailBody) +
      '</div>' +
      (folderUrl ? '<div style="padding:0 28px 24px;"><a href="' + folderUrl + '" style="display:inline-block;background:#C0282D;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Open Drive Folder</a></div>' : '') +
      '<div style="background:#f8f8f7;padding:12px 28px;border-top:1px solid #e5e4e0;font-size:11px;color:#9a9a96;">Mixta Africa NPD Hub &nbsp;·&nbsp; Sent via Email Composer</div>' +
      '</div></body></html>';

    var sent = 0, errors = [];
    to.forEach(function(email) {
      try {
        GmailApp.sendEmail(email, finalSubject, emailBody, Object.assign(
          buildSenderOpts(body, htmlBody),
          { cc: cc.join(',') }
        ));
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
    var replyOpts = buildSenderOpts(body, htmlBody);
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


/* ─────────────────────────────────────────────────────────────
   MARKDOWN → EMAIL HTML
   Converts Markdown pipe tables into styled HTML tables so an
   AI-drafted tracker renders as a real table rather than raw pipes.
   Also handles **bold**. Ported from the live script.
   ───────────────────────────────────────────────────────────── */
function parseMarkdownToEmailHtml(text) {
  if (!text) return '';

  var lines       = text.split('\n');
  var inTable     = false;
  var tableHtml   = '';
  var resultLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line.charAt(0) === '|' && line.charAt(line.length - 1) === '|') {
      if (!inTable) {
        inTable   = true;
        tableHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e4e0;">';
      }
      // Skip the |---|---| delimiter row
      if (line.match(/^\|[\s\-|]+\|$/)) continue;

      var cells    = line.split('|').slice(1, -1);
      var isHeader = tableHtml.indexOf('<thead>') === -1;

      if (isHeader) {
        tableHtml += '<thead style="background:#1a1a18;color:#fff;"><tr>';
        cells.forEach(function(c) {
          tableHtml += '<th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;">' + c.trim() + '</th>';
        });
        tableHtml += '</tr></thead><tbody>';
      } else {
        tableHtml += '<tr style="border-bottom:1px solid #e5e4e0;">';
        cells.forEach(function(c) {
          tableHtml += '<td style="padding:10px 12px;font-size:13px;color:#1a1a18;">' + c.trim() + '</td>';
        });
        tableHtml += '</tr>';
      }
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += '</tbody></table>';
        resultLines.push(tableHtml);
        tableHtml = '';
      }
      resultLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table>';
    resultLines.push(tableHtml);
  }

  var html = resultLines.join('<br>');
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

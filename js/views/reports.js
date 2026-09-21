/* views/reports.js — Progress Reports page: weekly report, deadline alerts, email schedule, AI diagnostics. */

import { db, get, ref, set, update } from '../core/firebase.js';
import { TEST_EMAIL } from '../core/config.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentRole, currentUser, isSuperAdmin } from '../core/state.js';
import { STAKEHOLDERS, SYS_CONFIG, TEAM_MEMBERS } from '../data/app-config.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { resolveTaskStatus } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';
import { isoWeekKey, weekKeyLabel } from './myactions.js';
import { _aiModelCache, AI_PROVIDERS, discoverModel, providerConfigured } from '../features/ai.js';
import { buildProgressReportPrompt, openEmailComposer } from '../features/email-composer.js';
import { logActivity } from '../features/activity.js';

/* ══ REPORTS + DEADLINE ALERT TRIGGER ══════════════════════ */
export function renderReports(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Progress Reports</h1>
        <p class="view-subtitle">Deadline alerts run automatically every day, at the hour set below</p>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">My weekly report</span></div>
      <div class="panel-body" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;font-size:13px;color:var(--text-mid);line-height:1.7;">
          Your own week at a glance: what you finished, what <strong>rolled over</strong> from earlier weeks, and an analysis of how you are trending.
          Looking for the team-level report? That is <em>Generate last week's report</em>, further down this page.
        </div>
        <button class="btn-primary" onclick="openWeeklyReport()">Open my weekly report</button>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:16px;">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Deadline Alert Engine</span></div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:16px;">
            Runs automatically every day via Google Apps Script — the same schedule set below under "Email schedule."<br/>
            Sends targeted emails to the responsible department only — not all stakeholders.<br/>
            Triggers: <strong>daily, for every active task with a deadline</strong>, showing each recipient a running countdown to (or past) that deadline.
          </p>
          ${currentRole === 'admin' ? `
          <div class="alert-manual-section">
            <div class="form-section-label" style="margin-bottom:10px;">Manual trigger</div>
            <select id="alert-product-sel" class="select-field" style="width:100%;margin-bottom:10px;">
              <option value="all">All active products</option>
            </select>
            <div style="margin-bottom:10px;">
            <select id="alert-send-mode" class="select-field" style="width:100%;">
              <option value="real">Live — send to responsible departments</option>
              <option value="test">Test — send only to o.olasunkanmi@mixtafrica.com</option>
            </select>
          </div>
          <button class="btn-primary" onclick="triggerDeadlineCheck()" style="width:100%;">
              Run deadline check now
            </button>
            <div id="alert-result" style="display:none;margin-top:12px;"></div>
          </div>` : '<p style="font-size:12px;color:var(--text-muted);">Contact an admin to trigger a manual check.</p>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Alert thresholds</span></div>
        <div class="panel-body">
          <div class="threshold-row">
            <span class="leg-dot" style="background:#2563EB;flex-shrink:0;"></span>
            <div>
              <div style="font-size:13px;font-weight:500;">Daily countdown</div>
              <div style="font-size:12px;color:var(--text-muted);">Every active task with a deadline gets a daily email showing days remaining — not just a one-off warning starting 3 days out. A task with several dependencies needs longer visibility than 3 days can give it.</div>
            </div>
          </div>
          <div class="threshold-row">
            <span class="leg-dot leg-red" style="flex-shrink:0;"></span>
            <div>
              <div style="font-size:13px;font-weight:500;">Deadline day</div>
              <div style="font-size:12px;color:var(--text-muted);">Countdown reaches zero — flagged as due today</div>
            </div>
          </div>
          <div class="threshold-row">
            <span class="leg-dot" style="background:#7C3AED;flex-shrink:0;"></span>
            <div>
              <div style="font-size:13px;font-weight:500;">Overdue (daily)</div>
              <div style="font-size:12px;color:var(--text-muted);">Email sent every day the task remains overdue and incomplete</div>
            </div>
          </div>
          <div class="threshold-row">
            <span class="leg-dot leg-green" style="flex-shrink:0;"></span>
            <div>
              <div style="font-size:13px;font-weight:500;">Complete — no alert</div>
              <div style="font-size:12px;color:var(--text-muted);">Tasks marked complete are excluded from all alerts</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header">
        <span class="panel-title">Weekly report</span>
        <span style="font-size:11px;color:var(--text-muted);">For your Monday update</span>
      </div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:14px;">
          A rounded-up view of last week (Monday–Sunday) across every project you can see: what got completed, what slipped, what's still overdue coming into this week.
        </p>
        <button class="btn-primary" onclick="generateWeeklyReport()">Generate last week's report</button>
        <div id="weekly-report-output" style="margin-top:16px;"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Recent alerts sent</span>
        <span style="font-size:11px;color:var(--text-muted);">Last 20, across everything you have access to</span>
      </div>
      <div class="panel-body" id="deadline-status-list"><div class="loading-row">Loading...</div></div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Email schedule</span></div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:16px;">
          Deadline alerts and task digests now go out as <strong>one email per person</strong>, listing everything on their plate across all projects.
          Choose which weekdays it is sent. Saturday and Sunday are never sent. All times are WAT (West Africa Time).
          A change of days applies from the next run; a change of send time also needs the button below.
        </p>
        ${currentRole === 'admin' ? `
        <div class="form-row" style="margin-bottom:14px;">
          <label class="form-label">Send reminders on</label>
          <div id="alert-days-row" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${[['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri']].map(([v,l]) =>
              '<label style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;user-select:none;">' +
              '<input type="checkbox" class="alert-day-cb" value="' + v + '"> ' + l + '</label>').join('')}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Default is Mon, Wed, Fri. Emails are also limited to the working days set in Settings &rarr; Decision engine &mdash; working hours. To pause reminders completely, switch off Deadline alerts in Circuit Box.</div>
          <div id="alert-days-note" style="font-size:11px;color:#D97706;font-weight:500;margin-top:6px;display:none;"></div>
        </div>
        <div class="form-row" style="margin-bottom:16px;">
          <label class="form-label">Send time</label>
          <select id="alert-hour-sel" class="select-field" style="width:100%;">
            ${Array.from({length:24},(_,i)=>'<option value="'+i+'">'+(i===0?'12:00 AM':i<12?i+':00 AM':i===12?'12:00 PM':(i-12)+':00 PM')+'</option>').join('')}
          </select>
        </div>
        <button class="btn-primary" onclick="saveEmailSchedule()" style="width:100%;">Save schedule</button>
        <button class="btn-outline" onclick="sendMyTodoNow()" style="width:100%;margin-top:8px;">Send me my task list now</button>
        <div id="schedule-result" style="display:none;margin-top:10px;"></div>
        <div id="schedule-lastrun" style="font-size:11px;color:var(--text-muted);margin-top:10px;"></div>
        ` : '<p style="font-size:12px;color:var(--text-muted);">Only admins can change the email schedule.</p>'}
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">AI providers</span></div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:12px;">
          The Ask feature tries Groq, then Cerebras, then SambaNova. Model IDs are discovered
          at runtime, so a provider deprecating a model does not break anything.
          Run this to see exactly which models each key can reach.
        </p>
        <button class="btn-outline" id="ai-diag-btn" style="width:100%;font-size:12px;" onclick="runAIDiagnostic()">Test AI providers</button>
        <div id="ai-diag-result" style="display:none;margin-top:12px;"></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Task privacy</span></div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:14px;">
          Tasks are <strong>Private by default</strong> — visible only to the product owner and the task's own owners.
          A task assigned to a department stays visible to that department.
          Use these to change everything at once${currentRole === 'admin' ? ' (as an admin, this affects all tasks in the hub)' : ' (this affects only tasks you own)'}.
          Both directions are reversible.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-outline" id="bulk-private-btn" style="flex:1;min-width:180px;font-size:12px;" onclick="lockAllTasksToPrivate()">Lock all to Private</button>
          <button class="btn-outline" id="bulk-dept-btn" style="flex:1;min-width:180px;font-size:12px;" onclick="openAllTasksToDept()">Open all to my Department</button>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel-header">
        <span class="panel-title">GCCO read-only dashboard</span>
      </div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:16px;">
          Generate a secure, password-free link you can share with the GCCO or any senior stakeholder.
          It shows a live portfolio overview — active products, progress, overdue tasks, and launch timelines — with no login required.
          Each link is single-use; generating a new one invalidates the previous one.
        </p>
        ${currentRole === 'admin' ? `
        <button class="btn-primary" onclick="generateGCCOLink()" id="gcco-btn" style="width:100%;">Generate shareable link</button>
        <div id="gcco-result" style="display:none;margin-top:14px;"></div>
        ` : '<p style="font-size:12px;color:var(--text-muted);">Only admins can generate dashboard links.</p>'}
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Generate Progress Report</span></div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:16px;">
          Generates a structured progress report for the selected product and emails it to all onboarded stakeholders.
          Also logs the report to the Sheets audit trail.
        </p>
        ${currentRole === 'admin' ? `
        <div class="report-form">
          <div class="form-row">
            <label class="form-label">Product</label>
            <select id="report-product-sel" class="select-field" style="width:100%;"></select>
          </div>
          <div class="form-row">
            <label class="form-label">Report notes <span class="form-hint">— optional context to include</span></label>
            <textarea id="report-notes" class="input-field" rows="3" placeholder="e.g. Focus areas, escalations, key decisions this week..."></textarea>
          </div>
          <div class="form-row">
            <label class="form-label">Send mode</label>
            <select id="report-send-mode" class="select-field" style="width:100%;">
              <option value="real">Live — all onboarded stakeholders</option>
              <option value="test">Test — o.olasunkanmi@mixtafrica.com only</option>
            </select>
          </div>
          <button class="btn-primary" onclick="generateProgressReport()" style="width:100%;">Generate & email report</button>
          <div id="report-result" style="display:none;margin-top:12px;"></div>
        </div>` : '<p style="font-size:12px;color:var(--text-muted);">Contact an admin to generate a report.</p>'}
      </div>
    </div>`;

  if (currentRole === 'admin') setTimeout(loadReportProductList, 50);
  loadDeadlineStatus();
  if (currentRole === 'admin') { loadAlertProductList(); loadEmailSchedule(); }
}

async function loadAlertProductList() {
  const products = await getProductsFresh();
  const sel     = document.getElementById('alert-product-sel');
  if (!sel) return;
  Object.values(products).filter(p => p.status !== 'archived').forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

/* ══ WEEKLY REPORT — for the Monday update ═══════════════════
   Reuses the same per-task changelog (task.updates) that Edit-task,
   the approval workflow, and escalations all already write to — the
   report is a window onto that one existing history, not a second
   thing to maintain. Reuses isoWeekKey/weekKeyLabel from the personal
   tracker further up the file for the same "which week is this" logic. */
window.generateWeeklyReport = async () => {
  const out = document.getElementById('weekly-report-output');
  if (out) out.innerHTML = '<div class="loading-row">Compiling...</div>';
  try {
    const products = await getProductsFresh();
    const userKey = sanitiseEmail(currentUser.email);

    // Last week = the ISO week before the current one (Mon–Sun)
    const now = new Date();
    const dow = now.getDay() || 7;
    const lastWeekEnd = new Date(now);
    lastWeekEnd.setDate(now.getDate() - dow);
    lastWeekEnd.setHours(23, 59, 59, 999);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
    lastWeekStart.setHours(0, 0, 0, 0);

    const visible = Object.values(products).filter(p => p.status !== 'archived' && canUserSeeProduct(p, userKey));

    let completedCount = 0, delayedCount = 0, dependencyCount = 0;
    const byProject = [];

    visible.forEach(p => {
      const tasks = getProductTasks(p).filter(t => canViewTask(t, p));
      const events = [];
      tasks.forEach(t => {
        Object.values(t.updates || {}).forEach(u => {
          if (u.createdAt >= lastWeekStart.getTime() && u.createdAt <= lastWeekEnd.getTime()) {
            events.push({ task: t, entry: u });
            if (u.changeType === 'approval') completedCount++;
            if (u.changeType === 'delay') delayedCount++;
            if (u.changeType === 'dependency_change') dependencyCount++;
          }
        });
      });
      const stillOverdue = tasks.filter(t => resolveTaskStatus(t, p) === 'overdue');
      if (events.length > 0 || stillOverdue.length > 0) {
        events.sort((a, b) => a.entry.createdAt - b.entry.createdAt);
        byProject.push({ prod: p, events, stillOverdue });
      }
    });

    if (byProject.length === 0) {
      out.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:12px 0;">No logged changes or overdue items found for last week.</div>';
      return;
    }

    out.innerHTML =
      '<div style="font-size:12px;color:var(--text-mid);margin-bottom:14px;font-weight:600;">' +
        weekKeyLabel(isoWeekKey(lastWeekStart)) + ' — ' + completedCount + ' completed, ' + delayedCount + ' delayed, ' + dependencyCount + ' dependency change' + (dependencyCount !== 1 ? 's' : '') +
      '</div>' +
      byProject.map(({ prod, events, stillOverdue }) => (
        '<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border);">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px;">' + prod.name + '</div>' +
          events.map(({ task, entry }) => '<div style="font-size:12px;color:var(--text-mid);padding:2px 0;">• <strong>' + (task.title || task.name || 'Untitled') + '</strong> — ' + entry.text + '</div>').join('') +
          (stillOverdue.length ? '<div style="font-size:12px;color:var(--red);margin-top:6px;">Still overdue: ' + stillOverdue.map(t => t.title || t.name).join(', ') + '</div>' : '') +
        '</div>'
      )).join('') +
      '<button class="btn-outline" onclick="window.print()">Print / Save as PDF</button>';
  } catch(e) {
    if (out) out.innerHTML = '<div style="font-size:12px;color:var(--red);">Could not generate report: ' + e.message + '</div>';
  }
};

async function loadDeadlineStatus() {
  const el = document.getElementById('deadline-status-list');
  if (!el) return;
  try {
    const [products, logSnap] = await Promise.all([
      getProductsFresh(),
      get(ref(db, 'emailLog')),
    ]);
    const userKey  = sanitiseEmail(currentUser.email);
    const all      = [];

    if (logSnap.exists()) {
      Object.entries(logSnap.val()).forEach(([pid, entries]) => {
        const prod = products[pid];
        if (!prod || prod.status === 'archived') return;
        if (!canUserSeeProduct(prod, userKey)) return;
        const isOwnerOrAdmin = currentRole === 'admin' || isSuperAdmin || prod.ownerId === userKey;
        // Same rule as the dashboard's Recent Activity feed and the
        // per-product Comms tab — seeing the product isn't seeing every
        // alert logged for it; a task-scoped one needs real access to that task.
        Object.values(entries).forEach(e => {
          if (e.type !== 'deadline_alert') return; // this panel is specifically about the alert engine
          if (e.taskId) {
            const task = (prod.tasks && prod.tasks[e.taskId]) || (prod.pillars && prod.pillars[e.taskId]);
            if (!task || !canViewTask(task, prod)) return;
          } else if (!isOwnerOrAdmin) {
            return;
          }
          all.push(Object.assign({ productName: prod.name }, e));
        });
      });
    }

    if (all.length === 0) {
      el.innerHTML = '<div class="empty-state-sm"><span class="empty-icon" style="color:var(--green);">' + ICON.check_circle + '</span><p>No alerts sent yet, or none you have access to.</p></div>';
      return;
    }

    all.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
    el.innerHTML = all.slice(0, 20).map(a => {
      const when = a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      const subject = a.subject || (a.taskTitles && a.taskTitles[0]) || 'Deadline alert';
      const recipCount = (a.to || []).length;
      return `<div class="deadline-alert-row">
        <div class="deadline-alert-info">
          <div class="deadline-alert-pillar">${subject}</div>
          <div class="deadline-alert-product">${a.productName} &nbsp;·&nbsp; ${recipCount} recipient${recipCount !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-muted);">${when}</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="loading-row muted">Failed to load recent alerts.</div>';
  }
}

/* ══ PHASE 6: PROGRESS REPORTS ══════════════════════════════ */
async function loadReportProductList() {
  const prods = await getProductsFresh();
  const sel   = document.getElementById('report-product-sel');
  if (!sel) return;
  sel.innerHTML = '';
  Object.values(prods).filter(p => p.status !== 'archived').forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name; sel.appendChild(o);
  });
}

window.generateProgressReport = async () => {
  const productId = document.getElementById('report-product-sel')?.value;
  if (!productId) { showToast('Select a product.', 'error'); return; }

  const snap = await get(ref(db, `products/${productId}`));
  const prod = snap.val();
  if (!prod) { showToast('Product not found.', 'error'); return; }

  const tasks    = getProductTasks(prod);
  const complete = tasks.filter(t => t.status === 'complete').length;
  const pct      = Math.round((complete / (tasks.length || 1)) * 100);
  const recipients = prod.onboardedEmails?.length > 0
    ? prod.onboardedEmails
    : STAKEHOLDERS.filter(s => s.enabled !== false).map(s => s.email);

  // Read test mode BEFORE opening composer so the To/CC fields show correctly
  const reportTestMode = document.getElementById('report-send-mode')?.value === 'test';
  const composerTo = reportTestMode ? [TEST_EMAIL] : recipients;
  const composerCC = reportTestMode ? [] : (prod.defaultCCs || []);

  await openEmailComposer({
    type:        'report',
    subject:     `Progress Report: ${prod.name} — ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`,
    toEmails:    composerTo,
    ccEmails:    composerCC,
    productId,
    draftPrompt: buildProgressReportPrompt(prod, tasks, pct),
    onSend: async ({ subject, body, toEmails, ccEmails, testMode }) => {
      await callGAS('sendComposedEmail', { sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        subject, body, toEmails, ccEmails, testMode,
        productName: prod.name,
      });
      await set(ref(db, `products/${productId}/lastReportAt`), Date.now());
      await logActivity(productId, 'status', 'Progress report sent', `${pct}% complete`);
    },
  });
};

window.triggerDeadlineCheck = async () => {
  const btn = document.querySelector('.alert-manual-section .btn-primary');
  const resultEl = document.getElementById('alert-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
  if (resultEl) resultEl.style.display = 'none';

  try {
    const productId = document.getElementById('alert-product-sel')?.value || 'all';
    // Build alert payload from Firebase
    const products  = await getProductsFresh();
    const today     = new Date(); today.setHours(0,0,0,0);
    const alerts    = [];

    Object.values(products)
      .filter(p => p.status !== 'archived' && (productId === 'all' || p.id === productId))
      .forEach(prod => {
        // Use unified task system — handles both new tasks{} and legacy pillars{}
        const tasks = getProductTasks(prod);
        tasks.forEach(task => {
          if (!task.deadline || task.status === 'complete') return;
          const isDelayed = task.status === 'delayed';
          const due  = task.deadline ? new Date(task.deadline) : null;
          if (due) due.setHours(0,0,0,0);
          const diff = due ? Math.round((due - today) / 86400000) : null;

          // Send if: deadline overdue/approaching OR explicitly marked delayed
          const threshold = SYS_CONFIG.alertThresholdDays || 3;
          const deadlineAlert = due && diff !== null && diff <= threshold;
          if (!deadlineAlert && !isDelayed) return;

          // Skip if alerts disabled for this product
          if (prod.alertsEnabled === false) return;

          // Recipient priority:
          // 1. Manual alertRecipients set on the product
          // 2. Product owner's email
          // 3. Current logged-in user
          let deptEmails = [];
          if (prod.alertRecipients && prod.alertRecipients.length > 0) {
            deptEmails = prod.alertRecipients;
          } else {
            // Default: the product owner
            const ownerMember = TEAM_MEMBERS[prod.ownerId];
            if (ownerMember?.email) {
              deptEmails = [ownerMember.email];
            } else {
              deptEmails = [currentUser.email];
            }
          }

          alerts.push({
            productName: prod.name,
            productId:   prod.id,
            pillarName:  task.title || task.name,
            pillarId:    task.id,
            ownerDept:   task.owner || 'Unknown',
            deptEmails,
            daysUntil:   diff,
            deadline:    task.deadline,
            alertType:   diff < 0 ? 'overdue' : diff === 0 ? 'due' : 'warning',
            // Overdue tasks: include days count in every email
            daysOverdue: diff < 0 ? Math.abs(diff) : 0,
          });
        });
      });

    if (alerts.length === 0) {
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.className = 'alert-result-box alert-result-ok';
        resultEl.innerHTML = ICON.check_circle + ' No alerts to send — all pillars are on track.';
      }
    } else {
      const testMode = document.getElementById('alert-send-mode')?.value === 'test';
    const result = await callGAS('checkDeadlines', { alerts, testMode });
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.className = `alert-result-box ${result.ok ? 'alert-result-ok' : 'alert-result-err'}`;
        resultEl.innerHTML = result.ok
          ? ICON.check_circle + ` ${result.sent || alerts.length} alert email${(result.sent||alerts.length)>1?'s':''} sent.`
          : `❌ Error: ${result.error}`;
      }
      loadDeadlineStatus();
    }
  } catch(e) {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.className = 'alert-result-box alert-result-err';
      resultEl.innerHTML = '❌ ' + e.message;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Run deadline check now'; }
};

window.sendMyTodoNow = async () => {
  showToast('Sending your task list...', 'info');
  try {
    const result = await callGAS('sendTodoDigest', { email: currentUser.email });
    if (result.ok) showToast('Task digest sent to ' + currentUser.email, 'success');
    else showToast('Failed: ' + (result.error || 'unknown'), 'error');
  } catch(e) { showToast('Could not reach GAS backend', 'error'); }
};

window.runAIDiagnostic = async () => {
  const btn = document.getElementById('ai-diag-btn');
  const out = document.getElementById('ai-diag-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
  if (out) { out.style.display = 'block'; out.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Querying each provider...</div>'; }

  const rows = [];
  for (const p of AI_PROVIDERS) {
    if (!providerConfigured(p)) {
      rows.push({ name: p.name, state: 'nokey', detail: 'No API key set in deployment secrets' });
      continue;
    }
    try {
      const resp = await fetch(p.base + '/models', { headers: { 'Authorization': 'Bearer ' + p.key() } });
      if (!resp.ok) {
        rows.push({ name: p.name, state: 'fail', detail: 'HTTP ' + resp.status + (resp.status === 401 ? ' — key rejected' : '') });
        continue;
      }
      const data = await resp.json();
      const ids  = (data.data || []).map(m => m.id).filter(Boolean);
      delete _aiModelCache[p.name];
      let chosen = '(none)';
      try { chosen = await discoverModel(p); } catch(e) {}
      rows.push({ name: p.name, state: 'ok', chosen, count: ids.length, sample: ids.slice(0, 6) });
    } catch(err) {
      rows.push({ name: p.name, state: 'fail', detail: err.message });
    }
  }

  const colour = { ok: '#16A34A', fail: '#C0282D', nokey: '#9CA3AF' };
  const label  = { ok: 'REACHABLE', fail: 'FAILED', nokey: 'NOT CONFIGURED' };
  out.innerHTML = rows.map(r =>
    '<div style="border:1px solid var(--border);border-left:3px solid ' + colour[r.state] +
      ';border-radius:8px;padding:10px 14px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (r.state === 'ok' ? '5px' : '0') + ';">' +
        '<span style="font-size:12px;font-weight:700;color:var(--text);">' + r.name + '</span>' +
        '<span style="font-size:9px;font-weight:700;color:' + colour[r.state] + ';background:' + colour[r.state] + '15;padding:1px 7px;border-radius:8px;">' + label[r.state] + '</span>' +
      '</div>' +
      (r.state === 'ok'
        ? '<div style="font-size:11px;color:var(--text);">Will use: <strong>' + r.chosen + '</strong></div>' +
          '<div style="font-size:10px;color:#9CA3AF;margin-top:2px;">' + r.count + ' models available · ' + r.sample.join(', ') + (r.count > 6 ? ' …' : '') + '</div>'
        : '<div style="font-size:11px;color:#6B7280;">' + (r.detail || '') + '</div>') +
    '</div>'
  ).join('');

  const anyOk = rows.some(r => r.state === 'ok');
  out.innerHTML += '<div style="font-size:11px;color:' + (anyOk ? '#16A34A' : '#C0282D') + ';font-weight:500;margin-top:4px;">' +
    (anyOk ? 'Ask is working — at least one provider is reachable.' : 'Ask will not work until at least one provider is reachable.') + '</div>';

  if (btn) { btn.disabled = false; btn.textContent = 'Test AI providers'; }
};

window.saveEmailSchedule = async () => {
  const btn = document.querySelector('button[onclick="saveEmailSchedule()"]');

  const alertHour = parseInt(document.getElementById('alert-hour-sel')?.value || '7');
  // Weekdays only (1=Mon..5=Fri). The backend also refuses weekends, so this is belt and braces.
  const alertDays = Array.from(document.querySelectorAll('.alert-day-cb:checked'))
    .map(cb => parseInt(cb.value)).filter(d => d >= 1 && d <= 5).sort((a, b) => a - b);

  if (alertDays.length === 0) {
    showToast('Pick at least one weekday. To pause reminders entirely, switch off Deadline alerts in Circuit Box.', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing to Google Cloud...'; }

  try {
    // update(), not set(): the backend keeps its own lastRunDate marker in this
    // same node, and set() would wipe it and re-open the door to a same-day resend.
    await update(ref(db, 'config/emailSchedule'), { alertHour, alertDays, updatedAt: Date.now(), updatedBy: currentUser.email });

    // Rebuild the Google trigger so a changed send time takes effect
    const resGas = await callGAS('updateTriggers', {});

    const res = document.getElementById('schedule-result');
    if (res) {
      res.style.display = 'block';
      if (resGas.ok) {
        res.innerHTML = '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:10px 14px;font-size:12px;color:#16A34A;font-weight:500;">Saved. Reminders will go out on ' + alertDays.map(d => ['','Mon','Tue','Wed','Thu','Fri'][d]).join(', ') + '.</div>';
      } else {
        res.innerHTML = '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;font-size:12px;color:#D97706;font-weight:500;">Days saved and will apply from the next run, but the send-time trigger could not be rebuilt: ' + resGas.error + '</div>';
      }
    }
    showToast('Reminder schedule saved.', 'success');
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save schedule'; }
};

async function loadEmailSchedule() {
  const paint = (days, hour) => {
    document.querySelectorAll('.alert-day-cb').forEach(cb => { cb.checked = days.includes(parseInt(cb.value)); });
    const ah = document.getElementById('alert-hour-sel');
    if (ah) ah.value = hour;
  };
  paint([1, 3, 5], 7);                       // defaults, shown even if nothing has been saved yet

  // Working days from Settings act as a ceiling for email. Warn when a ticked day is switched off there.
  const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let workDays = null;
  try {
    const wdSnap = await get(ref(db, 'config/orgContext/workDays'));
    const wd = wdSnap.exists() ? Object.values(wdSnap.val() || {}).map(Number) : [];
    if (wd.length) workDays = wd;
  } catch(e) { /* no ceiling known: leave the warning off */ }
  const refreshNote = () => {
    const note = document.getElementById('alert-days-note');
    if (!note) return;
    const blocked = !workDays ? [] : Array.from(document.querySelectorAll('.alert-day-cb:checked'))
      .map(cb => parseInt(cb.value)).filter(d => !workDays.includes(d));
    note.style.display = blocked.length ? 'block' : 'none';
    note.textContent = blocked.length
      ? blocked.map(d => DAY_NAMES[d]).join(', ') + ' will not send: switched off in Settings \u2192 Decision engine \u2014 working hours.'
      : '';
  };
  document.getElementById('alert-days-row')?.addEventListener('change', refreshNote);
  try {
    const snap = await get(ref(db, 'config/emailSchedule'));
    if (!snap.exists()) { refreshNote(); return; }
    const s = snap.val();
    // Firebase can hand a sparse array back as an object, so normalise both shapes
    let days = Array.isArray(s.alertDays) ? s.alertDays : Object.values(s.alertDays || {});
    days = days.map(Number).filter(d => d >= 1 && d <= 5);
    paint(days.length ? days : [1, 3, 5], s.alertHour ?? 7);
    refreshNote();
    const lr = document.getElementById('schedule-lastrun');
    if (lr && s.lastRunDate) lr.textContent = 'Last reminder run: ' + s.lastRunDate;
  } catch(e) { /* settings not yet saved */ }
}

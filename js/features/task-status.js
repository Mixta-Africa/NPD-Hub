/* features/task-status.js — Status dropdown, delayed-task notifications, unblocked dates. */

import { db, ref, set } from '../core/firebase.js';
import { currentPreferredName, currentUser, currentView } from '../core/state.js';
import { STAKEHOLDERS } from '../data/app-config.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { formatDate } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { buildPillarDetail } from '../views/product-detail.js';
import { logEmailSent } from './email-log.js';
import { renderTrackerTable, trackerProductsCache } from '../views/tracker.js';
import { openEmailComposer } from './email-composer.js';
import { logActivity } from './activity.js';

/* ── Smart status dropdown ── */
window.openStatusDropdown = (productId, taskId, badgeEl) => {
  document.querySelectorAll('.status-dropdown-menu').forEach(d => d.remove());
  const prod  = trackerProductsCache[productId] || productListCache[productId];
  const tasks = getProductTasks(prod);
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  const options = [
    { value: 'on-track', label: 'On Track', color: 'var(--green)' },
    { value: 'delayed',  label: 'Delayed',  color: 'var(--amber)' },
    { value: 'deprioritized', label: 'Stepped down', color: '#6B7280' },
    { value: 'complete', label: 'Complete', color: 'var(--blue)'  },
  ];

  const menu = document.createElement('div');
  menu.className = 'status-dropdown-menu';
  menu.innerHTML = options.map(o => `
    <div class="status-dropdown-item ${task.status === o.value ? 'sdi-active' : ''}"
         onclick="selectTaskStatus('${productId}','${taskId}','${o.value}',this)">
      <span class="sdi-dot" style="background:${o.color};"></span>
      <span>${o.label}</span>
      ${task.status === o.value ? '<span class="sdi-current">current</span>' : ''}
    </div>`).join('');

  const rect = badgeEl.getBoundingClientRect();
  menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;z-index:9000;min-width:140px;`;
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function closer(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closer); }
    });
  }, 10);
};

window.selectTaskStatus = async (productId, taskId, newStatus, itemEl) => {
  itemEl.closest('.status-dropdown-menu')?.remove();
  await updatePillarStatus(productId, taskId, newStatus);
};

/* ══ DELAYED TASK NOTIFICATION ══════════════════════════════ */
export async function sendDelayedTaskNotification(productId, taskId, task, prod) {
  if (!task) return;

  // Determine recipients — task owner dept first, then product alerts, then current user
  const ownerEmails = (() => {
    if (task.ownerEmails?.length > 0) return task.ownerEmails;
    const deptMatch = STAKEHOLDERS.filter(s =>
      s.enabled !== false && s.dept === task.owner
    ).map(s => s.email);
    if (deptMatch.length > 0) return deptMatch;
    return prod.alertRecipients?.length > 0
      ? prod.alertRecipients
      : [currentUser.email];
  })();

  const today = new Date(); today.setHours(0,0,0,0);
  const due   = task.deadline ? new Date(task.deadline) : null;
  if (due) due.setHours(0,0,0,0);
  const daysOverdue = due && due < today ? Math.round((today - due) / 86400000) : 0;
  const daysUntil   = due ? Math.round((due - today) / 86400000) : null;

  const deadlineContext = !due ? 'No deadline set.'
    : daysOverdue > 0 ? `Deadline was ${daysOverdue} day${daysOverdue!==1?'s':''} ago (${task.deadline}).`
    : daysUntil === 0 ? `Deadline is today (${task.deadline}).`
    : `Deadline in ${daysUntil} day${daysUntil!==1?'s':''} (${task.deadline}).`;

  const prompt = `Write a concise notification email that a task has just been marked as DELAYED.

Product: ${prod.name} (target launch: ${prod.launchDate})
Task: ${task.title || task.name}
Owner department: ${task.owner || 'unassigned'}
${deadlineContext}
${task.notes ? `Last note on this task: "${task.notes}"` : ''}

Write 2 short paragraphs:
1. State that this task has been flagged as delayed, include the specific context above
2. Ask for: (a) the reason for the delay, (b) a revised completion date, (c) whether any other tasks are impacted

Tone: professional, direct, not accusatory. This is a coordination message, not a complaint.`;

  await openEmailComposer({
    type:            'reminder',
    subject:         `[Delayed] ${task.title || task.name} — ${prod.name}`,
    toEmails:        ownerEmails,
    ccEmails:        prod.defaultCCs || [],
    productId,
    isThreadStarter: false,
    draftPrompt:     prompt,
    onSend: async ({ subject, body, toEmails, ccEmails, testMode }) => {
      const threadId = prod.gmailThreadId;
      if (threadId) {
        await callGAS('replyToThread', {
          threadId, emailBody: body, subject, toEmails, ccEmails,
          testMode, productName: prod.name, sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        });
      } else {
        await callGAS('sendComposedEmail', {
          subject, body, toEmails, ccEmails, testMode,
          productName: prod.name, sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        });
      }
      await logEmailSent(productId, {
        type: 'delayed', subject, to: toEmails, cc: ccEmails || [],
        taskTitles: [task.title || task.name], taskId: task.id,
      });
      await logActivity(productId, 'status',
        `Delay notification sent: ${task.title || task.name}`,
        `To: ${toEmails.join(', ')}`
      );
    },
  });
}

/* ══ UNBLOCK & SCHEDULE ENGINE ════════════════════════════════ */
window.showUnblockedModal = (productId, unblockedTasks) => {
  let modal = document.getElementById('unblocked-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'unblocked-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    document.body.appendChild(modal);
  }
  
  const rows = unblockedTasks.map(t => `
    <div style="margin-bottom:12px;background:#FAFAF9;padding:12px;border:1px solid var(--border);border-radius:8px;">
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;color:var(--text);">${t.title || t.name}</label>
      <input type="date" id="ub-date-${t.id}" class="input-field" style="width:100%;border-color:#16A34A;" />
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:100%;max-width:420px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
      <div style="background:#16A34A;padding:20px 24px;">
        <div style="color:white;font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          Deliverables Unblocked!
        </div>
      </div>
      <div style="padding:24px;">
        <p style="font-size:13px;color:#6B7280;margin-bottom:20px;line-height:1.6;">
          You just cleared a bottleneck. The following tasks are now fully unblocked and ready to be scheduled.
        </p>
        <div style="max-height:300px;overflow-y:auto;padding-right:4px;">
          ${rows}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
          <button class="btn-outline" onclick="document.getElementById('unblocked-modal').style.display='none'">Skip for now</button>
          <button class="btn-primary" style="background:#16A34A;border-color:#16A34A;" onclick="saveUnblockedDates('${productId}', '${unblockedTasks.map(t=>t.id).join(',')}')">Save deadlines</button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
};

window.saveUnblockedDates = async (productId, taskIdsStr) => {
  const btn = document.querySelector('#unblocked-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  
  const taskIds = taskIdsStr.split(',');
  const prod = productListCache[productId] || trackerProductsCache[productId];
  if (!prod) return;

  let updatesCount = 0;
  for (const tId of taskIds) {
    const input = document.getElementById('ub-date-' + tId);
    if (input && input.value) {
      const newDate = input.value;
      const isNewFormat = !!prod.tasks?.[tId];
      const path = isNewFormat ? `tasks/${tId}` : `pillars/${tId}`;
      
      await set(ref(db, `products/${productId}/${path}/deadline`), newDate);
      
      if (isNewFormat) prod.tasks[tId].deadline = newDate;
      else prod.pillars[tId].deadline = newDate;

      const taskTitle = isNewFormat ? prod.tasks[tId].title : prod.pillars[tId].name;
      await logActivity(productId, 'date_change', `Scheduled newly unblocked task: ${taskTitle}`, `Set to: ${formatDate(newDate)}`);
      updatesCount++;
    }
  }

  document.getElementById('unblocked-modal').style.display = 'none';
  if (updatesCount > 0) {
    showToast(`${updatesCount} deadline(s) scheduled.`, 'success');
    
    // Refresh the UI to show the new dates instantly
    const container = document.getElementById('product-detail-body');
    if (container) container.innerHTML = buildPillarDetail(prod);
    
    if (currentView === 'tracker') {
      if (typeof renderTrackerTable === 'function') renderTrackerTable(prod, null);
    }
  }
};

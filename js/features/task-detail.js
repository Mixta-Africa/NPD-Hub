/* features/task-detail.js — Task detail panel, edit-task with changelog, delay reasons, AMC escalation. */

import { db, ref, set } from '../core/firebase.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { canEdit, getTaskVisibility, taskOwnerList } from '../data/permissions.js';
import { ownerLabel } from './task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { ensureProductModal } from './product-form.js';
import { pushSheetIfLinked } from './export-sheet.js';
import { buildPillarDetail } from '../views/product-detail.js';
import { logActivity } from './activity.js';

/* ══ TASK DETAIL — the full assessment view ═══════════════════
   Everything known about one task in one place: who owns it, when it
   was created, its full changelog (not just the last few entries the
   Quick Update history caps at), what it's waiting on and what's
   waiting on it, and a straight line into editing it. This is the
   "click a task, see everything about it" view. */
window.showTaskDetailPanel = (productId, taskId) => {
  ensureProductModal();
  const prod = productListCache[productId];
  const task = prod && getProductTasks(prod).find(t => t.id === taskId);
  if (!prod || !task) { showToast('Task not found.', 'error'); return; }

  const effStatus = resolveTaskStatus(task, prod);
  const smeta = STATUS_META[effStatus] || STATUS_META['on-track'];
  const allTasks = getProductTasks(prod);

  const waitingOn = (task.predecessors || []).map(pid => allTasks.find(t => t.id === pid)).filter(Boolean);
  const blocks = allTasks.filter(t => (t.predecessors || []).includes(taskId));

  const owners = taskOwnerList(task);
  const ownerText = owners.length ? owners.map(o => ownerLabel(o)).join(', ') : 'Unassigned';

  const createdWhen = task.createdAt ? new Date(task.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Not recorded';
  const createdByName = task.createdBy ? task.createdBy.split('@')[0] : 'Not recorded';

  const historyEntries = task.updates ? Object.values(task.updates).sort((a, b) => b.createdAt - a.createdAt) : [];
  const TAG = {
    delay: { label: 'DELAY', color: 'var(--red)' },
    deadline_change: { label: 'DATE CHANGE', color: '#D97706' },
    dependency_change: { label: 'DEPENDENCY', color: '#2563EB' },
    approval: { label: 'APPROVED', color: 'var(--green)' },
    rejection: { label: 'REJECTED', color: 'var(--text-muted)' },
  };
  const historyHtml = historyEntries.length === 0
    ? '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No changes logged yet.</div>'
    : historyEntries.map(e => {
        const when = new Date(e.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const tag = TAG[e.changeType];
        const tagHtml = tag ? '<span style="font-size:8px;font-weight:700;letter-spacing:.04em;color:' + tag.color + ';border:1px solid ' + tag.color + ';border-radius:3px;padding:0 4px;margin-right:6px;flex-shrink:0;">' + tag.label + '</span>' : '';
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
          '<div style="display:flex;align-items:flex-start;gap:0;"><div>' + tagHtml + '</div><div style="flex:1;"><strong style="color:var(--text);">' + (e.userName || 'Someone') + '</strong> <span style="color:var(--text-muted);">· ' + when + '</span><div style="color:var(--text-mid);margin-top:2px;">' + e.text + '</div></div></div>' +
        '</div>';
      }).join('');

  const pendingReqHtml = task.pendingRequest
    ? '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#92400E;">' +
        '<strong>Awaiting approval:</strong> ' + (task.pendingRequest.requestedByName || '') + ' ' +
        (task.pendingRequest.type === 'extend' ? 'requested a new deadline of ' + formatDate(task.pendingRequest.proposedDeadline) : 'marked this done') +
        '. "' + (task.pendingRequest.comment || '') + '"' +
      '</div>'
    : '';

  document.getElementById('modal-title-text').textContent = task.title || task.name || 'Task detail';
  document.getElementById('modal-body-content').innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">' +
      '<span class="pcf-pill" style="background:' + smeta.color + '18;color:' + smeta.color + ';text-transform:uppercase;">' + smeta.label + '</span>' +
      (getTaskVisibility(task) !== 'public' ? '<span class="pcf-pill pcf-pill-grey">' + getTaskVisibility(task).toUpperCase() + '</span>' : '') +
      '<button class="btn-outline" style="margin-left:auto;font-size:11px;padding:5px 12px;" onclick="showEditTask(\'' + productId + '\',\'' + taskId + '\')">Edit task</button>' +
      (canEdit(prod) ? '<button class="btn-outline" style="font-size:11px;padding:5px 12px;color:#7C2D12;border-color:#7C2D12;" onclick="showEscalateToAMCModal(\'' + productId + '\',\'' + taskId + '\')" title="Manual and discretionary — never sent automatically">Escalate to AMC</button>' : '') +
    '</div>' +
    pendingReqHtml +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
      '<div class="settings-row" style="border:none;padding:0;flex-direction:column;align-items:flex-start;gap:2px;"><div class="settings-label">Owner</div><div class="settings-value" style="font-size:12px;">' + ownerText + '</div></div>' +
      '<div class="settings-row" style="border:none;padding:0;flex-direction:column;align-items:flex-start;gap:2px;"><div class="settings-label">Department</div><div class="settings-value" style="font-size:12px;">' + (task.ownerDept || '—') + '</div></div>' +
      '<div class="settings-row" style="border:none;padding:0;flex-direction:column;align-items:flex-start;gap:2px;"><div class="settings-label">Deadline</div><div class="settings-value" style="font-size:12px;">' + (task.deadline ? formatDate(task.deadline) : 'No date set') + '</div></div>' +
      '<div class="settings-row" style="border:none;padding:0;flex-direction:column;align-items:flex-start;gap:2px;"><div class="settings-label">Created</div><div class="settings-value" style="font-size:12px;">' + createdWhen + (task.createdBy ? ' by ' + createdByName : '') + '</div></div>' +
    '</div>' +
    (task.notes ? '<div style="margin-bottom:16px;"><div class="settings-label" style="margin-bottom:4px;">Notes</div><div style="font-size:12px;color:var(--text-mid);background:var(--bg);border-radius:8px;padding:10px 12px;">' + task.notes.replace(/</g,'&lt;') + '</div></div>' : '') +
    (waitingOn.length || blocks.length ? '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">' +
      (waitingOn.length ? '<div style="flex:1;min-width:160px;"><div class="settings-label" style="margin-bottom:4px;">Waiting on</div>' + waitingOn.map(t => '<div style="font-size:12px;color:var(--text-mid);padding:2px 0;">→ ' + (t.title || t.name) + '</div>').join('') + '</div>' : '') +
      (blocks.length ? '<div style="flex:1;min-width:160px;"><div class="settings-label" style="margin-bottom:4px;">Blocking</div>' + blocks.map(t => '<div style="font-size:12px;color:var(--text-mid);padding:2px 0;">→ ' + (t.title || t.name) + '</div>').join('') + '</div>' : '') +
    '</div>' : '') +
    '<div class="settings-label" style="margin-bottom:6px;">Full history</div>' +
    '<div style="max-height:220px;overflow-y:auto;">' + historyHtml + '</div>' +
    '<div class="form-actions" style="margin-top:16px;"><button class="btn-outline" onclick="closeProductModal()">Close</button></div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

// Manual, discretionary AMC escalation — never fires on its own, unlike
// the 5-day automatic team-lead escalation the backend handles for you.
window.showEscalateToAMCModal = (productId, taskId) => {
  ensureProductModal();
  const prod = productListCache[productId];
  const task = prod && getProductTasks(prod).find(t => t.id === taskId);
  if (!prod || !task) return;

  document.getElementById('modal-title-text').textContent = 'Escalate to AMC';
  document.getElementById('modal-body-content').innerHTML =
    '<p style="font-size:13px;color:var(--text-mid);margin-bottom:14px;line-height:1.6;">' +
      'This sends an email to everyone listed under the AMC department in Circuit Box. It is entirely at your discretion — nothing about this happens automatically.' +
    '</p>' +
    '<div class="form-row"><label class="form-label">Note <span class="form-hint">— optional context for AMC</span></label>' +
      '<textarea id="amc-esc-note" class="input-field" rows="3" placeholder="e.g. This has been overdue for two weeks with no clear path to resolution"></textarea></div>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" style="background:#7C2D12;" onclick="submitEscalateToAMC(\'' + productId + '\',\'' + taskId + '\')">Send to AMC</button>' +
    '</div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.submitEscalateToAMC = async (productId, taskId) => {
  const note = document.getElementById('amc-esc-note')?.value.trim() || '';
  try {
    const res = await callGAS('escalateToAMC', {
      productId, taskId, note,
      escalatedBy: currentUser.email,
      escalatedByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
    });
    if (res && res.ok) {
      closeProductModal();
      showToast('Escalated to ' + res.sent + ' AMC member' + (res.sent !== 1 ? 's' : '') + '.', 'success');
    } else {
      showToast(res?.error || 'Could not escalate.', 'error');
    }
  } catch(e) {
    showToast('Could not escalate: ' + e.message, 'error');
  }
};

/* ══ EDIT TASK — with a real, permanent changelog ═════════════
   Reuses the same task.updates node the Quick Update note history
   already writes to (one track record per task, not two parallel
   ones). A deadline pushed BACK is treated as a delay specifically —
   it can't be saved without a reason, and that reason is what makes
   this useful for diagnosing failure points later, not just knowing
   a date moved. */
window.showEditTask = (productId, taskId) => {
  ensureProductModal();
  const prod = productListCache[productId];
  if (!prod || !canEdit(prod)) {
    showToast('Only the owner or an admin can edit tasks.', 'error');
    return;
  }
  const task = getProductTasks(prod).find(t => t.id === taskId);
  if (!task) return;

  const otherTasks = getProductTasks(prod).filter(t => t.id !== taskId);
  const preds = task.predecessors || [];
  const predOptions = otherTasks.map(t =>
    '<option value="' + t.id + '"' + (preds.includes(t.id) ? ' selected' : '') + '>' + (t.title || t.name || 'Untitled') + '</option>'
  ).join('');

  document.getElementById('modal-title-text').textContent = 'Edit task';
  document.getElementById('modal-body-content').innerHTML =
    '<div class="form-row"><label class="form-label">Task name <span class="req">*</span></label>' +
      '<input type="text" id="et-title" class="input-field" value="' + (task.title || task.name || '').replace(/"/g,'&quot;') + '"/></div>' +
    '<div class="form-row"><label class="form-label">Depends on <span class="form-hint">— hold Ctrl/Cmd for multiple</span></label>' +
      '<select id="et-preds" class="select-field" multiple style="height:60px;font-size:12px;">' + predOptions + '</select>' +
    '</div>' +
    '<div class="form-row"><label class="form-label">Deadline</label>' +
      '<input type="date" id="et-deadline" class="input-field" value="' + (task.deadline || '') + '"/></div>' +
    '<div class="form-row"><label class="form-label">Notes</label>' +
      '<textarea id="et-notes" class="input-field" rows="2">' + (task.notes || '').replace(/</g,'&lt;') + '</textarea></div>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveTaskEdits(\'' + productId + '\',\'' + taskId + '\')">Save changes</button>' +
    '</div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.saveTaskEdits = async (productId, taskId) => {
  const prod = productListCache[productId];
  const task = getProductTasks(prod).find(t => t.id === taskId);
  if (!prod || !task) return;

  const newTitle = document.getElementById('et-title')?.value.trim();
  const newDeadline = document.getElementById('et-deadline')?.value || '';
  const newNotes = document.getElementById('et-notes')?.value.trim() || '';
  const predSelect = document.getElementById('et-preds');
  const newPreds = predSelect ? Array.from(predSelect.selectedOptions).map(o => o.value).filter(v => v) : [];

  if (!newTitle) { showToast('Task name required.', 'error'); return; }

  const oldDeadline = task.deadline || '';
  const oldPreds = (task.predecessors || []).slice();
  const isPushedBack = oldDeadline && newDeadline && newDeadline > oldDeadline;
  const fields = { newTitle, newDeadline, newNotes, newPreds, oldDeadline, oldPreds };

  if (isPushedBack) {
    showDelayReasonModal(productId, taskId, fields);
    return;
  }
  await applyTaskEdits(productId, taskId, Object.assign({ delayReason: '' }, fields));
};

function showDelayReasonModal(productId, taskId, fields) {
  window._pendingTaskEdit = fields;
  document.getElementById('modal-title-text').textContent = 'Reason for delay';
  document.getElementById('modal-body-content').innerHTML =
    '<p style="font-size:13px;color:var(--text-mid);margin-bottom:14px;line-height:1.6;">' +
      'This pushes the deadline back from <strong>' + (fields.oldDeadline ? formatDate(fields.oldDeadline) : 'no date') + '</strong> to <strong>' + formatDate(fields.newDeadline) + '</strong>. ' +
      'This gets logged permanently on the task, so the cause is on record for later.</p>' +
    '<div class="form-row"><label class="form-label">What caused this delay? <span class="req">*</span></label>' +
      '<textarea id="delay-reason-input" class="input-field" rows="3" placeholder="e.g. Awaiting legal sign-off on the survey report"></textarea></div>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" style="background:var(--red);" onclick="confirmDelayedTaskEdit(\'' + productId + '\',\'' + taskId + '\')">Log delay &amp; save</button>' +
    '</div>';
}

window.confirmDelayedTaskEdit = async (productId, taskId) => {
  const reason = document.getElementById('delay-reason-input')?.value.trim();
  if (!reason) { showToast('A reason is required to log this delay.', 'error'); return; }
  const fields = window._pendingTaskEdit;
  window._pendingTaskEdit = null;
  if (!fields) return;
  await applyTaskEdits(productId, taskId, Object.assign({ delayReason: reason }, fields));
};

async function applyTaskEdits(productId, taskId, f) {
  const prod = productListCache[productId];
  const task = getProductTasks(prod).find(t => t.id === taskId);
  if (!prod || !task) return;

  const path = prod.tasks?.[taskId] ? 'tasks/' + taskId : 'pillars/' + taskId;
  const base = 'products/' + productId + '/' + path;

  await set(ref(db, base + '/title'), f.newTitle);
  await set(ref(db, base + '/deadline'), f.newDeadline);
  await set(ref(db, base + '/notes'), f.newNotes);
  await set(ref(db, base + '/predecessors'), f.newPreds);
  task.title = f.newTitle;
  task.deadline = f.newDeadline;
  task.notes = f.newNotes;
  task.predecessors = f.newPreds;

  // One changelog entry per genuine structural change — same node the
  // Quick Update note history writes to, tagged by changeType so a delay
  // is distinguishable from a routine edit at a glance.
  const who = currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0];
  const entries = [];

  if (f.oldDeadline !== f.newDeadline) {
    if (f.delayReason) {
      entries.push({
        changeType: 'delay',
        text: 'Deadline pushed from ' + (f.oldDeadline ? formatDate(f.oldDeadline) : 'no date') + ' to ' + formatDate(f.newDeadline) + '. Reason: ' + f.delayReason,
      });
    } else {
      entries.push({
        changeType: 'deadline_change',
        text: 'Deadline changed from ' + (f.oldDeadline ? formatDate(f.oldDeadline) : 'no date') + ' to ' + (f.newDeadline ? formatDate(f.newDeadline) : 'no date') + '.',
      });
    }
  }

  const oldPredsSorted = f.oldPreds.slice().sort().join(',');
  const newPredsSorted = f.newPreds.slice().sort().join(',');
  if (oldPredsSorted !== newPredsSorted) {
    const nameOf = (id) => { const t = getProductTasks(prod).find(x => x.id === id); return t ? (t.title || t.name || id) : id; };
    entries.push({
      changeType: 'dependency_change',
      text: 'Dependencies changed from [' + (f.oldPreds.map(nameOf).join(', ') || 'none') + '] to [' + (f.newPreds.map(nameOf).join(', ') || 'none') + '].',
    });
  }

  for (const entry of entries) {
    const updateId = 'upd_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const record = { id: updateId, text: entry.text, changeType: entry.changeType, userEmail: currentUser.email, userName: who, createdAt: Date.now() };
    await set(ref(db, base + '/updates/' + updateId), record);
    if (!task.updates) task.updates = {};
    task.updates[updateId] = record;
  }

  if (entries.length) {
    await logActivity(productId, entries.some(e => e.changeType === 'delay') ? 'task_delayed' : 'task_edited',
      (entries.some(e => e.changeType === 'delay') ? 'Delay logged: ' : 'Task edited: ') + f.newTitle,
      entries.map(e => e.text).join(' '));
  }

  closeProductModal();
  showToast('Task updated.', 'success');
  const body = document.getElementById('product-detail-body');
  if (body) body.innerHTML = buildPillarDetail(prod);
  pushSheetIfLinked(productId);
}

;

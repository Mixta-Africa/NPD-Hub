/* features/task-actions.js — Delete, move, reorder, reassign and spin out tasks. */

import { db, get, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { DEPARTMENTS, getDepts, set_DEPARTMENTS, set_STAKEHOLDERS } from '../data/app-config.js';
import { canEdit, canViewTask } from '../data/permissions.js';
import { buildOwnerIndividualOptions, ownerLabel } from './task-editor.js';
import { generateId, getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { productListCache } from '../data/products-cache.js';
import { loadProductList } from '../views/products.js';
import { buildPillarDetail } from '../views/product-detail.js';
import { logActivity } from './activity.js';

window.deleteProductTask = async (productId, taskId) => {
  const permCheck = productListCache[productId];
  if (!permCheck || !canEdit(permCheck)) {
    showToast('Only the owner or an admin can delete tasks on this item.', 'error');
    return;
  }

  // Elevated-risk safety gate.
  // Matches on ownerDept only — the previous version also did a substring
  // match on the owner NAME, which fires falsely on any person whose name
  // happens to contain the department string. Same fuzzy-matching class of
  // bug we removed from email routing.
  const t = getProductTasks(permCheck).find(x => x.id === taskId);
  const HIGH_RISK_DEPTS = ['AMC'];
  const isHighRisk = t && t.ownerDept && HIGH_RISK_DEPTS.includes(t.ownerDept);

  showDeleteTaskConfirm(productId, taskId, t?.title || t?.name || 'this task', isHighRisk);
};

// A real modal, not the native confirm() — a browser dialog is too easy to
// blow past with reflexive Enter/click, which defeats the point of a guard
// against accidental deletion. Requires a deliberate click on the red button.
function showDeleteTaskConfirm(productId, taskId, taskTitle, isHighRisk) {
  let modal = document.getElementById('delete-task-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'delete-task-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:2100;padding:20px;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:420px;box-shadow:var(--shadow-lg);overflow:hidden;">
      <div style="padding:24px 24px 0;text-align:center;">
        <div style="width:48px;height:48px;border-radius:50%;background:var(--red-light);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </div>
        <div style="font-size:15px;font-weight:700;color:#1A1A1A;margin-bottom:6px;">Delete "${(taskTitle || '').replace(/"/g,'&quot;')}"?</div>
        <div style="font-size:12.5px;color:var(--text-mid);line-height:1.6;">
          ${isHighRisk
            ? 'This is an <strong>AMC task</strong> — deleting it cannot be undone, and it will disappear from anyone it was shared with.'
            : 'This cannot be undone, and it will disappear from anyone it was shared with.'}
        </div>
      </div>
      <div style="display:flex;gap:8px;padding:20px 24px 24px;">
        <button class="btn-outline" style="flex:1;" onclick="closeDeleteTaskConfirm()">Cancel</button>
        <button class="btn-primary" style="flex:1;background:var(--red);" onclick="confirmDeleteTask('${productId}','${taskId}')">Delete task</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

window.closeDeleteTaskConfirm = () => {
  const modal = document.getElementById('delete-task-modal');
  if (modal) modal.style.display = 'none';
};

window.confirmDeleteTask = async (productId, taskId) => {
  closeDeleteTaskConfirm();
  try {
    const prod = productListCache[productId];
    const isNewFormat = !!prod.tasks?.[taskId];
    const path = isNewFormat ? 'tasks/' + taskId : 'pillars/' + taskId;

    await set(ref(db, 'products/' + productId + '/' + path), null);

    if (isNewFormat) delete prod.tasks[taskId];
    else delete prod.pillars[taskId];

    showToast("Task deleted", "success");
    const body = document.getElementById('product-detail-body');
    if (body) body.innerHTML = buildPillarDetail(prod);
  } catch(e) {
    showToast("Failed to delete task: " + e.message, "error");
  }
};

window.moveProductTask = async (productId, taskId, direction) => {
  const permCheck = productListCache[productId];
  if (!permCheck || !canEdit(permCheck)) {
    showToast('Only the owner or an admin can reorder tasks on this item.', 'error');
    return;
  }
  try {
    const prod = productListCache[productId];
    // Reorder within the viewer's visible set only — reordering against tasks
    // you cannot see would silently rewrite another department's sequence.
    const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1 || idx + direction < 0 || idx + direction >= tasks.length) return;

    const targetIdx = idx + direction;

    // Set order property sequentially before swapping
    const updates = {};
    tasks.forEach((t, i) => {
      t.order = i;
      const p = prod.tasks?.[t.id] ? 'tasks/' + t.id + '/order' : 'pillars/' + t.id + '/order';
      updates[p] = i;
    });

    // Swap the order of the two adjacent tasks
    const tempOrder = tasks[idx].order;
    tasks[idx].order = tasks[targetIdx].order;
    tasks[targetIdx].order = tempOrder;

    const path1 = prod.tasks?.[tasks[idx].id] ? 'tasks/' + tasks[idx].id + '/order' : 'pillars/' + tasks[idx].id + '/order';
    const path2 = prod.tasks?.[tasks[targetIdx].id] ? 'tasks/' + tasks[targetIdx].id + '/order' : 'pillars/' + tasks[targetIdx].id + '/order';
    updates[path1] = tasks[idx].order;
    updates[path2] = tasks[targetIdx].order;

    // Send the changes to Firebase
    for (const p in updates) {
      await set(ref(db, 'products/' + productId + '/' + p), updates[p]);
    }

    const body = document.getElementById('product-detail-body');
    if (body) body.innerHTML = buildPillarDetail(prod);
  } catch(e) {
    showToast("Failed to move task: " + e.message, "error");
  }
};

// Drag a task directly to where it belongs — same underlying sequential
// .order write moveProductTask uses above, generalized to move any
// distance in one drop instead of one step per click.
window.reorderProductTaskDrag = async (productId, draggedTaskId, targetTaskId) => {
  if (!draggedTaskId || !targetTaskId || draggedTaskId === targetTaskId) return;
  const prod = productListCache[productId];
  if (!prod || !canEdit(prod)) {
    showToast('Only the owner or an admin can reorder tasks on this item.', 'error');
    return;
  }
  try {
    // Same visibility ring-fence as moveProductTask — never reorder against
    // tasks this viewer can't see.
    const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
    const fromIdx = tasks.findIndex(t => t.id === draggedTaskId);
    const toIdx   = tasks.findIndex(t => t.id === targetTaskId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = tasks.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const updates = {};
    reordered.forEach((t, i) => {
      t.order = i;
      const path = prod.tasks?.[t.id] ? 'tasks/' + t.id + '/order' : 'pillars/' + t.id + '/order';
      updates[path] = i;
    });
    for (const p in updates) {
      await set(ref(db, 'products/' + productId + '/' + p), updates[p]);
    }

    const body = document.getElementById('product-detail-body');
    if (body) body.innerHTML = buildPillarDetail(prod);
  } catch(e) {
    showToast('Failed to reorder task: ' + e.message, 'error');
  }
};

/* ══ TASK REASSIGNMENT ══════════════════════════════════════ */
window.showReassignTask = async (productId, taskId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  const tasks = getProductTasks(prod);
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  // Re-fetch stakeholders and departments live so new additions appear immediately
  try {
    const [sSnap, dSnap] = await Promise.all([
      get(ref(db, 'config/stakeholders')),
      get(ref(db, 'config/departments')),
    ]);
    if (sSnap.exists()) {
      const saved = sSnap.val();
      set_STAKEHOLDERS( Array.isArray(saved) ? saved : Object.values(saved));
    }
    if (dSnap.exists()) set_DEPARTMENTS( { ...DEPARTMENTS, ...dSnap.val() });
  } catch(e) { /* use cached */ }

  const panel = document.getElementById('modal-reassign-panel');
  if (!panel) return;

  const curDept = task.ownerDept || getDepts()[0] || '';

  panel.innerHTML =
    '<div style="background:#F8F8F7;border-top:1px solid var(--border);padding:14px 16px;margin-top:8px;">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">Reassign: ' + (task.title || 'Task') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
        '<div style="flex:1;min-width:130px;">' +
          '<label class="form-label" style="font-size:10px;">Department</label>' +
          '<select id="ra-dept" class="select-field" style="width:100%;" onchange="updateReassignIndividuals()">' +
            getDepts().map(d => '<option value="' + d + '"' + (d === curDept ? ' selected' : '') + '>' + d + '</option>').join('') +
          '</select>' +
        '</div>' +
        '<div style="flex:1;min-width:140px;">' +
          '<label class="form-label" style="font-size:10px;">Individual</label>' +
          '<select id="ra-individual" class="select-field" style="width:100%;">' +
            buildOwnerIndividualOptions(curDept, task.ownerEmail || '') +
          '</select>' +
        '</div>' +
        '<div style="flex:1;min-width:160px;">' +
          '<label class="form-label" style="font-size:10px;">Reason (optional)</label>' +
          '<input id="ra-reason" class="input-field" placeholder="e.g. Capacity change" style="width:100%;"/>' +
        '</div>' +
        '<button class="btn-primary" style="font-size:12px;padding:8px 14px;white-space:nowrap;" onclick="confirmReassign(\'' + productId + '\',\'' + taskId + '\')">' +
          'Confirm reassign' +
        '</button>' +
        '<button class="btn-outline" style="font-size:12px;" onclick="document.getElementById(\'modal-reassign-panel\').innerHTML=\'\'">Cancel</button>' +
      '</div>' +
    '</div>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.updateReassignIndividuals = () => {
  const dept = document.getElementById('ra-dept')?.value || '';
  const sel  = document.getElementById('ra-individual');
  if (sel) sel.innerHTML = buildOwnerIndividualOptions(dept, '');
};

window.confirmReassign = async (productId, taskId) => {
  const dept      = document.getElementById('ra-dept')?.value || '';
  const sel       = document.getElementById('ra-individual');
  const toEmail   = sel?.value || '';
  const toName    = sel?.selectedOptions?.[0]?.dataset?.name || toEmail || dept;
  const reason    = document.getElementById('ra-reason')?.value.trim() || '';
  if (!toEmail && !dept) { showToast('Select an individual or department', 'error'); return; }

  const prod  = productListCache[productId];
  const tasks = getProductTasks(prod);
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  const prevOwners = (task.owners && task.owners.length > 0)
    ? task.owners
    : (task.owner ? [{ dept: task.ownerDept || '', email: task.ownerEmail || '', nameCache: task.owner }] : []);
  const prevLabel = prevOwners.length ? prevOwners.map(o => ownerLabel(o)).join(', ') : 'Unassigned';

  const now       = Date.now();
  const histEntry = {
    from:      prevLabel,
    fromEmail: prevOwners.map(o => o.email || '').filter(Boolean).join(','),
    to:        toName,
    toEmail:   toEmail,
    dept:      dept,
    reason:    reason,
    by:        currentPreferredName || currentUser.displayName || currentUser.email,
    byEmail:   currentUser.email,
    at:        now,
  };

  // Reassignment replaces the owner set — email is the canonical field
  const newOwners = [{ dept, email: toEmail, nameCache: toName }];
  await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/owners'), newOwners);
  await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/owner'), toName);
  await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/ownerEmail'), toEmail);
  await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/ownerDept'), dept);
  const histId = 'ra_' + now;
  await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/assigneeHistory/' + histId), histEntry);

  // Also log as a comment for visibility
  const commentId = 'c_ra_' + now;
  const commentText = 'Task reassigned from ' + prevLabel + ' to ' + toName +
    (dept ? ' (' + dept + ')' : '') + (reason ? ' — ' + reason : '') +
    '. By ' + (currentPreferredName || currentUser.displayName || currentUser.email) + '.';
  await set(ref(db, 'productComments/' + productId + '/' + commentId), {
    id: commentId, text: commentText,
    userEmail: currentUser.email,
    userName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
    type: 'reassignment', createdAt: now,
  });

  // Update local cache
  if (productListCache[productId]?.tasks?.[taskId]) {
    const c = productListCache[productId].tasks[taskId];
    c.owners = newOwners; c.owner = toName; c.ownerEmail = toEmail; c.ownerDept = dept;
  }

  // Tell the new owner — same weight as an automated alert
  if (toEmail && toEmail.indexOf('@') > -1) {
    try {
      await callGAS('sendAssignmentAlert', {
        toEmails:      [toEmail],
        productId:     productId,
        productName:   prod.name,
        taskId:        taskId,
        taskTitle:     task.title || 'Untitled',
        deadline:      task.deadline || '',
        previousOwner: prevLabel,
        reason:        reason,
        assignedBy:    currentPreferredName || currentUser.displayName || currentUser.email,
        sentByName:    currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
        sentByEmail:   currentUser.email,
      });
    } catch(e) { console.warn('Assignment alert failed to send:', e); }
  }

  showToast('Task reassigned to ' + toName + (toEmail ? ' — they have been notified' : ''), 'success');
  document.getElementById('modal-reassign-panel').innerHTML = '';
  // Refresh the tasks tab
  const body = document.getElementById('product-detail-body');
  if (body) body.innerHTML = buildPillarDetail(productListCache[productId]);
};

/* ══ TASK SPIN-OUT ══════════════════════════════════════════ */
window.spinOutTask = (productId, taskId, taskTitle) => {
  const overlay = document.createElement('div');
  overlay.id = 'spinout-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:28px;max-width:420px;width:100%;">' +
      '<div style="font-size:15px;font-weight:700;color:#1A1A1A;margin-bottom:6px;">Spin out as new item</div>' +
      '<div style="font-size:12px;color:#6B7280;margin-bottom:18px;">This will create a new Product or Project pre-linked to this task.</div>' +
      '<div class="form-row"><label class="form-label">New item name</label>' +
        '<input id="so-name" class="input-field" value="' + taskTitle + '" style="width:100%;"/></div>' +
      '<div class="form-row"><label class="form-label">Type</label>' +
        '<div style="display:flex;gap:8px;margin-top:4px;">' +
          '<button id="so-type-product" class="type-toggle-btn type-toggle-active" onclick="setSoType(\'product\')">Product</button>' +
          '<button id="so-type-project" class="type-toggle-btn" onclick="setSoType(\'project\')">Project</button>' +
        '</div>' +
        '<input type="hidden" id="so-type" value="product"/>' +
      '</div>' +
      '<div class="form-row"><label class="form-label">Target date</label>' +
        '<input type="date" id="so-date" class="input-field" style="width:100%;"/></div>' +
      '<div class="form-actions" style="margin-top:18px;">' +
        '<button class="btn-outline" onclick="document.getElementById(\'spinout-overlay\').remove()">Cancel</button>' +
        '<button class="btn-primary" onclick="confirmSpinOut(\'' + productId + '\',\'' + taskId + '\')">Create & link</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
};

window.setSoType = (type) => {
  document.getElementById('so-type').value = type;
  ['product','project'].forEach(t => {
    const btn = document.getElementById('so-type-' + t);
    if (btn) btn.className = 'type-toggle-btn' + (t === type ? ' type-toggle-active' : '');
  });
};

window.confirmSpinOut = async (sourceProductId, sourceTaskId) => {
  const name      = document.getElementById('so-name')?.value.trim();
  const type      = document.getElementById('so-type')?.value || 'product';
  const launchDate= document.getElementById('so-date')?.value;
  if (!name)       { showToast('Name required', 'error'); return; }
  if (!launchDate) { showToast('Date required', 'error'); return; }

  const newId = generateId();
  const now   = Date.now();
  const payload = {
    id: newId, name, description: '', launchDate,
    itemType: type, status: 'active', tasks: {},
    taskSchema: 'custom', baselineLaunchDate: launchDate,
    ownerId: sanitiseEmail(currentUser.email),
    ownerName: currentUser.displayName || currentUser.email.split('@')[0],
    sharedWith: {}, alertsEnabled: true, alertRecipients: [],
    defaultCCs: [], escalationChain: [],
    spunFromProduct: sourceProductId,
    spunFromTask: sourceTaskId,
    createdAt: now, updatedAt: now, createdBy: currentUser.email,
  };
  await set(ref(db, 'products/' + newId), payload);
  productListCache[newId] = payload;

  // Record spin-out link on the source task
  await set(ref(db, 'products/' + sourceProductId + '/tasks/' + sourceTaskId + '/spunOutTo'), newId);
  await set(ref(db, 'products/' + sourceProductId + '/tasks/' + sourceTaskId + '/spunOutName'), name);
  await set(ref(db, 'products/' + sourceProductId + '/tasks/' + sourceTaskId + '/spunOutType'), type);
  if (productListCache[sourceProductId]?.tasks?.[sourceTaskId]) {
    productListCache[sourceProductId].tasks[sourceTaskId].spunOutTo   = newId;
    productListCache[sourceProductId].tasks[sourceTaskId].spunOutName = name;
  }

  await logActivity(newId, 'created', type.charAt(0).toUpperCase() + type.slice(1) + ' "' + name + '" created', 'Spun out from task: ' + sourceTaskId);

  document.getElementById('spinout-overlay').remove();
  showToast(name + ' created as a ' + type + '.', 'success');
  loadProductList();
};

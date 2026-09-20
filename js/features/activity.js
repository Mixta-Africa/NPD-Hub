/* features/activity.js — Activity log, task history, quick update, activity PDF. */

import { db, get, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentRole, currentUser, isSuperAdmin } from '../core/state.js';
import { canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, getPillarStatus } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { trackerProductsCache } from '../views/tracker.js';

/* ══ ITEM 4: ACTIVITY FEED ══════════════════════════════════ */
export async function logActivity(productId, type, message, detail, taskId = null) {
  try {
    const eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const payload = {
      id:         eventId,
      type,      // 'status' | 'note' | 'task_added' | 'handover' | 'document' | 'created' | 'baseline'
      message,
      detail:    detail || null,
      user:      currentUser?.email || 'system',
      userName:  currentUser?.displayName || currentUser?.email?.split('@')[0] || 'System',
      timestamp: Date.now(),
    };
    
    // Attach the specific task ID if provided, so we can filter by it later
    if (taskId) payload.taskId = taskId;

    await set(ref(db, `products/${productId}/activity/${eventId}`), payload);
    
    // Silently update local caches so the UI doesn't need a hard refresh
    const prod = (typeof productListCache !== 'undefined' && productListCache[productId]) || 
                 (typeof trackerProductsCache !== 'undefined' && trackerProductsCache[productId]);
    if (prod) {
      if (!prod.activity) prod.activity = {};
      prod.activity[eventId] = payload;
    }
  } catch(e) { /* silently ignore — activity log is non-critical */ }
}

/* ══ TASK HISTORY VIEWER ═════════════════════════════════════ */
window.showTaskHistory = (productId, taskId) => {
  const prod = productListCache[productId] || (typeof trackerProductsCache !== 'undefined' ? trackerProductsCache[productId] : null);
  if (!prod) return;

  const task = getProductTasks(prod).find(t => t.id === taskId);
  const taskName = task ? (task.title || task.name) : taskId;

  // Filter activities strictly associated with this task
  const allActs = Object.values(prod.activity || {});
  const taskActs = allActs.filter(a =>
    a.taskId === taskId || 
    (a.message || '').includes(taskName) || 
    (a.detail || '').includes(taskName)
  ).sort((a, b) => b.timestamp - a.timestamp);

  let html = `<div style="padding:24px;max-width:480px;width:100%;">
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:12px;">
      Task History<br><span style="font-size:12px;font-weight:500;color:var(--text-muted);">${taskName}</span>
    </div>
    <div style="max-height:400px;overflow-y:auto;padding-right:8px;display:flex;flex-direction:column;gap:12px;">`;

  if (taskActs.length === 0) {
    html += `<div style="font-size:12px;color:var(--text-muted);font-style:italic;">No recorded changes for this task yet.</div>`;
  } else {
    html += taskActs.map(a => `
      <div style="background:#FAFAF9;border:1px solid var(--border);border-radius:8px;padding:12px;position:relative;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:800;color:var(--text);text-transform:uppercase;background:#F0F0EE;padding:2px 6px;border-radius:4px;">${a.type.replace('_', ' ')}</span>
          <span style="font-size:10px;color:var(--text-muted);">${new Date(a.timestamp).toLocaleString('en-GB', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div style="font-size:13px;color:var(--text);font-weight:600;margin-bottom:4px;line-height:1.4;">${a.message}</div>
        ${a.detail ? `<div style="font-size:12px;color:var(--text-muted);line-height:1.4;">${a.detail}</div>` : ''}
        <div style="font-size:10px;color:var(--text-muted);margin-top:8px;border-top:1px solid #E5E4E0;padding-top:6px;">Changed by ${a.userName || a.user}</div>
      </div>
    `).join('');
  }

  html += `</div>
    <button class="btn-outline" style="width:100%;margin-top:20px;" onclick="document.getElementById('task-history-modal').remove()">Close</button>
  </div>`;

  let modal = document.getElementById('task-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'task-history-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2);">${html}</div>`;
};

window.showProductActivity = async (productId) => {
  const prod = productListCache[productId] || trackerProductsCache[productId];
  if (!prod) return;

  document.getElementById('modal-title-text').textContent = `Activity — ${prod.name}`;
  document.getElementById('modal-body-content').innerHTML =
    '<div class="loading-row" style="padding:24px;">Loading activity...</div>';
  document.getElementById('create-product-modal').style.display = 'flex';

  const snap     = await get(ref(db, `products/${productId}/activity`));
  const activity = snap.val() || {};
  const userKey  = sanitiseEmail(currentUser.email);
  const isOwnerOrAdmin = currentRole === 'admin' || isSuperAdmin || prod.ownerId === userKey;
  // Same rule as the email log and Comments tab: being able to open this
  // product is not being able to see everything that ever happened in
  // it. A task-scoped event needs real access to that specific task;
  // anything without a taskId (handover, baseline, product-level edits)
  // is owner/admin only, same bar as Comments.
  const events   = Object.values(activity)
    .filter(e => {
      if (e.taskId) {
        const task = (prod.tasks && prod.tasks[e.taskId]) || (prod.pillars && prod.pillars[e.taskId]);
        return task ? canViewTask(task, prod) : isOwnerOrAdmin;
      }
      return isOwnerOrAdmin;
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);

  // Expanded icon and color dictionaries
  const typeIcon = { 
    status: ICON.refresh, note: ICON.note, task_added: ICON.plus, handover: ICON.handshake,
    document: ICON.paperclip, created: ICON.rocket, baseline: ICON.calendar,
    date_change: ICON.calendar, reassignment: ICON.thread, visibility: ICON.lock, type_changed: ICON.bolt 
  };
  const typeColor = { 
    status: 'var(--blue)', note: 'var(--text-muted)', task_added: 'var(--green)',
    handover: 'var(--amber)', document: 'var(--text-muted)', created: 'var(--green)', 
    baseline: 'var(--red)', date_change: 'var(--amber)', reassignment: 'var(--blue)', 
    visibility: 'var(--red)', type_changed: 'var(--amber)' 
  };

  const rows = events.map(e => {
    const dt = new Date(e.timestamp);
    const timeStr = dt.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) +
                    ' ' + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    
    // Only Super Admins get the delete button
    const deleteBtn = isSuperAdmin 
      ? `<button onclick="saDeleteActivity('${productId}', '${e.id}')" style="background:none;border:none;color:var(--red);font-size:10px;cursor:pointer;opacity:0.6;margin-left:auto;" title="Super Admin Override: Delete Log">Delete</button>` 
      : '';

    return `<div class="activity-row" id="act-row-${e.id}">
      <div class="activity-icon" style="color:${typeColor[e.type]||'var(--text-muted)'}">
        ${typeIcon[e.type] || ''}
      </div>
      <div class="activity-body">
        <div class="activity-msg" style="display:flex;align-items:center;">
          <span>${e.message}</span>
          ${deleteBtn}
        </div>
        ${e.detail ? `<div class="activity-detail">${e.detail}</div>` : ''}
        <div class="activity-meta">${e.userName} · ${timeStr}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state-sm"><p>No activity recorded yet.</p></div>';

  document.getElementById('modal-body-content').innerHTML = `
    <div class="activity-feed">${rows}</div>
    <div class="form-actions" style="display:flex; justify-content:space-between; width:100%;">
      <button class="btn-primary" onclick="exportActivityLogPDF('${productId}')">Export as PDF</button>
      <button class="btn-outline" onclick="closeProductModal()">Close</button>
    </div>`;
};

/* ══ PDF EXPORT & SUPER ADMIN DELETE FUNCTIONS ═════════════════ */
window.exportActivityLogPDF = async (productId) => {
  const prod = productListCache[productId] || trackerProductsCache[productId];
  if (!prod) return;
  
  showToast('Generating PDF...', 'info');
  try {
    const snap = await get(ref(db, `products/${productId}/activity`));
    const activity = snap.val() || {};
    const events = Object.values(activity).sort((a, b) => b.timestamp - a.timestamp);
    
    let html = '<!DOCTYPE html><html><head><title>Activity Log - ' + prod.name + '</title>';
    html += '<style>body{font-family:Helvetica,Arial,sans-serif;padding:40px;color:#1A1A1A;} .header{border-bottom:2px solid #C0282D;padding-bottom:10px;margin-bottom:20px;} .row{padding:12px 0;border-bottom:1px solid #E5E4E0;} .time{color:#6B7280;font-size:12px;margin-bottom:4px;} .msg{font-size:14px;font-weight:600;margin-bottom:4px;} .det{font-size:13px;color:#4B5563;}</style></head><body>';
    html += '<div class="header"><h2 style="margin:0;">Activity Log: ' + prod.name + '</h2><p style="color:#6B7280;font-size:13px;margin-top:5px;">Generated ' + new Date().toLocaleString('en-GB') + '</p></div>';
    
    if (events.length === 0) {
      html += '<p>No activity recorded yet.</p>';
    } else {
      events.forEach(e => {
        const dt = new Date(e.timestamp).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
        html += '<div class="row">';
        html += '<div class="time">' + dt + ' &nbsp;&middot;&nbsp; ' + e.userName + '</div>';
        html += '<div class="msg">' + e.message + '</div>';
        if (e.detail) html += '<div class="det">' + e.detail + '</div>';
        html += '</div>';
      });
    }
    html += '</body></html>';
    
    const printWin = window.open('', '_blank');
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); }, 500);
  } catch(e) {
    showToast('Failed to export PDF: ' + e.message, 'error');
  }
};

window.saDeleteActivity = async (productId, eventId) => {
  if (!isSuperAdmin) return;
  if (!confirm("SUPER ADMIN OVERRIDE: Permanently delete this activity log from Firebase?")) return;
  
  try {
    await set(ref(db, `products/${productId}/activity/${eventId}`), null);
    const row = document.getElementById(`act-row-${eventId}`);
    if (row) row.remove();
    showToast('Activity record permanently deleted.', 'success');
  } catch(e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
};

/* ══ ITEM 6: QUICK-UPDATE MODAL ══════════════════════════════ */
window.showQuickUpdate = async (productId) => {
  const prod  = productListCache[productId] || trackerProductsCache[productId];
  if (!prod) return;

  const snap  = await get(ref(db, 'products/' + productId));
  const fresh = snap.val() || prod;
  productListCache[productId] = fresh;

  const tasks     = getProductTasks(fresh);
  const today     = new Date(); today.setHours(0,0,0,0);
  const attention = tasks.filter(t =>
    t.status !== 'complete' && (
      t.status === 'delayed' ||
      (t.deadline && getPillarStatus(t.deadline) === 'overdue')
    )
  );
  const ontrack = tasks.filter(t =>
    t.status !== 'complete' && t.status !== 'delayed' &&
    (!t.deadline || getPillarStatus(t.deadline) === 'ontrack')
  );

  const buildTaskRow = (t) => {
    const due      = t.deadline ? new Date(t.deadline) : null;
    if (due) due.setHours(0,0,0,0);
    const daysOver = due && due < today ? Math.round((today - due) / 86400000) : 0;
    const chip     = !t.deadline
      ? '<span class="pill pill-grey" style="font-size:10px;">No date</span>'
      : daysOver > 0
        ? '<span class="pill pill-red" style="font-size:10px;">' + daysOver + 'd overdue</span>'
        : t.status === 'delayed'
          ? '<span class="pill pill-amber" style="font-size:10px;">Delayed</span>'
          : '<span class="pill pill-green" style="font-size:10px;">' + formatDate(t.deadline) + '</span>';
    const st = t.status || 'on-track';
    return '<div class="qu-task-row" id="qtr-' + t.id + '">' +
      '<div class="qu-task-info">' +
        '<div class="qu-task-name">' + (t.title || t.name || 'Untitled') + '</div>' +
        '<div class="qu-task-meta">' + (t.owner || '') + ' ' + chip + '</div>' +
      '</div>' +
      '<div class="qu-task-btns">' +
        '<button class="status-btn status-btn-ontrack ' + (st === 'on-track' ? 'active' : '') + '" ' +
          'onclick="quickSetStatus(\'' + productId + '\',\'' + t.id + '\',\'on-track\',this)">On Track</button>' +
        '<button class="status-btn status-btn-delayed ' + (st === 'delayed' ? 'active' : '') + '" ' +
          'onclick="quickSetStatus(\'' + productId + '\',\'' + t.id + '\',\'delayed\',this)">Delayed</button>' +
        '<button class="status-btn status-btn-complete ' + (st === 'complete' ? 'active' : '') + '" ' +
          'onclick="quickSetStatus(\'' + productId + '\',\'' + t.id + '\',\'complete\',this)">Done</button>' +
      '</div>' +
      '<input type="text" class="qu-note-input" placeholder="Add a note..." value="' + (t.notes || '') + '" ' +
        'onblur="quickSaveNote(\'' + productId + '\',\'' + t.id + '\',this.value)" ' +
        'style="width:100%;margin-top:8px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:Poppins,sans-serif;color:var(--text);outline:none;">' +
      '<div id="qu-hist-' + t.id + '">' + buildQuickUpdateHistory(t) + '</div>' +
    '</div>';
  };

  const attentionHtml = attention.length > 0
    ? '<div class="qu-section-label qu-label-red" style="display:flex;align-items:center;gap:5px;">' + ICON.warn + ' Needs attention (' + attention.length + ')</div>' +
      attention.map(buildTaskRow).join('')
    : '<div class="qu-section-label" style="color:var(--green);">All tasks on track</div>';

  const ontrackHtml = ontrack.length > 0
    ? '<details style="margin-top:12px;"><summary class="qu-section-label" style="cursor:pointer;list-style:none;">On track (' + ontrack.length + ') — tap to show</summary>' +
      '<div style="margin-top:8px;">' + ontrack.map(buildTaskRow).join('') + '</div></details>'
    : '';

  let modal = document.getElementById('quick-update-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quick-update-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;z-index:2000;padding:0;';
    document.body.appendChild(modal);
  }

  const done  = tasks.filter(t => t.status === 'complete').length;
  const pct   = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

  modal.innerHTML =
    '<div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:600px;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;">' +
      '<div style="background:#C0282D;padding:18px 22px 16px;flex-shrink:0;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<div style="color:rgba(255,255,255,.8);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;">Quick Update</div>' +
          '<button onclick="document.getElementById(\'quick-update-modal\').style.display=\'none\'" ' +
            'style="background:rgba(255,255,255,.2);border:none;color:white;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Poppins,sans-serif;">Done</button>' +
        '</div>' +
        '<div style="color:white;font-size:18px;font-weight:700;margin-bottom:8px;">' + fresh.name + '</div>' +
        '<div style="background:rgba(255,255,255,.2);border-radius:4px;height:4px;overflow:hidden;">' +
          '<div style="background:white;height:4px;width:' + pct + '%;border-radius:4px;transition:width .3s;"></div>' +
        '</div>' +
        '<div style="color:rgba(255,255,255,.8);font-size:11px;margin-top:5px;">' + done + ' of ' + tasks.length + ' tasks complete · ' + pct + '%</div>' +
      '</div>' +
      '<div style="overflow-y:auto;padding:16px 18px;flex:1;-webkit-overflow-scrolling:touch;">' +
        attentionHtml + ontrackHtml +
      '</div>' +
      '<div style="padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0;">' +
        '<button class="btn-secondary-sm" style="width:100%;" onclick="document.getElementById(\'quick-update-modal\').style.display=\'none\';loadView(\'tracker\')">Open full tracker →</button>' +
      '</div>' +
    '</div>';
  modal.style.display = 'flex';
};

window.quickSaveNote = async (productId, taskId, notes) => {
  try {
    const prevNotes = productListCache[productId]?.tasks?.[taskId]?.notes || '';
    await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/notes'), notes);
    if (productListCache[productId]?.tasks?.[taskId]) {
      productListCache[productId].tasks[taskId].notes = notes;
    }
    // The note field itself is just "current state" — this is the actual
    // log. Only fires when the text genuinely changed, so re-focusing the
    // field without editing it doesn't spam a duplicate entry.
    if (notes.trim() && notes.trim() !== prevNotes.trim()) {
      const updateId = 'upd_' + Date.now();
      const task = productListCache[productId]?.tasks?.[taskId];
      const entry = {
        id: updateId, text: notes.trim(),
        userEmail: currentUser.email,
        userName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
        createdAt: Date.now(),
      };
      await set(ref(db, 'products/' + productId + '/tasks/' + taskId + '/updates/' + updateId), entry);
      if (task) {
        if (!task.updates) task.updates = {};
        task.updates[updateId] = entry;
      }
      if (typeof logActivity === 'function') {
        logActivity(productId, 'update', 'Task update: ' + (task?.title || taskId), notes.trim().slice(0, 200));
      }
      const histEl = document.getElementById('qu-hist-' + taskId);
      if (histEl) histEl.innerHTML = buildQuickUpdateHistory(task);
    }
  } catch(e) { console.warn('Note save failed', e); }
};

// Compact, always-visible history for a task's updates — newest first,
// capped so the modal doesn't grow unbounded on a long-running task.
function buildQuickUpdateHistory(t) {
  const entries = t?.updates ? Object.values(t.updates).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5) : [];
  if (entries.length === 0) return '';
  const TAG = {
    delay:              { label: 'DELAY',      color: 'var(--red)' },
    deadline_change:    { label: 'DATE CHANGE', color: '#D97706' },
    dependency_change:  { label: 'DEPENDENCY',  color: '#2563EB' },
  };
  return '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:4px;">' +
    entries.map(e => {
      const when = new Date(e.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const tag = TAG[e.changeType];
      const tagHtml = tag ? '<span style="font-size:8px;font-weight:700;letter-spacing:.04em;color:' + tag.color + ';border:1px solid ' + tag.color + ';border-radius:3px;padding:0 4px;margin-right:5px;">' + tag.label + '</span>' : '';
      return '<div style="font-size:10px;color:var(--text-muted);">' + tagHtml + '<strong style="color:var(--text-mid);">' + (e.userName || 'Someone') + '</strong> · ' + when + ' — ' + String(e.text).slice(0, 140) + '</div>';
    }).join('') +
    '</div>';
}

window.quickSetStatus = async (productId, taskId, newStatus, btn) => {
  // Optimistic UI — update buttons immediately
  const row   = btn.closest('.qu-task-row');
  const btns  = row?.querySelectorAll('.status-btn');
  btns?.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btn.textContent = newStatus === 'complete' ? 'Done' : btn.textContent;

  await updatePillarStatus(productId, taskId, newStatus);
  // Refresh the modal data silently after save
  const snap = await get(ref(db, 'products/' + productId));
  if (snap.exists()) productListCache[productId] = snap.val();
};

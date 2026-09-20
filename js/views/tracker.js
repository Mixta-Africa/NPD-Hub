/* views/tracker.js — Task Tracker: table, kanban, critical path, Gantt. */

import { db, onValue, ref, set } from '../core/firebase.js';
import { ICON } from '../core/icons.js';
import { currentRole, currentView, isSuperAdmin } from '../core/state.js';
import { registerListener } from '../core/listeners.js';
import { canViewTask, isProductLocked, taskVisMarker } from '../data/permissions.js';
import { checkAndLockProduct, generateTaskId, getProductTasks } from '../data/product-model.js';
import { formatDate, getPillarStatus, resolveTaskStatus } from '../data/status.js';
import { loadDashboardStats } from './dashboard.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { loadProductList } from './products.js';
import { buildPillarDetail } from './product-detail.js';
import { calProductsCache, calViewMode, drawCalendar, drawGantt, drawMilestoneList } from './calendar.js';
import { docsProductsCache } from './documents.js';
import { logActivity } from '../features/activity.js';
import { sendDelayedTaskNotification } from '../features/task-status.js';

/* ══ TASK TRACKER ════════════════════════════════════════════ */
export let trackerProductsCache   = {};
let trackerSelectedProduct = '';

/* ── TRACKER VIEW STATE ── */
let trackerViewMode = 'table'; // 'table' | 'kanban' | 'gantt'

export function renderTracker(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Task Tracker</h1>
        <p class="view-subtitle">Per-task status across all active products</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="tracker-product-sel" class="select-field" onchange="trackerSelectProduct()">
          <option value="">Select a product...</option>
        </select>
        <div class="cal-view-toggle">
          <button class="cal-view-btn active" id="tv-btn-table"  onclick="setTrackerView('table')">Table</button>
          <button class="cal-view-btn"        id="tv-btn-kanban" onclick="setTrackerView('kanban')">Kanban</button>
          <button class="cal-view-btn"        id="tv-btn-gantt"  onclick="setTrackerView('gantt')">Gantt</button>
        </div>
      </div>
    </div>
    <div id="tracker-body"><div class="loading-row" style="padding:24px;">Loading products...</div></div>`;
  loadTrackerProducts();
}

window.setTrackerView = (mode) => {
  trackerViewMode = mode;
  ['table','kanban','gantt'].forEach(m => {
    const btn = document.getElementById('tv-btn-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const prod = trackerProductsCache[trackerSelectedProduct];
  if (!prod) return;
  const body = document.getElementById('tracker-body');
  if (body) body.innerHTML = '<div class="loading-row" style="padding:16px;">Loading...</div>';
  setTimeout(() => {
    if (mode === 'table')  renderTrackerTable(prod, null);
    if (mode === 'kanban') renderKanban(prod);
    if (mode === 'gantt')  renderTrackerGantt(prod);
  }, 30);
};

async function loadTrackerProducts() {
  trackerProductsCache = await getProductsFresh();
  const active = Object.values(trackerProductsCache).filter(p => p.status !== 'archived');
  const sel = document.getElementById('tracker-product-sel');
  if (!sel) return;
  active.forEach(p => { const o=document.createElement('option'); o.value=p.id; o.textContent=p.name; sel.appendChild(o); });
  if (active.length > 0) {
    sel.value = active[0].id;
    trackerSelectedProduct = active[0].id;
    subscribeToProduct(active[0].id);
    window._trackerFilter = null;
  } else {
    document.getElementById('tracker-body').innerHTML =
      '<div class="panel"><div class="empty-state"><span class="empty-icon" style="color:var(--text-muted);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span><h3>No products yet</h3><p>Create a product first.</p></div></div>';
  }
}

function subscribeToProduct(productId) {
  // Real-time listener on the active product — re-renders tracker when data changes
  const unsub = onValue(ref(db, 'products/' + productId), snap => {
    const prod = snap.val();
    if (!prod) return;
    trackerProductsCache[productId] = prod;
    productListCache[productId]     = prod;
    // Only re-render if tracker is visible and this product is selected
    if (currentView === 'tracker' && trackerSelectedProduct === productId) {
      if (trackerViewMode === 'kanban') renderKanban(prod);
      else if (trackerViewMode === 'gantt') renderTrackerGantt(prod);
      else renderTrackerTable(prod, null);
    }
  }, { onlyOnce: false });
  registerListener('tracker_product', unsub);
}

window.trackerSelectProduct = () => {
  const id = document.getElementById('tracker-product-sel')?.value;
  if (!id) return;
  trackerSelectedProduct = id;
  subscribeToProduct(id);  // switch real-time listener to new product
};

export function renderTrackerTable(prod, filter) {
  const body = document.getElementById('tracker-body');
  if (!body) return;
  try {
    const allTasks  = getProductTasks(prod).filter(t => canViewTask(t, prod));
    const total     = allTasks.length || 1;
    const complete  = allTasks.filter(t => resolveTaskStatus(t, prod) === 'complete').length;
    const delayed   = allTasks.filter(t => ['overdue','delayed'].includes(resolveTaskStatus(t, prod))).length;
    const blocked   = allTasks.filter(t => resolveTaskStatus(t, prod) === 'blocked').length;
    const onTrack   = Math.max(0, total - complete - delayed - blocked);
    const pct       = Math.round((complete / total) * 100);
    const locked    = isProductLocked(prod);

  const rows = allTasks.map((pl, i) => {
    // pl is a task object from getProductTasks()
    const pd       = pl;
    const rawSt    = pl.status || 'on-track';
    const st       = rawSt === 'not-started' ? 'on-track'
                   : rawSt === 'in-progress' ? 'on-track'
                   : rawSt === 'complete'    ? 'complete'
                   : rawSt === 'delayed'     ? 'delayed'
                   : rawSt;

    // Blocked by incomplete predecessors safely handled
    const blockedBy  = (pl.predecessors || []).filter(pid => {
      const dep = allTasks.find(t => t.id === pid);
      return dep && dep.status !== 'complete' && dep.taskStatus !== 'complete';
    });
    const isBlocked  = blockedBy.length > 0;
    const blockedLabel = isBlocked
      ? `<div style="font-size:11px;color:var(--amber);margin-top:3px;display:inline-flex;align-items:center;gap:4px;">
          ${ICON.link} Blocked by: ${blockedBy.map(pid => allTasks.find(t => t.id === pid)?.title || pid).join(', ')}
         </div>`
      : '';

    const taskLocked = locked && !isSuperAdmin && currentRole !== 'admin';

    // Delayed days
    const today = new Date(); today.setHours(0,0,0,0);
    let delayedDays = 0;
    if (pd.deadline && st !== 'complete') {
      const due = new Date(pd.deadline); due.setHours(0,0,0,0);
      const diff = Math.round((today - due) / 86400000);
      if (diff > 0) delayedDays = diff;
    }

    const isComplete = st === 'complete';
    const isDelayed  = st === 'delayed';
    const isOnTrack  = st === 'on-track';

    // Deadline pill
    const deadlinePill = !pd.deadline
      ? '<span class="pill pill-grey">No date</span>'
      : isComplete     ? `<span class="pill pill-blue">${formatDate(pd.deadline)}</span>`
      : delayedDays > 0 ? `<span class="pill pill-red">${delayedDays}d overdue — ${formatDate(pd.deadline)}</span>`
      : getPillarStatus(pd.deadline) === 'warning' ? `<span class="pill pill-amber">Due soon — ${formatDate(pd.deadline)}</span>`
      : `<span class="pill pill-green">${formatDate(pd.deadline)}</span>`;

    const taskId     = pl.id;
    // Smart status control — dropdown showing current state, auto-coloured
    const statusVal  = isBlocked ? 'blocked'
                     : isComplete ? 'complete'
                     : isDelayed  ? 'delayed'
                     : delayedDays > 0 ? 'overdue'   // deadline passed but not marked
                     : 'on-track';

    const statusColor = isBlocked  ? '#6B7280'
                      : isComplete ? 'var(--blue)'
                      : isDelayed  ? 'var(--red)'
                      : delayedDays > 0 ? 'var(--red)'
                      : 'var(--green)';

    const statusLabel2 = isBlocked  ? 'Blocked'
                       : isComplete ? 'Complete'
                       : isDelayed  ? `Delayed${delayedDays > 0 ? ' · '+delayedDays+'d overdue' : ''}`
                       : delayedDays > 0 ? `${delayedDays}d overdue`
                       : 'On Track';

    const canChangeStatus = (currentRole === 'admin' || isSuperAdmin || !taskLocked) && !isBlocked;
    const statusCtrl = canChangeStatus
      ? `<div class="task-status-wrap">
          <div class="task-status-badge" style="color:${statusColor};border-color:${statusColor}20;background:${statusColor}10;" onclick="openStatusDropdown('${prod.id}','${taskId}',this)">
            ${statusLabel2}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.7;"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>`
      : `<div class="task-status-badge" style="color:${statusColor};border-color:${statusColor}20;background:${statusColor}10;cursor:default;">
          ${statusLabel2}
        </div>`;

    const notesCtrl = (currentRole === 'admin' || isSuperAdmin || !taskLocked)
      ? `<input type="text" class="notes-input" placeholder="Add note..." value="${pd.notes||''}"
           onblur="updatePillarNotes('${prod.id}','${taskId}',this.value)"/>`
      : `<span class="notes-text">${pd.notes||'—'}</span>`;

    return `<tr class="tracker-row${isComplete?' tracker-row-done':isDelayed?' tracker-row-delayed':''}${isBlocked?' tracker-row-blocked':''}">
      <td class="tracker-num">${i+1}</td>
      <td class="tracker-pillar">
        <div class="tracker-pillar-name">${taskVisMarker(pl)}${taskLocked ? ICON.lock + ' ' : ''}${pl.title||pl.name||'Untitled'}</div>
        <div class="tracker-pillar-owner">${pl.owner||''}</div>
        ${blockedLabel}
      </td>
      <td class="tracker-deadline">${deadlinePill}</td>
      <td class="tracker-status">${statusCtrl}</td>
      <td class="tracker-notes">${notesCtrl}</td>
    </tr>`;
  }).join('')

  // critCount must be declared before body.innerHTML uses it in the template literal
  const criticalIds = typeof computeCriticalPath === 'function' ? computeCriticalPath(allTasks) : new Set();
  const critCount   = criticalIds.size;
  body.innerHTML = `
    <div class="tracker-summary">
      <div class="tracker-summary-top">
        <div>
          <div class="tracker-summary-name">${prod.name}</div>
          <div class="tracker-summary-meta">Launch: ${formatDate(prod.launchDate)}${critCount > 0 ? ` · <span style="color:var(--amber);font-weight:600;">${ICON.warn} ${critCount} critical path task${critCount!==1?'s':''}</span>` : ''}</div>
        </div>
        <div class="tracker-pct-badge">${pct}%</div>
      </div>
      <div class="tracker-progress-wrap">
        <div class="tracker-progress-fill" style="width:${pct}%"></div>
        <div class="tracker-progress-delayed" style="width:${Math.round((delayed/total)*100)}%;left:${pct}%"></div>
      </div>
      <div class="tracker-stats-row">
        <span class="tracker-stat tracker-stat-green"><span class="tracker-stat-num">${complete}</span> Complete</span>
        <span class="tracker-stat tracker-stat-blue"><span class="tracker-stat-num">${onTrack}</span> On Track</span>
        <span class="tracker-stat tracker-stat-red"><span class="tracker-stat-num">${delayed}</span> Delayed</span>
      </div>
    </div>
    <div class="panel" style="overflow:auto;max-height:calc(100vh - 400px);">
      <table class="tracker-table">
        <thead><tr>
          <th style="width:32px;">#</th><th>Task</th>
          <th style="width:180px;">Deadline</th>
          <th style="width:200px;">Status</th>
          <th>Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

 // Apply dashboard filter AFTER DOM renders
  if (filter) {
    setTimeout(() => {
      document.querySelectorAll('.tracker-row').forEach(row => {
        try {
          const statusBtns = row.querySelectorAll('.task-status-badge');
          const activeSt   = [...statusBtns].map(b => b.textContent.trim().toLowerCase())[0] || '';
          if (filter === 'ontrack' && !activeSt.includes('on track')) row.style.opacity = '0.3';
          if (filter === 'overdue' && !row.innerHTML.includes('overdue') && !activeSt.includes('delayed')) row.style.opacity = '0.3';
        } catch(e) {}
      });
    }, 80);
  }
  } catch(e) {
    console.error("Tracker render failed:", e);
    body.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load task data.</div>';
  }
}

window.updatePillarStatus = async (productId, taskId, newStatus, _isUndo) => {
  try {
    const prod  = trackerProductsCache[productId] || productListCache[productId];
    const tasks = getProductTasks(prod);

    // Captured before anything changes, so Ctrl+Z has something to
    // restore to. Skipped when THIS call is itself an undo — otherwise
    // every undo would push its own reversal onto the stack and Ctrl+Z
    // would just toggle back and forth instead of walking back in time.
    const taskBeforeChange = tasks.find(t => t.id === taskId);
    const oldStatus = taskBeforeChange ? (taskBeforeChange.status || taskBeforeChange.taskStatus || 'on-track') : null;

    // Enforce blocking: can't complete if a predecessor is incomplete
    if (newStatus === 'complete') {
      const task    = tasks.find(t => t.id === taskId);
      const blocked = (task?.predecessors || []).filter(pid => {
        const dep = tasks.find(t => t.id === pid);
        return dep && dep.status !== 'complete'; // Cleaned!
      });
      if (blocked.length > 0) {
        const names = blocked.map(pid => tasks.find(t => t.id === pid)?.title || pid).join(', ');
        showToast('Cannot complete — blocked by: ' + names, 'error');
        return;
      }
    }

    // --- NEW: RECURRING TASKS CLONE ENGINE ---
    if (newStatus === 'complete') {
      const tObj = tasks.find(t => t.id === taskId);
      if (tObj && tObj.recurrence && tObj.recurrence !== 'none') {
        const clonedTaskObj = JSON.parse(JSON.stringify(tObj));
        clonedTaskObj.id = generateTaskId();
        clonedTaskObj.status = 'on-track';
        clonedTaskObj.acknowledgement = null;
        
        // Advance the deadline based on the interval
        if (clonedTaskObj.deadline) {
          const d = new Date(clonedTaskObj.deadline);
          if (clonedTaskObj.recurrence === 'weekly') d.setDate(d.getDate() + 7);
          else if (clonedTaskObj.recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
          else if (clonedTaskObj.recurrence === 'quarterly') d.setMonth(d.getMonth() + 3);
          clonedTaskObj.deadline = d.toISOString().split('T')[0];
        }
        
        // Save the clone to Firebase
        const pathBase = prod?.tasks?.[taskId] ? 'tasks' : 'pillars';
        await set(ref(db, `products/${productId}/${pathBase}/${clonedTaskObj.id}`), clonedTaskObj);
        
        // Inject into local cache
        if (prod[pathBase]) prod[pathBase][clonedTaskObj.id] = clonedTaskObj;
        tasks.push(clonedTaskObj); // Add to current array so UI updates
        
        showToast(`Next ${clonedTaskObj.recurrence} occurrence scheduled.`, 'success');
        if (typeof logActivity === 'function') {
          await logActivity(productId, 'created', `Recurring task scheduled: ${clonedTaskObj.title}`, `Next deadline: ${formatDate(clonedTaskObj.deadline)}`, clonedTaskObj.id);
        }
      }
    }

   // --- NEW: UNBLOCK DETECTOR ---
    let newlyUnblocked = [];
    if (newStatus === 'complete') {
      tasks.forEach(t => {
        if (t.predecessors && t.predecessors.includes(taskId) && !t.deadline && t.status !== 'complete') {
          const allOthersDone = t.predecessors.every(pid => {
            if (pid === taskId) return true;
            const dep = tasks.find(x => x.id === pid);
            return dep && dep.status === 'complete'; // Cleaned!
          });
          if (allOthersDone) newlyUnblocked.push(t);
        }
      });
    }

    // Support both old pillars format and new tasks format
    if (prod?.tasks?.[taskId]) {
      await set(ref(db, `products/${productId}/tasks/${taskId}/status`), newStatus);
      prod.tasks[taskId].status = newStatus;
    } else {
      // Legacy pillars
      await set(ref(db, `products/${productId}/pillars/${taskId}/taskStatus`), newStatus);
      if (prod?.pillars?.[taskId]) prod.pillars[taskId].taskStatus = newStatus;
    }
    
    // Check if product should now be locked
    await checkAndLockProduct(productId);

    if (!_isUndo && oldStatus && oldStatus !== newStatus) {
      window._statusUndoStack = window._statusUndoStack || [];
      window._statusUndoStack.push({ productId, taskId, oldStatus, newStatus, taskTitle: taskBeforeChange?.title || taskBeforeChange?.name || 'Task' });
      if (window._statusUndoStack.length > 20) window._statusUndoStack.shift();
    }

    // ── PROPAGATE: sync the status change into every cache so all views stay in lockstep ──
    propagateStatusChange(productId, taskId, newStatus);
    refreshActiveView(productId);
    
    // Re-render the open modal if it is active
    const modalBody = document.getElementById('product-detail-body');
    if (modalBody) modalBody.innerHTML = buildPillarDetail(prod);

    // Log to activity feed with Promptness Metric
    const taskObj  = tasks.find(t => t.id === taskId);
    const taskName = taskObj?.title || taskObj?.name || taskId;
    
    let promptness = '';
    if (newStatus === 'complete' && taskObj?.deadline) {
      const due = new Date(taskObj.deadline).setHours(0,0,0,0);
      const now = new Date().setHours(0,0,0,0);
      const diff = Math.round((now - due) / 86400000);
      if (diff === 0) promptness = ' (Exactly on time)';
      else if (diff < 0) promptness = ` (${Math.abs(diff)} days early)`;
      else promptness = ` (${diff} days late)`;
    }

    if (typeof logActivity === 'function') {
      await logActivity(productId, 'status',
        `${taskName} marked ${newStatus.replace('-',' ')}${promptness}`,
        `Was: ${tasks.find(t=>t.id===taskId)?.status || 'unknown'}`,
        taskId
      );
    }

    // Immediate notification when task is marked delayed
    if (newStatus === 'delayed') {
      sendDelayedTaskNotification(productId, taskId, taskObj, prod);
    }

    showToast('Status updated.', 'success');

    // --- LAUNCH UNBLOCK MODAL ---
    if (newlyUnblocked.length > 0) {
      setTimeout(() => showUnblockedModal(productId, newlyUnblocked), 400);
    }

  } catch(e) { showToast('Update failed: ' + e.message, 'error'); }

  /* ── CROSS-VIEW STATUS PROPAGATION ──────────────────────────── */
  function propagateStatusChange(productId, taskId, newStatus) {
    const caches = [
      typeof productListCache    !== 'undefined' ? productListCache    : null,
      typeof trackerProductsCache !== 'undefined' ? trackerProductsCache : null,
      typeof calProductsCache    !== 'undefined' ? calProductsCache    : null,
      typeof docsProductsCache   !== 'undefined' ? docsProductsCache   : null,
    ].filter(Boolean);

    caches.forEach(cache => {
      const p = cache[productId];
      if (!p) return;
      if (p.tasks && p.tasks[taskId])        p.tasks[taskId].status     = newStatus;
      else if (p.pillars && p.pillars[taskId]) p.pillars[taskId].taskStatus = newStatus;
    });
  }

  function refreshActiveView(productId) {
    switch (currentView) {
      case 'tracker': {
        const p = trackerProductsCache[productId];
        if (!p) break;
        if (trackerViewMode === 'kanban')      renderKanban(p);
        else if (trackerViewMode === 'gantt')  renderTrackerGantt(p);
        else                                    renderTrackerTable(p, null);
        break;
      }
      case 'calendar':
        if (calViewMode === 'gantt') drawGantt();
        else { drawCalendar(); drawMilestoneList(); }
        break;
      case 'dashboard':
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
        break;
      case 'products':
        if (typeof loadProductList === 'function') loadProductList();
        break;
    }
  }
};

window.updatePillarNotes = async (productId, taskId, notes) => {
  try {
    const prod = trackerProductsCache[productId] || productListCache[productId];
    let oldNote = '';
    
    if (prod?.tasks?.[taskId]) {
      oldNote = prod.tasks[taskId].notes || '';
      await set(ref(db, `products/${productId}/tasks/${taskId}/notes`), notes);
      prod.tasks[taskId].notes = notes;
    } else {
      oldNote = prod?.pillars?.[taskId]?.notes || '';
      await set(ref(db, `products/${productId}/pillars/${taskId}/notes`), notes);
      if (prod?.pillars?.[taskId]) prod.pillars[taskId].notes = notes;
    }
    
    if (oldNote !== notes) {
      const taskName = prod?.tasks?.[taskId]?.title || prod?.pillars?.[taskId]?.name || taskId;
      if (typeof logActivity === 'function') {
        await logActivity(productId, 'note', `Notes updated: ${taskName}`, notes, taskId);
      }
    }
  } catch(e) { showToast('Note save failed.', 'error'); }
};

/* ══ PHASE B: KANBAN VIEW ═══════════════════════════════════ */
function renderKanban(prod) {
  const body = document.getElementById('tracker-body');
  if (!body) return;

  const tasks  = getProductTasks(prod).filter(t => canViewTask(t, prod));
  const locked = isProductLocked(prod);
  const canEdit = currentRole === 'admin' || isSuperAdmin || !locked;

  const cols = [
    { id: 'todo',        label: 'To Do',       cls: 'kb-col-todo'     },
    { id: 'in-progress', label: 'In Progress',  cls: 'kb-col-progress' },
    { id: 'done',        label: 'Done',         cls: 'kb-col-done'     },
  ];

  // Map task status to kanban column
  function taskToCol(t) {
    const st = t.status || t.taskStatus || 'on-track';
    if (st === 'complete') return 'done';
    if (st === 'in-progress' || st === 'delayed') return 'in-progress';
    return 'todo';
  }

  const columns = cols.map(col => {
    const colTasks = tasks.filter(t => taskToCol(t) === col.id);
    const cards    = colTasks.map(t => {
      const today    = new Date(); today.setHours(0,0,0,0);
      const isLocked = locked && !isSuperAdmin && currentRole !== 'admin';
      const blocked  = (t.predecessors||[]).some(pid => {
        const dep = tasks.find(x => x.id === pid);
        return dep && dep.status !== 'complete' && dep.taskStatus !== 'complete';
      });
      const deadlineChip = t.deadline
        ? (() => {
            const due = new Date(t.deadline); due.setHours(0,0,0,0);
            const diff = Math.round((due - today) / 86400000);
            const cls  = t.status === 'complete' ? 'pill-blue'
                       : diff < 0  ? 'pill-red'
                       : diff <= 3 ? 'pill-amber'
                       : 'pill-green';
            return `<span class="pill ${cls}" style="font-size:10px;">${formatDate(t.deadline)}</span>`;
          })()
        : '';

      const statusBtns = canEdit && !blocked ? `
        <div class="kb-card-actions">
          ${col.id !== 'todo'        ? `<button class="kb-move-btn" onclick="moveKanbanTask('${prod.id}','${t.id}','on-track')">← To Do</button>` : ''}
          ${col.id !== 'in-progress' ? `<button class="kb-move-btn" onclick="moveKanbanTask('${prod.id}','${t.id}','in-progress')">In Progress</button>` : ''}
          ${col.id !== 'done'        ? `<button class="kb-move-btn kb-move-done" onclick="moveKanbanTask('${prod.id}','${t.id}','complete')">Done</button>` : ''}
        </div>` : blocked ? `<div style="font-size:10px;color:var(--amber);margin-top:6px;display:inline-flex;align-items:center;gap:3px;">${ICON.link} Blocked</div>` : '';

      return `<div class="kb-card ${blocked ? 'kb-card-blocked' : ''}" draggable="${canEdit && !blocked}" 
               ondragstart="kbDragStart(event,'${t.id}')"
               ondragover="event.preventDefault()"
               ondrop="kbDrop(event,'${prod.id}','${col.id}')">
        <div class="kb-card-title">${taskVisMarker(t)}${isLocked ? ICON.lock + ' ' : ''}${t.title||t.name||'Untitled'}</div>
        <div class="kb-card-meta">
          ${t.owner ? `<span class="kb-card-owner">${t.owner}</span>` : ''}
          ${deadlineChip}
        </div>
        ${statusBtns}
      </div>`;
    }).join('') || `<div class="kb-empty">No tasks</div>`;

    return `<div class="kb-col ${col.cls}"
      ondragover="event.preventDefault()"
      ondrop="kbDrop(event,'${prod.id}','${col.id}')">
      <div class="kb-col-header">
        <span class="kb-col-label">${col.label}</span>
        <span class="kb-col-count">${colTasks.length}</span>
      </div>
      <div class="kb-col-body">${cards}</div>
    </div>`;
  }).join('');

  const complete = tasks.filter(t => t.status === 'complete').length;
  const pct      = Math.round((complete / (tasks.length||1)) * 100);

  body.innerHTML = `
    <div class="tracker-summary">
      <div class="tracker-summary-top">
        <div>
          <div class="tracker-summary-name">${prod.name}</div>
          <div class="tracker-summary-meta">Launch: ${formatDate(prod.launchDate)} &nbsp;·&nbsp; ${tasks.length} tasks</div>
        </div>
        <div class="tracker-pct-badge">${pct}%</div>
      </div>
      <div class="tracker-progress-wrap">
        <div class="tracker-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
    <div class="kb-board">${columns}</div>`;
}

/* ── Drag & Drop state ── */
let _kbDragging = null;
window.kbDragStart = (e, taskId) => { _kbDragging = taskId; e.dataTransfer.effectAllowed = 'move'; };
window.kbDrop     = async (e, productId, colId) => {
  e.preventDefault();
  if (!_kbDragging) return;
  const statusMap = { 'todo': 'on-track', 'in-progress': 'delayed', 'done': 'complete' };
  await updatePillarStatus(productId, _kbDragging, statusMap[colId] || 'on-track');
  _kbDragging = null;
  renderKanban(trackerProductsCache[productId]);
};

window.moveKanbanTask = async (productId, taskId, newStatus) => {
  await updatePillarStatus(productId, taskId, newStatus);
  renderKanban(trackerProductsCache[productId] || productListCache[productId]);
};

/* ══ PHASE B: TRACKER GANTT (task bars) ═════════════════════ */
function computeCriticalPath(tasks) {
  // Find the set of task IDs on the longest dependency chain
  // (longest by task count — approximation without duration floats)
  const memo = {};
  function chainLength(taskId) {
    if (memo[taskId] !== undefined) return memo[taskId];
    const task  = tasks.find(t => t.id === taskId);
    const preds = task?.predecessors || [];
    if (preds.length === 0) { memo[taskId] = 1; return 1; }
    const max = Math.max(...preds.map(pid => chainLength(pid)));
    memo[taskId] = max + 1;
    return memo[taskId];
  }

  // Find max chain length
  const lengths = tasks.map(t => ({ id: t.id, len: chainLength(t.id) }));
  const maxLen  = Math.max(...lengths.map(l => l.len), 0);
  if (maxLen <= 1) return new Set(); // no dependencies = no critical path to highlight

  // Walk backwards from tasks with maxLen to find the critical chain
  const critical = new Set();
  function markCritical(taskId) {
    if (critical.has(taskId)) return;
    critical.add(taskId);
    const task  = tasks.find(t => t.id === taskId);
    const preds = task?.predecessors || [];
    // Follow the predecessor with the longest chain
    const longestPred = preds.reduce((best, pid) => {
      return (memo[pid] || 0) > (memo[best] || 0) ? pid : best;
    }, preds[0]);
    if (longestPred) markCritical(longestPred);
  }

  lengths.filter(l => l.len === maxLen).forEach(l => markCritical(l.id));
  return critical;
}

function renderTrackerGantt(prod) {
  const body = document.getElementById('tracker-body');
  if (!body) return;

  const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
  if (tasks.length === 0) {
    body.innerHTML = '<div class="empty-state-sm"><p>No tasks to display.</p></div>';
    return;
  }

  // Determine date range from all tasks
  const allDates = tasks.flatMap(t => [t.startDate, t.deadline].filter(Boolean))
    .map(d => new Date(d));
  if (allDates.length === 0) {
    body.innerHTML = '<div class="empty-state-sm"><p>No dates set on tasks yet.</p></div>';
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  let rangeStart = new Date(Math.min(...allDates.map(d => d.getTime())));
  let rangeEnd   = new Date(Math.max(...allDates.map(d => d.getTime())));
  // Pad by 7 days either side
  rangeStart.setDate(rangeStart.getDate() - 7);
  rangeEnd.setDate(rangeEnd.getDate() + 14);
  rangeStart.setHours(0,0,0,0);
  rangeEnd.setHours(0,0,0,0);
  const totalDays = Math.max(Math.round((rangeEnd - rangeStart) / 86400000), 1);

  function pctOf(date) {
    if (!date) return null;
    const d = new Date(date); d.setHours(0,0,0,0);
    return Math.max(0, Math.min(100, (Math.round((d - rangeStart) / 86400000) / totalDays) * 100));
  }

  // Month headers
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let monthLabels = '';
  let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cur <= rangeEnd) {
    const monthEnd   = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    const clipStart  = Math.max(cur, rangeStart);
    const clipEnd    = Math.min(monthEnd, rangeEnd);
    const daysInView = Math.round((clipEnd - clipStart) / 86400000);
    const pct        = (daysInView / totalDays) * 100;
    monthLabels += `<div class="gantt-month-hdr" style="width:${pct}%">${MONTHS[cur.getMonth()]} ${cur.getFullYear()}</div>`;
    cur = monthEnd;
  }

  // Today line position
  const todayPct = pctOf(today.toISOString().split('T')[0]);

  const criticalIds = computeCriticalPath(tasks);

  // Show duration in days on bars
  function barDuration(t) {
    if (!t.startDate || !t.deadline) return null;
    const s = new Date(t.startDate); s.setHours(0,0,0,0);
    const e = new Date(t.deadline);  e.setHours(0,0,0,0);
    const d = Math.round((e - s) / 86400000);
    return d > 0 ? d : null;
  }

  const rows = tasks.map((t, i) => {
    const startPct   = pctOf(t.startDate) ?? pctOf(t.deadline) ?? 0;
    const endPct     = pctOf(t.deadline)  ?? startPct;
    const barWidth   = Math.max(endPct - startPct, 1);
    const dur        = barDuration(t);
    const isCritical = criticalIds.has(t.id);

    const blocked    = (t.predecessors||[]).some(pid => {
      const dep = tasks.find(x => x.id === pid);
      return dep && dep.status !== 'complete' && dep.taskStatus !== 'complete';
    });

    const barCls = t.status === 'complete' ? 'tg-bar-complete'
                 : isCritical && t.status !== 'complete' ? 'tg-bar-critical'
                 : t.status === 'delayed'   ? 'tg-bar-delayed'
                 : blocked                  ? 'tg-bar-blocked'
                 : 'tg-bar-ontrack';

    // Predecessor arrows (simple connector line)
    const predLines = (t.predecessors||[]).map(pid => {
      const dep = tasks.find(x => x.id === pid);
      if (!dep?.deadline) return '';
      const fromPct = pctOf(dep.deadline) ?? 0;
      const width   = Math.abs(startPct - fromPct);
      const left    = Math.min(fromPct, startPct);
      return `<div class="tg-link" style="left:${left}%;width:${width}%;" title="Depends on: ${dep.title}"></div>`;
    }).join('');

    const statusDot = '';

    return `<div class="gantt-row">
      <div class="gantt-label" title="${t.title||t.name}">
        <span class="tg-status-dot tg-dot-${t.status||'on-track'}">${statusDot}</span>
        ${t.title||t.name||'Untitled'}
      </div>
      <div class="gantt-track">
        ${todayPct !== null ? `<div class="gantt-today-line" style="left:${todayPct}%"></div>` : ''}
        ${predLines}
        <div class="tg-bar ${barCls}" style="left:${startPct}%;width:${barWidth}%;">
          ${barWidth > 8 && dur ? `<span class="tg-bar-label">${dur}d</span>` : ''}
          <div class="gantt-tooltip">
            ${isCritical ? 'Critical path · ' : ''}${t.title||t.name}<br/>
            ${t.startDate||'?'} → ${t.deadline||'?'}${dur ? ' (' + dur + ' days)' : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const complete = tasks.filter(t => t.status === 'complete').length;
  const pct      = Math.round((complete / (tasks.length||1)) * 100);

  const critCount = criticalIds.size;
  body.innerHTML = `
    <div class="tracker-summary" style="margin-bottom:14px;">
      <div class="tracker-summary-top">
        <div>
          <div class="tracker-summary-name">${prod.name}</div>
          <div class="tracker-summary-meta">Launch: ${formatDate(prod.launchDate)}</div>
        </div>
        <div class="tracker-pct-badge">${pct}%</div>
      </div>
      <div class="tracker-progress-wrap">
        <div class="tracker-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
    <div class="panel" style="overflow:hidden;padding:0;">
      <div style="overflow:auto;max-height:calc(100vh - 360px);">
        <div class="gantt-header" style="position:sticky;top:0;background:#fff;z-index:2;padding:14px 18px 8px;">
          <div class="gantt-label-col"></div>
          <div class="gantt-months">${monthLabels}</div>
        </div>
        <div style="padding:0 18px 14px;">
          ${rows}
        </div>
      </div>
    </div>`;
}

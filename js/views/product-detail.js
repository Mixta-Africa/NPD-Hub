/* views/product-detail.js — Product/project detail view and tabs. */

import { currentRole } from '../core/state.js';
import { accessBadge, canEdit, canSetTaskVisibility, canViewTask, getTaskVisibility, TASK_VISIBILITY } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { ensureProductModal } from '../features/product-form.js';
import { buildCommsTab, loadEmailLog } from '../features/email-log.js';
import { buildCommentsTab, loadAssigneeHistory, loadProductComments } from '../features/comments.js';
import { trackerProductsCache } from './tracker.js';

/* ── VIEW PRODUCT DETAIL ── */
window.viewProduct = (id, highlightTaskId) => {
  ensureProductModal();
  
  // Pull from whichever cache holds the data (Dashboard, Tracker, or Products list)
  const p = productListCache[id] || (typeof trackerProductsCache !== 'undefined' ? trackerProductsCache[id] : null);
  if (!p) { showToast('Item data not fully loaded yet. Please try again.', 'error'); return; }
  
  document.getElementById('modal-title-text').textContent = p.name;
  document.getElementById('modal-body-content').innerHTML = buildProductDetail(p, 'tasks');
  document.getElementById('create-product-modal').style.display = 'flex';
  
  // If a specific task was clicked, scroll down to it and flash it yellow
  if (highlightTaskId) {
    setTimeout(() => {
      const row = document.getElementById('pdr-' + highlightTaskId);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const originalBg = row.style.background;
        row.style.transition = 'background 0.4s ease';
        row.style.background = '#FFFBEB'; // Flash yellow
        setTimeout(() => { row.style.background = originalBg; }, 2000);
      }
    }, 50); // slight delay to let the DOM render the modal
  }
};

window.switchProductTab = (productId, tab, el) => {
  const p = productListCache[productId];
  if (!p) return;
  document.querySelectorAll('.pdt-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const body = document.getElementById('product-detail-body');
  if (!body) return;
  if (tab === 'description') {
    body.innerHTML = buildDescriptionTab(p);
  } else if (tab === 'comments') {
    body.innerHTML = buildCommentsTab(p);
    loadProductComments(productId);
  } else if (tab === 'comms') {
    body.innerHTML = buildCommsTab(p);
    loadEmailLog(productId);
  } else if (tab === 'assignees') {
    body.innerHTML = '<div class="loading-row" style="padding:16px;">Loading assignee history...</div>';
    loadAssigneeHistory(productId);
  } else {
    body.innerHTML = buildPillarDetail(p);
  }
};

function buildProductDetail(p, tab) {
  const today2 = new Date(); today2.setHours(0,0,0,0);
  const launch2 = p.launchDate ? new Date(p.launchDate) : null;
  if (launch2) launch2.setHours(0,0,0,0);
  const daysLeft2 = launch2 ? Math.round((launch2 - today2) / 86400000) : null;
  const lChip = daysLeft2 === null ? ''
    : daysLeft2 < 0   ? '<span class="pdt-chip chip-red">'+Math.abs(daysLeft2)+'d overdue</span>'
    : daysLeft2 === 0  ? '<span class="pdt-chip chip-red">Due today</span>'
    : daysLeft2 <= 14  ? '<span class="pdt-chip chip-amber">'+daysLeft2+'d to launch</span>'
    : '<span class="pdt-chip chip-grey">'+formatDate(p.launchDate)+'</span>';

  const itemType  = p.itemType || 'product';
  const typeChip  = itemType === 'project'
    ? '<span style="font-size:10px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:2px 7px;border-radius:8px;">PROJECT</span>'
    : '<span style="font-size:10px;font-weight:700;color:#C0282D;background:#FEF2F2;padding:2px 7px;border-radius:8px;">PRODUCT</span>';

  const tabHtml =
    '<div class="pdt-header">' +
    '<div class="pdt-meta">' + lChip + typeChip + accessBadge(p) +
      '<span class="pdt-owner-chip">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>' +
        (p.ownerName || 'Unassigned') +
      '</span>' +
    '</div>' +
    '<div class="pdt-tabs">' +
      '<button class="pdt-tab active" onclick="switchProductTab(\'' + p.id + '\',\'tasks\',this)">Tasks</button>' +
      '<button class="pdt-tab" onclick="switchProductTab(\'' + p.id + '\',\'assignees\',this)">Assignees</button>' +
      '<button class="pdt-tab" onclick="switchProductTab(\'' + p.id + '\',\'description\',this)">Description</button>' +
      (canEdit(p) ? '<button class="pdt-tab" onclick="switchProductTab(\'' + p.id + '\',\'comments\',this)">Comments</button>' : '') +
      '<button class="pdt-tab" onclick="switchProductTab(\'' + p.id + '\',\'comms\',this)">Sent emails</button>' +
    '</div>' +
    '</div>';

  return tabHtml + '<div id="product-detail-body">' + buildPillarDetail(p) + '</div>';
}

function buildDescriptionTab(p) {
  const tasks2   = getProductTasks(p).filter(t => canViewTask(t, p));
  const complete2 = tasks2.filter(t => t.status === 'complete').length;
  const pct2      = Math.round((complete2 / (tasks2.length || 1)) * 100);
  const driveLink = p.driveUrl
    ? '<a href="' + p.driveUrl + '" target="_blank" style="color:var(--blue);">Open →</a>'
    : 'Not set up';
  const created = p.createdAt
    ? formatDate(new Date(p.createdAt).toISOString().split('T')[0])
    : '—';
  return '<div class="pdt-desc-block">' +
    '<div class="pdt-desc-text">' + (p.description || 'No description provided.') + '</div>' +
    '<div class="pdt-desc-stats">' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Tasks</span><span class="pdt-ds-val">' + tasks2.length + '</span></div>' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Complete</span><span class="pdt-ds-val green">' + complete2 + '</span></div>' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Progress</span><span class="pdt-ds-val">' + pct2 + '%</span></div>' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Schema</span><span class="pdt-ds-val">' + (p.taskSchema === 'sop' ? 'SOP 12-pillar' : p.taskSchema === 'imported' ? 'Imported from spreadsheet' : 'Custom') + '</span></div>' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Created</span><span class="pdt-ds-val">' + created + '</span></div>' +
      '<div class="pdt-ds-item"><span class="pdt-ds-label">Drive</span><span class="pdt-ds-val">' + driveLink + '</span></div>' +
    '</div></div>';
}

export function buildPillarDetail(p) {
  const tasks = getProductTasks(p).filter(t => canViewTask(t, p));
  if (!tasks.length) {
    return '<div class="pillar-detail-list"><div class="muted" style="padding:24px 0;text-align:center;font-size:13px;">No tasks set up for this product yet.</div></div>' +
      '<div class="form-actions">' +
      (currentRole === 'admin' ? '<button class="btn-primary" onclick="editProduct(\'' + p.id + '\')">Edit dates</button>' : '') +
      '<button class="btn-outline" onclick="closeProductModal()">Close</button></div>';
  }

  // Build a quick lookup map for predecessor resolution
  const taskMap = {};
  tasks.forEach(t => { taskMap[t.id] = t; });

  const rows = tasks.map(function(task, i) {
    // Single source of truth for status — resolveTaskStatus checks
    // task.status === 'complete' FIRST, before it ever looks at
    // predecessors. The old version here recomputed "blocked" locally
    // and checked it before completion, so a task marked complete with
    // an unfinished predecessor still on record would wrongly show as
    // Blocked (or, depending on other fields, drift into the wrong
    // group entirely) instead of Complete.
    const effStatus = resolveTaskStatus(task, p);
    const isBlocked = effStatus === 'blocked';
    const blockedBy = isBlocked
      ? (task.predecessors || []).filter(pid => {
          const pred = taskMap[pid];
          return pred && pred.status !== 'complete' && pred.taskStatus !== 'complete';
        })
      : [];
    const blockedNames = blockedBy.map(pid => taskMap[pid]?.title || 'a predecessor task');

    const smeta = STATUS_META[effStatus] || STATUS_META['on-track'];
    const meta = { label: smeta.label, color: smeta.color, cls: effStatus }; // cls stays a plain status keyword — every comparison below already expects that shape

    const deadlineChip = !task.deadline
      ? '<span class="pill pill-grey">No date</span>'
      : isBlocked
        ? '<span class="pill pill-amber">' + formatDate(task.deadline) + '</span>'
        : meta.cls === 'overdue'
          ? '<span class="pill pill-red">Overdue — ' + formatDate(task.deadline) + '</span>'
          : meta.cls === 'due-soon'
            ? '<span class="pill pill-amber">Due soon — ' + formatDate(task.deadline) + '</span>'
            : meta.cls === 'complete'
              ? '<span class="pill pill-blue">' + formatDate(task.deadline) + '</span>'
              : '<span class="pill pill-green">' + formatDate(task.deadline) + '</span>';

    const blockedHint = isBlocked
      ? '<div style="font-size:11px;color:#D97706;margin-top:4px;display:flex;align-items:center;gap:4px;">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>' +
          'Waiting on: ' + blockedNames.join(', ') +
        '</div>'
      : '';

    const owners  = task.owners && task.owners.length > 0
      ? task.owners
      : (task.owner ? [{ dept: task.ownerDept || '', email: task.ownerEmail || '', nameCache: task.owner }] : []);
    const ownerDisplay = owners.length > 0
      ? owners.map(o => '<span class="pillar-owner">' + ownerLabel(o) + '</span>').join('')
      : '';

    const statusEl = isBlocked
      ? '<div class="task-status-badge" style="color:#D97706;border-color:#D9770620;background:#D9770610;cursor:default;">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' +
          'Blocked' +
        '</div>'
      : '<div class="task-status-badge" style="color:' + meta.color + ';border-color:' + meta.color + '20;background:' + meta.color + '10;cursor:pointer;" onclick="openStatusDropdown(\'' + p.id + '\',\'' + task.id + '\',this)">' +
          meta.label +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:4px;"><path d="M6 9l6 6 6-6"/></svg>' +
        '</div>';

    const spinOutBtn = currentRole === 'admin'
      ? '<button onclick="spinOutTask(\'' + p.id + '\',\'' + task.id + '\',\'' + (task.title || '').replace(/'/g, '') + '\')" ' +
          'style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;white-space:nowrap;margin-left:6px;" ' +
          'title="Spin out as new Product or Project">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
          'Spin out' +
        '</button>'
      : '';

    // Reassign button
    const reassignBtn = currentRole === 'admin'
      ? '<button onclick="showReassignTask(\'' + p.id + '\',\'' + task.id + '\')" ' +
          'style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;white-space:nowrap;" ' +
          'title="Reassign task owner">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' +
          'Reassign' +
        '</button>'
      : '';

    // Visibility pill — click to change (product owner / admin only)
    const vis     = getTaskVisibility(task);
    const visMeta = TASK_VISIBILITY[vis];
    const canSetVis = canSetTaskVisibility(p);
    const visPill = '<span ' + (canSetVis
        ? 'onclick="cycleTaskVisibility(\'' + p.id + '\',\'' + task.id + '\')" title="Click to change visibility" style="cursor:pointer;"'
        : 'title="Visibility: ' + visMeta.label + '"') +
      ' style="font-size:9px;font-weight:700;letter-spacing:.04em;color:' + visMeta.color +
      ';background:' + visMeta.color + '15;padding:1px 6px;border-radius:8px;' + (canSetVis ? 'cursor:pointer;' : '') + '">' +
      visMeta.label.toUpperCase() + '</span>';

    // Acknowledgement badge — surfaces what the GAS email links already write
    const ack = task.acknowledgement;
    const ackBadge = ack
      ? '<span title="' + (ack.acknowledgedBy || '') + ' on ' +
          (ack.acknowledgedAt ? new Date(ack.acknowledgedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '') + '" ' +
          'style="font-size:9px;font-weight:700;letter-spacing:.04em;padding:1px 6px;border-radius:8px;' +
          (ack.type === 'needs_more_time'
            ? 'color:#D97706;background:#D9770615;">MORE TIME REQUESTED'
            : 'color:#16A34A;background:#16A34A15;">ACKNOWLEDGED') +
        '</span>' +
        (canSetVis ? '<button onclick="clearTaskAck(\'' + p.id + '\',\'' + task.id + '\')" title="Clear acknowledgement" ' +
          'style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:11px;padding:0 2px;">&times;</button>' : '')
      : '';

    // Spin-out link if task was previously spun out
    const spinLink = task.spunOutTo
      ? '<div style="font-size:10px;color:var(--blue);margin-top:4px;">→ Spun out: ' + (task.spunOutName || task.spunOutTo) + '</div>'
      : '';

    const isFirst = i === 0;
    const isLast = i === tasks.length - 1;
    const canDrag = canEdit(p);
    const moveUpBtn = canEdit(p) && !isFirst ? '<button onclick="moveProductTask(\'' + p.id + '\', \'' + task.id + '\', -1)" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;margin-left:6px;" title="Move Up">↑</button>' : '';
    const moveDownBtn = canEdit(p) && !isLast ? '<button onclick="moveProductTask(\'' + p.id + '\', \'' + task.id + '\', 1)" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;margin-left:6px;" title="Move Down">↓</button>' : '';
    const deleteBtn = canEdit(p) ? '<button onclick="deleteProductTask(\'' + p.id + '\', \'' + task.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--red);cursor:pointer;font-family:Poppins,sans-serif;margin-left:6px;" title="Delete Task">✕</button>' : '';
    const editBtn = canEdit(p) ? '<button onclick="showEditTask(\'' + p.id + '\', \'' + task.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-mid);cursor:pointer;font-family:Poppins,sans-serif;margin-left:6px;" title="Edit task">Edit</button>' : '';
    const insertBelowBtn = canEdit(p) ? '<button onclick="showAddTaskToProduct(\'' + p.id + '\', \'' + task.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--text-mid);cursor:pointer;margin-left:6px;" title="Insert new task right below this one">+</button>' : '';

    // Drag-and-drop reorder — the up/down buttons work fine one step at a
    // time, but dragging a task straight to where it belongs is the more
    // direct way to move it several places in one go.
    const dragHandle = canDrag
      ? '<div class="task-drag-handle" title="Drag to reorder"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/></svg></div>'
      : '';
    const dragAttrs = canDrag
      ? ' draggable="true" ' +
        'ondragstart="event.dataTransfer.setData(\'text/plain\', \'' + task.id + '\'); this.classList.add(\'task-dragging\');" ' +
        'ondragend="this.classList.remove(\'task-dragging\');" ' +
        'ondragover="event.preventDefault(); this.classList.add(\'task-drop-target\');" ' +
        'ondragleave="this.classList.remove(\'task-drop-target\');" ' +
        'ondrop="event.preventDefault(); this.classList.remove(\'task-drop-target\'); reorderProductTaskDrag(\'' + p.id + '\', event.dataTransfer.getData(\'text/plain\'), \'' + task.id + '\');"'
      : '';

    // Which status bucket this task displays under — a task's group is
    // derived purely from its status/deadline, never from its manual
    // order, so dragging it around never moves it between groups.
    const groupKey = isBlocked ? 'blocked'
      : (meta.cls === 'overdue' || meta.cls === 'delayed') ? 'overdue'
      : meta.cls === 'due-soon' ? 'due-soon'
      : meta.cls === 'complete' ? 'complete'
      : meta.cls === 'deprioritized' ? 'deprioritized'
      : 'on-track';

    const rowDeptAttr = String(task.ownerDept || '').replace(/"/g, '&quot;');
    const rowDeadlineAttr = task.deadline || '';
    return { groupKey, html: '<div class="pillar-detail-row' + (isBlocked ? ' pillar-row-blocked' : '') + '" id="pdr-' + task.id + '" data-dept="' + rowDeptAttr + '" data-status="' + effStatus + '" data-deadline="' + rowDeadlineAttr + '" data-title="' + String(task.title || task.name || '').toLowerCase().replace(/"/g,'&quot;') + '"' + dragAttrs + '>' +
      dragHandle +
      '<div class="pillar-detail-num">' + (i + 1) + '</div>' +
      '<div class="pillar-detail-body">' +
        '<div class="pillar-detail-name">' + (task.title || task.name || 'Untitled task') + '</div>' +
        '<div class="pillar-detail-meta">' +
          ownerDisplay +
          deadlineChip +
          visPill +
          ackBadge +
        '</div>' +
        blockedHint + spinLink +
      '</div>' +
      '<div class="pillar-detail-actions" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
        statusEl + editBtn + reassignBtn + spinOutBtn + insertBelowBtn + moveUpBtn + moveDownBtn + deleteBtn +
      '</div>' +
    '</div>' };
  });

  // Group into sections — Blocked and Overdue need eyes on them first;
  // Complete needs almost none. Order/labels/pill colours match the same
  // language used in My Actions & To-do elsewhere in the app.
  const GROUP_ORDER  = ['blocked', 'overdue', 'due-soon', 'on-track', 'deprioritized', 'complete'];
  const GROUP_LABEL  = { blocked: 'Blocked', overdue: 'Overdue', 'due-soon': 'Due soon', 'on-track': 'On track', deprioritized: 'Stepped down', complete: 'Complete' };
  const GROUP_PILL   = { blocked: 'pcf-pill-amber', overdue: 'pcf-pill-red', 'due-soon': 'pcf-pill-amber', 'on-track': 'pcf-pill-green', deprioritized: 'pcf-pill-grey', complete: 'pcf-pill-blue' };
  const grouped = {};
  rows.forEach(r => { (grouped[r.groupKey] = grouped[r.groupKey] || []).push(r.html); });

  // Departments actually present, for the filter dropdown below — built
  // from what's really on these tasks rather than the org-wide list, so
  // there's never an option that filters to nothing.
  const deptsPresent = Array.from(new Set(tasks.map(t => t.ownerDept).filter(Boolean))).sort();

  const rowsHtml = GROUP_ORDER
    .filter(key => grouped[key] && grouped[key].length)
    .map(key => {
      const groupId = 'taskgrp-' + p.id + '-' + key;
      const startCollapsed = key === 'complete'; // least need to look at these by default
      return (
      '<div class="task-group-header" data-group-key="' + key + '" onclick="toggleTaskGroup(\'' + groupId + '\')">' +
        '<svg id="' + groupId + '-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="transition:transform .15s;' + (startCollapsed ? '' : 'transform:rotate(90deg);') + '"><path d="M9 18l6-6-6-6"/></svg>' +
        '<span class="pcf-pill ' + GROUP_PILL[key] + '" style="text-transform:uppercase;">' + GROUP_LABEL[key] + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">' + grouped[key].length + ' task' + (grouped[key].length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div id="' + groupId + '" class="task-group-grid" style="display:' + (startCollapsed ? 'none' : 'grid') + ';">' +
        grouped[key].join('') +
      '</div>');
    }).join('');

  const filterBarHtml = tasks.length > 3 ? (
    '<div class="task-filter-bar" id="task-filter-bar-' + p.id + '">' +
      '<input type="text" class="input-field" id="tf-search-' + p.id + '" placeholder="Search tasks..." style="flex:1.4;min-width:140px;" oninput="filterPillarTasks(\'' + p.id + '\')"/>' +
      (deptsPresent.length > 1 ? '<select class="input-field" id="tf-dept-' + p.id + '" style="flex:1;min-width:120px;" onchange="filterPillarTasks(\'' + p.id + '\')"><option value="">All departments</option>' +
        deptsPresent.map(d => '<option value="' + d.replace(/"/g,'&quot;') + '">' + d + '</option>').join('') + '</select>' : '') +
      '<select class="input-field" id="tf-status-' + p.id + '" style="flex:1;min-width:120px;" onchange="filterPillarTasks(\'' + p.id + '\')">' +
        '<option value="">All statuses</option>' +
        GROUP_ORDER.filter(k => grouped[k]).map(k => '<option value="' + k + '">' + GROUP_LABEL[k] + '</option>').join('') +
      '</select>' +
      '<select class="input-field" id="tf-date-' + p.id + '" style="flex:1;min-width:120px;" onchange="filterPillarTasks(\'' + p.id + '\')">' +
        '<option value="">Any date</option><option value="overdue">Overdue</option><option value="week">Due this week</option><option value="month">Due this month</option><option value="nodate">No date set</option>' +
      '</select>' +
      '<button class="btn-link-sm" onclick="clearPillarTaskFilters(\'' + p.id + '\')">Clear</button>' +
    '</div>'
  ) : '';

  const editBtn = currentRole === 'admin'
    ? '<button class="btn-primary" onclick="editProduct(\'' + p.id + '\')">Edit dates</button>'
    : '';
  const addTaskBtn = canEdit(p)
    ? '<button class="btn-outline" style="font-size:12px;" onclick="showAddTaskToProduct(\'' + p.id + '\')">+ Add task</button>'
    : '';
  return (addTaskBtn ? '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">' + addTaskBtn + '</div>' : '') +
    filterBarHtml + '<div class="pillar-detail-list" id="pillar-detail-list-' + p.id + '">' + rowsHtml + '</div>' +
    '<div id="modal-reassign-panel" style="padding:0;"></div>' +
    '<div class="form-actions">' + addTaskBtn + editBtn + '<button class="btn-outline" onclick="closeProductModal()">Close</button></div>';
}

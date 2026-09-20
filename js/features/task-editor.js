/* features/task-editor.js — Task rows inside the product form, owners, add-task-to-product. */

import { db, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentRole, currentUser, currentUserDept, currentView, isSuperAdmin } from '../core/state.js';
import { getDepts, STAKEHOLDERS, TEAM_MEMBERS } from '../data/app-config.js';
import { canEdit, canViewBudget, getTaskVisibility, isProductLocked, TASK_VISIBILITY } from '../data/permissions.js';
import { saveAsTemplate } from '../data/templates.js';
import { generateTaskId, getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { formatDate } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { _pendingItemType, ensureProductModal } from './product-form.js';
import { pushSheetIfLinked } from './export-sheet.js';
import { renderTrackerTable } from '../views/tracker.js';
import { logActivity } from './activity.js';

export let _editingTasks    = [];   // live task list during product creation

export function buildTaskEditorForm() {
  const taskRows = _editingTasks.map((t, i) => buildTaskRow(t, i)).join('');
  return `
    <div class="form-section-label">Details</div>
    <div class="form-row" style="margin-bottom:16px;">
      <label class="form-label">Type</label>
      <div style="display:flex;gap:8px;">
        <button id="type-btn-product" class="type-toggle-btn${_pendingItemType === 'product' ? ' type-toggle-active' : ''}" onclick="setItemType('product')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
          Product
        </button>
        <button id="type-btn-project" class="type-toggle-btn${_pendingItemType === 'project' ? ' type-toggle-active' : ''}" onclick="setItemType('project')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
          Project
        </button>
      </div>
      <input type="hidden" id="f-item-type" value="${_pendingItemType}"/>
    </div>
    <div class="form-row">
      <label class="form-label">Product name <span class="req">*</span></label>
      <input type="text" id="f-name" class="input-field" placeholder="e.g. Lakowe Garden Terrace Phase 3"/>
    </div>
    <div class="form-row">
      <label class="form-label">Description</label>
      <textarea id="f-desc" class="input-field" rows="2" placeholder="Brief description..."></textarea>
    </div>
    <div class="form-row">
      <label class="form-label">Project picture <span class="form-hint">— shown on the dashboard and project list</span></label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div id="f-image-preview-wrap" style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:#F3F4F6;border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </div>
        <button type="button" class="btn-outline" onclick="pickProjectImage('f-image-url','f-image-preview-wrap','f-name')">Choose photo</button>
      </div>
      <input type="hidden" id="f-image-url" value=""/>
    </div>
    <div class="form-row">
      <label class="form-label">${_pendingItemType === 'project' ? 'Target completion date' : 'Target launch date'} <span class="req">*</span></label>
      <input type="date" id="f-launch" class="input-field"/>
    </div>
    <div id="budget-fields" style="display:${_pendingItemType === 'project' ? 'block' : 'none'};">
      <div class="form-row">
        <label class="form-label">Budget (₦) <span class="form-hint">— projects only, visible to owner and admins</span></label>
        <input type="number" id="f-budget" class="input-field" placeholder="e.g. 5000000"/>
      </div>
      <div class="form-row">
        <label class="form-label">Spend to date (₦)</label>
        <input type="number" id="f-spend" class="input-field" placeholder="e.g. 1500000"/>
      </div>
    </div>
    ${buildOwnerField(null)}

    <div class="form-section-label" style="margin-top:20px;">
      <span>Tasks <span class="form-hint">— ${_editingTasks.length} task${_editingTasks.length!==1?'s':''}</span></span>
    </div>
    <div id="task-editor-list">
      ${taskRows || '<div class="muted" style="padding:12px 0;font-size:13px;">No tasks yet. Add one below.</div>'}
      <button class="btn-outline" style="margin-top:10px;width:100%;font-size:12px;" onclick="addNewTaskRow()">+ Add task</button>
    </div>

    <div class="form-actions" style="flex-direction:column;gap:8px;">
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn-outline" onclick="showCreateProduct()">← Back</button>
        <button class="btn-outline" onclick="saveAsTemplatePrompt()">Save as template</button>
        <button id="save-product-btn" class="btn-primary" onclick="saveProduct('')">Create ${_pendingItemType === 'project' ? 'project' : 'product'}</button>
      </div>
    </div>`;
}

function buildOwnerDeptOptions(selectedDept) {
  return getDepts().map(d =>
    '<option value="' + d + '"' + (selectedDept === d ? ' selected' : '') + '>' + d + '</option>'
  ).join('');
}

/* Owner options carry the EMAIL as the value — email is the canonical
   identity. The visible label is the name, which may be renamed freely
   in the People tab without breaking any task assignment. */
export function buildOwnerIndividualOptions(dept, selectedEmail) {
  const members = STAKEHOLDERS.filter(s => s.dept === dept && s.enabled !== false);
  if (!members.length) return '<option value="">— no members —</option>';
  return members.map(s =>
    '<option value="' + s.email + '"' +
      ' data-name="' + (s.name || '').replace(/"/g, '') + '"' +
      (selectedEmail === s.email ? ' selected' : '') + '>' +
      (s.isDeptEmail ? dept + ' (whole dept)' : s.name) +
    '</option>'
  ).join('');
}

// Display helper: email → current name from the directory, with graceful fallback
export function ownerLabel(o) {
  if (!o) return 'Unassigned';
  if (o.email) {
    const s = STAKEHOLDERS.find(x => x.email === o.email);
    if (s) return s.isDeptEmail ? (s.dept + ' (dept)') : s.name;
    return o.nameCache || o.email;
  }
  return o.individual || o.dept || 'Unassigned';
}

function buildTaskRow(t, i) {
  const predOptions = _editingTasks
    .filter(x => x.id !== t.id)
    .map(x => '<option value="' + x.id + '"' + ((t.predecessors||[]).includes(x.id) ? ' selected' : '') + '>' + (x.title||'Untitled') + '</option>')
    .join('');

  // Multi-department owner chips — stored in t.owners as [{ dept, individual }]
  const owners = t.owners && t.owners.length > 0 ? t.owners : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
  const ownerChips = owners.map((o, oi) =>
    '<span style="display:inline-flex;align-items:center;gap:4px;background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500;">' +
      ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '') +
      '<button onclick="removeTaskOwner(\'' + t.id + '\',' + oi + ')" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:12px;line-height:1;padding:0 1px;">×</button>' +
    '</span>'
  ).join('');

  const firstDept = getDepts()[0] || '';

  return '<div class="task-edit-row" id="terow-' + t.id + '">' +
    '<div class="task-edit-header">' +
      '<div class="task-edit-num">' + (i+1) + '</div>' +
      '<input type="text" class="input-field task-edit-title" placeholder="Task name" value="' + (t.title||'') + '"' +
        ' onblur="updateEditingTask(\'' + t.id + '\',\'title\',this.value)"/>' +
      '<button class="btn-danger-xs" onclick="removeEditingTask(\'' + t.id + '\')">✕</button>' +
    '</div>' +
    '<div class="task-edit-body">' +
      '<div class="task-edit-col">' +
        '<label class="form-label">Deadline <span class="req">*</span></label>' +
        '<input type="date" class="input-field" value="' + (t.deadline||'') + '"' +
          ' onchange="updateEditingTask(\'' + t.id + '\',\'deadline\',this.value)"/>' +
      '</div>' +
      '<div class="task-edit-col task-edit-col-wide" style="grid-column:span 2; overflow:visible;">' +
        '<label class="form-label">Owners <span class="form-hint">— add multiple departments/individuals</span></label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;" id="owner-chips-' + t.id + '">' +
          (ownerChips || '<span style="font-size:11px;color:#9CA3AF;">No owners assigned</span>') +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;max-width:100%;">' +
          '<select id="add-dept-' + t.id + '" class="select-field" style="flex:1;" onchange="updateAddIndividuals(\'' + t.id + '\')">' +
            getDepts().map(d => '<option value="' + d + '">' + d + '</option>').join('') +
          '</select>' +
          '<select id="add-ind-' + t.id + '" class="select-field" style="flex:1;">' +
            buildOwnerIndividualOptions(firstDept, '') +
          '</select>' +
          '<button class="btn-outline" style="font-size:11px;white-space:nowrap;padding:7px 10px;" onclick="addTaskOwner(\'' + t.id + '\')">' +
            '+ Add' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="task-edit-col">' +
        '<label class="form-label">Visibility</label>' +
        '<select class="select-field" onchange="updateEditingTask(\'' + t.id + '\',\'visibility\',this.value)">' +
          Object.keys(TASK_VISIBILITY).map(function(k) {
            return '<option value="' + k + '"' + (getTaskVisibility(t) === k ? ' selected' : '') + '>' +
              TASK_VISIBILITY[k].label + ' — ' + TASK_VISIBILITY[k].desc + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="task-edit-col">' +
        '<label class="form-label">Recurrence</label>' +
        '<select class="select-field" onchange="updateEditingTask(\'' + t.id + '\',\'recurrence\',this.value)">' +
          '<option value="none"' + (t.recurrence === 'none' || !t.recurrence ? ' selected' : '') + '>None</option>' +
          '<option value="weekly"' + (t.recurrence === 'weekly' ? ' selected' : '') + '>Weekly</option>' +
          '<option value="monthly"' + (t.recurrence === 'monthly' ? ' selected' : '') + '>Monthly</option>' +
          '<option value="quarterly"' + (t.recurrence === 'quarterly' ? ' selected' : '') + '>Quarterly</option>' +
        '</select>' +
      '</div>' +
      '<div class="task-edit-col task-edit-col-wide">' +
        '<label class="form-label">Depends on <span class="form-hint">— hold Ctrl/Cmd for multiple</span></label>' +
        '<select class="select-field" multiple style="height:52px;font-size:12px;" onchange="updateEditingTaskPreds(\'' + t.id + '\',this)">' +
          '<option value="" disabled style="color:var(--text-muted);">No dependency</option>' +
          predOptions +
        '</select>' +
      '</div>' +
    '</div>' +
  '</div>';
}

window.updateAddIndividuals = (taskId) => {
  const dept = document.getElementById('add-dept-' + taskId)?.value || '';
  if (dept) window._stickyDept = dept; // Remember chosen dept
  const sel  = document.getElementById('add-ind-' + taskId);
  if (sel) sel.innerHTML = buildOwnerIndividualOptions(dept, '');
};

window.addTaskOwner = (taskId) => {
  const t = _editingTasks.find(x => x.id === taskId);
  if (!t) return;
  const dept   = document.getElementById('add-dept-' + taskId)?.value || '';
  const sel    = document.getElementById('add-ind-' + taskId);
  const email  = sel?.value || '';
  const nameCache = sel?.selectedOptions?.[0]?.dataset?.name || '';
  if (!email && !dept) return;
  if (!t.owners) t.owners = [];
  if (t.owners.some(o => o.email === email && o.dept === dept)) {
    showToast('Already assigned', 'info'); return;
  }
  t.owners.push({ dept, email, nameCache });
  // Legacy mirrors — display only, never used for routing
  if (t.owners.length === 1) { t.owner = nameCache || dept; t.ownerDept = dept; t.ownerEmail = email; }
  // Re-render just the chips
  const chipsEl = document.getElementById('owner-chips-' + taskId);
  if (chipsEl) {
    chipsEl.innerHTML = t.owners.map((o, oi) =>
      '<span style="display:inline-flex;align-items:center;gap:4px;background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500;">' +
        ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '') +
        '<button onclick="removeTaskOwner(\'' + taskId + '\',' + oi + ')" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:12px;line-height:1;padding:0 1px;">×</button>' +
      '</span>'
    ).join('');
  }
};

window.removeTaskOwner = (taskId, ownerIndex) => {
  const t = _editingTasks.find(x => x.id === taskId);
  if (!t || !t.owners) return;
  t.owners.splice(ownerIndex, 1);
  if (t.owners.length > 0) { t.owner = ownerLabel(t.owners[0]); t.ownerDept = t.owners[0].dept; t.ownerEmail = t.owners[0].email || ''; }
  else { t.owner = ''; t.ownerDept = ''; t.ownerEmail = ''; }
  const chipsEl = document.getElementById('owner-chips-' + taskId);
  if (chipsEl) {
    chipsEl.innerHTML = t.owners.length
      ? t.owners.map((o, oi) =>
          '<span style="display:inline-flex;align-items:center;gap:4px;background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500;">' +
            ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '') +
            '<button onclick="removeTaskOwner(\'' + taskId + '\',' + oi + ')" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:12px;line-height:1;padding:0 1px;">×</button>' +
          '</span>'
        ).join('')
      : '<span style="font-size:11px;color:#9CA3AF;">No owners assigned</span>';
  }
};

window.updateTaskOwnerDept = (id, dept) => {
  const t = _editingTasks.find(x => x.id === id);
  if (!t) return;
  t.ownerDept = dept;
  t.owner = dept;
  t.ownerIndividual = '';
  const indCol = document.getElementById('ind-col-' + id);
  if (indCol) {
    const sel = indCol.querySelector('select');
    if (sel) sel.innerHTML = buildOwnerIndividualOptions(dept, '');
  }
};

function renderTaskEditorList() {
  const container = document.getElementById('task-editor-list');
  if (!container) return;
  container.innerHTML = (_editingTasks.length
    ? _editingTasks.map((t, i) => buildTaskRow(t, i)).join('')
    : '<div class="muted" style="padding:12px 0;font-size:13px;">No tasks yet. Add one below.</div>') +
    '<button class="btn-outline" style="margin-top:10px;width:100%;font-size:12px;" onclick="addNewTaskRow()">' +
      '+ Add task' +
    '</button>';
}

window.addNewTaskRow = () => {
  const defaultDept = window._stickyDept || currentUserDept || getDepts()[0] || '';
  const t = {
    id: generateTaskId(), title: '', owner: '',
    ownerDept: defaultDept, ownerIndividual: '',
    deadline: '', status: 'on-track', visibility: 'private', recurrence: 'none',
    predecessors: [], locked: false, pillarId: null,
    order: _editingTasks.length, kanbanCol: 'todo',
  };
  _editingTasks.push(t);
  renderTaskEditorList();
  setTimeout(() => {
    const newRow = document.getElementById('terow-' + t.id);
    if (newRow) newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
};

window.removeEditingTask = (id) => {
  _editingTasks = _editingTasks.filter(t => t.id !== id);
  renderTaskEditorList();
};

window.updateEditingTask = (id, field, value) => {
  const t = _editingTasks.find(x => x.id === id);
  if (t) t[field] = value;
};

window.updateEditingTaskPreds = (id, sel) => {
  const t = _editingTasks.find(x => x.id === id);
  if (t) t.predecessors = [...sel.selectedOptions].map(o => o.value);
};

window.saveAsTemplatePrompt = async () => {
  const name = prompt('Template name:');
  if (!name) return;
  await saveAsTemplate(name, _editingTasks);
  showToast('Template saved: ' + name, 'success');
};

export function buildEditProductForm(p) {
  // Edit mode — show existing tasks with locked status
  const tasks = getProductTasks(p);
  const locked = isProductLocked(p); 
  const taskRows = tasks.map((t, i) => {
    // FIX: Only lock the date input if the task is already finished. 
    // This allows you to assign dates to newly unblocked or overdue tasks.
    const isLocked = t.status === 'complete';
    
    const preds = t.predecessors?.length > 0
      ? '<span style="font-size:11px;color:var(--text-muted);">Depends on: ' +
        t.predecessors.map(pid => {
          const dep = tasks.find(x => x.id === pid);
          return dep ? dep.title : pid;
        }).join(', ') + '</span>'
      : '';
      
    return `<div class="pillar-date-row ${isLocked ? 'task-locked-row' : ''}">
      <div class="pillar-date-num">${i+1}</div>
      <div class="pillar-date-name">
        ${isLocked ? ICON.check + ' ' : ''}${t.title}
        <span class="pillar-owner">${t.owner || ''}</span>
        ${preds}
      </div>
      ${!isLocked
        ? `<input type="date" id="f-task-${t.id}" class="input-field pillar-date-input" value="${t.deadline||''}"/>`
        : `<span class="pill pill-grey" style="font-size:11px;">${t.deadline ? formatDate(t.deadline) : 'No date'}</span>`
      }
      <button onclick="showTaskHistory('${p.id}', '${t.id}')" style="background:none;border:none;cursor:pointer;margin-left:8px;font-size:15px;opacity:0.6;vertical-align:middle;" title="View Task History"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
    </div>`;
  }).join('');

  const itemType = p.itemType || 'product';
  const convertLabel = itemType === 'project' ? 'Convert to Product' : 'Convert to Project';
  const budgetFields = (itemType === 'project' && canViewBudget(p)) ? `
    <div class="form-row">
      <label class="form-label">Budget (₦)</label>
      <input type="number" id="f-budget" class="input-field" value="${p.budget ?? ''}"/>
    </div>
    <div class="form-row">
      <label class="form-label">Spend to date (₦)</label>
      <input type="number" id="f-spend" class="input-field" value="${p.spend ?? ''}"/>
    </div>` : '';

  const ownerKey = p?.ownerId || sanitiseEmail(currentUser.email);
  const ownerMember = TEAM_MEMBERS[ownerKey];

  return `
    <div class="form-section-label">Product details</div>
    <div class="form-row"><label class="form-label">Product name <span class="req">*</span></label>
      <input type="text" id="f-name" class="input-field" value="${p.name||''}"/></div>
    <div class="form-row"><label class="form-label">Description</label>
      <textarea id="f-desc" class="input-field" rows="2">${p.description||''}</textarea></div>
    <div class="form-row">
      <label class="form-label">Project picture <span class="form-hint">— shown on the dashboard and project list</span></label>
      <div style="display:flex;align-items:center;gap:12px;">
        <div id="f-image-preview-wrap" style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:#F3F4F6;border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
          ${p.imageUrl ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover;"/>` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`}
        </div>
        <button type="button" class="btn-outline" onclick="pickProjectImage('f-image-url','f-image-preview-wrap','f-name')">Change photo</button>
      </div>
      <input type="hidden" id="f-image-url" value="${p.imageUrl||''}"/>
    </div>
    <div class="form-row"><label class="form-label">Target launch date <span class="req">*</span></label>
      <input type="date" id="f-launch" class="input-field" value="${p.launchDate||''}"/></div>
    ${buildOwnerField(p)}
    <div class="form-section-label" style="margin-top:20px;display:flex;align-items:center;justify-content:space-between;">
      <span>Tasks ${locked ? '<span class="pill pill-red" style="font-size:10px;">Milestone Lapsed</span>' : ''}</span>
      <button class="btn-primary-sm" onclick="showAddTaskToProduct('${p.id}')">+ Add task</button>
    </div>
    <div>${taskRows}</div>
    <div class="form-section-label" style="margin-top:20px;">Alert & email settings</div>
    <div class="form-row" style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:13px;font-weight:500;">Deadline alerts</div>
        <div style="font-size:12px;color:var(--text-muted);">Send daily reminders for overdue and upcoming tasks</div>
      </div>
      <label class="cb-toggle">
        <input type="checkbox" id="f-alerts-enabled" ${(p.alertsEnabled ?? true) ? 'checked' : ''}/>
        <span class="cb-toggle-track"><span class="cb-toggle-thumb"></span></span>
      </label>
    </div>
    <div class="form-row">
      <label class="form-label">Alert recipients <span class="form-hint">— override default (product owner). One per line.</span></label>
      <textarea id="f-alert-recipients" class="input-field" rows="2"
        placeholder="Leave blank to use product owner&#10;e.g. colleague@mixtafrica.com"></textarea>
    </div>
    <div class="form-row">
      <label class="form-label">Default CC list <span class="form-hint">— pre-loaded in every email composer for this product. One per line.</span></label>
      <textarea id="f-default-ccs" class="input-field" rows="2"
        placeholder="e.g. t.akinsulire@mixtafrica.com&#10;e.g. deji.alli@mixtafrica.com"></textarea>
    </div>
    <div class="form-row">
      <label class="form-label">Escalation chain <span class="form-hint">— who gets added when tasks are severely overdue</span></label>
      <div class="escalation-chain-editor" id="escalation-editor"></div>
      <button class="btn-outline" style="font-size:11px;margin-top:6px;" onclick="addEscalationLevel('${p.id}')">+ Add escalation level</button>
    </div>
    ${budgetFields}
    <div class="form-actions">
      <button class="btn-outline" onclick="convertItemType('${p.id}','${itemType}')" style="margin-right:auto;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle;"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        ${convertLabel}
      </button>
      
      ${canEdit(p) && p.status !== 'archived' ? `<button class="btn-outline" style="color:var(--amber);border-color:var(--amber);margin-right:auto;" onclick="archiveProduct('${p.id}')">Archive</button>` : ''}
      ${isSuperAdmin ? `<button class="btn-outline" style="color:var(--red);border-color:var(--red);margin-right:auto;" onclick="saDeleteProject('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Wipe</button>` : ''}
      
      <button class="btn-outline" onclick="closeProductModal()">Cancel</button>
      <button class="btn-primary" onclick="saveProduct('${p.id}')">Save changes</button>
    </div>`;
}

function buildOwnerField(p) {
  const ownerOptions = currentRole === 'admin'
    ? Object.entries(TEAM_MEMBERS).map(([key, m]) =>
        `<option value="${key}" ${(p?.ownerId || sanitiseEmail(currentUser.email)) === key ? 'selected' : ''}>${m.name}</option>`
      ).join('')
    : `<option value="${sanitiseEmail(currentUser.email)}">${currentUser.displayName || currentUser.email}</option>`;
  return currentRole === 'admin'
    ? `<div class="form-row"><label class="form-label">Product owner</label>
        <select id="f-owner" class="select-field" style="width:100%;">${ownerOptions || '<option>No team members yet</option>'}</select></div>`
    : '';
}

window.showAddTaskToProduct = (productId, insertAfterTaskId) => {
  ensureProductModal();
  const prod = productListCache[productId];
  if (!prod) return;
  window._atInsertAfter = insertAfterTaskId || null;
  const defaultDept = window._stickyDept || currentUserDept || getDepts()[0] || '';
  
  const tasks = getProductTasks(prod);
  const predOptions = tasks.map(t => '<option value="' + t.id + '">' + (t.title || t.name || 'Untitled') + '</option>').join('');

  document.getElementById('modal-title-text').textContent = insertAfterTaskId ? 'Insert task — ' + prod.name : 'Add task — ' + prod.name;
  document.getElementById('modal-body-content').innerHTML =
    '<p style="font-size:13px;color:var(--text-mid);margin-bottom:16px;line-height:1.7;">' + (insertAfterTaskId ? 'This will be inserted right below the task you clicked "+" on.' : 'Add a new task to this product.') + '</p>' +
    '<div class="form-row"><label class="form-label">Task name <span class="req">*</span></label>' +
      '<input type="text" id="at-title" class="input-field" placeholder="e.g. Regulatory approval"/></div>' +
    '<div class="form-row">' +
      '<label class="form-label">Owners <span class="form-hint">— add multiple departments/individuals</span></label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;" id="at-owner-chips"><span style="font-size:11px;color:#9CA3AF;">No owners yet</span></div>' +
      '<div style="display:flex;gap:6px;align-items:flex-end;">' +
        '<select id="at-dept" class="select-field" style="flex:1;" onchange="updateAddTaskIndividuals()">' +
          '<option value="">-- Dept --</option>' +
          getDepts().map(d => '<option value="' + d + '"' + (d === defaultDept ? ' selected' : '') + '>' + d + '</option>').join('') +
        '</select>' +
        '<select id="at-owner" class="select-field" style="flex:1;">' +
          buildOwnerIndividualOptions(defaultDept, '') +
        '</select>' +
        '<button class="btn-outline" style="font-size:11px;padding:7px 10px;white-space:nowrap;" onclick="addNewTaskOwnerChip()">+ Add</button>' +
      '</div>' +
    '</div>' +
    '<div class="form-row"><label class="form-label">Depends on <span class="form-hint">— hold Ctrl/Cmd for multiple</span></label>' +
      '<select id="at-preds" class="select-field" multiple style="height:60px;font-size:12px;">' +
        '<option value="" disabled style="color:var(--text-muted);">No dependency</option>' +
        predOptions +
      '</select>' +
    '</div>' +
    '<div class="form-row" style="display:flex;gap:10px;">' +
      '<div style="flex:1;"><label class="form-label">Deadline <span class="form-hint">— optional if task depends on another</span></label>' +
        '<input type="date" id="at-deadline" class="input-field" style="width:100%;"/></div>' +
      '<div style="flex:1;"><label class="form-label">Recurrence</label>' +
        '<select id="at-recurrence" class="select-field" style="width:100%;">' +
          '<option value="none">None</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>' +
        '</select></div>' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="addTaskToProduct(\'' + productId + '\')">' + (insertAfterTaskId ? 'Insert task' : 'Add task') + '</button>' +
    '</div>';
  document.getElementById('create-product-modal').style.display = 'flex';
  window._atOwners = [];
};

window.updateAddTaskIndividuals = () => {
  const dept = document.getElementById('at-dept')?.value || '';
  if (dept) window._stickyDept = dept; // Remember chosen dept
  const sel  = document.getElementById('at-owner');
  if (sel) sel.innerHTML = buildOwnerIndividualOptions(dept, '');
};

window.addNewTaskOwnerChip = () => {
  const dept  = document.getElementById('at-dept')?.value || '';
  const sel   = document.getElementById('at-owner');
  const email = sel?.value || '';
  const nameCache = sel?.selectedOptions?.[0]?.dataset?.name || '';
  if (!email && !dept) return;
  if (!window._atOwners) window._atOwners = [];
  if (window._atOwners.some(o => o.email === email && o.dept === dept)) {
    showToast('Already added', 'info'); return;
  }
  window._atOwners.push({ dept, email, nameCache });
  const chips = document.getElementById('at-owner-chips');
  if (chips) {
    chips.innerHTML = window._atOwners.map((o, i) =>
      '<span style="display:inline-flex;align-items:center;gap:4px;background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500;">' +
        ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '') +
        '<button onclick="removeAtOwner(' + i + ')" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:12px;padding:0 1px;">×</button>' +
      '</span>'
    ).join('');
  }
};

window.removeAtOwner = (i) => {
  if (!window._atOwners) return;
  window._atOwners.splice(i, 1);
  const chips = document.getElementById('at-owner-chips');
  if (chips) {
    chips.innerHTML = window._atOwners.length
      ? window._atOwners.map((o, idx) =>
          '<span style="display:inline-flex;align-items:center;gap:4px;background:#EFF6FF;color:#2563EB;border:1px solid #BFDBFE;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:500;">' +
            ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '') +
            '<button onclick="removeAtOwner(' + idx + ')" style="background:none;border:none;cursor:pointer;color:#2563EB;font-size:12px;padding:0 1px;">×</button>' +
          '</span>'
        ).join('')
      : '<span style="font-size:11px;color:#9CA3AF;">No owners yet</span>';
  }
};

window.addTaskToProduct = async (productId) => {
  const title    = document.getElementById('at-title')?.value.trim();
  const deadline = document.getElementById('at-deadline')?.value || '';
  const recurrence = document.getElementById('at-recurrence')?.value || 'none';
  
  // 1. Capture selected dependencies
  const predSelect = document.getElementById('at-preds');
  const predecessors = predSelect ? Array.from(predSelect.selectedOptions).map(o => o.value).filter(v => v) : [];
  
  if (!title) { showToast('Task name required.', 'error'); return; }
  
  // 2. Only enforce deadline if NO predecessors are selected
  if (!deadline && predecessors.length === 0) { 
    showToast('Deadline is required if no dependency is set.', 'error'); 
    return; 
  }

  // Auto-capture lingering dropdown selections if the user forgot to click "+ Add"
  const dept = document.getElementById('at-dept')?.value || '';
  const email = document.getElementById('at-owner')?.value || '';
  const nameCache = document.getElementById('at-owner')?.selectedOptions?.[0]?.dataset?.name || '';
  
  if (!window._atOwners) window._atOwners = [];
  
  if (dept || email) {
    if (!window._atOwners.some(o => o.email === email && o.dept === dept)) {
      window._atOwners.push({ dept, email, nameCache });
    }
  }

  const owners = window._atOwners;
  // Gracefully fallback to dept name if an individual person isn't selected
  const primaryOwner = owners.length > 0 ? (owners[0].nameCache || owners[0].dept || owners[0].email) : '';
  const primaryDept  = owners.length > 0 ? owners[0].dept : '';
  const primaryEmail = owners.length > 0 ? (owners[0].email || '') : '';

  const prod   = productListCache[productId];
  const tasks  = getProductTasks(prod);
  const taskId = generateTaskId();
  const insertAfter = window._atInsertAfter;
  const insertIdx = insertAfter ? tasks.findIndex(t => t.id === insertAfter) : -1;
  const order = insertIdx >= 0 ? insertIdx + 1 : tasks.length;

  const task   = {
    id: taskId, title,
    owner: primaryOwner, ownerDept: primaryDept, ownerEmail: primaryEmail, owners,
    deadline, status: 'on-track', predecessors, locked: false, // <-- 3. Injected predecessors array here
    pillarId: null, order, kanbanCol: 'todo',
    createdAt: Date.now(), createdBy: currentUser.email,
  };

  await set(ref(db, 'products/' + productId + '/tasks/' + taskId), task);
  if (!productListCache[productId].tasks) productListCache[productId].tasks = {};
  productListCache[productId].tasks[taskId] = task;

  // Inserting mid-list, not appending — push everything from that point on
  // up by one so order stays a clean, gapless sequence rather than ties.
  if (insertIdx >= 0) {
    const orderUpdates = {};
    tasks.forEach((t, i) => {
      const newOrder = i <= insertIdx ? i : i + 1;
      if (t.order !== newOrder) {
        const tPath = productListCache[productId].tasks?.[t.id] ? 'tasks/' + t.id + '/order' : 'pillars/' + t.id + '/order';
        orderUpdates[tPath] = newOrder;
        t.order = newOrder;
      }
    });
    for (const op in orderUpdates) {
      await set(ref(db, 'products/' + productId + '/' + op), orderUpdates[op]);
    }
  }
  window._atInsertAfter = null;
  window._atOwners = [];

  await logActivity(productId, 'task_added', 'New task added: ' + title,
    'Owners: ' + (owners.map(o => ownerLabel(o)).join(', ') || 'Unassigned'), taskId);
  // Keep the live sheet current if this item already has one
  pushSheetIfLinked(productId);

  // Notify everyone assigned, unless they assigned it to themselves
  const notify = owners.map(o => o.email)
    .filter(e => e && e.indexOf('@') > -1 && e.toLowerCase() !== currentUser.email.toLowerCase());
  if (notify.length > 0) {
    try {
      await callGAS('sendAssignmentAlert', {
        toEmails:    notify,
        productId:   productId,
        productName: prod.name,
        taskId:      taskId,
        taskTitle:   title,
        deadline:    deadline || '',
        assignedBy:  currentPreferredName || currentUser.displayName || currentUser.email,
        sentByName:  currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
        sentByEmail: currentUser.email,
      });
    } catch(e) { console.warn('Assignment alert failed to send:', e); }
  }

  showToast('Task added.' + (notify.length ? ' ' + notify.length + ' person notified.' : ''), 'success');
  if (currentView === 'tracker') renderTrackerTable(productListCache[productId], null);
  // Land back on the Tasks tab with the new task highlighted, rather than
  // wherever this was opened from — adding several tasks in a row used to
  // mean closing the modal, going back to the product list, reopening it,
  // and scrolling back down every single time.
  viewProduct(productId, taskId);
};

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_editingTasks(v) { _editingTasks = v; }

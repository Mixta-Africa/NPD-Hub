/* features/product-form.js — Create/edit product form, template chooser, save. */

import { db, ref, set, update } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentUser } from '../core/state.js';
import { PILLARS, TEAM_MEMBERS } from '../data/app-config.js';
import { SAVED_TEMPLATES } from '../data/templates.js';
import { _editingTasks, buildEditProductForm, buildTaskEditorForm, set_editingTasks } from './task-editor.js';
import { generateId, generateTaskId, getProductTasks } from '../data/product-model.js';
import { formatDate } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { loadProductList } from '../views/products.js';
import { renderEscalationEditor } from './email-composer.js';
import { logActivity } from './activity.js';

export function ensureProductModal() {
  let modal = document.getElementById('create-product-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'create-product-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <span class="modal-title" id="modal-title-text"></span>
          <button class="modal-close" onclick="closeProductModal()">✕</button>
        </div>
        <div class="modal-body" id="modal-body-content"></div>
      </div>`;
    document.body.appendChild(modal);
  }
}

/* ── CREATE / EDIT PRODUCT MODAL ── */
window.showCreateProduct = () => {
  _pendingItemType = 'product';
  document.getElementById('modal-title-text').textContent = 'Create new';
  document.getElementById('modal-body-content').innerHTML = buildProductForm(null);
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.editProduct = (id) => {
  const p = productListCache[id];
  if (!p) return;
  document.getElementById('modal-title-text').textContent = 'Edit — ' + p.name;
  document.getElementById('modal-body-content').innerHTML = buildProductForm(p);
  document.getElementById('create-product-modal').style.display = 'flex';
  // Set textarea values that can't be set inside template literals safely
  setTimeout(() => {
    const recipEl = document.getElementById('f-alert-recipients');
    if (recipEl && p.alertRecipients?.length > 0) recipEl.value = p.alertRecipients.join('\n');
    const ccEl = document.getElementById('f-default-ccs');
    if (ccEl && p.defaultCCs?.length > 0) ccEl.value = p.defaultCCs.join('\n');
    // Render escalation chain
    const escEl = document.getElementById('escalation-editor');
    if (escEl) renderEscalationEditor(escEl, p.escalationChain || [], p.id);
  }, 20);
};

window.closeProductModal = () => {
  document.getElementById('create-product-modal').style.display = 'none';
};

function buildProductForm(p) {
  // For existing products — just show edit dates form (legacy)
  if (p) return buildEditProductForm(p);
  // For new products — show template chooser first
  return buildTemplateChooser();
}

function buildTemplateChooser() {
  const templateOptions = Object.values(SAVED_TEMPLATES).map(t =>
    `<div class="template-card" onclick="selectTemplate('${t.id}')">
      <div class="template-name">${t.name}</div>
      <div class="template-meta">${t.tasks?.length || 0} tasks · Saved by ${t.createdBy?.split('@')[0]}</div>
    </div>`
  ).join('');

  return `
    <div class="tmpl-chooser">
      <div style="margin-bottom:20px;">
        <label class="form-label">What are you creating?</label>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button id="step1-type-product" class="type-toggle-btn type-toggle-active" onclick="setStep1Type('product')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            Product
          </button>
          <button id="step1-type-project" class="type-toggle-btn" onclick="setStep1Type('project')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
            Project
          </button>
        </div>
        <div id="step1-type-hint" style="font-size:11px;color:var(--text-muted);margin-top:6px;">
          A product launch — tracked against a target launch date.
        </div>
      </div>
      <p style="font-size:13px;color:var(--text-mid);margin-bottom:20px;line-height:1.7;">
        Now choose how to set up its tasks. You can edit them freely before saving.
      </p>
      <div class="tmpl-options">
        <div class="tmpl-option" onclick="selectTemplate('sop')">
          <div class="tmpl-option-icon">${ICON.clipboard}</div>
          <div class="tmpl-option-title">Default SOP</div>
          <div class="tmpl-option-desc">Pre-filled with Mixta's 12 standard product development pillars</div>
        </div>
        <div class="tmpl-option" onclick="selectTemplate('blank')">
          <div class="tmpl-option-icon">${ICON.note}</div>
          <div class="tmpl-option-title">Blank</div>
          <div class="tmpl-option-desc">Start from scratch and build your own task structure</div>
        </div>
        <div class="tmpl-option" onclick="selectTemplate('import')">
          <div class="tmpl-option-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
          <div class="tmpl-option-title">Import from Excel</div>
          <div class="tmpl-option-desc">Upload a spreadsheet of tasks, owners and deadlines</div>
        </div>
        ${Object.keys(SAVED_TEMPLATES).length > 0 ? `
        <div class="tmpl-section-label">Saved templates</div>
        ${templateOptions}` : ''}
      </div>
    </div>`;
}

window.selectTemplate = (templateId) => {
  if (templateId === 'import') { showImportScreen(); return; }
  // Pre-fill _editingTasks based on template choice
  if (templateId === 'sop') {
    set_editingTasks( PILLARS.map((pl, i) => ({
      id: generateTaskId(), title: pl.name, description: '',
      owner: pl.owner, ownerEmails: [],
      deadline: '', startDate: '', status: 'on-track',
      predecessors: [], locked: false, pillarId: pl.id,
      order: i, kanbanCol: 'todo',
    })));
  } else if (templateId === 'blank') {
    set_editingTasks( []);
  } else {
    // Saved template
    const tmpl = SAVED_TEMPLATES[templateId];
    if (!tmpl) return;
    set_editingTasks( (tmpl.tasks || []).map((t, i) => ({
      ...t, id: generateTaskId(), status: 'on-track',
      deadline: '', startDate: '', order: i, kanbanCol: 'todo',
      predecessors: [], locked: false,
    })));
  }
  document.getElementById('modal-body-content').innerHTML = buildTaskEditorForm();
};

window.convertItemType = async (productId, currentType) => {
  const newType = currentType === 'project' ? 'product' : 'project';
  const label   = newType === 'project' ? 'Project' : 'Product';
  if (!confirm('Convert this to a ' + label + '? All tasks and history are preserved.')) return;
  await set(ref(db, 'products/' + productId + '/itemType'), newType);
  if (productListCache[productId]) productListCache[productId].itemType = newType;
  await logActivity(productId, 'type_changed', 'Converted to ' + label, 'By ' + currentUser.email);
  showToast('Converted to ' + label + '.', 'success');
  closeProductModal();
  loadProductList();
};

export let _pendingItemType = 'product';

window.setStep1Type = (type) => {
  _pendingItemType = type;
  ['product','project'].forEach(t => {
    const b = document.getElementById('step1-type-' + t);
    if (b) b.className = 'type-toggle-btn' + (t === type ? ' type-toggle-active' : '');
  });
  const hint = document.getElementById('step1-type-hint');
  if (hint) hint.textContent = type === 'project'
    ? 'An internal project or workstream — tracked against a target completion date.'
    : 'A product launch — tracked against a target launch date.';
};

window.setItemType = (type) => {
  document.getElementById('f-item-type').value = type;
  ['product','project'].forEach(t => {
    const btn = document.getElementById('type-btn-' + t);
    if (btn) btn.className = 'type-toggle-btn' + (t === type ? ' type-toggle-active' : '');
  });
  // Update the name label
  const nameLabel = document.querySelector('label[for="f-name"], .form-label');
  const launchLabel = document.querySelector('#f-launch')?.closest('.form-row')?.querySelector('.form-label');
  if (launchLabel) launchLabel.textContent = type === 'project' ? 'Target completion date *' : 'Target launch date *';
  const bf = document.getElementById('budget-fields');
  if (bf) bf.style.display = type === 'project' ? 'block' : 'none';
  const saveBtn = document.getElementById('save-product-btn');
  if (saveBtn) saveBtn.textContent = 'Create ' + (type === 'project' ? 'project' : 'product');
};

window.saveProduct = async (existingId) => {
  const name       = document.getElementById('f-name')?.value.trim();
  const desc       = document.getElementById('f-desc')?.value.trim();
  const launchDate = document.getElementById('f-launch')?.value;

  if (!name)       { showToast('Product name is required.', 'error');  return; }
  if (!launchDate) { showToast('Launch date is required.', 'error');   return; }

  const id    = existingId || generateId();
  const isNew = !existingId;
  const dateChanges = [];

  const itemType = (document.getElementById('f-item-type')?.value || 'product');
  const budget   = document.getElementById('f-budget')?.value || '';
  const spend    = document.getElementById('f-spend')?.value  || '';
  
  const ownerFieldEl = document.getElementById('f-owner');
  const ownerKey     = isNew ? (ownerFieldEl?.value || sanitiseEmail(currentUser.email)) : (productListCache[existingId]?.ownerId || sanitiseEmail(currentUser.email));
  const ownerMember  = TEAM_MEMBERS[ownerKey];
  const ownerName    = ownerMember?.name || currentUser.displayName || currentUser.email.split('@')[0];

  try {
    if (isNew) {
      // For brand new products, a full 'set' payload is safe because there are no background logs to erase yet
      const tasks = {};
      _editingTasks.forEach(t => {
        const titleEl = document.querySelector('#terow-' + t.id + ' .task-edit-title');
        if (titleEl) t.title = titleEl.value.trim() || t.title;
        tasks[t.id] = { ...t, createdAt: Date.now(), createdBy: currentUser.email };
      });

      const payload = {
        id, name, description: desc, launchDate, itemType,
        imageUrl: document.getElementById('f-image-url')?.value || '',
        budget: budget !== '' ? Number(budget) : null,
        spend:  spend  !== '' ? Number(spend)  : null,
        tasks, status: 'active',
        taskSchema: (_editingTasks.length > 0 && _editingTasks[0].pillarId ? 'sop' : (_editingTasks.length > 0 && _editingTasks[0].importedAt ? 'imported' : 'custom')),
        baselineLaunchDate: launchDate, ownerId: ownerKey, ownerName, sharedWith: {},
        alertsEnabled: true, alertRecipients: [], defaultCCs: [],
        escalationChain: [{ daysOverdue: 7, addEmails: [] }, { daysOverdue: 21, addEmails: [] }],
        createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser.email,
      };

      await set(ref(db, 'products/' + id), payload);
      productListCache[id] = payload;
      await logActivity(id, 'created', `Product "${name}" created`, `Launch: ${launchDate}`);
      closeProductModal();
      showStakeholderConfirm(payload);

    } else {
      // 🚨 ENTERPRISE FIX: Use atomic 'update' so we don't erase comments or activity logs
      const oldProd = productListCache[existingId] || {};
      const updates = {};
      
      updates['name'] = name;
      updates['description'] = desc;
      updates['imageUrl'] = document.getElementById('f-image-url')?.value || '';
      updates['launchDate'] = launchDate;
      updates['itemType'] = itemType;
      updates['budget'] = budget !== '' ? Number(budget) : null;
      updates['spend'] = spend !== '' ? Number(spend) : null;
      updates['updatedAt'] = Date.now();
      updates['alertsEnabled'] = document.getElementById('f-alerts-enabled')?.checked ?? true;
      updates['alertRecipients'] = document.getElementById('f-alert-recipients')?.value?.split(/\r?\n/).map(e=>e.trim()).filter(Boolean) || [];
      updates['defaultCCs'] = (() => { const el = document.getElementById('f-default-ccs'); return el ? el.value.split(/\r?\n/).map(e=>e.trim()).filter(Boolean) : []; })();

      // Granularly patch each task so we don't overwrite task history
      const existingTaskArr = getProductTasks(oldProd);
      existingTaskArr.forEach(t => {
        const inputEl = document.getElementById('f-task-' + t.id);
        const recEl   = document.getElementById('f-task-rec-' + t.id);
        const d = inputEl ? inputEl.value : t.deadline;
        const rec = recEl ? recEl.value : (t.recurrence || 'none');
        
        if (inputEl && (t.deadline || '') !== (d || '')) {
          dateChanges.push({ id: t.id, name: t.title || t.name, oldD: t.deadline, newD: d });
        }
        
        const pathBase = oldProd.tasks?.[t.id] ? 'tasks' : 'pillars';
        updates[`${pathBase}/${t.id}/deadline`] = d || t.deadline || '';
        updates[`${pathBase}/${t.id}/recurrence`] = rec;
        updates[`${pathBase}/${t.id}/updatedAt`] = Date.now();
      });

      // Send the atomic patch request
      await update(ref(db, 'products/' + existingId), updates);

      // Log the diffs cleanly
      const diffs = [];
      if (oldProd.name !== name) diffs.push(`Name changed`);
      if (oldProd.launchDate !== launchDate) diffs.push(`Launch: ${formatDate(oldProd.launchDate)} ➔ ${formatDate(launchDate)}`);
      if (diffs.length > 0) await logActivity(existingId, 'status', `Product details updated`, diffs.join(' · '));
      
      if (dateChanges.length > 0) {
        for (const change of dateChanges) {
          const oldText = change.oldD ? formatDate(change.oldD) : 'No date';
          const newText = change.newD ? formatDate(change.newD) : 'No date';
          await logActivity(existingId, 'date_change', `Deadline changed: ${change.name}`, `${oldText} ➔ ${newText}`, change.id);
        }
      }
      
      closeProductModal();
      showToast('Product updated.', 'success');
    }
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
};

/* ══ PHASE 4: STAKEHOLDER CONFIRM + GAS TRIGGER ══ */

// Selected stakeholders for the current confirmation session
export let pendingProduct    = null;

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_pendingProduct(v) { pendingProduct = v; }

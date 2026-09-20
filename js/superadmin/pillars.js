/* superadmin/pillars.js — SOP pillar management. */

import { db, ref, set } from '../core/firebase.js';
import { buildOwnerSelect, PILLARS, set_PILLARS, STAKEHOLDERS } from '../data/app-config.js';
import { loadSATab } from './index.js';

/* ── TAB: PILLARS ────────────────────────────────────────── */
export async function renderSAPillars(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header">
        <span class="panel-title">SOP Pillars</span>
        <button class="btn-primary-sm" onclick="showAddPillar()">+ Add pillar</button>
      </div>
      <div class="panel-body" style="padding:0;">
        ${PILLARS.map((pl, i) => `
          <div class="cb-pillar-row ${pl.enabled===false ? 'cb-row-disabled' : ''}">
            <div class="cb-pillar-num">${i+1}</div>
            <div class="cb-pillar-info">
              <div class="cb-pillar-name">${pl.name}</div>
              <div class="cb-pillar-owner">${pl.owner} · ${pl.dept}</div>
            </div>
            <div class="cb-pillar-actions">
              <button class="btn-secondary-sm" onclick="editPillar('${pl.id}')">Edit</button>
              <button class="btn-secondary-sm" onclick="togglePillar('${pl.id}',${pl.enabled!==false})">
                ${pl.enabled===false ? 'Enable' : 'Disable'}
              </button>
              <button class="btn-danger-xs" onclick="deletePillar('${pl.id}')">Delete</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div id="pillar-edit-panel"></div>`;
}

window.editPillar = (id) => {
  const pl  = PILLARS.find(p => p.id === id);
  if (!pl) return;
  const el  = document.getElementById('pillar-edit-panel');
  if (!el) return;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Edit pillar — ${pl.name}</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Name</label>
          <input id="pe-name" class="input-field" value="${pl.name}"/></div>
        <div class="form-row"><label class="form-label">Owner / Department</label>
          ${buildOwnerSelect('pe-owner', pl.owner)}</div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('pillar-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="savePillar('${id}')">Save changes</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
};

window.savePillar = async (id) => {
  const idx = PILLARS.findIndex(p => p.id === id);
  if (idx === -1) return;
  const ownerVal = document.getElementById('pe-owner')?.value || '';
  const deptMatch = STAKEHOLDERS.find(s => (s.name + ' (' + s.dept + ')') === ownerVal || s.name === ownerVal);
  PILLARS[idx].name  = document.getElementById('pe-name')?.value.trim() || PILLARS[idx].name;
  PILLARS[idx].owner = ownerVal || PILLARS[idx].owner;
  PILLARS[idx].dept  = deptMatch ? deptMatch.dept.toLowerCase() : PILLARS[idx].dept;
  try {
    await set(ref(db, 'config/pillars'), PILLARS);
    showToast('Pillar updated.', 'success');
    loadSATab('pillars');
  } catch(e) { showToast('Save failed: ' + e.message, 'error'); }
};

window.togglePillar = async (id, currentlyEnabled) => {
  const idx = PILLARS.findIndex(p => p.id === id);
  if (idx === -1) return;
  PILLARS[idx].enabled = !currentlyEnabled;
  try {
    await set(ref(db, 'config/pillars'), PILLARS);
    showToast(`Pillar ${PILLARS[idx].enabled ? 'enabled' : 'disabled'}.`, 'success');
    loadSATab('pillars');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.deletePillar = async (id) => {
  if (!confirm('Delete this pillar? This cannot be undone and will affect all products.')) return;
  set_PILLARS( PILLARS.filter(p => p.id !== id));
  try {
    await set(ref(db, 'config/pillars'), PILLARS);
    showToast('Pillar deleted.', 'success');
    loadSATab('pillars');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.showAddPillar = () => {
  const el = document.getElementById('pillar-edit-panel');
  if (!el) return;
  const newId = 'p' + (Date.now());
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Add new pillar</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Name <span class="req">*</span></label>
          <input id="pe-name" class="input-field" placeholder="e.g. Legal Review"/></div>
        <div class="form-row"><label class="form-label">Owner / Department</label>
          ${buildOwnerSelect('pe-owner', '')}</div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('pillar-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="addNewPillar('${newId}')">Add pillar</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
};

window.addNewPillar = async (id) => {
  const name  = document.getElementById('pe-name')?.value.trim();
  const owner = document.getElementById('pe-owner')?.value.trim() || 'Commercial Strategy';
  const dept  = document.getElementById('pe-dept')?.value.trim() || 'commercial';
  if (!name) { showToast('Name is required.', 'error'); return; }
  PILLARS.push({ id, name, owner, dept, enabled: true });
  try {
    await set(ref(db, 'config/pillars'), PILLARS);
    showToast('Pillar added.', 'success');
    loadSATab('pillars');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

/* superadmin/stakeholders.js — Stakeholder management. */

import { db, ref, set } from '../core/firebase.js';
import { set_STAKEHOLDERS, STAKEHOLDERS } from '../data/app-config.js';
import { loadSATab } from './index.js';

/* ── TAB: STAKEHOLDERS ───────────────────────────────────── */
export async function renderSAStakeholders(el) {
  const depts = [...new Set(STAKEHOLDERS.map(s => s.dept))];
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header">
        <span class="panel-title">Stakeholder list (${STAKEHOLDERS.length})</span>
        <button class="btn-primary-sm" onclick="showAddStakeholder()">+ Add</button>
      </div>
      <div class="panel-body" style="padding:0;overflow:auto;">
        <table class="tracker-table" style="min-width:600px;">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Dept</th>
            <th>Pillars</th><th style="width:120px;"></th>
          </tr></thead>
          <tbody>
            ${STAKEHOLDERS.map(s => `<tr class="tracker-row ${s.enabled===false?'tracker-row-done':''}">
              <td class="tracker-pillar"><div class="tracker-pillar-name">${s.name}</div></td>
              <td style="font-size:12px;color:var(--text-muted);">${s.email}</td>
              <td><span class="pill pill-grey" style="font-size:11px;">${s.dept}</span></td>
              <td style="font-size:11px;color:var(--text-muted);">${(s.pillarIds||[]).join(', ')||'All'}</td>
              <td>
                <div style="display:flex;gap:6px;">
                  <button class="btn-secondary-sm" onclick="editStakeholder('${s.id}')">Edit</button>
                  <button class="btn-danger-xs" onclick="deleteStakeholder('${s.id}')">✕</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div id="stakeholder-edit-panel"></div>`;
}

window.editStakeholder = (id) => {
  const s  = STAKEHOLDERS.find(x => x.id === id);
  if (!s) return;
  const el = document.getElementById('stakeholder-edit-panel');
  if (!el) return;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Edit — ${s.name}</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Name</label>
          <input id="se-name" class="input-field" value="${s.name}"/></div>
        <div class="form-row"><label class="form-label">Email</label>
          <input id="se-email" class="input-field" value="${s.email}"/></div>
        <div class="form-row"><label class="form-label">Department</label>
          <input id="se-dept" class="input-field" value="${s.dept}"/></div>
        <div class="form-row"><label class="form-label">Pillar IDs <span class="form-hint">— comma separated e.g. p3,p11</span></label>
          <input id="se-pillars" class="input-field" value="${(s.pillarIds||[]).join(',')}"/></div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('stakeholder-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="saveStakeholder('${id}')">Save</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
};

window.saveStakeholder = async (id) => {
  const idx = STAKEHOLDERS.findIndex(s => s.id === id);
  if (idx === -1) return;
  const pillarsRaw = document.getElementById('se-pillars')?.value || '';
  STAKEHOLDERS[idx] = {
    ...STAKEHOLDERS[idx],
    name:      document.getElementById('se-name')?.value.trim()  || STAKEHOLDERS[idx].name,
    email:     document.getElementById('se-email')?.value.trim() || STAKEHOLDERS[idx].email,
    dept:      document.getElementById('se-dept')?.value.trim()  || STAKEHOLDERS[idx].dept,
    pillarIds: pillarsRaw.split(',').map(p => p.trim()).filter(Boolean),
  };
  try {
    await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
    showToast('Stakeholder updated.', 'success');
    loadSATab('stakeholders');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.deleteStakeholder = async (id) => {
  if (!confirm('Remove this stakeholder from the list?')) return;
  set_STAKEHOLDERS( STAKEHOLDERS.filter(s => s.id !== id));
  try {
    await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
    showToast('Stakeholder removed.', 'success');
    loadSATab('stakeholders');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.showAddStakeholder = () => {
  const el = document.getElementById('stakeholder-edit-panel');
  if (!el) return;
  const newId = 's' + Date.now();
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Add stakeholder</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Name <span class="req">*</span></label>
          <input id="se-name" class="input-field" placeholder="Full name"/></div>
        <div class="form-row"><label class="form-label">Email <span class="req">*</span></label>
          <input id="se-email" class="input-field" placeholder="name@mixtafrica.com"/></div>
        <div class="form-row"><label class="form-label">Department</label>
          <input id="se-dept" class="input-field" placeholder="e.g. Design"/></div>
        <div class="form-row"><label class="form-label">Pillar IDs <span class="form-hint">— comma separated</span></label>
          <input id="se-pillars" class="input-field" placeholder="e.g. p3,p11"/></div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('stakeholder-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="addNewStakeholder('${newId}')">Add</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
};

window.addNewStakeholder = async (id) => {
  const name  = document.getElementById('se-name')?.value.trim();
  const email = document.getElementById('se-email')?.value.trim();
  if (!name || !email) { showToast('Name and email are required.', 'error'); return; }
  const pillarsRaw = document.getElementById('se-pillars')?.value || '';
  STAKEHOLDERS.push({
    id, name, email,
    dept:      document.getElementById('se-dept')?.value.trim() || 'Commercial Strategy',
    pillarIds: pillarsRaw.split(',').map(p => p.trim()).filter(Boolean),
    enabled:   true,
  });
  try {
    await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
    showToast('Stakeholder added.', 'success');
    loadSATab('stakeholders');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

/* superadmin/departments.js — Department management. */

import { db, get, ref, set } from '../core/firebase.js';
import { DEPARTMENTS, set_DEPARTMENTS } from '../data/app-config.js';
import { loadSATab } from './index.js';

/* ══ PHASE D: DEPARTMENTS TAB ═══════════════════════════════ */
export async function renderSADepartments(el) {
  const snap = await get(ref(db, 'config/departments'));
  if (snap.exists()) set_DEPARTMENTS( { ...DEPARTMENTS, ...snap.val() });

  const deptRows = Object.entries(DEPARTMENTS).map(([id, d]) => `
    <div class="cb-pillar-row">
      <div class="cb-pillar-info">
        <div class="cb-pillar-name" style="display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${d.colour||'#6B7280'};flex-shrink:0;"></span>
          ${d.name}
        </div>
        <div class="cb-pillar-owner">${(d.emails||[]).length} email${(d.emails||[]).length!==1?'s':''} · key: ${id}${d.lead ? ' · lead: ' + d.lead : ''}</div>
      </div>
      <div class="cb-pillar-actions">
        <button class="btn-secondary-sm" onclick="editDepartment('${id}')">Edit</button>
        <button class="btn-danger-xs" onclick="deleteDepartment('${id}')">✕</button>
      </div>
    </div>`).join('') || '<div class="muted" style="padding:12px;">No departments configured.</div>';

  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header">
        <span class="panel-title">Departments & Teams</span>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline" style="font-size:11px;" onclick="switchSATab('people',null)">Go to People →</button>
          <button class="btn-primary-sm" onclick="showAddDepartment()">+ Add dept</button>
        </div>
      </div>
      <div class="panel-body" style="padding:0;">${deptRows}</div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);padding:4px 0 16px;">Adding a department here automatically creates a section in the People tab where you can add members.</div>
    <div id="dept-edit-panel"></div>`;
}

window.editDepartment = (id) => {
  const d  = DEPARTMENTS[id];
  if (!d) return;
  const el = document.getElementById('dept-edit-panel');
  if (!el) return;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Edit — ${d.name}</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Department name</label>
          <input id="de-name" class="input-field" value="${d.name}"/></div>
        <div class="form-row"><label class="form-label">Colour</label>
          <input id="de-colour" type="color" value="${d.colour||'#6B7280'}" style="width:60px;height:36px;padding:2px;border:1px solid var(--border-mid);border-radius:6px;cursor:pointer;"/></div>
        <div class="form-row"><label class="form-label">Team lead email <span class="form-hint">— who overdue tasks escalate to after 5 days</span></label>
          <input id="de-lead" class="input-field" type="email" value="${d.lead||''}" placeholder="lead@mixtafrica.com"/></div>
        <div class="form-row"><label class="form-label">Emails <span class="form-hint">— one per line</span></label>
          <textarea id="de-emails" class="input-field" rows="4"></textarea></div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('dept-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="saveDepartment('${id}')">Save</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior:'smooth' });
  // Set textarea value after DOM renders
  setTimeout(() => {
    const ta = document.getElementById('de-emails');
    if (ta) ta.value = (d.emails||[]).join('\n');
  }, 10);
};

window.saveDepartment = async (id) => {
  const name   = document.getElementById('de-name')?.value.trim();
  const colour = document.getElementById('de-colour')?.value || '#6B7280';
  const emailsRaw = document.getElementById('de-emails')?.value || '';
  const emails = emailsRaw.split(/\r?\n/).map(e => e.trim()).filter(Boolean);
  if (!name) { showToast('Name required.', 'error'); return; }
  const lead = document.getElementById('de-lead')?.value.trim() || '';
  DEPARTMENTS[id] = { ...DEPARTMENTS[id], name, colour, lead, emails };
  try {
    await set(ref(db, 'config/departments/' + id), DEPARTMENTS[id]);
    showToast('Department saved.', 'success');
    loadSATab('departments');
  } catch(e) { showToast('Save failed: ' + e.message, 'error'); }
};

window.deleteDepartment = async (id) => {
  if (!confirm('Delete this department?')) return;
  delete DEPARTMENTS[id];
  try {
    await set(ref(db, 'config/departments/' + id), null);
    showToast('Department deleted.', 'success');
    loadSATab('departments');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.showAddDepartment = () => {
  const el = document.getElementById('dept-edit-panel');
  if (!el) return;
  const newId = 'dept_' + Date.now();
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Add department</span></div>
      <div class="panel-body">
        <div class="form-row"><label class="form-label">Key (no spaces) <span class="req">*</span></label>
          <input id="de-key" class="input-field" placeholder="e.g. legal"/></div>
        <div class="form-row"><label class="form-label">Name <span class="req">*</span></label>
          <input id="de-name" class="input-field" placeholder="e.g. Legal"/></div>
        <div class="form-row"><label class="form-label">Colour</label>
          <input id="de-colour" type="color" value="#6B7280" style="width:60px;height:36px;padding:2px;border:1px solid var(--border-mid);border-radius:6px;cursor:pointer;"/></div>
        <div class="form-row"><label class="form-label">Emails <span class="form-hint">— one per line</span></label>
          <textarea id="de-emails" class="input-field" rows="3" placeholder="team@mixtafrica.com"></textarea></div>
        <div class="form-actions">
          <button class="btn-outline" onclick="document.getElementById('dept-edit-panel').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="addNewDepartment()">Add</button>
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior:'smooth' });
};

window.addNewDepartment = async () => {
  const key    = (document.getElementById('de-key')?.value.trim() || '').replace(/\s+/g,'_').toLowerCase();
  const name   = document.getElementById('de-name')?.value.trim();
  const colour = document.getElementById('de-colour')?.value || '#6B7280';
  const emailsRaw = document.getElementById('de-emails')?.value || '';
  const emails = emailsRaw.split(/\r?\n/).map(e => e.trim()).filter(Boolean);
  if (!key || !name) { showToast('Key and name required.', 'error'); return; }
  DEPARTMENTS[key] = { name, colour, emails };
  try {
    await set(ref(db, 'config/departments/' + key), DEPARTMENTS[key]);
    showToast('Department added.', 'success');
    loadSATab('departments');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

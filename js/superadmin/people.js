/* superadmin/people.js — People directory. */

import { db, get, ref, set } from '../core/firebase.js';
import { DEPARTMENTS, getDepts, set_DEPARTMENTS, set_STAKEHOLDERS, STAKEHOLDERS } from '../data/app-config.js';
import { loadSATab } from './index.js';

/* ── TAB: PEOPLE (Department Directory) ─────────────────── */
export async function renderSAPeople(el) {
  // Always re-fetch departments so new ones added in Departments tab appear immediately
  try {
    const dSnap = await get(ref(db, 'config/departments'));
    if (dSnap.exists()) set_DEPARTMENTS( { ...DEPARTMENTS, ...dSnap.val() });
    const sSnap = await get(ref(db, 'config/stakeholders'));
    if (sSnap.exists()) {
      const saved = sSnap.val();
      set_STAKEHOLDERS( Array.isArray(saved) ? saved : Object.values(saved));
    }
  } catch(e) { /* use cached */ }

  const depts = getDepts();

  let html = '<div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">' +
    '<div style="font-size:12px;color:var(--text-muted);">' + STAKEHOLDERS.length + ' people across ' + depts.length + ' departments</div>' +
    '<button class="btn-primary" style="font-size:11px;padding:7px 14px;" onclick="saAddStakeholder()">+ Add person</button>' +
  '</div>';

  depts.forEach(dept => {
    const members = STAKEHOLDERS.filter(s => s.dept === dept);
    const deptColor = (Object.values(DEPARTMENTS).find(d => d.name === dept) || {}).colour || '#6B7280';
    html += '<div class="panel" style="margin-bottom:12px;">' +
      '<div class="panel-header" style="border-left:3px solid ' + deptColor + ';">' +
        '<span class="panel-title">' + dept + '</span>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:11px;color:var(--text-muted);">' + members.length + ' member' + (members.length !== 1 ? 's' : '') + '</span>' +
          '<button onclick="saAddStakeholderInDept(\'' + dept.replace(/'/g, '') + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;">+ Add</button>' +
        '</div>' +
      '</div>' +
      '<div style="padding:0;">' +
        (members.length === 0
          ? '<div style="padding:12px 18px;font-size:12px;color:#9CA3AF;font-style:italic;">No members yet — click + Add to populate this department.</div>'
          : members.map(s => '<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--border);">' +
              '<div style="width:32px;height:32px;border-radius:50%;background:' + deptColor + '20;color:' + deptColor + ';font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
                (s.name[0] || '?').toUpperCase() +
              '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12px;font-weight:600;color:var(--text);">' + s.name +
                  (s.isDeptEmail ? ' <span style="font-size:10px;font-weight:400;background:#EFF6FF;color:#2563EB;padding:1px 6px;border-radius:10px;">dept email</span>' : '') +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-muted);">' + s.email + '</div>' +
              '</div>' +
              '<button onclick="saEditStakeholder(\'' + s.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;color:var(--text-muted);cursor:pointer;font-family:Poppins,sans-serif;">Edit</button>' +
              '<button onclick="saToggleStakeholder(\'' + s.id + '\')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;color:' + (s.enabled !== false ? 'var(--green)' : 'var(--red)') + ';cursor:pointer;font-family:Poppins,sans-serif;">' +
                (s.enabled !== false ? 'Active' : 'Disabled') +
              '</button>' +
            '</div>').join('')
        ) +
      '</div>' +
    '</div>';
  });

  html += '<div id="people-edit-panel"></div>';
  el.innerHTML = html;
}

window.saToggleStakeholder = async (id) => {
  const idx = STAKEHOLDERS.findIndex(s => s.id === id);
  if (idx === -1) return;
  STAKEHOLDERS[idx].enabled = STAKEHOLDERS[idx].enabled === false;
  await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
  showToast('Updated.', 'success');
  loadSATab('people');
};

window.saEditStakeholder = (id) => {
  const s   = STAKEHOLDERS.find(x => x.id === id);
  if (!s) return;
  const el  = document.getElementById('people-edit-panel');
  if (!el) return;
  el.innerHTML =
    '<div class="panel" style="margin-top:12px;">' +
      '<div class="panel-header"><span class="panel-title">Edit — ' + s.name + '</span></div>' +
      '<div class="panel-body">' +
        '<div class="form-row"><label class="form-label">Name</label>' +
          '<input id="sep-name" class="input-field" value="' + s.name + '"/></div>' +
        '<div class="form-row"><label class="form-label">Email</label>' +
          '<input id="sep-email" class="input-field" value="' + s.email + '"/></div>' +
        '<div class="form-row"><label class="form-label">Department</label>' +
          '<select id="sep-dept" class="select-field" style="width:100%;">' +
            getDepts().map(d => '<option value="' + d + '"' + (d === s.dept ? ' selected' : '') + '>' + d + '</option>').join('') +
          '</select></div>' +
        '<div class="form-row"><label class="form-label">Type</label>' +
          '<select id="sep-type" class="select-field" style="width:100%;">' +
            '<option value="false"' + (!s.isDeptEmail ? ' selected' : '') + '>Individual</option>' +
            '<option value="true"' + (s.isDeptEmail ? ' selected' : '') + '>Dept email (alias)</option>' +
          '</select></div>' +
        '<div class="form-actions">' +
          '<button class="btn-outline" onclick="document.getElementById(\'people-edit-panel\').innerHTML=\'\'">Cancel</button>' +
          '<button class="btn-primary" onclick="saSaveStakeholder(\'' + id + '\')">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  el.scrollIntoView({ behavior: 'smooth' });
};

window.saSaveStakeholder = async (id) => {
  const idx = STAKEHOLDERS.findIndex(s => s.id === id);
  if (idx === -1) return;
  STAKEHOLDERS[idx].name        = document.getElementById('sep-name')?.value.trim()  || STAKEHOLDERS[idx].name;
  STAKEHOLDERS[idx].email       = document.getElementById('sep-email')?.value.trim() || STAKEHOLDERS[idx].email;
  STAKEHOLDERS[idx].dept        = document.getElementById('sep-dept')?.value         || STAKEHOLDERS[idx].dept;
  STAKEHOLDERS[idx].isDeptEmail = document.getElementById('sep-type')?.value === 'true';
  await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
  showToast('Saved.', 'success');
  loadSATab('people');
};

window.saAddStakeholderInDept = (dept) => {
  saAddStakeholder(dept);
};

window.saAddStakeholder = (prefillDept) => {
  const el = document.getElementById('people-edit-panel');
  if (!el) return;
  const newId = 's_new_' + Date.now();
  const depts = getDepts();
  el.innerHTML =
    '<div class="panel" style="margin-top:12px;">' +
      '<div class="panel-header"><span class="panel-title">Add person' + (prefillDept ? ' — ' + prefillDept : '') + '</span></div>' +
      '<div class="panel-body">' +
        '<div class="form-row"><label class="form-label">Name <span class="req">*</span></label>' +
          '<input id="sep-name" class="input-field" placeholder="e.g. A. Surname"/></div>' +
        '<div class="form-row"><label class="form-label">Email <span class="req">*</span></label>' +
          '<input id="sep-email" class="input-field" placeholder="name@mixtafrica.com"/></div>' +
        '<div class="form-row"><label class="form-label">Department</label>' +
          '<select id="sep-dept" class="select-field" style="width:100%;">' +
            depts.map(d => '<option value="' + d + '"' + (d === prefillDept ? ' selected' : '') + '>' + d + '</option>').join('') +
          '</select></div>' +
        '<div class="form-row"><label class="form-label">Type</label>' +
          '<select id="sep-type" class="select-field" style="width:100%;">' +
            '<option value="false">Individual</option>' +
            '<option value="true">Dept email (alias)</option>' +
          '</select></div>' +
        '<div class="form-actions">' +
          '<button class="btn-outline" onclick="document.getElementById(\'people-edit-panel\').innerHTML=\'\'">Cancel</button>' +
          '<button class="btn-primary" onclick="saConfirmAddStakeholder(\'' + newId + '\')">Add</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  el.scrollIntoView({ behavior: 'smooth' });
};

window.saConfirmAddStakeholder = async (newId) => {
  const name  = document.getElementById('sep-name')?.value.trim();
  const email = document.getElementById('sep-email')?.value.trim();
  const dept  = document.getElementById('sep-dept')?.value || 'Commercial Strategy';
  const isDeptEmail = document.getElementById('sep-type')?.value === 'true';
  if (!name || !email) { showToast('Name and email are required.', 'error'); return; }
  STAKEHOLDERS.push({ id: newId, name, email, dept, isDeptEmail, enabled: true });
  await set(ref(db, 'config/stakeholders'), STAKEHOLDERS);
  showToast(name + ' added.', 'success');
  loadSATab('people');
};

/* views/settings.js — Settings page: allowlist, access requests, org working hours, preferred name, team. */

import { db, get, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser, set_currentPreferredName } from '../core/state.js';
import { loadPrivacyLockStatus } from '../auth/privacy-lock.js';

async function loadAccessRequests() {
  const el = document.getElementById('access-requests-list');
  if (!el) return;
  try {
    const snap = await get(ref(db, 'accessRequests'));
    if (!snap.exists()) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">No pending access requests.</div>';
      return;
    }
    const requests = Object.values(snap.val()).filter(r => r.status === 'pending');
    const badge = document.getElementById('req-count-badge');
    if (badge) {
      badge.style.display = requests.length > 0 ? 'inline' : 'none';
      badge.textContent   = requests.length + ' pending';
    }
    if (requests.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">No pending access requests.</div>';
      return;
    }
    el.innerHTML = requests.map(r =>
      '<div class="allowlist-row">' +
        '<div class="allowlist-avatar">' + (r.name || r.email || '?')[0].toUpperCase() + '</div>' +
        '<div class="allowlist-info">' +
          '<div class="allowlist-name">' + (r.name || 'Unknown') + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">' + r.email + '</div>' +
          (r.reason ? '<div style="font-size:11px;color:var(--text-mid);margin-top:3px;">' + r.reason + '</div>' : '') +
          '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + new Date(r.requestedAt).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn-primary" style="font-size:11px;padding:6px 12px;" onclick="approveAccessRequest(\'' + r.id + '\',\'' + r.email + '\',\'' + (r.name||'').replace(/'/g,'') + '\')">Approve</button>' +
          '<button class="btn-danger-xs" onclick="denyAccessRequest(\'' + r.id + '\')">Deny</button>' +
        '</div>' +
      '</div>'
    ).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Could not load requests.</div>';
  }
}

window.approveAccessRequest = async (reqId, email, name) => {
  const key = sanitiseEmail(email);
  try {
    await set(ref(db, 'allowlist/' + key), { role: 'member', name, email, addedAt: Date.now(), addedBy: currentUser.email });
    await set(ref(db, 'accessRequests/' + reqId + '/status'), 'approved');
    showToast(name + ' approved.', 'success');
    loadAccessRequests();
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.denyAccessRequest = async (reqId) => {
  if (!confirm('Deny this request?')) return;
  await set(ref(db, 'accessRequests/' + reqId + '/status'), 'denied');
  showToast('Request denied.', 'info');
  loadAccessRequests();
};

export function renderSettings(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Settings</h1>
        <p class="view-subtitle">Manage access, allowlist, and system configuration</p>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">Your account</span></div>
      <div class="panel-body">
        <div class="settings-row">
          <div class="settings-label">Name</div>
          <div class="settings-value">${currentUser?.displayName || '—'}</div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Email</div>
          <div class="settings-value">${currentUser?.email || '—'}</div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Role</div>
          <div class="settings-value"><span class="role-badge ${currentRole === 'admin' ? 'role-admin' : 'role-viewer'}">${currentRole === 'admin' ? 'Admin' : 'Viewer'}</span></div>
        </div>
        <div style="margin-top:16px;">
          <button class="btn-danger-sm" onclick="handleSignOut()">Sign out</button>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">Privacy lock</span></div>
      <div class="panel-body">
        <p style="font-size:12px;color:var(--text-mid);line-height:1.7;margin-bottom:14px;">
          Your personal to-do and actions are already private at the database level — no one else can read them, department or not. This adds a second layer for a different risk: someone using your computer while you're still signed in. When on, opening My Actions &amp; To-do asks for a PIN first, once per browser session.
        </p>
        <div id="privacy-lock-status"><div class="loading-row" style="padding:4px 0;">Loading...</div></div>
      </div>
    </div>

    ${currentRole === 'admin' ? `
    <div class="panel" style="margin-bottom:16px;" id="access-requests-panel">
      <div class="panel-header">
        <span class="panel-title">Access requests</span>
        <span id="req-count-badge" style="font-size:10px;font-weight:700;background:#FEF2F2;color:#C0282D;padding:2px 8px;border-radius:10px;display:none;">0 pending</span>
      </div>
      <div id="access-requests-list" class="panel-body">
        <div style="font-size:12px;color:var(--text-muted);">Loading...</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">Allowlist management</span></div>
      <div class="panel-body">
        <p class="settings-hint">Add or remove users who can access the NPD Hub. Admin users can create products and manage all settings. Viewers can see product status and documents.</p>
        <div class="allowlist-form">
          <input type="email" id="new-email" placeholder="colleague@mixtafrica.com" class="input-field"/>
          <select id="new-role" class="select-field">
            <option value="admin">Admin</option>
            <option value="readonly" selected>Viewer</option>
          </select>
          <button class="btn-primary-sm" onclick="addToAllowlist()">Add user</button>
        </div>
        <div id="allowlist-list" class="allowlist-list">
          <div class="loading-row">Loading allowlist...</div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">Company Directory</span></div>
      <div class="panel-body">
        <p class="settings-hint">Team members appear here automatically after their first login. They can be assigned as product owners when creating products.</p>
        <div id="team-members-list"><div class="loading-row">Loading...</div></div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title">Decision engine — working hours</span></div>
      <div class="panel-body">
        <p class="settings-hint">Used by the reasoning job to know when it's actually a good time to surface something — a suggestion generated overnight waits for the next working morning instead of firing immediately.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">
          <div>
            <label class="form-label" style="font-size:10px;">Day starts</label>
            <input type="time" id="oc-start" class="input-field" value="08:00"/>
          </div>
          <div>
            <label class="form-label" style="font-size:10px;">Day ends</label>
            <input type="time" id="oc-end" class="input-field" value="18:00"/>
          </div>
          <div style="flex:1;min-width:220px;">
            <label class="form-label" style="font-size:10px;">Timezone (IANA)</label>
            <input type="text" id="oc-tz" class="input-field" style="width:100%;" placeholder="Africa/Lagos"/>
          </div>
          <button class="btn-primary-sm" onclick="saveOrgContext()">Save</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) => `
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-mid);">
              <input type="checkbox" class="oc-workday" value="${i+1}" ${i < 5 ? 'checked' : ''}/> ${d}
            </label>`).join('')}
        </div>
      </div>
    </div>` : ''}`;

  loadPrivacyLockStatus();
  if (currentRole === 'admin') { loadAllowlist(); setTimeout(renderTeamSection, 100); loadOrgContext(); loadAccessRequests(); }
}

async function loadOrgContext() {
  try {
    const snap = await get(ref(db, 'config/orgContext'));
    const c = snap.val() || {};
    const startEl = document.getElementById('oc-start');
    const endEl   = document.getElementById('oc-end');
    const tzEl    = document.getElementById('oc-tz');
    if (startEl) startEl.value = c.workingHoursStart || '08:00';
    if (endEl)   endEl.value   = c.workingHoursEnd   || '18:00';
    if (tzEl)    tzEl.value    = c.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos';
    if (Array.isArray(c.workDays) && c.workDays.length) {
      document.querySelectorAll('.oc-workday').forEach(cb => {
        cb.checked = c.workDays.includes(Number(cb.value));
      });
    }
  } catch(e) { console.warn('loadOrgContext error:', e); }
}

window.saveOrgContext = async () => {
  try {
    const workDays = Array.from(document.querySelectorAll('.oc-workday:checked')).map(cb => Number(cb.value));
    await set(ref(db, 'config/orgContext'), {
      workingHoursStart: document.getElementById('oc-start')?.value || '08:00',
      workingHoursEnd:   document.getElementById('oc-end')?.value   || '18:00',
      timezone:          document.getElementById('oc-tz')?.value.trim() || 'Africa/Lagos',
      workDays: workDays.length ? workDays : [1,2,3,4,5],
      updatedAt: Date.now(), updatedBy: currentUser.email,
    });
    showToast('Working hours saved.', 'success');
  } catch(e) {
    showToast('Could not save working hours.', 'error');
    console.warn('saveOrgContext error:', e);
  }
};

async function loadAllowlist() {
  const el = document.getElementById('allowlist-list');
  if (!el) return;
  try {
    const snap = await get(ref(db, 'allowlist'));
    const data = snap.val() || {};
    if (Object.keys(data).length === 0) {
      el.innerHTML = '<div class="loading-row muted">No users in allowlist yet.</div>';
      return;
    }
    el.innerHTML = Object.entries(data).map(([key, val]) => {
      const email = key.replace(/_/g, (m, i, s) => {
        // reconstruct email: last underscore before domain is @
        return '.';
      });
      return `
        <div class="allowlist-row">
          <div class="allowlist-avatar">${(val.name || key)[0].toUpperCase()}</div>
          <div class="allowlist-info">
            <div class="allowlist-name">${val.name || key}</div>
            <div class="allowlist-role-row">
              <span class="role-badge ${val.role === 'admin' ? 'role-admin' : 'role-viewer'}">${val.role === 'admin' ? 'Admin' : 'Viewer'}</span>
            </div>
          </div>
          <button class="btn-danger-xs" onclick="removeFromAllowlist('${key}')">Remove</button>
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="loading-row muted">Failed to load allowlist.</div>';
  }
}

window.addToAllowlist = async () => {
  const email = document.getElementById('new-email').value.trim().toLowerCase();
  const role  = document.getElementById('new-role').value;
  if (!email || !email.includes('@mixtafrica.com')) {
    showToast('Please enter a valid @mixtafrica.com email.', 'error'); return;
  }
  const key  = sanitiseEmail(email);
  const name = email.split('@')[0];
  await set(ref(db, `allowlist/${key}`), { role, name, addedBy: currentUser.email, addedAt: Date.now() });
  showToast(`${email} added as ${role}.`, 'success');
  document.getElementById('new-email').value = '';
  loadAllowlist();
};

window.removeFromAllowlist = async (key) => {
  if (!confirm('Remove this user from the allowlist?')) return;
  await set(ref(db, `allowlist/${key}`), null);
  showToast('User removed.', 'success');
  loadAllowlist();
};

/* ─── UTILITIES ─── */
// Preferred name — loaded from Firebase users record
// currentPreferredName is declared at the top with the other session state.
export async function loadPreferredName() {
  if (!currentUser) return;
  const key  = sanitiseEmail(currentUser.email);
  const snap = await get(ref(db, 'users/' + key + '/preferredName'));
  set_currentPreferredName( snap.exists() ? snap.val() : (currentUser.displayName || currentUser.email).split(' ')[0]);
}

window.editPreferredName = () => {
  const el = document.getElementById('dash-greeting-name');
  if (!el) return;
  const current = currentPreferredName;
  el.outerHTML = '<input id="dash-greeting-name-input" value="' + current + '" ' +
    'style="font-size:inherit;font-weight:inherit;font-family:Poppins,sans-serif;border:none;border-bottom:2px solid var(--red);outline:none;background:transparent;width:180px;color:var(--text);" ' +
    'onblur="savePreferredName(this.value)" onkeydown="if(event.key===\'Enter\')this.blur();if(event.key===\'Escape\')cancelPreferredName();" autofocus/>';
};

window.savePreferredName = async (val) => {
  const name = (val || '').trim() || currentPreferredName;
  set_currentPreferredName( name);
  const key = sanitiseEmail(currentUser.email);
  await set(ref(db, 'users/' + key + '/preferredName'), name);
  // Re-render the greeting span
  const input = document.getElementById('dash-greeting-name-input');
  if (input) input.outerHTML = '<span id="dash-greeting-name" onclick="editPreferredName()" title="Click to change your name" style="cursor:pointer;border-bottom:1px dashed var(--border);padding-bottom:1px;">' + name + '</span>';
};

window.cancelPreferredName = () => {
  const input = document.getElementById('dash-greeting-name-input');
  if (input) input.outerHTML = '<span id="dash-greeting-name" onclick="editPreferredName()" title="Click to change your name" style="cursor:pointer;border-bottom:1px dashed var(--border);padding-bottom:1px;">' + currentPreferredName + '</span>';
};

/* ══ PHASE 7: TEAM SETTINGS (add to Settings tab) ══════════ */
async function renderTeamSection() {
  const snap    = await get(ref(db, 'users'));
  const members = snap.val() || {};
  const rows    = Object.entries(members).map(([key, m]) => `
    <div class="allowlist-row">
      <div class="allowlist-avatar">${(m.name||key)[0].toUpperCase()}</div>
      <div class="allowlist-info">
        <div class="allowlist-name">${m.name}</div>
        <div class="allowlist-role-row">
          <span class="role-badge role-viewer">${m.dept || 'Unassigned'}</span>
          ${m.isHOD ? '<span style="font-size:9px;font-weight:700;background:#F0FDF4;color:#16A34A;padding:2px 6px;border-radius:10px;margin-left:6px;">HOD</span>' : ''}
        </div>
      </div>
    </div>`).join('') || '<div class="loading-row muted">No team members yet — they appear here after first login.</div>';

  const el = document.getElementById('team-members-list');
  if (el) el.innerHTML = rows;
}

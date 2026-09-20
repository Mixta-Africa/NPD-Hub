/* superadmin/users.js — User administration (department, role, unlock, reset). */

import { db, get, ref, set } from '../core/firebase.js';
import { getDepts } from '../data/app-config.js';
import { getProductsFresh } from '../data/products-cache.js';
import { loadSATab } from './index.js';

/* ── TAB 3: USER MANAGEMENT ──────────────────────────────── */
export async function renderSAUsers(el) {
  const [allowSnap, userSnap, products, reqSnap] = await Promise.all([
    get(ref(db, 'allowlist')),
    get(ref(db, 'users')),
    getProductsFresh(),
    get(ref(db, 'accessRequests')),
  ]);
  const allowlist = allowSnap.val() || {};
  const users     = userSnap.val()  || {};
  const allRequests = reqSnap.exists() ? Object.values(reqSnap.val()).filter(r => r.status === 'pending') : [];

  const reqSection = allRequests.length > 0
    ? '<div class="panel" style="margin-bottom:14px;">' +
        '<div class="panel-header">' +
          '<span class="panel-title">Pending access requests</span>' +
          '<span style="font-size:10px;font-weight:700;background:#FEF2F2;color:#C0282D;padding:2px 8px;border-radius:10px;">' + allRequests.length + ' pending</span>' +
        '</div>' +
        '<div style="padding:0;">' +
          allRequests.map(r =>
            '<div style="display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--border);">' +
              '<div style="flex:1;">' +
                '<div style="font-size:12px;font-weight:600;">' + (r.name||'?') + ' <span style="font-size:11px;font-weight:400;color:var(--text-muted);">' + r.email + '</span></div>' +
                '<div style="font-size:11px;color:var(--text-muted);">' + (r.reason||'') + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;">' +
                '<button class="btn-primary" style="font-size:11px;padding:5px 10px;" onclick="approveAccessRequest(\'' + r.id + '\',\'' + r.email + '\',\'' + (r.name||'').replace(/'/g,'') + '\')">Approve</button>' +
                '<button class="btn-danger-xs" onclick="denyAccessRequest(\'' + r.id + '\')">Deny</button>' +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>'
    : '';

  const rows = Object.entries(allowlist).map(([key, al]) => {
    const u        = users[key] || {};
    const owned    = Object.values(products).filter(p => p.ownerId === key).length;
    const shared   = Object.values(products).filter(p => p.sharedWith?.[key]).length;
    const handover = Object.values(products).find(p => p.handover?.active && p.handover?.relieverId === key);
    const deptLocked = u.deptLocked ? ' <span style="font-size:9px;color:#9CA3AF;">(locked)</span>' : '';

    return `<tr class="tracker-row">
      <td class="tracker-pillar">
        <div class="tracker-pillar-name">${u.name || key}</div>
        <div class="tracker-pillar-owner">${u.email || key.replace(/_/g,'.')}</div>
      </td>
      <td><span class="role-badge ${al.role === 'admin' ? 'role-admin' : 'role-viewer'}">${al.role}</span></td>
      <td style="font-size:12px;">
        ${u.dept || '<span style="color:#9CA3AF;">Not set</span>'}${deptLocked}
        ${!u.deptLocked ? '<br><select style="font-size:10px;margin-top:4px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;" onchange="saChangeDept(\''+key+'\',this.value)">' +
          '<option value="">Change dept...</option>' +
          getDepts().map(d => '<option value="'+d+'"'+(d===u.dept?' selected':'')+'>'+d+'</option>').join('') +
        '</select>' : '<button class="btn-outline" style="font-size:10px;padding:2px 8px;margin-top:4px;" onclick="saUnlockDept(\''+key+'\')">Change</button>'}
      </td>
      <td style="font-size:13px;">${owned} owned · ${shared} shared</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn-secondary-sm" style="font-size:10px;" onclick="saToggleRole('${key}','${al.role}')">
            ${al.role === 'admin' ? '↓ Member' : '↑ Admin'}
          </button>
          <button class="btn-danger-xs" onclick="saResetUser('${key}')">Reset</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = reqSection + `
    <div class="panel" style="overflow:auto;">
      <table class="tracker-table">
        <thead><tr>
          <th>User</th><th style="width:80px;">Role</th>
          <th>Department</th><th>Products</th><th style="width:100px;"></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted" style="padding:16px;">No users found.</td></tr>'}</tbody>
      </table>
    </div>`;
}

window.saChangeDept = async (userKey, dept) => {
  if (!dept) return;
  await set(ref(db, 'users/' + userKey + '/dept'), dept);
  await set(ref(db, 'users/' + userKey + '/deptLocked'), true);
  showToast('Department set to ' + dept, 'success');
  loadSATab('users');
};

window.saUnlockDept = async (userKey) => {
  if (!confirm('Allow this user to change their department? Their current selection will be unlocked.')) return;
  await set(ref(db, 'users/' + userKey + '/deptLocked'), false);
  showToast('Department unlocked.', 'success');
  loadSATab('users');
};

window.saToggleRole = async (userKey, currentRole) => {
  const newRole = currentRole === 'admin' ? 'member' : 'admin';
  if (!confirm(`Change this user to ${newRole}?`)) return;
  try {
    await set(ref(db, `allowlist/${userKey}/role`), newRole);
    showToast(`Role updated to ${newRole}.`, 'success');
    loadSATab('users');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.saResetUser = async (userKey) => {
  if (!confirm('Reset this user? This clears their active handovers and shared access.')) return;
  try {
    // Clear their active handovers (as reliever)
    const prods = await getProductsFresh();
    const updates = {};
    Object.entries(prods).forEach(([id, p]) => {
      if (p.handover?.relieverId === userKey) updates[`products/${id}/handover/active`] = false;
      if (p.sharedWith?.[userKey]) updates[`products/${id}/sharedWith/${userKey}`] = null;
    });
    await Promise.all(Object.entries(updates).map(([path, val]) => set(ref(db, path), val)));
    showToast('User reset complete.', 'success');
    loadSATab('users');
  } catch(e) { showToast('Reset failed: ' + e.message, 'error'); }
};

/* features/task-list-controls.js — Task list filtering, grouping and bulk visibility controls. */

import { db, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser, currentUserDept, isSuperAdmin } from '../core/state.js';
import { canSetTaskVisibility, getTaskVisibility, TASK_VISIBILITY, taskOwnerList } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { buildPillarDetail } from '../views/product-detail.js';
import { logActivity } from './activity.js';

/* ══ VISIBILITY + ACKNOWLEDGEMENT ACTIONS ══════════════════ */
window.cycleTaskVisibility = async (productId, taskId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  if (!canSetTaskVisibility(prod)) { showToast('Only the owner or an admin can change visibility', 'error'); return; }
  const task = getProductTasks(prod).find(t => t.id === taskId);
  if (!task) return;

  const order = ['private', 'department', 'public'];
  const next  = order[(order.indexOf(getTaskVisibility(task)) + 1) % order.length];
  const path  = prod.tasks?.[taskId] ? 'tasks' : 'pillars';

  await set(ref(db, 'products/' + productId + '/' + path + '/' + taskId + '/visibility'), next);
  if (productListCache[productId][path]?.[taskId]) {
    productListCache[productId][path][taskId].visibility = next;
  }
  await logActivity(productId, 'visibility',
    'Task visibility changed to ' + TASK_VISIBILITY[next].label,
    (task.title || taskId) + ' — by ' + (currentPreferredName || currentUser.email));
  showToast('Now ' + TASK_VISIBILITY[next].label + ' — ' + TASK_VISIBILITY[next].desc, 'success');
  const body = document.getElementById('product-detail-body');
  if (body) body.innerHTML = buildPillarDetail(productListCache[productId]);
};

window.toggleTaskGroup = (groupId) => {
  const grid = document.getElementById(groupId);
  const chevron = document.getElementById(groupId + '-chevron');
  if (!grid) return;
  const isHidden = grid.style.display === 'none';
  grid.style.display = isHidden ? 'grid' : 'none';
  if (chevron) chevron.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
};

/* Pure DOM show/hide — no re-render, so filtering doesn't disturb an
   in-progress drag or lose any collapsed/expanded state elsewhere on
   the page. A group's header hides along with it once none of its
   tasks pass the filter, so you never see an empty "0 tasks" section. */
window.filterPillarTasks = (productId) => {
  const list = document.getElementById('pillar-detail-list-' + productId);
  if (!list) return;
  const search = (document.getElementById('tf-search-' + productId)?.value || '').toLowerCase().trim();
  const dept   = document.getElementById('tf-dept-' + productId)?.value || '';
  const status = document.getElementById('tf-status-' + productId)?.value || '';
  const dateFilter = document.getElementById('tf-date-' + productId)?.value || '';

  const today = new Date(); today.setHours(0,0,0,0);
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  const monthEnd = new Date(today); monthEnd.setMonth(today.getMonth() + 1);

  list.querySelectorAll('.pillar-detail-row').forEach(row => {
    let visible = true;
    if (search && !row.dataset.title.includes(search)) visible = false;
    if (dept && row.dataset.dept !== dept) visible = false;
    if (status && row.dataset.status !== status) visible = false;
    if (dateFilter && visible) {
      const dl = row.dataset.deadline;
      if (dateFilter === 'nodate') visible = !dl;
      else if (!dl) visible = false;
      else {
        const d = new Date(dl); d.setHours(0,0,0,0);
        if (dateFilter === 'overdue') visible = d < today;
        else if (dateFilter === 'week') visible = d >= today && d <= weekEnd;
        else if (dateFilter === 'month') visible = d >= today && d <= monthEnd;
      }
    }
    row.style.display = visible ? '' : 'none';
  });

  // Hide each group's header + grid entirely once it has no visible rows.
  list.querySelectorAll('.task-group-grid').forEach(grid => {
    const anyVisible = Array.from(grid.querySelectorAll('.pillar-detail-row')).some(r => r.style.display !== 'none');
    const header = grid.previousElementSibling;
    if (header && header.classList.contains('task-group-header')) {
      header.style.display = anyVisible ? 'flex' : 'none';
    }
    // Only touch the grid's own visibility when it's being hidden by the
    // filter, not when it's legitimately collapsed by the user — leave a
    // manually-collapsed-but-matching group collapsed rather than forcing
    // it open.
    if (!anyVisible) grid.style.display = 'none';
  });

  const noneVisible = !Array.from(list.querySelectorAll('.pillar-detail-row')).some(r => r.style.display !== 'none');
  let emptyMsg = list.querySelector('.task-filter-empty');
  if (noneVisible && tasks_length_gt_zero(list)) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'task-filter-empty';
      emptyMsg.style.cssText = 'padding:24px 0;text-align:center;font-size:12px;color:var(--text-muted);';
      emptyMsg.textContent = 'No tasks match these filters.';
      list.appendChild(emptyMsg);
    }
  } else if (emptyMsg) {
    emptyMsg.remove();
  }
};
function tasks_length_gt_zero(list) { return list.querySelectorAll('.pillar-detail-row').length > 0; }

window.clearPillarTaskFilters = (productId) => {
  const s = document.getElementById('tf-search-' + productId); if (s) s.value = '';
  const d = document.getElementById('tf-dept-' + productId); if (d) d.value = '';
  const st = document.getElementById('tf-status-' + productId); if (st) st.value = '';
  const dt = document.getElementById('tf-date-' + productId); if (dt) dt.value = '';
  filterPillarTasks(productId);
};

window.clearTaskAck = async (productId, taskId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  const path = prod.tasks?.[taskId] ? 'tasks' : 'pillars';
  await set(ref(db, 'products/' + productId + '/' + path + '/' + taskId + '/acknowledgement'), null);
  if (productListCache[productId][path]?.[taskId]) {
    productListCache[productId][path][taskId].acknowledgement = null;
  }
  showToast('Acknowledgement cleared.', 'success');
  const body = document.getElementById('product-detail-body');
  if (body) body.innerHTML = buildPillarDetail(productListCache[productId]);
};

/* Bulk visibility sweep. Works in both directions:
     'private' — lock everything down
     'department' — open my tasks to my department
   Scope is admins → everything, members → only tasks they own. */
async function bulkSetVisibility(target) {
  if (!currentUser) return;
  const isAdminSweep = currentRole === 'admin' || isSuperAdmin;
  const scope = isAdminSweep ? 'every task in the hub' : 'every task you own';
  const meta  = TASK_VISIBILITY[target];
  if (!confirm('Set ' + scope + ' to ' + meta.label + ' (' + meta.desc + ')?\n\nThis can be reversed at any time.')) return;

  const btnIds = ['bulk-private-btn', 'bulk-dept-btn'];
  btnIds.forEach(id => { const b = document.getElementById(id); if (b) { b.disabled = true; b.textContent = 'Working...'; } });

  try {
    const products = await getProductsFresh();
    const myEmail = (currentUser.email || '').toLowerCase();
    const myDept  = (currentUserDept || '').toLowerCase();
    let changed = 0;

    for (const pid of Object.keys(products)) {
      const prod = products[pid];
      const path = prod.tasks ? 'tasks' : (prod.pillars ? 'pillars' : null);
      if (!path) continue;
      for (const tid of Object.keys(prod[path] || {})) {
        const task = prod[path][tid];
        if (getTaskVisibility(task) === target) continue;

        if (!isAdminSweep) {
          // Members may only change tasks they own — same rule as canViewTask:
          // a named person's dept label is not a grant to their whole department.
          const owners = taskOwnerList(task);
          const mine = owners.some(o =>
            o.email ? o.email.toLowerCase() === myEmail : (o.dept && myDept && o.dept.toLowerCase() === myDept));
          if (!mine && prod.ownerId !== sanitiseEmail(currentUser.email)) continue;
        }
        await set(ref(db, 'products/' + pid + '/' + path + '/' + tid + '/visibility'), target);
        if (productListCache[pid]?.[path]?.[tid]) productListCache[pid][path][tid].visibility = target;
        changed++;
      }
    }
    showToast(changed + ' task' + (changed !== 1 ? 's' : '') + ' set to ' + meta.label + '.', 'success');
  } catch(e) {
    console.error('bulkSetVisibility failed:', e);
    showToast('Bulk update failed — check the console.', 'error');
  } finally {
    const b1 = document.getElementById('bulk-private-btn');
    const b2 = document.getElementById('bulk-dept-btn');
    if (b1) { b1.disabled = false; b1.textContent = 'Lock all to Private'; }
    if (b2) { b2.disabled = false; b2.textContent = 'Open all to my Department'; }
  }
}

window.lockAllTasksToPrivate  = () => bulkSetVisibility('private');
window.openAllTasksToDept     = () => bulkSetVisibility('department');

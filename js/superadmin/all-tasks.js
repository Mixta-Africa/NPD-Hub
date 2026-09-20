/* superadmin/all-tasks.js — All-tasks admin table and the hard-delete overrides. */

import { db, get, ref, set } from '../core/firebase.js';
import { currentView } from '../core/state.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { loadSATab } from './index.js';

/* ── TAB: ALL TASKS (Owner-Led View) ────────────────────────── */
export async function renderSAAllTasks(el) {
  el.innerHTML = '<div class="loading-row" style="padding:24px;">Loading organization tasks...</div>';
  try {
    const products = await getProductsFresh();
    
    // Group by the person who OWNS THE PROJECT
    const byOwner = {};

    Object.values(products).forEach(prod => {
      if (prod.status === 'archived') return;
      const key = prod.ownerName || prod.createdBy || prod.ownerId || 'Unassigned';
      if (!byOwner[key]) byOwner[key] = [];
      byOwner[key].push(prod);
    });

    const ownerKeys = Object.keys(byOwner).sort();
    
    if (ownerKeys.length === 0) {
      el.innerHTML = '<div class="muted" style="padding:24px;">No tasks found in the system.</div>';
      return;
    }

    let html = `
      <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;color:var(--text-muted);">Everything grouped by the person who owns each project. Click a name to see their projects and every task inside them.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
    `;

    ownerKeys.forEach(ownerName => {
      const prods = byOwner[ownerName];
      let totalTasks = 0;
      let totalDone = 0;
      let totalDelayed = 0;

      prods.forEach(p => {
        const tasks = getProductTasks(p);
        totalTasks += tasks.length;
        tasks.forEach(t => {
          const st = resolveTaskStatus(t, p);
          if (st === 'complete') totalDone++;
          if (st === 'delayed' || st === 'overdue') totalDelayed++;
        });
      });

      const initials = ownerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      html += `
        <details style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;" open>
          <summary style="padding:16px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;background:#FAFAF9;list-style:none;user-select:none;outline:none;">
            <div style="width:36px;height:36px;border-radius:50%;background:#F0F0EE;color:var(--text);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${initials}
            </div>
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:700;color:var(--text);">${ownerName}</div>
              <div style="font-size:11px;color:var(--text-muted);">${prods.length} project${prods.length !== 1 ? 's' : ''} · ${totalTasks} tasks</div>
            </div>
            <div style="display:flex;gap:12px;font-size:12px;font-weight:600;margin-right:8px;text-align:right;">
              <div>
                <div style="font-size:14px;font-weight:700;color:var(--green);">${totalDone}</div>
                <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);">Done</div>
              </div>
              <div>
                <div style="font-size:14px;font-weight:700;color:${totalDelayed > 0 ? 'var(--red)' : 'var(--text)'};">${totalDelayed}</div>
                <div style="font-size:9px;text-transform:uppercase;color:var(--text-muted);">Delayed</div>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          
          <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px;background:#F8F8F7;">
            ${prods.map(p => {
              const tasks = getProductTasks(p);
              const pDone = tasks.filter(t => resolveTaskStatus(t, p) === 'complete').length;
              const pDelayed = tasks.filter(t => ['delayed','overdue'].includes(resolveTaskStatus(t, p))).length;
              
              return `
                <details style="border:1px solid var(--border);border-radius:8px;background:#fff;overflow:hidden;">
                  <summary style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:#fff;font-size:12px;user-select:none;outline:none;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-weight:700;color:var(--text);">${p.name}</span>
                      <span style="font-size:9px;font-weight:700;color:${(p.itemType||'product')==='project'?'#2563EB':'#C0282D'};background:${(p.itemType||'product')==='project'?'#EFF6FF':'#FEF2F2'};padding:1px 6px;border-radius:6px;">
                        ${(p.itemType || 'product').toUpperCase()}
                      </span>
                      <span style="color:var(--text-muted);font-size:11px;">${pDone}/${tasks.length} done</span>
                      ${pDelayed > 0 ? `<span style="color:var(--red);font-weight:600;font-size:11px;">${pDelayed} need action</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="margin-left:auto;font-size:10px;color:var(--text-muted);margin-right:8px;">open &rarr;</span>
                      <button class="btn-danger-xs" onclick="event.stopPropagation();saDeleteProject('${p.id}', '${p.name.replace(/'/g, "\\'")}')" title="Delete Entire Project">
                        Delete
                      </button>
                    </div>
                  </summary>

                  <div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;background:#FAFAF9;border-top:1px solid #F3F3F2;">
                    ${tasks.length === 0 ? '<div style="font-size:11px;color:var(--text-muted);padding:6px 0;">No tasks in this project.</div>' : ''}
                    ${tasks.map(t => {
                      const eff = resolveTaskStatus(t, p);
                      const m = STATUS_META[eff] || STATUS_META['on-track'];
                      const due = t.deadline ? formatDate(t.deadline) : 'No date';
                      const assignees = (t.owners && t.owners.length > 0) ? t.owners
                                    : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
                      const owner = assignees.length ? assignees.map(o => o.nameCache || o.dept || o.email).filter(Boolean).join(', ') : 'Unassigned';

                      return `
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #F3F3F2;font-size:11px;">
                          <div style="flex:1;min-width:0;padding-right:12px;">
                            <div style="font-weight:600;color:var(--text);">${t.title || t.name || 'Untitled'}</div>
                            <div style="color:var(--text-muted);font-size:10px;">Assigned to: ${owner}</div>
                          </div>
                          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                            <span style="color:var(--text-muted);">${due}</span>
                            <span style="font-size:9px;font-weight:700;color:${m.color};background:${m.color}15;padding:2px 6px;border-radius:6px;">
                              ${m.label.toUpperCase()}
                            </span>
                            <button class="btn-danger-xs" onclick="saDeleteTask('${p.id}', '${t.id}')">Delete</button>
                          </div>
                        </div>`;
                    }).join('')}
                  </div>
                </details>`;
            }).join('')}
          </div>
        </details>`;
    });

    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = `<div class="muted" style="padding:24px;">Error loading tasks: ${e.message}</div>`;
  }
}

// Global Super Admin Task Deletion
window.saDeleteTask = async (productId, taskId) => {
  if (!confirm("SUPER ADMIN OVERRIDE: Are you absolutely sure you want to permanently delete this task across the entire system?")) return;
  try {
    const snap = await get(ref(db, 'products/' + productId));
    const prod = snap.val();
    if (!prod) return;
    
    const isNewFormat = !!prod.tasks?.[taskId];
    const path = isNewFormat ? 'tasks/' + taskId : 'pillars/' + taskId;
    await set(ref(db, 'products/' + productId + '/' + path), null);
    
    showToast("Task deleted globally.", "success");
    loadSATab('tasks'); // Refresh the tab
  } catch(e) {
    showToast("Failed to delete task.", "error");
  }
};

window.saDeleteProject = async (productId, productName) => {
  if (!confirm(`EXTREME DANGER: Permanently delete "${productName}"?\n\nThis will wipe the product, tasks, comments, and email logs.\n\nThis CANNOT be undone.`)) return;
  
  showToast('Wiping project...', 'info');
  try {
    // 1. Delete the core product (This is the critical path)
    await set(ref(db, `products/${productId}`), null);

    // 2. Attempt to delete auxiliary data, but gracefully ignore Firebase permission blocks
    const auxPaths = [
      `emailLog/${productId}`,
      `comments/${productId}`,
      `config/projectSheets/${productId}`
    ];

    for (const path of auxPaths) {
      try {
        await set(ref(db, path), null);
      } catch (auxErr) {
        console.warn(`Silently skipped auxiliary delete for ${path}:`, auxErr.message);
      }
    }

    delete productListCache[productId];
    showToast('Project permanently deleted', 'success');

    // Instantly redraw the screen
    const container = document.getElementById('sa-tab-content');
    if (container && currentView === 'superadmin') {
      renderSAAllTasks(container);
    } else {
      loadView('superadmin');
    }
  } catch(e) {
    showToast('Wipe failed: ' + e.message, 'error');
  }
};

window.saDeleteTask = async (productId, taskId) => {
  if (!confirm("SUPER ADMIN OVERRIDE: Are you sure you want to permanently delete this task across the system?")) return;
  try {
    // Direct multi-path wipe to guarantee removal regardless of legacy/new schema format
    await Promise.all([
      set(ref(db, `products/${productId}/tasks/${taskId}`), null),
      set(ref(db, `products/${productId}/pillars/${taskId}`), null)
    ]);
    
    // Wipe local cache entries if present
    if (productListCache[productId]?.tasks?.[taskId]) delete productListCache[productId].tasks[taskId];
    if (productListCache[productId]?.pillars?.[taskId]) delete productListCache[productId].pillars[taskId];

    showToast("Task permanently deleted", "success");

    // Force UI refresh of the Circuit Box All Tasks tab
    const container = document.getElementById('sa-tab-content');
    if (container && typeof renderSATasksTab === 'function') {
      renderSATasksTab(container);
    } else if (currentView === 'superadmin') {
      loadView('superadmin');
    }
  } catch(e) {
    showToast("Delete failed: " + e.message, "error");
  }
};

window.saDeleteProject = async (productId, productName) => {
  if (!confirm(`EXTREME DANGER: Permanently delete "${productName}"?\n\nThis will wipe the product, tasks, comments, and email logs.\n\nThis CANNOT be undone.`)) return;
  
  showToast('Wiping project...', 'info');
  try {
    await Promise.all([
      set(ref(db, `products/${productId}`), null),
      set(ref(db, `emailLog/${productId}`), null),
      set(ref(db, `comments/${productId}`), null),
      set(ref(db, `config/projectSheets/${productId}`), null)
    ]);

    delete productListCache[productId];
    showToast('Project permanently deleted', 'success');

    const container = document.getElementById('sa-tab-content');
    if (container && typeof renderSATasksTab === 'function') {
      renderSATasksTab(container);
    } else {
      loadView('superadmin');
    }
  } catch(e) {
    showToast('Wipe failed: ' + e.message, 'error');
  }
};

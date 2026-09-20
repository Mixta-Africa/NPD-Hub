/* views/workload.js — Department Workload page. */

import { canViewTask } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';

/* ── DEPARTMENT WORKLOAD VIEW ── */
export function renderWorkload(el) {
  el.innerHTML =
    '<div class="view-header">' +
      '<div>' +
        '<h1 class="view-title">Department Workload</h1>' +
        '<p class="view-subtitle">Task load across all departments — next 14 days</p>' +
      '</div>' +
    '</div>' +
    '<div id="workload-body"><div class="loading-row" style="padding:32px;">Loading...</div></div>';
  loadWorkload();
}

async function loadWorkload() {
  const el = document.getElementById('workload-body');
  if (!el) return;
  try {
    const products = Object.values(await getProductsFresh()).filter(p => p.status !== 'archived');
    const today    = new Date(); today.setHours(0,0,0,0);
    const horizon  = new Date(today); horizon.setDate(horizon.getDate() + 14);

    // Build dept buckets: { deptName: { total, overdue, dueSoon, delayed, blocked, tasks[] } }
    const depts = {};

    const addToDept = (deptName, taskEntry) => {
      const key = deptName || 'Unassigned';
      if (!depts[key]) depts[key] = { total: 0, overdue: 0, dueSoon: 0, delayed: 0, blocked: 0, tasks: [] };
      depts[key].total++;
      depts[key].tasks.push(taskEntry);
      if (taskEntry.eff === 'overdue')   depts[key].overdue++;
      if (taskEntry.eff === 'due-soon')  depts[key].dueSoon++;
      if (taskEntry.eff === 'delayed')   depts[key].delayed++;
      if (taskEntry.isBlocked)           depts[key].blocked++;
    };

    products.forEach(prod => {
      const tasks    = getProductTasks(prod).filter(t => canViewTask(t, prod));
      const taskMap  = {};
      tasks.forEach(t => { taskMap[t.id] = t; });

      tasks.forEach(task => {
        if (task.status === 'complete') return;
        const eff      = resolveTaskStatus(task);
        const isBlocked = (task.predecessors || []).some(pid => {
          const pred = taskMap[pid];
          return pred && pred.status !== 'complete' && pred.taskStatus !== 'complete';
        });
        // Only include tasks due within horizon or already overdue/delayed/blocked
        const dueDate = task.deadline ? new Date(task.deadline) : null;
        if (dueDate) dueDate.setHours(0,0,0,0);
        const inWindow = dueDate && dueDate <= horizon;
        const needsAttention = eff === 'overdue' || eff === 'delayed' || isBlocked;
        if (!inWindow && !needsAttention) return;

        const entry = { task, prod, eff, isBlocked };
        // Map by task.owner (dept name stored there)
        // Multi-owner: a cross-functional task appears under every assigned dept
        if (task.owners && task.owners.length > 0) {
          const seen = [];
          task.owners.forEach(o => {
            const bucket = o.dept || ownerLabel(o) || 'Unassigned';
            if (seen.includes(bucket)) return;
            seen.push(bucket);
            addToDept(bucket, entry);
          });
        } else {
          addToDept(task.ownerDept || task.owner || 'Unassigned', entry);
        }
      });
    });

    if (Object.keys(depts).length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:64px 24px;text-align:center;">' +
        '<p style="font-size:13px;color:#6B7280;">No active tasks due in the next 14 days.</p></div>';
      return;
    }

    // Sort by URGENCY, not volume — a department with fewer tasks but a
    // higher proportion overdue needs eyes on it before a bigger, healthier
    // one. Sorting by total task count (the old behaviour) buried exactly
    // the department this whole view exists to surface.
    const sorted = Object.entries(depts).sort((a, b) => {
      const ua = a[1].overdue + a[1].delayed, ub = b[1].overdue + b[1].delayed;
      if (ub !== ua) return ub - ua;
      if (b[1].blocked !== a[1].blocked) return b[1].blocked - a[1].blocked;
      if (b[1].dueSoon !== a[1].dueSoon) return b[1].dueSoon - a[1].dueSoon;
      return b[1].total - a[1].total;
    });

    let html = '<div style="display:flex;flex-direction:column;gap:12px;">';

    sorted.forEach(([deptName, data]) => {
      const pctOverdue  = Math.round((data.overdue  / data.total) * 100);
      const pctDueSoon  = Math.round((data.dueSoon  / data.total) * 100);
      const pctDelayed  = Math.round((data.delayed  / data.total) * 100);
      const pctBlocked  = Math.round((data.blocked  / data.total) * 100);
      const pctOnTrack  = Math.max(0, 100 - pctOverdue - pctDueSoon - pctDelayed);
      const heatColor   = data.overdue > 0 ? '#C0282D' : data.delayed > 0 ? '#C0282D' : data.dueSoon > 0 ? '#D97706' : '#16A34A';

      // Task rows (max 4, sorted by urgency)
      const urgencyOrder = { overdue: 0, delayed: 1, blocked: 2, 'due-soon': 3, 'on-track': 4 };
      const taskRows = data.tasks
        .sort((a, b) => (urgencyOrder[a.isBlocked ? 'blocked' : a.eff] || 4) - (urgencyOrder[b.isBlocked ? 'blocked' : b.eff] || 4))
        .slice(0, 4)
        .map(({ task, prod, eff, isBlocked }) => {
          const color = isBlocked ? '#D97706' : eff === 'overdue' || eff === 'delayed' ? '#C0282D' : eff === 'due-soon' ? '#D97706' : '#16A34A';
          const label = isBlocked ? 'Blocked' : eff === 'overdue' ? 'Overdue' : eff === 'delayed' ? 'Delayed' : eff === 'due-soon' ? 'Due soon' : 'On track';
          return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #F3F3F2;cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background=\'#FAFAF9\'" onmouseout="this.style.background=\'none\'" onclick="viewProduct(\'' + prod.id + '\', \'' + task.id + '\')" title="Click to view task details">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:11px;font-weight:500;color:#1A1A1A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (task.title || 'Untitled') + '</div>' +
              '<div style="font-size:10px;color:#9CA3AF;">' + prod.name + (task.deadline ? ' · ' + formatDate(task.deadline) : '') + '</div>' +
            '</div>' +
            '<span style="font-size:10px;font-weight:600;color:' + color + ';background:' + color + '15;padding:2px 7px;border-radius:10px;flex-shrink:0;">' + label + '</span>' +
          '</div>';
        }).join('');

      const moreCount = data.tasks.length - 4;

      html +=
        '<div style="background:#fff;border:1px solid #E5E5E3;border-radius:12px;overflow:hidden;">' +
          // Header
          '<div style="padding:14px 18px 12px;display:flex;align-items:center;gap:14px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
                '<span style="font-size:13px;font-weight:700;color:#1A1A1A;">' + deptName + '</span>' +
                '<span style="font-size:10px;font-weight:600;color:' + heatColor + ';background:' + heatColor + '15;padding:2px 8px;border-radius:10px;">' + data.total + ' task' + (data.total !== 1 ? 's' : '') + '</span>' +
                (data.overdue  > 0 ? '<span style="font-size:10px;color:#C0282D;">' + data.overdue + ' overdue</span>'  : '') +
                (data.delayed  > 0 ? '<span style="font-size:10px;color:#C0282D;">' + data.delayed + ' delayed</span>'  : '') +
                (data.blocked  > 0 ? '<span style="font-size:10px;color:#D97706;">' + data.blocked + ' blocked</span>'  : '') +
              '</div>' +
              // Composition bar — always full-width. This is deliberately
              // NOT scaled by task count: the point is "what fraction of
              // this department's load is at risk," not "how big is this
              // department," so every bar has to be directly comparable.
              '<div style="height:6px;border-radius:3px;background:#F0F0EE;overflow:hidden;width:100%;">' +
                '<div style="height:6px;display:flex;">' +
                  (pctOverdue > 0 ? '<div style="flex:' + pctOverdue + ';background:#C0282D;" title="' + data.overdue + ' overdue"></div>' : '') +
                  (pctDelayed > 0 ? '<div style="flex:' + pctDelayed + ';background:#E05C5C;" title="' + data.delayed + ' delayed"></div>' : '') +
                  (pctDueSoon > 0 ? '<div style="flex:' + pctDueSoon + ';background:#D97706;" title="' + data.dueSoon + ' due soon"></div>' : '') +
                  (pctOnTrack > 0 ? '<div style="flex:' + pctOnTrack + ';background:#16A34A;" title="on track"></div>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // Task list
          (taskRows
            ? '<div style="padding:0 18px 4px;">' + taskRows +
                (moreCount > 0 ? '<div style="font-size:11px;color:#9CA3AF;padding:8px 0;">+' + moreCount + ' more task' + (moreCount !== 1 ? 's' : '') + '</div>' : '') +
              '</div>'
            : '') +
        '</div>';
    });

    html += '</div>';

    // Legend
    html = '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#6B7280;"><span style="width:10px;height:10px;border-radius:2px;background:#C0282D;display:inline-block;"></span>Overdue / Delayed</div>' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#6B7280;"><span style="width:10px;height:10px;border-radius:2px;background:#D97706;display:inline-block;"></span>Due soon / Blocked</div>' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#6B7280;"><span style="width:10px;height:10px;border-radius:2px;background:#16A34A;display:inline-block;"></span>On track</div>' +
    '</div>' + html;

    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load workload data.</div>';
    console.warn('loadWorkload error:', e);
  }
}

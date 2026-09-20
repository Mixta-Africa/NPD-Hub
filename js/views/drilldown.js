/* views/drilldown.js — Click-through from any dashboard tile to the underlying items. */

import { sanitiseEmail } from '../core/utils.js';
import { currentUser } from '../core/state.js';
import { canUserSeeProduct, canViewTask, taskVisMarker } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';

/* ══════════════════════════════════════════════════════════════
   DRILL-DOWN — clicking any dashboard tile shows the actual items
   behind that number, grouped by product/project, with every row
   clickable straight through to the item. No manual re-selection.
   ══════════════════════════════════════════════════════════════ */
export const DRILL_META = {
  overdue:  { title: 'Overdue & delayed',  sub: 'Everything past its deadline or explicitly marked delayed', color: '#C0282D' },
  ontrack:  { title: 'On track',           sub: 'Active tasks with a deadline that are running to plan',      color: '#16A34A' },
  week:     { title: 'Due this week',      sub: 'Tasks with a deadline in the next 7 days',                   color: '#D97706' },
  atrisk:   { title: 'At risk',            sub: 'Items launching within 21 days with 2+ delayed or overdue tasks', color: '#D97706' },
  active:   { title: 'Active items',       sub: 'Every product and project you can see',                      color: '#C0282D' },
  blocked:  { title: 'Blocked',            sub: 'Waiting on an incomplete predecessor task',                  color: '#D97706' },
  'due-soon': { title: 'Due soon',         sub: 'Within 3 days of deadline, not yet overdue',                 color: '#D97706' },
  complete: { title: 'Complete',           sub: 'Everything marked done',                                     color: '#2563EB' },
  deprioritized: { title: 'Stepped down',  sub: 'Tasks explicitly deprioritized rather than dropped',          color: '#6B7280' },
};

window.dashNavToTracker = (filter) => { loadView('drill:' + filter); };
window.openDrill        = (filter) => { loadView('drill:' + filter); };

export function renderDrilldown(el, filter) {
  const meta = DRILL_META[filter] || DRILL_META.overdue;
  el.innerHTML =
    '<div class="view-header">' +
      '<div>' +
        '<button class="btn-link-sm" style="margin-bottom:6px;" onclick="loadView(\'dashboard\')">← Back to dashboard</button>' +
        '<h1 class="view-title">' + meta.title + '</h1>' +
        '<p class="view-subtitle">' + meta.sub + '</p>' +
      '</div>' +
    '</div>' +
    '<div id="drill-body"><div class="loading-row" style="padding:32px;">Loading...</div></div>';
  loadDrilldown(filter);
}

async function loadDrilldown(filter) {
  const body = document.getElementById('drill-body');
  if (!body) return;
  try {
    const products = await getProductsFresh();
    const userKey = sanitiseEmail(currentUser.email);
    const today   = new Date(); 
    today.setHours(0,0,0,0);

    // Strict calendar week: Ends on Sunday at 23:59:59
    const daysUntilSunday = today.getDay() === 0 ? 0 : 7 - today.getDay();
    const weekEnd = new Date(today); 
    weekEnd.setDate(today.getDate() + daysUntilSunday);
    weekEnd.setHours(23, 59, 59, 999);

    const visible = Object.values(products)
      .filter(p => p.status !== 'archived' && canUserSeeProduct(p, userKey));

    // At-risk operates on whole items, not tasks
    if (filter === 'atrisk' || filter === 'active') {
      const items = visible.filter(p => {
        if (filter === 'active') return true;
        const tasks  = getProductTasks(p).filter(t => canViewTask(t, p));
        const issues = tasks.filter(t => ['overdue','delayed'].includes(resolveTaskStatus(t))).length;
        const launch = p.launchDate ? new Date(p.launchDate) : null;
        if (launch) launch.setHours(0,0,0,0);
        const days = launch ? Math.round((launch - today) / 86400000) : null;
        return issues >= 2 && days !== null && days >= 0 && days <= 21;
      });
      body.innerHTML = items.length
        ? '<div style="display:flex;flex-direction:column;gap:10px;">' + items.map(p => drillItemCard(p, today)).join('') + '</div>'
        : drillEmpty(filter);
      return;
    }

    // Task-level filters — group matching tasks under their parent item
    const groups = [];
    visible.forEach(p => {
      const matched = getProductTasks(p).filter(t => {
        if (!canViewTask(t, p)) return false;
        const eff = resolveTaskStatus(t);
        if (filter === 'overdue') return eff === 'overdue' || eff === 'delayed' || eff === 'blocked';
        if (filter === 'ontrack') return !!t.deadline && (eff === 'on-track' || eff === 'due-soon');
        if (filter === 'week') {
          if (!t.deadline || eff === 'complete') return false;
          const d = new Date(t.deadline); d.setHours(0,0,0,0);
          return d >= today && d <= weekEnd;
        }
        if (filter === 'blocked') return eff === 'blocked';
        if (filter === 'due-soon') return eff === 'due-soon';
        if (filter === 'complete') return eff === 'complete';
        if (filter === 'deprioritized') return eff === 'deprioritized';
        return false;
      });
      if (matched.length) groups.push({ p, tasks: matched });
    });

    if (groups.length === 0) { body.innerHTML = drillEmpty(filter); return; }

    // Busiest first — the thing needing attention leads
    groups.sort((a, b) => b.tasks.length - a.tasks.length);
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);

    body.innerHTML =
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">' +
        total + ' task' + (total !== 1 ? 's' : '') + ' across ' + groups.length + ' item' + (groups.length !== 1 ? 's' : '') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;">' +
        groups.map(g => drillGroup(g, today, filter)).join('') +
      '</div>';
  } catch(e) {
    console.warn('loadDrilldown failed:', e);
    body.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load. Try refreshing.</div>';
  }
}

function drillEmpty(filter) {
  const m = DRILL_META[filter] || {};
  return '<div class="panel"><div class="empty-state" style="padding:48px 24px;">' +
    '<div style="margin-bottom:12px;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>' +
    '<h3 style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">Nothing here</h3>' +
    '<p style="font-size:13px;color:var(--text-muted);">No items match "' + (m.title || filter) + '" right now.</p>' +
    '</div></div>';
}

function drillItemCard(p, today) {
  const tasks  = getProductTasks(p).filter(t => canViewTask(t, p));
  const done   = tasks.filter(t => resolveTaskStatus(t) === 'complete').length;
  const issues = tasks.filter(t => ['overdue','delayed'].includes(resolveTaskStatus(t))).length;
  const pct    = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const launch = p.launchDate ? new Date(p.launchDate) : null;
  if (launch) launch.setHours(0,0,0,0);
  const days = launch ? Math.round((launch - today) / 86400000) : null;
  return '<div style="background:#fff;border:1px solid var(--border);border-left:3px solid #D97706;border-radius:10px;padding:14px 16px;cursor:pointer;" onclick="openProjectDashboard(\'' + p.id + '\')">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
      '<span style="font-size:13px;font-weight:700;color:var(--text);">' + p.name + '</span>' +
      ((p.itemType || 'product') === 'project'
        ? '<span style="font-size:9px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:1px 7px;border-radius:8px;">PROJECT</span>'
        : '<span style="font-size:9px;font-weight:700;color:#C0282D;background:#FEF2F2;padding:1px 7px;border-radius:8px;">PRODUCT</span>') +
      (days !== null ? '<span style="font-size:11px;color:' + (days < 0 ? 'var(--red)' : 'var(--amber)') + ';">' +
        (days < 0 ? Math.abs(days) + 'd overdue' : days + 'd to launch') + '</span>' : '') +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-muted);">' + issues + ' overdue or delayed · ' + pct + '% complete · owner ' + (p.ownerName || 'unassigned') + '</div>' +
  '</div>';
}

function drillGroup(g, today, filter) {
  const p = g.p;
  const isProject = (p.itemType || 'product') === 'project';
  const rows = g.tasks.map(t => {
    const eff = resolveTaskStatus(t);
    const m   = STATUS_META[eff] || STATUS_META['on-track'];
    let due = 'No date';
    if (t.deadline) {
      const d = new Date(t.deadline); d.setHours(0,0,0,0);
      const diff = Math.round((d - today) / 86400000);
      due = diff < 0 ? Math.abs(diff) + 'd overdue' : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : formatDate(t.deadline);
    }
    const owners = (t.owners && t.owners.length) ? t.owners
      : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
    const who = owners.length ? owners.map(o => ownerLabel(o)).join(', ') : 'Unassigned';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid #F3F3F2;cursor:pointer;" ' +
        'onclick="event.stopPropagation();openTaskFromDrill(\'' + p.id + '\',\'' + t.id + '\')">' +
      taskVisMarker(t) +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (t.title || 'Untitled') + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);">' + who + '</div>' +
      '</div>' +
      '<span style="font-size:11px;color:' + m.color + ';white-space:nowrap;">' + due + '</span>' +
      '<span style="font-size:9px;font-weight:700;color:' + m.color + ';background:' + m.color + '15;padding:2px 7px;border-radius:8px;white-space:nowrap;">' + m.label.toUpperCase() + '</span>' +
    '</div>';
  }).join('');

  return '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">' +
    '<div style="padding:12px 16px;display:flex;align-items:center;gap:8px;cursor:pointer;background:#FAFAF9;" ' +
        'onclick="openProjectDashboard(\'' + p.id + '\')">' +
      '<span style="font-size:13px;font-weight:700;color:var(--text);">' + p.name + '</span>' +
      (isProject
        ? '<span style="font-size:9px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:1px 7px;border-radius:8px;">PROJECT</span>'
        : '<span style="font-size:9px;font-weight:700;color:#C0282D;background:#FEF2F2;padding:1px 7px;border-radius:8px;">PRODUCT</span>') +
      '<span style="font-size:11px;color:var(--text-muted);margin-left:auto;">' + g.tasks.length + ' task' + (g.tasks.length !== 1 ? 's' : '') + ' →</span>' +
    '</div>' + rows +
  '</div>';
}

window.openTaskFromDrill = (productId, taskId) => {
  viewProduct(productId, taskId);
};

/* ── DASHBOARD NAV HELPERS ── */
window.dashNavToTracker = (filter) => {
  // Store filter for tracker to read on load
  window._trackerFilter = filter;
  loadView('tracker');
};

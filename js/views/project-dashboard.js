/* views/project-dashboard.js — Per-project dashboard and stat-tile department breakdown. */

import { db, onValue, ref } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentUser } from '../core/state.js';
import { registerListener } from '../core/listeners.js';
import { accessBadge, canEdit, canUserSeeProduct, canViewBudget, canViewTask, taskVisMarker } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { generateDependencyMap } from '../features/dependency-map.js';
import { computeProjectPrediction, formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { ensureProductModal } from '../features/product-form.js';

/* ══════════════════════════════════════════════════════════════
   PROJECT DASHBOARD — each item gets its own view rather than a
   modal, so it can be navigated to and away from like any page.
   Two sections, mirroring the Projects Tracker: Overview and
   Departments.
   ══════════════════════════════════════════════════════════════ */
window.openProjectDashboard = (productId) => { loadView('project:' + productId); };

export function renderProjectDashboard(el, productId) {
  el.innerHTML = '<div id="pd-body"><div class="loading-row" style="padding:32px;">Loading...</div></div>';
  loadProjectDashboard(productId);
}

async function loadProjectDashboard(productId) {
  const body = document.getElementById('pd-body');
  if (!body) return;
  try {
    // Upgraded from a one-time get() to a real-time onValue() listener
    const unsub = onValue(ref(db, 'products/' + productId), snap => {
      if (!snap.exists()) { body.innerHTML = '<div class="loading-row muted" style="padding:24px;">Item not found.</div>'; return; }
      const p = snap.val();
      productListCache[productId] = p;

      const userKey = sanitiseEmail(currentUser.email);
      if (!canUserSeeProduct(p, userKey)) {
        body.innerHTML = '<div class="panel"><div class="empty-state" style="padding:48px 24px;">' +
          '<h3 style="font-size:15px;font-weight:600;margin-bottom:6px;">No access</h3>' +
          '<p style="font-size:13px;color:var(--text-muted);">You do not have access to this item.</p>' +
          '<button class="btn-outline" style="margin-top:12px;" onclick="loadView(\'products\')">← Back</button>' +
          '</div></div>';
        return;
      }

      const tasks   = getProductTasks(p).filter(t => canViewTask(t, p));
      const today   = new Date(); today.setHours(0,0,0,0);
      
      // We pass `p` into resolveTaskStatus here to ensure 'Blocked' tasks are accounted for globally
      const done    = tasks.filter(t => resolveTaskStatus(t, p) === 'complete').length;
      const delayed = tasks.filter(t => ['overdue','delayed'].includes(resolveTaskStatus(t, p))).length;
      const blocked = tasks.filter(t => resolveTaskStatus(t, p) === 'blocked').length;
      const onTrack = Math.max(0, tasks.length - done - delayed - blocked);
      const pct     = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
      
      const isProject = (p.itemType || 'product') === 'project';
      const launch  = p.launchDate ? new Date(p.launchDate) : null;
      if (launch) launch.setHours(0,0,0,0);
      const days = launch ? Math.round((launch - today) / 86400000) : null;
      const dependencyMapSyntax = generateDependencyMap(tasks, p);
      // --- SMART FORECAST ---
      const forecast = computeProjectPrediction(p);
      let forecastHtml = '';
      if (forecast.delayDays > 0) {
        // Map the bottlenecks array into a neat HTML list
        const bottleneckList = forecast.bottlenecks && forecast.bottlenecks.length > 0 
          ? forecast.bottlenecks.map(b => '<li style="margin-bottom:4px;"><strong>' + b.name + '</strong> (' + b.delay + 'd direct delay)</li>').join('')
          : '<li>Unspecified cascading delays across multiple tasks.</li>';

        forecastHtml = `
          <details style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;margin-bottom:16px;cursor:pointer;">
            <summary style="padding:12px 16px;display:flex;align-items:center;gap:12px;list-style:none;outline:none;">
              <div style="width:36px;height:36px;border-radius:8px;background:#FEF3C7;color:#D97706;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                ${ICON.bolt}
              </div>
              <div style="flex:1;">
                <div style="font-size:12px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em;">AI Forecast</div>
                <div style="font-size:13px;color:#B45309;margin-top:2px;">
                  Projected finish: <strong>${formatDate(forecast.predictedDate)}</strong> (+${forecast.delayDays}d slip). <em style="opacity:0.8;">Click to view breakdown.</em>
                </div>
              </div>
              <div style="text-align:right;padding-right:8px;">
                <div style="font-size:18px;font-weight:700;color:#D97706;">${forecast.probability}%</div>
                <div style="font-size:10px;color:#B45309;text-transform:uppercase;">Delay Risk</div>
              </div>
            </summary>
            
            <div style="padding:0 16px 16px 64px;font-size:12px;color:#92400E;line-height:1.6;border-top:1px dashed #FDE68A;margin-top:-4px;padding-top:12px;">
              <div style="font-weight:700;margin-bottom:8px;text-transform:uppercase;font-size:11px;letter-spacing:0.04em;">Critical Path Bottlenecks</div>
              <ul style="margin:0 0 10px 0;padding-left:18px;">
                ${bottleneckList}
              </ul>
              <div style="opacity:0.85;font-size:11px;">
                <strong>PM Insight:</strong> The engine calculates inherited delay across the dependency graph. Resolving the bottlenecks listed above will pull the final launch date forward.
              </div>
            </div>
          </details>`;
      }

      const byDept = {};
      tasks.forEach(t => {
        const owners = (t.owners && t.owners.length) ? t.owners
          : [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner || '' }];
        const seen = [];
        owners.forEach(o => {
          const key = o.dept || ownerLabel(o) || 'Unassigned';
          if (seen.includes(key)) return;
          seen.push(key);
          (byDept[key] = byDept[key] || []).push(t);
        });
      });

      const statCard = (label, val, color, tint, iconSvg, metric) =>
        '<div class="stat-card dash-stat-card ' + tint + '"' + (metric ? ' style="cursor:pointer;" onclick="showStatBreakdown(\'' + p.id + '\',\'' + metric + '\')"' : '') + '>' +
          '<div class="stat-header">' +
            '<div class="stat-icon-wrap">' + iconSvg + '</div>' +
          '</div>' +
          '<div class="stat-label">' + label + '</div>' +
          '<div class="stat-value" style="color:' + color + ';">' + val + '</div>' +
        '</div>';

      const icoTrend  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + (pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)') + '" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
      const icoCheck  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      const needsClr  = (delayed + blocked) > 0 ? 'var(--red)' : 'var(--green)';
      const icoWarn   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' + needsClr + '" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

      body.innerHTML =
        '<div class="view-header">' +
          '<div>' +
            '<button class="btn-link-sm" style="margin-bottom:6px;" onclick="loadView(\'products\')">← All products &amp; projects</button>' +
            '<h1 class="view-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' + p.name +
              (isProject
                ? '<span style="font-size:10px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:3px 9px;border-radius:10px;">PROJECT</span>'
                : '<span style="font-size:10px;font-weight:700;color:#C0282D;background:#FEF2F2;padding:3px 9px;border-radius:10px;">PRODUCT</span>') +
              accessBadge(p) +
            '</h1>' +
            '<p class="view-subtitle">' +
              (isProject ? 'Target completion' : 'Target launch') + ': ' + (p.launchDate ? formatDate(p.launchDate) : 'not set') +
              (days !== null ? (days < 0 ? ' · ' + Math.abs(days) + 'd overdue' : ' · ' + days + 'd to go') : '') +
              ' · Owner ' + (p.ownerName || 'unassigned') +
            '</p>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            (canEdit(p) ? '<button class="btn-primary" onclick="showQuickUpdate(\'' + p.id + '\')">' + ICON.bolt + ' Update</button>' : '') +
            (canEdit(p) ? '<button class="btn-secondary-sm" onclick="showAddTaskToProduct(\'' + p.id + '\')">+ Task</button>' : '') +
            (canEdit(p) ? '<button class="btn-secondary-sm" onclick="syncProjectSheet(\'' + p.id + '\')">Live sheet</button>' : '') +
            '<button class="btn-secondary-sm" onclick="exportProjectTracker(\'' + p.id + '\')">Export tracker</button>' +
            '<button class="btn-secondary-sm" onclick="viewProduct(\'' + p.id + '\')">Full detail</button>' +
          '</div>' +
        '</div>' +

        forecastHtml + 

        '<div class="stats-row">' +
          statCard('Progress',  pct + '%',      pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)', pct >= 75 ? 'stat-tint-green' : pct >= 40 ? 'stat-tint-amber' : 'stat-tint-red', icoTrend, 'progress') +
          statCard('Complete',  done,           'var(--green)', 'stat-tint-green', icoCheck, 'complete') +
          statCard('On track',  onTrack,        'var(--green)', 'stat-tint-green', icoCheck, 'ontrack') +
          statCard('Needs action', delayed + blocked, needsClr, (delayed + blocked) > 0 ? 'stat-tint-red' : 'stat-tint-green', icoWarn, 'needsaction') +
        '</div>' +
        
       // --- INJECT DEPENDENCY MAP (collapsed by default — not everyone
       // needs it open, and it eats real vertical space when it is) ---
        (dependencyMapSyntax ? `
          <div class="panel" style="margin-bottom:16px;">
            <div class="panel-header" style="cursor:pointer;" onclick="toggleDepMap('${p.id}')">
              <span class="panel-title" style="display:flex;align-items:center;gap:6px;">
                <svg id="dep-map-chevron-${p.id}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform .15s;"><path d="M9 18l6-6-6-6"/></svg>
                Dependency Map
              </span>
              <span style="font-size:11px;color:var(--text-muted);">Sequence, owners and what is blocking what</span>
            </div>
            <div id="dep-map-body-${p.id}" style="display:none;">
              <div style="padding:10px 18px 0;display:flex;gap:16px;flex-wrap:wrap;font-size:10px;color:var(--text-muted);">
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#F0FDF4;border:1.5px solid #16A34A;margin-right:4px;vertical-align:-1px;"></span>On track</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#FFFBEB;border:1.5px solid #D97706;margin-right:4px;vertical-align:-1px;"></span>Due soon / blocked</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#FEF2F2;border:1.5px solid #C0282D;margin-right:4px;vertical-align:-1px;"></span>Overdue / delayed</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#EFF6FF;border:1.5px solid #2563EB;margin-right:4px;vertical-align:-1px;"></span>Complete</span>
                <span style="border-left:1px solid var(--border);padding-left:14px;"><strong>&#8658;</strong> cleared &nbsp; <strong>&#8594;</strong> waiting on</span>
              </div>
              <div class="panel-body" style="overflow:auto; max-height:420px; background:#FAFAF9; border-radius:8px;">
                <div id="mermaid-container-${p.id}" style="text-align:center; padding:24px; font-size:12px; color:var(--text-muted);">
                  <span class="spinner-sm"></span> Drawing map...
                </div>
              </div>
            </div>
          </div>` : '') +

        ((isProject && canViewBudget(p) && (p.budget || p.spend)) ? buildPdBudget(p) : '') +

        '<div class="panel" id="pd-departments">' +
          '<div class="panel-header">' +
            '<span class="panel-title">By department</span>' +
            '<span style="font-size:11px;color:var(--text-muted);">' + Object.keys(byDept).length + ' involved</span>' +
          '</div>' +
          (Object.keys(byDept).length === 0
            ? '<div style="padding:18px;font-size:12px;color:#9CA3AF;">No tasks yet. Add one to get started.</div>'
            : Object.entries(byDept)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([dept, list]) => buildPdDeptBlock(dept, list, today, p))
                .join('')) +
            '</div>';

          // --- MERMAID RENDERER: NOW SAFELY INSIDE THE LIVE LISTENER ---
          if (dependencyMapSyntax) {
            setTimeout(() => {
              if (window.mermaid) {
                try {
                  const container = document.getElementById('mermaid-container-' + productId);
                  if (container) {
                    const safeId = 'mermaid-svg-' + Date.now();
                    mermaid.render(safeId, dependencyMapSyntax, (svgCode) => {
                      container.innerHTML = svgCode;
                      // Soft per-node shadow — drop-shadow renders once per opaque
                      // shape in the SVG, so each task box gets its own lift
                      // without touching every node individually.
                      const svgEl = container.querySelector('svg');
                      if (svgEl) svgEl.style.filter = 'drop-shadow(0 1px 3px rgba(16,24,40,0.12))';
                    });
                  }
                } catch(e) { 
                  console.warn('Mermaid engine failed:', e);
                  const container = document.getElementById('mermaid-container-' + productId);
                  if (container) container.innerHTML = '<div style="color:var(--red);font-size:12px;">Map engine encountered a syntax error.</div>';
                }
              }
            }, 50);
          }

        }); // <--- END OF THE FIREBASE LIVE LISTENER

        // Register the listener so it safely unmounts when you change pages
        registerListener('project_dash', unsub);
        
      } catch(e) {
        console.warn('loadProjectDashboard failed:', e);
        body.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load this item.</div>';
      }
}

function buildPdBudget(p) {
  const b = Number(p.budget || 0), sp = Number(p.spend || 0);
  const over = sp > b, pct = b > 0 ? Math.min(100, (sp / b) * 100) : 0;
  return '<div class="panel" style="margin-bottom:16px;">' +
    '<div class="panel-header"><span class="panel-title">Budget</span>' +
      '<span style="font-size:11px;color:' + (over ? 'var(--red)' : 'var(--text-muted)') + ';">' +
        (over ? 'Over by ₦' + (sp - b).toLocaleString() : '₦' + (b - sp).toLocaleString() + ' remaining') + '</span></div>' +
    '<div class="panel-body">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">' +
        '<span>Budget ₦' + b.toLocaleString() + '</span>' +
        '<span style="color:' + (over ? 'var(--red)' : 'var(--text)') + ';">Spent ₦' + sp.toLocaleString() + '</span>' +
      '</div>' +
      '<div style="height:6px;background:#F0F0EE;border-radius:3px;overflow:hidden;">' +
        '<div style="height:6px;width:' + pct + '%;background:' + (over ? 'var(--red)' : 'var(--blue)') + ';border-radius:3px;"></div>' +
      '</div>' +
    '</div></div>';
}

function buildPdDeptBlock(dept, list, today, p) {
  const issues = list.filter(t => ['overdue','delayed'].includes(resolveTaskStatus(t, p))).length;
  const done   = list.filter(t => resolveTaskStatus(t, p) === 'complete').length;
  const rows = list.map(t => {
    const eff = resolveTaskStatus(t, p);
    const m   = STATUS_META[eff] || STATUS_META['on-track'];
    let due = 'No date';
    if (t.deadline) {
      const d = new Date(t.deadline); d.setHours(0,0,0,0);
      const diff = Math.round((d - today) / 86400000);
      due = diff < 0 ? Math.abs(diff) + 'd overdue' : diff === 0 ? 'Today' : formatDate(t.deadline);
    }
    return '<div class="pd-task-row" onclick="showTaskDetailPanel(\'' + p.id + '\',\'' + t.id + '\')" style="display:flex;align-items:center;gap:10px;padding:8px 18px;border-top:1px solid #F3F3F2;cursor:pointer;transition:background .12s;">' +
      taskVisMarker(t) +
      '<div style="flex:1;min-width:0;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (t.title || 'Untitled') + '</div>' +
      '<span style="font-size:11px;color:' + m.color + ';white-space:nowrap;">' + due + '</span>' +
      '<span style="font-size:9px;font-weight:700;color:' + m.color + ';background:' + m.color + '15;padding:2px 7px;border-radius:8px;">' + m.label.toUpperCase() + '</span>' +
    '</div>';
  }).join('');
  return '<div style="border-top:1px solid var(--border);">' +
    '<div style="padding:10px 18px;display:flex;align-items:center;gap:8px;background:#FAFAF9;">' +
      '<span style="font-size:12px;font-weight:700;color:var(--text);">' + dept + '</span>' +
      '<span style="font-size:10px;color:var(--text-muted);">' + done + '/' + list.length + ' done</span>' +
      (issues > 0 ? '<span style="font-size:10px;font-weight:700;color:var(--red);background:#FEF2F2;padding:1px 7px;border-radius:8px;">' + issues + ' need action</span>' : '') +
    '</div>' + rows +
  '</div>';
}

window.scrollToDept = () => {
  const el = document.getElementById('pd-departments');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ══ STAT TILE → DEPARTMENT BREAKDOWN ═════════════════════════
   Each of the four tiles at the top of a project's dashboard opens
   this instead of just being a number — a real per-department chart
   for that specific metric, not a generic "scroll to the list below". */
window.showStatBreakdown = (productId, metric) => {
  ensureProductModal();
  const prod = productListCache[productId];
  if (!prod) return;
  const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));

  const METRIC_META = {
    progress:    { title: 'Progress by department',            match: t => resolveTaskStatus(t, prod) === 'complete' },
    complete:    { title: 'Completed tasks by department',      match: t => resolveTaskStatus(t, prod) === 'complete' },
    ontrack:     { title: 'On-track tasks by department',       match: t => ['on-track', 'due-soon'].includes(resolveTaskStatus(t, prod)) },
    needsaction: { title: 'Tasks needing action, by department', match: t => ['overdue', 'delayed', 'blocked'].includes(resolveTaskStatus(t, prod)) },
  };
  const meta = METRIC_META[metric] || METRIC_META.complete;

  const byDept = {};
  tasks.forEach(t => {
    const owners = (t.owners && t.owners.length) ? t.owners : [{ dept: t.ownerDept || '' }];
    const seen = [];
    owners.forEach(o => {
      const key = o.dept || 'Unassigned';
      if (seen.includes(key)) return;
      seen.push(key);
      if (!byDept[key]) byDept[key] = { total: 0, matched: 0 };
      byDept[key].total++;
      if (meta.match(t)) byDept[key].matched++;
    });
  });

  const rows = Object.entries(byDept)
    .filter(([, d]) => d.matched > 0)
    .sort((a, b) => b[1].matched - a[1].matched);
  const maxMatched = Math.max(1, ...rows.map(([, d]) => d.matched));

  document.getElementById('modal-title-text').textContent = meta.title;
  document.getElementById('modal-body-content').innerHTML =
    (rows.length === 0
      ? '<div style="font-size:12px;color:var(--text-muted);padding:20px 0;text-align:center;">No tasks match this for any department.</div>'
      : rows.map(([dept, d]) => {
          const barPct = Math.round((d.matched / maxMatched) * 100);
          return '<div style="margin-bottom:14px;">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><strong style="color:var(--text);">' + dept + '</strong><span style="color:var(--text-muted);">' + d.matched + ' of ' + d.total + ' tasks</span></div>' +
            '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;"><div style="height:8px;width:' + barPct + '%;background:var(--red);border-radius:4px;"></div></div>' +
          '</div>';
        }).join('')
    ) +
    '<div class="form-actions" style="margin-top:8px;"><button class="btn-outline" onclick="closeProductModal()">Close</button></div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

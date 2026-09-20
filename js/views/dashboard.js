/* views/dashboard.js — Dashboard page: stat tiles, product grid, live refresh. */

import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser } from '../core/state.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus } from '../data/status.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { loadDashboardEmailLog } from '../features/email-log.js';
import { loadPreferredName } from './settings.js';
import { getGreeting } from '../ui/shell.js';
import { renderDashboardCharts } from './dashboard-charts.js';

export function renderDashboard(el) {
  loadPreferredName().then(() => {
    const name = currentPreferredName;
    
    const adminToggle = currentRole === 'admin' ? `
      <div style="display:flex;background:rgba(0,0,0,0.05);padding:3px;border-radius:7px;width:fit-content;margin-top:8px;">
        <button id="view-mode-personal" onclick="setAdminViewMode('personal')" style="padding:4px 14px;border:none;border-radius:5px;font-size:11px;font-weight:700;font-family:Poppins,sans-serif;cursor:pointer; transition:all 0.2s; ${window.adminViewMode === 'personal' ? 'background:var(--red);color:#fff;box-shadow:0 1px 4px rgba(192,40,45,0.3);' : 'background:transparent;color:var(--text-muted);'}">My View</button>
        <button id="view-mode-org" onclick="setAdminViewMode('org')" style="padding:4px 14px;border:none;border-radius:5px;font-size:11px;font-weight:700;font-family:Poppins,sans-serif;cursor:pointer; transition:all 0.2s; ${window.adminViewMode === 'org' ? 'background:var(--red);color:#fff;box-shadow:0 1px 4px rgba(192,40,45,0.3);' : 'background:transparent;color:var(--text-muted);'}">Org View</button>
      </div>` : '';

    el.innerHTML = `
      <div class="hero-banner">
        <div style="max-width:60%;">
          <div class="hero-greeting">Good ${getGreeting()},</div>
          <div class="hero-name">
            <span id="dash-greeting-name" onclick="editPreferredName()" title="Click to personalise your name" style="cursor:pointer;">${name}.</span>
          </div>
          <div class="hero-sub">Here's what's happening across your products and projects.</div>
          ${adminToggle}
        </div>
        <button class="btn-primary-sm" style="display:flex; align-items:center; gap:6px; box-shadow:0 2px 8px rgba(192,40,45,0.25);" onclick="showCreateProduct()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Project
        </button>
      </div>

      <div class="stats-row">
        <div class="stat-card dash-stat-card stat-tint-red" onclick="openDrill('active')">
          <div class="stat-header">
            <div class="stat-icon-wrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
            <div class="stat-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
          </div>
          <div class="stat-label">Active Items</div>
          <div id="stat-active" class="stat-value">—</div>
          <div id="stat-slip" class="stat-nav-hint" style="color:var(--red);"></div>
        </div>

        <div class="stat-card dash-stat-card stat-tint-green" onclick="openDrill('ontrack')">
          <div class="stat-header">
            <div class="stat-icon-wrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
            <div class="stat-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
          </div>
          <div class="stat-label">On Track</div>
          <div style="display:flex; justify-content:space-between; align-items:flex-end;">
            <div id="stat-ontrack" class="stat-value">—</div>
            <div id="stat-ontrack-pct" style="color:var(--green); font-size: 11px; font-weight: 600;"></div>
          </div>
          <div id="stat-ontrack-hint" class="stat-nav-hint">See the tasks</div>
        </div>

        <div class="stat-card dash-stat-card stat-tint-amber" onclick="openDrill('overdue')">
          <div class="stat-header">
            <div class="stat-icon-wrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <div class="stat-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
          </div>
          <div class="stat-label">Overdue</div>
          <div id="stat-overdue" class="stat-value">—</div>
          <div class="stat-nav-hint">See what is overdue</div>
        </div>

        <div class="stat-card dash-stat-card stat-tint-blue" onclick="openDrill('week')">
          <div class="stat-header">
            <div class="stat-icon-wrap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
            <div class="stat-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
          </div>
          <div class="stat-label">Due This Week</div>
          <div id="stat-week" class="stat-value">—</div>
          <div class="stat-nav-hint">See the tasks</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <span style="font-size:11px;color:var(--text-muted);">Jump to:</span>
        <select id="dash-status-filter" class="select-field" style="max-width:200px;font-size:12px;" onchange="if(this.value) openDrill(this.value); this.value='';">
          <option value="">Filter by status…</option>
          <option value="blocked">Blocked</option>
          <option value="overdue">Overdue &amp; delayed</option>
          <option value="due-soon">Due soon</option>
          <option value="ontrack">On track</option>
          <option value="deprioritized">Stepped down</option>
          <option value="complete">Complete</option>
        </select>
      </div>

      <div class="dashboard-row-2col">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title" style="display:flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
              Projects
            </span>
            <button class="panel-link-red" onclick="loadView('products')">View all &rarr;</button>
          </div>
          <div id="dash-recent"><div class="loading-row" style="padding:16px;">Loading...</div></div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <span class="panel-title" style="display:flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Upcoming Deadlines
            </span>
            <button class="panel-link-red" onclick="loadView('calendar')">Calendar &rarr;</button>
          </div>
          <div id="dash-deadlines" style="max-height:280px;overflow-y:auto;"><div class="loading-row" style="padding:16px;">Loading...</div></div>
        </div>
      </div>

      <div class="dashboard-row-2col">
        <div class="panel" style="display:flex; flex-direction:column;">
          <div class="panel-header">
            <span class="panel-title" style="display:flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Project Progress
            </span>
            <div style="display:flex; gap:12px; font-size:10px; font-weight:600; color:var(--text-muted); text-transform:none; letter-spacing:0;">
              <span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span> Planned</span>
              <span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--red);"></span> Actual</span>
            </div>
          </div>
          <div style="flex:1; position: relative; padding: 12px 16px 16px; min-height:150px;">
            <canvas id="progressChart"></canvas>
          </div>
        </div>

        <div class="panel" style="display:flex; flex-direction:column;">
          <div class="panel-header">
            <span class="panel-title">Overall Completion</span>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; justify-content:center; padding: 12px 16px;">
            <div style="position: relative; height: 110px;">
              <canvas id="completionChart"></canvas>
            </div>
            <div id="donut-legend" style="margin-top:12px;"></div>
          </div>
        </div>
      </div>

      <div class="panel dash-qa-panel" style="display:flex; margin-bottom:16px;">
        <div class="dash-qa" style="flex:0 0 260px; padding:12px 16px; border-right:1px solid var(--border);">
          <span class="panel-title" style="display:flex; align-items:center; gap:6px; margin-bottom:10px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Quick Actions
          </span>
          <div class="quick-actions-grid">
            <button class="qa-btn" onclick="showCreateProduct()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Add Project
            </button>
            <button class="qa-btn" onclick="loadView('products')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> Create Task
            </button>
            <button class="qa-btn" onclick="loadView('calendar')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> View Calendar
            </button>
            <button class="qa-btn" onclick="loadView('reports')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Generate Report
            </button>
          </div>
        </div>

        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
          <div class="panel-header" style="border-radius:0;">
            <span class="panel-title" style="display:flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Recent Activity
            </span>
            <button class="panel-link-red" onclick="loadView('reports')">View all &rarr;</button>
          </div>
          <div id="dash-emaillog" style="flex:1;"><div class="loading-row" style="padding:16px;">Loading...</div></div>
        </div>
      </div>`;
      
    loadDashboardStats();
    loadDashboardEmailLog();
  });
}
window.setAdminViewMode = (mode) => {
  window.adminViewMode = mode;
  // Visually swap the toggle buttons
  const btnP = document.getElementById('view-mode-personal');
  const btnO = document.getElementById('view-mode-org');
  if (btnP && btnO) {
    if (mode === 'personal') {
      btnP.style.background = 'var(--red)'; btnP.style.color = '#fff'; btnP.style.boxShadow = '0 1px 4px rgba(192,40,45,0.3)';
      btnO.style.background = 'transparent'; btnO.style.color = 'var(--text-muted)'; btnO.style.boxShadow = 'none';
    } else {
      btnO.style.background = 'var(--red)'; btnO.style.color = '#fff'; btnO.style.boxShadow = '0 1px 4px rgba(192,40,45,0.3)';
      btnP.style.background = 'transparent'; btnP.style.color = 'var(--text-muted)'; btnP.style.boxShadow = 'none';
    }
  }
  // Instantly re-render the dashboard without fetching from Firebase again
  refreshDashboardUI();
};

export function refreshDashboardUI() {
  if (!productListCache || Object.keys(productListCache).length === 0) return;
  const products = productListCache;
  const userKey  = sanitiseEmail(currentUser.email);
  
  // Delegates to the single access function — see canUserSeeProduct.
  const list = Object.values(products)
    .filter(p => p.status !== 'archived' && canUserSeeProduct(p, userKey));
  
  _updateDashboardUI(list);
}

export let _dashRefreshTimer = null;

export async function loadDashboardStats() {
  try {
    // The listener that used to live here is now global and session-long
    // (startGlobalProductsListener, started once at login) so it survives
    // navigation instead of being torn down every time you leave this
    // view. This function's only job now is to paint the dashboard with
    // whatever's already in the shared cache the instant it mounts —
    // refreshDashboardUI reads productListCache directly, which the
    // global listener keeps current on every subsequent tick too.
    await getProductsFresh();
    refreshDashboardUI();
  } catch(e) { console.warn('Stats load failed:', e); }
}

// Separated so onValue callback can call it
function _updateDashboardUI(list) {
  try {
    const today = new Date(); 
    today.setHours(0,0,0,0);

    const daysUntilSunday = today.getDay() === 0 ? 0 : 7 - today.getDay();
    const weekEnd = new Date(today); 
    weekEnd.setDate(today.getDate() + daysUntilSunday);
    weekEnd.setHours(23, 59, 59, 999);

    let activeTaskCount = 0, ontrack = 0, overdue = 0, thisWeek = 0;
    const upcomingDeadlines = [];

    list.forEach(prod => {
      const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
      tasks.forEach(task => {
        if (task.status === 'complete' || task.taskStatus === 'complete') return;
        activeTaskCount++;
        const eff = resolveTaskStatus(task);
        if (task.deadline && (eff === 'on-track' || eff === 'due-soon')) ontrack++;
        if (eff === 'overdue' || eff === 'delayed') overdue++;
        if (!task.deadline) return;
        const due = new Date(task.deadline); due.setHours(0,0,0,0);
        if (due >= today && due <= weekEnd) {
          thisWeek++;
          upcomingDeadlines.push({
            product:   prod.name,
            productId: prod.id,
            pillar:    task.title || task.name,
            pillarId:  task.id,
            date:      task.deadline,
            status:    eff,
          });
        }
      });
    });

    document.getElementById('stat-active').textContent  = list.length;
    
    const slipped = list.filter(p => p.baselineLaunchDate && p.baselineLaunchDate !== p.launchDate && new Date(p.launchDate) > new Date(p.baselineLaunchDate));
    const slipEl  = document.getElementById('stat-slip');
    if (slipEl) {
      if (slipped.length > 0) {
        const avgSlip = Math.round(slipped.reduce((sum, p) => {
          const bl  = new Date(p.baselineLaunchDate); bl.setHours(0,0,0,0);
          const cur = new Date(p.launchDate);         cur.setHours(0,0,0,0);
          return sum + Math.round((cur - bl) / 86400000);
        }, 0) / slipped.length);
        slipEl.innerHTML = `${slipped.length} slipped &middot; avg ${avgSlip}d`;
      } else {
        slipEl.innerHTML = '';
      }
    }

    document.getElementById('stat-ontrack').textContent = ontrack || '0';
    const onTrackPctEl = document.getElementById('stat-ontrack-pct');
    if (onTrackPctEl) {
      const pct = activeTaskCount > 0 ? Math.round((ontrack / activeTaskCount) * 100) : 0;
      onTrackPctEl.innerHTML = '&uarr; ' + pct + '%';
    }
    
    const hintEl = document.getElementById('stat-ontrack-hint');
    if (hintEl) hintEl.textContent = activeTaskCount > 0 ? `${ontrack} of ${activeTaskCount} active tasks` : 'See the tasks';
    document.getElementById('stat-overdue').textContent = overdue || '0';
    document.getElementById('stat-week').textContent    = thisWeek || '0';

    const recentEl = document.getElementById('dash-recent');
    if (list.length === 0) {
      recentEl.innerHTML = '<div class="empty-state"><p>Nothing here yet.</p></div>';
    } else {
      const sorted = list.sort((a,b) => b.createdAt - a.createdAt).slice(0, 4);
      recentEl.innerHTML = sorted.map((p, index) => {
        const tasks    = getProductTasks(p).filter(t => canViewTask(t, p));
        const total    = tasks.length || 1;
        const done     = tasks.filter(t => t.status === 'complete').length;
        const overdueT = tasks.filter(t => resolveTaskStatus(t) === 'overdue' || resolveTaskStatus(t) === 'delayed').length;
        const pct      = Math.round((done / total) * 100);
        
        const defaultImages = [
          'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=150&h=150&fit=crop',
          'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=150&h=150&fit=crop',
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=150&h=150&fit=crop',
          'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=150&h=150&fit=crop'
        ];
        const thumbUrl = p.imageUrl || defaultImages[index % 4];

        const isOverdue = overdueT > 0;
        const statusHtml = isOverdue 
            ? `<span class="finesse-pill finesse-pill-red"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${overdueT}d overdue</span>`
            : `<span class="finesse-pill finesse-pill-green"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> On track</span>`;
            
        const dateHtml = p.launchDate ? `<div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formatDate(p.launchDate)}</div>` : '';
        const subtitle = p.itemType === 'project' ? 'Internal Project' : 'Lakowe Crossings &middot; Real Estate Development';

        return `
        <div style="display:flex; align-items:center; padding:12px 16px; border-bottom:1px solid var(--border); cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='#FAFAF9'" onmouseout="this.style.background='transparent'" onclick="openProjectDashboard('${p.id}')">
          <div class="pcf-thumb-wrap" style="margin-right:14px;">
            <img src="${thumbUrl}" data-product-thumb="${p.id}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--border);display:block;" />
            <div class="pcf-thumb-edit" onclick="event.stopPropagation(); changeProjectPicture('${p.id}', '${(p.name||'').replace(/'/g, "\\'")}')" title="Change picture">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <div class="pcf-thumb-badge" onclick="event.stopPropagation(); changeProjectPicture('${p.id}', '${(p.name||'').replace(/'/g, "\\'")}')" title="Change picture">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="3.2"/></svg>
            </div>
          </div>
          <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div style="font-size:12.5px;font-weight:700;color:#1A1A1A;">${p.name}</div>
              <div>${dateHtml}</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size:11px;color:var(--text-muted);">${subtitle}</div>
              <div>${statusHtml}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; padding-right:8px;">
              <div style="flex:1; height:5px; background:#F3F4F6; border-radius:3px; overflow:hidden;">
                <div style="height:5px; width:${pct}%; background:${isOverdue ? 'var(--red)' : 'var(--green)'}; border-radius:3px;"></div>
              </div>
              <span style="font-size:10px; color:var(--text-muted); font-weight:600;">${pct}%</span>
            </div>
          </div>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--border-mid)" stroke-width="2" style="flex-shrink:0;margin-left:14px;"><path d="M9 18l6-6-6-6"/></svg>
        </div>`;
      }).join('');
    }

    const dlEl = document.getElementById('dash-deadlines');
    if (upcomingDeadlines.length === 0) {
      dlEl.innerHTML = '<div class="empty-state-sm"><p>No deadlines this week.</p></div>';
    } else {
      upcomingDeadlines.sort((a,b) => new Date(a.date) - new Date(b.date));
      const dlColors = { overdue: 'var(--red)', delayed: 'var(--red)', 'due-soon': 'var(--amber)', warning: 'var(--amber)', 'on-track': 'var(--amber)', ontrack: 'var(--amber)' };
      dlEl.innerHTML = upcomingDeadlines.slice(0,12).map(d => {
        const dotColor = dlColors[d.status] || 'var(--amber)';
        const due = new Date(d.date); due.setHours(0,0,0,0);
        const daysUntil = Math.round((due - today) / 86400000);
        const dateLabel = daysUntil < 0 ? Math.abs(daysUntil) + 'd ago'
                        : daysUntil === 0 ? 'Today'
                        : daysUntil === 1 ? 'Tomorrow'
                        : formatDate(d.date);
        
        const dateColor = daysUntil < 0 ? 'var(--red)' : 'var(--amber)';
        
        return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='#FAFAF9'" onmouseout="this.style.background='transparent'" onclick="viewProduct('${d.productId}', '${d.pillarId}')">
            <div style="width:7px;height:7px;border-radius:50%;background:${dotColor};margin-top:5px;flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:#1A1A1A;margin-bottom:2px;">${d.pillar}</div>
                <div style="font-size:11px;color:var(--text-muted);">${d.product}</div>
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
                <div style="font-size:10px;font-weight:700;color:${dateColor};">${dateLabel}</div>
                <button class="remind-btn" onclick="event.stopPropagation(); showReminderModal('${d.productId}','${d.pillarId}','${(d.pillar||'').replace(/'/g, "\\'")}','${(d.product||'').replace(/'/g, "\\'")}','${d.date}')" title="Send reminder">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg> Remind
                </button>
            </div>
        </div>`;
      }).join('');
    }

    if (typeof renderDashboardCharts === 'function') {
      renderDashboardCharts(list);
    }
  } catch(e) {
    console.warn('Dashboard UI update failed:', e);
  }
}

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_dashRefreshTimer(v) { _dashRefreshTimer = v; }

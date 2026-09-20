/* views/products.js — Products & Projects list, cards, filters, archive. */

import { db, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentRole, currentUser } from '../core/state.js';
import { accessBadge, canEdit, canUserSeeProduct, canViewBudget, canViewTask, getProductAccess } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { computeProjectPrediction, formatDate, resolveTaskStatus } from '../data/status.js';
import { loadDashboardStats } from './dashboard.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { startCountdown } from '../ui/shell.js';

export function renderProducts(el) {
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title" id="pv-title">Products &amp; Projects</h1>
        <p class="view-subtitle" id="pv-subtitle">Everything you track — active, completed, and archived</p>
      </div>
      <button class="btn-primary" onclick="showCreateProduct()">+ New</button>
    </div>
    <div class="pv-filter-row">
      <button class="pv-filter active" data-type="all"     onclick="setProductFilter('all',this)">All <span id="pvc-all" class="pv-count"></span></button>
      <button class="pv-filter"        data-type="product" onclick="setProductFilter('product',this)">Products <span id="pvc-product" class="pv-count"></span></button>
      <button class="pv-filter"        data-type="project" onclick="setProductFilter('project',this)">Projects <span id="pvc-project" class="pv-count"></span></button>
      <button class="pv-filter"        data-type="archived" onclick="setProductFilter('archived',this)">Archived <span id="pvc-archived" class="pv-count"></span></button>
    </div>
    <div id="product-list-area"><div class="loading-row" style="padding:24px;">Loading...</div></div>
    <div id="create-product-modal" class="modal-overlay" style="display:none;">
      <div class="modal-box">
        <div class="modal-header">
          <span class="modal-title" id="modal-title-text">New Product Launch</span>
          <button class="modal-close" onclick="closeProductModal()">✕</button>
        </div>
        <div class="modal-body" id="modal-body-content"></div>
      </div>
    </div>`;
  loadProductList();
}

let _productFilter = 'all';   // 'all' | 'product' | 'project'

window.setProductFilter = (type, btn) => {
  _productFilter = type;
  document.querySelectorAll('.pv-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const t = document.getElementById('pv-title');
  const sub = document.getElementById('pv-subtitle');
  if (t) t.textContent = type === 'project' ? 'Projects' : type === 'product' ? 'Products' : type === 'archived' ? 'Archived Items' : 'Products & Projects';
  if (sub) sub.textContent = type === 'project' ? 'Internal projects and workstreams' 
    : type === 'product' ? 'Active product launches' 
    : type === 'archived' ? 'Historical items hidden from active tracking'
    : 'Everything you track';
  loadProductList();
};

export async function loadProductList(skipFetch = false) {
  const area = document.getElementById('product-list-area');
  if (!area) return;
  try {
    // Rely on the Global State Store unless forced to fetch
    if (!skipFetch || Object.keys(productListCache).length === 0) {
      await getProductsFresh();
    }
    
    const products = productListCache;
    const userKey  = sanitiseEmail(currentUser.email);
    
    const visible  = Object.values(products)
      .filter(p => {
        if (_productFilter === 'archived' && p.status !== 'archived') return false;
        if (_productFilter !== 'archived' && p.status === 'archived') return false;
        return canUserSeeProduct(p, userKey);
      })
      .sort((a,b) => b.createdAt - a.createdAt);

    const nProduct = visible.filter(p => (p.itemType || 'product') === 'product').length;
    const nProject = visible.filter(p => (p.itemType || 'product') === 'project').length;
    const setCount = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
    setCount('pvc-all', visible.length); setCount('pvc-product', nProduct); setCount('pvc-project', nProject);
    setCount('pvc-archived', Object.values(products).filter(p => p.status === 'archived' && canUserSeeProduct(p, userKey)).length);

    const list = _productFilter === 'all' ? visible : visible.filter(p => (p.itemType || 'product') === _productFilter);

    if (list.length === 0) {
      const noun = _productFilter === 'project' ? 'projects' : _productFilter === 'product' ? 'products' : 'products or projects';
      area.innerHTML = '<div class="panel"><div class="empty-state"><span class="empty-icon" style="color:var(--text-muted);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span><h3>No ' + noun + ' yet</h3>' +
        (visible.length > 0 && _productFilter !== 'all' ? '<p>You have ' + visible.length + ' item' + (visible.length !== 1 ? 's' : '') + ' under a different type. Switch the filter above to see them.</p>' : '<p>Create your first one to get started.</p>') +
        `<button class="btn-primary" onclick="showCreateProduct()">+ New</button></div></div>`;
      return;
    }

    area.innerHTML = '<div class="product-grid">' + list.map(p => renderProductCard(p)).join('') + '</div>';
  } catch(e) {
    area.innerHTML = '<div class="panel"><div class="empty-state-sm"><p>Failed to load products.</p></div></div>';
  }
}

function renderProductCard(p) {
  const allTasks   = getProductTasks(p).filter(t => canViewTask(t, p));
  const total      = allTasks.length || 1;
  const complete   = allTasks.filter(t => resolveTaskStatus(t) === 'complete').length;
  
  // UNIFIED DELAYED STAT: Captures both overdue dates and explicit dropdown delays
  const delayed    = allTasks.filter(t => {
    const eff = resolveTaskStatus(t);
    return eff === 'overdue' || eff === 'delayed';
  }).length;
  
  // Clean math: Everything not complete and not delayed is On Track
  const onTrack    = Math.max(0, total - complete - delayed);
  const pct        = Math.round((complete / total) * 100);
  
  const itemType   = p.itemType || 'product';
  const typeBadge  = itemType === 'project'
    ? '<span style="font-size:10px;font-weight:700;color:#2563EB;background:#EFF6FF;padding:2px 8px;border-radius:10px;letter-spacing:.03em;">PROJECT</span>'
    : '<span style="font-size:10px;font-weight:700;color:#C0282D;background:#FEF2F2;padding:2px 8px;border-radius:10px;letter-spacing:.03em;">PRODUCT</span>';
  const statusCls  = p.status || 'active';
  const statusLbl  = p.status === 'complete' ? 'Complete' : 'Active';
  
  const editBtn = canEdit(p)
    ? `<button class="btn-secondary-sm" onclick="editProduct('${p.id}')">Edit dates</button>`
    : '';

  // Slip calculation
  const slipHtml = (() => {
    if (!p.baselineLaunchDate || p.baselineLaunchDate === p.launchDate) return '';
    const bl  = new Date(p.baselineLaunchDate); bl.setHours(0,0,0,0);
    const cur = new Date(p.launchDate);         cur.setHours(0,0,0,0);
    const slip = Math.round((cur - bl) / 86400000);
    return slip > 0
      ? `<span class="pcf-slip red">+${slip}d</span>`
      : `<span class="pcf-slip green">${Math.abs(slip)}d early</span>`;
  })();

  const today2 = new Date(); today2.setHours(0,0,0,0);
  const launch = p.launchDate ? new Date(p.launchDate) : null;
  if (launch) launch.setHours(0,0,0,0);
  const daysToLaunch = launch ? Math.round((launch - today2) / 86400000) : null;

  // At-risk: 2+ delayed tasks AND launch within 21 days
  const atRisk = daysToLaunch !== null && daysToLaunch >= 0 && daysToLaunch <= 21
    && delayed >= 2;

  const launchBadge = daysToLaunch === null ? `<span class="pcf-launch-badge pcf-launch-grey">${formatDate(p.launchDate)}</span>`
    : daysToLaunch < 0   ? `<span class="pcf-launch-badge pcf-launch-red">${Math.abs(daysToLaunch)}d overdue</span>`
    : daysToLaunch === 0 ? `<span class="pcf-launch-badge pcf-launch-red">Due today</span>`
    : daysToLaunch <= 14 ? `<span class="pcf-launch-badge pcf-launch-amber">${daysToLaunch}d left</span>`
    : `<span class="pcf-launch-badge pcf-launch-grey">${formatDate(p.launchDate)}</span>`;

  const atRiskBadge = atRisk
    ? '<span style="font-size:10px;font-weight:700;color:#D97706;background:#FFFBEB;border:1px solid #FDE68A;padding:2px 8px;border-radius:10px;letter-spacing:.03em;">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        'At risk' +
      '</span>'
    : '';

  // Smart Forecast Chip
  const forecast = computeProjectPrediction(p);
  const forecastBadge = forecast.delayDays > 0 && p.status !== 'complete'
    ? `<span style="font-size:10px;font-weight:600;color:#92400E;background:#FEF3C7;padding:2px 8px;border-radius:10px;letter-spacing:.02em;margin-left:4px;" title="AI Forecast: ${forecast.probability}% risk of delay">
        Predicted: ${formatDate(forecast.predictedDate)}
       </span>`
    : '';

  const countdownId = 'cd-' + p.id;
  let countdownChip = '';
  // Removed the daysToLaunch <= 3 restriction. Now applies to all active future projects.
  if (daysToLaunch !== null && daysToLaunch >= 0 && p.status !== 'complete') {
    // Dynamic styling: Red if urgent (<= 3 days), calm gray otherwise
    const isUrgent = daysToLaunch <= 3;
    const cdColor = isUrgent ? '#C0282D' : '#6B7280';
    const cdBg = isUrgent ? '#FEF2F2' : '#F3F4F6';
    
    countdownChip = `<span id="${countdownId}" style="font-size:10px;font-weight:700;color:${cdColor};background:${cdBg};padding:2px 8px;border-radius:10px;letter-spacing:.02em;margin-left:4px;"></span>`;
    setTimeout(() => startCountdown(countdownId, p.launchDate), 100);
  }

  const healthCls = delayed > 0 ? 'pcf-health-red'
                  : pct === 100 ? 'pcf-health-done'
                  : 'pcf-health-green';
  const healthTip = delayed > 0 ? `${delayed} delayed`
                  : pct === 100 ? 'Complete' : 'On track';

  // Health pill (On track / Delayed / Complete) — mirrors the dot colour
  const healthBadge = delayed > 0
    ? '<span class="pcf-pill pcf-pill-red">Delayed</span>'
    : pct === 100
      ? '<span class="pcf-pill pcf-pill-blue">Complete</span>'
      : '<span class="pcf-pill pcf-pill-green">On track</span>';

  // Delivery-window tag computed from the launch date (e.g. "Q4 2026")
  const periodBadge = (() => {
    if (!p.launchDate) return '';
    const d = new Date(p.launchDate);
    if (isNaN(d)) return '';
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `<span class="pcf-pill pcf-pill-grey">Q${q} ${d.getFullYear()}</span>`;
  })();

  return `
    <div class="product-card-full">
      <div class="pcf-header">
        <div class="pcf-header-left">
          <div class="pcf-health-dot ${healthCls}" title="${healthTip}"></div>
          <div>
            <div class="pcf-name-row"><span class="pcf-name" style="cursor:pointer;" title="Open dashboard" onclick="openProjectDashboard('${p.id}')">${p.name}</span>${typeBadge}${healthBadge}${periodBadge}${accessBadge(p)}${slipHtml}${atRiskBadge}${forecastBadge}${countdownChip}</div>
            ${(p.itemType === 'project' && canViewBudget(p) && (p.budget || p.spend)) ? `
              <div style="margin-top:6px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:3px;">
                  <span>Budget ₦${Number(p.budget || 0).toLocaleString()}</span>
                  <span style="color:${Number(p.spend || 0) > Number(p.budget || 0) ? 'var(--red)' : 'var(--text-muted)'};">Spent ₦${Number(p.spend || 0).toLocaleString()}</span>
                </div>
                ${Number(p.budget) > 0 ? `<div style="height:3px;background:#F0F0EE;border-radius:2px;overflow:hidden;">
                  <div style="height:3px;width:${Math.min(100, (Number(p.spend || 0) / Number(p.budget)) * 100)}%;background:${Number(p.spend || 0) > Number(p.budget) ? 'var(--red)' : 'var(--blue)'};border-radius:2px;"></div>
                </div>` : ''}
              </div>` : ''}
            ${p.description ? `<div class="pcf-desc">${p.description.length > 110 ? p.description.slice(0,110)+'…' : p.description}</div>` : ''}
          </div>
        </div>
        <div class="pcf-header-right">
          ${launchBadge}
          <span class="status-chip status-${statusCls}">${statusLbl}</span>
        </div>
      </div>

      <div class="pcf-progress-row">
        <div class="pcf-progress-bar">
          <div class="pcf-progress-fill ${delayed > 0 ? 'pcf-fill-red' : 'pcf-fill-green'}" style="width:${pct}%"></div>
        </div>
        <span class="pcf-pct">${pct}%</span>
      </div>

      <div class="pcf-stats">
        <div class="pcf-stat-box">
          <div class="pcf-stat-icon grey"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>
          <div><div class="pcf-stat-box-val">${allTasks.length}</div><div class="pcf-stat-box-lbl">Total Tasks</div></div>
        </div>
        <div class="pcf-stat-box">
          <div class="pcf-stat-icon green"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></div>
          <div><div class="pcf-stat-box-val">${onTrack}</div><div class="pcf-stat-box-lbl">On Track</div></div>
        </div>
        ${delayed > 0 ? `
        <div class="pcf-stat-box">
          <div class="pcf-stat-icon red"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <div><div class="pcf-stat-box-val">${delayed}</div><div class="pcf-stat-box-lbl">Overdue</div></div>
        </div>` : ''}
        <span class="pcf-owner-chip">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          ${p.ownerName?.split(' ')[0] || '—'}
        </span>
        ${p.alertsEnabled === false ? '<span class="pcf-badge-grey" title="Alerts off">' + ICON.bell_off + '</span>' : ''}
        ${p.gmailThreadId ? '<span class="pcf-badge-grey" title="Thread active">' + ICON.thread + '</span>' : ''}
      </div>

     <div class="pcf-actions">
        <button class="btn-primary-sm" onclick="openProjectDashboard('${p.id}')">${ICON.bolt} Dashboard</button>
        <button class="btn-secondary-sm" onclick="viewProduct('${p.id}')">Tasks</button>
        ${canEdit(p) && !p.onboardedAt ? `<button class="btn-secondary-sm" style="color:var(--amber);border-color:var(--amber);" onclick="reOnboardProduct('${p.id}')">${ICON.warn} Onboard</button>` : ''}
        ${canEdit(p) ? `<button class="btn-secondary-sm" onclick="convertItemType('${p.id}','${p.itemType||'product'}')" style="font-size:10px;" title="Switch between Product and Project"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>${(p.itemType||'product')==='project'?'To Product':'To Project'}</button>` : ''}
        ${canEdit(p) ? `<button class="btn-secondary-sm" onclick="showShareModal('${p.id}')">Share</button>` : ''}
        ${getProductAccess(p) === 'owner' || currentRole === 'admin' ? `<button class="btn-secondary-sm" onclick="showHandoverModal('${p.id}')">Handover</button>` : ''}
        <button class="btn-secondary-sm" onclick="showProductActivity('${p.id}')">Activity</button>
        ${canEdit(p) ? (p.status === 'archived' 
          ? `<button class="btn-secondary-sm" style="color:var(--green);border-color:var(--green);" onclick="unarchiveProduct('${p.id}')">Restore</button>`
          : `<button class="btn-secondary-sm" style="color:var(--amber);border-color:var(--amber);" onclick="archiveProduct('${p.id}')">Archive</button>`)
          : ''}
      </div>
    </div>`;
}

/* ══ ARCHIVE & SUPER ADMIN TOTAL WIPE ════════════════════════ */
window.archiveProduct = async (productId) => {
  if (!confirm('Archive this item?\n\nIt will be hidden from your active dashboard and trackers, but you can always view or restore it from the "Archived" tab.')) return;
  
  try {
    await set(ref(db, 'products/' + productId + '/status'), 'archived');
    showToast('Item archived', 'success');
    closeProductModal();
    loadProductList();
    if (typeof loadDashboardStats === 'function') loadDashboardStats();
  } catch (e) {
    showToast('Failed to archive: ' + e.message, 'error');
  }
};
window.unarchiveProduct = async (productId) => {
  if (!confirm('Restore this item?\n\nIt will move back to your active dashboard and tracking views.')) return;
  
  try {
    await set(ref(db, 'products/' + productId + '/status'), 'active');
    showToast('Item restored to active', 'success');
    loadProductList();
    if (typeof loadDashboardStats === 'function') loadDashboardStats();
  } catch (e) {
    showToast('Failed to restore: ' + e.message, 'error');
  }
};

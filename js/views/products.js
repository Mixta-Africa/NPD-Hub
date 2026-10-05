/* views/products.js — Products & Projects list, cards, filters, archive.
   Adds: pin-to-top, manual up/down reordering, and a grid/list view toggle. */

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

let _productFilter = 'all';   // 'all' | 'product' | 'project' | 'archived'
let _viewMode = (() => { try { return localStorage.getItem('pv-view-mode') || 'grid'; } catch (e) { return 'grid'; } })(); // 'grid' | 'list'
let _lastRenderedList = [];   // the exact array of products currently on screen, in display order — used by pin/reorder

/* Self-contained styling for the new controls, injected once so this feature needs no other file touched. */
function ensureProductViewStyles() {
  if (document.getElementById('pv-extra-style')) return;
  const style = document.createElement('style');
  style.id = 'pv-extra-style';
  style.textContent = `
    .pv-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:4px;}
    .pv-view-toggle{display:inline-flex;border:1px solid var(--border,#E5E5E3);border-radius:8px;overflow:hidden;flex:0 0 auto;}
    .pv-view-btn{background:#fff;border:none;padding:6px 10px;cursor:pointer;color:var(--text-muted,#6B7280);display:flex;align-items:center;}
    .pv-view-btn+.pv-view-btn{border-left:1px solid var(--border,#E5E5E3);}
    .pv-view-btn.active{background:var(--bg-subtle,#F3F4F6);color:var(--text,#1A1A1A);}
    .pv-view-btn svg{display:block;}
    .pcf-order-controls{display:flex;flex-direction:column;gap:2px;margin-right:8px;flex:0 0 auto;}
    .pcf-order-btn{width:22px;height:22px;border:1px solid var(--border,#E5E5E3);background:#fff;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;line-height:1;color:var(--text-muted,#6B7280);padding:0;}
    .pcf-order-btn:hover:not(:disabled){background:#F3F4F6;color:var(--text,#1A1A1A);}
    .pcf-order-btn:disabled{opacity:.35;cursor:default;}
    .pcf-order-btn.active{color:#92400E;border-color:#FDE68A;background:#FFFBEB;}
    .product-list-view{display:flex;flex-direction:column;gap:8px;}
    .product-list-view .product-card-full{padding:10px 14px;}
    .product-list-view .pcf-header{flex-wrap:nowrap;align-items:center;gap:10px;}
    .product-list-view .pcf-header-left{flex-direction:row;align-items:center;gap:10px;flex:1 1 auto;min-width:0;}
    .product-list-view .pcf-desc{display:none;}
    .product-list-view .pcf-progress-row{max-width:160px;margin:0 12px;flex:0 0 auto;}
    .product-list-view .pcf-stats{flex-wrap:nowrap;gap:12px;}
    .product-list-view .pcf-stat-box-lbl{display:none;}
    .product-list-view .pcf-actions{flex-wrap:nowrap;}
    @media (max-width:700px){
      .product-list-view .pcf-header{flex-wrap:wrap;}
      .product-list-view .pcf-progress-row{max-width:none;width:100%;margin:8px 0 0;}
      .pv-toolbar{gap:8px;}
    }

    /* ── Grid view: compact, minimalist tiles — a few true columns, not one stretched card ── */
    .product-grid{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(270px,1fr)) !important;gap:16px;align-items:start;}
    .product-grid-card{position:relative;background:#fff;border:1px solid var(--border,#E5E5E3);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;transition:box-shadow .15s ease,transform .15s ease;}
    .product-grid-card:hover{box-shadow:0 8px 22px rgba(0,0,0,.06);transform:translateY(-1px);border-color:var(--border-mid,#D8D8D5);}
    .pgc-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
    .pgc-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
    .pgc-dot.pcf-health-red{background:#C0282D;}
    .pgc-dot.pcf-health-green{background:#16A34A;}
    .pgc-dot.pcf-health-done{background:#2563EB;}
    .pgc-type-tag{font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--text-muted,#6B7280);}
    .pgc-pin-tag{font-size:9px;font-weight:700;color:#92400E;}
    .pgc-order{display:flex;gap:2px;margin-left:auto;}
    .pgc-name{font-size:14px;font-weight:600;color:var(--text,#1A1A1A);cursor:pointer;line-height:1.35;overflow-wrap:anywhere;}
    .pgc-name:hover{color:#C0282D;}
    .pgc-sub{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted,#6B7280);}
    .pgc-progress{display:flex;align-items:center;gap:8px;}
    .pgc-progress-bar{flex:1;height:4px;background:#F0F0EE;border-radius:2px;overflow:hidden;}
    .pgc-progress-fill{height:4px;border-radius:2px;}
    .pgc-pct{flex:0 0 auto;font-size:11px;font-weight:600;color:var(--text-muted,#6B7280);}
    .pgc-meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;}
    .pgc-chip{font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap;}
    .pgc-chip-red{color:#C0282D;background:#FEF2F2;}
    .pgc-chip-green{color:#16A34A;background:#F0FDF4;}
    .pgc-chip-grey{color:var(--text-muted,#6B7280);background:#F3F4F6;}
    .pgc-actions{display:flex;align-items:center;gap:6px;margin-top:2px;}
    .pgc-actions .btn-primary-sm,.pgc-actions .btn-secondary-sm{flex:1 1 auto;justify-content:center;}
    .pgc-more-btn{flex:0 0 auto;width:30px;height:30px;border:1px solid var(--border,#E5E5E3);background:#fff;border-radius:7px;cursor:pointer;color:var(--text-muted,#6B7280);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;padding:0;}
    .pgc-more-btn:hover{background:#F3F4F6;color:var(--text,#1A1A1A);}
    .pgc-menu{display:none;flex-direction:column;gap:2px;position:absolute;right:16px;top:44px;min-width:160px;background:#fff;border:1px solid var(--border,#E5E5E3);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.1);padding:6px;z-index:20;}
    .pgc-menu.open{display:flex;}
    .pgc-menu button{background:none;border:none;text-align:left;padding:7px 10px;font-size:12px;border-radius:6px;cursor:pointer;color:var(--text,#1A1A1A);}
    .pgc-menu button:hover{background:#F3F4F6;}
    @media (max-width:480px){ .product-grid{grid-template-columns:1fr !important;} }
  `;
  document.head.appendChild(style);
}

/* Close any open grid-card "more" menu when clicking elsewhere on the page (bound once). */
if (!window.__pgcMenuCloseBound) {
  window.__pgcMenuCloseBound = true;
  document.addEventListener('click', () => {
    document.querySelectorAll('.pgc-menu.open').forEach(m => m.classList.remove('open'));
  });
}

window.toggleGridCardMenu = (menuId, ev) => {
  if (ev) ev.stopPropagation();
  document.querySelectorAll('.pgc-menu.open').forEach(m => { if (m.id !== menuId) m.classList.remove('open'); });
  const menu = document.getElementById(menuId);
  if (menu) menu.classList.toggle('open');
};

export function renderProducts(el) {
  ensureProductViewStyles();
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title" id="pv-title">Products &amp; Projects</h1>
        <p class="view-subtitle" id="pv-subtitle">Everything you track — active, completed, and archived</p>
      </div>
      <button class="btn-primary" onclick="showCreateProduct()">+ New</button>
    </div>
    <div class="pv-toolbar">
      <div class="pv-filter-row">
        <button class="pv-filter active" data-type="all"     onclick="setProductFilter('all',this)">All <span id="pvc-all" class="pv-count"></span></button>
        <button class="pv-filter"        data-type="product" onclick="setProductFilter('product',this)">Products <span id="pvc-product" class="pv-count"></span></button>
        <button class="pv-filter"        data-type="project" onclick="setProductFilter('project',this)">Projects <span id="pvc-project" class="pv-count"></span></button>
        <button class="pv-filter"        data-type="archived" onclick="setProductFilter('archived',this)">Archived <span id="pvc-archived" class="pv-count"></span></button>
      </div>
      <div class="pv-view-toggle" role="group" aria-label="View mode">
        <button class="pv-view-btn ${_viewMode === 'grid' ? 'active' : ''}" data-mode="grid" onclick="setProductViewMode('grid')" title="Grid view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button class="pv-view-btn ${_viewMode === 'list' ? 'active' : ''}" data-mode="list" onclick="setProductViewMode('list')" title="List view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
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

window.setProductViewMode = (mode) => {
  _viewMode = mode;
  try { localStorage.setItem('pv-view-mode', mode); } catch (e) { /* ignore */ }
  document.querySelectorAll('.pv-view-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  loadProductList(true);
};

/* Pinned items always sort first; within a group, an explicit sortOrder wins,
   items that have never been manually moved fall back to newest-first. */
function compareManual(a, b) {
  const ao = a.sortOrder, bo = b.sortOrder;
  if (ao != null && bo != null) return ao - bo;
  if (ao != null) return -1;
  if (bo != null) return 1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

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

    const filteredByStatus = Object.values(products)
      .filter(p => {
        if (_productFilter === 'archived' && p.status !== 'archived') return false;
        if (_productFilter !== 'archived' && p.status === 'archived') return false;
        return canUserSeeProduct(p, userKey);
      });

    // Pinned items float to the top as their own group; both groups keep any manual order.
    const pinnedItems = filteredByStatus.filter(p => p.pinned).sort(compareManual);
    const normalItems = filteredByStatus.filter(p => !p.pinned).sort(compareManual);
    const visible = [...pinnedItems, ...normalItems];

    const nProduct = visible.filter(p => (p.itemType || 'product') === 'product').length;
    const nProject = visible.filter(p => (p.itemType || 'product') === 'project').length;
    const setCount = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
    setCount('pvc-all', visible.length); setCount('pvc-product', nProduct); setCount('pvc-project', nProject);
    setCount('pvc-archived', Object.values(products).filter(p => p.status === 'archived' && canUserSeeProduct(p, userKey)).length);

    const list = _productFilter === 'all' ? visible : visible.filter(p => (p.itemType || 'product') === _productFilter);
    _lastRenderedList = list;

    if (list.length === 0) {
      const noun = _productFilter === 'project' ? 'projects' : _productFilter === 'product' ? 'products' : 'products or projects';
      area.innerHTML = '<div class="panel"><div class="empty-state"><span class="empty-icon" style="color:var(--text-muted);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span><h3>No ' + noun + ' yet</h3>' +
        (visible.length > 0 && _productFilter !== 'all' ? '<p>You have ' + visible.length + ' item' + (visible.length !== 1 ? 's' : '') + ' under a different type. Switch the filter above to see them.</p>' : '<p>Create your first one to get started.</p>') +
        `<button class="btn-primary" onclick="showCreateProduct()">+ New</button></div></div>`;
      return;
    }

    const wrapClass = _viewMode === 'list' ? 'product-list-view' : 'product-grid';
    const renderFn  = _viewMode === 'list' ? renderProductCard : renderProductCardGrid;
    area.innerHTML = '<div class="' + wrapClass + '">' + list.map(p => {
      const group = list.filter(x => !!x.pinned === !!p.pinned);
      const idx = group.indexOf(p);
      return renderFn(p, { isFirst: idx === 0, isLast: idx === group.length - 1 });
    }).join('') + '</div>';
  } catch(e) {
    area.innerHTML = '<div class="panel"><div class="empty-state-sm"><p>Failed to load products.</p></div></div>';
  }
}

function renderProductCard(p, posInfo = {}) {
  const allTasks   = getProductTasks(p).filter(t => canViewTask(t, p));
  const total      = allTasks.length || 1;
  // resolveTaskStatus's blocked-by-predecessor check only runs when the product is passed in —
  // omitting it (as this used to) makes a blocked-and-overdue task miscount as plain "overdue"
  // here while the task modal (which does pass it) correctly buckets it under "Blocked".
  const complete   = allTasks.filter(t => resolveTaskStatus(t, p) === 'complete').length;

  // UNIFIED DELAYED STAT: Captures both overdue dates and explicit dropdown delays
  const delayed    = allTasks.filter(t => {
    const eff = resolveTaskStatus(t, p);
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

  const pinnedBadge = p.pinned
    ? '<span style="font-size:10px;font-weight:700;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;padding:2px 8px;border-radius:10px;letter-spacing:.03em;">📌 PINNED</span>'
    : '';

  // Pin toggle + manual up/down reorder, scoped to pin status (pinned items only reorder among themselves)
  const orderControls = `
    <div class="pcf-order-controls">
      <button class="pcf-order-btn ${p.pinned ? 'active' : ''}" title="${p.pinned ? 'Unpin' : 'Pin to top'}" onclick="event.stopPropagation(); toggleProductPin('${p.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${p.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-1.4A2 2 0 0117 14.2V9a5 5 0 00-10 0v5.2a2 2 0 01-.6 1.4L5 17z"/></svg>
      </button>
      <button class="pcf-order-btn" title="Move up" ${posInfo.isFirst ? 'disabled' : ''} onclick="event.stopPropagation(); moveProductUp('${p.id}')">▲</button>
      <button class="pcf-order-btn" title="Move down" ${posInfo.isLast ? 'disabled' : ''} onclick="event.stopPropagation(); moveProductDown('${p.id}')">▼</button>
    </div>`;

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
          ${orderControls}
          <div class="pcf-health-dot ${healthCls}" title="${healthTip}"></div>
          <div>
            <div class="pcf-name-row"><span class="pcf-name" style="cursor:pointer;" title="Open dashboard" onclick="openProjectDashboard('${p.id}')">${p.name}</span>${typeBadge}${pinnedBadge}${healthBadge}${periodBadge}${accessBadge(p)}${slipHtml}${atRiskBadge}${forecastBadge}${countdownChip}</div>
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

/* Minimalist grid-view tile: the essentials only (name, status, progress, task count,
   one key stat) with everything else — Share, Handover, Activity, Archive, Onboard,
   type conversion — tucked behind a "⋯" menu so the tile stays clean at a glance. */
function renderProductCardGrid(p, posInfo = {}) {
  const allTasks  = getProductTasks(p).filter(t => canViewTask(t, p));
  const total     = allTasks.length || 1;
  // Same fix as the list card: pass the product so the blocked-by-predecessor check actually runs.
  const complete  = allTasks.filter(t => resolveTaskStatus(t, p) === 'complete').length;
  const delayed   = allTasks.filter(t => {
    const eff = resolveTaskStatus(t, p);
    return eff === 'overdue' || eff === 'delayed';
  }).length;
  const pct       = Math.round((complete / total) * 100);
  const itemType  = p.itemType || 'product';
  const statusCls = p.status || 'active';
  const statusLbl = p.status === 'complete' ? 'Complete' : 'Active';

  const today2 = new Date(); today2.setHours(0,0,0,0);
  const launch = p.launchDate ? new Date(p.launchDate) : null;
  if (launch) launch.setHours(0,0,0,0);
  const daysToLaunch = launch ? Math.round((launch - today2) / 86400000) : null;

  const launchText = !p.launchDate ? '—'
    : daysToLaunch < 0   ? `${Math.abs(daysToLaunch)}d overdue`
    : daysToLaunch === 0 ? 'Due today'
    : `${daysToLaunch}d left`;

  const healthCls = delayed > 0 ? 'pcf-health-red' : pct === 100 ? 'pcf-health-done' : 'pcf-health-green';

  const metaChip = delayed > 0
    ? `<span class="pgc-chip pgc-chip-red">${delayed} overdue</span>`
    : pct === 100
      ? `<span class="pgc-chip pgc-chip-grey">Complete</span>`
      : `<span class="pgc-chip pgc-chip-green">On track</span>`;

  const menuId = 'pgc-menu-' + p.id;
  const moreMenu = `
    <div class="pgc-menu" id="${menuId}">
      ${canEdit(p) && !p.onboardedAt ? `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');reOnboardProduct('${p.id}')">${ICON.warn} Onboard</button>` : ''}
      ${canEdit(p) ? `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');convertItemType('${p.id}','${itemType}')">${itemType === 'project' ? 'Convert to Product' : 'Convert to Project'}</button>` : ''}
      ${canEdit(p) ? `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');showShareModal('${p.id}')">Share</button>` : ''}
      ${getProductAccess(p) === 'owner' || currentRole === 'admin' ? `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');showHandoverModal('${p.id}')">Handover</button>` : ''}
      <button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');showProductActivity('${p.id}')">Activity</button>
      ${canEdit(p) ? (p.status === 'archived'
        ? `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');unarchiveProduct('${p.id}')">Restore</button>`
        : `<button onclick="event.stopPropagation();toggleGridCardMenu('${menuId}');archiveProduct('${p.id}')">Archive</button>`)
        : ''}
    </div>`;

  return `
    <div class="product-grid-card">
      <div class="pgc-top">
        <span class="pgc-dot ${healthCls}" title="${delayed > 0 ? delayed + ' delayed' : pct === 100 ? 'Complete' : 'On track'}"></span>
        <span class="pgc-type-tag">${itemType.toUpperCase()}</span>
        ${p.pinned ? '<span class="pgc-pin-tag">📌 Pinned</span>' : ''}
        <div class="pgc-order">
          <button class="pcf-order-btn ${p.pinned ? 'active' : ''}" title="${p.pinned ? 'Unpin' : 'Pin to top'}" onclick="event.stopPropagation(); toggleProductPin('${p.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="${p.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.4-1.4A2 2 0 0117 14.2V9a5 5 0 00-10 0v5.2a2 2 0 01-.6 1.4L5 17z"/></svg>
          </button>
          <button class="pcf-order-btn" title="Move up" ${posInfo.isFirst ? 'disabled' : ''} onclick="event.stopPropagation(); moveProductUp('${p.id}')">▲</button>
          <button class="pcf-order-btn" title="Move down" ${posInfo.isLast ? 'disabled' : ''} onclick="event.stopPropagation(); moveProductDown('${p.id}')">▼</button>
        </div>
      </div>

      <div class="pgc-name" title="Open dashboard" onclick="openProjectDashboard('${p.id}')">${p.name}</div>
      <div class="pgc-sub">
        <span>${p.ownerName?.split(' ')[0] || '—'}</span>
        <span>${launchText}</span>
      </div>

      <div class="pgc-progress">
        <div class="pgc-progress-bar"><div class="pgc-progress-fill" style="width:${pct}%;background:${delayed > 0 ? '#C0282D' : '#16A34A'};"></div></div>
        <span class="pgc-pct">${pct}%</span>
      </div>

      <div class="pgc-meta-row">
        <span class="pgc-chip pgc-chip-grey">${allTasks.length} tasks</span>
        ${metaChip}
        <span class="status-chip status-${statusCls}" style="font-size:10px;">${statusLbl}</span>
      </div>

      <div class="pgc-actions">
        <button class="btn-primary-sm" onclick="openProjectDashboard('${p.id}')">${ICON.bolt} Dashboard</button>
        <button class="btn-secondary-sm" onclick="viewProduct('${p.id}')">Tasks</button>
        <button class="pgc-more-btn" title="More actions" onclick="toggleGridCardMenu('${menuId}', event)">⋯</button>
      </div>
      ${moreMenu}
    </div>`;
}

/* ══ PIN & MANUAL REORDER ═════════════════════════════════════
   pinned (bool) and sortOrder (number) live on the product record itself
   (products/{id}/pinned, products/{id}/sortOrder), so order is shared
   across whoever views the list, same as every other product field. */
window.toggleProductPin = async (id) => {
  const item = _lastRenderedList.find(p => p.id === id) || productListCache[id];
  if (!item) return;
  try {
    await set(ref(db, 'products/' + id + '/pinned'), !item.pinned);
    await loadProductList();
  } catch (e) {
    showToast('Failed to update pin: ' + e.message, 'error');
  }
};

async function moveProduct(id, dir) {
  const list = _lastRenderedList || [];
  const item = list.find(p => p.id === id);
  if (!item) return;
  // Reordering only happens within the item's own group — pinned items move among pinned items, same for the rest.
  const group = list.filter(p => !!p.pinned === !!item.pinned);
  const pos = group.findIndex(p => p.id === id);
  const newPos = pos + dir;
  if (newPos < 0 || newPos >= group.length) return;

  const reordered = group.slice();
  const [moved] = reordered.splice(pos, 1);
  reordered.splice(newPos, 0, moved);

  try {
    await Promise.all(reordered.map((p, i) => set(ref(db, 'products/' + p.id + '/sortOrder'), i)));
    await loadProductList();
  } catch (e) {
    showToast('Failed to reorder: ' + e.message, 'error');
  }
}
window.moveProductUp   = (id) => moveProduct(id, -1);
window.moveProductDown = (id) => moveProduct(id, 1);

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

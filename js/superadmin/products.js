/* superadmin/products.js — Product administration. */

import { db, ref, set } from '../core/firebase.js';
import { ICON } from '../core/icons.js';
import { getProductsFresh } from '../data/products-cache.js';
import { loadSATab } from './index.js';

/* ── TAB 4: PRODUCT AUDIT ────────────────────────────────── */
export async function renderSAProducts(el) {
  const prods = Object.values(await getProductsFresh());
  const today = new Date(); today.setHours(0,0,0,0);

  const stuckHandovers = prods.filter(p =>
    p.handover?.active && p.handover?.returnDate && new Date(p.handover.returnDate) < today
  );
  const noOwner = prods.filter(p => !p.ownerId);

  el.innerHTML = `
    <div class="two-col" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="stat-label">Total products</div>
        <div class="stat-value">${prods.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stuck handovers</div>
        <div class="stat-value ${stuckHandovers.length > 0 ? 'red' : ''}">${stuckHandovers.length}</div>
      </div>
    </div>

    ${stuckHandovers.length > 0 ? `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header"><span class="panel-title" style="color:var(--red);display:inline-flex;align-items:center;gap:6px;">${ICON.warn} Stuck handovers — return date passed</span></div>
      <div class="panel-body">
        ${stuckHandovers.map(p => `
          <div class="deadline-alert-row">
            <div class="deadline-alert-info">
              <div class="deadline-alert-pillar">${p.name}</div>
              <div class="deadline-alert-product">Reliever: ${p.handover.relieverName} · Return was: ${p.handover.returnDate}</div>
            </div>
            <button class="btn-danger-sm" onclick="saClearHandover('${p.id}')">Clear handover</button>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-header"><span class="panel-title">All products</span></div>
      <div class="panel-body">
        ${prods.map(p => `
          <div class="deadline-alert-row">
            <div class="deadline-alert-info">
              <div class="deadline-alert-pillar">${p.name}</div>
              <div class="deadline-alert-product">Owner: ${p.ownerName || 'Unassigned'} · Status: ${p.status || 'active'} · Launch: ${p.launchDate || '—'}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span class="pill ${p.status === 'active' ? 'pill-green' : 'pill-grey'}">${p.status || 'active'}</span>
              <button class="btn-danger-xs" onclick="saToggleProductStatus('${p.id}','${p.status||'active'}')">
                ${p.status === 'archived' ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

window.saToggleProductStatus = async (productId, currentStatus) => {
  const newStatus = currentStatus === 'archived' ? 'active' : 'archived';
  if (!confirm(`${newStatus === 'archived' ? 'Archive' : 'Restore'} this product?`)) return;
  try {
    await set(ref(db, `products/${productId}/status`), newStatus);
    showToast(`Product ${newStatus}.`, 'success');
    loadSATab('products');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

window.saClearHandover = async (productId) => {
  try {
    await set(ref(db, `products/${productId}/handover/active`), false);
    showToast('Handover cleared.', 'success');
    loadSATab('products');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

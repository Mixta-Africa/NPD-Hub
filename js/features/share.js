/* features/share.js — Share modal and access changes. */

import { db, ref, set } from '../core/firebase.js';
import { loadTeamMembers, TEAM_MEMBERS } from '../data/app-config.js';
import { productListCache } from '../data/products-cache.js';

/* ══ PHASE 7: SHARING ═══════════════════════════════════════ */
window.showShareModal = async (productId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  await loadTeamMembers();

  const sharedWith = prod.sharedWith || {};
  const ownerKey   = prod.ownerId;
  const memberOptions = Object.entries(TEAM_MEMBERS)
    .filter(([key]) => key !== ownerKey)
    .map(([key, m]) => {
      const current = sharedWith[key];
      return `<div class="share-member-row">
        <div class="share-member-info">
          <div class="share-member-name">${m.name}</div>
          <div class="share-member-email">${m.email}</div>
        </div>
        <select class="status-select" id="share-${key}" onchange="updateShareAccess('${productId}','${key}',this.value)">
          <option value=""      ${!current      ? 'selected':''}>No access</option>
          <option value="view"  ${current==='view'  ? 'selected':''}>View only</option>
          <option value="edit"  ${current==='edit'  ? 'selected':''}>Can edit</option>
        </select>
      </div>`;
    }).join('') || '<p class="muted" style="padding:8px 0;">No other team members found. Add them in Settings first.</p>';

  document.getElementById('modal-title-text').textContent = `Share — ${prod.name}`;
  document.getElementById('modal-body-content').innerHTML = `
    <p style="font-size:13px;color:var(--text-mid);margin-bottom:16px;line-height:1.6;">
      Grant team members access to this product. Changes take effect immediately.
    </p>
    <div class="share-member-list">${memberOptions}</div>
    <div class="form-actions"><button class="btn-outline" onclick="closeProductModal()">Done</button></div>`;
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.updateShareAccess = async (productId, memberKey, level) => {
  try {
    if (level === '') {
      await set(ref(db, `products/${productId}/sharedWith/${memberKey}`), null);
    } else {
      await set(ref(db, `products/${productId}/sharedWith/${memberKey}`), level);
    }
    if (productListCache[productId]) {
      if (!productListCache[productId].sharedWith) productListCache[productId].sharedWith = {};
      productListCache[productId].sharedWith[memberKey] = level || null;
    }
    showToast(level ? `Access updated to ${level}.` : 'Access removed.', 'success');
  } catch(e) {
    showToast('Failed to update access: ' + e.message, 'error');
  }
};

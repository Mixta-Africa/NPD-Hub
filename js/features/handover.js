/* features/handover.js — Handover package for a reliever. */

import { db, get, ref, set } from '../core/firebase.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { loadTeamMembers, TEAM_MEMBERS } from '../data/app-config.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { productListCache } from '../data/products-cache.js';
import { loadProductList } from '../views/products.js';
import { buildHandoverPrompt, openEmailComposer } from './email-composer.js';
import { logActivity } from './activity.js';

/* ══ PHASE 7: HANDOVER ══════════════════════════════════════ */
window.showHandoverModal = async (productId) => {
  await loadTeamMembers();
  const prod = productListCache[productId];
  if (!prod) return;

  const memberOptions = Object.entries(TEAM_MEMBERS)
    .filter(([key]) => key !== prod.ownerId)
    .map(([key, m]) => `<option value="${key}">${m.name} — ${m.email}</option>`)
    .join('') || '<option value="">No team members available</option>';

  const today = new Date().toISOString().split('T')[0];

  document.getElementById('modal-title-text').textContent = 'Initiate Handover';
  document.getElementById('modal-body-content').innerHTML = `
    <div class="sc-intro">
      <p>This will temporarily grant your reliever edit access to <strong>${prod.name}</strong> and send them a full briefing package.</p>
    </div>
    <div class="form-row">
      <label class="form-label">Reliever <span class="req">*</span></label>
      <select id="ho-reliever" class="select-field" style="width:100%;">${memberOptions}</select>
    </div>
    <div class="form-row">
      <label class="form-label">Return date <span class="req">*</span></label>
      <input type="date" id="ho-return" class="input-field" value="" min="${today}"/>
    </div>
    <div class="form-row">
      <label class="form-label">Handover notes</label>
      <textarea id="ho-notes" class="input-field" rows="3" placeholder="Key context, priorities, or things to watch out for..."></textarea>
    </div>
    <div class="ho-what-happens">
      <div class="ho-step"><span class="ho-step-num">1</span>Reliever gets edit access to this product immediately</div>
      <div class="ho-step"><span class="ho-step-num">2</span>Full briefing package emailed to reliever (CC: admin)</div>
      <div class="ho-step"><span class="ho-step-num">3</span>Package includes: product status, last 4 weeks of logs, all open items</div>
      <div class="ho-step"><span class="ho-step-num">4</span>Access automatically noted until your return date</div>
    </div>
    <div class="form-actions">
      <button class="btn-outline" onclick="closeProductModal()">Cancel</button>
      <button class="btn-primary" onclick="confirmHandover('${productId}')">Confirm & send package</button>
    </div>`;
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.confirmHandover = async (productId) => {
  const relieverId  = document.getElementById('ho-reliever')?.value;
  const returnDate  = document.getElementById('ho-return')?.value;
  const notes       = document.getElementById('ho-notes')?.value?.trim() || '';
  const btn         = document.querySelector('#modal-body-content .btn-primary');

  if (!relieverId) { showToast('Select a reliever.', 'error'); return; }
  if (!returnDate)  { showToast('Set a return date.', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending package...'; }

  try {
    const prod     = productListCache[productId];
    const reliever = TEAM_MEMBERS[relieverId];

    // 1. Grant edit access to reliever in Firebase
    await set(ref(db, `products/${productId}/sharedWith/${relieverId}`), 'edit');
    await set(ref(db, `products/${productId}/handover`), {
      active:      true,
      relieverId,
      relieverName: reliever?.name || relieverId,
      relieverEmail: reliever?.email || '',
      returnDate,
      initiatedAt: Date.now(),
      initiatedBy: currentUser.email,
      notes,
    });
    productListCache[productId].sharedWith = productListCache[productId].sharedWith || {};
    productListCache[productId].sharedWith[relieverId] = 'edit';

    // 2. Build handover payload — gather last 4 weeks of logs
    const logsSnap = await get(ref(db, `products/${productId}/weeklyLog`));
    const allLogs  = logsSnap.val() || {};
    const last4Weeks = Object.entries(allLogs)
      .sort(([a],[b]) => b.localeCompare(a))
      .slice(0,4)
      .map(([week, log]) => ({ week, ...log }));

    await logActivity(productId, 'handover',
      `Handover initiated to ${reliever?.name || relieverId}`,
      `Return: ${returnDate}${notes ? ' · ' + notes.slice(0,60) : ''}`
    );
    closeProductModal();
    loadProductList();

    // Open composer for handover briefing email
    const tasks = getProductTasks(prod);
    await openEmailComposer({
      type:      'handover',
      subject:   `Handover Package: ${prod.name} — covering until ${returnDate}`,
      toEmails:  [reliever?.email || ''].filter(Boolean),
      ccEmails:  prod.defaultCCs || [],
      productId,
      draftPrompt: buildHandoverPrompt(prod, tasks, reliever?.name || relieverId, returnDate, notes),
      onSend: async ({ subject, body, toEmails, ccEmails, testMode }) => {
        await callGAS('sendComposedEmail', {
          subject, body, toEmails, ccEmails, testMode,
          productName: prod.name, sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        });
        showToast('Handover email sent.', 'success');
      },
    });
  } catch(e) {
    showToast('Handover failed: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Confirm & send package'; }
};

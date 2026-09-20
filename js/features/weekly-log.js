/* features/weekly-log.js — Weekly log entries. */

import { db, get, ref, set } from '../core/firebase.js';
import { getWeekKey } from '../core/utils.js';
import { currentUser } from '../core/state.js';
import { PILLARS } from '../data/app-config.js';
import { productListCache } from '../data/products-cache.js';

/* ══ PHASE 7: WEEKLY LOG ════════════════════════════════════ */
window.showWeeklyLog = async (productId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  const weekKey  = getWeekKey();
  const logSnap  = await get(ref(db, `products/${productId}/weeklyLog/${weekKey}`));
  const log      = logSnap.val() || { summary: '', tasksCompleted: [], tasksOpen: [] };

  // Auto-populate from pillar changes this week
  const autoComplete = PILLARS
    .filter(pl => prod.pillars?.[pl.id]?.taskStatus === 'complete' && prod.pillars?.[pl.id]?.notes)
    .map(pl => `${pl.name} — completed`)
    .filter(t => !log.tasksCompleted.includes(t));
  const allCompleted = [...log.tasksCompleted, ...autoComplete];

  document.getElementById('modal-title-text').textContent = `Weekly Log — ${weekKey.replace('week_','')}`;
  document.getElementById('modal-body-content').innerHTML = `
    <p style="font-size:13px;color:var(--text-mid);margin-bottom:16px;line-height:1.6;">
      Record what was completed and what remains open this week for <strong>${prod.name}</strong>.
      This feeds into your handover package.
    </p>
    <div class="form-row">
      <label class="form-label">Summary</label>
      <textarea id="wl-summary" class="input-field" rows="2" placeholder="Brief summary of this week's activity...">${log.summary}</textarea>
    </div>
    <div class="form-row">
      <label class="form-label">Tasks completed <span class="form-hint">— one per line</span></label>
      <textarea id="wl-completed" class="input-field" rows="4" placeholder="e.g. Submitted financial model for review"></textarea>
    </div>
    <div class="form-row">
      <label class="form-label">Open items <span class="form-hint">— one per line</span></label>
      <textarea id="wl-open" class="input-field" rows="4" placeholder="e.g. Awaiting architect approval on design sketch"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn-outline" onclick="closeProductModal()">Cancel</button>
      <button class="btn-primary" onclick="saveWeeklyLog('${productId}','${weekKey}')">Save log</button>
    </div>`;

  // Set textarea values after rendering (avoids escaping issues in template literals)
  document.getElementById('create-product-modal').style.display = 'flex';
  setTimeout(() => {
    const completedEl = document.getElementById('wl-completed');
    const openEl      = document.getElementById('wl-open');
    if (completedEl) completedEl.value = allCompleted.join('\n');
    if (openEl)      openEl.value      = log.tasksOpen.join('\n');
  }, 10);
};
window.saveWeeklyLog = async (productId, weekKey) => {
  const summary   = document.getElementById('wl-summary')?.value.trim() || '';
  const completed = document.getElementById('wl-completed')?.value.split('\n').map(s=>s.trim()).filter(Boolean) || [];
  const open      = document.getElementById('wl-open')?.value.split('\n').map(s=>s.trim()).filter(Boolean) || [];
  try {
    await set(ref(db, `products/${productId}/weeklyLog/${weekKey}`), {
      summary, tasksCompleted: completed, tasksOpen: open,
      updatedAt: Date.now(), updatedBy: currentUser.email,
    });
    closeProductModal();
    showToast('Weekly log saved.', 'success');
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
};

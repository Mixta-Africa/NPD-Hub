/* superadmin/templates.js — Template administration. */

import { db, get, ref, set } from '../core/firebase.js';
import { SAVED_TEMPLATES, set_SAVED_TEMPLATES } from '../data/templates.js';
import { loadSATab } from './index.js';

/* ══ PHASE E: TEMPLATES TAB ══════════════════════════════════ */
export async function renderSATemplates(el) {
  const snap = await get(ref(db, 'templates'));
  set_SAVED_TEMPLATES( snap.val() || {});
  const entries = Object.entries(SAVED_TEMPLATES);

  if (entries.length === 0) {
    el.innerHTML = '<div class="empty-state-sm"><span class="empty-icon" style="color:var(--text-muted);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span><h3>No saved templates</h3><p>When you create a product with a custom task setup and save it as a template, it will appear here.</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Saved templates (${entries.length})</span></div>
      <div class="panel-body" style="padding:0;">
        ${entries.map(([id, t]) => `
          <div class="cb-pillar-row">
            <div class="cb-pillar-info">
              <div class="cb-pillar-name">${t.name}</div>
              <div class="cb-pillar-owner">${(t.tasks||[]).length} tasks · Created by ${t.createdBy?.split('@')[0] || '?'} · ${new Date(t.createdAt||0).toLocaleDateString('en-GB')}</div>
            </div>
            <div class="cb-pillar-actions">
              <button class="btn-secondary-sm" onclick="previewTemplate('${id}')">Preview</button>
              <button class="btn-danger-xs"    onclick="deleteTemplate('${id}')">Delete</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div id="template-preview-panel"></div>`;
}

window.previewTemplate = (id) => {
  const t  = SAVED_TEMPLATES[id];
  if (!t) return;
  const el = document.getElementById('template-preview-panel');
  if (!el) return;
  el.innerHTML = `
    <div class="panel" style="margin-top:14px;">
      <div class="panel-header"><span class="panel-title">Preview — ${t.name}</span></div>
      <div class="panel-body" style="padding:0;">
        ${(t.tasks||[]).map((task, i) => `
          <div class="pillar-date-row">
            <div class="pillar-date-num">${i+1}</div>
            <div class="pillar-date-name">${task.title}<span class="pillar-owner">${task.owner||'—'}</span></div>
          </div>`).join('')}
      </div>
    </div>`;
  el.scrollIntoView({ behavior:'smooth' });
};

window.deleteTemplate = async (id) => {
  if (!confirm('Delete this template?')) return;
  delete SAVED_TEMPLATES[id];
  try {
    await set(ref(db, 'templates/' + id), null);
    showToast('Template deleted.', 'success');
    loadSATab('templates');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

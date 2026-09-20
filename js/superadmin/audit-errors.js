/* superadmin/audit-errors.js — Audit log and error log. */

import { db, get, ref, set } from '../core/firebase.js';
import { ICON } from '../core/icons.js';
import { loadSATab } from './index.js';

/* ── TAB: AUDIT LOG ──────────────────────────────────────── */
export async function renderSAAudit(el) {
  el.innerHTML = '<div class="loading-row" style="padding:24px;">Loading audit log...</div>';
  try {
    const snap  = await get(ref(db, 'sa_log'));
    const saLog = snap.val() || {};
    const entries = Object.entries(saLog)
      .sort(([a],[b]) => b - a)
      .slice(0, 100);

    if (entries.length === 0) {
      el.innerHTML = '<div class="empty-state-sm"><p>No audit events logged yet.</p></div>';
      return;
    }

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;color:var(--text-mid);">${entries.length} events (most recent 100)</span>
        <button class="btn-danger-sm" onclick="clearAuditLog()">Clear log</button>
      </div>
      <div class="sa-error-list">
        ${entries.map(([ts, e]) => `
          <div class="sa-error-row">
            <div class="sa-error-meta">
              <span class="sa-error-time">${new Date(parseInt(ts)).toLocaleString('en-GB')}</span>
              <span class="sa-error-user" style="color:${e.action&&e.action.includes('FAIL')?'var(--red)':'var(--green)'};">
                ${e.action || 'event'}
              </span>
              <span class="sa-error-view">${e.user || ''}</span>
            </div>
            ${e.productName ? '<div class="sa-error-msg" style="color:var(--text);">'+e.productName+'</div>' : ''}
            ${e.detail ? '<div class="sa-error-stack">'+e.detail+'</div>' : ''}
          </div>`).join('')}
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="loading-row muted">Failed to load audit log.</div>';
  }
}

window.clearAuditLog = async () => {
  if (!confirm('Clear the audit log?')) return;
  await set(ref(db, 'sa_log'), null);
  showToast('Audit log cleared.', 'success');
  loadSATab('audit');
};

/* ── TAB 2: ERROR LOG ─────────────────────────────────────── */
export async function renderSAErrors(el) {
  const snap   = await get(ref(db, 'errors'));
  const errors = snap.val() || {};
  const list   = Object.entries(errors)
    .sort(([a],[b]) => b - a)
    .slice(0, 50);

  if (list.length === 0) {
    el.innerHTML = '<div class="empty-state-sm"><span class="empty-icon" style="color:var(--green);">' + ICON.check_circle + '</span><p>No errors logged yet.</p></div>';
    return;
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:13px;color:var(--text-mid);">${list.length} errors (most recent 50)</span>
      <button class="btn-danger-sm" onclick="clearErrorLog()">Clear all</button>
    </div>
    <div class="sa-error-list">
      ${list.map(([ts, e]) => `
        <div class="sa-error-row">
          <div class="sa-error-meta">
            <span class="sa-error-time">${new Date(parseInt(ts)).toLocaleString('en-GB')}</span>
            <span class="sa-error-user">${e.user || '?'}</span>
            <span class="sa-error-view">view: ${e.view || '?'}</span>
          </div>
          <div class="sa-error-msg">${e.message || 'No message'}</div>
          ${e.stack ? `<div class="sa-error-stack">${e.stack}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

window.clearErrorLog = async () => {
  if (!confirm('Clear all error logs? This cannot be undone.')) return;
  await set(ref(db, 'errors'), null);
  showToast('Error log cleared.', 'success');
  loadSATab('errors');
};

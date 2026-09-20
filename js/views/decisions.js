/* views/decisions.js — Decisions page: AI reasoning-layer suggestions to approve or dismiss. */

import { db, get, onValue, push, ref, update } from '../core/firebase.js';
import { currentRole, currentUser } from '../core/state.js';
import { formatDate } from '../data/status.js';

/* ══════════════════════════════════════════════════════════════
   DECISION ENGINE — "Decisions" pane
   ------------------------------------------------------------
   This is the human-facing half of the brain described in chat:
   a reasoning process (running elsewhere, on a schedule) writes
   candidate suggestions to /brainSuggestions. Nothing in that
   store ever executes on its own — every suggestion sits at
   status:'pending' until a person clicks Approve or Dismiss here.
   Approve replays the suggestion through the SAME functions a
   manual action would use (updatePillarStatus, the reminder
   modal, viewProduct) — there is no separate write path for the
   brain, so anything it proposes is bound by the exact same
   permission and cascade rules as a manual change.

   Suggestion shape (this is the contract the reasoning job must
   write to, once it exists):
   {
     id, createdAt, title, reasoning, urgency: 'high'|'medium'|'low',
     productId, productName, taskId, taskTitle,
     actionType: 'update_status' | 'open_reminder' | 'open_task' | 'info',
     actionPayload: { ...action-specific fields, see dispatch below },
     status: 'pending' | 'approved' | 'dismissed',
     resolvedAt, resolvedBy, dismissReason,
   }
   ══════════════════════════════════════════════════════════════ */
export function startDecisionsBadgeListener() {
  if (currentRole !== 'admin') return; // suggestions may reference task detail — admin-only surface
  onValue(ref(db, 'brainSuggestions'), (snap) => {
    const data = snap.val() || {};
    const now = Date.now();
    // "pending" only counts once it's actually meant to be seen — a suggestion
    // generated at 11pm carries visibleFrom = next working morning, so it
    // doesn't light up the badge overnight.
    const pending = Object.values(data).filter(s => s.status === 'pending' && (!s.visibleFrom || s.visibleFrom <= now)).length;
    const badge = document.getElementById('decisions-badge');
    if (badge) {
      badge.style.display = pending > 0 ? 'flex' : 'none';
      badge.textContent = pending;
    }
  });
}

export function renderDecisions(el) {
  if (currentRole !== 'admin') {
    el.innerHTML = `<div class="empty-state" style="padding:48px 24px;"><p style="font-size:13px;color:#6B7280;">This page isn't available for your role.</p></div>`;
    return;
  }
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Decisions</h1>
        <p class="view-subtitle">Things worth your attention, surfaced automatically. Nothing here happens until you approve it.</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Pending suggestions</span>
        <span id="decisions-list-count" style="font-size:11px;color:var(--text-muted);"></span>
      </div>
      <div id="decisions-list"><div class="loading-row" style="padding:32px;">Loading...</div></div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Queued for working hours</span></div>
      <div id="decisions-queued-list"><div class="loading-row" style="padding:16px;">Loading...</div></div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Recently resolved</span></div>
      <div id="decisions-resolved-list"><div class="loading-row" style="padding:16px;">Loading...</div></div>
    </div>`;
  loadDecisions();
}

const DECISION_URGENCY_PILL = {
  high:   { label: 'High',   cls: 'pcf-pill-red' },
  medium: { label: 'Medium', cls: 'pcf-pill-amber' },
  low:    { label: 'Low',    cls: 'pcf-pill-grey' },
};

async function loadDecisions() {
  const listEl = document.getElementById('decisions-list');
  const resolvedEl = document.getElementById('decisions-resolved-list');
  if (!listEl) return;
  try {
    const snap = await get(ref(db, 'brainSuggestions'));
    const all = Object.entries(snap.val() || {}).map(([id, s]) => ({ id, ...s }));

    const now = Date.now();
    const isVisible = s => !s.visibleFrom || s.visibleFrom <= now;
    const pending = all.filter(s => s.status === 'pending' && isVisible(s)).sort((a,b) => b.createdAt - a.createdAt);
    const queued  = all.filter(s => s.status === 'pending' && !isVisible(s)).sort((a,b) => a.visibleFrom - b.visibleFrom);
    const resolved = all.filter(s => s.status !== 'pending').sort((a,b) => (b.resolvedAt||0) - (a.resolvedAt||0)).slice(0, 15);

    const countEl = document.getElementById('decisions-list-count');
    if (countEl) countEl.textContent = pending.length + ' pending' + (queued.length ? ` · ${queued.length} queued for working hours` : '');

    if (pending.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:48px 24px;">
          <div style="margin-bottom:16px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg>
          </div>
          <h3 style="font-size:14px;font-weight:600;margin-bottom:6px;color:#1A1A1A;">Nothing waiting on you</h3>
          <p style="font-size:12px;color:#6B7280;">Once the reasoning job is running, anything worth flagging will show up here.</p>
        </div>`;
    } else {
      listEl.innerHTML = pending.map(s => {
        const u = DECISION_URGENCY_PILL[s.urgency] || DECISION_URGENCY_PILL.low;
        return `
        <div class="action-row-card" style="cursor:default;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
              <span class="pcf-pill ${u.cls}">${u.label}</span>
              ${s.productName ? `<span style="font-size:11px;color:var(--text-muted);">${s.productName}</span>` : ''}
            </div>
            <div style="font-size:13px;font-weight:600;color:#1A1A1A;margin-bottom:3px;">${s.title || 'Untitled suggestion'}</div>
            ${s.reasoning ? `<div style="font-size:12px;color:var(--text-mid);line-height:1.5;">${s.reasoning}</div>` : ''}
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;margin-top:2px;">
            <button class="btn-secondary-sm" onclick="dismissSuggestion('${s.id}')">Dismiss</button>
            <button class="btn-primary-sm" onclick="approveSuggestion('${s.id}')">Approve</button>
          </div>
        </div>`;
      }).join('');
    }

    const queuedEl = document.getElementById('decisions-queued-list');
    if (queuedEl) {
      queuedEl.innerHTML = queued.length === 0
        ? '<div class="loading-row muted" style="padding:16px;">Nothing queued.</div>'
        : queued.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <span style="font-size:12px;color:var(--text-mid);flex:1;min-width:0;">${s.title || 'Untitled suggestion'}</span>
            <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">visible from ${new Date(s.visibleFrom).toLocaleString('en-GB',{weekday:'short',hour:'2-digit',minute:'2-digit'})}</span>
          </div>`).join('');
    }

    if (resolvedEl) {
      resolvedEl.innerHTML = resolved.length === 0
        ? '<div class="loading-row muted" style="padding:16px;">Nothing resolved yet.</div>'
        : resolved.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);">
            <span class="pcf-pill ${s.status === 'approved' ? 'pcf-pill-green' : 'pcf-pill-grey'}">${s.status === 'approved' ? 'Approved' : 'Dismissed'}</span>
            <span style="font-size:12px;color:var(--text-mid);flex:1;min-width:0;">${s.title || 'Untitled suggestion'}</span>
            <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${s.resolvedAt ? formatDate(new Date(s.resolvedAt).toISOString()) : ''}</span>
          </div>`).join('');
    }
  } catch(e) {
    listEl.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load suggestions. Try refreshing.</div>';
    console.warn('loadDecisions error:', e);
  }
}

// Approve replays the suggestion through the app's own real functions —
// there is no separate mutation path for the brain to bypass permissions with.
window.approveSuggestion = async (id) => {
  try {
    const snap = await get(ref(db, 'brainSuggestions/' + id));
    const s = snap.val();
    if (!s) return;

    const payload = s.actionPayload || {};
    switch (s.actionType) {
      case 'update_status':
        if (s.productId && s.taskId && payload.newStatus) {
          await updatePillarStatus(s.productId, s.taskId, payload.newStatus);
        }
        break;
      case 'open_reminder':
        if (s.productId) {
          showReminderModal(s.productId, payload.pillarId || s.taskId, payload.pillarLabel || s.taskTitle || '', s.productName || '', payload.date || '');
        }
        break;
      case 'open_task':
        if (s.productId) viewProduct(s.productId, s.taskId);
        break;
      case 'info':
      default:
        break; // Nothing to execute — acknowledging is the action.
    }

    await update(ref(db, 'brainSuggestions/' + id), {
      status: 'approved', resolvedAt: Date.now(), resolvedBy: currentUser.email,
    });
    // Positive feedback signal — carries the actual content, not just an
    // opaque id, so a future cycle can recognize "this kind of flag lands."
    await push(ref(db, 'brainMemory'), {
      type: 'feedback', createdAt: Date.now(), suggestionId: id,
      productId: s.productId || null, taskId: s.taskId || null,
      note: `Approved: "${s.title || 'suggestion'}" — ${s.reasoning || ''}`.trim(),
    });
    loadDecisions();
  } catch(e) {
    showToast('Could not apply that suggestion.', 'error');
    console.warn('approveSuggestion error:', e);
  }
};

window.dismissSuggestion = async (id) => {
  try {
    const snap = await get(ref(db, 'brainSuggestions/' + id));
    const s = snap.val();

    await update(ref(db, 'brainSuggestions/' + id), {
      status: 'dismissed', resolvedAt: Date.now(), resolvedBy: currentUser.email,
    });
    // Feedback signal for the memory log — carries the actual title and
    // reasoning that was dismissed, not just an opaque id, so a future
    // cycle can actually recognize "this was already raised and dismissed"
    // instead of re-flagging the same thing every cycle.
    await push(ref(db, 'brainMemory'), {
      type: 'feedback', createdAt: Date.now(), suggestionId: id,
      productId: s?.productId || null, taskId: s?.taskId || null,
      note: `Dismissed: "${s?.title || 'suggestion'}" — ${s?.reasoning || ''}`.trim(),
    });
    loadDecisions();
  } catch(e) {
    showToast('Could not dismiss that suggestion.', 'error');
    console.warn('dismissSuggestion error:', e);
  }
};

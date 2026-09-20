/* features/export-sheet.js — Tracker export and live Google Sheet sync. */

import { db, get, ref } from '../core/firebase.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { TEAM_MEMBERS } from '../data/app-config.js';
import { canViewTask } from '../data/permissions.js';
import { ownerLabel } from './task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { formatDate, resolveTaskStatus } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { logEmailSent } from './email-log.js';

/* ══════════════════════════════════════════════════════════════
   EXPORT TRACKER
   Filters to what the REQUESTER can see before anything leaves the
   browser. GAS receives an already-safe list, so the export can never
   contain a task the person could not open in the Hub.
   ══════════════════════════════════════════════════════════════ */
window.exportProjectTracker = async (productId) => {
  const p = productListCache[productId];
  if (!p) { showToast('Item not loaded — open it first', 'error'); return; }

  const visible = getProductTasks(p).filter(t => canViewTask(t, p));
  if (visible.length === 0) {
    showToast('No tasks visible to you on this item', 'error');
    return;
  }

  const hiddenCount = getProductTasks(p).length - visible.length;
  const now = Date.now();
  const rows = visible.map(t => {
    const owners = (t.owners && t.owners.length) ? t.owners
      : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
    const status = resolveTaskStatus(t);

    // The story: most recent changelog entry, and — for completed tasks
    // specifically — how long ago that happened. A task completed 6
    // weeks ago and one completed yesterday look identical in a flat
    // "Complete" column; this is what actually separates them.
    const history = t.updates ? Object.values(t.updates).sort((a, b) => b.createdAt - a.createdAt) : [];
    const lastEntry = history[0];
    let completedAgo = '';
    let phase = 'Active';
    if (status === 'complete') {
      const completionEntry = history.find(h => h.changeType === 'approval') || lastEntry;
      const completedAt = completionEntry ? completionEntry.createdAt : (t.createdAt || now);
      const daysAgo = Math.floor((now - completedAt) / 86400000);
      completedAgo = daysAgo <= 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : daysAgo < 14 ? daysAgo + ' days ago' : Math.round(daysAgo / 7) + ' weeks ago';
      phase = daysAgo <= 14 ? 'Completed recently' : 'Completed long ago';
    } else if (status === 'deprioritized') {
      phase = 'Stepped down';
    }

    return {
      title:    t.title || 'Untitled',
      owner:    owners.length ? owners.map(o => ownerLabel(o)).join(', ') : 'Unassigned',
      dept:     owners.map(o => o.dept).filter(Boolean).join(', '),
      deadline: t.deadline ? formatDate(t.deadline) : '',
      status:   status,
      notes:    t.notes || '',
      phase:    phase,
      completedAgo: completedAgo,
      lastActivity: lastEntry ? lastEntry.text : '',
    };
  });

  // --- NEW: Gather authorized emails for Google Sheets access ---
  const authEmails = new Set();
  if (currentUser && currentUser.email) authEmails.add(currentUser.email);
  if (p.ownerId && TEAM_MEMBERS[p.ownerId]?.email) authEmails.add(TEAM_MEMBERS[p.ownerId].email);
  if (p.sharedWith) {
    Object.keys(p.sharedWith).forEach(k => {
      if (TEAM_MEMBERS[k]?.email) authEmails.add(TEAM_MEMBERS[k].email);
    });
  }

  showToast('Building tracker…', 'info');
  try {
    const res = await callGAS('exportProjectTracker', {
      productName: p.name,
      itemType:    p.itemType || 'product',
      ownerName:   p.ownerName || '',
      launchDate:  p.launchDate ? formatDate(p.launchDate) : '',
      generatedBy: currentPreferredName || currentUser.displayName || currentUser.email,
      authorizedEmails: Array.from(authEmails), // <-- Injected into backend payload
      tasks:       rows,
    });
    if (!res.ok) { showToast('Export failed: ' + (res.error || 'unknown'), 'error'); return; }
    showExportResult(p.name, res, hiddenCount);
    await logEmailSent(productId, {
      type: 'export', subject: 'Tracker exported — ' + p.name,
      to: [], cc: [], taskTitles: [rows.length + ' rows'],
    });
  } catch(e) {
    showToast('Could not reach the backend', 'error');
  }
};

function showExportResult(name, res, hiddenCount) {
  const overlay = document.createElement('div');
  overlay.id = 'export-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:14px;padding:30px;max-width:460px;width:100%;">' +
      '<div style="width:46px;height:46px;border-radius:11px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;margin-bottom:14px;">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      '</div>' +
      '<div style="font-size:16px;font-weight:700;color:#1A1A1A;margin-bottom:5px;">Tracker ready</div>' +
      '<div style="font-size:12px;color:#6B7280;line-height:1.7;margin-bottom:6px;">' +
        name + ' — ' + res.rows + ' task' + (res.rows !== 1 ? 's' : '') + ', status colour-coded.' +
      '</div>' +
      (hiddenCount > 0
        ? '<div style="font-size:11px;color:#D97706;background:#FFFBEB;border:1px solid #FDE68A;border-radius:7px;padding:8px 11px;margin-bottom:14px;line-height:1.6;">' +
            hiddenCount + ' private task' + (hiddenCount !== 1 ? 's were' : ' was') + ' excluded — you can only export what you can see.' +
          '</div>'
        : '<div style="height:8px;"></div>') +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<a href="' + res.url + '" target="_blank" class="btn-primary" style="text-align:center;text-decoration:none;padding:11px;">Open in Google Sheets</a>' +
        '<a href="' + res.xlsxUrl + '" class="btn-outline" style="text-align:center;text-decoration:none;padding:11px;font-size:12px;">Download as Excel</a>' +
        '<a href="' + res.pdfUrl + '" target="_blank" class="btn-outline" style="text-align:center;text-decoration:none;padding:11px;font-size:12px;">Download as PDF</a>' +
        '<button class="btn-outline" style="padding:11px;font-size:12px;" onclick="copyExportLink(\'' + res.url + '\')">Copy link to share</button>' +
      '</div>' +
      '<button class="btn-link-sm" style="margin-top:14px;width:100%;text-align:center;" onclick="document.getElementById(\'export-overlay\').remove()">Close</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

window.copyExportLink = (url) => {
  navigator.clipboard.writeText(url).then(() => showToast('Link copied', 'success'));
};

/* ══════════════════════════════════════════════════════════════
   LIVE PROJECT SHEET
   Push the item's syncable tasks to its Google Sheet. Private tasks
   are excluded server-side too, so this is belt and braces.
   ══════════════════════════════════════════════════════════════ */
export async function pushSheetIfLinked(productId) {
  try {
    const snap = await get(ref(db, 'config/projectSheets/' + productId));
    if (!snap.exists()) return;          // no sheet yet — nothing to keep in step
    
    const p = productListCache[productId];
    if (!p) return;

    const authEmails = new Set();
    if (currentUser && currentUser.email) authEmails.add(currentUser.email);
    if (p.ownerId && TEAM_MEMBERS[p.ownerId]?.email) authEmails.add(TEAM_MEMBERS[p.ownerId].email);
    if (p.sharedWith) {
      Object.keys(p.sharedWith).forEach(k => {
        if (TEAM_MEMBERS[k]?.email) authEmails.add(TEAM_MEMBERS[k].email);
      });
    }

    await callGAS('syncProjectToSheet', { 
      productId,
      authorizedEmails: Array.from(authEmails) 
    });
  } catch(e) { console.warn('background sheet push skipped:', e); }
}

window.syncProjectSheet = async (productId) => {
  const p = productListCache[productId];
  if (!p) return;
  
  showToast('Syncing to Google Sheets…', 'info');

  const authEmails = new Set();
  if (currentUser && currentUser.email) authEmails.add(currentUser.email);
  if (p.ownerId && TEAM_MEMBERS[p.ownerId]?.email) authEmails.add(TEAM_MEMBERS[p.ownerId].email);
  if (p.sharedWith) {
    Object.keys(p.sharedWith).forEach(k => {
      if (TEAM_MEMBERS[k]?.email) authEmails.add(TEAM_MEMBERS[k].email);
    });
  }

  try {
    const res = await callGAS('syncProjectToSheet', { 
      productId,
      authorizedEmails: Array.from(authEmails)
    });
    if (!res.ok) { showToast('Sync failed: ' + (res.error || 'unknown'), 'error'); return; }
    showSheetSyncResult(p ? p.name : 'Item', res);
  } catch(e) {
    showToast('Could not reach the backend', 'error');
  }
};

function showSheetSyncResult(name, res) {
  const overlay = document.createElement('div');
  overlay.id = 'sheetsync-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:14px;padding:30px;max-width:470px;width:100%;">' +
      '<div style="width:46px;height:46px;border-radius:11px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;margin-bottom:14px;">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-6.22-8.56"/><polyline points="21 3 21 9 15 9"/></svg>' +
      '</div>' +
      '<div style="font-size:16px;font-weight:700;color:#1A1A1A;margin-bottom:5px;">Live sheet updated</div>' +
      '<div style="font-size:12px;color:#6B7280;line-height:1.7;margin-bottom:10px;">' +
        name + ' — ' + res.synced + ' task' + (res.synced !== 1 ? 's' : '') + ' in the sheet.' +
      '</div>' +
      (res.skippedPrivate > 0
        ? '<div style="font-size:11px;color:#D97706;background:#FFFBEB;border:1px solid #FDE68A;border-radius:7px;padding:8px 11px;margin-bottom:12px;line-height:1.6;">' +
            res.skippedPrivate + ' private task' + (res.skippedPrivate !== 1 ? 's were' : ' was') +
            ' kept out of the sheet. Private tasks never leave the Hub.' +
          '</div>'
        : '') +
      '<div style="font-size:11px;color:#6B7280;background:#F8F8F7;border-radius:7px;padding:9px 11px;margin-bottom:14px;line-height:1.6;">' +
        'Edit <strong>Task</strong>, <strong>Deadline</strong>, <strong>Status</strong> or <strong>Notes</strong> in the sheet and it flows back within 10 minutes. ' +
        'Owner and Department stay managed here.' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<a href="' + res.url + '" target="_blank" class="btn-primary" style="text-align:center;text-decoration:none;padding:11px;">Open the live sheet</a>' +
        '<button class="btn-outline" style="padding:11px;font-size:12px;" onclick="copyExportLink(\'' + res.url + '\')">Copy link</button>' +
      '</div>' +
      '<button class="btn-link-sm" style="margin-top:14px;width:100%;text-align:center;" onclick="document.getElementById(\'sheetsync-overlay\').remove()">Close</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

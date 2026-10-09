/* features/comments-feed.js — Recent Comments pane: a cross-project (or
   single-project) feed of task "update"/note entries, so a comment doesn't
   require someone to click into a specific task to be noticed. Reuses the
   exact same data the email alert (sendTaskNoteAlert) and the task's own
   "Full history" panel already read — task.updates[*] where
   changeType === 'note' — so there is no second comment system to keep in
   sync, just another view onto the one that exists. */

import { getProductTasks } from '../data/product-model.js';
import { canViewTask } from '../data/permissions.js';
import { productListCache } from '../data/products-cache.js';

const COMMENT_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (d < 7)  return d + 'd ago';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* Pulls every visible task "note" out of the already-live productListCache —
   no extra Firebase read. canViewTask is the same gate task-detail.js and
   present-mode.js use, so this can never surface a note from a task the
   viewer isn't allowed to see, scoped or not. */
function collectRecentNotes(opts) {
  const { productId, limit = 6 } = opts || {};
  const notes = [];
  const prods = productId
    ? [productListCache[productId]].filter(Boolean)
    : Object.values(productListCache || {}).filter(p => p && p.status !== 'archived');

  prods.forEach(prod => {
    getProductTasks(prod).forEach(task => {
      if (!task.updates) return;
      if (!canViewTask(task, prod)) return;
      Object.values(task.updates).forEach(u => {
        if (!u || u.changeType !== 'note') return;
        notes.push({
          productId: prod.id,
          productName: prod.name || '',
          taskId: task.id,
          taskTitle: task.title || task.name || 'Untitled task',
          text: u.text || '',
          userName: u.userName || (u.userEmail || '').split('@')[0] || 'Someone',
          createdAt: u.createdAt || 0,
        });
      });
    });
  });

  notes.sort((a, b) => b.createdAt - a.createdAt);
  return notes.slice(0, limit);
}

export function buildCommentsFeedItemsHtml(opts) {
  const notes = collectRecentNotes(opts);
  const showProject = !(opts && opts.productId);

  if (notes.length === 0) {
    return '<div style="text-align:center;padding:28px 16px;font-size:12px;color:var(--text-muted);">' +
      'No comments yet. Updates posted on tasks will show up here as soon as someone adds one.</div>';
  }

  return notes.map(n => {
    const initials = (n.userName || '?')[0].toUpperCase();
    const full = escapeHtml(n.text);
    const snippet = full.length > 160 ? full.slice(0, 160) + '…' : full;
    return '<div class="action-row-card" style="cursor:pointer;align-items:flex-start;" ' +
        'onclick="showTaskDetailPanel(\'' + n.productId + '\',\'' + n.taskId + '\')" title="Open this task">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:#EFF6FF;color:#2563EB;font-size:11px;font-weight:700;' +
        'display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:10px;">' + initials + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-bottom:2px;">' +
          '<span style="font-size:12px;font-weight:600;color:#1A1A1A;">' + escapeHtml(n.userName) + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted);">on ' + escapeHtml(n.taskTitle) +
            (showProject ? ' &middot; ' + escapeHtml(n.productName) : '') + '</span>' +
          '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;white-space:nowrap;">' + timeAgo(n.createdAt) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-mid);line-height:1.5;word-break:break-word;">' + snippet + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* Full panel, ready to drop into a view's template string — same .panel /
   .panel-header classes every other dashboard panel uses, so it doesn't
   look like a bolted-on extra. */
export function buildCommentsPanelHtml(opts) {
  const o = opts || {};
  const title = o.title || 'Recent Comments';
  const sub = o.subtitle || '';
  const idAttr = o.containerId ? ' id="' + o.containerId + '"' : '';
  return '<div class="panel" style="margin-bottom:16px;">' +
    '<div class="panel-header">' +
      '<span class="panel-title" style="display:flex;align-items:center;gap:6px;">' + COMMENT_ICON + title + '</span>' +
      (sub ? '<span style="font-size:11px;color:var(--text-muted);">' + sub + '</span>' : '') +
    '</div>' +
    '<div' + idAttr + ' style="max-height:340px;overflow-y:auto;">' + buildCommentsFeedItemsHtml(o) + '</div>' +
  '</div>';
}

/* Targeted re-render for live refresh (e.g. when the dashboard's product
   cache ticks) — swaps just the item list, not the whole panel. */
export function refreshCommentsFeed(containerId, opts) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = buildCommentsFeedItemsHtml(opts);
}

/* features/comments.js — Product comments and assignee history. */

import { db, get, ref, set } from '../core/firebase.js';
import { currentUser } from '../core/state.js';
import { canEdit } from '../data/permissions.js';
import { productListCache } from '../data/products-cache.js';

/* ══ COMMENTS TAB ══════════════════════════════════════════ */
export function buildCommentsTab(p) {
  return '<div id="comments-list" style="min-height:80px;padding:4px 0 12px;">' +
      '<div class="loading-row" style="padding:16px 0;font-size:12px;">Loading comments...</div>' +
    '</div>' +
    '<div style="border-top:1px solid #F0F0EE;padding-top:14px;">' +
      '<textarea id="comment-input" placeholder="Add a comment — context, decisions, blockers..." ' +
        'style="width:100%;border:1px solid #E5E5E3;border-radius:8px;padding:10px 12px;font-size:12px;font-family:Poppins,sans-serif;resize:none;outline:none;color:#1A1A1A;line-height:1.6;" rows="3"></textarea>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:8px;">' +
        '<button onclick="postProductComment(\'' + p.id + '\')" ' +
          'style="background:#C0282D;color:#fff;border:none;border-radius:7px;padding:8px 18px;font-size:12px;font-weight:600;font-family:Poppins,sans-serif;cursor:pointer;">Post</button>' +
      '</div>' +
    '</div>';
}

export async function loadAssigneeHistory(productId) {
  const body = document.getElementById('product-detail-body');
  if (!body) return;
  try {
    const snap  = await get(ref(db, 'products/' + productId + '/tasks'));
    if (!snap.exists()) { body.innerHTML = '<div style="padding:24px;font-size:13px;color:#6B7280;">No tasks found.</div>'; return; }
    const tasks = Object.values(snap.val());
    let html = '<div style="padding:4px 0 12px;">';
    let hasHistory = false;
    tasks.forEach(task => {
      const hist = task.assigneeHistory ? Object.values(task.assigneeHistory).sort((a,b) => a.at - b.at) : [];
      if (!hist.length) return;
      hasHistory = true;
      html += '<div style="margin-bottom:16px;">' +
        '<div style="font-size:12px;font-weight:700;color:#1A1A1A;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #F0F0EE;">' + (task.title || 'Untitled task') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;">' +
        hist.map(h => {
          const date = new Date(h.at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
          return '<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #F8F8F7;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:#F0FDF4;color:#16A34A;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
              (h.to || h.from || '?')[0].toUpperCase() +
            '</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:12px;font-weight:600;color:#1A1A1A;">' +
                '<span style="color:#C0282D;">' + (h.from || 'Unassigned') + '</span>' +
                ' → <span style="color:#16A34A;">' + (h.to || '?') + '</span>' +
                (h.dept ? ' <span style="font-size:10px;color:#9CA3AF;">(' + h.dept + ')</span>' : '') +
              '</div>' +
              (h.reason ? '<div style="font-size:11px;color:#6B7280;margin-top:1px;">' + h.reason + '</div>' : '') +
              '<div style="font-size:10px;color:#9CA3AF;margin-top:2px;">By ' + (h.by || 'Unknown') + ' · ' + date + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div></div>';
    });
    if (!hasHistory) html += '<div style="text-align:center;padding:32px;font-size:13px;color:#9CA3AF;">No reassignment history yet.</div>';
    html += '</div>';
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = '<div style="padding:24px;font-size:13px;color:#9CA3AF;">Could not load assignee history.</div>';
  }
}

export async function loadProductComments(productId) {
  const el = document.getElementById('comments-list');
  if (!el) return;
  const prod = productListCache[productId];
  // Defense in depth — the tab button itself is already hidden from
  // anyone who isn't the owner/admin/shared-editor, but this is the real
  // gate: comments can name a specific person's situation (the exact leak
  // that was reported), so seeing the product at all is never enough.
  if (!prod || !canEdit(prod)) {
    el.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:12px;color:#9CA3AF;">Comments are only visible to the owner and admins.</div>';
    return;
  }
  try {
    const snap = await get(ref(db, 'productComments/' + productId));
    if (!snap.exists()) {
      el.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:12px;color:#9CA3AF;">No comments yet. Be the first to add context.</div>';
      return;
    }
    const comments = Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt);
    el.innerHTML = comments.map(c => {
      const isSystem = c.type === 'time_extension' || c.userEmail === 'system@mixtafrica.com';
      const initials = isSystem ? '!' : (c.userName || c.userEmail || '?')[0].toUpperCase();
      const name     = c.userName || c.userEmail.split('@')[0];
      const time     = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #F3F3F2;">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:' + (isSystem ? '#FFFBEB' : '#FEF2F2') +
          ';color:' + (isSystem ? '#D97706' : '#C0282D') +
          ';font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + initials + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:3px;">' +
            '<span style="font-size:12px;font-weight:600;color:#1A1A1A;">' + name + '</span>' +
            '<span style="font-size:10px;color:#9CA3AF;">' + time + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#374151;line-height:1.6;word-break:break-word;white-space:pre-wrap;">' +
            String(c.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:12px 0;">Could not load comments.</div>';
  }
}

window.postProductComment = async (productId) => {
  const prod = productListCache[productId];
  if (!prod || !canEdit(prod)) { showToast('Only the owner or an admin can post here.', 'error'); return; }
  const input = document.getElementById('comment-input');
  if (!input) return;
  const text = (input.value || '').trim();
  if (!text) { showToast('Comment cannot be empty', 'error'); return; }

  const commentId = 'c_' + Date.now();
  const comment   = {
    id:        commentId,
    text,
    userEmail: currentUser.email,
    userName:  currentUser.displayName || currentUser.email.split('@')[0],
    createdAt: Date.now(),
  };
  try {
    await set(ref(db, 'productComments/' + productId + '/' + commentId), comment);
    input.value = '';
    loadProductComments(productId);
  } catch(e) {
    showToast('Could not post comment', 'error');
  }
};

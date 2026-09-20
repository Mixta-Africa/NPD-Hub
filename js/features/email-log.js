/* features/email-log.js — Email visibility log: every send recorded and browsable. */

import { db, get, onValue, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser, isSuperAdmin } from '../core/state.js';
import { registerListener } from '../core/listeners.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';

window._emailLogCurrentPage = 1;
const ITEMS_PER_PAGE = 3;

export function loadDashboardEmailLog() {
  const el = document.getElementById('dash-emaillog');
  if (!el) return;
  
  try {
    const unsub = onValue(ref(db, 'emailLog'), async (logSnap) => {
      if (!logSnap.exists()) {
        el.innerHTML = '<div style="padding:16px 18px;font-size:12px;color:#9CA3AF;">No emails sent yet.</div>';
        return;
      }
      
      // Ensure product cache is ready so we can map product names
      await getProductsFresh();
      
      const products = productListCache;
      const userKey  = sanitiseEmail(currentUser.email);
      const all = [];
      
      Object.entries(logSnap.val()).forEach(([pid, entries]) => {
        const prod = products[pid];
        if (!prod) return;
        if (!canUserSeeProduct(prod, userKey)) return;
        const isOwnerOrAdmin = currentRole === 'admin' || isSuperAdmin || prod.ownerId === userKey;
        // Seeing the product at all is not the same as seeing every email
        // logged for it — a task-scoped email needs real access to THAT task.
        Object.values(entries).forEach(e => {
          if (e.taskId) {
            const task = (prod.tasks && prod.tasks[e.taskId]) || (prod.pillars && prod.pillars[e.taskId]);
            if (!task || !canViewTask(task, prod)) return;
          } else if (!isOwnerOrAdmin) {
            return;
          }
          all.push(Object.assign({ productName: prod.name }, e));
        });
      });
      
      if (all.length === 0) {
        el.innerHTML = '<div style="padding:16px 18px;font-size:12px;color:#9CA3AF;">No emails sent yet.</div>';
        return;
      }
      
      all.sort((a, b) => b.sentAt - a.sentAt);
      window._dashEmailLogs = all; 
      window._emailLogCurrentPage = 1;
      
      if (typeof window.renderDashboardEmailPage === 'function') {
        window.renderDashboardEmailPage(1);
      }
    });
    
    registerListener('dashboard_emaillog', unsub);
  } catch(e) {
    el.innerHTML = '<div style="padding:16px 18px;font-size:12px;color:#9CA3AF;">Could not load the email log.</div>';
  }
}
window.renderDashboardEmailPage = (page) => {
  const el = document.getElementById('dash-emaillog');
  if (!el || !window._dashEmailLogs) return;
  
  const all = window._dashEmailLogs;
  const totalPages = Math.ceil(all.length / ITEMS_PER_PAGE);
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  window._emailLogCurrentPage = page;
  
  const startIdx = (page - 1) * ITEMS_PER_PAGE;
  const currentItems = all.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  
  const typeLabel = { deadline_alert:'Deadline alert', reminder:'Reminder', onboarding:'Onboarding', report:'Progress report', handover:'Handover', delayed:'Delay notice', composed:'Email' };
  
  let html = '<div style="display:flex; flex-direction:column;">';
  html += '<div>';
  html += currentItems.map(l => {
    const auto = l.trigger === 'automated';
    const clr  = auto ? '#2563EB' : '#16A34A';
    const when = new Date(l.sentAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const to = (l.to || []).join(', ');
    
    return '<div style="display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background=\'#FAFAF9\'" onmouseout="this.style.background=\'none\'" onclick="showEmailPreview(\'' + l.id + '\')">' +
      '<div style="width:6px;height:6px;border-radius:50%;background:' + clr + ';flex-shrink:0;margin-top:4px;"></div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:11.5px;font-weight:600;color:var(--text);">' +
          (typeLabel[l.type] || 'Email') +
          ' <span style="font-weight:400;color:#9CA3AF;">· ' + (l.productName || '') + '</span></div>' +
        (to ? '<div style="font-size:10px;color:#6B7280;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">To: ' + to + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0;">' +
        '<div style="font-size:9px;font-weight:600;color:' + clr + ';">' + (auto ? 'AUTO' : 'MANUAL') + '</div>' +
        '<div style="font-size:9px;color:#9CA3AF;">' + when + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  html += '</div>';
  
  // Pagination controls at the bottom (kept for the full Reports view; rarely shown on the compact dashboard widget now that ITEMS_PER_PAGE=3)
  if (totalPages > 1) {
    html += '<div style="display:flex;align-items:center;justify-content:center;gap:4px;padding:12px 18px;border-top:1px solid var(--border);background:#FAFAF9;">';
    
    // Previous buttons
    html += `<button onclick="renderDashboardEmailPage(1)" style="padding:4px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-size:11px;" ${page === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>&laquo;</button>`;
    html += `<button onclick="renderDashboardEmailPage(${page - 1})" style="padding:4px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-size:11px;" ${page === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>&lsaquo;</button>`;
    
    // Page window (show current, -2, and +2)
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(totalPages, page + 2);
    if (startPage > 1) html += '<span style="font-size:11px;color:var(--text-muted);padding:0 4px;">...</span>';
    
    for (let i = startPage; i <= endPage; i++) {
      if (i === page) {
        html += `<button style="padding:4px 10px;border:1px solid var(--red);background:var(--red);color:#fff;border-radius:4px;font-size:11px;font-weight:600;">${i}</button>`;
      } else {
        html += `<button onclick="renderDashboardEmailPage(${i})" style="padding:4px 10px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-size:11px;transition:background 0.15s;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'#fff\'">${i}</button>`;
      }
    }
    
    if (endPage < totalPages) html += '<span style="font-size:11px;color:var(--text-muted);padding:0 4px;">...</span>';
    
    // Next buttons
    html += `<button onclick="renderDashboardEmailPage(${page + 1})" style="padding:4px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-size:11px;" ${page === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>&rsaquo;</button>`;
    html += `<button onclick="renderDashboardEmailPage(${totalPages})" style="padding:4px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-size:11px;" ${page === totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>&raquo;</button>`;
    
    html += '</div>';
  }
  
  html += '</div>';
  el.innerHTML = html;
};

/* ══ EMAIL VISIBILITY LOG ══════════════════════════════════
   Every send is recorded so the owner can see what left the system
   without being CC'd on everything. GAS logs automated sends; this
   logs user-initiated ones. ══════════════════════════════════════ */
export async function logEmailSent(productId, record) {
  if (!productId) return;
  try {
    const id = 'em_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    await set(ref(db, 'emailLog/' + productId + '/' + id), Object.assign({
      id, sentAt: Date.now(),
      sentBy: currentPreferredName || currentUser.displayName || currentUser.email,
      sentByEmail: currentUser.email,
      trigger: 'manual',
    }, record));
  } catch(e) { console.warn('logEmailSent failed', e); }
}

export function buildCommsTab(p) {
  return '<div id="comms-list" style="min-height:80px;padding:4px 0;">' +
      '<div class="loading-row" style="padding:16px 0;font-size:12px;">Loading sent emails...</div>' +
    '</div>';
}

export async function loadEmailLog(productId) {
  const el = document.getElementById('comms-list');
  if (!el) return;
  try {
    const snap = await get(ref(db, 'emailLog/' + productId));
    if (!snap.exists()) {
      el.innerHTML = '<div style="text-align:center;padding:28px 0;font-size:12px;color:#9CA3AF;">No emails sent for this item yet.</div>';
      return;
    }
    const prod = productListCache[productId];
    const userKey = sanitiseEmail(currentUser.email);
    const isOwnerOrAdmin = currentRole === 'admin' || isSuperAdmin || (prod && prod.ownerId === userKey);

    // Same rule as the dashboard feed: seeing this product's Comms tab at all
    // doesn't mean seeing every email about every task in it. A task-scoped
    // email only shows if you can genuinely view that task; a whole-product
    // email (report, onboarding, handover) is owner/admin only.
    const logs = Object.values(snap.val()).filter(l => {
      if (!prod) return isOwnerOrAdmin;
      if (l.taskId) {
        const task = (prod.tasks && prod.tasks[l.taskId]) || (prod.pillars && prod.pillars[l.taskId]);
        return task ? canViewTask(task, prod) : isOwnerOrAdmin;
      }
      return isOwnerOrAdmin;
    }).sort((a,b) => b.sentAt - a.sentAt);

    if (logs.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:28px 0;font-size:12px;color:#9CA3AF;">No emails you have access to for this item yet.</div>';
      return;
    }
    window._productEmailLogs = logs; // Store globally for the preview modal
    
    const typeLabel = { deadline_alert:'Deadline alert', reminder:'Reminder', onboarding:'Onboarding',
                        report:'Progress report', handover:'Handover', delayed:'Delay notice', composed:'Email' };
                        
    // FIX: Add scrollable container
    let html = '<div style="max-height: 400px; overflow-y: auto; padding-right: 8px;">';
    
    html += logs.map(l => {
      const auto = l.trigger === 'automated';
      const clr  = auto ? '#2563EB' : '#16A34A';
      const when = new Date(l.sentAt).toLocaleDateString('en-GB',
        { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const to = (l.to || []).join(', ');
      
      return '<div style="display:flex;gap:10px;padding:10px 8px;border-bottom:1px solid #F3F3F2;cursor:pointer;transition:background 0.15s;border-radius:6px;" onmouseover="this.style.background=\'#FAFAF9\'" onmouseout="this.style.background=\'transparent\'" onclick="showEmailPreview(\'' + l.id + '\')">' +
        '<div style="width:7px;height:7px;border-radius:50%;background:' + clr + ';flex-shrink:0;margin-top:6px;"></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">' +
            '<span style="font-size:12px;font-weight:600;color:var(--text);">' +
              (typeLabel[l.type] || l.type || 'Email') + '</span>' +
            '<span style="font-size:10px;font-weight:600;color:' + clr + ';background:' + clr + '15;padding:1px 6px;border-radius:8px;">' +
              (auto ? 'AUTOMATED' : 'MANUAL') + '</span>' +
            '<span style="font-size:10px;color:#9CA3AF;">' + when + '</span>' +
          '</div>' +
          (l.subject ? '<div style="font-size:11px;color:var(--text);margin-top:2px;">' + l.subject + '</div>' : '') +
          (to ? '<div style="font-size:11px;color:#6B7280;margin-top:1px;">To: ' + to + '</div>' : '') +
          ((l.cc && l.cc.length) ? '<div style="font-size:10px;color:#9CA3AF;">CC: ' + l.cc.join(', ') + '</div>' : '') +
          '<div style="font-size:10px;color:#9CA3AF;margin-top:2px;">Sent by ' + (l.sentBy || 'Unknown') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:12px 0;">Could not load the email log.</div>';
  }
}

/* ══ EMAIL PREVIEW MODAL ═════════════════════════════════════ */
window.showEmailPreview = (logId) => {
  // Find log in either dashboard cache or product-level cache
  let log = (window._dashEmailLogs || []).find(l => l.id === logId);
  if (!log && window._productEmailLogs) {
    log = window._productEmailLogs.find(l => l.id === logId);
  }
  if (!log) return;

  const when = new Date(log.sentAt).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const typeLabel = { deadline_alert:'Deadline alert', reminder:'Reminder', onboarding:'Onboarding', report:'Progress report', handover:'Handover', delayed:'Delay notice', composed:'Email' };
  
  let modal = document.getElementById('email-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'email-preview-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    document.body.appendChild(modal);
  }

  // Fallback for older logs that didn't save the HTML body
  const bodyContent = log.body 
    ? log.body.replace(/\n/g, '<br/>') 
    : '<div style="color:var(--text-muted);font-style:italic;padding:20px;background:#F8F8F7;border-radius:8px;text-align:center;">This email was logged before full body capture was enabled. Only the delivery metadata above is available.</div>';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:100%;max-width:600px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#FAFAF9;border-radius:12px 12px 0 0;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:var(--text);">Email Receipt</div>
        <button onclick="document.getElementById('email-preview-modal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted);line-height:1;">&times;</button>
      </div>
      <div style="padding:20px;overflow-y:auto;flex:1;">
        <div style="margin-bottom:20px;font-size:12px;background:#FAFAF9;border:1px solid var(--border);border-radius:8px;padding:14px;">
          <div style="display:flex;margin-bottom:6px;"><strong style="width:70px;color:var(--text-muted);">Date:</strong> <span>${when}</span></div>
          <div style="display:flex;margin-bottom:6px;"><strong style="width:70px;color:var(--text-muted);">From:</strong> <span>${log.sentBy || 'System'}</span></div>
          <div style="display:flex;margin-bottom:6px;"><strong style="width:70px;color:var(--text-muted);">To:</strong> <span>${(log.to || []).join(', ') || 'None'}</span></div>
          ${log.cc && log.cc.length ? `<div style="display:flex;margin-bottom:6px;"><strong style="width:70px;color:var(--text-muted);">CC:</strong> <span>${log.cc.join(', ')}</span></div>` : ''}
          <div style="display:flex;margin-bottom:6px;"><strong style="width:70px;color:var(--text-muted);">Subject:</strong> <span style="font-weight:600;">${log.subject || 'No subject'}</span></div>
          <div style="display:flex;"><strong style="width:70px;color:var(--text-muted);">Type:</strong> <span><span style="text-transform:uppercase;font-size:9px;font-weight:700;background:#E5E5E3;padding:2px 6px;border-radius:4px;">${typeLabel[log.type] || log.type}</span></span></div>
        </div>
        <div style="font-size:13px;line-height:1.6;color:var(--text);">
          ${bodyContent}
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
};

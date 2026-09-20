/* views/ask.js — Ask: question answering over the tasks and projects the user is allowed to see. */

import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser, currentUserDept } from '../core/state.js';
import { FEATURES } from '../data/app-config.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { resolveTaskStatus } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';
import { askAI } from '../features/ai.js';

let _askSelected = [];
let _askHistory  = [];

export function renderAsk(el) {
  el.innerHTML =
    '<div class="view-header">' +
      '<div>' +
        '<h1 class="view-title">Ask</h1>' +
        '<p class="view-subtitle">Ask questions about your products, projects and tasks</p>' +
      '</div>' +
    '</div>' +
    '<div class="panel" style="margin-bottom:14px;">' +
      '<div class="panel-header">' +
        '<span class="panel-title">Scope</span>' +
        '<span id="ask-scope-note" style="font-size:11px;color:var(--text-muted);"></span>' +
      '</div>' +
      '<div class="panel-body" id="ask-scope"><div class="loading-row" style="font-size:12px;">Loading...</div></div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-header"><span class="panel-title">Conversation</span>' +
        '<button class="btn-link-sm" onclick="clearAskHistory()">Clear</button></div>' +
      '<div id="ask-thread" style="padding:16px 18px;min-height:120px;max-height:420px;overflow-y:auto;">' +
        '<div style="font-size:12px;color:#9CA3AF;text-align:center;padding:24px 0;">' +
          'Everything you have access to is selected by default — narrow it down above if you want, then ask a question.' +
        '</div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--border);padding:12px 18px;display:flex;gap:8px;align-items:flex-end;">' +
        '<textarea id="ask-input" rows="2" placeholder="e.g. What is overdue across these, and who owns it?" ' +
          'style="flex:1;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12px;' +
          'font-family:Poppins,sans-serif;resize:none;outline:none;color:var(--text);line-height:1.6;" ' +
          'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();submitAsk();}"></textarea>' +
        '<button class="btn-primary" id="ask-send" style="font-size:12px;padding:10px 18px;" onclick="submitAsk()">Ask</button>' +
      '</div>' +
    '</div>';
  loadAskScope();
}

async function loadAskScope() {
  const el = document.getElementById('ask-scope');
  if (!el) return;
  try {
    const all  = Object.values(await getProductsFresh()).filter(p => p.status !== 'archived');
    const userKey = sanitiseEmail(currentUser.email);
    const visible = all.filter(p => canUserSeeProduct(p, userKey));
    window._askVisible = visible;

    // Default to everything selected on first load — requiring an opt-in
    // click before Ask does anything was a silent trap: wrong scope reads
    // as "the button doesn't work," since nothing visible happens beyond
    // an easy-to-miss toast. Only auto-select once; a user's own choice to
    // narrow it down should stick for the rest of the session.
    if (!window._askScopeInitialized) {
      _askSelected = visible.map(p => p.id);
      window._askScopeInitialized = true;
    }

    const note = document.getElementById('ask-scope-note');
    if (note) {
      note.textContent = currentRole === 'admin'
        ? 'Admin — all ' + visible.length + ' items'
        : visible.length + ' of ' + all.length + ' items visible to you' +
          (currentUserDept ? ' (' + currentUserDept + ')' : '');
    }
    if (visible.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;">You do not have access to any products or projects yet.</div>';
      return;
    }
    el.innerHTML =
      '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
        '<button class="btn-outline" style="font-size:11px;padding:4px 10px;" onclick="askSelectAll(true)">Select all</button>' +
        '<button class="btn-outline" style="font-size:11px;padding:4px 10px;" onclick="askSelectAll(false)">Clear</button>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
        visible.map(p => {
          const on = _askSelected.includes(p.id);
          const type = (p.itemType || 'product') === 'project' ? 'PROJECT' : 'PRODUCT';
          const clr  = type === 'PROJECT' ? '#2563EB' : '#C0282D';
          return '<button id="askchip-' + p.id + '" onclick="toggleAskItem(\'' + p.id + '\')" ' +
            'style="border:1px solid ' + (on ? clr : 'var(--border)') + ';background:' + (on ? clr + '12' : '#fff') +
            ';color:' + (on ? clr : 'var(--text)') + ';border-radius:20px;padding:5px 12px;font-size:11px;' +
            'font-weight:500;cursor:pointer;font-family:Poppins,sans-serif;">' +
            '<span style="font-size:9px;font-weight:700;opacity:.7;">' + type + '</span> ' + p.name +
          '</button>';
        }).join('') +
      '</div>';
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;">Could not load your items.</div>';
  }
}

window.toggleAskItem = (id) => {
  const i = _askSelected.indexOf(id);
  if (i > -1) _askSelected.splice(i, 1); else _askSelected.push(id);
  loadAskScope();
};

window.askSelectAll = (on) => {
  _askSelected = on ? (window._askVisible || []).map(p => p.id) : [];
  loadAskScope();
};

window.clearAskHistory = () => {
  _askHistory = [];
  const t = document.getElementById('ask-thread');
  if (t) t.innerHTML = '<div style="font-size:12px;color:#9CA3AF;text-align:center;padding:24px 0;">Conversation cleared.</div>';
};

/* Build the context. Only selected AND visible items are included —
   the visibility filter is re-applied here so a stale selection can
   never leak an item the user has lost access to. */
function buildAskContext() {
  const userKey = sanitiseEmail(currentUser.email);
  const chosen  = (window._askVisible || [])
    .filter(p => _askSelected.includes(p.id) && canUserSeeProduct(p, userKey));
  const today = new Date(); today.setHours(0,0,0,0);

  return chosen.map(p => {
    const tasks = getProductTasks(p).filter(t => canViewTask(t, p));
    const lines = tasks.map(t => {
      const eff = resolveTaskStatus(t);
      const owners = (t.owners && t.owners.length) ? t.owners
        : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
      const who = owners.length ? owners.map(o => ownerLabel(o) + (o.dept ? ' [' + o.dept + ']' : '')).join(' + ') : 'Unassigned';
      let due = 'no deadline';
      if (t.deadline) {
        const d = new Date(t.deadline); d.setHours(0,0,0,0);
        const diff = Math.round((d - today) / 86400000);
        due = t.deadline + (diff < 0 ? ' (' + Math.abs(diff) + 'd overdue)' : diff === 0 ? ' (due today)' : ' (in ' + diff + 'd)');
      }
      return '  - "' + (t.title || 'Untitled') + '" | status: ' + eff + ' | owner: ' + who + ' | due: ' + due +
             (t.notes ? ' | notes: ' + String(t.notes).slice(0, 200) : '');
    }).join('\n');

    const done = tasks.filter(t => resolveTaskStatus(t) === 'complete').length;
    return '### ' + p.name + ' (' + (p.itemType || 'product') + ')\n' +
      'Launch/target date: ' + (p.launchDate || 'not set') + '\n' +
      'Owner: ' + (p.ownerName || 'unassigned') + '\n' +
      'Progress: ' + done + ' of ' + tasks.length + ' tasks complete\n' +
      (p.description ? 'Description: ' + String(p.description).slice(0, 400) + '\n' : '') +
      'Tasks:\n' + (lines || '  (none)');
  }).join('\n\n');
}

window.submitAsk = async () => {
  if (FEATURES.aiAsk === false) {
    showToast('The Ask assistant is currently disabled by an administrator.', 'error');
    return;
  }
  const input = document.getElementById('ask-input');
  const btn   = document.getElementById('ask-send');
  const thread = document.getElementById('ask-thread');
  const q = (input?.value || '').trim();
  if (!q) return;
  if (_askSelected.length === 0) { showToast('Select at least one product or project first', 'error'); return; }

  const context = buildAskContext();
  if (!context) { showToast('Nothing in scope — your selection may no longer be visible to you', 'error'); return; }

  if (_askHistory.length === 0) thread.innerHTML = '';
  appendAskMessage('user', q);
  input.value = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Thinking...'; }
  const thinkingId = appendAskMessage('assistant', '...', true);

  const askerName = currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0];
  const roleLabel = currentRole === 'admin' ? 'Admin (full portfolio visibility)'
                  : 'Team member' + (currentUserDept ? ' in ' + currentUserDept : '');

  const system =
    'You are the Mixta Africa NPD Hub assistant. You answer questions about product and project tracking data.\n\n' +
    'WHO IS ASKING: ' + askerName + ' (' + currentUser.email + '). Role: ' + roleLabel + '.\n\n' +
    'RULES:\n' +
    '- Answer ONLY from the DATA below. It is already filtered to what this person is permitted to see.\n' +
    '- If the answer is not in the data, say so plainly. Never guess, and never invent tasks, owners or dates.\n' +
    '- If asked about a product, project, person or department that is not in the data, say it is not in their current scope and suggest they select it above or request access.\n' +
    '- Be concise and specific. Cite task names and dates exactly as written.\n' +
    '- Use short prose or a compact list. No preamble, no restating the question.\n' +
    '- Today is ' + new Date().toISOString().slice(0, 10) + '.\n\n' +
    'DATA:\n' + context;

  try {
    const messages = [{ role: 'system', content: system }]
      .concat(_askHistory.slice(-6))
      .concat([{ role: 'user', content: q }]);
    const { text, provider, model } = await askAI(messages, 1000);
    _askHistory.push({ role: 'user', content: q });
    _askHistory.push({ role: 'assistant', content: text });
    replaceAskMessage(thinkingId, text, provider + (model ? ' · ' + model : ''));
  } catch(err) {
    replaceAskMessage(thinkingId, 'Could not get an answer: ' + (err.message || 'unknown error'), null, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ask'; }
  }
};

function appendAskMessage(role, text, pending) {
  const thread = document.getElementById('ask-thread');
  if (!thread) return null;
  const id = 'askmsg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'margin-bottom:14px;display:flex;gap:10px;' + (isUser ? 'flex-direction:row-reverse;' : '');
  div.innerHTML =
    '<div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:10px;font-weight:700;background:' + (isUser ? '#FEF2F2' : '#F0F0EE') + ';color:' + (isUser ? '#C0282D' : '#6B7280') + ';">' +
      (isUser ? (currentPreferredName || currentUser.email)[0].toUpperCase() : 'AI') +
    '</div>' +
    '<div style="max-width:78%;background:' + (isUser ? '#FEF2F2' : '#F8F8F7') + ';border-radius:10px;padding:9px 13px;' +
      'font-size:12px;line-height:1.7;color:var(--text);white-space:pre-wrap;word-break:break-word;' +
      (pending ? 'opacity:.5;' : '') + '">' + text + '</div>';
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
  return id;
}

function replaceAskMessage(id, text, provider, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  const bubble = el.querySelector('div:last-child');
  if (!bubble) return;
  bubble.style.opacity = '1';
  if (isError) { bubble.style.background = '#FEF2F2'; bubble.style.color = '#C0282D'; }
  bubble.textContent = text;
  if (provider) {
    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:9px;color:#9CA3AF;margin-top:5px;';
    tag.textContent = 'via ' + provider;
    bubble.appendChild(tag);
  }
  const thread = document.getElementById('ask-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

/* views/myactions.js — My Actions & To-dos: personal tasks, weekly review, approvals, task requests. */

import { db, get, ref, set } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { currentPreferredName, currentRole, currentUser, currentUserDept, currentView } from '../core/state.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { ownerLabel } from '../features/task-editor.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { formatDate, resolveTaskStatus } from '../data/status.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { ensureProductModal } from '../features/product-form.js';
import { checkViewLock } from '../auth/privacy-lock.js';

/* ── MY ACTIONS VIEW ── */
export async function renderMyActions(el) {
  if (!(await checkViewLock('myactions'))) return; // lock screen already rendered by checkViewLock
  el.innerHTML =
    '<div class="view-header">' +
      '<div>' +
        '<h1 class="view-title">My Actions &amp; To-do</h1>' +
        '<p class="view-subtitle">Stay on top of what\'s important. Here\'s what needs your attention.</p>' +
      '</div>' +
    '</div>' +
    '<div class="panel" id="pending-approvals-panel" style="margin-bottom:16px;display:none;">' +
      '<div class="panel-header">' +
        '<span class="panel-title">Awaiting your approval</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">Someone marked a task done or asked for more time</span>' +
      '</div>' +
      '<div class="panel-body" id="pending-approvals-list"></div>' +
    '</div>' +
    '<div class="panel" style="margin-bottom:16px;">' +
      '<div class="panel-header">' +
        '<span class="panel-title">Personal to-do</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">Private to you · included in your daily digest</span>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap;">' +
          '<div style="flex:2;min-width:200px;">' +
            '<label class="form-label" style="font-size:10px;">Task</label>' +
            '<input id="st-title" class="input-field" style="width:100%;" placeholder="e.g. Draft Q4 pricing memo" ' +
              'onkeydown="if(event.key===\'Enter\')addStandaloneTask()"/>' +
          '</div>' +
          '<div style="flex:1;min-width:130px;">' +
            '<label class="form-label" style="font-size:10px;">Deadline</label>' +
            '<input type="date" id="st-deadline" class="input-field" style="width:100%;"/>' +
          '</div>' +
          '<button class="btn-primary" style="font-size:12px;padding:8px 16px;" onclick="addStandaloneTask()">+ Add</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">' +
          '<span style="font-size:10px;color:var(--text-muted);align-self:center;margin-right:2px;">Duration:</span>' +
          '<button class="btn-outline" style="font-size:10px;padding:4px 10px;" onclick="setStandaloneDuration(\'today\')">Today</button>' +
          '<button class="btn-outline" style="font-size:10px;padding:4px 10px;" onclick="setStandaloneDuration(\'3days\')">3 days</button>' +
          '<button class="btn-outline" style="font-size:10px;padding:4px 10px;" onclick="setStandaloneDuration(\'week\')">This week</button>' +
          '<button class="btn-outline" style="font-size:10px;padding:4px 10px;" onclick="setStandaloneDuration(\'nextweek\')">Next week</button>' +
        '</div>' +
        '<div id="standalone-list"><div class="loading-row" style="padding:8px 0;font-size:12px;">Loading...</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="panel" id="weekly-performance-panel" style="margin-bottom:16px;display:none;">' +
      '<div class="panel-header">' +
        '<span class="panel-title">Your weekly performance</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">Strictly private — visible only to you</span>' +
      '</div>' +
      '<div class="panel-body" id="weekly-performance-list"></div>' +
    '</div>' +
    '<div class="ma-layout" style="display:grid;grid-template-columns:2.3fr 1fr;gap:16px;align-items:start;">' +
      '<div>' +
        '<div class="panel" style="margin-bottom:16px;">' +
          '<div style="display:flex;gap:8px;padding:14px 16px;flex-wrap:wrap;align-items:center;">' +
            '<input id="ma-search" class="input-field" style="flex:2;min-width:180px;" placeholder="Search tasks or projects..." oninput="applyMyActionsFilters()"/>' +
            '<select id="ma-filter-priority" class="input-field" style="flex:1;min-width:110px;" onchange="applyMyActionsFilters()">' +
              '<option value="">Priority</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>' +
            '</select>' +
            '<select id="ma-filter-status" class="input-field" style="flex:1;min-width:110px;" onchange="applyMyActionsFilters()">' +
              '<option value="">Status</option><option value="on-track">On track</option><option value="at-risk">At risk</option><option value="overdue">Overdue</option><option value="delayed">Delayed</option><option value="complete">Complete</option>' +
            '</select>' +
            '<select id="ma-filter-due" class="input-field" style="flex:1;min-width:110px;" onchange="applyMyActionsFilters()">' +
              '<option value="">Due date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">This week</option><option value="later">Later</option>' +
            '</select>' +
            '<button class="btn-link-sm" onclick="clearMyActionsFilters()">Clear filters</button>' +
          '</div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-header">' +
            '<span class="panel-title" id="ma-list-title">Actions &amp; To-dos</span>' +
            '<select id="ma-sort" class="input-field" style="font-size:11px;padding:4px 8px;" onchange="applyMyActionsFilters()">' +
              '<option value="due">Sort by: Due date (closest first)</option>' +
              '<option value="priority">Sort by: Priority</option>' +
              '<option value="title">Sort by: Title A-Z</option>' +
            '</select>' +
          '</div>' +
          '<div id="ma-list"><div class="loading-row" style="padding:32px;">Loading your tasks...</div></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:16px;">' +
        '<div class="panel">' +
          '<div class="panel-header"><span class="panel-title" style="display:flex;align-items:center;gap:6px;">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' +
            'Today\'s Focus</span></div>' +
          '<div id="ma-focus"><div class="loading-row" style="padding:16px;">Loading...</div></div>' +
          '<div style="padding:12px 16px;border-top:1px solid var(--border);">' +
            '<button class="btn-outline" style="width:100%;" onclick="clearMyActionsFilters()">View all actions</button>' +
          '</div>' +
        '</div>' +
        '<div class="panel" style="padding:20px;text-align:center;background:linear-gradient(180deg,#FAFAF9,#F4F4F2);">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom:10px;"><path d="M3 20l6-9 4 5 3-4 5 8H3z"/></svg>' +
          '<div style="font-size:13px;font-weight:700;color:#1A1A1A;margin-bottom:4px;">Progress, not perfection.</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">Small steps create big outcomes.</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  loadStandaloneTasks();
  loadMyActions();
  loadPendingApprovals();
}

window.myActionsState = { sort: 'due' };

/* ── STANDALONE PERSONAL TASKS — now week-scoped ──
   Lives entirely under standaloneTasks/{userKey}, which Firebase rules
   already lock to that exact user (".read"/".write" both require
   auth.token.email to match $userKey) — so the weekly log nested inside
   it inherits that same guarantee automatically. Nothing new to open up
   in the rules, nothing new that could leak. */
export function standaloneRef() {
  return 'standaloneTasks/' + sanitiseEmail(currentUser.email);
}

// ISO 8601 week key, e.g. "2026-W38" — the unit a task's "duration"
// resolves to for grouping, review, and the performance log.
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}
function currentWeekKey() { return isoWeekKey(new Date()); }
export function weekKeyLabel(weekKey) {
  // "2026-W38" -> "Week of 14 Sep" — the Monday of that ISO week.
  const [y, w] = weekKey.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  return 'Week of ' + monday.toLocaleDateString('en-GB', { day:'numeric', month:'short', timeZone:'UTC' });
}

window.setStandaloneDuration = (preset) => {
  const dateEl = document.getElementById('st-deadline');
  if (!dateEl) return;
  const d = new Date();
  if (preset === 'today') { /* today as-is */ }
  else if (preset === '3days') d.setDate(d.getDate() + 3);
  else if (preset === 'week') {
    // End of THIS ISO week (Sunday)
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + (7 - day));
  } else if (preset === 'nextweek') {
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + (14 - day));
  }
  dateEl.value = d.toISOString().slice(0, 10);
};

async function loadStandaloneTasks() {
  const el = document.getElementById('standalone-list');
  if (!el) return;
  try {
    const snap = await get(ref(db, standaloneRef()));
    const all = snap.exists() ? Object.values(snap.val()).filter(t => t.id && !t.id.startsWith('_')) : [];
    const cwk = currentWeekKey();

    // Sweep anything from a past week straight into the weekly review
    // instead of ever showing it here as if it were still actionable —
    // that's what makes a closed week actually uneditable, rather than
    // just visually different.
    const pastIncomplete = all.filter(t => t.weekKey && t.weekKey !== cwk && t.status !== 'complete' && !t.reviewed && !t.rolledOver);
    if (pastIncomplete.length > 0) {
      showWeeklyReviewModal(pastIncomplete);
      return; // review must be resolved before the list below means anything
    }

    const tasks = all.filter(t => !t.weekKey || t.weekKey === cwk);
    if (tasks.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:6px 0;">Nothing here yet. Add your first personal task above.</div>';
      loadWeeklyPerformance();
      return;
    }
    tasks.sort((a, b) => {
      if ((a.status === 'complete') !== (b.status === 'complete')) return a.status === 'complete' ? 1 : -1;
      return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    });
    const today = new Date(); today.setHours(0,0,0,0);
    el.innerHTML = tasks.map(t => {
      const done = t.status === 'complete';
      let chip = '<span class="pill pill-grey" style="font-size:10px;">No date</span>';
      if (t.deadline) {
        const d = new Date(t.deadline); d.setHours(0,0,0,0);
        const diff = Math.round((d - today) / 86400000);
        const cls  = done ? 'pill-blue' : diff < 0 ? 'pill-red' : diff <= 3 ? 'pill-amber' : 'pill-green';
        const lbl  = diff < 0 ? Math.abs(diff) + 'd overdue' : diff === 0 ? 'Today' : formatDate(t.deadline);
        chip = '<span class="pill ' + cls + '" style="font-size:10px;">' + lbl + '</span>';
      }
      const rolledTag = t.rolledOverFrom ? '<span class="pcf-pill pcf-pill-blue" style="font-size:9px;" title="Rolled over from a previous week">ROLLED OVER</span>' : '';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F3F3F2;">' +
        '<input type="checkbox" ' + (done ? 'checked' : '') + ' onchange="toggleStandaloneTask(\'' + t.id + '\',this.checked)" ' +
          'style="width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:#16A34A;"/>' +
        '<div style="flex:1;min-width:0;font-size:12px;color:' + (done ? '#9CA3AF' : 'var(--text)') + ';' +
          (done ? 'text-decoration:line-through;' : 'font-weight:500;') + '">' + (t.title || 'Untitled') + '</div>' +
        rolledTag + chip +
        '<button onclick="deleteStandaloneTask(\'' + t.id + '\')" title="Delete" ' +
          'style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:14px;line-height:1;padding:2px 4px;">&times;</button>' +
      '</div>';
    }).join('');
    loadWeeklyPerformance();
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:#9CA3AF;">Could not load your personal tasks.</div>';
  }
}

window.addStandaloneTask = async () => {
  const titleEl = document.getElementById('st-title');
  const dateEl  = document.getElementById('st-deadline');
  const title   = (titleEl?.value || '').trim();
  if (!title) { showToast('Enter a task first', 'error'); return; }
  const id = 'st_' + Date.now();
  const deadline = dateEl?.value || '';
  await set(ref(db, standaloneRef() + '/' + id), {
    id, title,
    deadline,
    status:     'on-track',
    ownerEmail: currentUser.email,
    createdAt:  Date.now(),
    weekKey:    isoWeekKey(deadline ? new Date(deadline) : new Date()),
  });
  if (titleEl) titleEl.value = '';
  if (dateEl)  dateEl.value  = '';
  loadStandaloneTasks();
};

window.toggleStandaloneTask = async (id, done) => {
  await set(ref(db, standaloneRef() + '/' + id + '/status'), done ? 'complete' : 'on-track');
  loadStandaloneTasks();
};

window.deleteStandaloneTask = async (id) => {
  await set(ref(db, standaloneRef() + '/' + id), null);
  loadStandaloneTasks();
};

/* ══ WEEKLY REVIEW — the "uneditable once the week ends" mechanism ══
   A past week's incomplete tasks never just sit there editable — they
   get swept straight into this review the next time the page loads.
   Every task must be given a decision (roll over or leave as missed)
   before the list below is shown, which is what actually enforces
   "uneditable": once a week ends, the only way to touch its tasks
   again is through this screen, once, and then it's closed for good. */
let _weeklyReviewState = {};

function showWeeklyReviewModal(pastIncomplete) {
  ensureProductModal();
  _weeklyReviewState = {};
  pastIncomplete.forEach(t => { _weeklyReviewState[t.id] = null; });

  const byWeek = {};
  pastIncomplete.forEach(t => { (byWeek[t.weekKey] = byWeek[t.weekKey] || []).push(t); });

  document.getElementById('modal-title-text').textContent = 'Weekly review';
  document.getElementById('modal-body-content').innerHTML =
    '<p style="font-size:13px;color:var(--text-mid);margin-bottom:16px;line-height:1.6;">' +
      'A previous week ended with tasks still open. Decide what happens to each one — this is what closes that week out and locks it into your performance log.' +
    '</p>' +
    Object.entries(byWeek).map(([wk, items]) => (
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">' + weekKeyLabel(wk) + '</div>' +
        items.map(t => (
          '<div id="wr-item-' + t.id + '" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">' +
            '<div style="flex:1;min-width:0;font-size:12px;color:var(--text);">' + (t.title || 'Untitled') + '</div>' +
            '<button class="btn-outline" style="font-size:10px;padding:5px 10px;" id="wr-roll-' + t.id + '" onclick="setWeeklyReviewChoice(\'' + t.id + '\',\'rollover\')">Roll over</button>' +
            '<button class="btn-outline" style="font-size:10px;padding:5px 10px;" id="wr-miss-' + t.id + '" onclick="setWeeklyReviewChoice(\'' + t.id + '\',\'missed\')">Leave as missed</button>' +
          '</div>'
        )).join('') +
      '</div>'
    )).join('') +
    '<div class="form-actions" style="margin-top:8px;"><button class="btn-primary" id="wr-finish-btn" disabled onclick="finishWeeklyReview()">Finish review</button></div>';
  document.getElementById('create-product-modal').style.display = 'flex';
  window._weeklyReviewTasks = pastIncomplete;
}

window.setWeeklyReviewChoice = (taskId, choice) => {
  _weeklyReviewState[taskId] = choice;
  const rollBtn = document.getElementById('wr-roll-' + taskId);
  const missBtn = document.getElementById('wr-miss-' + taskId);
  if (rollBtn) { rollBtn.style.background = choice === 'rollover' ? 'var(--green)' : ''; rollBtn.style.color = choice === 'rollover' ? '#fff' : ''; rollBtn.style.borderColor = choice === 'rollover' ? 'var(--green)' : ''; }
  if (missBtn) { missBtn.style.background = choice === 'missed' ? 'var(--text-muted)' : ''; missBtn.style.color = choice === 'missed' ? '#fff' : ''; missBtn.style.borderColor = choice === 'missed' ? 'var(--text-muted)' : ''; }
  const allDecided = Object.values(_weeklyReviewState).every(v => v !== null);
  const finishBtn = document.getElementById('wr-finish-btn');
  if (finishBtn) finishBtn.disabled = !allDecided;
};

window.finishWeeklyReview = async () => {
  const tasks = window._weeklyReviewTasks || [];
  const cwk = currentWeekKey();

  // Group by the week each task actually belonged to, so a stats entry
  // gets written per week even if several unreviewed weeks piled up.
  const byWeek = {};
  tasks.forEach(t => { (byWeek[t.weekKey] = byWeek[t.weekKey] || []).push(t); });

  for (const [wk, items] of Object.entries(byWeek)) {
    let rolledOver = 0, missed = 0;
    for (const t of items) {
      const choice = _weeklyReviewState[t.id];
      if (choice === 'rollover') {
        rolledOver++;
        const newId = 'st_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        await set(ref(db, standaloneRef() + '/' + newId), {
          id: newId, title: t.title, deadline: '', status: 'on-track',
          ownerEmail: currentUser.email, createdAt: Date.now(),
          weekKey: cwk, rolledOverFrom: t.id,
        });
        await set(ref(db, standaloneRef() + '/' + t.id + '/rolledOver'), true);
      } else {
        missed++;
      }
      await set(ref(db, standaloneRef() + '/' + t.id + '/reviewed'), true);
    }

    // Pull the FULL set of that week's tasks (not just the incomplete
    // ones passed in here) so the completion rate reflects everything,
    // not just what needed a decision.
    const snap = await get(ref(db, standaloneRef()));
    const weekTasks = snap.exists() ? Object.values(snap.val()).filter(x => x.id && !x.id.startsWith('_') && x.weekKey === wk) : [];
    const completed = weekTasks.filter(x => x.status === 'complete').length;
    const total = weekTasks.length;

    await set(ref(db, standaloneRef() + '/_weekLogs/' + wk), {
      weekKey: wk, closedAt: Date.now(),
      total, completed, rolledOver, missed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  }

  closeProductModal();
  showToast('Weekly review complete.', 'success');
  loadStandaloneTasks();
};

/* ══ PERFORMANCE LOG — read-only, strictly this user's own history ══ */
async function loadWeeklyPerformance() {
  const el = document.getElementById('weekly-performance-list');
  if (!el) return;
  try {
    const snap = await get(ref(db, standaloneRef() + '/_weekLogs'));
    if (!snap.exists()) {
      document.getElementById('weekly-performance-panel').style.display = 'none';
      return;
    }
    const weeks = Object.values(snap.val()).sort((a, b) => b.weekKey.localeCompare(a.weekKey)).slice(0, 8);
    document.getElementById('weekly-performance-panel').style.display = 'block';
    el.innerHTML = weeks.map(w => {
      const rateColor = w.completionRate >= 75 ? 'var(--green)' : w.completionRate >= 40 ? '#D97706' : 'var(--red)';
      return '<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text);">' + weekKeyLabel(w.weekKey) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:1px;">' + w.completed + ' of ' + w.total + ' done' + (w.rolledOver ? ' · ' + w.rolledOver + ' rolled over' : '') + (w.missed ? ' · ' + w.missed + ' missed' : '') + '</div>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + rateColor + ';">' + w.completionRate + '%</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    console.warn('loadWeeklyPerformance failed:', e);
  }
}

async function loadMyActions() {
  const listEl = document.getElementById('ma-list');
  if (!listEl) return;
  try {
    const products = await getProductsFresh();
    const userKey  = sanitiseEmail(currentUser.email);
    const meEmail  = (currentUser.email || '').toLowerCase().trim();
    const meDept   = (currentUserDept || '').toLowerCase().trim();

    const records = [];

    Object.values(products).forEach(prod => {
      if (prod.status === 'archived') return;
      if (!canUserSeeProduct(prod, userKey)) return;

      const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));

      tasks.forEach(task => {
        const ownerList = (task.owners && task.owners.length > 0)
          ? task.owners
          : [{ dept: task.ownerDept || '', email: task.ownerEmail || '' }];

        const isAssigned = ownerList.some(o => {
          const oe = (o.email || '').toLowerCase().trim();
          const od = (o.dept  || '').toLowerCase().trim();
          if (oe && oe === meEmail) return true;
          if (od && meDept && od === meDept) return true;
          return false;
        });
        const isCreator = (task.createdBy || '').toLowerCase().trim() === meEmail;

        // Strictly personal: a task only belongs on THIS page if the same
        // person both created it and is assigned to it. Assigned-by-someone-
        // else or created-for-someone-else tasks live in the Task Tracker,
        // not here. This is a fixed rule for every user, not a filter option.
        if (!isAssigned || !isCreator) return;

        const eff = resolveTaskStatus(task, prod);
        records.push({ task, prod, eff, isAssigned, isCreator });
      });
    });

    window._myActionsData = records;
    renderMyActionsList();
  } catch(e) {
    listEl.innerHTML = '<div class="loading-row muted" style="padding:24px;">Could not load your tasks. Try refreshing.</div>';
    console.warn('loadMyActions error:', e);
  }
}

// Priority is DERIVED for display — there is no stored priority field on
// tasks yet, so this reflects urgency, not an independent signal.
function maDerivePriority(eff) {
  if (['overdue', 'delayed', 'blocked'].includes(eff)) return 'High';
  if (eff === 'due-soon') return 'Medium';
  return 'Low';
}
function maStatusPill(eff) {
  if (eff === 'complete') return { label: 'Complete', cls: 'pcf-pill-blue' };
  if (eff === 'overdue')  return { label: 'Overdue',  cls: 'pcf-pill-red' };
  if (eff === 'delayed')  return { label: 'Delayed',  cls: 'pcf-pill-red' };
  if (eff === 'due-soon' || eff === 'blocked') return { label: 'At risk', cls: 'pcf-pill-amber' };
  return { label: 'On track', cls: 'pcf-pill-green' };
}
function maInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function maDueLabel(deadline) {
  if (!deadline) return 'No date';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(deadline); d.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDate(deadline) + (diff < 0 ? ' · ' + Math.abs(diff) + 'd overdue' : '');
}

// Deterministic per-task color square — same seven-color rotation used for
// visual variety, keyed off the task id so it's stable across re-renders.
const MA_ICON_PALETTE = [
  { bg: '#FEE2E2', fg: '#C0282D' }, { bg: '#FEF3C7', fg: '#D97706' },
  { bg: '#DCFCE7', fg: '#16A34A' }, { bg: '#EFF6FF', fg: '#2563EB' },
  { bg: '#F3E8FF', fg: '#7C3AED' }, { bg: '#FCE7F3', fg: '#DB2777' },
];
function maIconFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MA_ICON_PALETTE[h % MA_ICON_PALETTE.length];
}

window.clearMyActionsFilters = () => {
  ['ma-search','ma-filter-priority','ma-filter-status','ma-filter-due'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderMyActionsList();
};

window.applyMyActionsFilters = () => renderMyActionsList();

window.toggleMyActionComplete = async (productId, taskId, checked) => {
  if (!checked) return; // Only completing is wired here — unchecking a real
                         // task's status belongs in its own status control.
  await updatePillarStatus(productId, taskId, 'complete');
  loadMyActions();
};

/* ══ DONE / EXTEND TIME — with a required comment, gated behind approval ══
   Neither button changes anything directly. Both write a pendingRequest
   and email the approver (the task's creator, else the product owner);
   the actual status/deadline change only happens once that request is
   approved — from the SPA below, or from the approver's own email, since
   both paths go through the exact same backend functions. */
window.showTaskRequestModal = (productId, taskId, type) => {
  ensureProductModal();
  const prod = productListCache[productId];
  const task = prod && getProductTasks(prod).find(t => t.id === taskId);
  if (!prod || !task) return;
  if (task.pendingRequest) { showToast('This task already has a request awaiting approval.', 'error'); return; }

  const isExtend = type === 'extend';
  document.getElementById('modal-title-text').textContent = isExtend ? 'Request more time' : 'Mark as done';
  document.getElementById('modal-body-content').innerHTML =
    '<p style="font-size:13px;color:var(--text-mid);margin-bottom:14px;">' + (task.title || task.name || '') + ' &middot; ' + (prod.name || '') + '</p>' +
    (isExtend ? '<div class="form-row"><label class="form-label">New deadline <span class="req">*</span></label><input type="date" id="tr-newdate" class="input-field"/></div>' : '') +
    '<div class="form-row"><label class="form-label">Comment <span class="req">*</span> — ' + (isExtend ? "what's causing the delay?" : 'a quick note on what was done') + '</label>' +
      '<textarea id="tr-comment" class="input-field" rows="3" placeholder="' + (isExtend ? 'e.g. Awaiting legal sign-off on the survey report' : 'e.g. Submitted to legal for review this morning') + '"></textarea></div>' +
    '<p style="font-size:11px;color:var(--text-muted);margin-bottom:14px;">This won\'t change the task yet — it sends a request for approval first.</p>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="submitTaskRequestFromDashboard(\'' + productId + '\',\'' + taskId + '\',\'' + type + '\')">' + (isExtend ? 'Send request' : 'Submit for approval') + '</button>' +
    '</div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.submitTaskRequestFromDashboard = async (productId, taskId, type) => {
  const comment = document.getElementById('tr-comment')?.value.trim();
  const newDate = type === 'extend' ? (document.getElementById('tr-newdate')?.value || '') : '';
  if (!comment) { showToast('A comment is required.', 'error'); return; }
  if (type === 'extend' && !newDate) { showToast('Please choose a new deadline.', 'error'); return; }

  try {
    const res = await callGAS('submitTaskRequest', { productId, taskId, type, email: currentUser.email, comment, newDate });
    if (res && res.ok) {
      closeProductModal();
      showToast(res.message || 'Request submitted.', 'success');
      const prod = productListCache[productId];
      const task = prod && getProductTasks(prod).find(t => t.id === taskId);
      if (task) task.pendingRequest = { type, requestedBy: currentUser.email, requestedByName: currentPreferredName || currentUser.email.split('@')[0], comment, proposedDeadline: newDate || null, createdAt: Date.now() };
      loadMyActions();
    } else {
      showToast(res?.error || res?.message || 'Could not submit request.', 'error');
    }
  } catch(e) {
    showToast('Could not submit request: ' + e.message, 'error');
  }
};

/* ══ APPROVALS INBOX — "awaiting your approval" panel on My Actions ══
   Scans every product this user can see for tasks with a pendingRequest
   where they're the resolved approver, or they're an admin (a backstop —
   "sends a request to me the admin" even when a specific approver was
   also resolved). */
async function loadPendingApprovals() {
  const panel = document.getElementById('pending-approvals-panel');
  const listEl = document.getElementById('pending-approvals-list');
  if (!panel || !listEl) return;
  try {
    const products = await getProductsFresh();
    const userKey = sanitiseEmail(currentUser.email);
    const myEmail = (currentUser.email || '').toLowerCase();
    const pending = [];

    Object.values(products).forEach(prod => {
      if (prod.status === 'archived') return;
      if (!canUserSeeProduct(prod, userKey)) return;
      getProductTasks(prod).forEach(task => {
        const req = task.pendingRequest;
        if (!req) return;
        const isApprover = (req.approverEmail || '').toLowerCase() === myEmail;
        if (isApprover || currentRole === 'admin') pending.push({ prod, task, req });
      });
    });

    if (pending.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    pending.sort((a, b) => (b.req.createdAt || 0) - (a.req.createdAt || 0));

    listEl.innerHTML = pending.map(({ prod, task, req }) => {
      const when = req.createdAt ? new Date(req.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      const actionLabel = req.type === 'extend' ? 'wants to push the deadline to <strong>' + formatDate(req.proposedDeadline) + '</strong>' : 'says this is done';
      return '<div style="padding:12px 0;border-bottom:1px solid var(--border);">' +
        '<div style="font-size:13px;color:#1A1A1A;">' +
          '<strong>' + (req.requestedByName || (req.requestedBy || '').split('@')[0]) + '</strong> ' + actionLabel +
          ' on <strong>' + (task.title || task.name || 'Untitled') + '</strong>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin:2px 0 8px;">' + prod.name + ' · ' + when + '</div>' +
        '<div style="background:var(--bg);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--text-mid);margin-bottom:10px;">' + (req.comment || '') + '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn-primary" style="font-size:11px;padding:6px 14px;background:var(--green);" onclick="resolveTaskRequestFromDashboard(\'' + prod.id + '\',\'' + task.id + '\',\'approve\')">Approve</button>' +
          '<button class="btn-outline" style="font-size:11px;padding:6px 14px;" onclick="resolveTaskRequestFromDashboard(\'' + prod.id + '\',\'' + task.id + '\',\'reject\')">Reject</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    panel.style.display = 'none';
    console.warn('loadPendingApprovals failed:', e);
  }
}

window.resolveTaskRequestFromDashboard = async (productId, taskId, decision) => {
  try {
    const res = await callGAS('resolveTaskRequest', { productId, taskId, decision });
    if (res && res.ok) {
      showToast(res.message || (decision === 'approve' ? 'Approved.' : 'Rejected.'), 'success');
      const prod = productListCache[productId];
      const task = prod && getProductTasks(prod).find(t => t.id === taskId);
      if (task) task.pendingRequest = null;
      loadPendingApprovals();
      if (currentView === 'myactions') loadMyActions();
    } else {
      showToast(res?.error || res?.message || 'Could not process this decision.', 'error');
    }
  } catch(e) {
    showToast('Could not process this decision: ' + e.message, 'error');
  }
};

function renderMyActionsList() {
  const all = window._myActionsData || [];

  let rows = all.map(r => ({ ...r, priority: maDerivePriority(r.eff) }));


  // Today's Focus — top 5 most urgent, independent of the tab/filter state below
  const focusEl = document.getElementById('ma-focus');
  if (focusEl) {
    const urgencyRank = { overdue: 0, delayed: 1, blocked: 2, 'due-soon': 3, 'on-track': 4, 'in-progress': 4, complete: 5 };
    const focus = rows
      .filter(r => r.eff !== 'complete')
      .sort((a, b) => (urgencyRank[a.eff] - urgencyRank[b.eff]) || (new Date(a.task.deadline||'9999') - new Date(b.task.deadline||'9999')))
      .slice(0, 5);
    focusEl.innerHTML = focus.length === 0
      ? '<div class="empty-state" style="padding:24px 16px;font-size:12px;">Nothing urgent right now.</div>'
      : `<div style="padding:4px 0 8px;">` + focus.map(r => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="viewProduct('${r.prod.id}','${r.task.id}')">
          <input type="checkbox" style="margin-top:2px;" onclick="event.stopPropagation(); toggleMyActionComplete('${r.prod.id}','${r.task.id}', this.checked)"/>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#1A1A1A;">${r.task.title || 'Untitled task'}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${r.prod.name} · ${r.priority}</div>
          </div>
          <div style="font-size:10px;font-weight:700;color:${['overdue','delayed'].includes(r.eff) ? 'var(--red)' : 'var(--text-muted)'};flex-shrink:0;">${maDueLabel(r.task.deadline)}</div>
        </div>`).join('') + `</div>`;
  }

  // Search + dropdown filters, applied on top of the tab scope
  const q        = (document.getElementById('ma-search')?.value || '').toLowerCase().trim();
  const fPriority = document.getElementById('ma-filter-priority')?.value || '';
  const fStatus   = document.getElementById('ma-filter-status')?.value || '';
  const fDue      = document.getElementById('ma-filter-due')?.value || '';
  const sort      = document.getElementById('ma-sort')?.value || 'due';

  if (q) rows = rows.filter(r => (r.task.title || '').toLowerCase().includes(q) || (r.prod.name || '').toLowerCase().includes(q));
  if (fPriority) rows = rows.filter(r => r.priority === fPriority);
  if (fStatus) {
    rows = rows.filter(r => {
      if (fStatus === 'at-risk') return ['due-soon','blocked'].includes(r.eff);
      if (fStatus === 'overdue') return r.eff === 'overdue';
      if (fStatus === 'delayed') return r.eff === 'delayed';
      if (fStatus === 'complete') return r.eff === 'complete';
      return ['on-track','in-progress'].includes(r.eff);
    });
  } else {
    rows = rows.filter(r => r.eff !== 'complete'); // default view hides done items
  }
  if (fDue) {
    const today = new Date(); today.setHours(0,0,0,0);
    rows = rows.filter(r => {
      if (!r.task.deadline) return false;
      const d = new Date(r.task.deadline); d.setHours(0,0,0,0);
      const diff = Math.round((d - today) / 86400000);
      if (fDue === 'overdue') return diff < 0;
      if (fDue === 'today')   return diff === 0;
      if (fDue === 'week')    return diff >= 0 && diff <= 7;
      if (fDue === 'later')   return diff > 7;
      return true;
    });
  }

  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  if (sort === 'priority') rows.sort((a,b) => priorityRank[a.priority] - priorityRank[b.priority]);
  else if (sort === 'title') rows.sort((a,b) => (a.task.title||'').localeCompare(b.task.title||''));
  else rows.sort((a,b) => new Date(a.task.deadline || '9999') - new Date(b.task.deadline || '9999'));

  const titleEl = document.getElementById('ma-list-title');
  if (titleEl) titleEl.textContent = rows.length + ' Actions & To-dos';

  const listEl = document.getElementById('ma-list');
  if (!listEl) return;

  if (rows.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:64px 24px;">
        <div style="margin-bottom:16px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:8px;color:#1A1A1A;">You're all clear</h3>
        <p style="font-size:13px;color:#6B7280;">No tasks match this view right now.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = rows.map(r => {
    const pill = maStatusPill(r.eff);
    const icon = maIconFor(r.task.id || r.task.title || 'x');
    const prioCls = r.priority === 'High' ? 'pcf-pill-red' : r.priority === 'Medium' ? 'pcf-pill-amber' : 'pcf-pill-grey';
    const ownerName = r.task.owner || ownerLabel((r.task.owners||[])[0] || {}) || 'Unassigned';
    const pendingReq = r.task.pendingRequest;
    const actionCell = pendingReq
      ? '<span class="pcf-pill pcf-pill-amber ma-act" style="flex-shrink:0;" title="' + String(pendingReq.comment || '').replace(/"/g,'&quot;') + '">Awaiting approval</span>'
      : r.eff === 'complete'
        ? '<span class="pcf-pill pcf-pill-blue ma-act" style="flex-shrink:0;">Complete</span>'
        : '<div class="ma-act" style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation();">' +
            '<button class="btn-outline" style="font-size:10px;padding:4px 9px;" onclick="showTaskRequestModal(\'' + r.prod.id + '\',\'' + r.task.id + '\',\'done\')">Done</button>' +
            '<button class="btn-outline" style="font-size:10px;padding:4px 9px;" onclick="showTaskRequestModal(\'' + r.prod.id + '\',\'' + r.task.id + '\',\'extend\')">Extend</button>' +
          '</div>';
    return `
      <div class="ma-row" onclick="viewProduct('${r.prod.id}','${r.task.id}')">
        ${actionCell}
        <div class="ma-icon-sq" style="background:${icon.bg};color:${icon.fg};">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="ma-main" style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1A1A1A;">${r.task.title || 'Untitled task'}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${r.prod.name}</div>
        </div>
        <span class="pcf-pill ${prioCls} ma-prio" style="flex-shrink:0;">${r.priority}</span>
        <div class="ma-avatar" title="${ownerName}">${maInitials(ownerName)}</div>
        <div class="ma-due" style="font-size:11px;color:${['overdue','delayed'].includes(r.eff) ? 'var(--red)' : 'var(--text-mid)'};flex-shrink:0;width:100px;">${maDueLabel(r.task.deadline)}</div>
        <span class="pcf-pill ${pill.cls} ma-state" style="flex-shrink:0;">${pill.label}</span>
        <svg class="ma-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--border-mid)" stroke-width="2" style="flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
      </div>`;
  }).join('');
}

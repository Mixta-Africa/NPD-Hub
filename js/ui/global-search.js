/* ui/global-search.js — Header search bar over projects, tasks and people. */

import { sanitiseEmail } from '../core/utils.js';
import { currentUser } from '../core/state.js';
import { canUserSeeProduct, canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { getProductsFresh } from '../data/products-cache.js';

/* ══ GLOBAL SEARCH — header bar ═══════════════════════════════
   Was pure decoration: an <input> with no listener at all. Searches
   products/projects and tasks the current user can actually see
   (same canUserSeeProduct/canViewTask gates as everywhere else — a
   search box is not a way to leak a task someone shouldn't find). */
let _gsDebounce = null;

export function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';

  input.addEventListener('input', () => {
    clearTimeout(_gsDebounce);
    const q = input.value.trim();
    if (!q) { closeGlobalSearchResults(); return; }
    _gsDebounce = setTimeout(() => runGlobalSearch(q), 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; closeGlobalSearchResults(); input.blur(); }
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) runGlobalSearch(input.value.trim());
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-wrap')) closeGlobalSearchResults();
  });
}

function ensureGlobalSearchResultsEl() {
  let el = document.getElementById('global-search-results');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-search-results';
    el.className = 'gsr-panel';
    const wrap = document.querySelector('.global-search-wrap');
    if (wrap) wrap.appendChild(el);
  }
  return el;
}

async function runGlobalSearch(q) {
  const el = ensureGlobalSearchResultsEl();
  el.style.display = 'block';
  el.innerHTML = '<div class="gsr-empty">Searching…</div>';
  try {
    const products = await getProductsFresh();
    const userKey = sanitiseEmail(currentUser.email);
    const ql = q.toLowerCase();

    const productMatches = [];
    const taskMatches = [];

    Object.values(products).forEach(prod => {
      if (prod.status === 'archived') return;
      if (!canUserSeeProduct(prod, userKey)) return;

      if ((prod.name || '').toLowerCase().includes(ql)) productMatches.push(prod);

      getProductTasks(prod).filter(t => canViewTask(t, prod)).forEach(t => {
        const title = t.title || t.name || '';
        if (title.toLowerCase().includes(ql)) taskMatches.push({ task: t, prod });
      });
    });

    renderGlobalSearchResults(q, productMatches.slice(0, 5), taskMatches.slice(0, 6));
  } catch(e) {
    el.innerHTML = '<div class="gsr-empty">Search failed — try again.</div>';
  }
}

function renderGlobalSearchResults(q, productMatches, taskMatches) {
  const el = ensureGlobalSearchResultsEl();
  if (productMatches.length === 0 && taskMatches.length === 0) {
    el.innerHTML = '<div class="gsr-empty">No matches for "' + q.replace(/</g,'&lt;') + '"</div>';
    return;
  }
  let html = '';
  if (productMatches.length) {
    html += '<div class="gsr-section-label">Projects &amp; Products</div>' +
      productMatches.map(p => {
        const isProject = p.itemType === 'project';
        return '<div class="gsr-row" onclick="closeGlobalSearchResults(); openProjectDashboard(\'' + p.id + '\')">' +
          '<span class="gsr-row-icon" style="background:' + (isProject ? '#EFF6FF' : '#FEF2F2') + ';color:' + (isProject ? '#2563EB' : '#C0282D') + ';">' + (isProject ? 'PR' : 'PD') + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="gsr-row-title">' + (p.name || '') + '</div>' +
            '<div class="gsr-row-sub">' + (isProject ? 'Project' : 'Product') + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
  }
  if (taskMatches.length) {
    html += '<div class="gsr-section-label">Tasks</div>' +
      taskMatches.map(({ task, prod }) =>
        '<div class="gsr-row" onclick="closeGlobalSearchResults(); viewProduct(\'' + prod.id + '\',\'' + task.id + '\')">' +
          '<span class="gsr-row-icon" style="background:#F3F4F6;color:#6B7280;">T</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="gsr-row-title">' + (task.title || task.name || 'Untitled') + '</div>' +
            '<div class="gsr-row-sub">' + (prod.name || '') + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
  }
  el.innerHTML = html;
}

window.closeGlobalSearchResults = () => {
  const el = document.getElementById('global-search-results');
  if (el) el.style.display = 'none';
};

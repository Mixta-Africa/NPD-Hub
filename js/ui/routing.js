/* ui/routing.js — Deep links from email (?p=&t=&view=) and loadView(), the page router. */

import { set_currentView } from '../core/state.js';
import { teardownAllListeners } from '../core/listeners.js';
import { renderDashboard } from '../views/dashboard.js';
import { renderWorkload } from '../views/workload.js';
import { renderMyActions } from '../views/myactions.js';
import { renderDecisions } from '../views/decisions.js';
import { renderProducts } from '../views/products.js';
import { DRILL_META, renderDrilldown } from '../views/drilldown.js';
import { renderProjectDashboard } from '../views/project-dashboard.js';
import { renderAsk } from '../views/ask.js';
import { renderCalendar } from '../views/calendar.js';
import { renderTracker } from '../views/tracker.js';
import { renderDocuments } from '../views/documents.js';
import { renderReports } from '../views/reports.js';
import { renderSettings } from '../views/settings.js';
import { closeMobileSidebar } from './shell.js';
import { renderSuperAdmin } from '../superadmin/index.js';

/* ─── NAVIGATION ─── */
/* ══════════════════════════════════════════════════════════════
   DEEP LINK ROUTING
   Every automated email carries ?p=<productId>&t=<taskId>&view=<view>.
   Landing the recipient on the exact thing being discussed is the
   difference between a notification and an instruction.
   ══════════════════════════════════════════════════════════════ */
export function routeFromDeepLink() {
  let target = 'dashboard';
  try {
    const q = new URLSearchParams(window.location.search);
    const saResetToken = q.get('saReset');
    if (saResetToken) {
      window.history.replaceState({}, '', window.location.pathname);
      showSAPasswordResetForm(saResetToken);
      return;
    }
    const productId = q.get('p');
    const taskId    = q.get('t');
    const view      = q.get('view');

    if (productId) {
      // Remember the task so the item view can highlight it
      window._deepLinkTask = taskId || null;
      loadView('project:' + productId);
      // Clear the params so a refresh doesn't re-trigger
      window.history.replaceState({}, '', window.location.pathname);
      if (taskId) setTimeout(() => highlightDeepLinkTask(taskId), 900);
      return;
    }
    if (view) target = view;
    window.history.replaceState({}, '', window.location.pathname);
  } catch(e) { /* malformed link — fall through to dashboard */ }
  loadView(target);
}

export function highlightDeepLinkTask(taskId) {
  const row = document.getElementById('terow-' + taskId) ||
              document.querySelector('[data-task-id="' + taskId + '"]');
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.style.transition = 'background .4s';
  row.style.background = '#FFFBEB';
  setTimeout(() => { row.style.background = ''; }, 2600);
}

window.loadView = (view) => {
  closeMobileSidebar();
  // Parameterised views — drill:<filter> and project:<id>
  if (typeof view === 'string' && view.indexOf(':') > -1) {
    teardownAllListeners();
    set_currentView( view);
    const [kind, arg] = [view.slice(0, view.indexOf(':')), view.slice(view.indexOf(':') + 1)];
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navFor = kind === 'project' ? 'products' : 'dashboard';
    const navEl  = document.querySelector('.nav-item[data-view="' + navFor + '"]');
    if (navEl) navEl.classList.add('active');
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = kind === 'project' ? 'Project' : (DRILL_META[arg]?.title || 'Details');
    const content = document.getElementById('main-content');
    if (!content) return;
    if (kind === 'drill')   renderDrilldown(content, arg);
    if (kind === 'project') renderProjectDashboard(content, arg);
    return;
  }

  // Tear down previous view's real-time listeners before switching
  teardownAllListeners();
  set_currentView( view);

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  // Update page title
  const titles = {
    dashboard:  'Dashboard',
    myactions:  'My Actions & To-do',
    ask:        'Ask',
    products:   'Products & Projects',
    calendar:   'Launch Calendar',
    tracker:    'Task Tracker',
    workload:   'Department Workload',
    documents:  'Document Centre',
    reports:    'Progress Reports',
    settings:   'Settings'
  };
  const pageTitleEl = document.getElementById('page-title');   
  if (pageTitleEl) pageTitleEl.textContent = titles[view] || view;

  // Render the view
  const content = document.getElementById('main-content');
  content.innerHTML = '';
  content.className = 'main-content';

  switch(view) {
    case 'dashboard':  renderDashboard(content); break;
    case 'myactions':  renderMyActions(content);  break;
    case 'ask':        renderAsk(content);        break;
    case 'decisions':  renderDecisions(content);  break;
    case 'products':   renderProducts(content);  break;
    case 'calendar':   renderCalendar(content);  break;
    case 'tracker':    renderTracker(content);   break;
    case 'workload':   renderWorkload(content);  break;
    case 'documents':  renderDocuments(content); break;
    case 'reports':    renderReports(content);   break;
    case 'settings':    renderSettings(content);   break;
    case 'superadmin':  renderSuperAdmin(content);  break;
    default:            content.innerHTML = '<div class="empty-state"><p>Coming in a future phase.</p></div>';
  }
};

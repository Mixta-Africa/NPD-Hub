/* superadmin/index.js — Circuit Box shell and tab router. */

import { ICON } from '../core/icons.js';
import { isSuperAdmin, saSessionStart } from '../core/state.js';
import { renderSAHealth } from './health.js';
import { renderSAPeople } from './people.js';
import { renderSAFeatures } from './features.js';
import { renderSAPillars } from './pillars.js';
import { renderSAStakeholders } from './stakeholders.js';
import { renderSAConfig } from './config.js';
import { renderSAAudit, renderSAErrors } from './audit-errors.js';
import { renderSAUsers } from './users.js';
import { renderSAProducts } from './products.js';
import { renderSAMaintenance } from './maintenance.js';
import { renderSADepartments } from './departments.js';
import { renderSATemplates } from './templates.js';
import { renderSAAllTasks } from './all-tasks.js';
import { renderSAWatchdog } from './watchdog.js';

/* ════════════════════════════════════════════════════════════
   SUPER ADMIN VIEW — Circuit Box
════════════════════════════════════════════════════════════ */
export function renderSuperAdmin(el) {
  if (!isSuperAdmin) {
    el.innerHTML = `<div class="empty-state">
      <span class="empty-icon" style="color:var(--text-muted);">${ICON.lock}</span>
      <h3>Super admin access required</h3>
      <p>Your session has expired or you have not authenticated.</p>
      <button class="btn-primary" onclick="showSAChallenge()">Enter password</button>
    </div>`;
    return;
  }

  const sessionMins = Math.round((Date.now() - saSessionStart) / 60000);
  const remaining   = Math.max(0, 30 - sessionMins);

  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title" style="display:flex;align-items:center;gap:8px;">${ICON.bolt} Circuit Box</h1>
        <p class="view-subtitle">Super admin — maintenance & debugging centre</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="sa-session-badge">Session: ${remaining}m remaining</span>
        <button class="btn-danger-sm" onclick="exitSASession()">End session</button>
      </div>
    </div>

    <div class="sa-tabs">
      <button class="sa-tab active" onclick="switchSATab('health', this)">Health</button>
      <button class="sa-tab" onclick="switchSATab('errors', this)">Error Log</button>
      <button class="sa-tab" onclick="switchSATab('features', this)">Features</button>
      <button class="sa-tab" onclick="switchSATab('pillars', this)">Pillars</button>
      <button class="sa-tab" onclick="switchSATab('stakeholders', this)">Stakeholders</button>
      <button class="sa-tab" onclick="switchSATab('config', this)">System Config</button>
      <button class="sa-tab" onclick="switchSATab('departments', this)">Departments</button>
      <button class="sa-tab" onclick="switchSATab('templates', this)">Templates</button>
      <button class="sa-tab" onclick="switchSATab('tasks', this)">All Tasks</button>
      <button class="sa-tab" onclick="switchSATab('people', this)">People</button>
      <button class="sa-tab" onclick="switchSATab('audit', this)">Audit Log</button>
      <button class="sa-tab" onclick="switchSATab('users', this)">Users</button>
      <button class="sa-tab" onclick="switchSATab('products', this)">Products</button>
      <button class="sa-tab" onclick="switchSATab('maintenance', this)">Maintenance</button>
      <button class="sa-tab" onclick="switchSATab('watchdog', this)">Watchdog</button>
    </div>

    <div id="sa-tab-content">
      <div class="loading-row" style="padding:24px;">Loading system health...</div>
    </div>`;

  loadSATab('health');
}

window.switchSATab = (tab, btn) => {
  document.querySelectorAll('.sa-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadSATab(tab);
};

export async function loadSATab(tab) {
  const el = document.getElementById('sa-tab-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-row" style="padding:24px;">Loading...</div>';

  switch(tab) {
    case 'health':        await renderSAHealth(el);        break;
    case 'errors':        await renderSAErrors(el);        break;
    case 'features':      await renderSAFeatures(el);      break;
    case 'pillars':       await renderSAPillars(el);       break;
    case 'stakeholders':  await renderSAStakeholders(el);  break;
    case 'config':        await renderSAConfig(el);        break;
    case 'audit':         await renderSAAudit(el);         break;
    case 'departments':   await renderSADepartments(el);   break;
    case 'templates':     await renderSATemplates(el);      break;
    case 'tasks':         await renderSAAllTasks(el);       break;
    case 'people':        await renderSAPeople(el);         break;
    case 'users':         await renderSAUsers(el);         break;
    case 'products':      await renderSAProducts(el);      break;
    case 'maintenance':   await renderSAMaintenance(el);   break;
    case 'watchdog':      await renderSAWatchdog(el);      break;
  }
}

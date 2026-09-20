/* superadmin/features.js — Feature flag toggles. */

import { db, ref, set } from '../core/firebase.js';
import { FEATURES } from '../data/app-config.js';

/* ══ CIRCUIT BOX — MASTER EDIT PANEL TABS ══════════════════ */

/* ── TAB: FEATURES ──────────────────────────────────────── */
export async function renderSAFeatures(el) {
  const FEATURE_META = [
    { key: 'deadlineAlerts',  label: 'Deadline Alert Engine',   desc: 'Daily cron + manual trigger that emails task owners a running countdown to (or past) their deadline. Now actually stops the cron when off, not just the button.' },
    { key: 'handoverSystem',  label: 'Handover System',         desc: 'Allow product owners to initiate leave handovers with auto-generated briefing packages' },
    { key: 'weeklyLog',       label: 'Weekly Task Log',         desc: 'Per-product weekly log of completed and open tasks, feeds into handover packages' },
    { key: 'documentUploads', label: 'Document Upload Centre',  desc: 'File upload zones per SOP pillar, synced to Google Drive subfolders' },
    { key: 'progressReports', label: 'Progress Reports',        desc: 'Generate and email formatted progress reports to all onboarded stakeholders' },
    { key: 'sharing',         label: 'Product Sharing',         desc: 'Allow product owners to share access with team members at view or edit level' },
    { key: 'calendarView',    label: 'Launch Calendar',         desc: 'Month-grid view of all pillar milestone dates with colour-coded status dots' },
    { key: 'taskTracker',     label: 'Task Tracker',            desc: 'Per-product pillar status table with admin update controls and notes' },
    { key: 'aiEmailComposer', label: 'AI Email Composer',       desc: 'AI-drafted composed emails and thread replies, sent through the Apps Script backend' },
    { key: 'sheetSync',       label: 'Google Sheet Sync',       desc: 'Bidirectional sync between a product\'s tasks and its live Google Sheet — both the push and the 10-minute return poll' },
    { key: 'gccoDashboard',   label: 'Read-only Portfolio Link', desc: 'The GCCO-style shareable, token-gated read-only dashboard link' },
    { key: 'decisionEngine',  label: 'Decision Engine (AI brain)', desc: 'The scheduled reasoning cycle that reads task changes and writes suggestions to the Decisions page' },
    { key: 'aiAsk',           label: 'Ask (AI assistant)',      desc: 'The client-side AI chat on the Ask page, calling Groq/Cerebras/SambaNova directly from the browser' },
  ];

  const rows = FEATURE_META.map(f => {
    const on = FEATURES[f.key] !== false;
    return `<div class="cb-feature-row">
      <div class="cb-feature-info">
        <div class="cb-feature-label">${f.label}</div>
        <div class="cb-feature-desc">${f.desc}</div>
      </div>
      <label class="cb-toggle">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleFeature('${f.key}', this.checked)"/>
        <span class="cb-toggle-track"><span class="cb-toggle-thumb"></span></span>
      </label>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Feature flags</span>
        <span style="font-size:12px;color:var(--text-muted);">Changes take effect immediately — no redeploy needed</span>
      </div>
      <div class="panel-body" style="padding:0;">${rows}</div>
    </div>`;
}

window.toggleFeature = async (key, enabled) => {
  try {
    FEATURES[key] = enabled;
    await set(ref(db, `config/features/${key}`), enabled);
    showToast(`${key} ${enabled ? 'enabled' : 'disabled'}.`, 'success');
  } catch(e) { showToast('Failed: ' + e.message, 'error'); }
};

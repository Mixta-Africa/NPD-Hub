/* superadmin/maintenance.js — Maintenance tools and access log. */

import { db, get, ref, set } from '../core/firebase.js';
import { ICON } from '../core/icons.js';
import { callGAS } from '../core/gas.js';

/* ── TAB 5: MAINTENANCE ──────────────────────────────────── */
export async function renderSAMaintenance(el) {
  el.innerHTML = `
    <div class="two-col">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">GAS reachability test</span></div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-mid);margin-bottom:14px;">Sends a ping to the GAS backend and returns the response.</p>
          <button class="btn-primary" onclick="saPingGAS()">Run ping</button>
          <div id="sa-ping-result" style="margin-top:12px;display:none;"></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">SA access log</span></div>
        <div class="panel-body" id="sa-access-log"><div class="loading-row">Loading...</div></div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px;">
      <div class="panel-header"><span class="panel-title">Danger zone</span></div>
      <div class="panel-body">
        <div class="threshold-row">
          <div>
            <div style="font-size:13px;font-weight:500;">Clear all error logs</div>
            <div style="font-size:12px;color:var(--text-muted);">Permanently deletes all logged errors from Firebase</div>
          </div>
          <button class="btn-danger-sm" onclick="clearErrorLog()">Clear errors</button>
        </div>
        <div class="threshold-row">
          <div>
            <div style="font-size:13px;font-weight:500;">Clear SA access log</div>
            <div style="font-size:12px;color:var(--text-muted);">Clears the record of super admin login attempts</div>
          </div>
          <button class="btn-danger-sm" onclick="saClearAccessLog()">Clear log</button>
        </div>
      </div>
    </div>`;

  // Load SA access log
  loadSAAccessLog();
}

async function loadSAAccessLog() {
  const el   = document.getElementById('sa-access-log');
  if (!el) return;
  const snap = await get(ref(db, 'sa_log'));
  const log  = Object.entries(snap.val() || {}).sort(([a],[b]) => b - a).slice(0,20);
  el.innerHTML = log.length === 0
    ? '<div class="muted" style="font-size:12px;">No access attempts logged.</div>'
    : log.map(([ts, e]) => `
      <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="color:var(--text-muted);">${new Date(parseInt(ts)).toLocaleString('en-GB')}</span>
        <span style="margin-left:8px;font-weight:500;color:${e.action==='SA_LOGIN'?'var(--green)':'var(--red)'};">${e.action}</span>
        <span style="margin-left:8px;color:var(--text-mid);">${e.user}</span>
      </div>`).join('');
}

window.saPingGAS = async () => {
  const btn = document.querySelector('#sa-ping-result').previousElementSibling;
  const res = document.getElementById('sa-ping-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Pinging...'; }
  res.style.display = 'block';
  res.className = 'alert-result-box alert-result-ok';
  res.textContent = 'Waiting for response...';
  try {
    const t0     = Date.now();
    const result = await callGAS('ping', {});
    const ms     = Date.now() - t0;
    res.className = `alert-result-box ${result.ok ? 'alert-result-ok' : 'alert-result-err'}`;
    res.textContent = result.ok ? ICON.check_circle + ` GAS live — ${ms}ms · ${result.message}` : `❌ ${result.error}`;
  } catch(e) {
    res.className = 'alert-result-box alert-result-err';
    res.textContent = '❌ ' + e.message;
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Run ping'; }
};

window.saClearAccessLog = async () => {
  if (!confirm('Clear the SA access log?')) return;
  await set(ref(db, 'sa_log'), null);
  showToast('Access log cleared.', 'success');
  loadSAAccessLog();
};

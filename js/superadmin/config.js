/* superadmin/config.js — System configuration, reset and data export. */

import { db, get, ref, set } from '../core/firebase.js';
import { GAS_ENDPOINT } from '../core/config.js';
import { FEATURES, PILLARS, set_SYS_CONFIG, STAKEHOLDERS, SYS_CONFIG } from '../data/app-config.js';
import { loadSATab } from './index.js';

/* ── TAB: SYSTEM CONFIG ──────────────────────────────────── */
export async function renderSAConfig(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header"><span class="panel-title">System configuration</span></div>
      <div class="panel-body">
        <div class="form-row">
          <label class="form-label">App name</label>
          <input id="cfg-appname" class="input-field" value="${SYS_CONFIG.appName || 'Mixta Africa NPD Hub'}"/>
        </div>
        <div class="form-row">
          <label class="form-label">App subtitle</label>
          <input id="cfg-subtitle" class="input-field" value="${SYS_CONFIG.appSubtitle || 'New Product Development Hub'}"/>
        </div>
        <div class="form-row">
          <label class="form-label">Super admin session timeout <span class="form-hint">— minutes (default: 30)</span></label>
          <input id="cfg-satimeout" class="input-field" type="number" min="5" max="480" value="${SYS_CONFIG.saTimeoutMins || 30}" style="width:120px;"/>
        </div>
        <div class="form-row">
          <label class="form-label">Deadline alerts <span class="form-hint">— schedule and behaviour</span></label>
          <div style="font-size:12px;color:var(--text-mid);background:var(--bg);border-radius:8px;padding:10px 12px;line-height:1.6;">
            Every active task with a deadline gets a daily countdown email — no lead-time threshold to set anymore. The hour it runs is configured on the <a href="#" onclick="loadView('reports');return false;" style="color:var(--red);font-weight:600;">Progress Reports</a> page under "Email schedule," not here.
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">GAS endpoint URL</label>
          <input id="cfg-gas" class="input-field" value="${typeof GAS_ENDPOINT !== 'undefined' ? GAS_ENDPOINT : ''}" style="font-size:11px;font-family:monospace;"/>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Note: changing this here updates Firebase only. The deployed HTML still uses the GitHub Secret — update both if the GAS URL changes.</div>
        </div>
        <div class="form-actions">
          <button class="btn-primary" onclick="saveSystemConfig()">Save configuration</button>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-header"><span class="panel-title">Circuit Box password</span></div>
      <div class="panel-body">
        <p style="font-size:12px;color:var(--text-mid);margin-bottom:14px;line-height:1.6;">
          This used to be a build-time secret with no way to change it short of redeploying the app. It now lives in Firebase — changeable here, or via "Forgot password?" on the login screen, which emails a one-time reset link to whichever admin requests it.
        </p>
        <div class="form-row"><label class="form-label">New password</label>
          <input type="password" id="cfg-sa-newpw" class="input-field" style="max-width:280px;"/></div>
        <div class="form-row"><label class="form-label">Confirm new password</label>
          <input type="password" id="cfg-sa-confirmpw" class="input-field" style="max-width:280px;"/></div>
        <div class="form-actions">
          <button class="btn-primary" onclick="changeSAPasswordFromConfig()">Update password</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Danger zone</span></div>
      <div class="panel-body">
        <div class="threshold-row">
          <div>
            <div style="font-size:13px;font-weight:500;">Reset all config to defaults</div>
            <div style="font-size:12px;color:var(--text-muted);">Rewrites Pillars, Stakeholders, Features and System Config in Firebase back to the built-in defaults</div>
          </div>
          <button class="btn-danger-sm" onclick="resetAllConfig()">Reset defaults</button>
        </div>
        <div class="threshold-row">
          <div>
            <div style="font-size:13px;font-weight:500;">Export all data as JSON</div>
            <div style="font-size:12px;color:var(--text-muted);">Downloads a full snapshot of all products, users, config and logs from Firebase</div>
          </div>
          <button class="btn-secondary-sm" onclick="exportAllData()">Export JSON</button>
        </div>
      </div>
    </div>`;
}

window.saveSystemConfig = async () => {
  const cfg = {
    appName:            document.getElementById('cfg-appname')?.value.trim()  || SYS_CONFIG.appName,
    appSubtitle:        document.getElementById('cfg-subtitle')?.value.trim() || SYS_CONFIG.appSubtitle,
    saTimeoutMins:      parseInt(document.getElementById('cfg-satimeout')?.value) || 30,
    gasEndpointOverride: document.getElementById('cfg-gas')?.value.trim() || '',
  };
  try {
    await set(ref(db, 'config/system'), cfg);
    set_SYS_CONFIG( { ...SYS_CONFIG, ...cfg });
    showToast('System config saved.', 'success');
  } catch(e) { showToast('Save failed: ' + e.message, 'error'); }
};

window.resetAllConfig = async () => {
  if (!confirm('Reset ALL config to built-in defaults? This will overwrite your Firebase config.')) return;
  try {
    await set(ref(db, 'config'), {
      pillars:      PILLARS,
      stakeholders: STAKEHOLDERS,
      features:     FEATURES,
      system:       SYS_CONFIG,
    });
    showToast('Config reset to defaults.', 'success');
    loadSATab('config');
  } catch(e) { showToast('Reset failed: ' + e.message, 'error'); }
};

window.exportAllData = async () => {
  try {
    const snap = await get(ref(db, '/'));
    const data = snap.val();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'npd-hub-export-' + new Date().toISOString().split('T')[0] + '.json';
    a.click(); URL.revokeObjectURL(url);
    showToast('Export downloaded.', 'success');
  } catch(e) { showToast('Export failed: ' + e.message, 'error'); }
};

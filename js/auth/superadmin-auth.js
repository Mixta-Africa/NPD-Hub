/* auth/superadmin-auth.js — Circuit Box (super admin) password challenge, session timeout and password reset. */

import { db, get, ref, set } from '../core/firebase.js';
import { SA_PASSWORD_HASH } from '../core/config.js';
import { sha256 } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentRole, currentUser, currentView, isSuperAdmin, SA_TIMEOUT_MS, set_isSuperAdmin, set_saSessionStart } from '../core/state.js';
import { callGAS } from '../core/gas.js';

/* ════════════════════════════════════════════════════════════
   SUPER ADMIN — Password challenge + session management
════════════════════════════════════════════════════════════ */
window.showSAChallenge = () => {
  if (!currentUser) { showToast('Sign in with your Mixta account first.', 'error'); return; }

  // The password used to be a build-time-only secret with no way to
  // change or reset it short of redeploying the whole app. It's now
  // checked against config/superAdminAuth/hash first (changeable from
  // inside Circuit Box, resettable by email below), falling back to the
  // original hardcoded hash only if that's never been set.
  get(ref(db, 'config/superAdminAuth/hash')).then(snap => {
    window._saHashOverride = snap.exists() ? snap.val() : null;
  }).catch(() => { window._saHashOverride = null; });

  window.toggleSAPasswordVisibility = () => {
    const input = document.getElementById('sa-password-input');
    const btn = document.getElementById('sa-pw-toggle');
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    if (btn) btn.innerHTML = showing
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a19.86 19.86 0 015.06-6.06M9.9 4.24A10.5 10.5 0 0112 4c7 0 11 8 11 8a19.8 19.8 0 01-3.22 4.44M14.12 14.12a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  };

  // Use a dedicated SA modal — does not depend on the product modal being in the DOM
  let modal = document.getElementById('sa-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sa-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
        <div style="background:#C0282D;padding:20px 24px;">
          <div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;">Mixta Africa NPD Hub</div>
          <div style="color:white;font-size:18px;font-weight:700;display:flex;align-items:center;gap:6px;">${ICON.bolt} Super Admin Access</div>
        </div>
        <div style="padding:24px;">
          <p style="font-size:13px;color:#6b6b67;margin-bottom:20px;line-height:1.7;text-align:center;">
            Enter the super admin password to access the circuit box.<br/>
            Session expires after 30 minutes.
          </p>
          <div style="position:relative;margin-bottom:8px;">
            <input type="password" id="sa-password-input" class="input-field"
              placeholder="Password"
              onkeydown="if(event.key==='Enter') verifySAPassword()"
              style="width:100%;text-align:center;letter-spacing:.15em;font-size:16px;padding-right:38px;"/>
            <button type="button" onclick="toggleSAPasswordVisibility()" id="sa-pw-toggle"
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px;display:flex;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div id="sa-error" style="display:none;color:#C0282D;font-size:12px;text-align:center;margin-bottom:12px;"></div>
          <div style="text-align:center;margin-bottom:12px;">
            <a href="#" onclick="requestSAPasswordReset();return false;" style="font-size:11px;color:var(--text-muted);text-decoration:underline;">Forgot password?</a>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn-outline" onclick="closeSAModal()">Cancel</button>
            <button class="btn-primary" onclick="verifySAPassword()">Enter</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('sa-password-input')?.focus(), 100);
};

window.closeSAModal = () => {
  const modal = document.getElementById('sa-modal');
  if (modal) modal.style.display = 'none';
};

// Hidden entry point: the period after "of homes" in the sidebar footer.
// Three taps within 1.5s opens the super admin password challenge — silent otherwise.
let _saTapCount = 0, _saTapTimer = null;
window.__saTapDot = () => {
  _saTapCount++;
  clearTimeout(_saTapTimer);
  if (_saTapCount >= 3) {
    _saTapCount = 0;
    window.showSAChallenge();
    return;
  }
  _saTapTimer = setTimeout(() => { _saTapCount = 0; }, 1500);
};

window.verifySAPassword = async () => {
  const input  = document.getElementById('sa-password-input')?.value || '';
  const errEl  = document.getElementById('sa-error');
  const btn    = document.querySelector('#modal-body-content .btn-primary');

  if (!input) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

  const hash = await sha256(input);

  if (hash === (window._saHashOverride || SA_PASSWORD_HASH)) {
    set_isSuperAdmin( true);
    set_saSessionStart( Date.now());

    // Log the super admin access attempt to Firebase
    try {
      await set(ref(db, `sa_log/${Date.now()}`), {
        user:      currentUser.email,
        action:    'SA_LOGIN',
        timestamp: new Date().toISOString(),
        ip:        'client',
      });
    } catch(e) {}

    closeSAModal();
    showSANav();
    showToast('Super admin session active. 30-minute timeout.', 'success');
    loadView('superadmin');

    // Auto-expire session after 30 minutes
    setTimeout(() => {
      if (isSuperAdmin) {
        set_isSuperAdmin( false);
        set_saSessionStart( null);
        hideSANav();
        showToast('Super admin session expired.', 'info');
        if (currentView === 'superadmin') loadView('dashboard');
      }
    }, SA_TIMEOUT_MS);

  } else {
    // Log failed attempt
    try {
      await set(ref(db, `sa_log/${Date.now()}`), {
        user:      currentUser.email,
        action:    'SA_LOGIN_FAILED',
        timestamp: new Date().toISOString(),
      });
    } catch(e) {}

    if (errEl) { errEl.textContent = 'Incorrect password. Try again.'; errEl.style.display = 'block'; }
    if (btn)   { btn.disabled = false; btn.textContent = 'Enter'; }
    const pwInput = document.getElementById('sa-password-input');
    if (pwInput) { pwInput.value = ''; pwInput.focus(); }
  }
};

window.changeSAPasswordFromConfig = async () => {
  const pw1 = document.getElementById('cfg-sa-newpw')?.value || '';
  const pw2 = document.getElementById('cfg-sa-confirmpw')?.value || '';
  if (pw1.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (pw1 !== pw2) { showToast('Passwords do not match.', 'error'); return; }
  const newHash = await sha256(pw1);
  await set(ref(db, 'config/superAdminAuth/hash'), newHash);
  window._saHashOverride = newHash;
  document.getElementById('cfg-sa-newpw').value = '';
  document.getElementById('cfg-sa-confirmpw').value = '';
  showToast('Circuit Box password updated.', 'success');
};

window.requestSAPasswordReset = async () => {
  if (currentRole !== 'admin') {
    showToast('Only an admin can request a Circuit Box password reset.', 'error');
    return;
  }
  if (!confirm('Send a password reset link to ' + currentUser.email + '?')) return;
  try {
    const res = await callGAS('sendSAPasswordReset', {
      email: currentUser.email,
      name: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0],
    });
    if (res && res.ok) {
      showToast('Reset link sent to ' + currentUser.email + '. Check your inbox.', 'success');
    } else {
      showToast(res?.error || 'Could not send reset link.', 'error');
    }
  } catch(e) {
    showToast('Could not send reset link: ' + e.message, 'error');
  }
};

// The page the reset EMAIL link lands on — verifies the token against
// Firebase (issued and expiry-checked server-side) before letting anyone
// set a new password. This is the ONLY other place besides Circuit
// Box's own "Change password" that can write config/superAdminAuth/hash.
window.showSAPasswordResetForm = async (token) => {
  if (!currentUser) {
    showToast('Sign in first, then reopen the reset link from your email.', 'error');
    return;
  }
  let tokenData = null;
  try {
    const snap = await get(ref(db, 'config/superAdminAuth/resetToken'));
    tokenData = snap.exists() ? snap.val() : null;
  } catch(e) {}

  if (!tokenData || tokenData.token !== token || tokenData.expiresAt < Date.now()) {
    showToast('This reset link is invalid or has expired. Request a new one.', 'error');
    return;
  }
  if (tokenData.email !== currentUser.email) {
    showToast('This reset link was issued to a different account.', 'error');
    return;
  }

  let modal = document.getElementById('sa-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sa-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px;';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="background:#C0282D;padding:20px 24px;">
        <div style="color:white;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px;">Mixta Africa NPD Hub</div>
        <div style="color:white;font-size:18px;font-weight:700;">Set a new Circuit Box password</div>
      </div>
      <div style="padding:24px;">
        <input type="password" id="sa-reset-new" class="input-field" placeholder="New password" style="width:100%;margin-bottom:10px;"/>
        <input type="password" id="sa-reset-confirm" class="input-field" placeholder="Confirm new password" style="width:100%;margin-bottom:14px;"/>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn-outline" onclick="closeSAModal()">Cancel</button>
          <button class="btn-primary" onclick="submitSAPasswordReset('${token}')">Set password</button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';
};

window.submitSAPasswordReset = async (token) => {
  const pw1 = document.getElementById('sa-reset-new')?.value || '';
  const pw2 = document.getElementById('sa-reset-confirm')?.value || '';
  if (pw1.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (pw1 !== pw2) { showToast('Passwords do not match.', 'error'); return; }

  const newHash = await sha256(pw1);
  await set(ref(db, 'config/superAdminAuth/hash'), newHash);
  await set(ref(db, 'config/superAdminAuth/resetToken'), null); // one-time use
  window._saHashOverride = newHash;
  closeSAModal();
  showToast('Circuit Box password updated. Use it next time you sign in.', 'success');
};

window.exitSASession = () => {
  set_isSuperAdmin( false);
  set_saSessionStart( null);
  hideSANav();
  showToast('Super admin session ended.', 'info');
  loadView('dashboard');
};

function showSANav() {
  const el = document.getElementById('nav-superadmin');
  if (el) el.style.display = 'flex';
}

export function hideSANav() {
  const el = document.getElementById('nav-superadmin');
  if (el) el.style.display = 'none';
}

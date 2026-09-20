/* auth/privacy-lock.js — Optional PIN screen lock for My Actions / To-do, stored per user. */

import { db, get, ref, set } from '../core/firebase.js';
import { sha256 } from '../core/utils.js';
import { standaloneRef } from '../views/myactions.js';
import { ensureProductModal } from '../features/product-form.js';

/* ══ PRIVACY LOCK — a screen lock on top of already-private data ══
   Stored nested under standaloneTasks/{userKey}, which Firebase rules
   already restrict to that exact user's own auth token — same trick
   used for the weekly performance log, so this needs no new rules and
   inherits the identical guarantee. Unlocking is per BROWSER SESSION
   (an in-memory flag, never persisted), so a fresh sign-in or a new
   tab always asks again — that's the actual threat this defends
   against: someone else at your already-signed-in computer, not a
   remote attacker who'd be stopped by the database rules regardless. */
function privacyLockRef() { return standaloneRef() + '/_privacyLock'; }

export async function loadPrivacyLockStatus() {
  const el = document.getElementById('privacy-lock-status');
  if (!el) return;
  try {
    const snap = await get(ref(db, privacyLockRef()));
    const lock = snap.exists() ? snap.val() : null;
    if (lock && lock.hash) {
      el.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span style="font-size:13px;color:var(--green);font-weight:600;">&#10003; Lock is on</span>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="btn-outline" style="font-size:11px;padding:6px 12px;" onclick="showSetPrivacyPin(true)">Change PIN</button>' +
            '<button class="btn-danger-sm" onclick="removePrivacyLockPin()">Turn off</button>' +
          '</div>' +
        '</div>';
    } else {
      el.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span style="font-size:13px;color:var(--text-muted);">Not set</span>' +
          '<button class="btn-primary" style="font-size:11px;padding:6px 14px;" onclick="showSetPrivacyPin(false)">Set a PIN</button>' +
        '</div>';
    }
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Could not load lock status.</div>';
  }
}

window.showSetPrivacyPin = (isChange) => {
  ensureProductModal();
  document.getElementById('modal-title-text').textContent = isChange ? 'Change your PIN' : 'Set a PIN';
  document.getElementById('modal-body-content').innerHTML =
    '<div class="form-row"><label class="form-label">4–6 digit PIN</label>' +
      '<input type="password" inputmode="numeric" id="pl-pin1" class="input-field" maxlength="6" placeholder="••••"/></div>' +
    '<div class="form-row"><label class="form-label">Confirm PIN</label>' +
      '<input type="password" inputmode="numeric" id="pl-pin2" class="input-field" maxlength="6" placeholder="••••"/></div>' +
    '<div class="form-actions">' +
      '<button class="btn-outline" onclick="closeProductModal()">Cancel</button>' +
      '<button class="btn-primary" onclick="saveSetPrivacyPin()">Save</button>' +
    '</div>';
  document.getElementById('create-product-modal').style.display = 'flex';
};

window.saveSetPrivacyPin = async () => {
  const pin1 = document.getElementById('pl-pin1')?.value || '';
  const pin2 = document.getElementById('pl-pin2')?.value || '';
  if (!/^\d{4,6}$/.test(pin1)) { showToast('PIN must be 4–6 digits.', 'error'); return; }
  if (pin1 !== pin2) { showToast('PINs do not match.', 'error'); return; }
  const hash = await sha256(pin1);
  await set(ref(db, privacyLockRef()), { hash, updatedAt: Date.now() });
  window._privacyUnlockedViews = window._privacyUnlockedViews || {};
  window._privacyUnlockedViews['myactions'] = true; // no need to immediately re-lock the page you just set this from
  closeProductModal();
  showToast('PIN set. My Actions & To-do is now locked for anyone else on this browser.', 'success');
  loadPrivacyLockStatus();
};

window.removePrivacyLockPin = async () => {
  if (!confirm('Turn off the privacy lock? My Actions & To-do will open without a PIN.')) return;
  await set(ref(db, privacyLockRef()), null);
  showToast('Privacy lock turned off.', 'success');
  loadPrivacyLockStatus();
};

// Called at the top of any view that opts in (currently My Actions &
// To-do). Returns true if the view should render normally; false means
// it showed the PIN prompt instead and the caller should stop.
export async function checkViewLock(viewName) {
  window._privacyUnlockedViews = window._privacyUnlockedViews || {};
  if (window._privacyUnlockedViews[viewName]) return true;
  try {
    const snap = await get(ref(db, privacyLockRef()));
    const lock = snap.exists() ? snap.val() : null;
    if (!lock || !lock.hash) { window._privacyUnlockedViews[viewName] = true; return true; }
    showPrivacyUnlockScreen(viewName, lock.hash);
    return false;
  } catch(e) {
    return true; // fail open — a Firebase hiccup should never permanently lock someone out of their own tasks
  }
}

function showPrivacyUnlockScreen(viewName, expectedHash) {
  const target = document.getElementById('main-content');
  if (!target) return;
  target.innerHTML =
    '<div style="max-width:340px;margin:80px auto;text-align:center;">' +
      '<div style="width:52px;height:52px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-mid)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' +
      '</div>' +
      '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">This is locked</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:18px;">Enter your PIN to continue.</div>' +
      '<input type="password" inputmode="numeric" id="pl-unlock-input" class="input-field" maxlength="6" style="text-align:center;letter-spacing:.3em;font-size:18px;width:160px;margin:0 auto 12px;display:block;" ' +
        'onkeydown="if(event.key===\'Enter\') submitPrivacyUnlock(\'' + viewName + '\',\'' + expectedHash + '\')" autofocus/>' +
      '<div id="pl-unlock-error" style="display:none;color:var(--red);font-size:11px;margin-bottom:12px;">Incorrect PIN.</div>' +
      '<button class="btn-primary" onclick="submitPrivacyUnlock(\'' + viewName + '\',\'' + expectedHash + '\')">Unlock</button>' +
    '</div>';
  document.getElementById('pl-unlock-input')?.focus();
}

window.submitPrivacyUnlock = async (viewName, expectedHash) => {
  const input = document.getElementById('pl-unlock-input');
  const hash = await sha256(input?.value || '');
  if (hash === expectedHash) {
    window._privacyUnlockedViews = window._privacyUnlockedViews || {};
    window._privacyUnlockedViews[viewName] = true;
    loadView(viewName);
  } else {
    const err = document.getElementById('pl-unlock-error');
    if (err) err.style.display = 'block';
    if (input) { input.value = ''; input.focus(); }
  }
};

/* auth/auth.js — Sign-in / sign-out, allowlist check, department selection, access-denied and welcome screens, app shell start-up. */

import { auth, db, get, provider, ref, set, signInWithPopup, signOut } from '../core/firebase.js';
import { sanitiseEmail } from '../core/utils.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentRole, currentUser, currentUserDept, currentView, set_currentRole, set_currentUser, set_currentUserDept, set_isSuperAdmin, set_saSessionStart } from '../core/state.js';
import { hideSANav } from './superadmin-auth.js';
import { routeFromDeepLink } from '../ui/routing.js';
import { detectDeptFromEmail, FEATURES, getDepts, loadAppConfig, seedConfigToFirebase } from '../data/app-config.js';
import { loadTemplatesAndConfig } from '../data/templates.js';
import { startGlobalProductsListener } from '../data/products-cache.js';
import { startDecisionsBadgeListener } from '../views/decisions.js';
import { initGlobalSearch } from '../ui/global-search.js';
import { initUndoShortcut } from '../ui/undo.js';

/* ─── AUTH STATE LISTENER ─── */
/* Auth handler is DEFINED here but REGISTERED at the very end of the module.
   Firebase fires this immediately when a cached session exists — if it runs
   during module evaluation, every `let`/`const` declared further down is still
   in its temporal dead zone and any access throws, killing the whole app with
   a blank screen. Registering last guarantees the module is fully evaluated
   before any auth callback can run. */
export const handleAuthStateChange = async (user) => {
  // Always reset the sign-in button — it was set to loading on click
  setBtnLoading(false);

  if (user) {
    const email = user.email || '';
    const isMixta = email.toLowerCase().endsWith('@mixtafrica.com');

    if (!isMixta) {
      await signOut(auth);
      showAccessDenied(email, false);
      return;
    }

    set_currentUser( user);
    const key = sanitiseEmail(email);

    try {
      // Read or create allowlist entry
      const snap = await get(ref(db, 'allowlist/' + key));
      if (snap.exists()) {
        set_currentRole( snap.val().role || 'member');
      } else {
        set_currentRole( 'member');
        await set(ref(db, 'allowlist/' + key), {
          role: 'member', name: user.displayName || email.split('@')[0],
          email, addedAt: Date.now(), addedBy: 'auto',
        });
      }

      // Read user record to check if dept is already set
      const userSnap = await get(ref(db, 'users/' + key));
      const userData  = userSnap.exists() ? userSnap.val() : null;

      startDecisionsBadgeListener();
      startGlobalProductsListener();
      initGlobalSearch();
      initUndoShortcut();

      if (!userData || !userData.dept) {
        showApp();
        const detectedDept = detectDeptFromEmail(email);
        if (detectedDept && detectedDept !== 'Commercial Strategy') {
          await set(ref(db, 'users/' + key), {
            name: user.displayName || email.split('@')[0],
            email, role: currentRole, dept: detectedDept,
            deptLocked: true, createdAt: Date.now(),
          });
          set_currentUserDept( detectedDept);
          setTimeout(() => showWelcomeModal(detectedDept), 600);
          // Was firing before loadAppConfig() (kicked off inside showApp(),
          // fire-and-forget) had actually resolved — a brand-new user's
          // very first dashboard render could start before config the
          // render depends on was in place. Awaiting it here removes that
          // race for exactly the case it was reported in.
          await loadAppConfig();
          loadView('dashboard');
        } else {
          // showDeptSelectionScreen renders from the DEPARTMENTS global,
          // which starts as a hardcoded 8-entry default and only reflects
          // what's actually configured in Circuit Box once loadAppConfig()
          // has run. Nothing had called it yet on this branch, so a
          // department added later (e.g. Risk and Audit) was invisible to
          // exactly the screen where a new person needs to pick it.
          await loadAppConfig();
          showDeptSelectionScreen(user, key);
        }
      } else {
        set_currentUserDept( userData.dept || '');
        showApp();
        await loadAppConfig();
        routeFromDeepLink();
      }
    } catch(err) {
      // Firebase error — show a clear message rather than spinning forever
      console.error('Auth flow error:', err);
      showLoginError('Sign-in failed: ' + (err.message || 'Could not connect to the database. Please try again.'));
      await signOut(auth);
      showLogin();
    }
  } else {
    set_currentUser( null);
    set_currentRole( null);
    set_currentUserDept( '');
    set_isSuperAdmin( false);
    set_saSessionStart( null);
    showLogin();
  }
};

/* ─── AUTH ACTIONS ─── */
window.handleSignIn = async () => {
  try {
    setBtnLoading(true);
    await signInWithPopup(auth, provider);
  } catch (e) {
    setBtnLoading(false);
    if (e.code !== 'auth/popup-closed-by-user') {
      showLoginError('Sign-in failed. Please try again.');
    }
  }
};

window.handleSignOut = async () => {
  set_isSuperAdmin( false);
  set_saSessionStart( null);
  hideSANav();
  await signOut(auth);
};

function setBtnLoading(loading) {
  const btn = document.getElementById('sign-in-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner-sm"></span> Signing in...'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Sign in with Google';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

/* ─── VIEW TRANSITIONS ─── */
function showLogin() {
  document.getElementById('screen-login').style.display    = 'flex';
  document.getElementById('screen-denied').style.display   = 'none';
  document.getElementById('screen-app').style.display      = 'none';
}

function showDeptSelectionScreen(user, userKey) {
  // Show the app shell but block with a full-screen dept picker
  showApp();
  const overlay = document.createElement('div');
  overlay.id = 'dept-select-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.97);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';

  const depts = getDepts();
  const optionsHtml = depts.map(d =>
    '<button class="dept-pick-btn" onclick="confirmDeptSelection(\'' + d.replace(/'/g, '') + '\',\'' + userKey + '\')" ' +
      'style="text-align:left;padding:12px 18px;border:1px solid var(--border);border-radius:10px;background:#fff;cursor:pointer;font-family:Poppins,sans-serif;font-size:13px;font-weight:500;color:var(--text);transition:all .15s;width:100%;" ' +
      'onmouseover="this.style.borderColor=\'#C0282D\';this.style.color=\'#C0282D\'" ' +
      'onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text)\'">' +
      d +
    '</button>'
  ).join('');

  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;border:1px solid var(--border);padding:36px;max-width:460px;width:100%;">' +
      '<div style="text-align:center;margin-bottom:24px;">' +
        '<div style="width:52px;height:52px;border-radius:12px;background:#FEF2F2;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C0282D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' +
        '</div>' +
        '<div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:6px;">Welcome to the NPD Hub</div>' +
        '<div style="font-size:13px;color:#6B7280;line-height:1.7;">Select your department to continue. This sets your default view and task assignments. This selection is permanent — contact a super admin to change it later.</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">' +
        optionsHtml +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

window.submitAccessRequest = async () => {
  const email  = document.getElementById('denied-email')?.textContent || '';
  const name   = document.getElementById('req-name')?.value.trim() || '';
  const reason = document.getElementById('req-reason')?.value.trim() || '';
  if (!name)   { showToast('Please enter your name', 'error'); return; }
  if (!reason) { showToast('Please enter a reason', 'error'); return; }
  const reqId  = 'req_' + Date.now();
  try {
    await set(ref(db, 'accessRequests/' + reqId), {
      id: reqId, email, name, reason,
      status: 'pending', requestedAt: Date.now(),
    });
    const res = document.getElementById('req-result');
    if (res) { res.style.display = 'block'; res.textContent = 'Request submitted. An admin will review it and contact you.'; }
    document.getElementById('req-name').value = '';
    document.getElementById('req-reason').value = '';
  } catch(e) {
    showToast('Could not submit request. Please email an admin directly.', 'error');
  }
};

window.confirmDeptSelection = async (dept, userKey) => {
  const overlay = document.getElementById('dept-select-overlay');
  if (overlay) {
    // Update the button to show loading
    const btns = overlay.querySelectorAll('.dept-pick-btn');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  }
  try {
    await set(ref(db, 'users/' + userKey), {
      name:       currentUser.displayName || currentUser.email.split('@')[0],
      email:      currentUser.email,
      role:       currentRole,
      dept:       dept,
      deptLocked: true,
      createdAt:  Date.now(),
    });
    set_currentUserDept( dept);
    if (overlay) overlay.remove();
    setTimeout(() => showWelcomeModal(dept), 300);
    loadView('dashboard');
  } catch(e) {
    showToast('Could not save department. Please try again.', 'error');
    const overlay2 = document.getElementById('dept-select-overlay');
    if (overlay2) {
      const btns = overlay2.querySelectorAll('.dept-pick-btn');
      btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    }
  }
};

function showAccessDenied(email, isMixta) {
  document.getElementById('screen-login').style.display    = 'none';
  document.getElementById('screen-denied').style.display   = 'flex';
  document.getElementById('screen-app').style.display      = 'none';
  document.getElementById('denied-email').textContent      = email;
  const reqSection = document.getElementById('denied-request-section');
  if (reqSection) reqSection.style.display = 'block';
}

function showApp() {
  document.getElementById('screen-login').style.display    = 'none';
  document.getElementById('screen-denied').style.display   = 'none';
  document.getElementById('screen-app').style.display      = 'flex';

  // Ensure global floating refresh button exists
  if (!document.getElementById('global-refresh-btn')) {
    const btn = document.createElement('button');
    btn.id = 'global-refresh-btn';
    btn.innerHTML = ICON.refresh;
    btn.title = "Refresh current view";
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;background:#C0282D;color:#fff;border:none;box-shadow:0 4px 12px rgba(192,40,45,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9000;transition:all 0.2s;';
    btn.onmouseover = () => btn.style.transform = 'scale(1.08)';
    btn.onmouseout = () => btn.style.transform = 'scale(1)';
    btn.onclick = () => {
      btn.innerHTML = '<span class="spinner-sm"></span>';
      setTimeout(() => { 
        loadView(currentView); 
        btn.innerHTML = ICON.refresh; 
      }, 600);
    };
    document.body.appendChild(btn);
  }

  // Populate user info in new global header
  const userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.textContent = currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0];

  const userAvatarEl = document.getElementById('user-avatar');
  if (userAvatarEl) userAvatarEl.textContent = (currentPreferredName || currentUser.displayName || currentUser.email)[0].toUpperCase();

  // We write the department/role into the subtitle slot
  const userRoleEl = document.getElementById('user-email'); 
  if (userRoleEl) {
    userRoleEl.textContent = currentUserDept 
      ? `${currentUserDept} · ${currentRole === 'admin' ? 'Admin' : 'Member'}` 
      : (currentRole === 'admin' ? 'Admin' : 'Member');
  }

  // Show/hide admin-only nav items
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = currentRole === 'admin' ? 'flex' : 'none';
  });

  // Super admin nav — always hidden until SA session active
  const saNav = document.getElementById('nav-superadmin');
  if (saNav) saNav.style.display = 'none';

  // Load all app config, templates, and team members
  loadAppConfig().then(() => {
    seedConfigToFirebase();
    // Feature-gated nav items — hide the ones a Circuit Box toggle has
    // turned off. Applied after config load since FEATURES isn't real
    // until then; the admin-only gate above already ran and stays
    // independent of this (a toggle-off shouldn't grant back something
    // a role restriction hid, only hide further).
    const navByView = { calendar: 'calendarView', tracker: 'taskTracker', ask: 'aiAsk', decisions: 'decisionEngine' };
    Object.entries(navByView).forEach(([view, flag]) => {
      const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (navEl && FEATURES[flag] === false) navEl.style.display = 'none';
    });
  });
  loadTemplatesAndConfig();
  // --- DAILY BACKGROUND PING TEST ---
  if (currentRole === 'admin') {
    const todayStr = new Date().toISOString().split('T')[0];
    get(ref(db, 'config/last_auto_ping')).then(snap => {
      if (!snap.exists() || snap.val() !== todayStr) {
        console.log("Initiating daily background ping test...");
        // Delay by 5 seconds so it doesn't slow down the initial dashboard load
        setTimeout(() => { 
          if (window.runComprehensivePingTest) window.runComprehensivePingTest(true); 
        }, 5000);
      }
    }).catch(()=>console.warn("Ping test check failed."));
  }
  const userKey = sanitiseEmail(currentUser.email);
  get(ref(db, `users/${userKey}`)).then(snap => {
    if (!snap.exists()) {
      const detectedDept = detectDeptFromEmail(currentUser.email);
      set(ref(db, `users/${userKey}`), {
        name:      currentUser.displayName || currentUser.email.split('@')[0],
        email:     currentUser.email,
        role:      currentRole,
        dept:      detectedDept,
        createdAt: Date.now(),
      });
      setTimeout(() => showWelcomeModal(detectedDept), 800);
    }
  });
}

function showWelcomeModal(detectedDept) {
  const firstName = (currentUser.displayName || currentUser.email).split(' ')[0];
  const deptLine  = detectedDept && detectedDept !== 'Commercial Strategy'
    ? '<br><br>We\'ve detected you\'re in <strong>' + detectedDept + '</strong> — tasks assigned to your department will appear in your action queue.'
    : '';
  const overlay = document.createElement('div');
  overlay.id = 'welcome-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:40px 36px;max-width:480px;width:100%;text-align:center;">' +
      '<div style="display:flex;justify-content:center;gap:32px;margin-bottom:28px;">' +
        // Step 1 icon — compass/track
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">' +
          '<div style="width:52px;height:52px;border-radius:12px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C0282D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' +
          '</div>' +
          '<span style="font-size:11px;color:#6B7280;font-weight:500;">Track</span>' +
        '</div>' +
        // Step 2 icon — team/share
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">' +
          '<div style="width:52px;height:52px;border-radius:12px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' +
          '</div>' +
          '<span style="font-size:11px;color:#6B7280;font-weight:500;">Collaborate</span>' +
        '</div>' +
        // Step 3 icon — launch/rocket
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">' +
          '<div style="width:52px;height:52px;border-radius:12px;background:#EFF6FF;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><line x1="9" y1="15" x2="9.01" y2="15"/></svg>' +
          '</div>' +
          '<span style="font-size:11px;color:#6B7280;font-weight:500;">Launch</span>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:22px;font-weight:700;color:#1A1A1A;margin-bottom:10px;">Welcome, ' + firstName + '.</div>' +
      '<div style="font-size:13px;color:#6B7280;line-height:1.7;margin-bottom:28px;">' +
        'This is the Mixta Africa NPD Hub — your team\'s central workspace for tracking every product from idea to launch.' +
        '<br><br>You\'ll see products you own or have been shared on, your personal action queue, and team deadlines — all in one place.' +
        deptLine +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<button onclick="dismissWelcome(\'dashboard\')" style="background:#C0282D;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:13px;font-weight:600;font-family:Poppins,sans-serif;cursor:pointer;">Go to my dashboard</button>' +
        '<button onclick="dismissWelcome(\'myactions\')" style="background:#F8F8F7;color:#1A1A1A;border:1px solid #E5E5E3;border-radius:8px;padding:12px 20px;font-size:13px;font-weight:500;font-family:Poppins,sans-serif;cursor:pointer;">See what needs my attention</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

window.dismissWelcome = (dest) => {
  const el = document.getElementById('welcome-overlay');
  if (el) el.remove();
  loadView(dest || 'dashboard');
};

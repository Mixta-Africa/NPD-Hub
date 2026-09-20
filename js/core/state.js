/* core/state.js — Shared session state: signed-in user, role, department, current view, Circuit Box session. */

/* ─── STATE ─── */
export let currentUser      = null;
export let currentRole      = null;      // 'admin' | 'member' | null
export let currentUserDept  = '';        // set at login from /users/{key}/dept — drives dept scoping

// Declared HERE, not next to loadPreferredName. Firebase's auth callback can
// fire during module evaluation with a cached session; anything touching this
// before its `let` had run threw a temporal-dead-zone error and killed the app.
export let currentPreferredName = '';
export let currentView      = 'dashboard';
export let isSuperAdmin     = false;     // true after password challenge passed
export let saSessionStart   = null;      // timestamp of super admin session start
export const SA_TIMEOUT_MS  = 30 * 60 * 1000; // 30-minute super admin session timeout

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_currentPreferredName(v) { currentPreferredName = v; }
export function set_currentRole(v) { currentRole = v; }
export function set_currentUser(v) { currentUser = v; }
export function set_currentUserDept(v) { currentUserDept = v; }
export function set_currentView(v) { currentView = v; }
export function set_isSuperAdmin(v) { isSuperAdmin = v; }
export function set_saSessionStart(v) { saSessionStart = v; }

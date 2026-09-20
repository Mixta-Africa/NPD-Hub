/* core/error-log.js — Global error capture that feeds the Circuit Box error log. */

import { db, ref, set } from './firebase.js';
import { currentUser, currentView } from './state.js';

// Global error capture — feeds the SA error log
// Guard flag prevents infinite loop when Firebase write itself fails
let _errorLogging = false;

window.addEventListener('error', async (e) => {
  if (_errorLogging) return;
  _errorLogging = true;
  try {
    await set(ref(db, `errors/${Date.now()}`), {
      message:   e.message || 'Unknown error',
      source:    e.filename || '',
      line:      e.lineno || 0,
      col:       e.colno  || 0,
      user:      currentUser?.email || 'unauthenticated',
      view:      currentView || 'unknown',
      timestamp: new Date().toISOString(),
      stack:     e.error?.stack?.slice(0, 500) || '',
    });
  } catch(_) { /* silently ignore — Firebase rules may not allow /errors/ writes yet */ }
  finally { _errorLogging = false; }
});

window.addEventListener('unhandledrejection', async (e) => {
  if (_errorLogging) return;
  _errorLogging = true;
  try {
    await set(ref(db, `errors/${Date.now()}`), {
      message:   e.reason?.message || String(e.reason) || 'Unhandled rejection',
      source:    'promise',
      user:      currentUser?.email || 'unauthenticated',
      view:      currentView || 'unknown',
      timestamp: new Date().toISOString(),
      stack:     e.reason?.stack?.slice(0, 500) || '',
    });
  } catch(_) { /* silently ignore */ }
  finally { _errorLogging = false; }
});

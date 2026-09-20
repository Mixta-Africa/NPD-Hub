/* core/listeners.js — Registry of live Firebase onValue() listeners so they can be torn down on view change or sign-out. */

/* ── REAL-TIME LISTENER REGISTRY ─────────────────────────────
   Store active onValue() unsubscribe functions so we can
   tear them down cleanly when switching views.             */
const _listeners = {};

export function registerListener(key, unsub) {
  if (_listeners[key]) { _listeners[key](); } // tear down previous
  _listeners[key] = unsub;
}

function teardownListener(key) {
  if (_listeners[key]) { _listeners[key](); delete _listeners[key]; }
}

export function teardownAllListeners() {
  Object.keys(_listeners).forEach(teardownListener);
}

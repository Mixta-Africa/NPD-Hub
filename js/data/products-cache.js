/* data/products-cache.js — Shared live cache of all products (one listener feeds every view). */

import { db, get, onValue, ref } from '../core/firebase.js';
import { currentView } from '../core/state.js';
import { _dashRefreshTimer, refreshDashboardUI, set_dashRefreshTimer } from '../views/dashboard.js';
import { loadProductList } from '../views/products.js';

let _productsCacheReady = false;
let _productsListenerUnsub = null;

/* ══ ONE PERSISTENT PRODUCTS LISTENER FOR THE WHOLE SESSION ═══
   Previously: 21 separate places each did their own get(ref(db,'products'))
   -- a full fresh download of the entire tree (every task, comment,
   activity log, weekly log, across every product) on every single pane
   open. The dashboard DID keep a live copy in productListCache, but
   loadView()'s teardownAllListeners() killed that listener the instant
   you navigated away, so every other view had no choice but to re-fetch
   fresh to guarantee correctness.

   Fix: start this listener ONCE at login, deliberately outside the
   registerListener()/teardownAllListeners() system, so it survives every
   navigation for the rest of the session. productListCache is now always
   current everywhere, and getProductsFresh() below is what the 21 call
   sites use instead of fetching for themselves. */
export function startGlobalProductsListener() {
  if (_productsListenerUnsub) return; // already running -- never double up
  _productsListenerUnsub = onValue(ref(db, 'products'), snap => {
    productListCache = snap.val() || {};
    _productsCacheReady = true;

    // Debounced, not immediate -- a burst of near-simultaneous writes
    // (bulk edit, sheet sync, several people editing at once) collapses
    // into one re-render instead of one per write.
    clearTimeout(_dashRefreshTimer);
    set_dashRefreshTimer( setTimeout(() => {
      if (currentView === 'dashboard' && typeof refreshDashboardUI === 'function') refreshDashboardUI();
      if (currentView === 'products' && typeof loadProductList === 'function') loadProductList(true);
    }, 300));
  }, { onlyOnce: false });
}

// The universal replacement for every `get(ref(db,'products'))` call site.
// Returns the live cache instantly once the listener's first snapshot has
// landed; only touches the network itself on the rare first call before
// that snapshot arrives (or if the listener failed to start for some
// reason -- fails safe rather than fails silent).
export async function getProductsFresh() {
  if (_productsCacheReady) return productListCache;
  const snap = await get(ref(db, 'products'));
  productListCache = snap.val() || {};
  _productsCacheReady = true;
  return productListCache;
}

/* ── PRODUCTS VIEW ── */
export let productListCache = {};

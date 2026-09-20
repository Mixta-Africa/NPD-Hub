/* superadmin/watchdog.js — Data-integrity watchdog: scan and repair. */

import { db, get, ref, set } from '../core/firebase.js';
import { pillarsToTasks } from '../data/product-model.js';
import { formatDate } from '../data/status.js';
import { getProductsFresh, productListCache } from '../data/products-cache.js';
import { trackerProductsCache } from '../views/tracker.js';

/* ══ ENTERPRISE STATE RECONCILIATION ENGINE (THE WATCHDOG) ══════════════ */
export async function renderSAWatchdog(el) {
  el.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-header">
        <span class="panel-title" style="display:flex;align-items:center;gap:8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Strict State Reconciler
        </span>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
          <div style="background:#FAFAF9;padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">DAG Integrity</div>
            <div style="font-size:11px;color:var(--text-mid);">Detects circular loops, ghost links, and rendering paradoxes.</div>
          </div>
          <div style="background:#FAFAF9;padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Deep Parity</div>
            <div style="font-size:11px;color:var(--text-mid);">Strict JSON equality diffing between UI Heap and DB nodes.</div>
          </div>
          <div style="background:#FAFAF9;padding:12px;border:1px solid var(--border);border-radius:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Chronological Rules</div>
            <div style="font-size:11px;color:var(--text-mid);">Flags timeline impossibilities (child deadline before parent).</div>
          </div>
        </div>
        <button class="btn-primary" id="watchdog-btn" onclick="runWatchdogScan()" style="width:100%;font-size:13px;padding:12px;">Execute Deep Scan</button>
      </div>
    </div>
    <div id="watchdog-results"></div>`;
}

// Order-independent deep equality — JSON.stringify() string comparison
// (what this used to be) treats {a:1,b:2} and {b:2,a:1} as different, and
// this codebase mutates cached task/product objects in place constantly
// (every edit does `task.title = x; task.deadline = y;` directly on the
// cached object), which reorders keys without changing any real data.
// That made the old check fire false positives on completely healthy
// state, which is exactly what "diagnostic ability is faulty" describes.
function watchdogDeepEqual(a, b, skipKeys) {
  skipKeys = skipKeys || ['updatedAt'];
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a).filter(k => !skipKeys.includes(k));
  const keysB = Object.keys(b).filter(k => !skipKeys.includes(k));
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && watchdogDeepEqual(a[k], b[k], skipKeys));
}

window.runWatchdogScan = async () => {
  const btn = document.getElementById('watchdog-btn');
  const res = document.getElementById('watchdog-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning Virtual Tree vs Database...'; }
  if (res) res.innerHTML = '<div class="loading-row">Analyzing architecture...</div>';

  try {
    const [masterData, stkSnap, deptSnap] = await Promise.all([
      getProductsFresh(),
      get(ref(db, 'config/stakeholders')),
      get(ref(db, 'config/departments'))
    ]);
    
    const liveStakeholders = Array.isArray(stkSnap.val()) ? stkSnap.val() : Object.values(stkSnap.val() || {});
    const liveDepts = Object.keys(deptSnap.val() || {});
    
    const validEmails = liveStakeholders.map(s => (s.email || '').toLowerCase());
    const anomalies = [];

    Object.entries(masterData).forEach(([productId, masterProd]) => {
      if (masterProd.status === 'archived') return;

      const masterTasks = masterProd.tasks ? Object.values(masterProd.tasks) : (masterProd.pillars ? pillarsToTasks(masterProd.pillars) : []);
      const localProd = productListCache[productId] || (typeof trackerProductsCache !== 'undefined' ? trackerProductsCache[productId] : null);

      // --- CHECK 1: DEEP CACHE DRIFT ---
      if (localProd) {
        if (!watchdogDeepEqual(localProd, masterProd)) {
          anomalies.push({ level: 'critical', type: 'cache-drift', prod: masterProd.name, issue: `Browser memory heap differs from database. UI is displaying stale/mutated state.`, fixable: true, fixAction: `watchdogSyncCache('${productId}')`, fixLabel: 'Force Pull Data' });
        }
      }

      // --- CHECK 2: CIRCULAR DEPENDENCIES (DAG FRACTURE) ---
      const adjList = {};
      masterTasks.forEach(t => adjList[t.id] = t.predecessors || []);
      
      const visited = new Set();
      const recStack = new Set();
      let cycleFound = false;

      const detectCycle = (nodeId) => {
        if (recStack.has(nodeId)) return true;
        if (visited.has(nodeId)) return false;
        visited.add(nodeId);
        recStack.add(nodeId);
        for (const neighbor of (adjList[nodeId] || [])) {
          if (detectCycle(neighbor)) return true;
        }
        recStack.delete(nodeId);
        return false;
      };

      masterTasks.forEach(t => {
        if (!cycleFound && detectCycle(t.id)) {
          cycleFound = true;
          anomalies.push({ level: 'critical', type: 'dag-cycle', prod: masterProd.name, issue: `Infinite loop detected involving "${t.title}". Tasks depend on each other cyclically, breaking Gantt and Map rendering.`, fixable: true, fixAction: `watchdogWipeLinks('${productId}')`, fixLabel: 'Wipe Project Links' });
        }
      });

      masterTasks.forEach(task => {
        // --- CHECK 3: GHOST LINKS ---
        if (task.predecessors && task.predecessors.length > 0) {
          task.predecessors.forEach(pid => {
            const predExists = masterTasks.find(t => t.id === pid);
            if (!predExists) {
              anomalies.push({ level: 'warning', type: 'ghost-link', prod: masterProd.name, issue: `Task "${task.title}" waits on a deleted task (${pid}). Causes permanent false blockages.`, fixable: true, fixAction: `watchdogFixGhost('${productId}', '${task.id}', '${pid}')`, fixLabel: 'Sever Ghost Link' });
            } else if (task.deadline && predExists.deadline) {
              // --- CHECK 4: CHRONOLOGICAL PARADOX ---
              const tDate = new Date(task.deadline).setHours(0,0,0,0);
              const pDate = new Date(predExists.deadline).setHours(0,0,0,0);
              if (pDate > tDate) {
                anomalies.push({ level: 'warning', type: 'time-paradox', prod: masterProd.name, issue: `Timeline impossible. "${task.title}" is due ${formatDate(task.deadline)}, but waits on "${predExists.title}" due LATER (${formatDate(predExists.deadline)}).` });
              }
            }
          });
        }

        // --- CHECK 5: ORPHANED RESOURCES ---
        if (task.ownerEmail && !validEmails.includes(task.ownerEmail.toLowerCase())) {
          anomalies.push({ level: 'info', type: 'orphaned-owner', prod: masterProd.name, issue: `Task "${task.title}" assigned to ${task.ownerEmail}, who no longer exists in the Stakeholders directory.` });
        }

        // --- CHECK 6: SCHEMA CONFLICTS ---
        if (task.status === 'complete' && task.taskStatus && task.taskStatus !== 'complete') {
          anomalies.push({ level: 'warning', type: 'schema-conflict', prod: masterProd.name, issue: `Task "${task.title}" has conflicting completion markers between UI schema and Legacy schema.`, fixable: true, fixAction: `watchdogFixSchema('${productId}', '${task.id}')`, fixLabel: 'Align Schema' });
        }
      });
      
      // --- CHECK 7: MACRO STATUS HALLUCINATIONS ---
      const allComplete = masterTasks.length > 0 && masterTasks.every(t => t.status === 'complete');
      if (allComplete && masterProd.status === 'active') {
         anomalies.push({ level: 'info', type: 'status-hallucination', prod: masterProd.name, issue: `Project is 100% complete but still marked 'Active' in database.`, fixable: true, fixAction: `watchdogArchiveProd('${productId}')`, fixLabel: 'Archive Project' });
      }
    });

    // Render Results
    if (anomalies.length === 0) {
      res.innerHTML = '<div class="alert-result-box alert-result-ok" style="display:block;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom;margin-right:4px;"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Architecture Clean. Zero anomalies detected in DAG, Caches, or Timeline.</div>';
    } else {
      const colors = { critical: 'var(--red)', warning: 'var(--amber)', info: 'var(--blue)' };
      const bgs = { critical: '#FEF2F2', warning: '#FFFBEB', info: '#EFF6FF' };
      
      res.innerHTML = `<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">${anomalies.length} Architecture Anomalies Detected</div>` +
        anomalies.sort((a,b) => a.level === 'critical' ? -1 : 1).map(a => `
        <div style="background:${bgs[a.level]};border:1px solid ${colors[a.level]}40;border-left:4px solid ${colors[a.level]};border-radius:6px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10px;font-weight:800;color:${colors[a.level]};text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">[${a.type}] &middot; ${a.prod}</div>
            <div style="font-size:12px;color:var(--text);line-height:1.5;">${a.issue}</div>
          </div>
          ${a.fixable ? `<button class="btn-outline" style="border-color:${colors[a.level]};color:${colors[a.level]};font-size:10px;padding:5px 10px;margin-left:12px;flex-shrink:0;" onclick="${a.fixAction}">${a.fixLabel}</button>` : ''}
        </div>
      `).join('');
    }
  } catch (e) {
    res.innerHTML = `<div class="alert-result-box alert-result-err" style="display:block;">Scan Failed: ${e.message}</div>`;
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Execute Deep Scan'; }
};

/* --- WATCHDOG AUTO-FIXERS --- */
window.watchdogSyncCache = async (productId) => {
  const snap = await get(ref(db, `products/${productId}`));
  if (snap.exists()) {
    productListCache[productId] = snap.val();
    if (typeof trackerProductsCache !== 'undefined') trackerProductsCache[productId] = snap.val();
    showToast('Cache memory forced to equal Database.', 'success');
    runWatchdogScan();
  }
};

window.watchdogWipeLinks = async (productId) => {
  if (!confirm("This will remove all 'Depends On' links in this project to break the infinite loop. Continue?")) return;
  const snap = await get(ref(db, `products/${productId}/tasks`));
  const tasks = snap.val() || {};
  const updates = {};
  Object.keys(tasks).forEach(tid => updates[`products/${productId}/tasks/${tid}/predecessors`] = []);
  await Promise.all(Object.entries(updates).map(([path, val]) => set(ref(db, path), val)));
  showToast('DAG Cycles broken.', 'success');
  runWatchdogScan();
};

window.watchdogFixGhost = async (productId, taskId, ghostId) => {
  const snap = await get(ref(db, `products/${productId}/tasks/${taskId}/predecessors`));
  let preds = snap.val() || [];
  preds = preds.filter(id => id !== ghostId);
  await set(ref(db, `products/${productId}/tasks/${taskId}/predecessors`), preds);
  showToast('Ghost link severed.', 'success');
  runWatchdogScan();
};

window.watchdogFixSchema = async (productId, taskId) => {
  await set(ref(db, `products/${productId}/tasks/${taskId}/taskStatus`), 'complete');
  showToast('Schema synchronized.', 'success');
  runWatchdogScan();
};

window.watchdogArchiveProd = async (productId) => {
  await set(ref(db, `products/${productId}/status`), 'archived');
  showToast('Project Archived.', 'success');
  runWatchdogScan();
};

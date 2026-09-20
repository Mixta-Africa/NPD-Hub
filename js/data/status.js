/* data/status.js — Task and project status logic: effective status, predictions, status metadata, date formatting. */

import { canViewTask } from './permissions.js';
import { getProductTasks } from './product-model.js';

// ── SMART FORECAST ENGINE ──────────────────────────────────────
export function computeProjectPrediction(prod) {
  // Privacy gate: the forecast surfaces bottleneck TASK TITLES, so it must be
  // computed only from tasks this viewer is entitled to see. Without this a
  // member of one department reads another department's private task names
  // straight out of the prediction panel.
  const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
  if (!tasks || tasks.length === 0) return { delayDays: 0, probability: 0, predictedDate: prod.launchDate, bottlenecks: [] };

  const today = new Date();
  today.setHours(0,0,0,0);

  const taskNodes = {};
  let delayedCount = 0;

  // 1. Initialize nodes with actual delays
  tasks.forEach(t => {
    let ownDelay = 0;
    const eff = resolveTaskStatus(t, prod);

    if (eff === 'overdue') {
      if (t.deadline) {
        const due = new Date(t.deadline); due.setHours(0,0,0,0);
        ownDelay = Math.max(0, Math.round((today - due) / 86400000));
      } else {
        ownDelay = 3; // Minimal assumed penalty for missing dates
      }
      delayedCount++;
    } else if (eff === 'delayed') {
      ownDelay = 7; // Fixed penalty for tasks manually marked delayed
      delayedCount++;
    }

    // Initialize graph node
    taskNodes[t.id] = { ...t, ownDelay, inheritedDelay: 0, totalDelay: ownDelay, drivingPredecessor: null };
  });

  // 2. Cascade delays (Topological sort/propagation)
  for (let i = 0; i < tasks.length; i++) {
    let changed = false;
    tasks.forEach(t => {
      const node = taskNodes[t.id];
      let maxPredDelay = 0;
      let driver = null;
      
      (t.predecessors || []).forEach(pid => {
        if (taskNodes[pid] && taskNodes[pid].totalDelay > maxPredDelay) {
          maxPredDelay = taskNodes[pid].totalDelay;
          driver = pid;
        }
      });
      
      if (maxPredDelay > node.inheritedDelay) {
        node.inheritedDelay = maxPredDelay;
        node.totalDelay = node.ownDelay + node.inheritedDelay;
        node.drivingPredecessor = driver; // Track the bottleneck!
        changed = true;
      }
    });
    if (!changed) break; // Optimization: stop if graph is settled
  }

  // 3. Identify the maximum delay and the end node of the critical path
  let maxDelay = 0;
  let endNode = null;
  Object.values(taskNodes).forEach(node => {
    if (node.totalDelay > maxDelay) {
      maxDelay = node.totalDelay;
      endNode = node;
    }
  });

  // Trace back the critical path bottlenecks
  const bottlenecks = [];
  let curr = endNode;
  while (curr) {
    if (curr.ownDelay > 0) {
      bottlenecks.push({ name: curr.title || curr.name, delay: curr.ownDelay });
    }
    curr = curr.drivingPredecessor ? taskNodes[curr.drivingPredecessor] : null;
  }

  // 4. Calculate Risk Probability (PM Best Practice: Schedule Performance Index proxy)
  const completeCount = tasks.filter(t => resolveTaskStatus(t, prod) === 'complete').length;
  const progress = tasks.length ? (completeCount / tasks.length) : 0;
  
  let riskScore = 0;
  if (tasks.length > 0) {
    riskScore = (delayedCount / tasks.length) * 50; // Base risk from delayed tasks
    if (maxDelay > 0) riskScore += Math.min(40, maxDelay * 2); // 2% per day of slip, up to 40%
    if (progress > 0.8) riskScore -= 10; // Mitigate risk if project is heavily completed
    riskScore = Math.max(5, Math.min(95, Math.round(riskScore))); 
  }

  // 5. Calculate new projected date
  let predictedDate = prod.launchDate;
  if (prod.launchDate && maxDelay > 0) {
    const launch = new Date(prod.launchDate);
    launch.setDate(launch.getDate() + maxDelay);
    predictedDate = launch.toISOString().split('T')[0];
  }

  return { 
    delayDays: maxDelay, 
    probability: riskScore, 
    predictedDate: predictedDate || null, 
    bottlenecks: bottlenecks.reverse() 
  };
}

// ───────────────────────────────────────────────────────────────
export function getPillarStatus(deadline) {
  // Date-only check — used where we only have a deadline string
  if (!deadline) return 'no-date';
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(deadline); due.setHours(0,0,0,0);
  const diff  = Math.round((due - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff <= 3) return 'warning';
  return 'ontrack';
}

// Full task status — always prefer this over getPillarStatus when you have the task object
// Returns: 'complete' | 'delayed' | 'overdue' | 'due-soon' | 'blocked' | 'on-track'
function getTaskEffectiveStatus(task, prod) {
  const s = task.status; // Guaranteed to be clean by the Reducer
  if (s === 'complete') return 'complete';
  if (s === 'delayed')  return 'delayed';
  if (s === 'in-progress') return 'in-progress';
  if (s === 'deprioritized') return 'deprioritized';

  // FAST BLOCKED CHECK: direct O(1) lookups into the raw task/pillar
  // dictionaries — NOT getProductTasks(prod), which rebuilds and re-sorts
  // the whole product's task list on every single call. This function
  // runs up to 3x per task across every view that counts task statuses,
  // so that rebuild was turning an O(N) stat count into O(N²) per product.
  if (prod && task.predecessors && task.predecessors.length > 0) {
    const isBlocked = task.predecessors.some(pid => {
      const pred = (prod.tasks && prod.tasks[pid]) || (prod.pillars && prod.pillars[pid]);
      return pred && (pred.status || pred.taskStatus || 'on-track') !== 'complete';
    });
    if (isBlocked) return 'blocked';
  }

  if (!task.deadline)   return 'on-track';
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(task.deadline); due.setHours(0,0,0,0);
  const diff  = Math.round((due - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff <= 3) return 'due-soon';
  return 'on-track';
}

/* ── UNIFIED STATUS RESOLVER ────────────────────────────────── */
export function resolveTaskStatus(task, prod) {
  return getTaskEffectiveStatus(task, prod);
}

// Colour + label lookup — used by every status pill/dot on the dashboard
export const STATUS_META = {
  'complete':    { label: 'Complete',    color: 'var(--blue)',  cls: 'st-complete'  },
  'delayed':     { label: 'Delayed',     color: 'var(--red)',   cls: 'st-delayed'   },
  'overdue':     { label: 'Overdue',     color: 'var(--red)',   cls: 'st-overdue'   },
  'due-soon':    { label: 'Due soon',    color: 'var(--amber)', cls: 'st-due-soon'  },
  'blocked':     { label: 'Blocked',     color: '#D97706',      cls: 'st-blocked'   },
  'on-track':    { label: 'On track',    color: 'var(--green)', cls: 'st-on-track'  },
  'in-progress': { label: 'In Progress', color: '#2563EB',      cls: 'st-in-progress'},
  'deprioritized': { label: 'Stepped down', color: '#6B7280',   cls: 'st-deprioritized' },
};
function statusMeta(task, prod) { return STATUS_META[resolveTaskStatus(task, prod)] || STATUS_META['on-track']; }

export function statusLabel(s) {
  return { ontrack: 'On track', warning: 'Due soon', overdue: 'Overdue', 'no-date': 'No date set', 'complete': 'Complete', 'not-started': 'Not started', 'in-progress': 'In progress' }[s] || s;
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* data/product-model.js — Product/task data helpers: id generation, legacy pillar to task conversion, auto-lock. */

import { db, ref, set } from '../core/firebase.js';
import { PILLARS, STAKEHOLDERS } from './app-config.js';
import { isProductLocked } from './permissions.js';
import { productListCache } from './products-cache.js';

let _taskCounter     = 0;    // for generating temp task IDs

export function generateTaskId() {
  return 'task_' + Date.now() + '_' + (++_taskCounter);
}

// Product/project id — used by saveProduct() for a brand-new item. Same
// shape as generateTaskId but doesn't share its counter, since a product
// save isn't tied to the task-editing session that counter tracks.
export function generateId() {
  return 'prod_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

export function pillarsToTasks(pillars) {
  // Convert legacy pillar map to task array
  return PILLARS.map((pl, i) => {
    const pd = pillars?.[pl.id] || {};
    return {
      id:          pl.id,
      title:       pl.name,
      description: '',
      owner:       pl.owner,
      ownerEmails: STAKEHOLDERS.filter(s => s.enabled !== false && (s.pillarIds||[]).includes(pl.id)).map(s => s.email),
      deadline:    pd.deadline || '',
      startDate:   '',
      status:      pd.taskStatus || 'on-track',
      notes:       pd.notes || '',
      predecessors:[],
      locked:      false,
      pillarId:    pl.id,
      order:       i,
      kanbanCol:   pd.taskStatus === 'complete' ? 'done' : pd.taskStatus === 'delayed' ? 'in-progress' : 'todo',
      createdAt:   Date.now(),
      createdBy:   'system',
    };
  });
}

export function getProductTasks(prod) {
  if (!prod) return [];
  
  // 1. Extract raw tasks from whichever schema exists
  const rawTasks = prod.tasks ? Object.values(prod.tasks) : (prod.pillars ? pillarsToTasks(prod.pillars) : []);
  
  // 2. Map valid IDs to prevent Ghost Link crashes
  const validIds = new Set(rawTasks.map(t => t.id));

  // 3. Normalize schema and strip bad data before the UI ever sees it
  const normalizedTasks = rawTasks.map(t => {
    return {
      ...t,
      status: t.status || t.taskStatus || 'on-track',
      predecessors: (t.predecessors || []).filter(pid => validIds.has(pid))
    };
  });

  // 4. Sort and return the sanitized array
  return normalizedTasks.sort((a,b) => (a.order||0) - (b.order||0));
}

export async function checkAndLockProduct(productId) {
  // Call after any task status update — lock if first milestone has lapsed
  const prod = productListCache[productId];
  if (!prod || prod.tasksLockedAt) return;
  if (isProductLocked(prod)) {
    await set(ref(db, 'products/' + productId + '/tasksLockedAt'), Date.now());
    if (productListCache[productId]) productListCache[productId].tasksLockedAt = Date.now();
  }
}

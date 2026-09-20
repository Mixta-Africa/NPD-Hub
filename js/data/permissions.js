/* data/permissions.js — Who can see or edit what: product access, task-level privacy, budget visibility, access badges. */

import { sanitiseEmail } from '../core/utils.js';
import { currentRole, currentUser, currentUserDept, isSuperAdmin } from '../core/state.js';
import { getProductTasks } from './product-model.js';

// Current user's effective permissions per product
// 'owner' | 'edit' | 'view' | 'admin' | null
export function getProductAccess(prod) {
  if (!prod || !currentUser) return null;
  if (currentRole === 'admin') return 'admin';
  const key = sanitiseEmail(currentUser.email);
  if (prod.ownerId === key) return 'owner';
  if (prod.sharedWith?.[key]) return prod.sharedWith[key]; // 'edit' | 'view'
  return null;
}

export function canEdit(prod) {
  const access = getProductAccess(prod);
  return ['admin','owner','edit'].includes(access);
}

export function isProductLocked(prod) {
  // Locked when the earliest task deadline has lapsed
  if (!prod) return false;
  if (prod.tasksLockedAt) return true;
  const tasks = Object.values(prod.tasks || prod.pillars || {});
  const today = new Date(); today.setHours(0,0,0,0);
  const firstPast = tasks.find(t => {
    const d = t.deadline; if (!d) return false;
    const due = new Date(d); due.setHours(0,0,0,0);
    return due < today;
  });
  return !!firstPast;
}

function canEditTask(prod, taskId) {
  if (currentRole === 'admin' || isSuperAdmin) return true;
  if (isProductLocked(prod)) return false;
  return true;
}

/* The visibility test — identical rule to the Products list.
   Everything the assistant can see flows through this one function. */
/* ══════════════════════════════════════════════════════════════
   TASK-LEVEL PRIVACY

   Levels:
     private     — product owner + the task's own owners. DEFAULT.
     department  — the above, plus everyone in an assigned department.
     public      — everyone who can see the product.

   An UNSET visibility field is treated as PRIVATE. This is deliberate:
   the field did not exist before this release, so defaulting to public
   would leave every historical task exposed. Note that a task assigned
   to a department is still visible to that department under 'private',
   because those members ARE its owners.

   Matching is on canonical email — never on display names, which can
   be renamed in the People tab.
   ══════════════════════════════════════════════════════════════ */
export const TASK_VISIBILITY = {
  private:    { label: 'Private',    desc: 'Owners only',                 color: '#C0282D' },
  department: { label: 'Department', desc: 'Assigned departments',        color: '#D97706' },
  public:     { label: 'Public',     desc: 'Everyone on this item',       color: '#16A34A' },
};

export function getTaskVisibility(task) {
  const v = task && task.visibility;
  return (v === 'public' || v === 'department' || v === 'restricted') ? (v === 'restricted' ? 'department' : v) : 'private';
}

export function taskOwnerList(task) {
  if (task.owners && task.owners.length > 0) return task.owners;
  if (task.owner || task.ownerEmail) {
    return [{ dept: task.ownerDept || '', email: task.ownerEmail || '', nameCache: task.owner || '' }];
  }
  return [];
}

export function canViewTask(task, prod) {
  if (!currentUser) return false;
  
  const userKey = sanitiseEmail(currentUser.email);
  const myEmail = (currentUser.email || '').toLowerCase();
  const myDept  = (currentUserDept || '').toLowerCase();

  // 1. Check if the user is explicitly assigned to this task.
  // An owner record with an email names a SPECIFIC PERSON — department is
  // just their org label for reporting, not a grant of access. Department
  // membership only counts when the record has no individual named at all
  // (a genuine "assigned to the whole department" record).
  const owners = typeof taskOwnerList === 'function' ? taskOwnerList(task) : (task.owners || []);
  const isTaskOwner = owners.some(o => {
    if (o.email) return o.email.toLowerCase() === myEmail;
    if (o.dept && myDept) return o.dept.toLowerCase() === myDept;
    return false;
  });

  // 2. THE "MY VIEW" GATE — admins only.
  // Role-guarded deliberately: this branch is stricter than the normal path
  // (it drops public and department-visible tasks). If a non-admin ever
  // reached it, they would silently lose access to work they should see.
  if (currentRole === 'admin' && window.adminViewMode === 'personal') {
    return isTaskOwner || (prod && prod.ownerId === userKey);
  }

  // 3. NORMAL ORG/ADMIN VIEW LOGIC
  if (currentRole === 'admin' || isSuperAdmin) return true;
  if (prod && prod.ownerId === userKey) return true; // Product owner sees all tasks
  if (isTaskOwner) return true;

  const vis = getTaskVisibility(task);
  if (vis === 'private') return false;
  if (vis === 'department') {
    if (Array.isArray(task.visibleTo) && task.visibleTo.some(e => {
      const v = String(e || '').toLowerCase().trim();
      return v === myEmail || (myDept && v === myDept);
    })) return true;
    return false;
  }
  if (vis === 'public') return true;

  return false;
}
export function canSetTaskVisibility(prod) {
  if (currentRole === 'admin' || isSuperAdmin) return true;
  if (!currentUser || !prod) return false;
  return prod.ownerId === sanitiseEmail(currentUser.email);
}

/* Budgets are a different sensitivity class from task data —
   owner, admin and super-admin only. */
export function canViewBudget(prod) {
  if (currentRole === 'admin' || isSuperAdmin) return true;
  if (!currentUser || !prod) return false;
  return prod.ownerId === sanitiseEmail(currentUser.email);
}

/* Product-level access summary.
   Derived from the SAME rules canUserSeeProduct() enforces, so the badge can
   never disagree with reality: owner + admins always; anyone in sharedWith;
   anyone whose department owns a task on it. */
function getProductAccessSummary(p) {
  const shared = Object.keys(p.sharedWith || {});
  const depts  = [];
  getProductTasks(p).forEach(t => {
    const owners = (t.owners && t.owners.length) ? t.owners
      : [{ dept: t.ownerDept || '', email: t.ownerEmail || '' }];
    owners.forEach(o => { if (o.dept && !depts.includes(o.dept)) depts.push(o.dept); });
  });
  const total = shared.length + depts.length;
  if (total === 0) {
    return { level: 'private', label: 'Private', color: '#C0282D',
             detail: 'Only you and admins can see this' };
  }
  const bits = [];
  if (depts.length)  bits.push(depts.join(', '));
  if (shared.length) bits.push(shared.length + ' individual' + (shared.length !== 1 ? 's' : ''));
  return { level: 'shared', label: 'Shared', color: '#D97706',
           detail: 'Visible to: ' + bits.join(' + '), count: total };
}

/* Compact visibility marker for dense rows (tracker, kanban).
   Read-only — changing visibility stays in the product modal so there is
   one place that writes it. */
export function taskVisMarker(task) {
  const v = getTaskVisibility(task);
  const m = TASK_VISIBILITY[v];
  const paths = {
    private:    '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    department: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/>',
    public:     '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
  };
  return '<span title="' + m.label + ' — ' + m.desc + '" style="display:inline-flex;vertical-align:-2px;margin-right:5px;color:' + m.color + ';">' +
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    paths[v] + '</svg></span>';
}

export function accessBadge(p) {
  const a = getProductAccessSummary(p);
  const icon = a.level === 'private'
    ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:3px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>'
    : '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:3px;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/></svg>';
  return '<span title="' + a.detail + '" style="font-size:10px;font-weight:700;color:' + a.color +
    ';background:' + a.color + '15;padding:2px 8px;border-radius:10px;letter-spacing:.03em;">' +
    icon + a.label.toUpperCase() + (a.count ? ' · ' + a.count : '') + '</span>';
}

export function canUserSeeProduct(p, userKey) {
  // 1. Admin in Org View sees everything
  if (currentRole === 'admin' && window.adminViewMode !== 'personal') return true;

  // 2. ADMIN IN "MY VIEW" — strict personal ringfence.
  if (currentRole === 'admin' && window.adminViewMode === 'personal') {
    if (p.ownerId === userKey) return true;
    const myEmail = (currentUser?.email || '').toLowerCase();
    return getProductTasks(p).some(t => {
      // Must be genuinely visible to count
      if (!canViewTask(t, p)) return false; 
      const owners = (t.owners && t.owners.length) ? t.owners : [{ dept: t.ownerDept || '', email: t.ownerEmail || '' }];
      return owners.some(o => o.email && o.email.toLowerCase() === myEmail);
    });
  }

  // 3. Member path — owned or shared
  if (p.ownerId === userKey) return true;
  if (p.sharedWith?.[userKey]) return true;
  
  // 4. Deep Task Inspection: Am I assigned to any GENUINELY VISIBLE task here?
  if (currentUserDept) {
    const myEmail = (currentUser.email || '').toLowerCase();
    const myDept  = currentUserDept.toLowerCase();
    const tasks   = getProductTasks(p);
    
    return tasks.some(t => {
      // If the task itself is private/restricted from them, it doesn't pull them into the project
      if (!canViewTask(t, p)) return false;
      
      const owners = (t.owners && t.owners.length) ? t.owners : [{ dept: t.ownerDept || '', email: t.ownerEmail || '' }];
      // Same rule as canViewTask: a named individual's department is a label,
      // not a grant — only an un-named, dept-only record opens it by department.
      return owners.some(o => o.email ? o.email.toLowerCase() === myEmail : (o.dept && o.dept.toLowerCase() === myDept));
    });
  }
  return false;
}

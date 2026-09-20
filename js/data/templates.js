/* data/templates.js — Saved task templates. */

import { db, get, ref, set } from '../core/firebase.js';
import { currentUser } from '../core/state.js';
import { loadTeamMembers } from './app-config.js';

/* ══ TASK SYSTEM — UTILITIES ════════════════════════════════ */
export let SAVED_TEMPLATES  = {};   // loaded from Firebase /templates/

async function loadSavedTemplates() {
  try {
    const snap = await get(ref(db, 'templates'));
    SAVED_TEMPLATES = snap.val() || {};
  } catch(e) { SAVED_TEMPLATES = {}; }
}

export async function saveAsTemplate(name, tasks) {
  const id = 'tmpl_' + Date.now();
  const tmpl = {
    id, name,
    createdBy: currentUser.email,
    createdAt: Date.now(),
    tasks: tasks.map(t => ({
      title:       t.title,
      description: t.description || '',
      owner:       t.owner || '',
      predecessors:[],
      order:       t.order || 0,
    })),
  };
  await set(ref(db, 'templates/' + id), tmpl);
  SAVED_TEMPLATES[id] = tmpl;
  return tmpl;
}

export async function loadTemplatesAndConfig() {
  await loadTeamMembers();
  await loadSavedTemplates();
}

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_SAVED_TEMPLATES(v) { SAVED_TEMPLATES = v; }

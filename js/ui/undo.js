/* ui/undo.js — Ctrl+Z to undo the last status change. */

import { STATUS_META } from '../data/status.js';

/* ══ CTRL+Z — UNDO THE LAST STATUS CHANGE ═════════════════════
   Scoped deliberately to status changes only (Complete/On track/
   Delayed/Stepped down etc.), since that's the specific action asked
   for — not a general app-wide undo for every possible edit. Ignores
   the shortcut entirely while typing in a text field, so it never
   fights with a real text-editing undo the browser already handles. */
export function initUndoShortcut() {
  if (window._undoShortcutWired) return;
  window._undoShortcutWired = true;
  document.addEventListener('keydown', (e) => {
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    if (!isUndo) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    undoLastStatusChange();
  });
}

async function undoLastStatusChange() {
  const stack = window._statusUndoStack || [];
  const last = stack.pop();
  if (!last) { showToast('Nothing to undo.', 'info'); return; }
  await updatePillarStatus(last.productId, last.taskId, last.oldStatus, true);
  showToast('Undone: "' + last.taskTitle + '" back to ' + (STATUS_META[last.oldStatus]?.label || last.oldStatus) + '.', 'success');
}

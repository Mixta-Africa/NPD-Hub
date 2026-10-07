/* features/present-mode.js — Presentation Mode: a full-screen, click-through
   status walkthrough for one project, built for standing in front of
   management with your screen already shared (Zoom, Teams, or a projector).

   Deliberately NOT a live-sync "broadcast" layer — no second device, no
   viewer link, nothing to set up beforehand. It reads the same data every
   other view reads (getProductTasks + resolveTaskStatus), so it can never
   show a number the rest of the app disagrees with, and it respects the
   same per-task privacy rule (canViewTask) everything else does.

   Narrative order follows Timi's own deck convention — situation
   (overview) → proof of momentum (complete/on-track) → complication
   (due soon → overdue → blocked) → resolution (forecast + what's being
   watched) — rather than leading with bad news. */

import { currentPreferredName, currentUser } from '../core/state.js';
import { getProductTasks } from '../data/product-model.js';
import { canViewTask, taskOwnerList } from '../data/permissions.js';
import { resolveTaskStatus, STATUS_META, computeProjectPrediction, formatDate } from '../data/status.js';
import { ownerLabel } from './task-editor.js';
import { productListCache } from '../data/products-cache.js';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Reading order for both the overview tiles and the per-bucket slides —
// wins first, risk last, so the room is settled before the hard part.
const NARRATIVE_ORDER = ['complete', 'on-track', 'in-progress', 'due-soon', 'overdue', 'blocked', 'delayed', 'deprioritized'];
const BUCKET_LABEL = {
  complete: 'Completed', 'on-track': 'On track', 'in-progress': 'In progress',
  'due-soon': 'Due soon', overdue: 'Overdue', blocked: 'Blocked',
  delayed: 'Delayed', deprioritized: 'Stepped down',
};

function buildPresentationSlides(prod) {
  const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
  const total = tasks.length;

  const buckets = {};
  tasks.forEach(t => {
    const s = resolveTaskStatus(t, prod);
    (buckets[s] = buckets[s] || []).push(t);
  });

  const completeCount = (buckets.complete || []).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;
  const present = NARRATIVE_ORDER.filter(k => buckets[k] && buckets[k].length);

  const slides = [];
  slides.push({ type: 'cover', title: prod.name || 'Untitled project', pct, total,
    presenter: currentPreferredName || currentUser?.displayName || '' });
  slides.push({ type: 'overview', total, pct, buckets, order: present });
  present.forEach(key => slides.push({ type: 'bucket', key, tasks: buckets[key] }));
  slides.push({ type: 'closing', forecast: computeProjectPrediction(prod), pct });
  return slides;
}

function ownerText(task) {
  const owners = taskOwnerList(task);
  return owners.length ? owners.map(o => ownerLabel(o) + (o.dept ? ' (' + o.dept + ')' : '')).join(', ') : 'Unassigned';
}

function renderCover(s) {
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return '<div class="pm-slide pm-cover">' +
      '<div class="pm-kicker">MIXTA AFRICA &middot; STATUS UPDATE</div>' +
      '<h1 class="pm-cover-title">' + escapeHtml(s.title) + '</h1>' +
      '<div class="pm-cover-meta">' + dateStr + (s.presenter ? ' &middot; Presented by ' + escapeHtml(s.presenter) : '') + '</div>' +
      '<div class="pm-cover-progress">' +
        '<div class="pm-ring" style="--pct:' + s.pct + '"><div class="pm-ring-inner"><div class="pm-ring-pct">' + s.pct + '%</div></div></div>' +
        '<div class="pm-ring-label">Overall complete<br>' + s.total + ' task' + (s.total !== 1 ? 's' : '') + ' tracked</div>' +
      '</div>' +
    '</div>';
}

function renderOverview(s) {
  const tiles = s.order.map(k => {
    const meta = STATUS_META[k] || STATUS_META['on-track'];
    return '<div class="pm-tile">' +
        '<div class="pm-tile-num" style="color:' + meta.color + '">' + s.buckets[k].length + '</div>' +
        '<div class="pm-tile-label">' + (BUCKET_LABEL[k] || meta.label) + '</div>' +
      '</div>';
  }).join('');
  return '<div class="pm-slide">' +
      '<div class="pm-section-head">Where things stand</div>' +
      '<div class="pm-section-sub">' + s.total + ' task' + (s.total !== 1 ? 's' : '') + ' &middot; ' + s.pct + '% complete</div>' +
      '<div class="pm-tiles">' + tiles + '</div>' +
    '</div>';
}

function renderBucket(s) {
  const meta = STATUS_META[s.key] || STATUS_META['on-track'];
  const rows = s.tasks.map(t =>
    '<div class="pm-row">' +
      '<div class="pm-row-title">' + escapeHtml(t.title || t.name || 'Untitled task') + '</div>' +
      '<div class="pm-row-meta">' + escapeHtml(ownerText(t)) + (t.deadline ? ' &middot; ' + formatDate(t.deadline) : '') + '</div>' +
    '</div>'
  ).join('');
  return '<div class="pm-slide">' +
      '<div class="pm-section-head" style="color:' + meta.color + '">' + (BUCKET_LABEL[s.key] || meta.label) +
        ' <span class="pm-section-count">' + s.tasks.length + '</span></div>' +
      '<div class="pm-rows">' + rows + '</div>' +
    '</div>';
}

function renderClosing(s) {
  const f = s.forecast;
  const bn = (f.bottlenecks || []).slice(0, 3);
  const stats = [
    '<div class="pm-closing-stat"><div class="pm-closing-num">' + s.pct + '%</div><div class="pm-closing-label">Complete today</div></div>',
  ];
  if (f.delayDays > 0) {
    stats.push('<div class="pm-closing-stat"><div class="pm-closing-num" style="color:var(--amber)">+' + f.delayDays + 'd</div><div class="pm-closing-label">Projected slip</div></div>');
  }
  if (f.predictedDate) {
    stats.push('<div class="pm-closing-stat"><div class="pm-closing-num pm-closing-num-sm">' + formatDate(f.predictedDate) + '</div><div class="pm-closing-label">Target date</div></div>');
  }
  return '<div class="pm-slide">' +
      '<div class="pm-section-head">Outlook</div>' +
      '<div class="pm-closing-grid">' + stats.join('') + '</div>' +
      (bn.length
        ? '<div class="pm-section-head pm-section-head-sm">What we\'re watching</div>' +
          '<div class="pm-rows">' + bn.map(b =>
            '<div class="pm-row"><div class="pm-row-title">' + escapeHtml(b.name) + '</div>' +
            '<div class="pm-row-meta">' + b.delay + ' day' + (b.delay !== 1 ? 's' : '') + ' behind</div></div>'
          ).join('') + '</div>'
        : '<div class="pm-section-sub" style="margin-top:8px;">No critical bottlenecks on the current path.</div>') +
    '</div>';
}

function renderSlideHtml(slide) {
  switch (slide.type) {
    case 'cover':    return renderCover(slide);
    case 'overview': return renderOverview(slide);
    case 'bucket':   return renderBucket(slide);
    case 'closing':  return renderClosing(slide);
    default: return '';
  }
}

/* ══ OVERLAY + NAVIGATION ══════════════════════════════════════ */
let _pm = null; // { productId, slides, index }

function ensurePresentOverlay() {
  if (document.getElementById('pm-overlay')) return;
  const div = document.createElement('div');
  div.id = 'pm-overlay';
  div.className = 'pm-overlay';
  div.innerHTML =
    '<button class="pm-icon-btn pm-exit" onclick="exitPresentMode()" title="Exit (Esc)">&times;</button>' +
    '<button class="pm-icon-btn pm-fullscreen" onclick="pmToggleFullscreen()" title="Toggle fullscreen">&#10021;</button>' +
    '<div class="pm-stage" id="pm-stage" onclick="pmStageClick(event)"></div>' +
    '<button class="pm-nav pm-nav-prev" onclick="event.stopPropagation();presentPrev();" title="Previous (&larr;)">&lsaquo;</button>' +
    '<button class="pm-nav pm-nav-next" onclick="event.stopPropagation();presentNext();" title="Next (&rarr;)">&rsaquo;</button>' +
    '<div class="pm-footer">' +
      '<div class="pm-dots" id="pm-dots"></div>' +
      '<div class="pm-counter" id="pm-counter"></div>' +
    '</div>';
  document.body.appendChild(div);
}

function renderPresentSlide() {
  if (!_pm) return;
  const { slides, index } = _pm;
  const stage = document.getElementById('pm-stage');
  if (stage) stage.innerHTML = renderSlideHtml(slides[index]);

  const dots = document.getElementById('pm-dots');
  if (dots) {
    dots.innerHTML = slides.map((_, i) =>
      '<span class="pm-dot' + (i === index ? ' active' : '') + '" onclick="event.stopPropagation();presentGoTo(' + i + ');"></span>'
    ).join('');
  }
  const counter = document.getElementById('pm-counter');
  if (counter) counter.textContent = (index + 1) + ' / ' + slides.length;

  const prevBtn = document.querySelector('.pm-nav-prev');
  const nextBtn = document.querySelector('.pm-nav-next');
  if (prevBtn) prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  if (nextBtn) nextBtn.style.visibility = index === slides.length - 1 ? 'hidden' : 'visible';
}

function pmKeyHandler(e) {
  if (!_pm) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); window.presentNext(); }
  else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || e.key === 'PageUp') { e.preventDefault(); window.presentPrev(); }
  else if (e.key === 'Escape') { window.exitPresentMode(); }
}

window.enterPresentMode = (productId) => {
  const prod = productListCache[productId];
  if (!prod) { showToast('Project not loaded yet — try again in a moment.', 'error'); return; }
  const tasks = getProductTasks(prod);
  if (!tasks.length) { showToast('Nothing to present yet — this project has no tasks.', 'error'); return; }

  _pm = { productId, slides: buildPresentationSlides(prod), index: 0 };
  ensurePresentOverlay();
  renderPresentSlide();
  const el = document.getElementById('pm-overlay');
  el.style.display = 'flex';
  document.addEventListener('keydown', pmKeyHandler);
  if (el.requestFullscreen) el.requestFullscreen().catch(() => { /* fine on a projector without permission too */ });
};

window.exitPresentMode = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const el = document.getElementById('pm-overlay');
  if (el) el.style.display = 'none';
  document.removeEventListener('keydown', pmKeyHandler);
  _pm = null;
};

window.presentNext = () => { if (_pm && _pm.index < _pm.slides.length - 1) { _pm.index++; renderPresentSlide(); } };
window.presentPrev = () => { if (_pm && _pm.index > 0) { _pm.index--; renderPresentSlide(); } };
window.presentGoTo = (i) => { if (!_pm) return; _pm.index = Math.max(0, Math.min(_pm.slides.length - 1, i)); renderPresentSlide(); };
window.pmStageClick = () => { window.presentNext(); };
window.pmToggleFullscreen = () => {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  const el = document.getElementById('pm-overlay');
  if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
};

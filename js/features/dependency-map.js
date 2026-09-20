/* features/dependency-map.js — Task dependency map (Mermaid) and its export. */

import { highlightDeepLinkTask } from '../ui/routing.js';
import { ownerLabel } from './task-editor.js';
import { resolveTaskStatus } from '../data/status.js';

/* ── STATUS HELPERS ── */
  
// ── DEPENDENCY MAP GENERATOR ───────────────────────────────────
/* Clicking a node opens that task. Mermaid calls this by name from the
   generated `click` directives, so it must live on window. */
window.depMapNodeClick = (taskId) => {
  const pid = window._depMapProductId;
  if (!pid) return;
  openProjectDashboard(pid);
  setTimeout(() => {
    if (typeof highlightDeepLinkTask === 'function') highlightDeepLinkTask(taskId);
  }, 800);
};

export function generateDependencyMap(tasks, prod) {
  // Remember which item this map belongs to so node clicks can route
  window._depMapProductId = prod && prod.id ? prod.id : null;
  // Mermaid node IDs must be alphanumeric — raw task ids can contain
  // characters that silently break the parse, so map them to safe handles.
  const nid = {};
  tasks.forEach((t, i) => { nid[t.id] = 'N' + i; });

  // Sequence = longest predecessor chain. Cycle-guarded so a circular
  // dependency degrades to stage 1 instead of hanging the render.
  const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
  const depth = {};
  const chain = (id, seen) => {
    if (depth[id] !== undefined) return depth[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    let d = 0;
    (byId[id]?.predecessors || []).forEach(p => {
      if (byId[p]) d = Math.max(d, chain(p, seen) + 1);
    });
    seen.delete(id);
    return (depth[id] = d);
  };
  tasks.forEach(t => chain(t.id, new Set()));
  const maxDepth = tasks.reduce((m, t) => Math.max(m, depth[t.id] || 0), 0);

  const clean = str => String(str || '')
    .replace(/["'|{}\[\]()><;`#\n\r]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const ownerOf = t => {
    const owners = (t.owners && t.owners.length) ? t.owners
      : (t.owner ? [{ dept: t.ownerDept || '', email: t.ownerEmail || '', nameCache: t.owner }] : []);
    if (!owners.length) return 'Unassigned';
    const names = owners.map(o => {
      if (typeof ownerLabel === 'function') return ownerLabel(o);
      return o.nameCache || o.dept || o.email || '';
    }).filter(Boolean);
    return names.length ? names.join(' + ') : 'Unassigned';
  };

  let graph = 'flowchart LR\n';
  let hasEdges = false;

  // One subgraph per stage — this is what makes ORDER readable at a glance
  for (let d = 0; d <= maxDepth; d++) {
    const stage = tasks.filter(t => (depth[t.id] || 0) === d);
    if (!stage.length) continue;
    const label = d === 0 ? 'STAGE 1 - Can start now' : 'STAGE ' + (d + 1) + ' - After stage ' + d;
    graph += '  subgraph S' + d + '["' + label + '"]\n';
    graph += '    direction TB\n';
    stage.forEach(t => {
      // Shorter truncation than the box can hold — Mermaid does not reflow,
      // so text must fit the node rather than the node grow to the text.
      let title = clean(t.title || 'Untitled');
      if (title.length > 26) title = title.substring(0, 26) + '...';
      let owner = clean(ownerOf(t));
      if (owner.length > 20) owner = owner.substring(0, 20) + '...';
      const due = t.deadline
        ? new Date(t.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : 'no date';
      // Three lines per node: what, who, when — the PM's actual question
      graph += '    ' + nid[t.id] + '["' + title + '<br/><small>' + owner + '</small><br/><small>' + due + '</small>"]\n';
    });
    graph += '  end\n';
  }

  // Edges, labelled with what the downstream task is waiting for
  tasks.forEach(t => {
    (t.predecessors || []).forEach(pid => {
      if (!byId[pid]) return;
      const eff = typeof resolveTaskStatus === 'function' ? resolveTaskStatus(byId[pid], prod) : '';
      const done = eff === 'complete';
      // Solid arrow = predecessor finished, path is clear.
      // Dotted arrow = still waiting, this is what is holding things up.
      graph += done
        ? '  ' + nid[pid] + ' ==>|cleared| ' + nid[t.id] + '\n'
        : '  ' + nid[pid] + ' -.->|waiting on| ' + nid[t.id] + '\n';
      hasEdges = true;
    });
  });

  // Status colouring
  tasks.forEach(t => {
    const eff = typeof resolveTaskStatus === 'function' ? resolveTaskStatus(t, prod) : 'on-track';
    let stroke = '#16A34A', fill = '#F0FDF4';
    if (eff === 'complete')                        { stroke = '#2563EB'; fill = '#EFF6FF'; }
    else if (eff === 'delayed' || eff === 'overdue'){ stroke = '#C0282D'; fill = '#FEF2F2'; }
    else if (eff === 'due-soon' || eff === 'blocked'){ stroke = '#D97706'; fill = '#FFFBEB'; }
    graph += '  style ' + nid[t.id] + ' fill:' + fill + ',stroke:' + stroke +
             ',stroke-width:2px,color:#1A1A1A,rx:6,ry:6\n';
    if (eff === 'blocked') graph += '  style ' + nid[t.id] + ' stroke-dasharray: 5 5\n';
  });

  // Critical path: the longest waiting chain ending at the latest stage.
  // This is the sequence that actually determines the finish date.
  const tail = tasks.filter(t => (depth[t.id] || 0) === maxDepth);
  const critical = [];
  if (maxDepth > 0 && tail.length) {
    let cur = tail.sort((a, b) =>
      new Date(b.deadline || 0) - new Date(a.deadline || 0))[0];
    while (cur) {
      critical.push(cur.id);
      const preds = (cur.predecessors || []).map(p => byId[p]).filter(Boolean);
      cur = preds.sort((a, b) => (depth[b.id] || 0) - (depth[a.id] || 0))[0];
    }
  }
  // Make every node clickable — the map should be a way into the work,
  // not a picture of it.
  tasks.forEach(t => {
    graph += '  click ' + nid[t.id] + ' call depMapNodeClick("' + t.id + '")\n';
  });

  if (!hasEdges && tasks.length > 0) {
    graph += '  NOTE["No dependencies set yet<br/><small>Add a Depends on value to a task</small>"]\n';
    graph += '  style NOTE fill:#F8F8F7,stroke:#D1D5DB,stroke-width:1px,color:#6B7280\n';
  }
  return graph;
}

window.toggleDepMap = (productId) => {
  const body = document.getElementById('dep-map-body-' + productId);
  const chevron = document.getElementById('dep-map-chevron-' + productId);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (chevron) chevron.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
};

/* ══ MAP EXPORT ══════════════════════════════════════════════ */
window.exportMermaidMap = (productId, format) => {
  const container = document.getElementById('mermaid-container-' + productId);
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) { showToast('Map is not ready yet', 'error'); return; }
  
  const svgData = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  if (format === 'svg') {
    const a = document.createElement('a');
    a.href = url;
    a.download = `Dependency_Map_${productId}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else {
    showToast('Generating high-res PNG...', 'info');
    const canvas = document.createElement('canvas');
    const bbox = svg.getBoundingClientRect();
    
    // Scale up for high-resolution PNG
    canvas.width = bbox.width * 2; 
    canvas.height = bbox.height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    
    // Fill with solid white background (SVGs are transparent by default)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, bbox.width, bbox.height);
      const pngUrl = canvas.toDataURL('image/png', 1.0);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `Dependency_Map_${productId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
};

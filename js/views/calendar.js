/* views/calendar.js — Launch Calendar and Gantt. */

import { canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { formatDate, resolveTaskStatus, STATUS_META } from '../data/status.js';
import { getProductsFresh } from '../data/products-cache.js';

/* ══ CALENDAR VIEW ══════════════════════════════════════════ */
let calSelectedProduct = 'all';
let calCurrentMonth    = new Date().getMonth();
let calCurrentYear     = new Date().getFullYear();
export let calProductsCache   = {};

/* ── CALENDAR STATE ── */
export let calViewMode = 'month'; // 'month' | 'gantt'
let ganttMonths = 3;       // how many months the gantt spans

export function renderCalendar(el) {
  const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-day-hdr">${d}</div>`).join('');
  el.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Launch Calendar</h1>
        <p class="view-subtitle">Milestone timeline across all active products</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <select id="cal-product-filter" class="select-field" onchange="calFilterChange()">
          <option value="all">All products</option>
        </select>
        <div class="cal-view-toggle">
          <button class="cal-view-btn active" id="btn-month-view" onclick="setCalView('month')">Month</button>
          <button class="cal-view-btn" id="btn-gantt-view" onclick="setCalView('gantt')">Gantt</button>
        </div>
      </div>
    </div>
    <div class="cal-legend">
      <span class="leg-item"><span class="leg-dot leg-green"></span>On track</span>
      <span class="leg-item"><span class="leg-dot leg-amber"></span>Due within 3 days</span>
      <span class="leg-item"><span class="leg-dot leg-red"></span>Overdue</span>
      <span class="leg-item"><span class="leg-dot leg-blue"></span>Complete</span>
    </div>
    <div id="cal-month-view">
    <div class="dashboard-row-2col" style="align-items:start;">
      <div class="panel" style="margin-bottom:0;">
        <div class="cal-nav">
          <button class="cal-nav-btn" onclick="calMove(-1)">&#8592;</button>
          <span class="cal-month-label" id="cal-month-label"></span>
          <button class="cal-nav-btn" onclick="calMove(1)">&#8594;</button>
          <button class="cal-today-btn" onclick="calGoToday()">Today</button>
        </div>
        <div class="cal-grid-wrap">
          <div class="cal-day-headers">${dayHeaders}</div>
          <div class="cal-grid" id="cal-grid"></div>
        </div>
      </div>
      <div class="panel" id="cal-upcoming-panel" style="margin-bottom:0;display:flex;flex-direction:column;max-height:560px;">
        <div class="panel-header"><span class="panel-title">All milestones this month</span></div>
        <div class="panel-body" id="cal-milestone-list" style="overflow-y:auto;flex:1;min-height:0;"><div class="loading-row">Loading...</div></div>
      </div>
    </div>
    </div><!-- /cal-month-view -->
    <div id="cal-gantt-view" style="display:none;">
      <div class="panel" style="margin-bottom:16px;">
        <div class="tracker-toolbar">
          <span class="tracker-toolbar-label">Timeline span</span>
          <div class="cal-view-toggle" id="gantt-span-toggle">
            <button class="cal-view-btn" data-span="2" onclick="setGanttMonths(2)">2 months</button>
            <button class="cal-view-btn active" data-span="3" onclick="setGanttMonths(3)">3 months</button>
            <button class="cal-view-btn" data-span="6" onclick="setGanttMonths(6)">6 months</button>
          </div>
        </div>
        <div id="gantt-container" style="overflow-x:auto;padding:14px 18px;"></div>
      </div>
    </div>`;
  loadCalendarData();
}

window.setCalView = (mode) => {
  calViewMode = mode;
  const monthView = document.getElementById('cal-month-view');
  const ganttView = document.getElementById('cal-gantt-view');
  const btnMonth  = document.getElementById('btn-month-view');
  const btnGantt  = document.getElementById('btn-gantt-view');
  if (!monthView || !ganttView) return;
  if (mode === 'month') {
    monthView.style.display = 'block';
    ganttView.style.display = 'none';
    if (btnMonth) { btnMonth.classList.add('active'); btnGantt.classList.remove('active'); }
    drawCalendar(); drawMilestoneList();
  } else {
    monthView.style.display = 'none';
    ganttView.style.display = 'block';
    if (btnGantt) { btnGantt.classList.add('active'); btnMonth.classList.remove('active'); }
    drawGantt();
  }
};

window.setGanttMonths = (n) => {
  ganttMonths = n;
  document.querySelectorAll('#gantt-span-toggle .cal-view-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.span) === n);
  });
  drawGantt();
};

export function drawGantt() {
  const container = document.getElementById('gantt-container');
  if (!container) return;

  const milestones = getCalMilestones();
  if (milestones.length === 0) {
    container.innerHTML = '<div class="empty-state-sm"><p>No milestones to display.</p></div>';
    return;
  }

  // Date range: earliest to latest milestone + padding
  const allDates = milestones.map(m => new Date(m.date));
  const today    = new Date(); today.setHours(0,0,0,0);
  let rangeStart = new Date(Math.min(...allDates.map(d => d.getTime())));
  let rangeEnd   = new Date(Math.max(...allDates.map(d => d.getTime())));
  rangeStart.setDate(rangeStart.getDate() - 7);
  rangeEnd.setDate(rangeEnd.getDate() + 14);
  rangeStart.setHours(0,0,0,0); rangeEnd.setHours(0,0,0,0);

  // Also respect ganttMonths minimum
  const minEnd = new Date(today);
  minEnd.setMonth(minEnd.getMonth() + ganttMonths);
  if (minEnd > rangeEnd) rangeEnd = minEnd;

  const totalDays = Math.max(Math.round((rangeEnd - rangeStart) / 86400000), 1);

  function pctOf(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    return Math.max(0, Math.min(100, (Math.round((d - rangeStart) / 86400000) / totalDays) * 100));
  }

  // Month header labels
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let monthLabels = '';
  let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cur <= rangeEnd) {
    const monthEnd  = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const clipStart = Math.max(cur.getTime(), rangeStart.getTime());
    const clipEnd   = Math.min(monthEnd.getTime(), rangeEnd.getTime());
    const days      = Math.round((clipEnd - clipStart) / 86400000);
    const w         = (days / totalDays) * 100;
    monthLabels    += `<div class="gantt-month-hdr" style="width:${w}%">${MONTHS[cur.getMonth()]} ${cur.getFullYear()}</div>`;
    cur = monthEnd;
  }

  const todayPct = pctOf(today.toISOString().split('T')[0]);

  // One row per milestone — identical layout to Task Tracker Gantt.
  // Each row: status dot + milestone name in the label, positioned marker on the track.
  const sorted = [...milestones].sort((a, b) => new Date(a.date) - new Date(b.date));

  const rows = sorted.map(m => {
    const dp = pctOf(m.date);
    if (dp === null) return '';

    // Unified status → dot + bar class (matches tracker exactly)
    const eff = m.effectiveStatus;
    const dotStatus = eff === 'complete' ? 'complete'
                    : (eff === 'delayed' || eff === 'overdue') ? 'delayed'
                    : (eff === 'blocked' || eff === 'due-soon') ? 'due-soon'
                    : 'on-track';
    const barCls = eff === 'complete' ? 'tg-bar-complete'
                 : (eff === 'delayed' || eff === 'overdue') ? 'tg-bar-delayed'
                 : (eff === 'blocked' || eff === 'due-soon') ? 'tg-bar-blocked'
                 : 'tg-bar-ontrack';

    const label = m.pillarName || m.productName || 'Milestone';

    return `<div class="gantt-row">
      <div class="gantt-label" title="${label} — ${m.productName}">
        <span class="tg-status-dot tg-dot-${dotStatus}"></span>
        ${label}
      </div>
      <div class="gantt-track">
        ${todayPct !== null ? `<div class="gantt-today-line" style="left:${todayPct}%"></div>` : ''}
        <div class="tg-bar ${barCls}" style="left:${Math.max(0, dp - 0.6)}%;width:1.4%;top:10px;bottom:10px;min-width:14px;">
          <div class="gantt-tooltip">${label} · ${m.productName}<br/>${formatDate(m.date)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="gantt-header">
      <div class="gantt-label-col"></div>
      <div class="gantt-months">${monthLabels}</div>
    </div>
    ${rows}`;
}

window.calFilterChange = () => {
  calSelectedProduct = document.getElementById('cal-product-filter')?.value || 'all';
  if (calViewMode === 'gantt') {
    drawGantt();
  } else {
    drawCalendar(); 
    drawMilestoneList();
  }
};
window.calMove = (dir) => {
  calCurrentMonth += dir;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  if (calCurrentMonth < 0)  { calCurrentMonth = 11; calCurrentYear--; }
  drawCalendar(); drawMilestoneList();
};
window.calGoToday = () => {
  const n = new Date(); calCurrentMonth = n.getMonth(); calCurrentYear = n.getFullYear();
  drawCalendar(); drawMilestoneList();
};
window.calDayClick = (day) => {
  const hits = getCalMilestones().filter(m => {
    const d = new Date(m.date);
    return d.getFullYear()===calCurrentYear && d.getMonth()===calCurrentMonth && d.getDate()===day;
  });
  if (!hits.length) return;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const titleEl = document.querySelector('#cal-upcoming-panel .panel-title');
  const listEl  = document.getElementById('cal-milestone-list');
  if (titleEl) titleEl.textContent = `Milestones — ${day} ${monthNames[calCurrentMonth]} ${calCurrentYear}`;
  if (listEl)  listEl.innerHTML = hits.map(buildMilestoneRow).join('');
};

async function loadCalendarData() {
  calProductsCache = await getProductsFresh();
  const active = Object.values(calProductsCache).filter(p => p.status !== 'archived');
  const sel = document.getElementById('cal-product-filter');
  if (sel) active.forEach(p => { const o=document.createElement('option'); o.value=p.id; o.textContent=p.name; sel.appendChild(o); });
  drawCalendar(); drawMilestoneList();
}

function getCalMilestones() {
  const prods = Object.values(calProductsCache).filter(p => p.status !== 'archived');
  const filtered = calSelectedProduct === 'all' ? prods : prods.filter(p => p.id === calSelectedProduct);
  const out = [];
  filtered.forEach(prod => {
    // Privacy-gated: the calendar renders task titles on every day cell
    const tasks = getProductTasks(prod).filter(t => canViewTask(t, prod));
    tasks.forEach(task => {
      if (!task.deadline) return;
      const effective = resolveTaskStatus(task);
      out.push({
        date:           task.deadline,
        productName:    prod.name,
        productId:      prod.id,
        pillarName:     task.title || task.name,
        pillarId:       task.id,
        taskStatus:     task.status || 'on-track',
        effectiveStatus: effective,          // unified status — single source of truth
        _task:          task,                // full task ref for downstream use
      });
    });
  });
  return out;
}

export function drawCalendar() {
  const label = document.getElementById('cal-month-label');
  const grid  = document.getElementById('cal-grid');
  if (!label || !grid) return;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = `${MONTHS[calCurrentMonth]} ${calCurrentYear}`;
  const firstDay    = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
  const daysInMonth = new Date(calCurrentYear, calCurrentMonth+1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  const milestones  = getCalMilestones();
  const dayMap = {};
  milestones.forEach(m => {
    const d = new Date(m.date);
    if (d.getFullYear()===calCurrentYear && d.getMonth()===calCurrentMonth) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(m);
    }
  });
  let html = '';
  for (let i=0; i<firstDay; i++) html += '<div class="cal-cell cal-cell-empty"></div>';
  for (let day=1; day<=daysInMonth; day++) {
    const cellDate = new Date(calCurrentYear, calCurrentMonth, day); cellDate.setHours(0,0,0,0);
    const isToday  = cellDate.getTime() === today.getTime();
    const events   = dayMap[day] || [];
    const dots = events.slice(0,4).map(e => {
      const cls = e.effectiveStatus==='complete' ? 'cal-dot-blue'
        : (e.effectiveStatus==='delayed' || e.effectiveStatus==='overdue') ? 'cal-dot-red'
        : e.effectiveStatus==='blocked' ? 'cal-dot-amber'
        : e.effectiveStatus==='due-soon' ? 'cal-dot-amber'
        : 'cal-dot-green';
      return `<span class="cal-dot ${cls}" title="${e.productName}: ${e.pillarName}"></span>`;
    }).join('');
    const extra = events.length > 4 ? `<span class="cal-dot-more">+${events.length-4}</span>` : '';

    // Subtle day-fill by worst status on that day
    let dayFill = '';
    if (events.length) {
      const hasBad  = events.some(e => e.effectiveStatus==='delayed' || e.effectiveStatus==='overdue');
      const hasWarn = events.some(e => e.effectiveStatus==='due-soon');
      const allDone = events.every(e => e.effectiveStatus==='complete');
      dayFill = hasBad ? ' cal-cell-fill-red'
              : hasWarn ? ' cal-cell-fill-amber'
              : allDone ? ' cal-cell-fill-blue'
              : ' cal-cell-fill-green';
    }

    html += `<div class="cal-cell${isToday?' cal-cell-today':''}${events.length?' cal-cell-has-events':''}${dayFill}" onclick="calDayClick(${day})">
      <div class="cal-day-num">${day}</div>
      <div class="cal-dots">${dots}${extra}</div>
    </div>`;
  }
  grid.innerHTML = html;
  syncCalendarPaneHeight();
}

// Pins the "All milestones" panel's height to the calendar panel's own
// rendered height, so it scrolls internally instead of pushing the page
// down when a month has a lot of milestones.
function syncCalendarPaneHeight() {
  requestAnimationFrame(() => {
    const calPanel = document.getElementById('cal-grid')?.closest('.panel');
    const msPanel  = document.getElementById('cal-upcoming-panel');
    if (!calPanel || !msPanel) return;
    msPanel.style.maxHeight = calPanel.offsetHeight + 'px';
  });
}
window.addEventListener('resize', () => {
  clearTimeout(window._calResizeT);
  window._calResizeT = setTimeout(syncCalendarPaneHeight, 150);
});

export function drawMilestoneList() {
  const listEl = document.getElementById('cal-milestone-list');
  const panel  = document.querySelector('#cal-upcoming-panel .panel-title');
  if (!listEl) return;
  if (panel) panel.textContent = 'All milestones this month';
  const hits = getCalMilestones().filter(m => {
    const d = new Date(m.date);
    return d.getFullYear()===calCurrentYear && d.getMonth()===calCurrentMonth;
  }).sort((a,b) => new Date(a.date)-new Date(b.date));
  listEl.innerHTML = hits.length
    ? hits.map(buildMilestoneRow).join('')
    : '<div class="empty-state-sm"><p>No milestones set for this month.</p></div>';
}

function buildMilestoneRow(m) {
  const meta = STATUS_META[m.effectiveStatus] || STATUS_META['on-track'];
  return `<div class="milestone-row">
    <span class="leg-dot" style="flex-shrink:0;margin-top:4px;background:${meta.color};"></span>
    <div class="milestone-info">
      <div class="milestone-pillar">${m.pillarName}</div>
      <div class="milestone-product">${m.productName} — ${formatDate(m.date)}</div>
    </div>
    <span class="status-pill ${meta.cls}">${meta.label}</span>
  </div>`;
}

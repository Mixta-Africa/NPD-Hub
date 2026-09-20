/* views/dashboard-charts.js — Dashboard charts (Chart.js). */

import { canViewTask } from '../data/permissions.js';
import { getProductTasks } from '../data/product-model.js';
import { resolveTaskStatus } from '../data/status.js';

/* ══ DASHBOARD DATA VISUALIZATION (CHART.JS) ══════════════ */
window._dashCharts = {}; 

function positionChartPulse() {
  const chart = window._dashCharts.line;
  const dot   = document.getElementById('progress-pulse-dot');
  if (!chart || !dot) return;
  const data = chart.data.datasets[1]?.data || [];
  let idx = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] !== null && data[i] !== undefined) { idx = i; break; }
  }
  if (idx === -1) { dot.style.display = 'none'; return; }
  const meta = chart.getDatasetMeta(1);
  const pt   = meta?.data?.[idx];
  if (!pt) return;
  dot.style.left = pt.x + 'px';
  dot.style.top  = pt.y + 'px';
  dot.style.display = 'block';
}
window.addEventListener('resize', () => { clearTimeout(window._pulseResizeT); window._pulseResizeT = setTimeout(positionChartPulse, 150); });

export function renderDashboardCharts(list) {
  if (typeof Chart === 'undefined') return;

  // 1. Overall Completion Donut
  const ctxDonut = document.getElementById('completionChart');
  if (ctxDonut) {
    let total = 0, done = 0, overdue = 0;
    list.forEach(p => {
      const tasks = getProductTasks(p).filter(t => canViewTask(t, p));
      tasks.forEach(t => {
        total++;
        const st = resolveTaskStatus(t, p);
        if (st === 'complete') done++;
        else if (st === 'overdue' || st === 'delayed' || st === 'blocked') overdue++;
      });
    });
    const open = Math.max(0, total - done - overdue);
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    // Soft drop shadow beneath the ring — canvas-level filter, not a box on the container
    ctxDonut.style.filter = 'drop-shadow(0 6px 14px rgba(16,24,40,0.12))';

    // Center Text Overlay
    const donutContainer = ctxDonut.parentElement;
    let centerText = document.getElementById('donut-center-text');
    if(!centerText) {
        centerText = document.createElement('div');
        centerText.id = 'donut-center-text';
        centerText.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); text-align:center; pointer-events:none;';
        donutContainer.appendChild(centerText);
    }
    centerText.innerHTML = `<div style="font-size:22px;font-weight:700;color:#1A1A1A;line-height:1;letter-spacing:-0.5px;">${pct}%</div><div style="font-size:9px;color:var(--text-muted);margin-top:4px;">Across all projects</div>`;

    if (window._dashCharts.donut) window._dashCharts.donut.destroy();
    window._dashCharts.donut = new Chart(ctxDonut, {
      type: 'doughnut',
      data: {
        labels: ['Done', 'On track', 'Risk'],
        datasets: [{
          data: [done, open, overdue],
          backgroundColor: ['#16A34A', '#E5E7EB', '#C0282D'],
          borderColor: '#fff',
          borderWidth: 2,
          borderRadius: 3,
          spacing: 2,
          hoverOffset: 6
        }]
      },
      options: {
        cutout: '72%', responsive: true, maintainAspectRatio: false,
        animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
        plugins: { 
          legend: { display: false }, /* NO ChartJS LEGEND */
          tooltip: { enabled: true } 
        }
      }
    });

    const legEl = document.getElementById('donut-legend');
    if (legEl) legEl.innerHTML = `
      <div style="display:flex;gap:24px;justify-content:center;align-items:center;">
        <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#16A34A;margin-right:6px;"></span><strong style="color:#1A1A1A;margin-right:4px;">${done}</strong> Done</div>
        <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#E5E7EB;margin-right:6px;"></span><strong style="color:#1A1A1A;margin-right:4px;">${open}</strong> On track</div>
        <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#C0282D;margin-right:6px;"></span><strong style="color:#1A1A1A;margin-right:4px;">${overdue}</strong> Risk</div>
      </div>`;
  }

  // 2. Line Chart (Progress over time)
  const ctxLine = document.getElementById('progressChart');
  if (ctxLine) {
    const ctx = ctxLine.getContext('2d');

    // Layered gradients for both series — richer near the line, fully transparent at the base
    const redGradient = ctx.createLinearGradient(0, 0, 0, 190);
    redGradient.addColorStop(0,   'rgba(192, 40, 45, 0.22)');
    redGradient.addColorStop(0.6, 'rgba(192, 40, 45, 0.06)');
    redGradient.addColorStop(1,   'rgba(192, 40, 45, 0.0)');

    const greenGradient = ctx.createLinearGradient(0, 0, 0, 190);
    greenGradient.addColorStop(0,   'rgba(22, 163, 74, 0.18)');
    greenGradient.addColorStop(0.6, 'rgba(22, 163, 74, 0.05)');
    greenGradient.addColorStop(1,   'rgba(22, 163, 74, 0.0)');

    if (window._dashCharts.line) window._dashCharts.line.destroy();
    
    let totalTasks = 0, doneTasks = 0;
    list.forEach(p => {
      const t = getProductTasks(p);
      totalTasks += t.length;
      doneTasks += t.filter(x => resolveTaskStatus(x, p) === 'complete').length;
    });
    const finalPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

    // Build a 5-month window centred on the REAL current month, not a hardcoded
    // "Aug..Dec" range. "Actual" only gets real values up to and including the
    // current month — future months are null so the line and its fill genuinely
    // stop at today instead of pretending to know progress that hasn't happened.
    const now = new Date();
    const labels = [];
    for (let i = -2; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      labels.push(d.toLocaleDateString('en-GB', { month: 'short' }));
    }
    const todayIdx = 2; // middle of the -2..+2 window is always the current month

    // Planned is a forward-looking target trajectory — future values are expected here.
    const plannedData = [10, 30, 55, 78, 100];

    // Actual: a light ramp toward today's real completion % for past/current months
    // (we don't store historical daily snapshots, so these earlier points are an
    // approximation, not logged history) — anything after today is null, full stop.
    const actualData = [
      Math.max(0, Math.round(finalPct * 0.35)),
      Math.max(0, Math.round(finalPct * 0.65)),
      finalPct,
      null,
      null,
    ];
    
    window._dashCharts.line = new Chart(ctxLine, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Planned',
            data: plannedData,
            borderColor: '#16A34A', backgroundColor: greenGradient,
            fill: true, tension: 0.4, borderWidth: 2.5,
            borderCapStyle: 'round', borderJoinStyle: 'round',
            pointRadius: 3, pointHoverRadius: 6,
            pointBackgroundColor: '#16A34A', pointBorderColor: '#fff', pointBorderWidth: 2,
          },
          {
            label: 'Actual',
            data: actualData,
            spanGaps: false,
            borderColor: '#C0282D', 
            backgroundColor: redGradient,
            fill: true, tension: 0.4, borderWidth: 2.5,
            borderCapStyle: 'round', borderJoinStyle: 'round',
            pointRadius: 3, pointHoverRadius: 6,
            pointBackgroundColor: '#C0282D', pointBorderColor: '#fff', pointBorderWidth: 2,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 14, right: 6 } },
        animation: { duration: 700, easing: 'easeOutQuart', onComplete: positionChartPulse },
        plugins: { 
          legend: { display: false } /* Disabled duplicate legend */
        },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v+'%', font:{family:'Poppins', size:10} }, grid: { borderDash: [4,4], color: '#E5E7EB' }, border: {display: false} },
          x: { grid: { display: false }, border: {display: false}, ticks: { font:{family:'Poppins', size:11} } }
        }
      }
    });

    // Pulsing "live" marker on the most recent Actual data point
    const chartWrap = ctxLine.parentElement;
    let pulseDot = document.getElementById('progress-pulse-dot');
    if (!pulseDot) {
      pulseDot = document.createElement('div');
      pulseDot.id = 'progress-pulse-dot';
      pulseDot.className = 'chart-pulse-dot';
      chartWrap.appendChild(pulseDot);
    }
    setTimeout(positionChartPulse, 50);
  }
}

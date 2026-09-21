/* features/weekly-report.js — "My weekly report": what you finished, what rolled over from earlier weeks, and the analysis.
   Opened from the My Actions page (Weekly report button) and the Progress Reports page.

   HOW A WEEK IS MEASURED (ISO weeks, Monday–Sunday)
   • An item belongs to a week by its DEADLINE (personal to-dos: their week tag).
   • Workload of week W = items due in W  +  items CARRIED IN (due in an earlier week and still open when W began).
   • Completed  = finished by the end of W.   Rolled = still open when W ended (it rolls into the next week).
   • On-time    = finished on or before its deadline. Needs a completion time, which is recorded from now on
                  (completedAt); older completions have none and are counted as done but excluded from on-time stats.
   The engine at the top of this file is pure (no DOM, no database) so it can be tested with plain data. */

import { db, ref, get } from '../core/firebase.js';
import { standaloneRef, collectMyActionRecords, isoWeekKey, weekKeyLabel, parseLocalDate, effWeek } from '../views/myactions.js';
import { ensureProductModal } from './product-form.js';

/* ═══════════════ 1. ENGINE (pure) ═══════════════ */
const DAY = 86400000;
// A week-on-week comparison is only meaningful when the earlier week had a real workload; 2 items -> "up 50 points" is noise.
const MIN_COMPARE = 3;

export function weekStart(weekKey) {                 // Monday 00:00 (local)
  const [y, w] = weekKey.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (w - 1) * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}
export function weekEnd(weekKey) {                   // Sunday 23:59:59.999 (local)
  const e = weekStart(weekKey);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
export function shiftWeek(weekKey, n) {
  const s = weekStart(weekKey);
  s.setDate(s.getDate() + 7 * n);
  return isoWeekKey(s);
}
function weeksBetween(fromWeek, toWeek) {
  return Math.max(0, Math.round((weekStart(toWeek) - weekStart(fromWeek)) / (7 * DAY)));
}
function endOfDay(d) { const e = new Date(d); e.setHours(23, 59, 59, 999); return e; }

// Completion time for a project task: the stamp we now record, else the history entry written when a
// completion was approved. Anything else is genuinely unknown (null) and is never guessed.
function completionTime(task) {
  if (typeof task.completedAt === 'number') return task.completedAt;
  const hist = task.updates ? Object.values(task.updates) : [];
  const hit = hist.filter(h => h && h.changeType === 'approval' && typeof h.createdAt === 'number')
                  .sort((a, b) => b.createdAt - a.createdAt)[0];
  return hit ? hit.createdAt : null;
}

export function normalizeItems({ records = [], personal = [] }) {
  const items = [];
  for (const r of records) {
    const t = r.task, deadline = parseLocalDate(t.deadline);
    items.push({
      key: 'p:' + r.prod.id + ':' + t.id, source: 'project', title: t.title || t.name || 'Untitled task',
      project: r.prod.name || 'Project', prodId: r.prod.id, taskId: t.id,
      deadline, week: deadline ? isoWeekKey(deadline) : null,
      done: r.eff === 'complete', completedAt: r.eff === 'complete' ? completionTime(t) : null,
      rollCount: 0, closed: null,
    });
  }
  for (const t of personal) {
    const deadline = parseLocalDate(t.deadline), done = t.status === 'complete';
    items.push({
      key: 's:' + t.id, source: 'personal', title: t.title || 'Untitled task', project: 'Personal to-do', id: t.id,
      deadline, week: effWeek(t),
      done, completedAt: done && typeof t.completedAt === 'number' ? t.completedAt : null,
      rollCount: t.rollCount || 0,
      closed: t.rolledOver ? 'rolled' : (t.reviewed && !done ? 'missed' : null),
    });
  }
  return items;
}

// Where does `item` stand in week W?  null = not part of that week's workload.
export function classify(item, W, now) {
  if (!item.week) return null;
  const startMs = weekStart(W).getTime(), endMs = weekEnd(W).getTime();
  const due = item.week === W;
  let carried = false;
  if (!due && item.week < W) {
    if (item.closed) carried = false;                                   // closed in its own week (a rolled copy carries on)
    else if (!item.done) carried = true;
    else carried = !!(item.completedAt && item.completedAt >= startMs); // finished during/after W ⇒ was open when W began
  }
  if (!due && !carried) return null;

  const finished = item.done && (item.completedAt == null || item.completedAt <= endMs);
  if (finished) return { state: 'completed', carried };
  if (item.closed === 'missed' && due) return { state: 'missed', carried: false };
  if (item.closed === 'rolled' && due) return { state: 'rolled', carried };

  const nowMs = now.getTime();
  if (nowMs >= startMs && nowMs <= endMs) {                            // the week is still in progress
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const notYetDue = !item.deadline || item.deadline >= today;
    return { state: notYetDue && !carried ? 'upcoming' : 'overdue', carried };
  }
  return { state: 'rolled', carried };                                 // week over, still open ⇒ rolls forward
}

export function computeWeekReport({ items, week, now }) {
  const rows = [];
  for (const it of items) { const c = classify(it, week, now); if (c) rows.push({ it, ...c }); }
  const by = (s) => rows.filter(r => r.state === s);
  const completed = by('completed'), rolled = by('rolled'), missed = by('missed'), overdue = by('overdue'), upcoming = by('upcoming');

  const timed = completed.filter(r => r.it.completedAt && r.it.deadline);
  const onTime = timed.filter(r => r.it.completedAt <= endOfDay(r.it.deadline).getTime());
  const late = timed.filter(r => r.it.completedAt > endOfDay(r.it.deadline).getTime());
  const lateDays = late.map(r => Math.ceil((r.it.completedAt - endOfDay(r.it.deadline).getTime()) / DAY));

  const open = [...rolled, ...overdue];
  const carriedAge = (r) => Math.max(weeksBetween(r.it.week, week), r.it.rollCount || 0);
  const chronic = open.map(r => ({ r, weeks: carriedAge(r) })).filter(x => x.weeks >= 2).sort((a, b) => b.weeks - a.weeks);

  const projects = {};
  rows.forEach(r => {
    const p = (projects[r.it.project] = projects[r.it.project] || { name: r.it.project, workload: 0, completed: 0, open: 0 });
    p.workload++;
    if (r.state === 'completed') p.completed++;
    else if (r.state === 'rolled' || r.state === 'overdue') p.open++;
  });

  const workload = rows.length;
  return {
    week, workload, rows, completed, rolled, missed, overdue, upcoming, open,
    carriedIn: rows.filter(r => r.carried),
    dueThisWeek: rows.filter(r => !r.carried),
    rate: workload ? Math.round((completed.length / workload) * 100) : null,
    timingKnown: timed.length, onTime: onTime.length, late: late.length,
    onTimeRate: timed.length ? Math.round((onTime.length / timed.length) * 100) : null,
    avgLateDays: lateDays.length ? Math.round((lateDays.reduce((a, b) => a + b, 0) / lateDays.length) * 10) / 10 : null,
    untimed: completed.length - timed.length,
    chronic,
    byProject: Object.values(projects).sort((a, b) => b.workload - a.workload),
  };
}

export function computeTrend({ items, week, now, weeks = 6 }) {
  const out = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const w = shiftWeek(week, -k), r = computeWeekReport({ items, week: w, now });
    out.push({ week: w, rate: r.rate, workload: r.workload, completed: r.completed.length });
  }
  return out;
}

export function buildInsights(rep, prev, isCurrent) {
  const out = [], plural = (n, s, p) => n + ' ' + (n === 1 ? s : p);
  if (!rep.workload) return [{ tone: 'info', text: isCurrent ? 'Nothing is planned for this week yet.' : 'Nothing was due, and nothing was carried in, that week.' }];

  let head = `${isCurrent ? 'So far you have completed' : 'You completed'} ${rep.completed.length} of ${plural(rep.workload, 'item', 'items')} (${rep.rate}%)`;
  if (prev && prev.rate != null) {
    const d = rep.rate - prev.rate;
    head += d === 0 ? ', the same as the week before.' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points on the week before (${prev.rate}%).`;
  } else head += '.';
  out.push({ tone: rep.rate >= 75 ? 'good' : rep.rate >= 40 ? 'info' : 'warn', text: head });

  if (rep.timingKnown) {
    let t = `${rep.onTime} of ${rep.timingKnown} completed items were finished on or before their deadline (${rep.onTimeRate}%).`;
    if (rep.late) t += ` The ${rep.late === 1 ? 'late one' : 'late ones'} slipped ${rep.avgLateDays} day${rep.avgLateDays === 1 ? '' : 's'} on average.`;
    out.push({ tone: rep.onTimeRate >= 80 ? 'good' : rep.onTimeRate >= 50 ? 'info' : 'warn', text: t });
  }
  if (rep.untimed > 0) out.push({ tone: 'info', text: `${plural(rep.untimed, 'completion', 'completions')} predate completion-time tracking, so they count as done but are left out of the on-time figure. New completions are timed automatically.` });

  const carriedShare = Math.round((rep.carriedIn.length / rep.workload) * 100);
  if (rep.carriedIn.length) out.push({ tone: carriedShare >= 50 ? 'warn' : 'info', text: `${plural(rep.carriedIn.length, 'item was', 'items were')} carried in from earlier weeks (${carriedShare}% of the workload).${carriedShare >= 50 ? ' Over half your week was spent on carry-over: protect time for it, or renegotiate those deadlines.' : ''}` });

  const open = rep.open.length;
  if (open) out.push({ tone: 'warn', text: isCurrent ? `${plural(open, 'item is', 'items are')} overdue right now${rep.upcoming.length ? ', with ' + rep.upcoming.length + ' more still due later this week' : ''}.` : `${plural(open, 'item rolls', 'items roll')} into the next week.` });
  else if (rep.rate === 100 || (!open && rep.upcoming.length === 0)) out.push({ tone: 'good', text: 'Nothing is left open. Clean week.' });

  rep.chronic.slice(0, 3).forEach(x => out.push({ tone: 'warn', text: `"${x.r.it.title}" has now been carried for ${x.weeks} weeks. Consider splitting it, extending its deadline with a reason, or dropping it.` }));

  const top = rep.byProject.filter(p => p.open > 0).sort((a, b) => b.open - a.open)[0];
  if (top && rep.open.length >= 3 && top.open / rep.open.length >= 0.5) out.push({ tone: 'info', text: `${top.name} holds ${top.open} of your ${rep.open.length} open items. That is where the week is stalling.` });
  return out;
}

/* ═══════════════ 2. RENDERING ═══════════════ */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date';
const rangeLabel = (w) => weekStart(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + weekEnd(w).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

let _wr = { week: null, items: null, now: null };

function itemRow(r, current) {
  const it = r.it;
  const tag = r.carried ? '<span class="wr-chip wr-chip-carry">↻ carried in</span>' : '';
  const due = it.deadline ? 'Due ' + fmt(it.deadline) : 'No date';
  let extra = '';
  if (r.state === 'completed' && it.completedAt) {
    const late = it.deadline && it.completedAt > endOfDay(it.deadline).getTime();
    extra = `<span class="wr-chip ${late ? 'wr-chip-late' : 'wr-chip-ok'}">${late ? 'Late' : 'On time'}</span>`;
  }
  let actions = '';
  if (current && (r.state === 'overdue' || r.state === 'upcoming')) {
    actions = it.source === 'project'
      ? `<span class="wr-row-actions"><button class="btn-outline" onclick="showTaskRequestModal('${esc(it.prodId)}','${esc(it.taskId)}','done')">Done</button><button class="btn-outline" onclick="showTaskRequestModal('${esc(it.prodId)}','${esc(it.taskId)}','extend')">Extend</button></span>`
      : `<span class="wr-row-actions"><button class="btn-outline" onclick="weeklyReportTick('${esc(it.id)}')">Done</button></span>`;
  }
  return `<div class="wr-row"><div class="wr-row-main"><div class="wr-row-title">${esc(it.title)}</div><div class="wr-row-sub">${esc(it.project)} · ${due}${it.rollCount ? ' · rolled ' + it.rollCount + '×' : ''}</div></div><div class="wr-row-tags">${tag}${extra}</div>${actions}</div>`;
}
function section(title, rows, current, emptyText) {
  return `<div class="wr-section"><div class="wr-section-title">${esc(title)} <span class="wr-count">${rows.length}</span></div>` +
    (rows.length ? rows.map(r => itemRow(r, current)).join('') : `<div class="wr-empty">${esc(emptyText)}</div>`) + '</div>';
}

function trendChart(trend) {
  return '<div class="wr-trend">' + trend.map(t => {
    const h = t.rate == null ? 4 : Math.max(6, t.rate);
    const cls = t.rate == null ? 'wr-bar-none' : t.rate >= 75 ? 'wr-bar-good' : t.rate >= 40 ? 'wr-bar-mid' : 'wr-bar-low';
    return `<div class="wr-trend-col"><div class="wr-trend-val">${t.rate == null ? '–' : t.rate + '%'}</div><div class="wr-bar ${cls}" style="height:${h}px"></div><div class="wr-trend-lbl">${esc(weekKeyLabel(t.week).replace('Week of ', ''))}</div></div>`;
  }).join('') + '</div>';
}

function buildReport(week) {
  const now = _wr.now, cur = isoWeekKey(now), isCurrent = week === cur;
  const rep = computeWeekReport({ items: _wr.items, week, now });
  const prev = computeWeekReport({ items: _wr.items, week: shiftWeek(week, -1), now });
  // Never compare a week that is still in progress with a finished one: on Monday morning that always looks like a collapse.
  const comparable = (!isCurrent && prev.workload >= MIN_COMPARE) ? prev : null;
  const insights = buildInsights(rep, comparable, isCurrent);
  const trend = computeTrend({ items: _wr.items, week, now, weeks: 6 });
  const delta = comparable && comparable.rate != null && rep.rate != null ? rep.rate - comparable.rate : null;

  const kpi = (label, value, sub, cls) => `<div class="wr-kpi ${cls || ''}"><div class="wr-kpi-label">${label}</div><div class="wr-kpi-value">${value}</div><div class="wr-kpi-sub">${sub}</div></div>`;
  const kpis = '<div class="wr-kpis">' +
    kpi('Completed', `${rep.completed.length}<span class="wr-of"> / ${rep.workload}</span>`, isCurrent ? 'so far this week' : 'of the week’s workload', '') +
    kpi('Completion rate', rep.rate == null ? '–' : rep.rate + '%', delta == null ? (isCurrent ? 'week still in progress' : 'no earlier week to compare') : (delta === 0 ? 'same as last week' : (delta > 0 ? '▲ ' : '▼ ') + Math.abs(delta) + ' pts vs last week'), delta == null ? '' : delta >= 0 ? 'wr-up' : 'wr-down') +
    kpi('On time', rep.onTimeRate == null ? '–' : rep.onTimeRate + '%', rep.timingKnown ? `${rep.onTime} of ${rep.timingKnown} timed` : 'no timed completions yet', '') +
    kpi(isCurrent ? 'Carried in' : 'Rolled over', isCurrent ? rep.carriedIn.length : rep.open.length, isCurrent ? 'from earlier weeks' : 'into next week', (isCurrent ? rep.carriedIn.length : rep.open.length) ? 'wr-warn' : '') +
    '</div>';

  const tabs = `<div class="wr-toolbar">
      <div class="wr-nav"><button class="btn-outline wr-arrow" onclick="weeklyReportGo('${shiftWeek(week, -1)}')" title="Previous week">‹</button>
        <div class="wr-range"><div class="wr-range-main">${rangeLabel(week)}</div><div class="wr-range-sub">${isCurrent ? 'This week, in progress' : 'Final'}</div></div>
        <button class="btn-outline wr-arrow" ${isCurrent ? 'disabled' : ''} onclick="weeklyReportGo('${shiftWeek(week, 1)}')" title="Next week">›</button></div>
      <div class="wr-quick"><button class="btn-outline ${week === shiftWeek(cur, -1) ? 'wr-on' : ''}" onclick="weeklyReportGo('${shiftWeek(cur, -1)}')">Last week</button><button class="btn-outline ${isCurrent ? 'wr-on' : ''}" onclick="weeklyReportGo('${cur}')">This week</button></div>
    </div>`;

  const analysis = '<div class="wr-section"><div class="wr-section-title">Analysis</div><ul class="wr-insights">' +
    insights.map(i => `<li class="wr-ins wr-ins-${i.tone}"><span class="wr-dot"></span><span>${esc(i.text)}</span></li>`).join('') + '</ul></div>';
  const trendBlock = `<div class="wr-section"><div class="wr-section-title">Completion rate, last 6 weeks</div>${trendChart(trend)}</div>`;

  const lists = isCurrent
    ? section('Carried in from earlier weeks', rep.carriedIn.filter(r => r.state !== 'completed'), true, 'Nothing carried in. You started the week clean.') +
      section('Due this week, still to do', rep.dueThisWeek.filter(r => r.state === 'upcoming' || r.state === 'overdue'), true, 'Nothing left open that is due this week.') +
      section('Completed this week', rep.completed, false, 'Nothing completed yet.')
    : section('Completed', rep.completed, false, 'Nothing was completed that week.') +
      section('Rolled over into the following week', rep.open.length ? rep.open : [], false, 'Nothing rolled over. Everything was closed out.') +
      (rep.missed.length ? section('Left as missed (personal to-dos)', rep.missed, false, '') : '');

  const proj = rep.byProject.length ? '<div class="wr-section"><div class="wr-section-title">By project</div>' + rep.byProject.map(p => {
    const pct = p.workload ? Math.round((p.completed / p.workload) * 100) : 0;
    return `<div class="wr-proj"><div class="wr-proj-name">${esc(p.name)}</div><div class="wr-proj-bar"><div class="wr-proj-fill" style="width:${pct}%"></div></div><div class="wr-proj-num">${p.completed}/${p.workload}${p.open ? ` <span class="wr-proj-open">· ${p.open} open</span>` : ''}</div></div>`;
  }).join('') + '</div>' : '';

  const foot = '<div class="wr-foot"><button class="btn-outline" onclick="weeklyReportCopy()">Copy as text</button><button class="btn-primary" onclick="weeklyReportPrint()">Print / save as PDF</button></div>';

  _wr.last = { rep, insights, week, isCurrent };
  return tabs + kpis + analysis + trendBlock + lists + proj + foot;
}

function reportText() {
  const { rep, insights, week, isCurrent } = _wr.last;
  const L = [`MY WEEKLY REPORT — ${rangeLabel(week)}${isCurrent ? ' (in progress)' : ''}`, '',
    `Completed: ${rep.completed.length} of ${rep.workload}${rep.rate == null ? '' : ' (' + rep.rate + '%)'}`,
    `On time: ${rep.onTimeRate == null ? 'n/a' : rep.onTimeRate + '% (' + rep.onTime + ' of ' + rep.timingKnown + ' timed)'}`,
    `${isCurrent ? 'Carried in' : 'Rolled over'}: ${isCurrent ? rep.carriedIn.length : rep.open.length}`, '', 'ANALYSIS', ...insights.map(i => '• ' + i.text), ''];
  const list = (t, rows) => { L.push(t.toUpperCase() + ' (' + rows.length + ')'); rows.forEach(r => L.push(`  - ${r.it.title} [${r.it.project}${r.it.deadline ? ', due ' + fmt(r.it.deadline) : ''}]${r.carried ? ' (carried in)' : ''}`)); L.push(''); };
  list('Completed', rep.completed);
  if (isCurrent) { list('Carried in, still open', rep.carriedIn.filter(r => r.state !== 'completed')); list('Due this week, still to do', rep.dueThisWeek.filter(r => r.state === 'upcoming' || r.state === 'overdue')); }
  else list('Rolled over to next week', rep.open);
  return L.join('\n');
}

/* ═══════════════ 3. DATA + HANDLERS ═══════════════ */
async function loadItems() {
  const records = await collectMyActionRecords();
  let personal = [];
  try {
    const snap = await get(ref(db, standaloneRef()));
    personal = snap.exists() ? Object.values(snap.val()).filter(t => t && t.id && !String(t.id).startsWith('_')) : [];
  } catch (e) { console.warn('weekly report: personal tasks unavailable', e); }
  return normalizeItems({ records, personal });
}

function paint(week) {
  _wr.week = week;
  const body = document.getElementById('modal-body-content');
  if (body) { body.innerHTML = '<div class="wr-root">' + buildReport(week) + '</div>'; body.scrollTop = 0; }
}

window.openWeeklyReport = async (weekKey) => {
  ensureProductModal();
  document.getElementById('modal-title-text').textContent = 'My weekly report';
  document.getElementById('modal-body-content').innerHTML = '<div class="wr-root"><div class="loading-row" style="padding:32px;">Building your report…</div></div>';
  document.getElementById('create-product-modal').style.display = 'flex';
  try {
    _wr.now = new Date();
    _wr.items = await loadItems();
    const cur = isoWeekKey(_wr.now), dow = _wr.now.getDay() || 7;
    // Monday to Wednesday you are usually reviewing the week that just ended; later in the week, the current one.
    paint(weekKey || (dow <= 3 ? shiftWeek(cur, -1) : cur));
  } catch (e) {
    console.warn('openWeeklyReport failed:', e);
    document.getElementById('modal-body-content').innerHTML = '<div class="wr-root"><div class="loading-row" style="padding:32px;">Could not build the report. Try again.</div></div>';
  }
};
window.weeklyReportGo = (week) => { if (_wr.items) paint(week); };
window.weeklyReportTick = async (id) => {
  await window.toggleStandaloneTask(id, true);
  _wr.items = await loadItems(); paint(_wr.week);
};
window.weeklyReportCopy = async () => {
  const text = reportText();
  try { await navigator.clipboard.writeText(text); showToast('Report copied. Paste it into an email or chat.', 'success'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('Report copied.', 'success'); } catch (e2) { showToast('Could not copy.', 'error'); }
    ta.remove();
  }
};
window.weeklyReportPrint = () => {
  const { rep, insights, week, isCurrent } = _wr.last;
  const w = window.open('', '_blank');
  if (!w) { showToast('Pop-up blocked. Allow pop-ups to print the report.', 'error'); return; }
  const rows = (t, list) => `<h3>${esc(t)} (${list.length})</h3>` + (list.length ? '<ul>' + list.map(r => `<li>${esc(r.it.title)} <span class="m">— ${esc(r.it.project)}${r.it.deadline ? ', due ' + fmt(r.it.deadline) : ''}${r.carried ? ', carried in' : ''}</span></li>`).join('') + '</ul>' : '<p class="m">None</p>');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>My weekly report</title><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;padding:36px;max-width:780px;margin:auto}
    h1{font-size:20px;margin:0 0 2px}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b67;margin:22px 0 8px}h3{font-size:13px;margin:18px 0 6px}
    .sub{color:#6b6b67;font-size:12px;margin-bottom:16px}.k{display:flex;gap:12px;margin:12px 0}.k div{flex:1;border:1px solid #e5e4e0;border-radius:8px;padding:10px 12px}
    .k b{display:block;font-size:20px}.k span{font-size:11px;color:#6b6b67}ul{padding-left:18px;font-size:12.5px;line-height:1.6}.m{color:#6b6b67}
    </style></head><body><h1>My weekly report</h1><div class="sub">${esc(rangeLabel(week))}${isCurrent ? ' (in progress)' : ''}</div>
    <div class="k"><div><b>${rep.completed.length} / ${rep.workload}</b><span>Completed</span></div><div><b>${rep.rate == null ? '–' : rep.rate + '%'}</b><span>Completion rate</span></div><div><b>${rep.onTimeRate == null ? '–' : rep.onTimeRate + '%'}</b><span>On time</span></div><div><b>${isCurrent ? rep.carriedIn.length : rep.open.length}</b><span>${isCurrent ? 'Carried in' : 'Rolled over'}</span></div></div>
    <h2>Analysis</h2><ul>${insights.map(i => '<li>' + esc(i.text) + '</li>').join('')}</ul>
    ${rows('Completed', rep.completed)}${isCurrent ? rows('Carried in, still open', rep.carriedIn.filter(r => r.state !== 'completed')) + rows('Due this week, still to do', rep.dueThisWeek.filter(r => r.state === 'upcoming' || r.state === 'overdue')) : rows('Rolled over to next week', rep.open)}
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
};

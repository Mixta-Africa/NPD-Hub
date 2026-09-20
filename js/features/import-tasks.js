/* features/import-tasks.js — Excel task import. */

import { getDepts, STAKEHOLDERS } from '../data/app-config.js';
import { _editingTasks, buildTaskEditorForm, set_editingTasks } from './task-editor.js';
import { generateTaskId } from '../data/product-model.js';
import { formatDate } from '../data/status.js';

/* ══ EXCEL TASK IMPORT ══════════════════════════════════════
   Third task-input option. Parses a spreadsheet into _editingTasks
   using the SAME shape the other two options produce, so everything
   downstream (owner chips, email routing, workload, digests) works
   without special-casing imported tasks. Owners resolve to canonical
   emails via the live directory — never stored as bare name strings.
   ══════════════════════════════════════════════════════════════ */
window.showImportScreen = () => {
  document.getElementById('modal-body-content').innerHTML =
    '<div style="padding:4px 0;">' +
      '<p style="font-size:13px;color:var(--text-mid);line-height:1.7;margin-bottom:16px;">' +
        'Upload an .xlsx or .csv file. The first row must be headers. ' +
        'Columns are matched by name, so order does not matter and extra columns are ignored.' +
      '</p>' +
      '<div style="background:#F8F8F7;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:8px;">Recognised columns</div>' +
        '<div style="font-size:12px;color:var(--text);line-height:1.9;">' +
          '<strong>Task</strong> <span style="color:#9CA3AF;">(required)</span> — also accepts: Task Name, Title, Activity, Next Steps, Action, Milestone<br>' +
          '<strong>Owner</strong> — also accepts: Task Owner, Assignee, Responsible, Person<br>' +
          '<strong>Department</strong> — also accepts: Dept, Team, Function<br>' +
          '<strong>Deadline</strong> — also accepts: Due Date, Date, Timeline, Target Date<br>' +
          '<strong>Status</strong> — also accepts: Progress, State' +
        '</div>' +
      '</div>' +
      '<input type="file" id="import-file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="handleImportFile(event)"/>' +
      '<button class="btn-primary" style="width:100%;padding:14px;" onclick="document.getElementById(\'import-file\').click()">' +
        'Choose spreadsheet' +
      '</button>' +
      '<div id="import-preview" style="margin-top:16px;"></div>' +
      '<div class="form-actions" style="margin-top:18px;">' +
        '<button class="btn-outline" onclick="showCreateProduct()">← Back</button>' +
      '</div>' +
    '</div>';
};

// Header aliases — lowercase, punctuation-stripped
const IMPORT_COLS = {
  title:    ['task','taskname','title','activity','nextsteps','action','actionitem','actionpoint','milestone',
             'deliverable','description','item','itemdescription','issue','workstream','subject','topic'],
  owner:    ['owner','taskowner','assignee','responsible','responsibleparty','person','assignedto','who',
             'actionby','lead','accountable'],
  dept:     ['department','dept','team','function','unit','division'],
  deadline: ['deadline','duedate','date','timeline','targetdate','due','nextstepstimeline','completiondate',
             'targetcompletion','expecteddate','eta','bywhen','lastupdate','resolved'],
  status:   ['status','progress','state','currentstatus','statusatlastmeeting','ragstatus','rag'],
  notes:    ['notes','note','comment','comments','remarks','update','updates','context','finaloutcome','detail','details'],
};

function normaliseHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapImportHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const n = normaliseHeader(h);
    if (!n) return;
    for (const field in IMPORT_COLS) {
      if (map[field] !== undefined) continue;
      if (IMPORT_COLS[field].includes(n)) { map[field] = i; return; }
    }
  });
  return map;
}

// Excel serial dates, Date objects and common text formats → YYYY-MM-DD
function parseImportDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

/* Status vocabulary covers plain words, the Lakowe RAG scheme
   (Green/Amber/Red/Grey), and the emoji flags used in the New Items tab. */
function normaliseImportStatus(v) {
  const raw = String(v || '').trim();
  if (!raw) return 'on-track';
  if (/[\u2705]/.test(raw)) return 'complete';                    // check mark
  if (/[\u23F8\u26A0]/.test(raw)) return 'delayed';              // pause / warning
  const s = raw.toLowerCase();
  // 'green' deliberately NOT treated as complete — in the RAG scheme it means
  // on-track OR completed, and wrongly marking complete hides it from alerts.
  if (/(done|complete|closed|finished|resolved|delivered|approved)/.test(s)) return 'complete';
  if (/(delay|blocked|behind|slipp|at.?risk|escalate|stalled|paused|on.?hold|overdue|red|amber)/.test(s)) return 'delayed';
  return 'on-track';
}

// Strip leading status emoji / bullet glyphs from an imported title cell
function cleanImportTitle(v) {
  return String(v || '')
    .replace(/^[\s\u2022\u2705\u23F8\u26A0\u{1F195}\u{1F534}\u{1F7E1}\u{1F7E2}\u26AA*\-]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Resolve a spreadsheet owner cell to canonical identity.
   Accepts a name, an email, or a department. Returns
   { dept, email, nameCache, matched } — matched=false means we
   kept the text for display but could not resolve an address. */
function resolveImportOwner(ownerText, deptText) {
  const raw   = String(ownerText || '').trim();
  const depts = getDepts();
  let dept = String(deptText || '').trim();

  // Validate the declared department against the live directory
  if (dept) {
    const hit = depts.find(d => d.toLowerCase() === dept.toLowerCase());
    dept = hit || dept;
  }
  if (!raw) return { dept, email: '', nameCache: '', matched: !!dept };

  // Direct email
  if (raw.includes('@')) {
    const s = STAKEHOLDERS.find(x => x.email.toLowerCase() === raw.toLowerCase());
    return { dept: dept || (s ? s.dept : ''), email: raw.toLowerCase(),
             nameCache: s ? s.name : raw, matched: true };
  }
  // Exact name
  let s = STAKEHOLDERS.find(x => (x.name || '').toLowerCase() === raw.toLowerCase());
  // Surname match — only when it is unambiguous
  if (!s) {
    const last = raw.split(/[\s.]+/).filter(Boolean).pop() || '';
    if (last.length > 2) {
      const hits = STAKEHOLDERS.filter(x => (x.name || '').toLowerCase().includes(last.toLowerCase()));
      if (hits.length === 1) s = hits[0];
    }
  }
  if (s) return { dept: dept || s.dept, email: s.email, nameCache: s.name, matched: true };

  // Owner cell naming a department
  const asDept = depts.find(d => d.toLowerCase() === raw.toLowerCase());
  if (asDept) return { dept: asDept, email: '', nameCache: '', matched: true };

  return { dept, email: '', nameCache: raw, matched: false };
}

function renderSheetPicker(wb, fileName) {
  const preview = document.getElementById('import-preview');
  preview.innerHTML =
    '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 14px;margin-bottom:10px;">' +
      '<div style="font-size:12px;font-weight:600;color:#2563EB;margin-bottom:3px;">' + fileName + ' has ' + wb.SheetNames.length + ' sheets</div>' +
      '<div style="font-size:11px;color:#1E40AF;">Choose which one holds the tasks you want to import.</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:6px;">' +
      wb.SheetNames.map(n =>
        '<button class="btn-outline" style="text-align:left;font-size:12px;padding:10px 14px;" ' +
          'onclick="parseImportSheet(\'' + String(n).replace(/'/g, "\'") + '\')">' + n + '</button>'
      ).join('') +
    '</div>';
}

window.parseImportSheet = (sheetName) => {
  const preview = document.getElementById('import-preview');
  try {
    const wb    = window._importWB;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error('Could not open that sheet.');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    if (rows.length < 2) throw new Error('"' + sheetName + '" needs a header row and at least one task row.');

    // Header row is not always row 1 — scan the first few rows for the best match
    let headerIdx = 0, map = mapImportHeaders(rows[0]);
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const cand = mapImportHeaders(rows[r]);
      if (Object.keys(cand).length > Object.keys(map).length) { map = cand; headerIdx = r; }
    }
    if (map.title === undefined) {
      throw new Error('No task column found in "' + sheetName + '". Expected a column headed Task, Item, Activity or Next Steps.');
    }

    const parsed = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r     = rows[i];
      const title = cleanImportTitle(r[map.title]);
      if (!title) continue;
      // Skip section-divider rows (a title with nothing else on the row)
      const hasOther = ['owner','dept','deadline','status','notes']
        .some(f => map[f] !== undefined && String(r[map[f]] ?? '').trim());
      if (!hasOther && title.length < 4) continue;

      parsed.push({
        title,
        deadline: map.deadline !== undefined ? parseImportDate(r[map.deadline]) : '',
        status:   map.status   !== undefined ? normaliseImportStatus(r[map.status]) : 'on-track',
        notes:    map.notes    !== undefined ? String(r[map.notes] ?? '').trim() : '',
        owner:    resolveImportOwner(
                    map.owner !== undefined ? r[map.owner] : '',
                    map.dept  !== undefined ? r[map.dept]  : ''
                  ),
      });
    }
    if (parsed.length === 0) throw new Error('No rows with a task name were found in "' + sheetName + '".');
    window._importParsed = parsed;
    renderImportPreview(parsed, map, window._importName + ' — ' + sheetName);
  } catch (err) {
    preview.innerHTML =
      '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 14px;font-size:12px;color:#C0282D;">' +
        (err.message || 'Could not read that sheet.') +
      '</div>' +
      (window._importWB && window._importWB.SheetNames.length > 1
        ? '<button class="btn-outline" style="width:100%;margin-top:8px;font-size:12px;" onclick="renderSheetPicker(window._importWB, window._importName)">← Pick a different sheet</button>'
        : '');
  }
};

window.handleImportFile = (evt) => {
  const file = evt.target.files?.[0];
  if (!file) return;
  const preview = document.getElementById('import-preview');
  if (typeof XLSX === 'undefined') {
    preview.innerHTML = '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;font-size:12px;color:#C0282D;">Spreadsheet library did not load. Check your connection and reload.</div>';
    return;
  }
  preview.innerHTML = '<div class="loading-row" style="padding:12px 0;font-size:12px;">Reading file...</div>';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      window._importWB   = wb;
      window._importName = file.name;
      // Multi-sheet workbooks (Lakowe trackers carry New Items / Recurring /
      // Historical tabs) — let the user choose rather than assuming sheet 1.
      if (wb.SheetNames.length > 1) { renderSheetPicker(wb, file.name); return; }
      parseImportSheet(wb.SheetNames[0]);
    } catch (err) {
      preview.innerHTML =
        '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 14px;font-size:12px;color:#C0282D;">' +
          (err.message || 'Could not read that file.') +
        '</div>';
    }
  };
  reader.onerror = () => {
    preview.innerHTML = '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;font-size:12px;color:#C0282D;">Could not read that file.</div>';
  };
  reader.readAsArrayBuffer(file);
};

function renderImportPreview(parsed, map, fileName) {
  const unmatched = parsed.filter(p => !p.owner.matched && p.owner.nameCache);
  const noDate    = parsed.filter(p => !p.deadline);
  const found     = Object.keys(map).filter(k => map[k] !== undefined);

  const warn = (txt) =>
    '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;font-size:11px;color:#92400E;margin-bottom:8px;line-height:1.6;">' + txt + '</div>';

  let html =
    '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:10px 12px;font-size:12px;color:#16A34A;font-weight:500;margin-bottom:10px;">' +
      parsed.length + ' task' + (parsed.length !== 1 ? 's' : '') + ' read from ' + fileName +
      '<div style="font-size:11px;font-weight:400;color:#15803D;margin-top:2px;">Columns matched: ' + found.join(', ') + '</div>' +
    '</div>';

  if (unmatched.length) {
    html += warn('<strong>' + unmatched.length + ' owner' + (unmatched.length !== 1 ? 's' : '') +
      ' could not be matched to the directory</strong> — the name is kept for display but these tasks will not receive email until reassigned: ' +
      unmatched.slice(0, 6).map(u => u.owner.nameCache).join(', ') +
      (unmatched.length > 6 ? ' and ' + (unmatched.length - 6) + ' more' : ''));
  }
  if (noDate.length) {
    html += warn('<strong>' + noDate.length + ' task' + (noDate.length !== 1 ? 's' : '') +
      ' have no deadline.</strong> They will import, but deadline alerts only fire for tasks with a date.');
  }

  html +=
    '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:260px;overflow-y:auto;">' +
      '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="background:#1A1A1A;position:sticky;top:0;">' +
          '<th style="padding:7px 10px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.05em;">Task</th>' +
          '<th style="padding:7px 10px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.05em;">Owner</th>' +
          '<th style="padding:7px 10px;text-align:left;font-size:10px;color:#fff;text-transform:uppercase;letter-spacing:.05em;">Deadline</th>' +
        '</tr></thead><tbody>' +
        parsed.slice(0, 40).map(p => {
          const label = p.owner.email
            ? (p.owner.nameCache || p.owner.email)
            : (p.owner.dept || p.owner.nameCache || '—');
          const dot = p.owner.matched ? '#16A34A' : '#D97706';
          return '<tr style="border-bottom:1px solid #F3F3F2;">' +
            '<td style="padding:7px 10px;font-size:11px;color:var(--text);">' + p.title + '</td>' +
            '<td style="padding:7px 10px;font-size:11px;color:#6B7280;">' +
              '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dot + ';margin-right:5px;"></span>' +
              label + (p.owner.dept && p.owner.email ? ' <span style="color:#9CA3AF;">(' + p.owner.dept + ')</span>' : '') +
            '</td>' +
            '<td style="padding:7px 10px;font-size:11px;color:' + (p.deadline ? '#6B7280' : '#D97706') + ';">' +
              (p.deadline ? formatDate(p.deadline) : 'No date') + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      (parsed.length > 40 ? '<div style="padding:7px 10px;font-size:11px;color:#9CA3AF;">+' + (parsed.length - 40) + ' more rows</div>' : '') +
    '</div>' +
    '<button class="btn-primary" style="width:100%;margin-top:12px;padding:12px;" onclick="confirmImportTasks()">' +
      'Import ' + parsed.length + ' task' + (parsed.length !== 1 ? 's' : '') + ' and continue' +
    '</button>';

  document.getElementById('import-preview').innerHTML = html;
}

window.confirmImportTasks = () => {
  const parsed = window._importParsed || [];
  if (!parsed.length) { showToast('Nothing to import', 'error'); return; }

  // Build tasks in exactly the shape the other two options produce
  set_editingTasks( parsed.map((p, i) => {
    const owners = (p.owner.email || p.owner.dept)
      ? [{ dept: p.owner.dept || '', email: p.owner.email || '', nameCache: p.owner.nameCache || '' }]
      : [];
    return {
      id: generateTaskId(),
      title: p.title,
      owners,
      owner:      owners.length ? (p.owner.nameCache || p.owner.dept) : '',
      ownerEmail: p.owner.email || '',
      ownerDept:  p.owner.dept  || '',
      deadline:   p.deadline,
      status:     p.status,
      predecessors: [], locked: false, pillarId: null,
      notes: p.notes || '',
      order: i, kanbanCol: p.status === 'complete' ? 'done' : 'todo',
      importedAt: Date.now(),
    };
  }));
  window._importParsed = null;
  document.getElementById('modal-body-content').innerHTML = buildTaskEditorForm();
  showToast(_editingTasks.length + ' tasks imported — review and edit before saving.', 'success');
};

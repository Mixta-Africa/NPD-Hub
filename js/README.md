# NPD Hub — code map

The app used to be one 15,000-line `index.html`. It is now:

```
index.html          page shell: <head>, login/denied screens, app frame
css/                one stylesheet cut into 10 ordered parts
js/main.js          entry point (composition root)
js/**               71 ES modules, grouped by function (below)
```

## How it fits together

1. `index.html` loads the 10 CSS files, then `js/main.js` as `<script type="module">`.
2. `main.js` imports every module. Each module registers its click handlers on `window` (e.g. `window.showToast = …`) because the UI is built from HTML strings containing `onclick="showToast(...)"`.
3. `main.js` then hands the real handlers to the small bootstrap stub in `index.html` (`window.__npd_init`) and starts Firebase auth **last**, after everything above exists.
4. Modules call each other two ways:
   - **Normal functions and constants**: `import { x } from '../y.js'`. Only names other modules use are exported.
   - **`window.*` handlers**: called by bare name, exactly as before (e.g. `showToast('Saved')`). These resolve at run time, so they need no import.
5. Firebase is imported from `js/core/firebase.js`, never from the CDN directly. Bump the SDK version there, in one place.

## Shared state (read this before changing anything)

A few variables are shared and reassigned across modules: `currentUser`, `currentRole`, `currentUserDept`, `currentView`, `isSuperAdmin`, `saSessionStart`, `currentPreferredName`, `PILLARS`, `STAKEHOLDERS`, `DEPARTMENTS`, `SYS_CONFIG`, `SAVED_TEMPLATES`, `_editingTasks`, `_dashRefreshTimer`, `pendingProduct`.

- **Reading** them from any module works and always sees the current value.
- **Assigning** them from a different module than the one that declares them must go through the exported setter: `set_currentUser(user)`, not `currentUser = user`. An ES module cannot assign to something it imported, and doing so is an error.
- Changing the *contents* (`STAKEHOLDERS.push(...)`, `productListCache[id] = ...`) needs no setter.

## Adding or changing things

- **New page:** create `js/views/<name>.js`, export a `render<Name>(el)`, add a `case` to `loadView` in `js/ui/routing.js`, add the sidebar button in `index.html`, and add `import './views/<name>.js';` to `main.js`.
- **New handler used from HTML:** `window.myHandler = () => {…}` in the module that owns the feature.
- **A module that only registers `window.*` handlers must still be imported from `main.js`**, or it never runs.
- **Secrets** live only in `js/core/config.js` as `__PLACEHOLDER__` tokens. `deploy.yml` fills them in. Never put a placeholder anywhere else.

## Running locally

Browsers refuse to load ES modules from `file://`. Serve the folder instead:

```
python3 -m http.server 8080      # then open http://localhost:8080
```

The placeholders in `config.js` must be replaced with real values for sign-in to work locally.

## Deploying

`.github/workflows/deploy.yml` (a) injects secrets into `js/core/config.js` and fails if any placeholder is left anywhere, and (b) appends `?v=<commit>` to every module and stylesheet URL so a new deploy can never be served half-old from cache. **The Cloudflare `build.sh` must do the same two things**; it previously edited `index.html` and must now edit `js/core/config.js`.

## Module map

### `core/` — Foundation: no upward imports

| File | Lines | What it owns |
|---|---:|---|
| `core/firebase.js` | 18 | Firebase initialisation. Every other module imports Firebase from here, never from the CDN. |
| `core/config.js` | 29 | Deploy-time secrets and endpoints. The ONLY file with __PLACEHOLDER__ tokens (filled in by deploy.yml). |
| `core/utils.js` | 29 | Small shared helpers: email sanitising, SHA-256, ISO week keys. |
| `core/icons.js` | 23 | Inline SVG icon set used across the UI. |
| `core/state.js` | 28 | Shared session state: signed-in user, role, department, current view, Circuit Box session. |
| `core/listeners.js` | 20 | Registry of live Firebase onValue() listeners so they can be torn down on view change or sign-out. |
| `core/error-log.js` | 43 | Global error capture that feeds the Circuit Box error log. |
| `core/gas.js` | 17 | callGAS(): the single bridge to the Google Apps Script backend (email, Drive, Sheets). |

### `auth/` — Sign-in and security

| File | Lines | What it owns |
|---|---:|---|
| `auth/auth.js` | 391 | Sign-in / sign-out, allowlist check, department selection, access-denied and welcome screens, app shell start-up. |
| `auth/superadmin-auth.js` | 271 | Circuit Box (super admin) password challenge, session timeout and password reset. |
| `auth/privacy-lock.js` | 130 | Optional PIN screen lock for My Actions / To-do, stored per user. |

### `data/` — Data rules and shared data

| File | Lines | What it owns |
|---|---:|---|
| `data/app-config.js` | 229 | Reference data and live config: pillars, stakeholders, departments, feature flags, system config, team members. |
| `data/permissions.js` | 228 | Who can see or edit what: product access, task-level privacy, budget visibility, access badges. |
| `data/templates.js` | 46 | Saved task templates. |
| `data/product-model.js` | 77 | Product/task data helpers: id generation, legacy pillar to task conversion, auto-lock. |
| `data/status.js` | 185 | Task and project status logic: effective status, predictions, status metadata, date formatting. |
| `data/products-cache.js` | 57 | Shared live cache of all products (one listener feeds every view). |

### `ui/` — App shell

| File | Lines | What it owns |
|---|---:|---|
| `ui/routing.js` | 133 | Deep links from email (?p=&t=&view=) and loadView(), the page router. |
| `ui/global-search.js` | 119 | Header search bar over projects, tasks and people. |
| `ui/undo.js` | 31 | Ctrl+Z to undo the last status change. |
| `ui/shell.js` | 67 | App chrome helpers: greeting, countdown, toasts, sidebar toggle. |

### `views/` — One module per sidebar page

| File | Lines | What it owns |
|---|---:|---|
| `views/dashboard.js` | 409 | Dashboard page: stat tiles, product grid, live refresh. |
| `views/workload.js` | 177 | Department Workload page. |
| `views/myactions.js` | 727 | My Actions & To-dos: personal tasks, weekly review, approvals, task requests. |
| `views/decisions.js` | 227 | Decisions page: AI reasoning-layer suggestions to approve or dismiss. |
| `views/products.js` | 299 | Products & Projects list, cards, filters, archive. |
| `views/drilldown.js` | 200 | Click-through from any dashboard tile to the underlying items. |
| `views/project-dashboard.js` | 346 | Per-project dashboard and stat-tile department breakdown. |
| `views/ask.js` | 246 | Ask: question answering over the tasks and projects the user is allowed to see. |
| `views/product-detail.js` | 353 | Product/project detail view and tabs. |
| `views/calendar.js` | 359 | Launch Calendar and Gantt. |
| `views/tracker.js` | 758 | Task Tracker: table, kanban, critical path, Gantt. |
| `views/documents.js` | 273 | Document Centre: folders, uploads to Drive. |
| `views/reports.js` | 652 | Progress Reports page: weekly report, deadline alerts, email schedule, AI diagnostics. |
| `views/settings.js` | 314 | Settings page: allowlist, access requests, org working hours, preferred name, team. |
| `views/dashboard-charts.js` | 201 | Dashboard charts (Chart.js). |

### `features/` — Cross-page features

| File | Lines | What it owns |
|---|---:|---|
| `features/task-editor.js` | 646 | Task rows inside the product form, owners, add-task-to-product. |
| `features/dependency-map.js` | 200 | Task dependency map (Mermaid) and its export. |
| `features/product-form.js` | 313 | Create/edit product form, template chooser, save. |
| `features/image-picker.js` | 141 | Project picture picker (photo search or upload). |
| `features/import-tasks.js` | 339 | Excel task import. |
| `features/ai.js` | 114 | AI provider chain (Groq, Cerebras, SambaNova) and askAI(). |
| `features/export-sheet.js` | 220 | Tracker export and live Google Sheet sync. |
| `features/task-list-controls.js` | 186 | Task list filtering, grouping and bulk visibility controls. |
| `features/task-detail.js` | 294 | Task detail panel, edit-task with changelog, delay reasons, AMC escalation. |
| `features/product-onboarding.js` | 272 | Stakeholder confirmation and the Apps Script launch (Drive folder + onboarding emails). |
| `features/task-actions.js` | 398 | Delete, move, reorder, reassign and spin out tasks. |
| `features/email-log.js` | 283 | Email visibility log: every send recorded and browsable. |
| `features/comments.js` | 134 | Product comments and assignee history. |
| `features/readonly-portfolio.js` | 144 | Read-only portfolio dashboard for the GCCO and the link generator. |
| `features/share.js` | 58 | Share modal and access changes. |
| `features/weekly-log.js` | 71 | Weekly log entries. |
| `features/handover.js` | 122 | Handover package for a reliever. |
| `features/email-composer.js` | 496 | AI-drafted email composer, reminders, CC pills, escalation editor and prompts. |
| `features/activity.js` | 388 | Activity log, task history, quick update, activity PDF. |
| `features/task-status.js` | 213 | Status dropdown, delayed-task notifications, unblocked dates. |

### `superadmin/` — Circuit Box, one file per tab

| File | Lines | What it owns |
|---|---:|---|
| `superadmin/index.js` | 103 | Circuit Box shell and tab router. |
| `superadmin/health.js` | 181 | Health checks and the synthetic ping test. |
| `superadmin/people.js` | 163 | People directory. |
| `superadmin/features.js` | 57 | Feature flag toggles. |
| `superadmin/pillars.js` | 127 | SOP pillar management. |
| `superadmin/stakeholders.js` | 138 | Stakeholder management. |
| `superadmin/config.js` | 120 | System configuration, reset and data export. |
| `superadmin/audit-errors.js` | 91 | Audit log and error log. |
| `superadmin/users.js` | 127 | User administration (department, role, unlock, reset). |
| `superadmin/products.js` | 82 | Product administration. |
| `superadmin/maintenance.js` | 89 | Maintenance tools and access log. |
| `superadmin/departments.js` | 137 | Department management. |
| `superadmin/templates.js` | 66 | Template administration. |
| `superadmin/all-tasks.js` | 254 | All-tasks admin table and the hard-delete overrides. |
| `superadmin/watchdog.js` | 220 | Data-integrity watchdog: scan and repair. |

### Root

| File | Lines | What it owns |
|---|---:|---|
| `main.js` | 259 | Composition root: loads every module, hands the real handlers to the bootstrap stubs, then starts auth. |

## Sidebar page → file

| Page | Module |
|---|---|
| Dashboard | `views/dashboard.js` (+ `dashboard-charts.js`) |
| My Actions & To-dos | `views/myactions.js` |
| Decisions | `views/decisions.js` |
| Ask | `views/ask.js` (+ `features/ai.js`) |
| Products & Projects | `views/products.js`, `views/product-detail.js`, `views/project-dashboard.js` |
| Launch Calendar | `views/calendar.js` |
| Task Tracker | `views/tracker.js` |
| Workload | `views/workload.js` |
| Document Centre | `views/documents.js` |
| Progress Reports | `views/reports.js` (email schedule panel lives here) |
| Settings | `views/settings.js` (working hours, allowlist) |
| Circuit Box | `superadmin/*` |

## Known issues found while splitting (behaviour preserved, not fixed)

- `features/readonly-portfolio.js` — `renderReadOnlyPage` uses `isDelayed`, which is never defined; rendering task rows would throw.
- `views/drilldown.js` — `dashNavToTracker` is defined twice; the later definition wins, the first is dead.
- `superadmin/all-tasks.js` — `saDeleteTask` and `saDeleteProject` are each defined twice; **the later definition runs**. The running `saDeleteProject` deletes the product and its side data in one `Promise.all`, so if Firebase rules block one side path the wipe reports failure after the product is already gone. The earlier (dead) version tolerated blocked side paths.
- `superadmin/all-tasks.js` — `renderSATasksTab` is referenced but does not exist (guarded by `typeof`, so the branch never runs).

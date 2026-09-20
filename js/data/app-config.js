/* data/app-config.js — Reference data and live config: pillars, stakeholders, departments, feature flags, system config, team members. */

import { db, get, ref, set } from '../core/firebase.js';

/* ── PILLAR DEFINITIONS (12 SOP pillars from Mixta NPD guide) ── */
// PILLARS — loaded from Firebase /config/pillars at runtime
// Default fallback used until Firebase loads
export let PILLARS = [
  { id: 'p1',  name: 'New Product Case Assessment',              owner: 'Commercial Strategy', dept: 'commercial', enabled: true },
  { id: 'p2',  name: 'New Product Development Meetings',         owner: 'Commercial Strategy', dept: 'commercial', enabled: true },
  { id: 'p3',  name: 'Market Survey & Research',                 owner: 'Commercial Strategy', dept: 'commercial', enabled: true },
  { id: 'p4',  name: 'Product Design & Development',             owner: 'Design',              dept: 'design',     enabled: true },
  { id: 'p5',  name: 'Product Financial & Profitability Analysis',owner: 'Financial Planning', dept: 'finplan',    enabled: true },
  { id: 'p6',  name: 'Product AMC Meetings',                     owner: 'Country Manager',     dept: 'amc',        enabled: true },
  { id: 'p7',  name: 'AMC Product Presentations',                owner: 'Country Manager',     dept: 'amc',        enabled: true },
  { id: 'p8',  name: 'IC Product Presentations',                 owner: 'Country Manager',     dept: 'amc',        enabled: true },
  { id: 'p9',  name: 'Product Components: Factsheet, Legal & Layout', owner: 'Operations',   dept: 'operations',  enabled: true },
  { id: 'p10', name: 'Product Pricing Development',              owner: 'Financial Planning',  dept: 'finplan',    enabled: true },
  { id: 'p11', name: 'Product Marketing Materials',              owner: 'MCC',                 dept: 'mcc',        enabled: true },
  { id: 'p12', name: 'Project Execution Strategy',               owner: 'Country Manager',     dept: 'amc',        enabled: true },
]

/* ══ STAKEHOLDER LIST (from Dashboard_Mailing_List_NPD.xlsx) ══ */
// STAKEHOLDERS — loaded from Firebase /config/stakeholders at runtime
export let STAKEHOLDERS = [
  // ── Design ──────────────────────────────────────────────────
  { id: 's_d1',  name: 'Design Team',              email: 'dcs_nigeria@mixtafrica.com',              dept: 'Design',              isDeptEmail: true,  enabled: true },
  { id: 's_d2',  name: 'A. Arokodare',             email: 'a.arokodare@mixtafrica.com',              dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d3',  name: 'C. Uwadiale',              email: 'c.uwadiale@mixtafrica.com',               dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d4',  name: 'A. Uwuigbe',               email: 'a.uwuigbe@mixtafrica.com',                dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d5',  name: 'A. Adesiyun',              email: 'a.adesiyun@mixtafrica.com',               dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d6',  name: 'L. Oyenuga',               email: 'l.oyenuga@mixtafrica.com',                dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d7',  name: 'O. Shobajo',               email: 'o.shobajo@mixtafrica.com',                dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d8',  name: 'O. Ashafa',                email: 'o.ashafa@mixtafrica.com',                 dept: 'Design',              isDeptEmail: false, enabled: true },
  { id: 's_d9',  name: 'O. Edo-Osagie',            email: 'o.edo-osagie@mixtafrica.com',             dept: 'Design',              isDeptEmail: false, enabled: true },
  // ── AMC ─────────────────────────────────────────────────────
  { id: 's_a1',  name: 'Deji Alli',                email: 'deji.alli@mixtafrica.com',                dept: 'AMC',                 isDeptEmail: true,  enabled: true },
  { id: 's_a2',  name: 'S. Hughes',                email: 's.hughes@mixtafrica.com',                 dept: 'AMC',                 isDeptEmail: false, enabled: true },
  { id: 's_a3',  name: 'B. Ajayi',                 email: 'b.ajayi@mixtafrica.com',                  dept: 'AMC',                 isDeptEmail: false, enabled: true },
  // ── IPD / PMO ────────────────────────────────────────────────
  { id: 's_i1',  name: 'IPD Team',                 email: 'ipd_nigeria@mixtafrica.com',              dept: 'IPD',                 isDeptEmail: true,  enabled: true },
  { id: 's_i2',  name: 'PMO Team',                 email: 'pmo_nigeria@mixtafrica.com',              dept: 'IPD',                 isDeptEmail: false, enabled: true },
  { id: 's_i3',  name: 'W. Salami',                email: 'w.salami@mixtafrica.com',                 dept: 'IPD',                 isDeptEmail: false, enabled: true },
  { id: 's_i4',  name: 'T. Banjo',                 email: 't.banjo@mixtafrica.com',                  dept: 'IPD',                 isDeptEmail: false, enabled: true },
  { id: 's_i5',  name: 'H. Kacou',                 email: 'h.kacou@mixtafrica.com',                  dept: 'IPD',                 isDeptEmail: false, enabled: true },
  // ── Costing ─────────────────────────────────────────────────
  { id: 's_c1',  name: 'Costing & Procurement',    email: 'mn_costingandprocurement@mixtafrica.com', dept: 'Costing',             isDeptEmail: true,  enabled: true },
  { id: 's_c2',  name: 'O. James',                 email: 'o.james@mixtafrica.com',                  dept: 'Costing',             isDeptEmail: false, enabled: true },
  { id: 's_c3',  name: 'J. Olowe',                 email: 'j.olowe@mixtafrica.com',                  dept: 'Costing',             isDeptEmail: false, enabled: true },
  { id: 's_c4',  name: 'T. Ibidokun',              email: 't.ibidokun@mixtafrica.com',               dept: 'Costing',             isDeptEmail: false, enabled: true },
  // ── MCC ─────────────────────────────────────────────────────
  { id: 's_m1',  name: 'MCC Team',                 email: 'mcc@mixtafrica.com',                      dept: 'MCC',                 isDeptEmail: true,  enabled: true },
  { id: 's_m2',  name: 'K. Haastrup',              email: 'k.haastrup@mixtafrica.com',               dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m3',  name: 'N. Anaeto',                email: 'n.anaeto@mixtafrica.com',                 dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m4',  name: 'D. Ariyo',                 email: 'd.ariyo@mixtafrica.com',                  dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m5',  name: 'D. Salawu',                email: 'd.salawu@mixtafrica.com',                 dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m6',  name: 'E. Idada',                 email: 'e.idada@mixtafrica.com',                  dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m7',  name: 'O. Kolawole',              email: 'o.kolawole@mixtafrica.com',               dept: 'MCC',                 isDeptEmail: false, enabled: true },
  { id: 's_m8',  name: 'E. Etim',                  email: 'e.etim@mixtafrica.com',                   dept: 'MCC',                 isDeptEmail: false, enabled: true },
  // ── Sales ────────────────────────────────────────────────────
  { id: 's_s1',  name: 'A. Cameron-Cole',          email: 'a.cameron-cole@mixtafrica.com',           dept: 'Sales',               isDeptEmail: true,  enabled: true },
  { id: 's_s2',  name: 'E. Ezeh',                  email: 'e.ezeh@mixtafrica.com',                   dept: 'Sales',               isDeptEmail: false, enabled: true },
  { id: 's_s3',  name: 'M. Adaran',                email: 'm.adaran@mixtafrica.com',                 dept: 'Sales',               isDeptEmail: false, enabled: true },
  // ── Legal ────────────────────────────────────────────────────
  { id: 's_l1',  name: 'Legal Team',               email: 'legal@mixtafrica.com',                    dept: 'Legal',               isDeptEmail: true,  enabled: true },
  { id: 's_l2',  name: 'R. Idaeho',                email: 'r.idaeho@mixtafrica.com',                 dept: 'Legal',               isDeptEmail: false, enabled: true },
  { id: 's_l3',  name: 'O. Shoyoye',               email: 'o.shoyoye@mixtafrica.com',                dept: 'Legal',               isDeptEmail: false, enabled: true },
  // ── FINCON ───────────────────────────────────────────────────
  { id: 's_f1',  name: 'FINCON Team',              email: 'mixta_fincon@mixtafrica.com',             dept: 'FINCON',              isDeptEmail: true,  enabled: true },
  { id: 's_f2',  name: 'O. Ekpikie',               email: 'o.ekpikie@mixtafrica.com',                dept: 'FINCON',              isDeptEmail: false, enabled: true },
  { id: 's_f3',  name: 'O. Tona-Obafemi',          email: 'o.tona-obafemi@mixtafrica.com',           dept: 'FINCON',              isDeptEmail: false, enabled: true },
  { id: 's_f4',  name: 'O. Isabu',                 email: 'o.isabu@mixtafrica.com',                  dept: 'FINCON',              isDeptEmail: false, enabled: true },
  { id: 's_f5',  name: 'A. Omotayo',               email: 'a.omotayo@mixtafrica.com',                dept: 'FINCON',              isDeptEmail: false, enabled: true },
  // ── Operations ──────────────────────────────────────────────
  { id: 's_o1',  name: 'U. Ojembe',                email: 'u.ojembe@mixtafrica.com',                 dept: 'Operations',          isDeptEmail: true,  enabled: true },
  { id: 's_o2',  name: 'O. Ajala',                 email: 'o.ajala@mixtafrica.com',                  dept: 'Operations',          isDeptEmail: false, enabled: true },
  { id: 's_o3',  name: 'C. Ajie',                  email: 'c.ajie@mixtafrica.com',                   dept: 'Operations',          isDeptEmail: false, enabled: true },
  { id: 's_o4',  name: 'R. Jolaiya',               email: 'r.jolaiya@mixtafrica.com',                dept: 'Operations',          isDeptEmail: false, enabled: true },
  // ── Commercial Strategy ─────────────────────────────────────
  { id: 's_cs1', name: 'O. Olasunkanmi',           email: 'o.olasunkanmi@mixtafrica.com',            dept: 'Commercial Strategy', isDeptEmail: true,  enabled: true },
  { id: 's_cs2', name: 'T. Adebule',               email: 't.adebule@mixtafrica.com',                dept: 'Commercial Strategy', isDeptEmail: false, enabled: true },
  { id: 's_cs3', name: 'T. Adeniyi',               email: 't.adeniyi@mixtafrica.com',                dept: 'Commercial Strategy', isDeptEmail: false, enabled: true },
];

// ── Department lookup helpers ────────────────────────────────
export function getDepts() {
  // Primary source: DEPARTMENTS object (managed by super admin)
  const deptNames = Object.values(DEPARTMENTS).map(d => d.name).filter(Boolean);
  // Secondary: any additional depts from STAKEHOLDERS not already in DEPARTMENTS
  STAKEHOLDERS.forEach(s => {
    if (s.enabled !== false && s.dept && !deptNames.includes(s.dept)) {
      deptNames.push(s.dept);
    }
  });
  return deptNames;
}

export function detectDeptFromEmail(email) {
  const match = STAKEHOLDERS.find(s => s.email === email);
  return match ? match.dept : 'Commercial Strategy';
}

// Build a grouped <select> for task owner — dept groups + individual members
export function buildOwnerSelect(id, selectedValue, extraStyle) {
  const style = extraStyle || 'width:100%;';
  let html = '<select id="' + id + '" class="select-field" style="' + style + '">' +
    '<option value="">-- Select owner --</option>';
  const depts = getDepts();
  depts.forEach(dept => {
    const members = STAKEHOLDERS.filter(s => s.enabled !== false && s.dept === dept);
    if (!members.length) return;
    html += '<optgroup label="' + dept + '">';
    members.forEach(s => {
      const val = s.name + ' (' + dept + ')';
      const sel = selectedValue && (selectedValue === val || selectedValue === s.name || selectedValue === dept) ? ' selected' : '';
      const prefix = s.isDeptEmail ? dept + ' (whole dept)' : s.name;
      html += '<option value="' + val + '"' + sel + '>' + prefix + '</option>';
    });
    html += '</optgroup>';
  });
  html += '</select>';
  return html;
}

// Commercial Strategy team (admin populates via Settings)
// Stored in Firebase at /users/{sanitised_email}/
// Loaded at runtime into this map
export let TEAM_MEMBERS = {}; // { sanitised_email: { name, email, role } }

export async function loadTeamMembers() {
  try {
    const snap = await get(ref(db, 'users'));
    TEAM_MEMBERS = snap.val() || {};
  } catch(e) {
    console.warn('Could not load team members:', e);
  }
}

// ── DEPARTMENTS (editable from Circuit Box) ──────────────────
export let DEPARTMENTS = {
  commercial: { name: 'Commercial Strategy', colour: '#2563EB', emails: [] },
  design:     { name: 'Design',              colour: '#7C3AED', emails: [] },
  finplan:    { name: 'Financial Planning',  colour: '#059669', emails: [] },
  amc:        { name: 'AMC',                 colour: '#C0282D', emails: [] },
  operations: { name: 'Operations',          colour: '#D97706', emails: [] },
  mcc:        { name: 'MCC',                 colour: '#0891B2', emails: [] },
  legal:      { name: 'Legal',               colour: '#6B7280', emails: [] },
  ipd:        { name: 'IPD',                 colour: '#9D174D', emails: [] },
};

// ── FEATURE FLAGS (defaults — overridden by Firebase /config/features) ──
// These now actually gate something, on both ends. Previously every one of
// these keys was written by Circuit Box's toggles and read by nothing —
// not the backend (Apps Script never checked config/features at all), not
// the frontend (nothing outside the toggle switch's own rendered state
// checked FEATURES.* either). Fixed on both sides; see isFeatureEnabled_()
// in the Apps Script backend for the server-side half of this.
export let FEATURES = {
  deadlineAlerts:   true,
  handoverSystem:   true,
  weeklyLog:        true,
  documentUploads:  true,
  progressReports:  true,
  sharing:          true,
  calendarView:     true,
  taskTracker:      true,
  aiEmailComposer:  true,
  sheetSync:        true,
  gccoDashboard:    true,
  decisionEngine:   true,
  aiAsk:            true,
};

// ── SYSTEM CONFIG (defaults — overridden by Firebase /config/system) ──
export let SYS_CONFIG = {
  saTimeoutMins:      30,
  appName:            'Mixta Africa NPD Hub',
  appSubtitle:        'New Product Development Hub',
};

// ── Load all config from Firebase on startup ──────────────────
export async function loadAppConfig() {
  try {
    const [pillarsSnap, stkSnap, featSnap, sysSnap, deptSnap] = await Promise.all([
      get(ref(db, 'config/pillars')),
      get(ref(db, 'config/stakeholders')),
      get(ref(db, 'config/features')),
      get(ref(db, 'config/system')),
      get(ref(db, 'config/departments')),
    ]);
    if (pillarsSnap.exists()) {
      const p = pillarsSnap.val();
      PILLARS = Array.isArray(p) ? p : Object.values(p);
    }
    if (stkSnap.exists()) {
      const s = stkSnap.val();
      STAKEHOLDERS = Array.isArray(s) ? s : Object.values(s);
    }
    if (featSnap.exists()) FEATURES    = { ...FEATURES, ...featSnap.val() };
    if (sysSnap.exists())  SYS_CONFIG  = { ...SYS_CONFIG, ...sysSnap.val() };
    if (deptSnap.exists()) DEPARTMENTS = { ...DEPARTMENTS, ...deptSnap.val() };
  } catch(e) {
    console.warn('Config load failed, using defaults:', e.message);
  }
}

// Seed default config to Firebase (run once — skips if already exists)
export async function seedConfigToFirebase() {
  try {
    const snap = await get(ref(db, 'config'));
    if (!snap.exists()) {
      await set(ref(db, 'config/pillars'),       PILLARS);
      await set(ref(db, 'config/stakeholders'),  STAKEHOLDERS);
      await set(ref(db, 'config/features'),      FEATURES);
      await set(ref(db, 'config/system'),        SYS_CONFIG);
      console.log('Config seeded to Firebase');
    }
  } catch(e) { console.warn('Config seed failed:', e.message); }
}

/* ── Setters ──────────────────────────────────────────────────
   An ES module cannot assign to a binding it imported, so other
   modules change these shared variables through these functions.
   Reading them elsewhere still sees the live value. */
export function set_DEPARTMENTS(v) { DEPARTMENTS = v; }
export function set_PILLARS(v) { PILLARS = v; }
export function set_STAKEHOLDERS(v) { STAKEHOLDERS = v; }
export function set_SYS_CONFIG(v) { SYS_CONFIG = v; }

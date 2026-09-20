/* features/email-composer.js — AI-drafted email composer, reminders, CC pills, escalation editor and prompts. */

import { TEST_EMAIL } from '../core/config.js';
import { ICON } from '../core/icons.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { loadTeamMembers, STAKEHOLDERS, TEAM_MEMBERS } from '../data/app-config.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { getPillarStatus } from '../data/status.js';
import { productListCache } from '../data/products-cache.js';
import { askAI } from './ai.js';
import { logEmailSent } from './email-log.js';
import { logActivity } from './activity.js';

/* ── DASHBOARD: DEADLINE REMINDER MODAL ── */
window.showReminderModal = async (productId, pillarId, pillarName, productName, deadline) => {
  const prod  = productListCache[productId] || {};
  const tasks = getProductTasks(prod);
  const task  = tasks.find(t => t.id === pillarId) || { title: pillarName, deadline, owner: '' };
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = deadline ? new Date(deadline) : null;
  if (due) due.setHours(0,0,0,0);
  const daysOverdue = due && due < today ? Math.round((today - due) / 86400000) : 0;

  const deptEmails = STAKEHOLDERS
    .filter(s => s.enabled !== false && (s.pillarIds||[]).includes(pillarId))
    .map(s => s.email);
  const ownerEmails = deptEmails.length > 0 ? deptEmails : (prod.alertRecipients || [currentUser.email]);

  await openEmailComposer({
    type:      'reminder',
    subject:   `${daysOverdue > 0 ? `[${daysOverdue}d OVERDUE] ` : ''}${pillarName} — ${productName}`,
    toEmails:  ownerEmails,
    ccEmails:  prod.defaultCCs || [],
    productId,
    draftPrompt: buildReminderPrompt(prod, task, daysOverdue),
    onSend: async ({ subject, body, toEmails, ccEmails, testMode }) => {
      await callGAS('sendComposedEmail', { sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        subject, body, toEmails, ccEmails, testMode,
        productName, pillarName,
      });
      await logActivity(productId, 'status', `Reminder sent: ${pillarName}`, `To: ${toEmails.join(', ')}`);
    },
  });
};

window.sendReminder = async (productId, pillarId, pillarName, productName, deadline) => {
  const msg      = document.getElementById('reminder-msg')?.value.trim() || '';
  const testMode = document.getElementById('reminder-send-mode')?.value === 'test';
  const btn      = document.querySelector('#quick-update-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    const deptEmails = STAKEHOLDERS
      .filter(s => s.enabled !== false && (s.pillarIds||[]).includes(pillarId))
      .map(s => s.email);

    const result = await callGAS('sendDeadlineReminder', { sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
      productName, productId, pillarName, pillarId, deadline,
      customMessage: msg,
      deptEmails,
      testMode,
    });
    if (!result.ok) throw new Error(result.error || 'Send failed');
    await logEmailSent(productId, {
      type: 'reminder', subject: 'Reminder — ' + (pillarName || ''),
      to: testMode ? ['(test mode)'] : (deptEmails || []),
      cc: [], taskTitles: [pillarName], trigger: testMode ? 'test' : 'manual',
    });
    document.getElementById('email-composer-modal').style.display = 'none';
    showToast(`Reminder sent${testMode ? ' (test)' : ''} to ${testMode ? 'o.olasunkanmi@mixtafrica.com' : deptEmails.length + ' recipients'}.`, 'success');
  } catch(e) {
    showToast('Reminder failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Send reminder'; }
  }
};

/* ══ AI EMAIL SYSTEM ════════════════════════════════════════ */

/* ── AI draft generation ──────────────────────────────────
   Routes through the same askAI() path as the Ask feature, so it
   inherits runtime model discovery and provider failover. Previously
   this pinned GROQ_MODEL to a single hardcoded ID, which broke
   silently when Groq deprecated it. ───────────────────────────── */
async function generateAIDraft(prompt) {
  const system = `You are an expert real estate professional at Mixta Africa writing internal emails.
Write concise, professional emails in a direct business tone.
Do not use filler phrases. Do not add "I hope this finds you well."
Write only the email body — no subject line, no salutation unless requested.
Use specific product details provided. Be concrete about responsibilities and deadlines.`;
  try {
    const { text } = await askAI([
      { role: 'system', content: system },
      { role: 'user',   content: prompt },
    ], 800);
    return text || '';
  } catch(e) {
    console.error('AI draft failed:', e);
    throw e;
  }
}

/* ── Email Composer Modal ────────────────────────────────── */
export async function openEmailComposer({
  type,           // 'onboarding' | 'reminder' | 'report' | 'handover' | 'alert'
  subject,        // pre-filled subject
  toEmails,       // array of primary recipients
  ccEmails,       // array of CC emails (product defaults pre-loaded)
  productId,      // for loading product context
  draftPrompt,    // full prompt to send to Groq
  onSend,         // async fn(finalSubject, finalBody, toEmails, ccEmails) called on send
  isThreadStarter, // true = this email starts the product thread
}) {
  const prod = productListCache[productId] || {};

  // Show the modal immediately with a loading state
  let modal = document.getElementById('email-composer-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'email-composer-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:2000;padding:16px;';
    document.body.appendChild(modal);
  }

  const defaultCCs = prod.defaultCCs || [];
  const allCCs     = [...new Set([...(ccEmails || []), ...defaultCCs])];

  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:92vh;
                overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.25);">
      <div style="background:#1a1a18;padding:16px 22px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="color:rgba(255,255,255,.6);font-size:11px;letter-spacing:.08em;text-transform:uppercase;">
            ${prod.gmailThreadId ? 'Reply in thread' : isThreadStarter ? 'New thread' : 'Email Composer'}
          </div>
          <div style="color:white;font-size:16px;font-weight:600;margin-top:2px;">${prod.name || 'Compose email'}</div>
          ${prod.gmailThreadId ? `<div style="color:rgba(255,255,255,.5);font-size:11px;margin-top:2px;">Will reply to existing product thread</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="email-ai-badge">${ICON.bolt} AI Draft</span>
          <button onclick="document.getElementById('email-composer-modal').style.display='none'"
            style="background:rgba(255,255,255,.15);border:none;color:white;width:28px;height:28px;
                   border-radius:6px;cursor:pointer;font-size:14px;">✕</button>
        </div>
      </div>

      <div style="padding:18px 22px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div class="email-field-row">
          <label class="email-field-label">Subject</label>
          <input id="ec-subject" class="input-field" style="flex:1;" value="${subject || ''}"/>
        </div>
        <div class="email-field-row" style="margin-top:10px;">
          <label class="email-field-label">To</label>
          <div class="email-pill-wrap" id="ec-to-wrap">
            ${(toEmails||[]).map(e => `<span class="email-pill">${e}<button onclick="removeEmailPill('ec-to','${e}')">✕</button></span>`).join('')}
            <input type="email" class="email-pill-input" id="ec-to-input"
              placeholder="Add email…" onkeydown="addEmailPillOnEnter(event,'ec-to')"/>
          </div>
        </div>
        <div class="email-field-row" style="margin-top:10px;">
          <label class="email-field-label">CC</label>
          <div class="email-pill-wrap" id="ec-cc-wrap">
            ${allCCs.map(e => `<span class="email-pill email-pill-cc">${e}<button onclick="removeEmailPill('ec-cc','${e}')">✕</button></span>`).join('')}
            <input type="email" class="email-pill-input" id="ec-cc-input"
              placeholder="Add CC…" onkeydown="addEmailPillOnEnter(event,'ec-cc')"/>
          </div>
        </div>
        <div style="margin-top:10px;">
          <button class="email-quick-add-btn" onclick="addTeamToCCs('${productId}')">+ Team</button>
          <button class="email-quick-add-btn" onclick="addStakeholdersToCCs('${productId}')">+ Stakeholders</button>
        </div>
      </div>

      <div style="padding:16px 22px;flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <label class="email-field-label">Body</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <span id="ec-ai-status" style="font-size:11px;color:var(--text-muted);">Generating draft…</span>
            <button class="btn-outline" style="font-size:11px;padding:4px 10px;" id="ec-regen-btn"
              onclick="regenerateEmailDraft('${type}','${productId}')" disabled>↻ Regenerate</button>
          </div>
        </div>
        <textarea id="ec-body" class="input-field" rows="14"
          style="resize:vertical;font-size:13px;line-height:1.7;font-family:'Poppins',sans-serif;"
          placeholder="Generating AI draft…"></textarea>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border);flex-shrink:0;
                  display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <select id="ec-send-mode" class="select-field" style="font-size:12px;width:auto;">
          <option value="real">Live</option>
          <option value="test">Test (${TEST_EMAIL})</option>
        </select>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline" onclick="document.getElementById('email-composer-modal').style.display='none'">Cancel</button>
          <button class="btn-primary" id="ec-send-btn" onclick="sendComposedEmail()" disabled>Send email</button>
        </div>
      </div>
    </div>`;
  modal.style.display = 'flex';

  // Store context for send + regenerate
  modal._emailContext = { type, draftPrompt, productId, onSend, isThreadStarter };

  // Generate AI draft
  try {
    const draft = await generateAIDraft(draftPrompt);
    const bodyEl = document.getElementById('ec-body');
    const statusEl = document.getElementById('ec-ai-status');
    const regenBtn  = document.getElementById('ec-regen-btn');
    const sendBtn   = document.getElementById('ec-send-btn');
    if (bodyEl)   bodyEl.value = draft;
    if (statusEl) statusEl.textContent = 'AI draft ready — edit freely';
    if (regenBtn) regenBtn.disabled = false;
    if (sendBtn)  sendBtn.disabled  = false;
  } catch(e) {
    const bodyEl   = document.getElementById('ec-body');
    const statusEl = document.getElementById('ec-ai-status');
    const sendBtn  = document.getElementById('ec-send-btn');
    if (bodyEl)   { bodyEl.placeholder = ''; bodyEl.value = ''; }
    if (statusEl) statusEl.textContent = 'AI draft failed — write manually or check API key';
    if (sendBtn)  sendBtn.disabled = false;
  }
}

window.regenerateEmailDraft = async (type, productId) => {
  const modal = document.getElementById('email-composer-modal');
  if (!modal?._emailContext) return;
  const bodyEl   = document.getElementById('ec-body');
  const statusEl = document.getElementById('ec-ai-status');
  const regenBtn = document.getElementById('ec-regen-btn');
  if (statusEl) statusEl.textContent = 'Regenerating…';
  if (regenBtn) regenBtn.disabled = true;
  if (bodyEl)   bodyEl.value = '';
  try {
    const draft = await generateAIDraft(modal._emailContext.draftPrompt);
    if (bodyEl)   bodyEl.value = draft;
    if (statusEl) statusEl.textContent = 'New draft ready';
  } catch(e) {
    if (statusEl) statusEl.textContent = 'Failed — try again';
  }
  if (regenBtn) regenBtn.disabled = false;
};

window.sendComposedEmail = async () => {
  const modal   = document.getElementById('email-composer-modal');
  const context = modal?._emailContext;
  if (!context) return;

  const subject  = document.getElementById('ec-subject')?.value.trim() || '';
  const body     = document.getElementById('ec-body')?.value.trim() || '';
  const testMode = document.getElementById('ec-send-mode')?.value === 'test';
  const sendBtn  = document.getElementById('ec-send-btn');

  if (!body) { showToast('Email body is empty.', 'error'); return; }

  const toEmails = getEmailsFromPills('ec-to-wrap');
  const ccEmails = getEmailsFromPills('ec-cc-wrap');

  if (toEmails.length === 0) { showToast('Add at least one recipient.', 'error'); return; }
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }

  try {
    // Check if this product has an existing thread — route accordingly
    const prod     = productListCache[context.productId] || {};
    const threadId = prod.gmailThreadId;

    if (threadId && !context.isThreadStarter) {
      // ── REPLY IN THREAD ──
      const result = await callGAS('replyToThread', { sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
        threadId, emailBody: body, subject, toEmails, ccEmails,
        testMode, productName: prod.name,
      });
      if (!result.ok) throw new Error(result.error || 'Reply failed');
    } else {
      // ── NEW EMAIL (or thread starter) ──
      await context.onSend({ subject, body, toEmails, ccEmails, testMode });
    }

    modal.style.display = 'none';
    showToast(threadId && !context.isThreadStarter ? 'Reply sent in thread.' : 'Email sent.', 'success');
  } catch(e) {
    showToast('Send failed: ' + e.message, 'error');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send email'; }
  }
};

/* ── Email pill helpers ──────────────────────────────────── */
function getEmailsFromPills(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return [];
  return [...wrap.querySelectorAll('.email-pill')].map(p =>
    p.textContent.replace('✕','').trim()
  ).filter(Boolean);
}

window.removeEmailPill = (containerId, email) => {
  const wrap = document.getElementById(containerId + '-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.email-pill').forEach(p => {
    if (p.textContent.replace('✕','').trim() === email) p.remove();
  });
};

window.addEmailPillOnEnter = (e, containerId) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const input = e.target;
  const email = input.value.trim().replace(',','');
  if (!email || !email.includes('@')) return;
  const wrap  = document.getElementById(containerId + '-wrap');
  if (!wrap) return;
  // Don't add duplicates
  const existing = getEmailsFromPills(containerId + '-wrap');
  if (existing.includes(email)) { input.value = ''; return; }
  const pill = document.createElement('span');
  pill.className = 'email-pill' + (containerId === 'ec-cc' ? ' email-pill-cc' : '');
  pill.innerHTML = `${email}<button onclick="removeEmailPill('${containerId}','${email}')">✕</button>`;
  wrap.insertBefore(pill, input);
  input.value = '';
};

window.addTeamToCCs = async (productId) => {
  await loadTeamMembers();
  const wrap = document.getElementById('ec-cc-wrap');
  const input = document.getElementById('ec-cc-input');
  if (!wrap || !input) return;
  const existing = getEmailsFromPills('ec-cc-wrap');
  Object.values(TEAM_MEMBERS).forEach(m => {
    if (!m.email || existing.includes(m.email)) return;
    const pill = document.createElement('span');
    pill.className = 'email-pill email-pill-cc';
    pill.innerHTML = `${m.email}<button onclick="removeEmailPill('ec-cc','${m.email}')">✕</button>`;
    wrap.insertBefore(pill, input);
  });
};

window.addStakeholdersToCCs = (productId) => {
  const wrap  = document.getElementById('ec-cc-wrap');
  const input = document.getElementById('ec-cc-input');
  if (!wrap || !input) return;
  const existing = getEmailsFromPills('ec-cc-wrap');
  const prod = productListCache[productId] || {};
  const relevant = STAKEHOLDERS.filter(s => s.enabled !== false &&
    (prod.onboardedEmails || []).includes(s.email));
  relevant.forEach(s => {
    if (existing.includes(s.email)) return;
    const pill = document.createElement('span');
    pill.className = 'email-pill email-pill-cc';
    pill.innerHTML = `${s.email}<button onclick="removeEmailPill('ec-cc','${s.email}')">✕</button>`;
    wrap.insertBefore(pill, input);
  });
};

/* ── Escalation chain editor ─────────────────────────────── */
export function renderEscalationEditor(el, chain, productId) {
  el.innerHTML = (chain || []).map((level, i) => `
    <div class="escalation-level-row">
      <span style="font-size:12px;font-weight:500;color:var(--text-mid);white-space:nowrap;">After</span>
      <input type="number" class="input-field" style="width:60px;" value="${level.daysOverdue}"
        onchange="updateEscalationDays('${productId}',${i},this.value)"/>
      <span style="font-size:12px;color:var(--text-mid);white-space:nowrap;">days overdue, also notify:</span>
      <input type="text" class="input-field" style="flex:1;"
        placeholder="email1@mixtafrica.com, email2@mixtafrica.com"
        value="${(level.addEmails||[]).join(', ')}"
        onblur="updateEscalationEmails('${productId}',${i},this.value)"/>
      <button class="btn-danger-xs" onclick="removeEscalationLevel('${productId}',${i})">✕</button>
    </div>`).join('') ||
    '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No escalation levels set.</div>';
}

window.addEscalationLevel = (productId) => {
  const prod = productListCache[productId] || {};
  if (!prod.escalationChain) prod.escalationChain = [];
  prod.escalationChain.push({ daysOverdue: 14, addEmails: [] });
  const el = document.getElementById('escalation-editor');
  if (el) renderEscalationEditor(el, prod.escalationChain, productId);
};

window.updateEscalationDays = (productId, idx, val) => {
  const prod = productListCache[productId];
  if (prod?.escalationChain?.[idx]) prod.escalationChain[idx].daysOverdue = parseInt(val) || 7;
};

window.updateEscalationEmails = (productId, idx, val) => {
  const prod = productListCache[productId];
  if (prod?.escalationChain?.[idx]) {
    prod.escalationChain[idx].addEmails = val.split(',').map(e => e.trim()).filter(Boolean);
  }
};

window.removeEscalationLevel = (productId, idx) => {
  const prod = productListCache[productId];
  if (prod?.escalationChain) {
    prod.escalationChain.splice(idx, 1);
    const el = document.getElementById('escalation-editor');
    if (el) renderEscalationEditor(el, prod.escalationChain, productId);
  }
};

/* ══ AI PROMPTS PER EMAIL TYPE ═══════════════════════════════ */
export function buildOnboardingPrompt(prod, dept, deptTasks, stakeholderName) {
  const taskList = deptTasks.map((t, i) =>
    `${i+1}. ${t.title || t.name} — deadline: ${t.deadline || 'TBD'}`
  ).join('\n');
  return `Write a professional onboarding email for ${stakeholderName} from the ${dept} department.

Product context:
- Name: ${prod.name}
- Description: ${prod.description || 'A new Mixta Africa product launch'}
- Target launch date: ${prod.launchDate}
- Total tasks: ${Object.keys(prod.tasks || prod.pillars || {}).length}

${dept} department's specific responsibilities for this product:
${taskList}

Write 2-3 paragraphs:
1. Brief context about the product and why their involvement matters
2. What specifically they need to deliver and by when
3. Clear next step / call to action

Tone: professional, highly collaborative, and warm. Address them by department, not by name. NEVER use harsh directives or commanding language like "Deliver the following by the indicated dates". Instead, use supportive, team-oriented phrasing such as "We kindly request your team's support with...", "Please help us achieve these milestones by...", and "We look forward to collaborating with you."`;
}
function buildReminderPrompt(prod, task, daysOverdue) {
  const severity = daysOverdue >= 21 ? 'escalation'
                 : daysOverdue >= 7  ? 'firm'
                 : daysOverdue >= 1  ? 'urgent'
                 : 'warning';
  const toneMap = {
    warning:    'a polite but clear reminder that the deadline is approaching',
    urgent:     'a firm, direct message that this is now overdue and needs immediate action',
    firm:       'a serious escalation tone — this is significantly delayed and needs a concrete update by end of day',
    escalation: 'a critical escalation — this task is severely overdue and leadership has been informed. Request an immediate status update and revised deadline.',
  };
  const lastNote = task.notes ? `\nLast recorded note: "${task.notes}"` : '';
  return `Write ${toneMap[severity]} for a task that is ${daysOverdue > 0 ? daysOverdue + ' days overdue' : 'due today'}.

Product: ${prod.name} (target launch: ${prod.launchDate})
Task: ${task.title || task.name}
Owner department: ${task.owner || 'responsible team'}
Original deadline: ${task.deadline}${lastNote}

Write 2 short paragraphs. Be specific about the task and the impact of the delay on the product launch. End with a clear ask: provide a status update by [today's date] and a revised completion date.`;
}

export function buildProgressReportPrompt(prod, tasks, pct) {
  const complete = tasks.filter(t => t.status === 'complete').length;
  const delayed  = tasks.filter(t => t.status === 'delayed').length;
  const overdue  = tasks.filter(t => t.deadline && t.status !== 'complete' && getPillarStatus(t.deadline) === 'overdue').length;
  const atRisk   = tasks.filter(t => t.deadline && t.status !== 'complete' && getPillarStatus(t.deadline) === 'warning').map(t => t.title||t.name).join(', ');
  const overdueList = tasks.filter(t => t.deadline && t.status !== 'complete' && getPillarStatus(t.deadline) === 'overdue').map(t => (t.title||t.name) + ' (' + t.owner + ')').join(', ');

  return `Write a concise progress report email body for internal stakeholders.

Product: ${prod.name}
Launch date: ${prod.launchDate}
Overall completion: ${pct}% (${complete}/${tasks.length} tasks)
Delayed tasks: ${delayed}
Overdue tasks: ${overdue}${overdueList ? ' — ' + overdueList : ''}
At risk (due within 3 days): ${atRisk || 'none'}

Write 3 short sections with bold headers:
**Status Summary** — one sentence on overall health
**Key Risks** — specific tasks or areas that need attention (be concrete)
**Required Actions** — what stakeholders need to do before the next update

Be direct. No filler. Flag risks clearly.`;
}

export function buildHandoverPrompt(prod, tasks, relieverName, returnDate, ownerNotes) {
  const complete = tasks.filter(t => t.status === 'complete').length;
  const open     = tasks.filter(t => t.status !== 'complete');
  const critical = open.filter(t => t.deadline && getPillarStatus(t.deadline) !== 'ontrack');
  const openList = open.slice(0,5).map(t => `- ${t.title||t.name} (${t.owner||'?'}) — ${t.deadline||'TBD'}`).join('\n');
  const critList = critical.map(t => `- ${t.title||t.name}: ${t.deadline||'?'}`).join('\n') || 'None critical at this time';

  return `Write a professional handover briefing for ${relieverName} who is covering ${prod.name} until ${returnDate}.

Product: ${prod.name} — target launch ${prod.launchDate}
Progress: ${complete}/${tasks.length} tasks complete
${ownerNotes ? 'Owner notes: ' + ownerNotes : ''}

Open tasks requiring attention:
${openList}

Critical / overdue items:
${critList}

Write this as a proper briefing document in 3 sections:
**Situation** — where the product stands today in one paragraph
**Priority actions** — the 3 most important things to focus on immediately, with specific names and deadlines
**Watch points** — risks to monitor and who to contact for each workstream

Write as if handing over to a capable colleague who needs context fast.`;
}

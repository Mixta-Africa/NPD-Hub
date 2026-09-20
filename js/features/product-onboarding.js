/* features/product-onboarding.js — Stakeholder confirmation and the Apps Script launch (Drive folder + onboarding emails). */

import { db, ref, set } from '../core/firebase.js';
import { currentPreferredName, currentUser } from '../core/state.js';
import { getDepts, STAKEHOLDERS } from '../data/app-config.js';
import { getProductTasks } from '../data/product-model.js';
import { callGAS } from '../core/gas.js';
import { productListCache } from '../data/products-cache.js';
import { loadProductList } from '../views/products.js';
import { pendingProduct, set_pendingProduct } from './product-form.js';
import { buildOnboardingPrompt, openEmailComposer } from './email-composer.js';
import { logActivity } from './activity.js';

let selectedStakeholders = [];

window.showStakeholderConfirm = (product) => {
  set_pendingProduct( product);
  selectedStakeholders = STAKEHOLDERS.map(s => s.email); // all selected by default

  document.getElementById('modal-title-text').textContent = 'Confirm stakeholder notifications';
  document.getElementById('modal-body-content').innerHTML = buildStakeholderConfirm(product);
  document.getElementById('create-product-modal').style.display = 'flex';
};

function buildStakeholderConfirm(product) {
  // Group stakeholders by department
  const depts = {};
  STAKEHOLDERS.forEach(s => {
    if (!depts[s.dept]) depts[s.dept] = [];
    depts[s.dept].push(s);
  });

  const deptRows = Object.entries(depts).map(([dept, members]) => `
    <div class="sc-dept">
      <div class="sc-dept-name">${dept}</div>
      ${members.map(s => `
        <label class="sc-member">
          <input type="checkbox" class="sc-checkbox" value="${s.email}" checked
            onchange="toggleStakeholder('${s.email}', this.checked)"/>
          <span class="sc-member-name">${s.name}</span>
          <span class="sc-member-email">${s.email}</span>
        </label>`).join('')}
    </div>`).join('');

  return `
    <div class="sc-intro">
      <p><strong>${product.name}</strong> has been saved to Firebase.</p>
      <p style="margin-top:6px;color:var(--text-mid);">Review and confirm which stakeholders should receive the onboarding email and Drive folder access. Uncheck anyone you want to exclude.</p>
    </div>
    <div class="sc-actions-top">
      <button class="btn-outline" style="font-size:12px;" onclick="toggleAllStakeholders(true)">Select all</button>
      <button class="btn-outline" style="font-size:12px;" onclick="toggleAllStakeholders(false)">Deselect all</button>
      <span class="sc-count" id="sc-count">${STAKEHOLDERS.length} selected</span>
    </div>
    <div class="sc-dept-list">${deptRows}</div>
    <div style="margin:12px 0;border-top:1px solid var(--border);padding-top:14px;">
      <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Add a person not in the list</div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;">
          <label class="form-label" style="font-size:10px;">Name</label>
          <input id="ob-custom-name" class="input-field" placeholder="e.g. J. Smith" style="width:100%;"/>
        </div>
        <div style="flex:2;min-width:200px;">
          <label class="form-label" style="font-size:10px;">Email</label>
          <input id="ob-custom-email" class="input-field" placeholder="name@mixtafrica.com" style="width:100%;"/>
        </div>
        <div style="flex:1;min-width:130px;">
          <label class="form-label" style="font-size:10px;">Department</label>
          <select id="ob-custom-dept" class="select-field" style="width:100%;">
            ${getDepts().map(d => '<option value="' + d + '">' + d + '</option>').join('')}
          </select>
        </div>
        <button class="btn-outline" style="font-size:12px;padding:8px 14px;white-space:nowrap;" onclick="addCustomOnboardEmail()">+ Add</button>
      </div>
      <div id="ob-custom-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;"></div>
    </div>
    <div class="form-row" style="margin-bottom:12px;border-top:1px solid var(--border);padding-top:12px;">
      <label class="form-label">Google Drive Setup</label>
      <select id="drive-create-mode" class="select-field" style="width:100%;">
        <option value="sop">Create standard 8 SOP folders</option>
        <option value="blank">Create empty Drive folder (I will name subfolders later)</option>
        <option value="skip">Skip Drive creation for now</option>
      </select>
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <label class="form-label">Send mode</label>
      <select id="onboard-send-mode" class="select-field" style="width:100%;">
        <option value="real">Live — send to selected stakeholders</option>
        <option value="test">Test — o.olasunkanmi@mixtafrica.com only</option>
      </select>
    </div>
    <div class="form-actions">
      <button class="btn-outline" onclick="skipGASSetup()">Skip (do later)</button>
      <button class="btn-primary" onclick="confirmAndLaunchGAS()">
        Confirm & send notifications
      </button>
    </div>`;
}

window.toggleStakeholder = (email, checked) => {
  if (checked) {
    if (!selectedStakeholders.includes(email)) selectedStakeholders.push(email);
  } else {
    selectedStakeholders = selectedStakeholders.filter(e => e !== email);
  }
  const countEl = document.getElementById('sc-count');
  if (countEl) countEl.textContent = `${selectedStakeholders.length} selected`;
};

window.addCustomOnboardEmail = () => {
  const name  = (document.getElementById('ob-custom-name')?.value || '').trim();
  const email = (document.getElementById('ob-custom-email')?.value || '').trim().toLowerCase();
  const dept  = document.getElementById('ob-custom-dept')?.value || '';
  if (!email || !email.includes('@')) { showToast('Enter a valid email address', 'error'); return; }
  if (selectedStakeholders.includes(email)) { showToast('Already in the list', 'info'); return; }

  // Add to selection
  selectedStakeholders.push(email);

  // Also add to STAKEHOLDERS temporarily so it's included in the email batch
  if (!STAKEHOLDERS.find(s => s.email === email)) {
    STAKEHOLDERS.push({ id: 'custom_' + Date.now(), name: name || email.split('@')[0], email, dept, isDeptEmail: false, enabled: true });
  }

  // Show chip in the custom list
  const listEl = document.getElementById('ob-custom-list');
  if (listEl) {
    const chip = document.createElement('span');
    chip.style.cssText = 'background:#F0FDF4;border:1px solid #BBF7D0;color:#16A34A;font-size:11px;padding:3px 10px;border-radius:20px;display:inline-flex;align-items:center;gap:6px;';
    chip.innerHTML = (name || email) + ' <span style="cursor:pointer;font-weight:700;" onclick="removeCustomOnboardEmail(this,\'' + email + '\')">×</span>';
    listEl.appendChild(chip);
  }

  // Update count
  const countEl = document.getElementById('sc-count');
  if (countEl) countEl.textContent = selectedStakeholders.length + ' selected';

  // Clear inputs
  if (document.getElementById('ob-custom-name')) document.getElementById('ob-custom-name').value = '';
  if (document.getElementById('ob-custom-email')) document.getElementById('ob-custom-email').value = '';
  showToast((name || email) + ' added to onboarding list', 'success');
};

window.removeCustomOnboardEmail = (el, email) => {
  selectedStakeholders = selectedStakeholders.filter(e => e !== email);
  el.closest('span').remove();
  const countEl = document.getElementById('sc-count');
  if (countEl) countEl.textContent = selectedStakeholders.length + ' selected';
};

window.toggleAllStakeholders = (selectAll) => {
  selectedStakeholders = selectAll ? STAKEHOLDERS.map(s => s.email) : [];
  document.querySelectorAll('.sc-checkbox').forEach(cb => {
    cb.checked = selectAll;
  });
  const countEl = document.getElementById('sc-count');
  if (countEl) countEl.textContent = `${selectedStakeholders.length} selected`;
};

window.skipGASSetup = () => {
  closeProductModal();
  showToast('Product created. Drive setup and emails skipped.', 'info');
  loadProductList();
  set_pendingProduct( null);
  selectedStakeholders = [];
};

window.confirmAndLaunchGAS = async () => {
  if (!pendingProduct) return;
  if (selectedStakeholders.length === 0) {
    showToast('Select at least one stakeholder, or click Skip.', 'error'); return;
  }

  const btn = document.querySelector('#modal-body-content .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Setting up Drive…'; }

  try {
    // Step 1: Handle Drive Creation
    const driveMode = document.getElementById('drive-create-mode')?.value || 'sop';
    let folderUrl = pendingProduct.driveUrl || null;

    if (driveMode !== 'skip' && !folderUrl) {
      showToast('Setting up Drive...', 'info');
      const driveResult = await callGAS('createProductDrive', {
        productName:       pendingProduct.name,
        productId:         pendingProduct.id,
        launchDate:        pendingProduct.launchDate,
        stakeholderEmails: selectedStakeholders,
        folderStrategy:    driveMode // 'sop' or 'blank'
      });

      if (driveResult.ok && !driveResult.stub) {
        folderUrl = driveResult.folderUrl;
        await set(ref(db, `products/${pendingProduct.id}/driveUrl`), folderUrl);
        productListCache[pendingProduct.id].driveUrl = folderUrl;
      }
    }

    // Save onboarding metadata
    await set(ref(db, `products/${pendingProduct.id}/onboardedAt`), Date.now());
    await set(ref(db, `products/${pendingProduct.id}/onboardedEmails`), selectedStakeholders);

    closeProductModal();
    loadProductList();

    // Step 2: Open AI email composer for onboarding emails
    // Group recipients by dept for context-aware drafts
    const prod = { ...pendingProduct, driveUrl: folderUrl };
    const tasks = getProductTasks(prod);
    const deptMap = {};
    selectedStakeholders.forEach(email => {
      const s = STAKEHOLDERS.find(x => x.email === email);
      if (!s) return;
      if (!deptMap[s.dept]) deptMap[s.dept] = { emails: [], tasks: [] };
      deptMap[s.dept].emails.push(email);
    });
    tasks.forEach(task => {
      if (task.owner && deptMap[task.owner]) {
        deptMap[task.owner].tasks.push(task);
      }
    });

    // For onboarding, show a single composer covering all selected stakeholders
    // The AI writes a general onboarding email; user can customise per dept if needed
    const allDepts = Object.keys(deptMap).join(', ') || 'all departments';
    const taskSummary = tasks.slice(0, 6).map((t,i) =>
      `${i+1}. ${t.title||t.name} (${t.owner||'?'}) — ${t.deadline||'TBD'}`
    ).join('\n');

    await openEmailComposer({
      type:      'onboarding',
      subject:   `${prod.name} — Product Launch Onboarding`,
      toEmails:  selectedStakeholders,
      ccEmails:  prod.defaultCCs || [],
      productId: prod.id,
      draftPrompt: buildOnboardingPrompt(prod, allDepts, tasks.slice(0, 8), 'the team'),
      onSend: async ({ subject, body, toEmails, ccEmails, testMode }) => {
        const result = await callGAS('sendComposedEmail', { sentByName: currentPreferredName || currentUser.displayName || currentUser.email.split('@')[0], sentByEmail: currentUser.email,
          subject, body, toEmails, ccEmails,
          testMode,
          productName:     prod.name,
          folderUrl:       folderUrl || null,
          isThreadStarter: true,   // ← capture thread ID
        });
        // Store thread ID in Firebase for all future emails on this product
        if (result.threadId) {
          await set(ref(db, 'products/' + prod.id + '/gmailThreadId'), result.threadId);
          if (productListCache[prod.id]) productListCache[prod.id].gmailThreadId = result.threadId;
        }
        await logActivity(prod.id, 'status', 'Onboarding emails sent', `To: ${toEmails.length} recipients`);
        showToast(`Onboarding email sent to ${toEmails.length} recipient${toEmails.length!==1?'s':''}.`, 'success');
      },
    });

  } catch(e) {
    showToast('Setup failed: ' + e.message, 'error');
    closeProductModal();
    loadProductList();
  }

  set_pendingProduct( null);
  selectedStakeholders = [];
};

/* ── RE-ONBOARD: trigger stakeholder confirm for existing product ── */
window.reOnboardProduct = (productId) => {
  const prod = productListCache[productId];
  if (!prod) return;
  // Reuse the existing stakeholder confirm flow
  showStakeholderConfirm(prod);
};

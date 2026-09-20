/* features/readonly-portfolio.js — Read-only portfolio dashboard for the GCCO and the link generator. */

import { db, get, ref } from '../core/firebase.js';
import { currentUser } from '../core/state.js';
import { PILLARS } from '../data/app-config.js';
import { callGAS } from '../core/gas.js';
import { formatDate, getPillarStatus, statusLabel } from '../data/status.js';

/* ══ PHASE 6: READ-ONLY PRODUCT PAGE ════════════════════════ */
function checkReadOnlyRoute() {
  const hash = window.location.hash;
  if (!hash.startsWith('#/product/')) return false;
  const productId = hash.replace('#/product/', '').trim();
  if (!productId) return false;
  renderReadOnlyPage(productId);
  return true;
}

async function renderReadOnlyPage(productId) {
  // Show a minimal read-only view without requiring auth
  document.getElementById('screen-login').style.display  = 'none';
  document.getElementById('screen-denied').style.display = 'none';
  document.getElementById('screen-app').style.display    = 'none';

  const ro = document.getElementById('screen-readonly');
  if (!ro) {
    const div = document.createElement('div');
    div.id = 'screen-readonly';
    div.style.cssText = 'min-height:100vh;background:#F8F8F7;padding:32px 24px;max-width:760px;margin:0 auto;';
    document.body.appendChild(div);
  }
  const screen = document.getElementById('screen-readonly');
  screen.style.display = 'block';
  screen.innerHTML = '<div class="loading-row" style="padding:48px;text-align:center;">Loading product status...</div>';

  try {
    const snap = await get(ref(db, `products/${productId}`));
    const prod  = snap.val();
    if (!prod) { screen.innerHTML = '<div style="text-align:center;padding:48px;"><h2>Product not found</h2></div>'; return; }

    const complete = PILLARS.filter(pl => prod.pillars?.[pl.id]?.taskStatus === 'complete').length;
    const pct      = Math.round((complete / PILLARS.length) * 100);
    const overdue  = PILLARS.filter(pl => {
      const pd = prod.pillars?.[pl.id];
      return pd?.deadline && pd?.taskStatus !== 'complete' && getPillarStatus(pd.deadline) === 'overdue';
    }).length;

    const pillarRows = PILLARS.map((pl, i) => {
      const pd  = prod.pillars?.[pl.id] || {};
      const st  = pd.taskStatus || 'not-started';
      const dst = pd.deadline ? getPillarStatus(pd.deadline) : 'no-date';
      const isComplete = st === 'complete';
      const deadlinePill = !pd.deadline ? '<span class="pill pill-grey">No date</span>'
        : isComplete      ? `<span class="pill pill-blue">${formatDate(pd.deadline)}</span>`
        : dst==='overdue' ? `<span class="pill pill-red">Overdue — ${formatDate(pd.deadline)}</span>`
        : dst==='warning' ? `<span class="pill pill-amber">Due soon — ${formatDate(pd.deadline)}</span>`
        : `<span class="pill pill-green">${formatDate(pd.deadline)}</span>`;
      return `<tr class="tracker-row${isComplete?' tracker-row-done':isDelayed?' tracker-row-delayed':''}">
        <td class="tracker-num">${i+1}</td>
        <td class="tracker-pillar"><div class="tracker-pillar-name">${pl.name}</div><div class="tracker-pillar-owner">${pl.owner}</div></td>
        <td class="tracker-deadline">${deadlinePill}</td>
        <td class="tracker-status"><span class="task-status task-${st}">${statusLabel(st)}</span></td>
      </tr>`;
    }).join('');

    screen.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:32px;height:32px;background:#C0282D;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-family:'Poppins',sans-serif;font-size:13px;font-weight:600<img src="Mixta%20Africa.jpg" alt="Mixta Africa" style="width:32px;height:32px;border-radius:8px;object-fit:cover;display:block;"/>">M</div>
        <div style="font-size:12px;color:#9a9a96;text-transform:uppercase;letter-spacing:.07em;">Mixta Africa — NPD Hub</div>
      </div>
      <h1 style="font-family:'Poppins',sans-serif;font-size:24px;font-weight:700;margin-bottom:4px;">${prod.name}</h1>
      <p style="font-size:13px;color:#6b6b67;margin-bottom:24px;">Launch: ${formatDate(prod.launchDate)} &nbsp;·&nbsp; Last updated: ${new Date(prod.updatedAt||prod.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</p>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">
        <div style="background:white;border:1px solid #e5e4e0;border-radius:8px;padding:16px 18px;">
          <div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Complete</div>
          <div style="font-size:26px;font-weight:600;color:#16A34A;">${complete}/12</div>
        </div>
        <div style="background:white;border:1px solid #e5e4e0;border-radius:8px;padding:16px 18px;">
          <div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Progress</div>
          <div style="font-size:26px;font-weight:600;">${pct}%</div>
        </div>
        <div style="background:white;border:1px solid #e5e4e0;border-radius:8px;padding:16px 18px;">
          <div style="font-size:11px;color:#9a9a96;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Overdue</div>
          <div style="font-size:26px;font-weight:600;color:${overdue>0?'#C0282D':'#1a1a18'};">${overdue}</div>
        </div>
      </div>

      <div style="background:white;border:1px solid #e5e4e0;border-radius:8px;overflow:auto;margin-bottom:24px;">
        <table class="tracker-table">
          <thead><tr>
            <th style="width:32px;">#</th><th>Pillar</th>
            <th style="width:180px;">Deadline</th>
            <th style="width:130px;">Status</th>
          </tr></thead>
          <tbody>${pillarRows}</tbody>
        </table>
      </div>
      <div style="font-size:11px;color:#9a9a96;text-align:center;">This is a read-only status page. Contact the NPD Hub admin for access.</div>`;
  } catch(e) {
    screen.innerHTML = `<div style="text-align:center;padding:48px;"><h2>Failed to load</h2><p>${e.message}</p></div>`;
  }
}

// Check for read-only route on load
window.addEventListener('hashchange', () => { checkReadOnlyRoute(); });

window.generateGCCOLink = async () => {
  const btn = document.getElementById('gcco-btn');
  const res = document.getElementById('gcco-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const result = await callGAS('gccoGenerateLink', { generatedBy: currentUser.email });
    if (result.ok && result.url) {
      if (res) {
        res.style.display = 'block';
        res.innerHTML =
          '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:14px 16px;">' +
            '<div style="font-size:11px;font-weight:600;color:#16A34A;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Link ready — share this with the GCCO</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<input id="gcco-link-input" type="text" value="' + result.url + '" readonly ' +
                'style="flex:1;font-size:11px;padding:8px 10px;border:1px solid #E5E5E3;border-radius:6px;background:#fff;font-family:SFMono-Regular,Consolas,monospace;color:#1A1A1A;">' +
              '<button onclick="copyGCCOLink()" style="background:#16A34A;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:600;font-family:Poppins,sans-serif;cursor:pointer;">Copy</button>' +
            '</div>' +
            '<div style="font-size:11px;color:#6B7280;margin-top:8px;">This link expires when you generate a new one.</div>' +
          '</div>';
      }
    } else {
      showToast('Could not generate link: ' + (result.error || 'unknown error'), 'error');
    }
  } catch(e) {
    showToast('Failed to reach GAS backend', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate shareable link'; }
  }
};

window.copyGCCOLink = () => {
  const input = document.getElementById('gcco-link-input');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => showToast('Link copied to clipboard', 'success'));
};

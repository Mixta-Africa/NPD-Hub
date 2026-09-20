/* superadmin/health.js — Health checks and the synthetic ping test. */

import { db, get, ref, set } from '../core/firebase.js';
import { GAS_ENDPOINT } from '../core/config.js';
import { currentUser, saSessionStart } from '../core/state.js';
import { callGAS } from '../core/gas.js';
import { getProductsFresh } from '../data/products-cache.js';
import { AI_PROVIDERS, discoverModel, providerConfigured } from '../features/ai.js';

/* ── TAB: HEALTH & PING TEST ──────────────────────────────── */
window.renderSAHealth = async (el) => {
  el.innerHTML = `
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Synthetic Ping Test & Health Check</span></div>
      <div class="panel-body">
        <p style="font-size:13px;color:var(--text-mid);margin-bottom:16px;line-height:1.6;">
          Tests Database Read/Write, Google Apps Script connectivity, Email dispatch, and AI Provider availability.
          Runs automatically in the background once a day when an admin logs in.
        </p>
        <button class="btn-primary" id="ping-btn" onclick="runComprehensivePingTest()" style="width:100%;">Run Diagnostic & Email Summary</button>
        <div id="ping-results" style="margin-top:16px;font-size:12px;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    </div>`;
};

window.runComprehensivePingTest = async (isBackground = false) => {
  const btn = document.getElementById('ping-btn');
  const res = document.getElementById('ping-results');
  
  if (btn && !isBackground) { btn.disabled = true; btn.textContent = 'Running diagnostics...'; }
  if (res && !isBackground) res.innerHTML = '<div class="loading-row">Initiating ping sequence...</div>';

  const results = [];
  let allPassed = true;

  const logRes = (name, ok, msg) => {
    results.push({name, ok, msg});
    if (!ok) allPassed = false;
    if (res && !isBackground) {
      res.innerHTML += `<div style="padding:10px;border-radius:6px;background:${ok?'#F0FDF4':'#FEF2F2'};color:${ok?'#16A34A':'#C0282D'}; border: 1px solid ${ok?'#BBF7D0':'#FECACA'};"><strong>${name}:</strong> ${msg}</div>`;
    }
  };

  if (res && !isBackground) res.innerHTML = '';

  // 1. Test Firebase Read
  try {
    const snap = await get(ref(db, 'config/system'));
    logRes('Database Read', snap.exists(), 'Successfully fetched system configuration.');
  } catch(e) { logRes('Database Read', false, e.message); }

  // 2. Test Firebase Write
  try {
    await set(ref(db, 'sa_log/last_ping'), Date.now());
    logRes('Database Write', true, 'Successfully wrote to audit log.');
  } catch(e) { logRes('Database Write', false, e.message); }

  // 3. Test GAS Endpoint Configuration
  try {
    if (!GAS_ENDPOINT || GAS_ENDPOINT.includes('__')) throw new Error('GAS_ENDPOINT is not configured or still contains placeholder text.');
    logRes('GAS Configuration', true, 'Endpoint URL is present.');
  } catch(e) { logRes('GAS Configuration', false, e.message); }

  // 4. Test AI Providers
  const aiAvailable = AI_PROVIDERS.filter(providerConfigured);
  if (aiAvailable.length === 0) {
    logRes('AI Providers', false, 'No API keys configured.');
  } else {
    try {
      const model = await discoverModel(aiAvailable[0]);
      logRes('AI Engine', true, `Successfully reached ${aiAvailable[0].name} API and resolved model: ${model}.`);
    } catch(e) {
      logRes('AI Engine', false, e.message);
    }
  }

  // 5. Build Summary and Send Email via GAS
  const summaryText = results.map(r => `[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.msg}`).join('<br><br>');
  const subject = `[${allPassed ? 'OK' : 'ALERT'}] NPD Hub Daily Health Check`;
  
  try {
    await callGAS('sendComposedEmail', {
      subject: subject,
      body: `<h3 style="color:${allPassed ? '#16A34A' : '#C0282D'};">Daily System Diagnostic</h3>
             <p>Triggered by: ${currentUser.email}</p>
             <div style="font-family:monospace;background:#F8F8F7;padding:12px;border-radius:8px;">${summaryText}</div>`,
      toEmails: [currentUser.email], // Sends the report directly to the admin who triggered it
      ccEmails: [],
      testMode: false,
      sentByName: 'System Diagnostic',
      sentByEmail: currentUser.email,
    });
    logRes('Email Dispatch', true, `Diagnostic report successfully queued for ${currentUser.email}.`);
  } catch(e) {
    logRes('Email Dispatch', false, 'Failed to connect to GAS to send email: ' + e.message);
  }

  if (btn && !isBackground) { btn.disabled = false; btn.textContent = 'Run Diagnostic & Email Summary'; }
  
  // Record today's date so the background job doesn't run twice in one day
  const todayStr = new Date().toISOString().split('T')[0];
  await set(ref(db, 'config/last_auto_ping'), todayStr);
};

/* ── TAB 1: SYSTEM HEALTH ─────────────────────────────────── */
export async function renderSAHealth(el) {
  el.innerHTML = '<div class="loading-row" style="padding:24px;">Running health checks...</div>';

  const results = {};

  // Firebase connection check
  try {
    const snap = await get(ref(db, '.info/connected'));
    results.firebase = snap.val() === true ? 'ok' : 'warn';
  } catch(e) { results.firebase = 'error'; }

  // Error count in last 24h
  try {
    const errSnap  = await get(ref(db, 'errors'));
    const errors   = errSnap.val() || {};
    const cutoff   = Date.now() - 86400000;
    results.errors24h = Object.keys(errors).filter(k => parseInt(k) > cutoff).length;
  } catch(e) { results.errors24h = '?'; }

  // Product count
  try {
    const prods    = await getProductsFresh();
    results.products = Object.keys(prods).length;
    results.active   = Object.values(prods).filter(p => p.status !== 'archived').length;
  } catch(e) { results.products = '?'; results.active = '?'; }

  // User count
  try {
    const userSnap = await get(ref(db, 'users'));
    results.users  = Object.keys(userSnap.val() || {}).length;
  } catch(e) { results.users = '?'; }

  // GAS ping
  let gasStatus = 'checking';
  let gasMsg    = '';
  try {
    const r = await callGAS('ping', {});
    gasStatus = r.ok ? 'ok' : 'error';
    gasMsg    = r.message || r.error || '';
  } catch(e) { gasStatus = 'error'; gasMsg = e.message; }

  const statusDot = (s) => `<span class="sa-status-dot sa-dot-${s}"></span>`;

  el.innerHTML = `
    <div class="sa-health-grid">
      <div class="sa-health-card">
        ${statusDot(results.firebase)} Firebase RTDB
        <div class="sa-health-val">${results.firebase === 'ok' ? 'Connected' : 'Issue detected'}</div>
      </div>
      <div class="sa-health-card">
        ${statusDot(gasStatus)} GAS Backend
        <div class="sa-health-val">${gasStatus === 'ok' ? 'Live' : 'Unreachable'}</div>
        ${gasMsg ? `<div class="sa-health-sub">${gasMsg}</div>` : ''}
      </div>
      <div class="sa-health-card">
        ${statusDot(results.errors24h > 0 ? 'warn' : 'ok')} Errors (24h)
        <div class="sa-health-val">${results.errors24h}</div>
      </div>
      <div class="sa-health-card">
        ${statusDot('ok')} Active Products
        <div class="sa-health-val">${results.active} / ${results.products}</div>
      </div>
      <div class="sa-health-card">
        ${statusDot('ok')} Team Members
        <div class="sa-health-val">${results.users} users</div>
      </div>
      <div class="sa-health-card">
        ${statusDot('ok')} SA Session
        <div class="sa-health-val">${Math.round((Date.now() - saSessionStart)/60000)}m active</div>
      </div>
    </div>
    <div style="margin-top:14px;text-align:right;">
      <button class="btn-secondary-sm" onclick="loadSATab('health')">↻ Refresh</button>
    </div>`;
}

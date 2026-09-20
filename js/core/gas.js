/* core/gas.js — callGAS(): the single bridge to the Google Apps Script backend (email, Drive, Sheets). */

import { GAS_ENDPOINT } from './config.js';

// loadTeamMembers defined above


/* ══ GAS HELPER — call GAS backend endpoint ══ */
export async function callGAS(action, payload) {
  const resp = await fetch(GAS_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ action, ...payload }),
  });
  return resp.json();
}

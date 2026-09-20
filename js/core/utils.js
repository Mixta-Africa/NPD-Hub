/* core/utils.js — Small shared helpers: email sanitising, SHA-256, ISO week keys. */

/* ─────────────────────────────────────────────
   ALLOWLIST — stored in Firebase RTDB at:
   /allowlist/{email_sanitised}: { role: 'admin' | 'readonly', name: '...' }
   
   Admin emails (seed): populate Firebase manually on first setup.
   Structure: o_olasunkanmi_mixtafrica_com → { role: 'admin', name: 'Timi' }
   (dots and @ replaced with _ for Firebase key safety)
───────────────────────────────────────────── */
export function sanitiseEmail(email) {
  return email.replace(/\./g, '_').replace(/@/g, '_');
}

// SHA-256 hash using Web Crypto API (browser-native, no libraries)
export async function sha256(message) {
  const msgBuffer  = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getWeekKey() {
  const now  = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `week_${now.getFullYear()}-${String(week).padStart(2,'0')}`;
}

/* core/config.js — Deploy-time secrets and endpoints. The ONLY file with __PLACEHOLDER__ tokens (filled in by deploy.yml). */

/* ─────────────────────────────────────────────
   FIREBASE CONFIG
   Replace ALL REPLACE_WITH_REAL_VALUES values with your
   actual Firebase project credentials.
   In production these are injected by deploy.yml
   via GitHub Secrets — never hardcode them here.
───────────────────────────────────────────── */
export const firebaseConfig = {
  apiKey:            "__FIREBASE_API_KEY__",
  authDomain:        "__FIREBASE_AUTH_DOMAIN__",
  databaseURL:       "__FIREBASE_DATABASE_URL__",
  projectId:         "__FIREBASE_PROJECT_ID__",
  storageBucket:     "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId:             "__FIREBASE_APP_ID__"
};

// GAS endpoint — injected at deploy time
export const GAS_ENDPOINT = '__GAS_ENDPOINT__';
export const GROQ_API_KEY      = '__GROQ_API_KEY__';
export const CEREBRAS_API_KEY  = '__CEREBRAS_API_KEY__';
export const SAMBANOVA_API_KEY = '__SAMBANOVA_API_KEY__';
export const TEST_EMAIL   = 'o.olasunkanmi@mixtafrica.com';

// Super admin password hash — injected at deploy time (SHA-256, never stored as plaintext)
export const SA_PASSWORD_HASH = '__SUPER_ADMIN_HASH__';

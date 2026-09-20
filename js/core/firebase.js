/* core/firebase.js — Firebase initialisation. Every other module imports Firebase from here, never from the CDN. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, set, onValue, update, push }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { firebaseConfig } from './config.js';

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const db       = getDatabase(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: 'mixtafrica.com' }); // restrict to Mixta domain

/* ── Re-exports: every other module imports Firebase from here, never from the CDN ── */
export { get, onAuthStateChanged, onValue, push, ref, set, signInWithPopup, signOut, update };

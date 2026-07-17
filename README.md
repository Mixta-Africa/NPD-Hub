# Mixta Africa — NPD Hub
## New Product Development Operations Hub

**Phase 1 complete.** Foundation: Firebase Auth + Google Sign-In + allowlist + app shell.

---

## Setup checklist (do once before going live)

### 1. Create a new Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Name it: `mixta-npd-hub` (keep it isolated from the Projects Dashboard)
3. Enable **Google Analytics** → off (not needed)

### 2. Enable Firebase Auth

1. In Firebase console → **Authentication** → Get started
2. Sign-in providers → **Google** → Enable
3. Add your domain to Authorised domains:
   - `[your-github-username].github.io` (or your custom domain)

### 3. Enable Realtime Database

1. **Realtime Database** → Create database → Start in **test mode** initially
2. Copy the **Database URL** (looks like `https://mixta-npd-hub-default-rtdb.firebaseio.com`)
3. After testing, set these security rules:

```json
{
  "rules": {
    "allowlist": {
      ".read":  "auth != null",
      ".write": "auth != null && root.child('allowlist').child(auth.token.email.replace('.','_').replace('@','_')).child('role').val() === 'admin'"
    },
    "products": {
      ".read":  "auth != null && root.child('allowlist').child(auth.token.email.replace('.','_').replace('@','_')).exists()",
      ".write": "auth != null && root.child('allowlist').child(auth.token.email.replace('.','_').replace('@','_')).child('role').val() === 'admin'"
    }
  }
}
```

### 4. Get your Firebase config

Firebase console → Project settings → Your apps → **Add app** → Web  
Copy the `firebaseConfig` object values.

### 5. Add GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret name | Where to find it |
|-------------|-----------------|
| `FIREBASE_API_KEY` | Firebase project settings |
| `FIREBASE_AUTH_DOMAIN` | Firebase project settings |
| `FIREBASE_DATABASE_URL` | Realtime Database → Data tab |
| `FIREBASE_PROJECT_ID` | Firebase project settings |
| `FIREBASE_STORAGE_BUCKET` | Firebase project settings |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase project settings |
| `FIREBASE_APP_ID` | Firebase project settings |
| `GAS_ENDPOINT` | Set up in Step 6 (Phase 4 only) |

### 6. Seed the allowlist (first admin — yourself)

In Firebase console → Realtime Database → **+** (add manually):

```
allowlist/
  o_olasunkanmi_mixtafrica_com/
    role: "admin"
    name: "Timi"
    addedAt: 1721000000000
```

**Key format:** replace `.` and `@` in email with `_`  
e.g. `o.olasunkanmi@mixtafrica.com` → `o_olasunkanmi_mixtafrica_com`

Add your second Commercial Strategy colleague the same way (or use the Settings panel once you're logged in).

### 7. Create GitHub repo and push

```bash
git init
git add .
git commit -m "Phase 1: Foundation & Auth"
git remote add origin https://github.com/YOUR_ORG/npd-hub.git
git branch -M main
git push -u origin main
```

### 8. Enable GitHub Pages

Repo → Settings → Pages → Source: **Deploy from a branch** → `gh-pages` → Save  
The deploy workflow will create the `gh-pages` branch on first push.

---

## Phase status

| Phase | What | Status |
|-------|------|--------|
| 1 | Firebase setup + Auth + allowlist + app shell | ✅ Complete |
| 2 | Create product form, milestone dates, Firebase write, product list | ⏳ Next |
| 3 | Calendar widget + task tracker with deadline colour states | — |
| 4 | GAS: Drive folder creation + onboarding emails | — |
| 5 | GAS: Deadline alert engine + GitHub Actions daily cron | — |
| 6 | Document upload centre + progress reports + Sheets audit + read-only page | — |

---

## Stakeholder mailing list (hardcoded in Phase 4)

From `Dashboard_Mailing_List_NPD.xlsx`:

| Department | Emails |
|------------|--------|
| Design | dcs_nigeria@, a.arokodare@, c.uwadiale@, a.uwuigbe@ |
| AMC | deji.alli@, s.hughes@, b.ajayi@, t.akinsulire@, p.ozolua@, u.ndubuisi@ |
| IPD | ipd_nigeria@, pmo_nigeria@, w.salami@, t.banjo@, h.kacou@ |
| Costing | mn_costingandprocurement@, o.james@, j.olowe@, o.ogunewu@, t.ibidokun@ |
| MCC | mcc@, o.kolawole@, k.haastrup@ |

All `@mixtafrica.com`.

---

## GAS backend (Phase 4 setup)

1. Go to [script.google.com](https://script.google.com) → New project
2. Paste contents of `gas-backend.js`
3. Deploy → New deployment → Web app → Execute as: Me → Access: Anyone
4. Copy URL → GitHub Secret `GAS_ENDPOINT`

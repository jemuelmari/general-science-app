# General Science Online Modular Application

**Grade 11 · Iba High School · Schools Division of Tarlac Province · Region III**

A modular, offline-first learning platform for Grade 11 General Science, covering Physics, Chemistry, Life Science, and Earth Science across three terms.

🔗 **Live app:** https://jemuelmari.github.io/general-science-app/
📦 **Repository:** https://github.com/jemuelmari/general-science-app

---

## ✨ Features Overview

### For Students
- **Three-term modular curriculum** — 10 weeks × 4 days per term
- **Daily activities** — lesson → match game → scenario → escape room
- **Formative assessments** — Quizzes (20 items), Summative Tests (30 items), Term Exams (60 items)
- **Performance tasks** — 3 PTs per term with rubrics
- **Automatic scoring** with item-level tracking
- **Badge system** — earn badges for mastery, speed, flawless completion
- **Cross-device sync** — auto-push quiz attempts to Google Sheets; sync codes for cross-device progress transfer
- **Offline queue** — attempts sync automatically when back online

### For Teachers
- **Dashboard** — class overview, student progress
- **Class Record** — DepEd-format grading sheet with automatic transmutation
- **TOS Generator** — auto-generate Tables of Specification aligned to competencies
- **Item Analysis** — difficulty, discrimination, distractor analysis, per-competency MPS
- **Sync Center** — pull student attempts from Google Sheets, apply to class record
- **Term Control** — lock/unlock terms per section
- **Activity Tracker** — monitor student completion
- **Assessment Tracker** — track locked assessments, unlock for retakes

---

## 🏗️ Architecture

### Frontend
- Pure HTML/CSS/JS (no framework)
- ES5-ish IIFE modules (backward-compatible, no build step)
- LocalStorage for all student data (offline-first)
- SessionStorage for active sessions
- Google Apps Script backend for cross-device sync (optional)

### Backend (optional)
- Google Apps Script as Web App
- HMAC-SHA256 signature verification
- Canonical JSON signing
- Sheets: `SyncCodes`, `TermAccess`, `Log`, `Attempts`, `History`
- Rate limiting, expiry, auto-archive

### Data Files
- `data/competencies.json` — master competency list (30 competencies × 3 terms)
- `student/term{N}/assessments/*.json` — 27 assessment banks (18 quiz/ST/TE + 9 PTs)
- `student/term{N}/week{N}/week{N}.json` — 30 week banks with 4 days each

---

## 📁 Repository Structure
/
├── index.html # Landing page
├── teacher-login.html # Teacher authentication
├── instructor.html # Teacher dashboard
├── classrecord.html # Grading sheet
├── diagnostics.html # System diagnostics
├── config.js # Global config (BACKEND_URL, TEACHER_PASSWORD_HASH, etc.)
├── manifest.json # PWA manifest
├── VERSION.txt # Current version
├── BUILD_LOG.md # Full changelog
├── README.md # This file
│
├── assets/
│ ├── css/ # Stylesheets
│ └── js/
│ ├── app.js # Core utilities
│ ├── store.js # LocalStorage wrapper
│ ├── security.js # HMAC signing + anti-cheat
│ ├── randomize.js # Seeded shuffle (Set A/B)
│ ├── transmutation.js # Grade transmutation
│ ├── sync.js # Sync code + backend bridge
│ ├── sync-auto.js # Auto-push queue
│ ├── quiz-engine.js # Quiz/ST/TE engine
│ ├── lesson-engine.js # Daily lesson player
│ ├── activity-gate.js # Lock/unlock logic
│ ├── activity-tracker.js # Completion tracking
│ ├── teacher-auth.js # Teacher password
│ ├── teacher-auth-boot.js # Auth bootstrap
│ ├── tos-engine.js # TOS computation
│ ├── item-analysis-engine.js # Item analytics
│ ├── mastery-scales.js # MPS classification
│ ├── classrecord.js # Class record logic
│ └── ... (other modules)
│
├── backend/
│ └── google-apps-script/
│ └── Code.gs # Backend Web App
│
├── data/
│ └── competencies.json # Master competency list
│
├── student/
│ ├── login.html
│ ├── dashboard.html
│ ├── profile.html
│ ├── profile.js
│ ├── term1/
│ │ ├── index.html
│ │ ├── week1-10/
│ │ │ ├── day.html
│ │ │ ├── index.html
│ │ │ └── week{N}.json
│ │ └── assessments/
│ │ ├── pt1-3.html + .json
│ │ ├── quiz1-3.html + .json
│ │ ├── st1-2.html + .json
│ │ └── te.html + .json
│ ├── term2/ (same structure)
│ └── term3/ (same structure)
│
├── teacher/
│ ├── activity-tracker.html
│ ├── assessment-tracker.html
│ ├── intervention.html
│ ├── item-analysis.html
│ ├── locked-assessments.html
│ ├── normalize-names.html
│ ├── sync-center.html
│ ├── term-control.html
│ └── tos-generator.html
│
└── classrecord/
├── grading-sheet.html
└── reports.html

text

---

## 🚀 Setup for New Deployment

### 1. Deploy the app (GitHub Pages)
- Fork or clone the repo
- Enable GitHub Pages (Settings → Pages → Source: `main` branch)
- App will be available at `https://{username}.github.io/{repo}/`

### 2. Configure backend (optional, for cross-device sync)
- Create a new Google Sheet (e.g., "GSA Sync Backend")
- Extensions → Apps Script → paste `backend/google-apps-script/Code.gs`
- Deploy → New deployment → Web app
  - Execute as: **Me**
  - Who has access: **Anyone**
- Copy the Web App URL
- Update `config.js` → `BACKEND_URL` with the URL
- Redeploy after any Code.gs change: **Deploy → Manage deployments → pencil → Version: New version → Deploy**

### 3. Set teacher password
- Open `teacher-login.html` in a browser
- DevTools Console: `await TeacherAuth.hash('yourNewPassword')`
- Copy the 64-char output
- Update `config.js` → `TEACHER_PASSWORD_HASH` with the hash
- Commit

---

## 👥 User Roles

| Role | Login | Landing |
|------|-------|---------|
| **Student** | `student/login.html` — LRN + name | `student/dashboard.html` |
| **Teacher** | `teacher-login.html` — password | `instructor.html` |

Students do not need accounts — they register with LRN and name, and all data is stored locally per device. Cross-device sync uses codes or the Google Sheets backend.

---

## 🔒 Security Model

- **HMAC-SHA256 signing** for all sync payloads
- **Canonical JSON** ensures identical signing across devices
- **Constant-time comparison** prevents timing attacks
- **Fail-closed authentication** — no default password
- **Session timeout** — 30 min inactivity
- **Lockout** — 3 failed attempts = 5 min lockout
- **Anti-cheat** — tab-switch detection, copy/paste disable, dev shortcut block during quizzes

**⚠️ Important:** The secret and password hash are in `config.js` (client-side). This is acceptable for a self-hosted DepEd classroom environment but **not** suitable for public production without backend-only auth.

---

## 📊 Grading System

**DepEd Weighting (per term):**
- **20%** Written Works (quizzes + STs)
- **50%** Performance Tasks (PTs)
- **30%** Term Exam (EX)
  - Where EX = 30% ST1 + 30% ST2 + 40% TE

**Transmutation:** Anchor raw score 70 → transmuted 75, monotonic table.

**Passing score:** 75% (configurable via `config.js` → `passingScore`).

---

## 🎨 Theme

- **Term 1:** #0d47a1 (Blue) — Physics & Chemistry
- **Term 2:** #00695c (Teal) — Chemistry & Life Science
- **Term 3:** #004d40 (Dark Green) — Earth Science

---

## 📝 For Developers

- **ES5-style IIFE modules** — no build step, works with plain `<script>` tags
- **String concatenation** preferred over template literals in core JS
- **LocalStorage** for state — no database
- **Cache-busting** via `?v=X` query strings on script tags
- **Phase 2.5 path detection** — `getRepoBase()` in modules that fetch data

### Adding a new assessment
1. Create `student/term{N}/assessments/{name}.json` with questions tagged `competency` + `bloomLevel`
2. Create `student/term{N}/assessments/{name}.html` that loads `quiz-engine.js`
3. Update TOS engine (`assets/js/tos-engine.js`) if needed

### Adding a new competency
1. Update `data/competencies.json` with new entry
2. Tag relevant questions with the new code
3. Re-run TOS generator

---

## 📞 Support

**Developer:** JEMUEL C. MARI, MAN, RN, LPT
**Position:** Senior High School Teacher - Teacher II
**School:** Iba High School · San Jose West District · Tarlac Province

---

## 📜 License

For DepEd Iba High School internal use only. Not for redistribution.

---

**Version:** v1.0.4 · **Last Updated:** 2026-09-22

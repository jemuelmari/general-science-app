# BUILD LOG — General Science Online Modular Application

**Repository:** https://github.com/jemuelmari/general-science-app
**Live:** https://jemuelmari.github.io/general-science-app/
**Developer:** JEMUEL C. MARI, MAN, RN, LPT · Iba High School · DepEd Region III
**Grade Level:** 11 · Sections: ACADEMIC A, ACADEMIC B

---

## v1.0.4 — Content Revision + Release (2026-09-22)

### Phase 6 — Assessment Content Revision (17 files)
- **Term 1** (5 files): 8 items revised
  - `quiz1.json`, `quiz3.json`, `st1.json`, `st2.json`, `te.json`
- **Term 2** (6 files): 25 items revised
  - `quiz1.json`, `quiz2.json`, `quiz3.json`, `st1.json`, `st2.json`, `te.json`
- **Term 3** (6 files): 34 items revised
  - `quiz1.json`, `quiz2.json`, `quiz3.json`, `st1.json`, `st2.json`, `te.json`

**Objective:** Eliminate test-wise guessing cues from distractors that were significantly shorter than correct answers.

**Changes made:**
- Length-balance distractors to match correct-answer length (±30% tolerance)
- Preserve question text, correct answer, competency code, and Bloom's level
- Consistency: same question appearing in multiple assessments (e.g., quiz + ST + TE) gets identical revision

**Total:** 67 items revised across all 3 terms. 5 items legitimately kept as-is (proper nouns, false positives, synthesis questions).

### Configuration
- `config.js` — bumped to v1.0.4

### Known issues resolved
- X38 — HMAC signature mismatch (frontend vs backend canonical JSON)
- X41 — `getSyncStatus` GET vs POST mismatch
- X43 — Item Analysis rendering bug (nested quotes in color ternary)

---

## v1.0.3 — Sync Backend + Item Analysis (2026-09-21)

### Direct Google Sheets Sync (7 files)
- **Backend:** `backend/google-apps-script/Code.gs` v1.2.1
  - 5 new actions: `pushAttempt`, `pullAttempts`, `markUsedBulk`, `archiveUsed`, `getSyncStatus`
  - New sheets: `Attempts`, `History`
  - Canonical JSON signing (matches frontend exactly)
  - Rate limiting per (lrn, action)
  - Attempt expiry (90 days), auto-archive of used rows
- **Frontend:**
  - `assets/js/sync.js` v2.0.3 — canonical JSON, JSON round-trip before signing
  - `assets/js/sync-auto.js` v1.0.0 — offline queue, exponential retry, status events
  - `assets/js/security.js` v1.0.2 — `signString()` / `verifyString()` for canonical signing
- **UI:**
  - `student/dashboard.html` — floating sync badge (bottom-right), status panel, manual sync buttons
  - `teacher/sync-center.html` — new "📡 Attempts" tab with pull, apply, mark-as-used, archive
- **Hooks:**
  - `assets/js/quiz-engine.js` v2.0.0 — auto-enqueue attempts after submit
  - Randomize set-aware shuffle (Set A / Set B per section)

### Teacher Authentication Fix
- `config.js` — added `TEACHER_PASSWORD_HASH` (SHA-256, 64 hex chars)
- Removed reliance on localStorage-only password storage
- Teacher login now works end-to-end

### Item Analysis Rendering Fix
- `teacher/item-analysis.html` v1.2.1 — extracted color logic into helper functions
- Fixes `#5f6368;">` raw-text bug from nested ternary + concatenation

---

## v1.0.2 — Enhanced Item Analysis + TOS (2026-09-20)

### Phase 5 — Enhanced Item Analysis (2 files)
- **New:** `assets/js/item-analysis-engine.js` v1.0.0
  - Per-item difficulty (p-value) with flagging (< 0.20 or > 0.80)
  - Discrimination index (upper 27% vs lower 27%)
  - Distractor analysis (per-option counts, dysfunctional detection)
  - Per-competency MPS with MasteryScales integration
  - Set-aware un-shuffling via `originalIndex`
- **New:** `teacher/item-analysis.html` v1.2.0
  - 5 tabs: Items / Distractors / Competencies / Most-Least Learned / Flags
  - Print + CSV export

### Phase 4 — Enhanced TOS Generator (3 files)
- `data/competencies.json` v1.0.1 — 6 Bloom's ceiling patches
- `assets/js/tos-engine.js` v2.0.0 — path detection restored, editable Bloom's, answer key cross-check
- `teacher/tos-generator.html` — inline editable Bloom's table, signatory sync, MLL from real MPS

---

## v1.0.1 — Competency Tagging + TOS (2026-09-19)

### Phase 3 — Competency + Bloom's Tagging (27 files)
- 18 assessment JSONs (quiz1-3, st1-2, te × 3 terms) — each question tagged with `competency` + `bloomLevel`
- 9 PT JSONs — top-level `competencies` array
- Review report flagged 71 length-disparity items + 11 Bloom's-out-of-range flags

---

## v1.0.0 — Security + Shuffle Unification (2026-09-18)

### Phase 2 — Security + Shuffle (8 files)
- `assets/js/security.js` — added `originalIndex` to shuffled questions; constant-time HMAC verify
- `assets/js/randomize.js` — scoreAttempt returns `originalIndex`; added `getOriginalIndex()`, `validateSets()`
- `assets/js/quiz-engine.js` — deterministic shuffle via Randomize; Set A/B from CONFIG.SET_ASSIGNMENT; preserve higher score
- `assets/js/teacher-auth.js` — removed DEFAULT_HASH (fail closed); unified session schema
- `teacher-login.html` — uses TeacherAuth.login(); honors ?next=; lockout countdown
- `assets/js/activity-tracker.js` — gate key v1→v2
- `assets/js/app.js` — formatLRN 12-digit; injectManifest path; getSetLetterForSection
- `assets/js/diagnostics.js` — removed eval(); fixed truncation regex

### Phase 1.5 — Reports Partial Data (2 files)
- `classrecord/reports.html` + `assets/js/classrecord.js` — show students with partial data

### Phase 1 — Data Integrity (11 files)
- `config.js` — passingScore 80→75, added SET_ASSIGNMENT, HOURS_PER_WEEK
- `assets/js/transmutation.js` — monotonic TABLE, added computeFinalGradeSafe()
- `assets/js/store.js` — TE save fix, PT score preserve, deleteUser sweep
- `assets/js/classrecord.js` + grading-sheet + reports — EX null fallback
- `build_gensci.py` — string.Template to escape JSON braces
- `student/dashboard.html` — restored gsa_logout_pending flag
- `data/competencies.json` — hours recomputed
- `student/term2/assessments/pt2.json` — "Community Immunity Story"
- `.gitignore` — added .bak, .DS_Store

---

## Known Issues (deferred to future releases)

| ID | Issue | Priority |
|----|-------|----------|
| X39 | `quiz-engine.js` should use `Randomize` (v2.0.0 already does) — legacy compat may need cleanup | Low |
| X40 | Missing PWA icons (`assets/img/icon-192.png`, `icon-512.png`) | Low |
| X42 | Missing `favicon.ico` | Low |
| X44 | Day 4 assessment gate bug — resolved separately | ✅ |

---

## Recent Commits

- `v1.0.4` — Phase 6 content revision, release finalization
- `v1.0.3` — Sync backend + Item Analysis fix + teacher auth fix
- `v1.0.2` — Enhanced TOS + Enhanced Item Analysis
- `v1.0.1` — Competency tagging
- `v1.0.0` — Security + shuffle unification

---

**Maintained by:** JEMUEL C. MARI, MAN, RN, LPT
**License:** For DepEd Iba High School use only.

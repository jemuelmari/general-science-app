/* ============================================================
   config.js — App configuration
   Version: 1.0.1
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Science Online Modular Application',
  VERSION: '1.0.1',

  // Auto-set at build time (edit manually for now)
  BUILD_DATE: '2026-09-20',

  // ---------- Subject Info ----------
  SUBJECT: 'General Science',
  GRADE_LEVEL: 'Grade 11',
  SECTIONS: ['ACADEMIC A', 'ACADEMIC B'],
  TERMS: ['term1', 'term2', 'term3'],

  // ---------- Set A / Set B Assignment ----------
  // Same questions for both sets; different deterministic shuffle.
  // Set A → ACADEMIC A, Set B → ACADEMIC B
  SET_ASSIGNMENT: {
    'ACADEMIC A': 'A',
    'ACADEMIC B': 'B'
  },

  // ---------- Developer Info ----------
  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher · Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },

  // ---------- Backend (Google Apps Script) ----------
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbzjd_jtwESdNPpP9Phv-ElmJcoywng3HY0r-BRVD3Ms7bDiH7G9xNGOrnFV3LQQAXSX/exec',

  get backendEnabled() {
    return this.BACKEND_URL && this.BACKEND_URL.length > 20;
  },

  // ---------- Theme Colors ----------
  THEME: {
    primary: '#0d47a1',
    primaryDark: '#062b5f',
    primaryLight: '#e3f2fd',
    accent: '#00acc1',
    accentLight: '#e0f7fa',
    gradebook: '#00695c',
    gradebookDark: '#004d40'
  },

  // ---------- Assessment Structure ----------
  ASSESSMENT: {
    quizzesPerTerm: 3,
    quizItems: 20,
    stPerTerm: 2,
    stItems: 30,
    ptPerTerm: 3,
    teItems: 60,
    // ⚠️ FIX (X1): Aligned with transmutation + quiz-engine + lesson-engine + activity-gate
    // All code uses 75. Previously config had 80 → inconsistent scoring.
    passingScore: 75,
    remediationThreshold: 75
  },

  // ---------- Weighting (DO 015, s. 2026 — Academic Elective) ----------
  WEIGHTS: {
    ww: 0.20,
    pt: 0.50,
    ex: 0.30
  },

  // ---------- EX Internal Breakdown ----------
  EX_INTERNAL: {
    st1: 0.30,
    st2: 0.30,
    te: 0.40
  },

  // ---------- Hours per Week ----------
  // 1.5 hrs/day × 4 days/week = 6 hours per week
  HOURS_PER_WEEK: 6,

  // ---------- Teacher Password ----------
  // ⚠️ SECURITY WARNING: This is a client-side hash. It is inherently
  // visible to anyone who opens DevTools. Change this hash immediately
  // after deployment. See README for instructions.
  //
  // ⚠️ FIX (X6 partial): Password is still the same as before; Phase 2
  // will unify teacher-login.html + teacher-auth.js to read from here.
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,
  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};

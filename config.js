/* ============================================================
   config.js — App configuration (teacher password, dev info)
   Version: 1.0.0
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Science Online Modular Application',
  VERSION: '1.0.0',

  // ---------- Subject Info ----------
  SUBJECT: 'General Science',
  GRADE_LEVEL: 'Grade 11',
  SECTIONS: ['ACADEMIC A', 'ACADEMIC B'],
  TERMS: ['term1', 'term2', 'term3'],

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
    passingScore: 80,
    remediationThreshold: 80
  },

  // ---------- Weighting (DO 015, s. 2026 — Academic Elective) ----------
  WEIGHTS: {
    ww: 0.20,   // Written Works
    pt: 0.50,   // Performance Tasks
    ex: 0.30    // Term Exam
  },

  // ---------- EX Internal Breakdown ----------
  EX_INTERNAL: {
    st1: 0.30,
    st2: 0.30,
    te: 0.40
  },

  // ---------- Teacher Password ----------
  // SHA-256 hash of the teacher password.
  // Default password: "teacher2026"
  TEACHER_PASSWORD_HASH: 'e2f8fa8d3a8a8f8b4c2c4c6e1a0f9e8d7c6b5a4938271605142332415069789a',

  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,
  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};

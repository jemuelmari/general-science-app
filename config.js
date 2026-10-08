/* ============================================================
   config.js — Global configuration
   Version: 1.0.7
   App: General Science
   Changelog:
     v1.0.7 — Fixed SCHOOL_INFO placement (was inside CONFIG object)
     v1.0.6 — (previous)
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Science',
  VERSION: '1.0.7',
  GRADE_LEVEL: 11,
  SECTIONS: ['ACADEMIC A', 'ACADEMIC B'],
  TERMS: ['term1', 'term2', 'term3'],

  SET_ASSIGNMENT: {
    'ACADEMIC A': 'A',
    'ACADEMIC B': 'B'
  },

  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher - Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },

  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbwv2AS8JiLQLL1YsUg5lZkUcBaXOSZKJk86X-HQPtqQ0x6M_5CyX_UYk_PTMWsVTsLM/exec',

  get backendEnabled() {
    return this.BACKEND_URL && this.BACKEND_URL.length > 20;
  },

  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',
  TEACHER_TOKEN_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000,
  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,

  THEME: {
    primary: '#0d47a1',
    primaryDark: '#062b5f',
    primaryLight: '#e3f2fd',
    accent: '#00acc1',
    accentLight: '#e0f7fa',
    gradebook: '#00695c',
    gradebookDark: '#004d40'
  }
};

/* ============================================================
   SCHOOL_INFO — Phase 4.5
   Hardcoded school/teacher info used by Exam Evidence generator.
   Edit here only — never hardcode in evidence.js.
   ============================================================ */
const SCHOOL_INFO = {
  region:          'Region III',
  division:        'Schools Division of Tarlac Province',
  schoolName:      'IBA HIGH SCHOOL',
  schoolAddress:   'Iba, San Jose, Tarlac',
  schoolYear:      'S.Y. 2026-2027',
  teacherName:     'JEMUEL C. MARI',
  teacherPosition: 'Teacher II',
  subject:         'General Science',
  gradeLevel:      'Grade 11'
};

/* Expose globally for scripts that don't use modules */
window.SCHOOL_INFO = SCHOOL_INFO;

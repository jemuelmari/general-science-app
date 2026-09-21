/* ============================================================
   config.js — Global configuration
   Version: 1.0.4
   App: General Science
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Science',
  VERSION: '1.0.4',
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

  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyRrtXVdXvkRjGhNpuj8Xwnwk5WGQ4eXgJ5kuIS4yUxdEEdAE4BjRruY75elXfFnogD/exec',

  get backendEnabled() {
    return this.BACKEND_URL && this.BACKEND_URL.length > 20;
  },

  // ============================================================
  // TEACHER AUTHENTICATION
  // ============================================================
  // The SHA-256 hash of the teacher password.
  // To change the password:
  //   1. Open teacher-login.html
  //   2. Open DevTools Console
  //   3. Run: await TeacherAuth.hash('yourNewPassword')
  //   4. Copy the 64-character output
  //   5. Paste it below (replacing the value)
  //   6. Commit
  // ============================================================
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',

  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000,        // 5 minutes
  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,    // 30 minutes

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

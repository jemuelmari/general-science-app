/* ============================================================
   config.js — Global configuration
   Version: 1.0.3
   App: General Science
   ============================================================ */

const CONFIG = {
  APP_NAME: 'General Science',
  VERSION: '1.0.3',
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

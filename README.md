# General Science Online Modular Application

**Version:** 1.0.0
**Subject:** General Science
**Grade Level:** Grade 11
**Sections:** ACADEMIC A, ACADEMIC B
**Term Structure:** 3 Terms (10 weeks each)
**School Year:** 2026–2027

---

## 👨‍🏫 Developer

**JEMUEL C. MARI, MAN, RN, LPT**
Senior High School Teacher · Teacher II
Iba High School
San Jose West District
Schools Division of Tarlac Province
Region III
Department of Education

---

## 📖 Overview

A web-based modular learning application for Senior High School General Science (Grade 11), aligned with the DepEd Three-Term Budget of Work (BOW) and DepEd Order No. 015, s. 2026.

Contains **three platforms**:

| Platform | File | Purpose |
|---|---|---|
| Student Application | `index.html` | Lessons, gamified activities, assessments, remediation |
| Teacher Application | `instructor.html` | Item analysis, intervention, sync center (password-protected) |
| Gradebook Application | `classrecord.html` | Class record, transmutation, reports (password-protected) |

---

## 📅 Term Structure

| Term | Coverage | Weeks | Focus |
|---|---|---|---|
| **Term 1** | Physics + Chemistry | 10 | Physics in daily life, machines, light & sound, chemistry of household products |
| **Term 2** | Chemistry + Life Science | 10 | Chemical reactions, solutions, cells, organ systems, climate change |
| **Term 3** | Earth Science | 10 | Earth's uniqueness, Philippine geology, natural hazards, DRRM |

---

## 📊 Assessment Structure (Per Term)

| Component | Count | Items | Coverage |
|---|---|---|---|
| Quizzes | 3 | 20 each | Spread across Weeks 1–10 |
| Summative Test 1 | 1 | 30 | Weeks 1–4 |
| Summative Test 2 | 1 | 30 | Weeks 5–8 |
| Performance Tasks | 3 | — | PT1 (W1–4), PT2 (W5–8), PT3 (W9–10) |
| Term Exam | 1 | 60 | Weeks 9–10 |

### Weighting (DO 015, s. 2026 — Academic Elective)

| Component | Weight |
|---|---|
| Written Works (WW) | 20% |
| Performance Tasks (PT) | 50% |
| Term Exam (EX) | 30% |

### EX Internal Breakdown

| Assessment | Weight of EX |
|---|---|
| Summative Test 1 | 30% |
| Summative Test 2 | 30% |
| Term Exam | 40% |

---

## 🔄 Transmutation (SY 2026–2027)

**Adjusted Transmutation Table applies.** Raw 70 → transmuted 75.

SY 2027–2028 onward: No transmutation for Grades 4–12.

---

## 🔐 Teacher Password

The default teacher password is `teacher2026`. **Change it before deploying.**

To change the password:

1. Open `teacher-login.html` in a browser
2. Press F12 → Console
3. Run: `TeacherAuth.hash('YourNewPassword').then(h => console.log(h))`
4. Copy the output hash
5. Paste it into `config.js` → `TEACHER_PASSWORD_HASH`
6. Commit and push

---

## 🎨 Theme

- **Primary color:** Science Blue `#0d47a1`
- **Accent color:** Cyan `#00acc1`
- **Gradebook accent:** Teal `#00695c`

---

## 📚 References

- DepEd Grade 11 General Science Three-Term Budget of Work (April 8, 2026)
- DepEd Order No. 015, s. 2026
- DepEd K to 12 Curriculum Guide

---

## 📝 License

For educational use. © 2026 Jemuel C. Mari. All rights reserved.
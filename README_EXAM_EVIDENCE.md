# Exam Evidence — General Science, Grade 11 (v1.0.0)

Parehong layout at architecture ng Exam Evidence ng General Biology; General Science na ang subject, ID prefix, at footer.

## Mga file (parehong folder paths sa repo)
- `teacher/evidence.html`  — page (Subject, Assessment, Section, Student, Paper size, Preview/Print/Word/Reload)
- `teacher/evidence.js`    — generator (HTML/print at Word)
- `assets/js/teacher.js`   — idagdag ang card sa Teacher Home (tingnan sa ibaba)

## Idagdag sa `assets/js/teacher.js` (sa listahan ng action cards)
```js
{ icon: '📄', title: 'Exam Evidence', desc: 'Printable proof of each student\'s actual exam — questions, answers, correct answers, score — with parent/guardian signature', href: 'teacher/evidence.html', color: '#0d47a1', badge: { text: 'New', type: 'info' } },
```

## Ano ang binago kumpara sa Biology
| Item | Biology | General Science |
|---|---|---|
| Subject key / pangalan | `biol1`, `biol2` | `gensci` — General Science |
| Evidence ID | `GB-XXXXXXXX` | `GS-XXXXXXXX` |
| Footer | General Biology Online Modular Application | General Science Online Modular Application |
| Question bank | `data/biol1-quiz1.json` | `data/gensci-quiz1.json` |
| Teacher token key | `gba_teacher_token` | `gsa_teacher_token` (binabasa rin ang `gba_teacher_token`) |

Pareho pa rin: bucket structure ng scores (`quizzes`, `st`, `te`), mga assessment (Quiz 1–3, Summative 1–2, Term Exam), mga signature block, Evidence ID, at ang pagsunod sa random order ng tanong ng estudyante.

## I-check bago gamitin (mga assumption)
Hindi ko nakita ang source ng General Science app, kaya ang mga ito ay hula mula sa Biology version. Lahat ay nasa taas ng `teacher/evidence.js`:
1. `TOKEN_KEY` — dapat tugma sa key na ginagamit ng `teacher-auth.js` ng GenSci app.
2. `bankFile()` / `BANK_DIRS` — dapat tugma sa pangalan at lokasyon ng question bank JSON.
3. `ASSESSMENTS` — palitan kung iba ang mga assessment ng GenSci (hal. per-week quiz).
4. Subject key `gensci` — dapat tugma sa key sa `Store.getScores()` / Google Sheet.
5. Competency codes (hal. `GENSCI-11-T2-W9-C1`) ay kinukuha sa `breakdown[].competency` o sa bank item.
6. School Year: `DEFAULT_SCHOOL_YEAR`; school/teacher info ay galing sa `CONFIG.DEVELOPER`.

## Paano gamitin
1. Teacher Home → **📄 Exam Evidence**.
2. Piliin ang Assessment, Section, at Student (o "All students in the selected section").
3. **Preview** → **Print / Save as PDF** o **Save as Word (.docx)**; ipapirma sa magulang/guardian.

Nangangailangan ng internet (docx library mula sa jsDelivr, question bank, at Google Sheet).

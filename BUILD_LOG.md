# BUILD LOG — General Science App

## Current Version: 1.0.0 (build 2026-09-20)

## Completed Features
- [x] 3-term structure (Term 1, 2, 3)
- [x] Student app (login, dashboard, term pages, week pages, day lessons)
- [x] Teacher app (dashboard, 8 tools)
- [x] Self-Diagnostic page + button on teacher dashboard
- [x] Version auto-sync (config.js → all pages)
- [x] Backend (Google Apps Script)

## In-Progress Features
- [ ] TOS Generator (teacher tool)
- [ ] Enhanced Item Analysis (competency tagging)
- [ ] Question rewrite (630 questions)
- [ ] Randomization engine (Set A / Set B)

## Design Decisions (Locked)
- Competency source: auto-extract from weekN.json
- Hours: from BOW
- Weights: sum to 100%
- Bloom's tagging: auto by keywords
- 30:70 rounding: nearest
- Set A/B: same questions, different shuffle
- Competency tagging: all 27 question JSONs
- Randomization: fixed per set
- Distractor rewrite: all questions
- Distractor rule: misconception-based, same length ±20%, plausible
- Term Exam: auto-generated from Top 5 Least Learned + Weeks 9-10 competencies
- TOS run timing: after STs (dashboard shows reminder banner)
- Least Learned computed: all-class (not per section)
- Total examinees: count of students who submitted by teacher-set deadline

## Next Batch
Batch 1: data/competencies.json

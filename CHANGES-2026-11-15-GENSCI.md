# General Science App — v1.3.1 (Nov 15, 2026)

Ito ang mga ginawa natin sa General Biology na wala pa sa General Science. **Hindi kailangang palitan ang Code.gs**: v1.12.1 pa rin.

---

## 1. Paano i-update

1. I-upload sa GitHub ang lahat ng file sa `changed-files-gensci.txt`.
2. Hintayin matapos ang GitHub Action na **"Bump cache-bust versions"**.
3. Buksan ang Teacher Dashboard. Dapat may bagong card na **📗 Fill DepEd ECR**.

---

## 2. Grade computation = DepEd SHS ECR

- **Transmutation table** — pareho na sa HELPER sheet ng official ECR:
  - 70.00 → 75, 100 → 100
  - ang pinakamababa ay **60**; hindi na raw + 5
- **Term grade** — kinukuwenta na gaya ng Term sheet ng ECR:
  - PS at WS ay naka-round sa 2 decimals.
  - Exams: ST1 30 + ST2 30 + TE 40.
  - Ang test na **naibigay na sa klase** pero hindi kinuha ng estudyante ay **0**, gaya ng blangko o 0 sa ECR.
- Iisa na ang computation sa Class Record, Grading Sheet, Reports at sa ECR filler.
- Ang percent ay kinukuwenta mula sa eksaktong score ÷ total. May mga naka-save kasing percent na naka-round, kaya nagkakaiba ng 1 ang grade sa ilang estudyante.
- ⚠️ **Weights:** WW 20 / PT 50 / QA 30 ang naka-set sa `config.js` ng GenSci.
  - Iba ito sa Gen Bio (25 / 45 / 30).
  - Kapag dumating ang ECR template ng GenSci, iche-check ko kung pareho sa HELPER sheet nito.

## 3. Bagong page: 📗 Fill DepEd ECR (`teacher/deped-ecr.html`)

- Piliin ang official na SHS ECR (.xlsx) ng isang section. Hindi ito ina-upload kahit saan.
- Kusang kinukuha ang scores ng klase mula sa cloud, kasama ang PT grades at paper scores.
- Pumili ng **Term** (1, 2 o 3). Ilalagay ang scores sa tamang Term sheet:

  | Sa app | Sa ECR |
  |---|---|
  | Quiz 1–3 | WW 1–3 (puwedeng simulan sa ibang column) |
  | PT 1–3 | PT 1–3 |
  | ST 1 / ST 2 / TE | ST 1 / ST 2 / TE |
  | HPS | Ilalagay lang kung naibigay na ang test |

- Ang LRN at pangalan ay ilalagay sa INPUT DATA, kung blangko pa ito.
- May preview ng "Grade (app)" na dapat lumabas sa ECR. Pareho ito sa sinubukan ko.
- Ida-download mo ang **mismong DepEd file**. Hindi gagalawin ang formulas, protection at format nito.

## 4. Item Analysis: DepEd school format

Lumalabas na ito sa ilalim ng resulta ng **Analyze**, at kapareho ng ITEM ANALYSIS file ng school.

**Ano ang ipinapakita:**
- Kada item: Correct Responses, % Success, Mastery Level at Intervention Plan.
- Dashboard: Class Average, Mean Mastery, Mastered Items, Distribution, at Key Findings.

**Ang mga button:**
- **⬇️ Excel** — ang mismong file ng school. Inaayos ito para sa 20, 30 o 60 items, kasama ang chart.
- **📋 Copy "Correct Responses"** — para i-paste sa D18 ng sarili mong file.
- **📋 Copy buong table**

Sinusunod nito ang Section at Set filter ng page.

## 5. TOS Generator → 💾 Save as Word (.docx)

- Landscape, puwedeng short bond, long bond o A4.
- Laman: DepEd header, TOS table, LOTS/HOTS, at signatories mula sa Edit Signatories.
- Puwedeng isama ang **Most/Least Learned** at ang **Answer Key**.
- Kapag offline, mada-download ito bilang .doc na nabubuksan pa rin sa Word.

## 6. Mga ayos

- **Tab-switch counter:** hindi na binibilang ang pag-reload o pag-close ng page.
- **Bug 1:** hindi lumalabas ang babala tuwing nag-switch ng tab ang estudyante habang nagte-test (`window.APP` ay undefined).
- **Bug 2:** hindi nabubura ang session sa device kapag nag-Logout ang estudyante (`window.Store` ay undefined).

  Ayos na ang dalawang ito. Ang mga module (APP, Store, Sync, TeacherAuth, TeacherAuthBoot) ay naka-expose na sa `window`.

---

## Files

**Bago:**
- `teacher/deped-ecr.html`, `teacher/deped-ecr.js`
- `teacher/item-analysis-deped.js`
- `teacher/tos-word.js`
- `assets/js/xlsx-lite.js`
- `assets/js/vendor/jszip.min.js`
- `data/templates/item-analysis-template.xlsx`

**Binago:**
- `config.js`, `instructor.html`, `classrecord.html`
- `assets/js/transmutation.js`, `assets/js/classrecord.js`, `assets/js/teacher-cloud.js`, `assets/js/security.js`
- `assets/js/app.js`, `assets/js/store.js`, `assets/js/sync.js`, `assets/js/teacher-auth.js`, `assets/js/teacher-auth-boot.js`
- `classrecord/grading-sheet.html`, `classrecord/reports.html`
- `teacher/item-analysis.html`, `teacher/tos-generator.html`

---

## v1.3.2 — Fill DepEd ECR, sinubukan sa mismong ECR ng GenSci (ACADEMIC A at B)

**Tugma ang weights.** Sa HELPER ng ECR, ang General Science ay WW 20 / PT 50 / Exams 30 at ST1 30 / ST2 30 / TE 40, kapareho ng app. Walang binago sa grading.

**Mga inayos sa `teacher/deped-ecr.js` (v1.1.0):**
- **Walang buburahin.** Dati, ang test na hindi pa naibigay ay nag-iiwan ng blangko sa column nito, kaya puwedeng mabura ang scores na itinype mo na. Ngayon, test lang na naibigay na ang isinusulat. Kapag walang score sa app pero may itinype ka sa ECR, hindi ito gagalawin.
- **Awtomatikong column.** Binabasa ang laman ng Term sheet. Kung nasa ECR na ang test (pareho ang HPS at karamihan ng scores), doon din ito ilalagay. Kung wala pa, sa susunod na bakanteng column. Puwedeng palitan kada test ("Saang column ilalagay?"). Inalis ang dating "Quiz 1 → WW column" at "PT 1 → PT column".
- **"Grade sa ECR" sa preview.** Kinokompute gamit ang mismong formulas at weights ng file, kasama ang mga score sa ECR na wala sa app. Pula kapag iba ito sa grade sa app.
- **Pagpares ng pangalan.** Kapag iba ang pagkakasulat ng pangalan (hal. "MA." sa ECR, "Maria" sa app), hindi na ito idinadagdag bilang bagong learner. Inaalok itong ipares sa pangalang nasa ECR (may "(posible)" kapag pareho ang apelyido).
- Mas mahigpit ang name matching: hindi na tumutugma kapag blangko ang first name sa app.

# Exam Evidence v2.0.0 — General Science (aligned sa exam engine)

## Mga file (parehong path sa repo; i-overwrite)
| File | Ano ang binago |
|---|---|
| `teacher/evidence.html`, `teacher/evidence.js` | Bagong Exam Evidence (Biology-style layout, naka-wire sa GenSci data) |
| `assets/js/quiz-engine.js` (v2.2.0) | Niloload na ang randomize.js; ayos ang `originalIndex`; ayos ang "Review Your Answers" |
| `assets/js/randomize.js` (v1.5.0) | Seeded na choices (online = papel), records `oo` at `qh` |
| `teacher/print-exam.js`, `teacher/print-exam.html` | Hindi na dodoble-shuffle; gagamit ng randomize v1.5.0 |

Pagkatapos: patakbuhin ang `update-version.sh` / bump-cache para ma-refresh ang service worker cache.

## Mga mali na nahanap sa exam
1. **Walang `randomize.js` sa lahat ng 18 assessment page** → palaging legacy `Math.random()` ang gamit: iba-iba ang pagkakasunod ng tanong AT choices bawat estudyante/attempt; hindi Set A/B; hindi tugma sa printed copies.
2. **`originalIndex` ay mali** sa legacy path (= shown position). Ginamit ito ng "Review Your Answers" ng estudyante → maling tanong ang katabi ng bawat ✅/❌.
3. **Lahat ng 540 item: tamang sagot ang option #1**, at naka-disable ang option shuffle (v1.4.0) → online, "A" ang laging tama. Ang papel lang ang nag-shuffle.
4. **`mergeData` sa Store** ay nagja-join ng arrays (itemResults) → posibleng doble/halong items sa cloud; inaayos ito ng evidence (dedupe + Attempts sheet).
5. Lumang evidence: `record.date` ay wala (ang field ay `timestamp`) kaya "—" ang petsa; `originalIndex` fallback; walang verification.

## Paano nag-a-align ang evidence
- Item #N = ang N-th na tanong na nakita ng bata (`index`); tanong via `questionId`; sagot/tama mula sa naka-save na `given`/`expected`.
- Bagong exams (v1.5.0): may `oo` → eksaktong A–D order; may `qh` → alam kung na-edit ang bank.
- Lumang attempts: buong text ang choices (walang letra) dahil hindi naitala ang random order.
- **Alignment check** panel bago mag-print (🟢 aligned · ℹ️ note · ⚠️ warning · ❌ error).

## Limitasyon
Hindi ko nakita ang deployed Code.gs (`pullTeacherDashboard`, `loginStudent` ay wala sa repo), kaya hindi ko na-test ang live cloud. Na-test ko sa Node: 1,080 items (18 banks × Set A/B) — walang pagkakaiba ang bagong online layout at ang dating papel.

# SYNC FIX — General Science App (Code.gs v1.10.0 + frontend 1.0.9)

Ginaya sa General Biology App: lahat ng progress ng student ay nasi-sync sa backend, at ang teacher page ay
nagpapakita ng **banner na "New student data is available. Refresh the page to see it."** kapag may bagong data.

## ⚠️ GAWIN MUNA SA GOOGLE (3 minuto)

1. Buksan ang Apps Script project → palitan ang BUONG laman ng `Code.gs` ng `backend/google-apps-script/Code.gs` sa zip na ito → **Save**.
2. **Deploy → Manage deployments → ✏️ (Edit) → Version: "New version" → Deploy.**
   Huwag "New deployment" — mananatili ang parehong URL kaya hindi mo kailangang baguhin ang `config.js`.
   Kapag hindi ka nag-"New version", lumang code pa rin ang tumatakbo kahit nag-paste ka na.
3. I-upload sa GitHub ang lahat ng files sa zip (parehong folder paths). Ang pagbabago sa `config.js` ay mag-trigger
   ng `bump-cache.yml` na magpapalit ng `?v=` sa lahat ng HTML, kaya makukuha ng mga device ang bagong JS.

Walang bagong sheet o column na kailangan. (Ang `DATA_VERSION` ay nasa Script Properties; kusang nagagawa.)

## Test
- `<BACKEND_URL>?action=ping` → dapat `"version":"1.10.0"`.
- Teacher: mag-login, buksan ang kahit anong teacher page. Habang may student na gumagawa/nagfi-finish ng activity,
  sa loob ng ~30s + ~3s (sync delay ng student) lalabas ang banner sa ibaba ng screen. **Refresh** = reload; **✕** = later.
- Student: gumawa ng progress sa phone A, buksan ang dashboard sa phone B → lalabas sa loob ng ~2 minuto (o agad pagbalik sa tab) nang hindi nagle-log in ulit.

## Paano gumagana
| Bahagi | Ginagawa |
|---|---|
| `Code.gs` `DATA_VERSION` | Tinataasan sa bawat write na nakikita ng teacher (progress, attempt, lock, unlock, retake, PT…). Ang walang-pagbabagong sync ay HINDI nagpapataas (walang false banner). |
| `getDataVersion` (teacher token) | Napakaliit na request (walang sheet scan). Pino-poll ng `teacher-watch.js` bawat 30s habang visible ang tab. |
| `teacher-watch.js` (bago) | Kusang nilo-load ng `teacher-auth.js` sa lahat ng teacher pages. Kinukumpara ang version ng data na nasa screen (galing sa `TeacherCloud.fetchStudents`) vs. kasalukuyan. Hindi nag-a-auto-reload (baka nagta-type/nagga-grade ang teacher). |
| `pullStudentProgress` | Read-only pull ng student; may `since` kaya "unchanged" lang ang sagot kapag walang bago. Hindi sinusulat sa Log sheet. |
| `store.js` `pullNow()` + auto-pull | Sa load, tuwing ~2 min sa listing pages (dashboard/term/week), pagbalik sa tab, pagbalik online. Ang listing pages ay kusang nagre-refresh kapag may nagbago (hindi kailanman ang quiz/lesson na ginagamit). |
| `quiz-engine.js` | Bago buksan ang quiz, nagpu-pull muna (max 4s) kaya hindi na pwedeng mag-retake sa ibang device ang nag-take na. |

## MGA NAKITANG ERROR AT FIX
| # | Problema | Saan | Fix |
|---|----------|------|-----|
| 1 | Teacher pages: fetch-on-load lang; walang paraan para malaman na luma na ang data | teacher pages | `teacher-watch.js` + `getDataVersion` + banner |
| 2 | Student: walang auto-pull — ang ibang device ay hindi nakikita ang bagong progress hangga't hindi nagle-log in ulit | store.js | `pullNow()` + auto-pull |
| 3 | **Stale device ay nao-overwrite ang `daily` points, `activity` scores at PT submission** (walang `percent` kaya laging pinapalitan; ang PT na re-submit ay hindi umaabot dahil ang tie-break ay `timestamp` na wala sa PT) | Code.gs `mergeProgressData` | `mergeScoreEntry`: newest timestamp ang panalo; `max()` para sa points/bestScore/attempts; `passed` = OR |
| 4 | **Locks ay "last device wins"** — ang lumang device na may `locks:{}` ay binubura ang lock sa server → pwedeng mag-retake sa ibang device | Code.gs, store.js | Locks ay *union*; ang unlock ay may tombstone `unlocks[key].unlockedAt` na tinatalo ang mas lumang lock |
| 5 | `pushUnlock` / `redeemUnlockCode` ay hindi umaabot sa StudentsMaster — device lang na nag-poll ang nakaka-unlock | Code.gs | Sinusulat din ang tombstone sa row ng student |
| 6 | **Unlock record ay nako-consume ng maling device**: ang unang device na mag-poll ay nagma-mark ng "applied" kahit wala itong lock, kaya ang device na may lock ay nanatiling locked | sync-auto.js, quiz-engine.js | Laging nag-aapply ng unlock (tombstone) |
| 7 | Login merge (`mergeData`): pinagdurugtong ang `itemResults` ng dalawang attempt (20 items sa 10-item quiz) at hybrid ang score (score mula sa isa, percent mula sa isa) | store.js | Isang buong record lang ang panalo (best percent; tie → mas bago; itinatago ang itemResults) |
| 8 | Sa login, kapag hindi "dirty" ay pinapalitan ng server ang local — nawawala ang local na wala pa sa server | store.js | Palaging merge |
| 9 | Walang timeout ang `Sync.backendPost` → isang nakabinbing request ay nagi-freeze ng buong attempt queue; ang error sa loob ng `flushNow` ay iniiwang `_isFlushing=true` habambuhay | sync.js, sync-auto.js | 25s timeout + `try/finally` |
| 10 | Bawat request ay dalawang row sa `Log` sheet (pati polling) → bumagal at napupuno | Code.gs | Hindi na nila-log ang `getDataVersion` / `pullStudentProgress` |
| 11 | Mag-tie ang dalawang score, ang kopya na na-strip ang itemResults (oversize) ang nananalo | Code.gs, store.js | Pinipili ang may itemResults |

## Alam na limitasyon (hindi ko ginalaw)
- Ang isang cell ng Sheet ay max 50,000 characters. Ang StudentsMaster `progressJSON` ay ~35 KB kapag buo na ang 3 terms (daily + activity entries ang pinakamalaki). Kapag lumagpas, tinatanggal ng `_safeJson` ang `itemResults` (nasa `Attempts` sheet pa rin); kapag lumampas pa rin sa 49,000, "Progress data too large to store". Kung aabot diyan, sabihan ako para i-compact ang `daily`/`activity`.
- Ang best-percent ang panalo sa quiz (hindi ang pinakabago). Kung gusto mong pinakabagong attempt ang ipakita sa teacher, baguhin ang `mergeScoreEntry` (Code.gs at store.js).
- Ang unlock-vs-lock ay naka-base sa oras ng device; ang device na ang orasan ay napakalayo ang atras ay maaaring hindi ma-lock agad pagkatapos ng unlock.
- Nasubukan ko ang backend at sync flow sa simulation (totoong `Code.gs` + totoong `store.js`, 2 device + teacher, may fake na Sheet) at sa Chromium; hindi sa totoong Google Apps Script.
- Ang `?v=1.3.0-58a088a?v=...?v=...` na paulit-ulit sa ilang HTML ay luma pang epekto ng workflow; hindi nakakasira, hindi ko ginalaw.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Personal finance app for a couple (Martin & Šárka). UI text, comments and commit messages are in Czech. The repo is **public** (GitHub Pages serves `main`), but the data is real — never put names, e-mails, account numbers or real amounts into code, tests or fixtures (tests use made-up numbers).

## Commands

```bash
npm test                                   # all unit tests (node --test, Node 24, no dependencies)
node --test tests/mbank-core.test.js       # one test file
node --test --test-name-pattern="Pejsek" tests/mbank-core.test.js   # one test
npm run gas:deploy                         # tests → clasp push → update the LIVE Apps Script deployment
```

No build, bundler or npm dependencies. Serve the folder over HTTP (ES modules don't load from `file://`): the `finance-app` config in `.claude/launch.json` runs `python -m http.server 8080`. Without a Firebase login the app shows only the login screen; to check UI changes locally, import the modules in the browser console, put fake data into `state` and call the `render*()` function. Browsers cache modules aggressively — re-fetch changed files with `fetch(url, {cache:'reload'})` before reloading.

## Architecture

- `index.html` — the whole UI (pages, modals). Inline `onclick` handlers call functions that `js/app.js` exposes on `window`; a new handler must be added there too.
- `js/*.js` — ES modules, one per domain, sharing one mutable `state` object (`js/state.js`). Each page has a `render*()`; `boot()` in `app.js` re-renders everything after data changes.
- `js/*-core.js`, `inv-parse.js`, `inflation-data.js`, `html.js` — pure logic without DOM/network, covered by tests. Put new calculations here and test them; keep DOM modules thin.
- `gas-update.js` — Google Apps Script backend (runs on Google, not locally) over the Google Sheet. Tested in Node by loading it into a `vm` context with fake Apps Script services (`tests/gas-write.test.js`, helper `makeGas`).
- `css/styles.css` — all styles.

### Data flow

- Every server call goes through `postJson()` / `fetchSheet()` / `fetchSheets()` in `utils.js` — never raw `fetch`. `postJson` attaches the Firebase ID token, throws on `{error}`, retries only when asked (`tries`) — never retry non-idempotent writes. It also emits `onActivity` start/end events that `busy.js` uses for the global “Ukládám…” indicator and for disabling the clicked button, so new writes get that for free.
- Reads are POST action `read` (one request for many sheets). GAS enforces auth (`AUTH_ENFORCE=1`): it verifies the ID token itself and checks roles (`AUTH_USERS_GAS`, SHA-256 of e-mails; Šárka can't see investments/salary). Client whitelist `AUTH_USERS` in `config.js` uses the same hashes.
- Load order (`loadSheets` in `app.js`): `Transakce` first (cached in localStorage), then the remaining sheets in one batch; then recurring payments auto-generate for the month and import banners are shown.
- Writes: edits use `updateRow` (in place by id, never delete+append); GAS serialises writes with `withLock` and refuses ambiguous ids (duplicates → error; weekly `dedupeIds` fixes them). New ids via `newId()` in `tx-core.js`. `ensureCols` widens a sheet when a row gets longer.

### Sheet `Transakce`

Column indices live in `C` in `config.js` (never raw indices); `parseRow()` in `utils.js` maps a row to a transaction. Notable columns: `id` (14; mBank imports contain `-mb`), `bilance` (19, counts into the Martin↔Šárka balance), `jednorazova` (20, one-off expense: counted everywhere except averages). Types: `Příjem`, `Výdaj`, `Vyrovnání` (settlement between the two, excluded from income/spending).

### Domain rules worth knowing

- **Categories**: single list `CATEGORIES` (+ `CATEGORY_COLORS`, `DEFAULT_LIMITS`) in `config.js`; form selects are filled from it. Automatic categorisation of bank lines is `guessCategory()` in `mbank-core.js` — order of rules matters (Pejsek and fuel stations before Jídlo, Zdraví/Bydlení before others); bank text is usually without diacritics and uppercase.
- **Summaries** (`summarize` in `tx-core.js`): úspora = příjem − spotřeba, investice count as savings, not spending.
- **Averages** (Grafy): only *closed* months — up to the month of the last imported mBank statement and never the running month (`closedMonths`); a category is averaged from its first appearance; one-off expenses excluded (`categoryAverages`).
- **mBank import** (`mbank-import.js`): pdf.js parsing → preview; duplicates matched 1:1 against existing transactions (same type, ±2 days, ±2 %, `matchDuplicates`); transfers to the savings account are skipped, transfers between Martin's and Šárka's accounts are pre-marked for the balance.
- **Salary** (`salary-core.js`, page only for Martin): payslip parser in `salary-import.js`. Salary level changes need 2 payslips up / 3 down. The bonus is cut exactly by worked hours, so the max bonus is derived from any payslip (`bonusSeries`); a reduction reason is shown only when it provably matches the vacation balance drop. Vacation is used within the calendar year (new entitlement in January, `vacationUsed`). Inflation = CPI index ratio (`inflation-data.js` + sheet `Inflace`).
- **Investments** (only Martin): providers CODYA, CONSEQ (funds, NAV scraped from their websites), UniCredit (quarterly statements, often no purchase price → excluded from gain), Trading 212 (API; summary row `T212_CASH` is authoritative, positions are not summed). Math in `inv-core.js`: XIRR, % p.a. only after 365 days, any-currency FX (`fxOf`, column historically named `kurzEUR`). Benchmark is S&P 500 total return in CZK.

## Apps Script (GAS)

- Deploy with `npm run gas:deploy` — pushes only `gas-update.js` + `appsscript.json` (`.claspignore`) and updates the existing deployment, so `GAS_URL` doesn't change. Requires `clasp` logged in and a local, gitignored `.clasp.json` (scriptId). Smoke test after deploy: POST `{"action":"read","sheets":["Transakce"]}` without a token must return `{"error":"Nepřihlášený…","auth":true}`.
- Deploy GAS **before** pushing client code that depends on new GAS behaviour.
- Time-driven triggers are set in the Apps Script UI and reference function names — don't rename `refreshNav`, `checkPayslipEmail`, `checkMbankEmail`:
  - `refreshNav` nightly: fund NAVs, S&P, Trading 212. On Mondays (`triggerPlan`) also: mail check for UniCredit statements, sheet backup (`Finance-Backup`), CPI sync, `healthCheck`, `dedupeIds`; failure e-mails only on Mondays.
  - `checkPayslipEmail` daily, `checkMbankEmail` monthly: Gmail → Drive → queue sheets (`MzdyImport`, `MbankImport`) → banner in the app; the user confirms the import there.
  - UniCredit statements (`UcpImport` queue) are imported automatically on app open if they pass `planAutoImport`; the encrypted ZIP is decrypted in GAS. Secrets live in Script Properties (`UCP_ZIP_PASSWORD`, `T212_API_KEY`, `T212_API_SECRET`, `AUTH_ENFORCE`), never in the repo.

## Working notes

- The live data is the Google Sheet „Rodinné finance“. Before bulk edits to it, re-read the range right before writing and verify afterwards.
- On Windows, multi-line Python heredocs in Bash have mangled `\b` in regexes before — prefer the Edit tool or a script file for code edits containing backslashes.

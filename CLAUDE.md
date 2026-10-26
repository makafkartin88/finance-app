# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture overview

This is a **single-page vanilla JS finance app** with no build step. It runs entirely in the browser and persists all data to **Google Sheets via a Google Apps Script (GAS) Web App**.

- `index.html` — the entire UI; all HTML for modals, pages, and the nav bar lives here. Inline `onclick` handlers call functions exposed on `window` from `js/app.js`.
- `js/` — ES modules, each owning one domain. `app.js` is the entry point and glues everything together; it exposes all public functions on `window` for the HTML's inline handlers.
- `gas-update.js` — the Google Apps Script code deployed at `GAS_URL`. This runs server-side on Google's infrastructure, not locally.
- `css/styles.css` — all styles in one file.

## How to run

Open `index.html` directly in a browser (no server needed — ES modules work via `file://` on modern browsers, or serve with any static server). There is no build, no npm dependencies, no bundler.

Unit tests for pure logic: `npm test` (= `node --test "tests/*.test.js"`, Node 24, no dependencies). `package.json` exists only for `"type": "module"` and this script.

## Data layer

All persistence goes through `GAS_URL` in `js/config.js`, always via `postJson()` / `fetchSheet()` / `fetchSheets()` in `utils.js` (never raw `fetch`):
- `postJson(payload)` attaches the Firebase ID token (`idToken`), throws on `{error}`, retries only idempotent calls.
- Reads go through POST action `read` (`readSheets`); plain `GET ?sheet=` is only a fallback for an old GAS deployment and is blocked once `AUTH_ENFORCE=1`.
- Writes: `updateRow` (edit in place by id — never delete+append), `appendRecurring` (server sets `posledniGen`), `deleteRow`, `upsertFund`, `saveSettings`, …; GAS serialises writes with `withLock`.
- New ids: `newId()` in `tx-core.js` (random suffix), never `length + 1`.

Sheet names used: `Transakce`, `Recurring`, `MbankImport`, `Fondy`, `Trh`, `FondyHist`, `TrhHist`, `Mzdy`, `MzdyImport`, `UcpImport`, `Nastaveni` (incl. shared budget `limity`), `Dokumenty`, `Inflace` (CPI index from ČSÚ).

Column indices for `Transakce` rows are defined in `config.js` as `C` — always use these constants, never raw indices. The `parseRow()` function in `utils.js` maps a raw sheet row to a transaction object.

## State

`js/state.js` exports a single `state` object. All modules import it directly. Key fields:
- `state.txs` — all loaded transactions (parsed row objects)
- `state.person` — `'Martin'`, `'Šárka'`, or `'Oba'` (the person filter)
- `state._range` — `{ from, to }` ISO date strings for the global date range
- `state.recurring` — recurring template objects
- `state._mbankRows` / `state._mbankImportFile` — transient mbank import state

## Module responsibilities

| File | Responsibility |
|---|---|
| `app.js` | Bootstrap, `loadSheets()`, `boot()`, nav, person/range controls, `window.*` exports |
| `dashboard.js` | Summary cards, cash flow chart, category bars, recent transactions table |
| `transactions.js` | Full transactions page, add/edit/delete modal, receipt upload |
| `mbank-import.js` | PDF parsing (via pdf.js), duplicate detection, import preview table, GAS notification banner |
| `recurring.js` | Recurring templates CRUD, monthly generation |
| `charts.js` | Charts page rendering |
| `budgets.js` | Rozpočty (karta v Nastavení) a limity |
| `documents.js` | Stránka Dokumenty: seznam, hledání, složky, nahrání/úprava/smazání (GAS `uploadDocument`/`updateDocument`/`deleteDocument`) |
| `documents-core.js` | Čistá logika dokumentů bez DOM/sítě, pokrytá `npm test` |
| `investments.js` | Investment positions and account balances |
| `inv-core.js` | Čistá matematika investic: `xirr`, `providerTotals` (fondy bez nákupní ceny zvlášť), `annualPct` (jen ≥ 365 dní), `navAge`, `fxOf`, `mergeTopUp` |
| `tx-core.js` | `newId`, `recRow`, `normMonth`, `summarize` (úspora = příjem − spotřeba), `completedMonths` |
| `mbank-core.js` | Kategorie, převody na spořicí účet, párování duplicit 1:1 |
| `salary-core.js` | Úrovně mzdy (potvrzení 2 páskami nahoru / 3 dolů), roční souhrny |
| `inflation-data.js` | Statická tabulka CPI (2025=100) + `cumulativeInflation`; list `Inflace` ji doplňuje |
| `html.js` | `escHtml`, `jsArg`, `safeUrl` — vše z dat do `innerHTML`/`onclick` musí jít přes ně |
| `inv-import.js` | Import investičních výpisů: ruční (náhled) i automatický z fronty `UcpImport` při otevření appky |
| `inv-parse.js` | Čisté parsery výpisů CODYA/CONSEQ/UniCredit, `detectStatement`, pojistky `planAutoImport`, `buildFundRow` (pokryto `npm test`) |
| `settings.js` | Settings page |
| `busy.js` | Odezva na zápis: proužek + „Ukládám…“, zablokuje kliknuté tlačítko a zašedí formulář, varování při zavření stránky. Navázané na `onActivity` z `postJson` — nové zápisy to mají automaticky |
| `table-filters.js` | Column filter popovers and amount sorting shared between dashboard and transactions |
| `utils.js` | `parseRow`, date helpers (`fmtD`, `isoDate`, `parseTxDate`), `czk`, `scopedTxs`, `base`, `getBounds` |

## Key patterns

**Rendering:** Each module exports a `render*()` function. `boot()` in `app.js` calls all of them. After any data mutation, call `boot()` or the relevant `render*()` directly.

**Filtering/scoping:** `scopedTxs(opts)` in `utils.js` applies the person filter, date range, and optional month/category. `base(month, cat)` is a thin wrapper used by dashboard and charts.

**Duplicate detection (mbank import):** `findDuplicate()` in `mbank-import.js` checks `state.txs` for an existing transaction with the same type, amount within ±10%, and date within ±2 days. Duplicates are auto-unchecked in the preview table and show a `!` button to reveal the matching transaction.

**Auth:** Firebase Auth via `js/auth.js`, fail-closed. `AUTH_USERS` in `config.js` is keyed by SHA-256 of the e-mail (repo is public — no plain e-mails). The `canSeeInvestments` flag hides investment/salary data for Šárka. GAS verifies the ID token itself (`verifyCaller`, roles in `AUTH_USERS_GAS`) — enforced only when Script Property `AUTH_ENFORCE=1`.

**Security:** CSP meta in `index.html`; no personal data (names of accounts, e-mails, amounts) in the repo or test fixtures.

**Tests:** pure logic lives in `*-core.js` / `inv-parse.js` and is covered by `npm test`; GAS code is tested by loading `gas-update.js` into a `vm` context with fake Apps Script services (`tests/gas-write.test.js`).

**Recurring generation:** `generateRecurring()` checks `rec.posledniGen` against the current `YYYY-MM` string to avoid double-generation in the same month.

## Google Apps Script deployment

When `gas-update.js` is changed, the new code must be manually copied into the GAS project at `script.google.com` and redeployed (Manage deployments → edit → New version keeps the same URL; a new deployment needs `GAS_URL` updated). Client changes that depend on new GAS actions stay on a branch until the redeploy is done; GitHub Pages serves `main`.

The `checkMbankEmail()` function in GAS scans Gmail for mBank PDF attachments, saves them to Google Drive (`Finance-Vypisy` folder), and appends a row with `status='new'` to the `MbankImport` sheet. The app polls this sheet on load to show the import banner.

### Investiční výpisy — automatika

- Týdenní časovač `refreshNav` navíc: `syncInflation` (CPI z DataStatu do listu `Inflace`), `weeklyBackup` (kopie tabulky do `Finance-Backup`, drží 12), `healthCheck` (staré importy/kurzy → e-mail). S&P pro srovnání = `^SP500TR` (s dividendami) od nejstaršího nákupu.
- Pondělní časovač `refreshNav` (Triggers → time-driven, týdně) stahuje kurzy CODYA/CONSEQ z webů (`NAV_SOURCES`, nový fond CONSEQ se dohledá sám podle ISIN — `navSourceFor`) a navíc projde poštu (`checkInvestEmail` → výpisy UniCredit; u CODYA/CONSEQ se složení nemění, stačí kurzy). Spustí se to jen z časovače (`e.triggerUid`), ne z tlačítka.
- ZIP z UniCreditu je šifrovaný ZipCrypto; GAS ho rozšifruje (`zipDecryptToPlain`) heslem ze Script Properties `UCP_ZIP_PASSWORD`. Klíč k T212 je tamtéž (`T212_API_KEY`, `T212_API_SECRET`).
- Zachycené výpisy čekají v listu `UcpImport` (status `new`). Appka je při otevření sama naimportuje, pokud projdou pojistkami v `planAutoImport`; jinak zůstanou v banneru s důvodem.


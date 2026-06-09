# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture overview

This is a **single-page vanilla JS finance app** with no build step. It runs entirely in the browser and persists all data to **Google Sheets via a Google Apps Script (GAS) Web App**.

- `index.html` — the entire UI; all HTML for modals, pages, and the nav bar lives here. Inline `onclick` handlers call functions exposed on `window` from `js/app.js`.
- `js/` — ES modules, each owning one domain. `app.js` is the entry point and glues everything together; it exposes all public functions on `window` for the HTML's inline handlers.
- `gas-update.js` — the Google Apps Script code deployed at `GAS_URL`. This runs server-side on Google's infrastructure, not locally.
- `css/styles.css` — all styles in one file.

## How to run

Open `index.html` directly in a browser (no server needed — ES modules work via `file://` on modern browsers, or serve with any static server). There is no build, no npm, no bundler.

## Data layer

All persistence goes through `GAS_URL` in `js/config.js`:
- `GET ?sheet=SheetName` — fetch rows from a named Google Sheet.
- `POST` with JSON body — append rows or perform named actions (`deleteRow`, `uploadReceipt`, `removeReceipt`, `markMbankImported`).

Sheet names used: `Transakce`, `Recurring`, `MbankImport`, `Investice`, `Ucty`.

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
| `budgets.js` | Budget limits and progress bars |
| `investments.js` | Investment positions and account balances |
| `settings.js` | Settings page |
| `table-filters.js` | Column filter popovers and amount sorting shared between dashboard and transactions |
| `utils.js` | `parseRow`, date helpers (`fmtD`, `isoDate`, `parseTxDate`), `czk`, `scopedTxs`, `base`, `getBounds` |

## Key patterns

**Rendering:** Each module exports a `render*()` function. `boot()` in `app.js` calls all of them. After any data mutation, call `boot()` or the relevant `render*()` directly.

**Filtering/scoping:** `scopedTxs(opts)` in `utils.js` applies the person filter, date range, and optional month/category. `base(month, cat)` is a thin wrapper used by dashboard and charts.

**Duplicate detection (mbank import):** `findDuplicate()` in `mbank-import.js` checks `state.txs` for an existing transaction with the same type, amount within ±10%, and date within ±2 days. Duplicates are auto-unchecked in the preview table and show a `!` button to reveal the matching transaction.

**Auth:** Firebase Auth via `js/auth.js`. Whitelisted emails in `config.js` (`AUTH_USERS`). The `canSeeInvestments` flag hides investment data for Šárka.

**Recurring generation:** `generateRecurring()` checks `rec.posledniGen` against the current `YYYY-MM` string to avoid double-generation in the same month.

## Google Apps Script deployment

When `gas-update.js` is changed, the new code must be manually copied into the GAS project at `script.google.com` and redeployed as a new Web App version. The `GAS_URL` in `config.js` must then be updated to the new deployment URL.

The `checkMbankEmail()` function in GAS scans Gmail for mBank PDF attachments, saves them to Google Drive (`Finance-Vypisy` folder), and appends a row with `status='new'` to the `MbankImport` sheet. The app polls this sheet on load to show the import banner.

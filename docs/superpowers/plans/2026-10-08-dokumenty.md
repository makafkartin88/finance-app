# Dokumenty + přesun Rozpočtů do Nastavení — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat sekci Dokumenty (PDF/obrázky na Google Drive, jednoúrovňové složky, viditelnost Oba/Martin/Šárka, vyhledávání) a přesunout Rozpočty z menu do Nastavení.

**Architecture:** Vanilla ES moduly bez buildu, persistence přes Google Apps Script (`gas-update.js`) do Google Sheets + Drive. Čistá logika (parsování řádku, filtrování, viditelnost, validace, kanonizace složky, escapování) žije v `js/documents-core.js` a je pokrytá testy přes vestavěný `node --test`. UI a volání GAS jsou v `js/documents.js`. Viditelnost je vynucená jen v UI (vědomé rozhodnutí ze specu).

**Tech Stack:** Vanilla JS (ES modules), Google Apps Script (V8), Google Sheets, Google Drive, Node 24 `node:test` pro unit testy čisté logiky.

**Spec:** `docs/superpowers/specs/2026-10-08-dokumenty-design.md`

## Global Constraints

- Žádný build, žádný bundler, žádné npm závislosti. `package.json` slouží jen k `"type": "module"` a skriptu `test`.
- List `Dokumenty`, hlavička přesně: `id | nazev | slozka | viditelnost | url | fileId | typ | velikost | nahral | datum`.
- `viditelnost` ∈ `Oba` / `Martin` / `Šárka`; prázdná nebo neznámá hodnota se chová jako `Oba`.
- Drive: `Finance-Dokumenty/<slozka>/<soubor>`, dokument bez složky přímo v `Finance-Dokumenty/`.
- Sdílení souborů: `DriveApp.Access.ANYONE_WITH_LINK`, `DriveApp.Permission.VIEW` (jako účtenky).
- Mazání = `file.setTrashed(true)`, nikdy trvalé smazání.
- Limit velikosti souboru: 20 MB (`20 * 1024 * 1024` B). Povolené typy: `application/pdf` a `image/*`.
- Složky jen jedna úroveň.
- Každá změna `gas-update.js` vyžaduje ruční redeploy (Deploy → Manage deployments → New version). GAS_URL se nemění.
- Veškerý uživatelský text (název, složka) se do `innerHTML` vkládá jen přes `escHtml`.
- Commit zprávy končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Víceřádkové zprávy přes `git commit -F -` s heredocem.

## Review Focus

1. **Složka se stejným jménem v jiné velikosti písmen / s mezerami / bez diakritiky** („pes", „Pes ", „PES") → má skončit v JEDNÉ složce se stávajícím zápisem, ne vytvořit duplicitní štítek. Test: `canonicalFolder` v Task 1.
2. **Název souboru s diakritikou, mezerami a HTML znaky** („Smlouva – pes <Ája> & co.pdf") → zobrazí se doslova, nic se nevykoná jako HTML. Test: `escHtml` + `stripExt` v Task 1.
3. **Řádek bez viditelnosti / s neznámou hodnotou, nebo appka spuštěná bez přihlášení (lokální vývoj)** → dokument se chová jako `Oba`; bez přihlášení je vidět vše. Test: `parseDocRow` + `visibleDocs` v Task 1.
4. **Soubor > 20 MB nebo nepodporovaný typ (.docx, prázdný MIME)** → srozumitelná hláška ještě před odesláním, nic se nenahraje. Test: `validateUpload` v Task 1.
5. **Hledání s diakritikou/velkými písmeny/částí slova kombinované s vybranou složkou** → AND obou podmínek, prázdný dotaz = vše v dané složce. Test: `filterDocs` v Task 1.

---

## File Structure

| Soubor | Akce | Odpovědnost |
|---|---|---|
| `package.json` | Create | `"type": "module"` + `npm test` / `node --test` |
| `tests/documents-core.test.js` | Create | Unit testy čisté logiky |
| `js/documents-core.js` | Create | Čistá logika dokumentů (bez DOM, bez sítě) |
| `js/documents.js` | Create | Render stránky, modaly, volání GAS |
| `js/auth.js` | Modify | `getCurrentPerson()` |
| `js/state.js` | Modify | `docs`, `_docsLoaded` |
| `js/app.js` | Modify | dávkové načtení `Dokumenty`, nav, `validPages`, window bindingy |
| `index.html` | Modify | nav položka, stránka `#p-documents`, modal `#docModal`, přesun Rozpočtů do Nastavení |
| `css/styles.css` | Modify | styly seznamu dokumentů a štítků složek |
| `gas-update.js` | Modify | `uploadDocument`, `updateDocument`, `deleteDocument` |
| `CLAUDE.md` | Modify | seznam listů a modulů |

---

### Task 1: Čistá logika dokumentů + testovací harness

**Files:**
- Create: `package.json`
- Create: `js/documents-core.js`
- Test: `tests/documents-core.test.js`

**Interfaces:**
- Consumes: nic
- Produces (vše exportované z `js/documents-core.js`):
  - `DOK = { id:0, nazev:1, slozka:2, viditelnost:3, url:4, fileId:5, typ:6, velikost:7, nahral:8, datum:9 }`
  - `DOC_MAX_BYTES = 20971520`
  - `VISIBILITY = ['Oba', 'Martin', 'Šárka']`
  - `normText(s: any): string` — lowercase, bez diakritiky, trim, zhuštěné mezery
  - `escHtml(s: any): string`
  - `stripExt(name: string): string`
  - `docType(mime: string): 'pdf' | 'image'`
  - `parseDocRow(r: any[]): Doc | null` kde `Doc = {id, nazev, slozka, viditelnost, url, fileId, typ, velikost:number, nahral, datum}`
  - `visibleDocs(docs: Doc[], person: string|null): Doc[]`
  - `filterDocs(docs: Doc[], query: string, folder: string|null): Doc[]` — `folder === null` = všechny složky, `''` = bez složky
  - `folderCounts(docs: Doc[]): {name: string, count: number}[]` — seřazeno `localeCompare(..., 'cs')`, `''` (bez složky) vždy poslední
  - `canonicalFolder(input: string, existing: string[]): string`
  - `validateUpload(file: {name, size, type}): string | null` — `null` = OK, jinak česká chybová hláška

- [ ] **Step 1: Vytvořit `package.json`**

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

Poznámka: `"type": "module"` je nutné, aby Node načetl `js/*.js` jako ES moduly. Prohlížeč to neovlivní. `node --check gas-update.js` dál projde (GAS kód nepoužívá `require`).

- [ ] **Step 2: Napsat padající testy**

`tests/documents-core.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOK, DOC_MAX_BYTES, VISIBILITY, normText, escHtml, stripExt, docType,
  parseDocRow, visibleDocs, filterDocs, folderCounts, canonicalFolder, validateUpload
} from '../js/documents-core.js';

const row = (o) => {
  const r = new Array(10).fill('');
  for (const [k, v] of Object.entries(o)) r[DOK[k]] = v;
  return r;
};
const doc = (o) => parseDocRow(row({ id: 'd1', nazev: 'X', ...o }));

test('normText: lowercase, bez diakritiky, trim, zhuštěné mezery', () => {
  assert.equal(normText('  Smlouva  na   PSA Ája '), 'smlouva na psa aja');
  assert.equal(normText(null), '');
  assert.equal(normText(123), '123');
});

test('escHtml escapuje HTML znaky', () => {
  assert.equal(escHtml('<Ája> & "co" \'x\''), '&lt;Ája&gt; &amp; &quot;co&quot; &#39;x&#39;');
  assert.equal(escHtml(undefined), '');
});

test('stripExt odstraní jen poslední příponu', () => {
  assert.equal(stripExt('Smlouva – pes.pdf'), 'Smlouva – pes');
  assert.equal(stripExt('foto.2026.JPG'), 'foto.2026');
  assert.equal(stripExt('bezpripony'), 'bezpripony');
  assert.equal(stripExt('.skryty'), '.skryty');
});

test('docType rozliší PDF a obrázek', () => {
  assert.equal(docType('application/pdf'), 'pdf');
  assert.equal(docType('image/jpeg'), 'image');
  assert.equal(docType(''), 'image');
});

test('parseDocRow: hlavička a řádek bez id → null', () => {
  assert.equal(parseDocRow(['id', 'nazev', 'slozka']), null);
  assert.equal(parseDocRow(row({ nazev: 'bez id' })), null);
  assert.equal(parseDocRow(null), null);
});

test('parseDocRow: neznámá/prázdná viditelnost = Oba, velikost číslo', () => {
  const d = parseDocRow(row({ id: 'd1', nazev: 'A', slozka: ' Pes ', viditelnost: '', velikost: '1024' }));
  assert.equal(d.viditelnost, 'Oba');
  assert.equal(d.slozka, 'Pes');
  assert.equal(d.velikost, 1024);
  assert.equal(parseDocRow(row({ id: 'd2', viditelnost: 'Nikdo' })).viditelnost, 'Oba');
  assert.equal(parseDocRow(row({ id: 'd3', viditelnost: 'Šárka' })).viditelnost, 'Šárka');
});

test('parseDocRow: UTC timestamp ze Sheets → lokální datum, text beze změny', () => {
  const iso = new Date(2026, 9, 8).toISOString(); // lokální půlnoc 8. 10. v UTC zápisu
  assert.equal(parseDocRow(row({ id: 'x', datum: iso })).datum, '2026-10-08');
  assert.equal(parseDocRow(row({ id: 'y', datum: '2026-10-08' })).datum, '2026-10-08');
});

test('visibleDocs: Oba vidí všichni, osobní jen vlastník, bez přihlášení vše', () => {
  const docs = [doc({ id: 'a', viditelnost: 'Oba' }), doc({ id: 'm', viditelnost: 'Martin' }), doc({ id: 's', viditelnost: 'Šárka' })];
  assert.deepEqual(visibleDocs(docs, 'Martin').map(d => d.id), ['a', 'm']);
  assert.deepEqual(visibleDocs(docs, 'Šárka').map(d => d.id), ['a', 's']);
  assert.deepEqual(visibleDocs(docs, null).map(d => d.id), ['a', 'm', 's']);
});

test('filterDocs: dotaz bez diakritiky a velikosti písmen, i ve složce, AND se složkou', () => {
  const docs = [
    doc({ id: '1', nazev: 'Smlouva – očkování', slozka: 'Pes' }),
    doc({ id: '2', nazev: 'Technický průkaz', slozka: 'Auto' }),
    doc({ id: '3', nazev: 'Smlouva nájem', slozka: '' }),
  ];
  assert.deepEqual(filterDocs(docs, 'SMLOUVA', null).map(d => d.id), ['1', '3']);
  assert.deepEqual(filterDocs(docs, 'ockov', null).map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, 'pes', null).map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, 'smlouva', 'Pes').map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, '', 'Auto').map(d => d.id), ['2']);
  assert.deepEqual(filterDocs(docs, '', '').map(d => d.id), ['3']);
  assert.deepEqual(filterDocs(docs, '   ', null).map(d => d.id), ['1', '2', '3']);
});

test('folderCounts: počty, české řazení, bez složky poslední', () => {
  const docs = [doc({ id: '1', slozka: 'Pes' }), doc({ id: '2', slozka: 'Auto' }), doc({ id: '3', slozka: 'Pes' }), doc({ id: '4', slozka: '' }), doc({ id: '5', slozka: 'Čerpadlo' })];
  assert.deepEqual(folderCounts(docs), [
    { name: 'Auto', count: 1 }, { name: 'Čerpadlo', count: 1 }, { name: 'Pes', count: 2 }, { name: '', count: 1 }
  ]);
});

test('canonicalFolder: znovupoužije existující zápis, jinak ořízne', () => {
  const existing = ['Pes', 'Ája', 'Auto'];
  assert.equal(canonicalFolder('pes', existing), 'Pes');
  assert.equal(canonicalFolder('  PES  ', existing), 'Pes');
  assert.equal(canonicalFolder('aja', existing), 'Ája');
  assert.equal(canonicalFolder('  Nová   složka ', existing), 'Nová složka');
  assert.equal(canonicalFolder('   ', existing), '');
});

test('validateUpload: velikost, typ, prázdný soubor', () => {
  assert.equal(validateUpload({ name: 'a.pdf', size: 1000, type: 'application/pdf' }), null);
  assert.equal(validateUpload({ name: 'a.jpg', size: 1000, type: 'image/jpeg' }), null);
  assert.match(validateUpload({ name: 'a.pdf', size: DOC_MAX_BYTES + 1, type: 'application/pdf' }), /20 MB/);
  assert.match(validateUpload({ name: 'a.docx', size: 1000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), /PDF nebo obrázek/);
  assert.match(validateUpload({ name: 'a', size: 1000, type: '' }), /PDF nebo obrázek/);
  assert.match(validateUpload({ name: 'a.pdf', size: 0, type: 'application/pdf' }), /prázdný/);
});

test('VISIBILITY konstanta', () => {
  assert.deepEqual(VISIBILITY, ['Oba', 'Martin', 'Šárka']);
});
```

- [ ] **Step 3: Spustit testy — musí selhat**

Run: `node --test tests/`
Expected: FAIL — `Cannot find module '.../js/documents-core.js'`.

- [ ] **Step 4: Implementovat `js/documents-core.js`**

```js
// Čistá logika sekce Dokumenty — bez DOM a bez sítě, ať jde testovat
// přes `node --test`. UI a volání GAS jsou v documents.js.

export const DOK = { id: 0, nazev: 1, slozka: 2, viditelnost: 3, url: 4, fileId: 5, typ: 6, velikost: 7, nahral: 8, datum: 9 };
export const DOC_MAX_BYTES = 20 * 1024 * 1024;
export const VISIBILITY = ['Oba', 'Martin', 'Šárka'];

export function normText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function docType(mime) {
  return mime === 'application/pdf' ? 'pdf' : 'image';
}

export function parseDocRow(r) {
  if (!Array.isArray(r) || !r[DOK.id] || r[DOK.id] === 'id') return null;
  const vis = String(r[DOK.viditelnost] || '');
  return {
    id: String(r[DOK.id]),
    nazev: String(r[DOK.nazev] || ''),
    slozka: String(r[DOK.slozka] || '').trim(),
    viditelnost: VISIBILITY.includes(vis) ? vis : 'Oba',
    url: String(r[DOK.url] || ''),
    fileId: String(r[DOK.fileId] || ''),
    typ: String(r[DOK.typ] || 'pdf'),
    velikost: Number(r[DOK.velikost]) || 0,
    nahral: String(r[DOK.nahral] || ''),
    datum: normDate(r[DOK.datum]),
  };
}

// Sheets občas vrátí datum jako ISO timestamp v UTC (pokud si buňku převedl
// na Date) → převést na LOKÁLNÍ yyyy-mm-dd, jinak by se den posunul.
function normDate(v) {
  const s = String(v || '');
  if (!s.includes('T')) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('sv-SE');
}

// person === null → appka běží bez přihlášení (lokální vývoj) → vše.
export function visibleDocs(docs, person) {
  if (!person) return docs.slice();
  return docs.filter(d => d.viditelnost === 'Oba' || d.viditelnost === person);
}

export function filterDocs(docs, query, folder) {
  const q = normText(query);
  return docs.filter(d =>
    (folder === null || d.slozka === folder) &&
    (!q || normText(d.nazev).includes(q) || normText(d.slozka).includes(q)));
}

export function folderCounts(docs) {
  const m = new Map();
  for (const d of docs) m.set(d.slozka, (m.get(d.slozka) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === '') - (b.name === '') || a.name.localeCompare(b.name, 'cs'));
}

// „pes" / „Pes " / „PES" → stávající „Pes", ať nevznikají duplicitní složky.
export function canonicalFolder(input, existing) {
  const clean = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const hit = existing.find(f => normText(f) === normText(clean));
  return hit ?? clean;
}

export function validateUpload(file) {
  if (!file.size) return 'Soubor je prázdný.';
  if (!(file.type === 'application/pdf' || String(file.type).startsWith('image/')))
    return 'Nahrát jde jen PDF nebo obrázek.';
  if (file.size > DOC_MAX_BYTES) return 'Soubor je větší než 20 MB — zmenši ho nebo rozděl.';
  return null;
}
```

- [ ] **Step 5: Spustit testy — musí projít**

Run: `node --test tests/`
Expected: PASS, 13 testů, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add package.json js/documents-core.js tests/documents-core.test.js
git commit -F - <<'EOF'
feat(dokumenty): cista logika + unit testy (node --test)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: GAS akce pro dokumenty

**Files:**
- Modify: `gas-update.js` — dispatch v `doPost` (za blok `saveSettings`), nové funkce za `handleSaveSettings`

**Interfaces:**
- Consumes: nic z frontendu (GAS je samostatný runtime)
- Produces (POST JSON akce, odpověď vždy JSON):
  - `{action:'uploadDocument', nazev, slozka, viditelnost, nahral, fileName, mimeType, data}` → `{success:true, doc:{id,nazev,slozka,viditelnost,url,fileId,typ,velikost,nahral,datum}}` | `{error}`
  - `{action:'updateDocument', id, nazev?, slozka?, viditelnost?}` → `{success:true, doc}` | `{error}`
  - `{action:'deleteDocument', id}` → `{success:true}` | `{error}`

- [ ] **Step 1: Přidat dispatch do `doPost`**

Za blok:
```js
    if (body.action === 'saveSettings') {
      return handleSaveSettings(body);
    }
```
vložit:
```js

    // ── DOKUMENTY (Drive + list Dokumenty) ──
    if (body.action === 'uploadDocument') return handleUploadDocument(body);
    if (body.action === 'updateDocument') return handleUpdateDocument(body);
    if (body.action === 'deleteDocument') return handleDeleteDocument(body);
```

- [ ] **Step 2: Přidat handlery za funkci `handleSaveSettings`**

```js
// ── DOKUMENTY ──
// Soubory: Finance-Dokumenty/<slozka>/<soubor>, sdílení „kdo má odkaz"
// (stejně jako účtenky). Viditelnost Oba/Martin/Šárka vynucuje jen appka —
// endpoint nemá autentizaci (vědomé rozhodnutí, viz spec 2026-10-08).
var DOK_HEADER = ['id', 'nazev', 'slozka', 'viditelnost', 'url', 'fileId', 'typ', 'velikost', 'nahral', 'datum'];
var DOK_VIS = ['Oba', 'Martin', 'Šárka'];

function dokSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Dokumenty');
  if (!sheet) {
    sheet = ss.insertSheet('Dokumenty');
    sheet.appendRow(DOK_HEADER);
    // Sloupec datum jako čistý text — jinak ho Sheets převede na Date a ten
    // se do JSON serializuje v UTC (o půlnoci CET = předchozí den).
    sheet.getRange('J:J').setNumberFormat('@');
  }
  return sheet;
}

function dokFolder(slozka) {
  var it = DriveApp.getFoldersByName('Finance-Dokumenty');
  var root = it.hasNext() ? it.next() : DriveApp.createFolder('Finance-Dokumenty');
  if (!slozka) return root;
  var sub = root.getFoldersByName(slozka);
  return sub.hasNext() ? sub.next() : root.createFolder(slozka);
}

function dokRowToObj(r) {
  var o = {};
  for (var i = 0; i < DOK_HEADER.length; i++) o[DOK_HEADER[i]] = r[i];
  return o;
}

function dokFindRow(sheet, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(id)) return { idx: i + 1, row: data[i] };
  return null;
}

function handleUploadDocument(body) {
  try {
    if (!body.data) return jsonOut({ error: 'Chybí data souboru.' });
    var slozka = String(body.slozka || '').trim();
    var vis = DOK_VIS.indexOf(body.viditelnost) >= 0 ? body.viditelnost : 'Oba';
    var mime = body.mimeType || 'application/octet-stream';
    var blob = Utilities.newBlob(Utilities.base64Decode(body.data), mime, body.fileName || 'dokument');
    var file = dokFolder(slozka).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var id = 'doc_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var row = [id, String(body.nazev || body.fileName || 'Dokument').trim(), slozka, vis,
      file.getUrl(), file.getId(), mime === 'application/pdf' ? 'pdf' : 'image',
      blob.getBytes().length, String(body.nahral || ''),
      Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd')];
    dokSheet().appendRow(row);
    return jsonOut({ success: true, doc: dokRowToObj(row) });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function handleUpdateDocument(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonOut({ error: 'Dokumenty se právě upravují jinde, zkus to za chvíli.' });
  try {
    var sheet = dokSheet();
    var hit = dokFindRow(sheet, body.id);
    if (!hit) return jsonOut({ error: 'Dokument nenalezen (možná už byl smazán).' });
    var row = hit.row;
    if (body.nazev != null && String(body.nazev).trim()) row[1] = String(body.nazev).trim();
    if (body.viditelnost != null && DOK_VIS.indexOf(body.viditelnost) >= 0) row[3] = body.viditelnost;
    if (body.slozka != null) {
      var nova = String(body.slozka).trim();
      if (nova !== String(row[2])) {
        DriveApp.getFileById(row[5]).moveTo(dokFolder(nova));
        row[2] = nova;
      }
    }
    sheet.getRange(hit.idx, 1, 1, DOK_HEADER.length).setValues([row.slice(0, DOK_HEADER.length)]);
    return jsonOut({ success: true, doc: dokRowToObj(row) });
  } catch (err) {
    return jsonOut({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteDocument(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonOut({ error: 'Dokumenty se právě upravují jinde, zkus to za chvíli.' });
  try {
    var sheet = dokSheet();
    var hit = dokFindRow(sheet, body.id);
    if (!hit) return jsonOut({ error: 'Dokument nenalezen (možná už byl smazán).' });
    // Koš, ne trvalé smazání — 30 dní jde obnovit přímo na Drive.
    try { DriveApp.getFileById(hit.row[5]).setTrashed(true); } catch (e) { /* soubor už neexistuje */ }
    sheet.deleteRow(hit.idx);
    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check gas-update.js`
Expected: bez výstupu, exit 0.

- [ ] **Step 4: Ověřit, že stávající dispatch zůstal netknutý**

Run: `grep -n "body.action ===" gas-update.js`
Expected: všechny předchozí akce (`uploadReceipt` … `saveSettings`) + 3 nové `uploadDocument`, `updateDocument`, `deleteDocument`.

- [ ] **Step 5: Commit**

```bash
git add gas-update.js
git commit -F - <<'EOF'
feat(gas): akce uploadDocument / updateDocument / deleteDocument

List Dokumenty + Drive Finance-Dokumenty/<slozka>. Mazani jde do kose
Drive (30 dni obnovitelne). Vyzaduje redeploy GAS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Ruční ověření po redeployi (uživatel nebo agent s přístupem k síti), v Task 6.

---

### Task 3: Rozpočty z menu do Nastavení

**Files:**
- Modify: `index.html:164` (nav položka Rozpočty), `index.html:257-268` (`#p-budgets`), `#p-settings` (vložit kartu nad „Měsíční limity")
- Modify: `js/app.js:182` (`validPages`)

**Interfaces:**
- Consumes: `renderBudgets()`, `renderBudLimForm()`, `saveLimits()` z `js/budgets.js` beze změny (cílí na id `bMonth`, `b1`–`b4`, `budRows`, `budLimForm`, která zůstanou zachovaná)
- Produces: nic nového

- [ ] **Step 1: Odstranit nav položku Rozpočty**

V `index.html` smazat celý řádek:
```html
      <div class="ni" data-page="budgets" onclick="nav('budgets',this)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2" stroke-linecap="round"/></svg><span>Rozpočty</span></div>
```

- [ ] **Step 2: Odstranit stránku `#p-budgets`**

Smazat celý blok od `<div id="p-budgets" class="page">` po jeho uzavírací `</div>` (včetně `bMonth`, `b1`–`b4`, `budRows` — přesunou se v dalším kroku).

- [ ] **Step 3: Vložit kartu Rozpočty do Nastavení**

V `#p-settings` přímo PŘED kartu `<div class="ct">Měsíční limity (Kč)</div>` (tj. před `<div class="card" style="margin-top:16px">`, která ji obsahuje) vložit:

```html
        <div class="card" style="margin-top:16px">
          <div class="card-hdr"><div class="ct">Rozpočty</div><select class="sel" id="bMonth" onchange="renderBudgets()"></select></div>
          <div class="mgrid">
            <div class="mc"><div class="ml">V pořádku</div><div class="mv green" id="b1">—</div></div>
            <div class="mc"><div class="ml">Překročeno</div><div class="mv red" id="b2">—</div></div>
            <div class="mc"><div class="ml">Celkový limit</div><div class="mv" id="b3">—</div></div>
            <div class="mc"><div class="ml">Utraceno</div><div class="mv" id="b4">—</div></div>
          </div>
          <div id="budRows"></div>
        </div>
```

- [ ] **Step 4: `validPages` bez `budgets`**

V `js/app.js` nahradit:
```js
  const validPages = ['dashboard','transactions','budgets','charts','investments','salary','settings'];
```
za:
```js
  const validPages = ['dashboard','transactions','documents','charts','investments','salary','settings'];
```
(`documents` stránka vznikne v Task 4; do té doby by `#documents` spadlo na chybějící element — Task 3 a 4 se proto commitují v pořadí a nedeployují zvlášť. `#budgets` v URL teď padá na Přehled.)

- [ ] **Step 5: Ověřit, že nezůstal odkaz na `p-budgets` ani nav index**

Run: `grep -n "p-budgets\|nav('budgets'\|querySelectorAll('.ni')\[" index.html js/*.js`
Expected: žádný výsledek.

Run: `grep -c 'id="bMonth"\|id="budRows"\|id="b1"\|id="budLimForm"' index.html`
Expected: `4` (každé id právě jednou).

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js
git commit -F - <<'EOF'
refactor(rozpocty): presunout z menu do Nastaveni

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Stránka Dokumenty — načtení, seznam, hledání, složky

**Files:**
- Create: `js/documents.js`
- Modify: `js/auth.js` (přidat `getCurrentPerson`)
- Modify: `js/state.js` (`docs`, `_docsLoaded`)
- Modify: `js/app.js` (import, dávka `Dokumenty`, `nav`, window bindingy)
- Modify: `index.html` (nav položka, `#p-documents`)
- Modify: `css/styles.css` (styly seznamu)

**Interfaces:**
- Consumes: z Task 1 `parseDocRow`, `visibleDocs`, `filterDocs`, `folderCounts`, `escHtml`
- Produces (export z `js/documents.js`):
  - `loadDocuments(pre?: {values:any[][]} | {error:any}): void` — naplní `state.docs`, nastaví `state._docsLoaded = true`, zavolá `renderDocs()`
  - `renderDocs(): void`
  - `docSearch(q: string): void`, `docPickFolder(name: string): void` (stejný název znovu = zrušit filtr)
  - `getCurrentPerson(): string|null` (export z `js/auth.js`)

- [ ] **Step 1: `getCurrentPerson` v `js/auth.js`**

Za funkci `getCurrentUser()` přidat:
```js
// Jméno přihlášeného ('Martin'/'Šárka'); null = appka bez přihlášení (lokální vývoj).
export function getCurrentPerson() {
  const user = getCurrentUser();
  if (!user) return null;
  return AUTH_USERS[user.email.toLowerCase()]?.person || null;
}
```

- [ ] **Step 2: Stav v `js/state.js`**

Za řádek `_salaryLoaded: false, ...` přidat:
```js
  docs: [],              // dokumenty (list Dokumenty), viz documents-core.js
  _docsLoaded: false,    // true po prvním pokusu o fetch — rozlišuje "načítá se" od "opravdu prázdné"
```

- [ ] **Step 3: Nav položka + stránka v `index.html`**

Na místo, kde byla nav položka Rozpočty (hned za `data-page="transactions"`), vložit:
```html
      <div class="ni" data-page="documents" onclick="nav('documents',this)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 1.5h6l3 3v10h-9z" stroke-linejoin="round"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" stroke-linecap="round"/></svg><span>Dokumenty</span></div>
```

Na místo smazané `#p-budgets` vložit:
```html
    <div id="p-documents" class="page">
      <div class="topbar"><h2>Dokumenty</h2><div class="topbar-right"><button class="btnp" onclick="openDocUpload()">+ Nahrát</button></div></div>
      <div class="content">
        <input type="search" id="docSearch" class="doc-search" placeholder="Hledat podle názvu nebo složky…" oninput="docSearch(this.value)" autocomplete="off"/>
        <div class="chip-row doc-folders" id="docFolders"></div>
        <div class="card"><div id="docList"></div></div>
      </div>
    </div>
```

(`openDocUpload` vznikne v Task 5; do té doby tlačítko jen hodí chybu v konzoli — Task 4 a 5 se deployují spolu.)

- [ ] **Step 4: Styly v `css/styles.css`**

Za řádek `.chip{...}` přidat:
```css
/* Dokumenty */
.doc-search{width:100%;padding:10px 14px;border-radius:var(--r);border:1px solid var(--border2);background:var(--surface);font-size:14px;color:var(--text)}
.doc-folders{margin:12px 0}
button.chip{cursor:pointer;font-family:inherit}
.chip.active{background:var(--text);border-color:var(--text);color:var(--surface)}
.doc-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border)}
.doc-row:last-child{border-bottom:none}
.doc-ico{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.02em}
.doc-ico.pdf{color:var(--red);background:color-mix(in srgb, var(--red) 12%, transparent)}
.doc-ico.image{color:var(--blue);background:color-mix(in srgb, var(--blue) 12%, transparent)}
.doc-main{flex:1;min-width:0;text-decoration:none;color:var(--text)}
.doc-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-meta{font-size:11px;color:var(--text3);margin-top:2px}
.doc-vis{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--surface2);color:var(--text2);white-space:nowrap}
.doc-vis.priv{background:color-mix(in srgb, var(--purple) 14%, transparent);color:var(--purple)}
.doc-actions{display:flex;gap:4px;flex-shrink:0}
```

- [ ] **Step 5: Vytvořit `js/documents.js` (načtení + render)**

```js
import { state } from './state.js';
import { getCurrentPerson } from './auth.js';
import { parseDocRow, visibleDocs, filterDocs, folderCounts, escHtml } from './documents-core.js';

let _query = '';
let _folder = null; // null = všechny složky, '' = bez složky

// `pre` = odpověď listu Dokumenty z dávkového fetchSheets v app.js.
export function loadDocuments(pre) {
  state.docs = (pre && Array.isArray(pre.values)) ? pre.values.map(parseDocRow).filter(Boolean) : [];
  state._docsLoaded = true;
  renderDocs();
}

export function docSearch(q) { _query = q; renderDocs(); }
export function docPickFolder(name) { _folder = (_folder === name) ? null : name; renderDocs(); }

const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : iso; };
const folderLabel = n => n || 'Bez složky';

export function renderDocs() {
  const list = document.getElementById('docList');
  if (!list) return;
  const chips = document.getElementById('docFolders');
  if (!state._docsLoaded) {
    chips.innerHTML = '';
    list.innerHTML = '<div class="loading-state"><div class="loading-spinner spin"></div>Načítám dokumenty…</div>';
    return;
  }
  const mine = visibleDocs(state.docs, getCurrentPerson());
  const folders = folderCounts(mine);
  if (_folder !== null && !folders.some(f => f.name === _folder)) _folder = null;

  chips.innerHTML = [`<button class="chip${_folder === null ? ' active' : ''}" onclick="docPickFolder(null)">Vše ${mine.length}</button>`]
    .concat(folders.map(f => `<button class="chip${_folder === f.name ? ' active' : ''}" onclick="docPickFolder(${escHtml(JSON.stringify(f.name))})">${escHtml(folderLabel(f.name))} ${f.count}</button>`))
    .join('');

  if (!mine.length) {
    list.innerHTML = '<div class="empty">Zatím žádné dokumenty. Nahraj první přes „+ Nahrát".</div>';
    return;
  }
  const shown = filterDocs(mine, _query, _folder)
    .sort((a, b) => b.datum.localeCompare(a.datum) || a.nazev.localeCompare(b.nazev, 'cs'));
  if (!shown.length) {
    list.innerHTML = '<div class="empty">Nic nenalezeno.</div>';
    return;
  }
  list.innerHTML = shown.map(d => {
    const vis = d.viditelnost === 'Oba' ? '<span class="doc-vis">Oba</span>' : `<span class="doc-vis priv">jen ${escHtml(d.viditelnost)}</span>`;
    return `<div class="doc-row">
      <div class="doc-ico ${d.typ === 'pdf' ? 'pdf' : 'image'}">${d.typ === 'pdf' ? 'PDF' : 'IMG'}</div>
      <a class="doc-main" href="${escHtml(d.url)}" target="_blank" rel="noopener noreferrer">
        <div class="doc-name">${escHtml(d.nazev)}</div>
        <div class="doc-meta">${escHtml(folderLabel(d.slozka))} · ${fmtDate(d.datum)} · ${fmtSize(d.velikost)}${d.nahral ? ' · ' + escHtml(d.nahral) : ''}</div>
      </a>
      ${vis}
      <div class="doc-actions">
        <button class="btn btnsm" onclick="openDocEdit('${escHtml(d.id)}')" title="Upravit">✎</button>
        <button class="btn btnsm" onclick="deleteDoc('${escHtml(d.id)}')" title="Smazat">🗑</button>
      </div>
    </div>`;
  }).join('');
}
```

Pozn.: `docPickFolder(${escHtml(JSON.stringify(f.name))})` — `JSON.stringify` vyrobí platný JS řetězcový literál a `escHtml` ho bezpečně vloží do HTML atributu (prohlížeč entity před spuštěním dekóduje zpět).

- [ ] **Step 6: Napojení v `js/app.js`**

1. Import (k ostatním importům):
```js
import { loadDocuments, renderDocs, docSearch, docPickFolder } from './documents.js';
```
2. V `loadSheets()`:
```js
    const names = ['Recurring', 'MbankImport', 'Nastaveni'];
```
→
```js
    const names = ['Recurring', 'MbankImport', 'Nastaveni', 'Dokumenty'];
```
a v `.then(s => { ... })` za `applyNastaveni(s.Nastaveni);` přidat:
```js
      loadDocuments(s.Dokumenty);
```
3. V `catch(e)` bloku `loadSheets()` (výpadek spojení) za `loadRecurring();` přidat:
```js
    loadDocuments();
```
4. V `nav()` za `if (id === 'salary') renderSalary();` přidat:
```js
  if (id === 'documents') renderDocs();
```
5. Window bindingy (k ostatním `window.*`):
```js
window.docSearch = docSearch;
window.docPickFolder = docPickFolder;
```

- [ ] **Step 7: Syntax + unit testy**

Run:
```bash
node --test tests/
for f in js/documents.js js/app.js js/auth.js js/state.js; do node --check "$f" && echo "$f OK"; done
```
Expected: testy PASS; všechny 4 soubory `OK` (díky `"type":"module"` jde `node --check` přímo na `.js`).

- [ ] **Step 8: Commit**

```bash
git add js/documents.js js/auth.js js/state.js js/app.js index.html css/styles.css
git commit -F - <<'EOF'
feat(dokumenty): stranka se seznamem, hledanim a slozkami

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Nahrání, úprava a smazání dokumentu

**Files:**
- Modify: `js/documents.js` (modal + akce)
- Modify: `index.html` (modal `#docModal` vedle ostatních `.overlay`)
- Modify: `js/app.js` (window bindingy)

**Interfaces:**
- Consumes: z Task 1 `validateUpload`, `canonicalFolder`, `stripExt`, `folderCounts`, `visibleDocs`, `escHtml`, `VISIBILITY`, `parseDocRow`, `DOK`; z Task 4 `renderDocs`, `state.docs`, `getCurrentPerson`; GAS akce z Task 2
- Produces (export z `js/documents.js`): `openDocUpload()`, `openDocEdit(id)`, `closeDocModal()`, `docDov(e)`, `docDol()`, `docDod(e)`, `onDocFile(e)`, `saveDoc()`, `deleteDoc(id)`

- [ ] **Step 1: Modal v `index.html`**

Hned za uzavírací `</div>` modalu `#salaryModal` (před `<div class="toast" id="toast"></div>`) vložit:
```html
<div class="overlay" id="docModal" style="display:none">
  <div class="modal" style="max-width:480px">
    <h2 id="docModalTitle">Nahrát dokument</h2>
    <div id="docZone" class="upzone" style="margin-bottom:14px;padding:22px"
      ondragover="docDov(event)" ondragleave="docDol()" ondrop="docDod(event)">
      <div id="docZoneLabel" style="font-weight:600;margin-bottom:8px">Přetáhni PDF nebo obrázek sem</div>
      <label class="btnp btnsm" style="cursor:pointer">Vybrat soubor / vyfotit
        <input type="file" accept="application/pdf,image/*" style="display:none" onchange="onDocFile(event)"/>
      </label>
    </div>
    <div class="fg"><label>Název</label><input type="text" id="docName" placeholder="např. Smlouva o koupi psa"/></div>
    <div class="fg" style="margin-top:10px"><label>Složka</label>
      <input type="text" id="docFolder" list="docFolderList" placeholder="vyber nebo napiš novou (např. Pes)" autocomplete="off"/>
      <datalist id="docFolderList"></datalist>
    </div>
    <div class="fg" style="margin-top:10px"><label>Kdo to uvidí</label>
      <div class="chip-row" id="docVis"></div>
    </div>
    <div id="docErr" style="display:none;color:var(--red);font-size:12px;margin-top:10px"></div>
    <div class="mactions">
      <button class="btn" onclick="closeDocModal()">Zrušit</button>
      <button class="btnp" id="docSaveBtn" onclick="saveDoc()">Uložit</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Logika modalu v `js/documents.js`**

Rozšířit import na začátku souboru:
```js
import { state } from './state.js';
import { GAS_URL } from './config.js';
import { getCurrentPerson } from './auth.js';
import { toast } from './app.js';
import { parseDocRow, visibleDocs, filterDocs, folderCounts, escHtml,
         validateUpload, canonicalFolder, stripExt, VISIBILITY, DOK } from './documents-core.js';
```

Na konec souboru přidat:
```js
/* ── MODAL: nahrání i úprava ── */
let _editId = null;   // null = nahrávání nového
let _file = null;
let _vis = 'Oba';
let _busy = false;

const $ = id => document.getElementById(id);
const visLabel = v => v === 'Oba' ? 'Oba' : 'jen ' + v;

function renderVis() {
  $('docVis').innerHTML = VISIBILITY.map(v =>
    `<button type="button" class="chip${_vis === v ? ' active' : ''}" onclick="docSetVis('${v}')">${visLabel(v)}</button>`).join('');
}
export function docSetVis(v) { _vis = v; renderVis(); }

function fillFolderList() {
  $('docFolderList').innerHTML = folderCounts(state.docs).filter(f => f.name)
    .map(f => `<option value="${escHtml(f.name)}"></option>`).join('');
}

function showErr(msg) { const e = $('docErr'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }

function openModal(title, withFile) {
  _busy = false;
  $('docModalTitle').textContent = title;
  $('docZone').style.display = withFile ? '' : 'none';
  $('docZoneLabel').textContent = 'Přetáhni PDF nebo obrázek sem';
  $('docSaveBtn').disabled = false;
  $('docSaveBtn').textContent = 'Uložit';
  showErr('');
  fillFolderList();
  renderVis();
  $('docModal').style.display = 'flex';
}

export function openDocUpload() {
  _editId = null; _file = null; _vis = 'Oba';
  $('docName').value = ''; $('docFolder').value = _folder || '';
  openModal('Nahrát dokument', true);
}

export function openDocEdit(id) {
  const d = state.docs.find(x => x.id === id);
  if (!d) return;
  _editId = id; _file = null; _vis = d.viditelnost;
  $('docName').value = d.nazev; $('docFolder').value = d.slozka;
  openModal('Upravit dokument', false);
}

export function closeDocModal() { if (!_busy) $('docModal').style.display = 'none'; }

function pickFile(f) {
  const err = validateUpload({ name: f.name, size: f.size, type: f.type });
  if (err) { _file = null; showErr(err); return; }
  _file = f; showErr('');
  $('docZoneLabel').textContent = '📎 ' + f.name;
  if (!$('docName').value.trim()) $('docName').value = stripExt(f.name);
}
export function docDov(e) { e.preventDefault(); $('docZone').classList.add('over'); }
export function docDol() { $('docZone').classList.remove('over'); }
export function docDod(e) { e.preventDefault(); docDol(); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }
export function onDocFile(e) { const f = e.target.files[0]; if (f) pickFile(f); e.target.value = ''; }

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Soubor nejde přečíst.'));
    r.readAsDataURL(file);
  });
}

async function postGas(payload) {
  const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

// GAS vrací objekt podle hlavičky → převést na řádek a projet stejným parserem jako načtení.
const docFromServer = o => parseDocRow(Object.keys(DOK).map(k => o[k]));

export async function saveDoc() {
  if (_busy) return;
  const nazev = $('docName').value.trim();
  const existing = folderCounts(state.docs).map(f => f.name).filter(Boolean);
  const slozka = canonicalFolder($('docFolder').value, existing);
  if (!_editId && !_file) { showErr('Vyber soubor.'); return; }
  if (!nazev) { showErr('Vyplň název.'); return; }

  _busy = true; showErr('');
  const btn = $('docSaveBtn');
  btn.disabled = true;
  btn.textContent = _editId ? 'Ukládám…' : 'Nahrávám…';
  try {
    let d;
    if (_editId) {
      d = await postGas({ action: 'updateDocument', id: _editId, nazev, slozka, viditelnost: _vis });
      state.docs = state.docs.map(x => x.id === _editId ? docFromServer(d.doc) : x);
    } else {
      const data = await readBase64(_file);
      d = await postGas({ action: 'uploadDocument', nazev, slozka, viditelnost: _vis,
        nahral: getCurrentPerson() || '', fileName: _file.name, mimeType: _file.type, data });
      state.docs = state.docs.concat(docFromServer(d.doc));
    }
    _busy = false;
    $('docModal').style.display = 'none';
    toast(_editId ? 'Dokument upraven' : 'Dokument nahrán', 'ok');
    renderDocs();
  } catch (e) {
    _busy = false;
    btn.disabled = false; btn.textContent = 'Uložit';
    showErr('Nepodařilo se uložit: ' + e.message);
  }
}

export async function deleteDoc(id) {
  const d = state.docs.find(x => x.id === id);
  if (!d || !confirm(`Smazat „${d.nazev}"?\nSoubor se přesune do koše na Google Drive (30 dní jde obnovit).`)) return;
  try {
    await postGas({ action: 'deleteDocument', id });
    state.docs = state.docs.filter(x => x.id !== id);
    toast('Dokument smazán', 'ok');
    renderDocs();
  } catch (e) {
    toast('Smazání selhalo: ' + e.message, 'err');
  }
}
```

Pozn.: Zachovat v souboru exporty z Task 4 (`loadDocuments`, `renderDocs`, `docSearch`, `docPickFolder`) — `visibleDocs`, `filterDocs` v importu zůstávají kvůli `renderDocs`.

- [ ] **Step 3: Window bindingy v `js/app.js`**

Rozšířit import z `./documents.js`:
```js
import { loadDocuments, renderDocs, docSearch, docPickFolder, openDocUpload, openDocEdit, closeDocModal,
         docDov, docDol, docDod, onDocFile, saveDoc, deleteDoc, docSetVis } from './documents.js';
```
A k ostatním `window.*`:
```js
window.openDocUpload = openDocUpload;
window.openDocEdit = openDocEdit;
window.closeDocModal = closeDocModal;
window.docDov = docDov;
window.docDol = docDol;
window.docDod = docDod;
window.onDocFile = onDocFile;
window.saveDoc = saveDoc;
window.deleteDoc = deleteDoc;
window.docSetVis = docSetVis;
```

- [ ] **Step 4: Ověřit, že každý inline handler má window binding**

Run:
```bash
for fn in openDocUpload openDocEdit closeDocModal docDov docDol docDod onDocFile saveDoc deleteDoc docSetVis docSearch docPickFolder; do grep -q "window.$fn = " js/app.js && echo "$fn ok" || echo "$fn CHYBI"; done
```
Expected: 12× `ok`.

- [ ] **Step 5: Syntax + unit testy**

Run:
```bash
node --test tests/
node --check js/documents.js && node --check js/app.js && echo OK
```
Expected: PASS a `OK`.

- [ ] **Step 6: Commit**

```bash
git add js/documents.js js/app.js index.html
git commit -F - <<'EOF'
feat(dokumenty): nahrani, uprava a smazani dokumentu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Dokumentace, push a ověření end-to-end

**Files:**
- Modify: `CLAUDE.md` (sekce Data layer a tabulka modulů)

**Interfaces:**
- Consumes: vše výše
- Produces: nic

- [ ] **Step 1: Aktualizovat `CLAUDE.md`**

Nahradit řádek:
```
Sheet names used: `Transakce`, `Recurring`, `MbankImport`, `Investice`, `Ucty`.
```
za:
```
Sheet names used: `Transakce`, `Recurring`, `MbankImport`, `Fondy`, `Trh`, `FondyHist`, `TrhHist`, `Mzdy`, `MzdyImport`, `UcpImport`, `Nastaveni`, `Dokumenty`.
```
Do tabulky modulů přidat řádky:
```
| `documents.js` | Stránka Dokumenty: seznam, hledání, složky, nahrání/úprava/smazání (GAS `uploadDocument`/`updateDocument`/`deleteDocument`) |
| `documents-core.js` | Čistá logika dokumentů bez DOM/sítě, pokrytá `node --test tests/` |
```
a řádek `| \`budgets.js\` | ...` upravit na `Rozpočty (karta v Nastavení) a limity`.

Do sekce „How to run" přidat větu: `Unit tests for pure logic: node --test tests/ (Node 24, no dependencies).`

- [ ] **Step 2: Celkové testy a syntax**

Run:
```bash
node --test tests/
node --check gas-update.js
for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done
```
Expected: testy PASS, žádné `FAIL`.

- [ ] **Step 3: Commit + push**

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: CLAUDE.md — listy, Dokumenty, testy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push origin main
```

- [ ] **Step 4: Redeploy GAS (ruční krok uživatele)**

Uživatel: zkopírovat `gas-update.js` do script.google.com → Deploy → Manage deployments → ✎ → Version: New version → Deploy. První volání `uploadDocument` si vyžádá oprávnění k Drive (už udělené kvůli účtenkám — nemělo by být potřeba nic potvrzovat).

- [ ] **Step 5: Ověření serveru po redeployi (bez zápisu do produkčních dat)**

Run:
```bash
curl -s -L "https://script.google.com/macros/s/AKfycbzKcg3Zr5PUQ5MPvxVavSxr8RtySOJ3rtmHTMQaxv13dwqUaP5BFS2IYZRFF3UsHPPP-Q/exec?sheet=Dokumenty"
```
Expected: buď `{"error":"List \"Dokumenty\" neexistuje"}` (před prvním nahráním), nebo `{"values":[["id","nazev",...]...]}`.

- [ ] **Step 6: Ruční E2E checklist pro uživatele (appka je za Firebase loginem, agent ji nemůže proklikat)**

Projít na https://makafkartin88.github.io/finance-app/ (po tvrdém obnovení):
1. Menu: místo „Rozpočty" je „Dokumenty"; v Nastavení je karta „Rozpočty" s výběrem měsíce a pruhy.
2. Nahrát PDF do nové složky „Pes", viditelnost Oba → objeví se v seznamu, štítek „Pes 1"; na Drive je `Finance-Dokumenty/Pes/…`.
3. Nahrát fotku z telefonu („Vybrat soubor / vyfotit") do složky „pes" (malými) → skončí ve stejné složce „Pes", ne v nové.
4. Hledání „SMLOUVA", „ockovani" najde dokumenty s „Smlouva", „očkování".
5. Dokument „jen Šárka" → Martin ho nevidí (a naopak).
6. ✎ → přesun do složky „Auto" → štítek se změní, na Drive se soubor přesune.
7. 🗑 → potvrzení → zmizí, soubor je v koši Drive.
8. Soubor > 20 MB nebo .docx → hláška v modalu, nic se neodešle.
9. `#budgets` v URL → otevře se Přehled.

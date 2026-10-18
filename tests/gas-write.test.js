import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Minimální podvržená tabulka: list = pole řádků (hlavička na indexu 0).
function makeGas(sheets, { props = {}, lookupEmail = null } = {}) {
  const lock = { held: false, tryLock() { if (this.held) return false; this.held = true; return true; }, releaseLock() { this.held = false; } };
  const sheetApi = (name) => {
    const rows = sheets[name];
    return {
      getName: () => name,
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getLastRow: () => rows.length,
      deleteRow: (n) => rows.splice(n - 1, 1),
      getRange: (r, c, nr = 1, nc = 1) => ({
        setValues: (vals) => vals.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }),
        setValue: (x) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = x; },
        setNumberFormat() { return this; },
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      }),
    };
  };
  const ss = {
    getSheetByName: (n) => (sheets[n] ? sheetApi(n) : null),
    getSheets: () => [sheetApi(Object.keys(sheets)[0])],
    insertSheet: (n) => { sheets[n] = []; return sheetApi(n); },
  };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => lock },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return JSON.parse(this.t); } }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 7),
      computeDigest: (_a, str) => [...crypto.createHash('sha256').update(str).digest()].map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      base64DecodeWebSafe: (x) => [...Buffer.from(x, 'base64url')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString() }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    CacheService: { getScriptCache: () => { const m = {}; return { get: k => m[k] ?? null, put: (k, v) => { m[k] = v; } }; } },
    UrlFetchApp: { fetch: () => ({
      getResponseCode: () => (lookupEmail ? 200 : 400),
      getContentText: () => JSON.stringify({ users: lookupEmail ? [{ email: lookupEmail, emailVerified: true }] : [] }),
    }) },
  });
  vm.runInContext(fs.readFileSync(new URL('../gas-update.js', import.meta.url), 'utf8'), ctx);
  return { ctx, lock };
}

const post = (ctx, body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });

test('updateRow: přepíše řádek na místě podle id, ostatní nechá', () => {
  const sheets = { Transakce: [['h'], ['a', , , , , , , , , , , , , , 'ID1'], ['b', , , , , , , , , , , , , , 'ID2']] };
  const { ctx } = makeGas(sheets);
  const row = Array(20).fill('x'); row[14] = 'ID2';
  assert.equal(post(ctx, { action: 'updateRow', sheet: 'Transakce', id: 'ID2', values: row }).success, true);
  assert.equal(sheets.Transakce.length, 3);
  assert.equal(sheets.Transakce[2][0], 'x');
  assert.equal(sheets.Transakce[1][0], 'a');
});

test('updateRow: neexistující id → chyba (nic nepřipíše)', () => {
  const sheets = { Transakce: [['h'], ['a', , , , , , , , , , , , , , 'ID1']] };
  const { ctx } = makeGas(sheets);
  assert.match(post(ctx, { action: 'updateRow', sheet: 'Transakce', id: 'NOPE', values: ['x'] }).error, /nenalezen/);
  assert.equal(sheets.Transakce.length, 2);
});

test('appendRecurring: vygeneruje jen šablony, které tento měsíc ještě nemají, a poznamená posledniGen', () => {
  const recRow = (id, gen) => [id, 'p', 1, 'Výdaj', 'K', 'Oba', 'u', 'm', 'pr', 'monthly', 1, 'TRUE', gen, 'FALSE'];
  const sheets = { Transakce: [['h']], Recurring: [['h'], recRow('R1', ''), recRow('R2', '2026-10')] };
  const { ctx } = makeGas(sheets);
  const items = [{ recId: 'R1', row: ['tx1'] }, { recId: 'R2', row: ['tx2'] }];
  const r1 = post(ctx, { action: 'appendRecurring', month: '2026-10', items });
  assert.deepEqual(r1.added, ['R1']);
  assert.equal(sheets.Transakce.length, 2);
  assert.equal(sheets.Recurring[1][12], '2026-10');
  // Druhé zařízení / opakované otevření → nic dalšího
  const r2 = post(ctx, { action: 'appendRecurring', month: '2026-10', items });
  assert.deepEqual(r2.added, []);
  assert.equal(sheets.Transakce.length, 2);
});

test('obecný zápis: text se "=" se uloží jako text, ne vzorec; řádky se dorovnají', () => {
  const sheets = { Transakce: [['h']] };
  const { ctx } = makeGas(sheets);
  post(ctx, { sheet: 'Transakce', values: [['=HYPERLINK("x")', 1], ['ok']] });
  assert.equal(sheets.Transakce[1][0], '\'=HYPERLINK("x")');
  assert.equal(sheets.Transakce[2].length, 2);
});

test('deleteRow: maže podle id jako textu a pod zámkem; obsazený zámek → chyba', () => {
  const sheets = { Transakce: [['h'], ['a', , , , , , , , , , , , , , 123]] };
  const { ctx, lock } = makeGas(sheets);
  lock.held = true;
  assert.match(post(ctx, { action: 'deleteRow', sheet: 'Transakce', txId: '123' }).error, /upravuje/);
  lock.held = false;
  assert.equal(post(ctx, { action: 'deleteRow', sheet: 'Transakce', txId: '123' }).success, true);
  assert.equal(sheets.Transakce.length, 1);
});

// ── Ověření volajícího ──
const tok = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s';
const docs = () => ({ Dokumenty: [['id', 'nazev', 'slozka', 'viditelnost'], ['d1', 'A', '', 'Oba'], ['d2', 'B', '', 'Martin'], ['d3', 'C', '', 'Šárka']],
  Mzdy: [['id'], ['2026-09']], Transakce: [['h']] });

test('auth: bez AUTH_ENFORCE projde i požadavek bez tokenu (přechodné období)', () => {
  const { ctx } = makeGas(docs());
  const r = post(ctx, { action: 'read', sheets: ['Mzdy'] });
  assert.ok(r.sheets.Mzdy.values);
});

test('auth: s AUTH_ENFORCE bez platného tokenu nic, GET zakázán', () => {
  const { ctx } = makeGas(docs(), { props: { AUTH_ENFORCE: '1' } });
  assert.match(post(ctx, { action: 'read', sheets: ['Transakce'] }).error, /Nepřihlášený/);
  assert.match(post(ctx, { action: 'read', sheets: ['Transakce'], idToken: tok }).error, /Nepřihlášený/); // lookup selže
  assert.match(ctx.doGet({ parameter: { sheet: 'Transakce' } }).error, /POST/);
});

test('auth: Šárka nedostane mzdu ani cizí soukromý dokument; Martin vše své', () => {
  const s1 = makeGas(docs(), { props: { AUTH_ENFORCE: '1' }, lookupEmail: 'besarka@gmail.com' });
  const r = post(s1.ctx, { action: 'read', sheets: ['Mzdy', 'Dokumenty'], idToken: tok });
  assert.match(r.sheets.Mzdy.error, /oprávnění/);
  assert.deepEqual(r.sheets.Dokumenty.values.map(x => x[0]), ['id', 'd1', 'd3']);
  assert.match(post(s1.ctx, { sheet: 'Mzdy', values: [['x']], idToken: tok }).error, /oprávnění/);
  const s2 = makeGas(docs(), { props: { AUTH_ENFORCE: '1' }, lookupEmail: 'martinkafka9@gmail.com' });
  const r2 = post(s2.ctx, { action: 'read', sheets: ['Mzdy', 'Dokumenty'], idToken: tok });
  assert.ok(r2.sheets.Mzdy.values);
  assert.deepEqual(r2.sheets.Dokumenty.values.map(x => x[0]), ['id', 'd1', 'd2']);
});

test('auth: cizí Google účet (není na whitelistu) neprojde', () => {
  const { ctx } = makeGas(docs(), { props: { AUTH_ENFORCE: '1' }, lookupEmail: 'cizi@example.com' });
  assert.match(post(ctx, { action: 'read', sheets: ['Transakce'], idToken: tok }).error, /Nepřihlášený/);
});

test('updateRow Mzdy: najde měsíc, i když ho Sheets převedl na datum (žádný duplicitní řádek)', () => {
  const sheets = { Mzdy: [] };
  const { ctx } = makeGas(sheets);
  const d = (iso) => vm.runInContext(`new Date('${iso}')`, ctx); // Date z realmu GAS kontextu
  sheets.Mzdy.push(['id'], [d('2026-08-01T00:00:00Z'), 'x'], [d('2026-09-01T00:00:00Z'), 'old']);
  assert.equal(post(ctx, { action: 'updateRow', sheet: 'Mzdy', id: '2026-09', values: ['2026-09', 'new'] }).success, true);
  assert.equal(sheets.Mzdy.length, 3);
  assert.equal(sheets.Mzdy[2][1], 'new');
});

test('parseCpiCsv: z výběru ČSÚ vezme jen bazický index úhrnu za ČR, měsíce → YYYY-MM', () => {
  const { ctx } = makeGas({ X: [[]] });
  const csv = [
    '"Ukazatel","Typ indexu","Území","Skupiny domácností","Klasifikace COICOP 2018-Oddíl","Klasifikace COICOP 2018-Skupina a třída","Měsíce","Hodnota","MJ_TEXT","MJ_SYMBOL","POZNAMKA","POZNAMKA_TEXT"',
    '"Index spotřebitelských cen (životních nákladů)","Bazický index (2025 = 100)","Česko","Domácnosti celkem","Úhrn","","září 2026","102.6","procento","%","",""',
    '"Index spotřebitelských cen (životních nákladů)","Bazický index (2025 = 100)","Česko","Domácnosti celkem","Úhrn","","říjen 2026","103.1","procento","%","",""',
    '"Index spotřebitelských cen (životních nákladů)","Meziroční index","Česko","Domácnosti celkem","Úhrn","","říjen 2026","102.5","procento","%","",""',
    '"Index spotřebitelských cen (životních nákladů)","Bazický index (2025 = 100)","Česko","Domácnosti celkem","Potraviny","","říjen 2026","99.0","procento","%","",""',
  ].join('\n');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.parseCpiCsv(csv))), [['2026-09', 102.6], ['2026-10', 103.1]]);
});

test('saveSettings: uložení jen limitů nepřepíše účty a bilanci', () => {
  const sheets = { Nastaveni: [['bilanceOffset', 'bilanceUcet', 'uctyMartin', 'uctySarka'], [20000, 'U', 'M', 'S']] };
  const { ctx } = makeGas(sheets);
  assert.equal(post(ctx, { action: 'saveSettings', limity: '{"Jídlo":9000}' }).success, true);
  assert.deepEqual(sheets.Nastaveni[1], [20000, 'U', 'M', 'S', '{"Jídlo":9000}']);
  assert.equal(sheets.Nastaveni[0][4], 'limity');
});

test('yahooRange: historie S&P pokryje i nejstarší nákup (dřív jen 1 rok)', () => {
  const { ctx } = makeGas({});
  const r = (from) => vm.runInContext(`yahooRange(new Date(${JSON.stringify(from)}), new Date('2026-10-18'))`, ctx);
  assert.equal(r('2026-05-01'), '2y');
  assert.equal(r('2024-01-01'), '5y');
  assert.equal(r('2019-01-01'), '10y');
  assert.equal(r('2010-01-01'), 'max');
  assert.equal(vm.runInContext(`yahooRange(null, new Date('2026-10-18'))`, ctx), '2y');
});

test('removeSoldT212: prodaná pozice zmizí, souhrn a ostatní fondy zůstanou', () => {
  const sheets = { Fondy: [['provider', 'isin'], ['T212', 'AAPL_US_EQ'], ['CODYA', 'CZ0008042892'], ['T212', 'MSFT_US_EQ'], ['T212', 'T212_CASH']] };
  const { ctx } = makeGas(sheets);
  ctx.__keep = ['MSFT_US_EQ', 'T212_CASH'];
  const n = vm.runInContext(`removeSoldT212(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Fondy'), __keep)`, ctx);
  assert.equal(n, 1);
  assert.deepEqual(sheets.Fondy.map(r => r[1]), ['isin', 'CZ0008042892', 'MSFT_US_EQ', 'T212_CASH']);
});

test('updateRow/deleteRow: duplicitní id → chyba, nic se nepřepíše ani nesmaže', () => {
  const sheets = { Recurring: [['id'], ['REC-3', 'Nájem'], ['REC-3', 'Netflix']] };
  const { ctx } = makeGas(sheets);
  const r = post(ctx, { action: 'updateRow', sheet: 'Recurring', id: 'REC-3', values: ['REC-3', 'X'] });
  assert.ok(r.error);
  assert.deepEqual(sheets.Recurring.map(x => x[1]), [undefined, 'Nájem', 'Netflix']);
  assert.ok(post(ctx, { action: 'deleteRow', sheet: 'Recurring', txId: 'REC-3' }).error);
  assert.equal(sheets.Recurring.length, 3);
});

test('dedupeIds: druhý a další výskyt id dostane nové unikátní id', () => {
  const tx = (id, p) => { const r = Array(15).fill(''); r[0] = p; r[14] = id; return r; };
  const sheets = { Transakce: [Array(15).fill('h'), tx('20260101-5', 'a'), tx('20260101-5', 'b'), tx('X', 'c')], Recurring: [['id'], ['REC-2', 'n'], ['REC-2', 'm']] };
  const { ctx } = makeGas(sheets);
  const n = vm.runInContext('dedupeIds()', ctx);
  assert.equal(n, 2);
  const ids = sheets.Transakce.slice(1).map(r => r[14]);
  assert.equal(ids[0], '20260101-5');
  assert.notEqual(ids[1], '20260101-5');
  assert.match(ids[1], /^20260101-5-d[0-9a-f]+$/);
  assert.equal(new Set(sheets.Recurring.slice(1).map(r => r[0])).size, 2);
  assert.equal(vm.runInContext('dedupeIds()', ctx), 0);
});

test('updateRow Mzdy: první řádek bez hlavičky jde taky aktualizovat', () => {
  const sheets = { Mzdy: [['2026-01', 100], ['2026-02', 200]] };
  const { ctx } = makeGas(sheets);
  assert.equal(post(ctx, { action: 'updateRow', sheet: 'Mzdy', id: '2026-01', values: ['2026-01', 111] }).success, true);
  assert.equal(sheets.Mzdy[0][1], 111);
});

test('read: odpověď říká, komu server přihlášení ověřil', () => {
  const { ctx } = makeGas({ Transakce: [['h']] });
  const r = post(ctx, { action: 'read', sheets: ['Transakce'] });
  assert.equal(r.who, null);
  assert.equal(r.enforced, false);
});

test('auth: Šárka nezmění mzdu přes updateRow/deleteRow ani cizí soukromý dokument', () => {
  const s1 = makeGas(docs(), { props: { AUTH_ENFORCE: '1' }, lookupEmail: 'besarka@gmail.com' });
  assert.match(post(s1.ctx, { action: 'updateRow', sheet: 'Mzdy', id: 'x', values: [['x']], idToken: tok }).error, /oprávnění/);
  assert.match(post(s1.ctx, { action: 'deleteRow', sheet: 'Fondy', txId: 'x', idToken: tok }).error, /oprávnění/);
  assert.match(post(s1.ctx, { action: 'deleteDocument', id: 'd2', idToken: tok }).error, /oprávnění/);
  assert.match(post(s1.ctx, { action: 'updateDocument', id: 'd2', nazev: 'y', idToken: tok }).error, /oprávnění/);
  const s2 = makeGas(docs(), { props: { AUTH_ENFORCE: '1' }, lookupEmail: 'martinkafka9@gmail.com' });
  assert.equal(post(s2.ctx, { action: 'deleteDocument', id: 'd2', idToken: tok }).success, true);
});

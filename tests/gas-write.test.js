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

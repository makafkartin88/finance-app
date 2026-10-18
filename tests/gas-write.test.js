import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

// Minimální podvržená tabulka: list = pole řádků (hlavička na indexu 0).
function makeGas(sheets) {
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
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 7) },
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

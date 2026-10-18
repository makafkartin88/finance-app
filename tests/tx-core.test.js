import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, recRow, normMonth } from '../js/tx-core.js';

test('newId: datum + náhodná část, nikdy stejné (dřív length+1 → kolize po smazání)', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId('2026', '10', '18')));
  assert.equal(ids.size, 500);
  assert.match(newId('2026', '10', '18'), /^20261018-[0-9a-f]{8}$/);
  assert.match(newId('2026', '10', '18', 'mb'), /^20261018-mb[0-9a-f]{8}$/);
});

test('recRow: šablona → řádek listu Recurring (pořadí sloupců)', () => {
  const r = recRow({ id: 'REC-x', popis: 'Nájem', castka: 15000, typ: 'Výdaj', kategorie: 'Bydlení', osoba: 'Oba',
    ucet: 'mBank', metoda: 'Převod', protistrana: 'Pronajímatel', den: 5, aktivni: false, posledniGen: '2026-10', bilance: true });
  assert.deepEqual(r, ['REC-x', 'Nájem', 15000, 'Výdaj', 'Bydlení', 'Oba', 'mBank', 'Převod', 'Pronajímatel',
    'monthly', 5, 'FALSE', '2026-10', 'TRUE']);
});

test('normMonth: text i datum ze Sheets → YYYY-MM (Praha)', () => {
  assert.equal(normMonth('2026-10'), '2026-10');
  assert.equal(normMonth('2026-09-30T22:00:00.000Z'), '2026-10'); // půlnoc 1. 10. v Praze
  assert.equal(normMonth(''), '');
  assert.equal(normMonth(undefined), '');
});

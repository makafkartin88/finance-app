import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, recRow, normMonth, summarize, completedMonths } from '../js/tx-core.js';

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

test('summarize: úspora = příjem − spotřeba (investice jsou úspora), rezerva = po investicích', () => {
  const tx = [
    { typ: 'Příjem', kategorie: 'Příjem', castka: 100000 },
    { typ: 'Výdaj', kategorie: 'Jídlo', castka: 40000 },
    { typ: 'Výdaj', kategorie: 'Investice', castka: 20000 },
    { typ: 'Příjem', kategorie: 'Investice', castka: 5000 },   // prodej/dividenda = příjem, ne „záporná investice"
    { typ: 'Vyrovnání', kategorie: 'Ostatní', castka: 9999 },  // vyrovnání se nepočítá
  ];
  const s = summarize(tx);
  assert.equal(s.income, 105000);
  assert.equal(s.spending, 40000);
  assert.equal(s.invested, 20000);
  assert.equal(s.savings, 65000);
  assert.equal(s.cashLeft, 45000);
  assert.ok(Math.abs(s.savingsRate - 65000 / 105000) < 1e-9);
  assert.equal(summarize([]).savingsRate, 0);
});

test('completedMonths: průměr bez rozběhnutého aktuálního měsíce (když jsou i jiné)', () => {
  assert.deepEqual(completedMonths(['Sep 2026', 'Oct 2026'], 'Oct 2026'), ['Sep 2026']);
  assert.deepEqual(completedMonths(['Oct 2026'], 'Oct 2026'), ['Oct 2026']);
});

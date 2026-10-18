import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CPI_CZ, cumulativeInflation, cpiWith } from '../js/inflation-data.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('cumulativeInflation: poměr indexů ČSÚ (ne průměr meziročních měr)', () => {
  const r = cumulativeInflation('2025-09', '2026-09');
  near(r.pct, (102.6 / 100.1 - 1) * 100);
  assert.equal(r.monthsMissing, 0);
});

test('cumulativeInflation: měsíce za posledním známým se odhadnou (ne 0 %) a spočítají', () => {
  const known = cumulativeInflation('2025-09', '2026-09').pct;
  const r = cumulativeInflation('2025-09', '2026-12');
  assert.equal(r.monthsMissing, 3);
  assert.ok(r.pct > known, 'odhad musí přidat inflaci, ne nulu');
  assert.equal(r.lastKnown, '2026-09');
});

test('cpiWith: data z listu Inflace prodlouží řadu', () => {
  const cpi = cpiWith([['mesic', 'index'], ['2026-10', 103.1], ['2026-11', '103,4']]);
  const r = cumulativeInflation('2025-09', '2026-11', cpi);
  near(r.pct, (103.4 / 100.1 - 1) * 100);
  assert.equal(r.monthsMissing, 0);
});

test('cumulativeInflation: stejný nebo obrácený rozsah → 0', () => {
  assert.equal(cumulativeInflation('2026-05', '2026-05').pct, 0);
  assert.equal(cumulativeInflation('2026-06', '2026-05').pct, 0);
});

test('CPI_CZ: souvislá řada od 2015-01', () => {
  assert.equal(CPI_CZ['2015-01'], 64.2);
  assert.equal(Object.keys(CPI_CZ).length >= 141, true);
});

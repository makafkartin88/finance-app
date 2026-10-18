import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectChanges, levelAt, typicalNet, yearSummaries } from '../js/salary-core.js';

// tarif 50k + prémie; comp = tarif + premie (v tisících pro čitelnost)
const pay = (ids, comps, extra = {}) => ids.map((id, i) => ({ id, rok: +id.slice(0, 4), mesic: +id.slice(5), tarif: 50000,
  premie: comps[i] * 1000 - 50000, cistaMzda: comps[i] * 780, hrubaMzda: comps[i] * 1000, zpPrac: comps[i] * 45, spPrac: comps[i] * 71, danPoSleve: comps[i] * 104, ...extra }));
const months = n => Array.from({ length: n }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);

test('detectChanges: zvýšení s poměrným měsícem = jedna změna, začátek v poměrném měsíci', () => {
  const list = pay(months(6), [55, 55, 58, 60, 60, 60]);
  const ch = detectChanges(list);
  assert.deepEqual(ch.map(c => [c.s.id, c.comp]), [['2025-01', 55000], ['2025-03', 60000]]);
});

test('detectChanges: jednorázově vyšší prémie není zvýšení', () => {
  const ch = detectChanges(pay(months(5), [60, 60, 70, 60, 60]));
  assert.equal(ch.length, 1);
});

test('detectChanges: snížení se pozná až po 3 měsících (2 měsíce dovolené nestačí)', () => {
  assert.equal(detectChanges(pay(months(5), [60, 60, 56, 56, 60])).length, 1);
  const ch = detectChanges(pay(months(6), [60, 60, 50, 50, 50, 50]));
  assert.deepEqual(ch.map(c => c.comp), [60000, 50000]);
  assert.ok(ch[1].comp < ch[1].prev);
});

test('detectChanges: poměrně krácená první páska nezaloží falešné zvýšení', () => {
  const ch = detectChanges(pay(months(4), [30, 60, 60, 60]));
  assert.deepEqual(ch.map(c => [c.s.id, c.comp]), [['2025-02', 60000]]);
});

test('levelAt: úroveň platná v měsíci (ne poměrná částka toho měsíce)', () => {
  const list = pay(months(6), [55, 55, 58, 60, 60, 59]);
  const ch = detectChanges(list);
  assert.equal(levelAt(ch, list, '2025-03'), 60000);
  assert.equal(levelAt(ch, list, '2025-02'), 55000);
  assert.equal(levelAt(ch, list, '2025-06'), 60000);
});

test('typicalNet: medián čisté mzdy v období (dovolená ho nestáhne)', () => {
  const list = pay(months(5), [60, 60, 54, 60, 60]);
  assert.equal(typicalNet(list, '2025-01', '2025-05'), 60 * 780);
});

test('yearSummaries: součty za rok, efektivní sazba odvodů a daně, náklad zaměstnavatele', () => {
  const [y] = yearSummaries(pay(months(2), [60, 60]));
  assert.equal(y.rok, 2025);
  assert.equal(y.pocet, 2);
  assert.equal(y.hruba, 120000);
  assert.equal(y.cista, 93600);
  assert.ok(Math.abs(y.sazba - 0.22) < 1e-9);
  assert.equal(y.nakladZam, Math.round(120000 * 1.338));
});

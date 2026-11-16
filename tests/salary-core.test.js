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

// Vymyšlená čísla (repo je veřejné): maximální prémie 4 000, pak 8 000.
const pr = (id, premie, odpracHod, neodpracHod = 0, extra = {}) =>
  ({ id, rok: +id.slice(0, 4), mesic: +id.slice(5), premie, odpracHod, neodpracHod, dovolenaNarok: 100, dovolenaZustatek: 80, ...extra });

test('bonusSeries: maximum se pozná i z kráceného měsíce, procento z maxima', async () => {
  const { bonusSeries } = await import('../js/salary-core.js');
  const s = bonusSeries([
    pr('2025-01', 4000, 160),
    pr('2025-02', 8000, 168),            // nová maximální prémie
    pr('2025-03', 6545, 144, 32),         // kráceno: 8000 × 144/176
    pr('2025-04', 8000, 176),
  ]);
  assert.deepEqual(s.map(x => x.max), [4000, 8000, 8000, 8000]);
  assert.deepEqual(s.map(x => Math.round(x.pct * 100)), [100, 100, 82, 100]);
  assert.equal(s[1].maxChanged, true);
  assert.equal(s[2].maxChanged, false);
  assert.equal(s[2].krac.neodpracHod, 32);
  assert.equal(s[2].krac.fond, 176);
});

test('bonusSeries: důvod krácení „dovolená" jen když to sedí na zůstatek dovolené', async () => {
  const { bonusSeries } = await import('../js/salary-core.js');
  const s = bonusSeries([
    pr('2025-01', 8000, 176, 0, { dovolenaZustatek: 80 }),
    pr('2025-02', 6545, 144, 32, { dovolenaZustatek: 48 }), // zůstatek −32 h = dovolená
    pr('2025-03', 6545, 144, 32, { dovolenaZustatek: 48 }), // zůstatek beze změny → důvod neznámý
  ]);
  assert.equal(s[1].krac.dovolena, true);
  assert.equal(s[2].krac.dovolena, false);
});

test('bonusSeries: nižší maximum až po 3 měsících za sebou (výkyv výkonu není nové maximum)', async () => {
  const { bonusSeries } = await import('../js/salary-core.js');
  const s = bonusSeries([pr('2025-01', 8000, 176), pr('2025-02', 6000, 176), pr('2025-03', 8000, 176),
    pr('2025-04', 4000, 176), pr('2025-05', 4000, 176), pr('2025-06', 4000, 176)]);
  assert.deepEqual(s.map(x => x.max), [8000, 8000, 8000, 4000, 4000, 4000]);
  assert.equal(Math.round(s[1].pct * 100), 75);
});

test('vacationUsed: přelom roku (nový nárok) a změna nároku ve smlouvě', async () => {
  const { vacationUsed } = await import('../js/salary-core.js');
  const v = (rok, mesic, narok, zust, extra = {}) => ({ rok, mesic, dovolenaNarok: narok, dovolenaZustatek: zust, ...extra });
  assert.equal(vacationUsed(v(2025, 5, 100, 80), v(2025, 6, 100, 64)), 16);
  assert.equal(vacationUsed(v(2025, 7, 100, 30), v(2025, 8, 150, 72)), 8);    // nárok +50, čerpáno 8
  assert.equal(vacationUsed(v(2025, 12, 150, 0), v(2026, 1, 160, 152)), 8);   // nový rok = nový nárok
  assert.equal(vacationUsed(null, v(2026, 1, 160, 160, { dovolenaKc: 0 })), 0);
  assert.equal(vacationUsed(null, v(2026, 1, 160, 160, { dovolenaKc: 1000, prumerHod: 250 })), 4);
});

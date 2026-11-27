import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocation, normFirm, parseSlozeni, parseProfily } from '../js/alloc-core.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const by = (list, name) => list.find(x => x.name === name);

// Vymyšlené portfolio: ETF na index, jedna akcie, nemovitostní fond, hotovost.
const slozeni = {
  IDX: { firmy: [
      { nazev: 'APPLE', vaha: 0.10, sektor: 'Information Technology', zeme: 'United States' },
      { nazev: 'TOYOTA MOTOR CORP', vaha: 0.05, sektor: 'Consumer Discretionary', zeme: 'Japan' }],
    sektory: { 'Information Technology': 0.6, 'Consumer Discretionary': 0.4 },
    zeme: { 'United States': 0.7, 'Japan': 0.3 } },
};
const profily = {
  ETF1: { trida: 'Akcie', klic: 'IDX' },
  AAPL_EQ: { trida: 'Akcie', firma: 'Apple Inc.', sektor: 'Information Technology', zeme: 'United States' },
  RE1: { trida: 'Nemovitosti', sektor: 'Nemovitosti – logistika', zeme: 'Czech Republic' },
};
const holdings = [
  { isin: 'ETF1', nazev: 'ETF na index', czk: 100000 },
  { isin: 'AAPL_EQ', nazev: 'Apple', czk: 20000 },
  { isin: 'RE1', nazev: 'Logistika', czk: 70000 },
  { isin: 'X', nazev: 'Neznámý fond', czk: 10000 },
];

test('allocation: typ aktiv včetně hotovosti a nezařazených', () => {
  const a = allocation(holdings, 50000, profily, slozeni);
  assert.equal(a.total, 250000);
  assert.equal(by(a.trida, 'Akcie').czk, 120000);
  assert.equal(by(a.trida, 'Nemovitosti').czk, 70000);
  assert.equal(by(a.trida, 'Hotovost').czk, 50000);
  assert.equal(by(a.trida, 'Nezařazeno').czk, 10000);
  near(by(a.trida, 'Akcie').pct, 0.48);
});

test('allocation: firma sečtená přes ETF i přímou akcii (jméno sjednocené)', () => {
  const a = allocation(holdings, 0, profily, slozeni);
  const apple = by(a.firmy, 'Apple');
  assert.equal(apple.czk, 100000 * 0.10 + 20000);
  assert.deepEqual(apple.pres.sort(), ['Apple', 'ETF na index']);
  assert.equal(a.firmy[0].name, 'Apple');                 // seřazeno od největší
  assert.equal(by(a.firmy, 'Toyota Motor').czk, 5000);
});

test('allocation: odvětví a země přes složení ETF, Czech názvy', () => {
  const a = allocation(holdings, 0, profily, slozeni);
  assert.equal(by(a.sektory, 'Technologie').czk, 100000 * 0.6 + 20000);
  assert.equal(by(a.sektory, 'Spotřební zboží').czk, 40000);
  assert.equal(by(a.sektory, 'Nemovitosti – logistika').czk, 70000);
  assert.equal(by(a.zeme, 'USA').czk, 70000 + 20000);
  assert.equal(by(a.zeme, 'Japonsko').czk, 30000);
  assert.equal(by(a.zeme, 'Česko').czk, 70000);
});

test('allocation: upozornění na koncentraci (jeden fond > 25 %, firma > 5 %)', () => {
  const a = allocation(holdings, 0, profily, slozeni, { fond: 0.25, firma: 0.05 });
  assert.ok(a.varovani.some(v => v.includes('ETF na index')));       // 50 %
  assert.ok(a.varovani.some(v => v.includes('Logistika')));          // 35 %
  assert.ok(a.varovani.some(v => v.includes('Apple')));              // 15 %
  assert.ok(!a.varovani.some(v => v.includes('Toyota')));            // 2,5 %
});

test('normFirm: třídy akcií a přípony firem se sjednotí', () => {
  assert.equal(normFirm('ALPHABET INC CLASS A'), normFirm('Alphabet Inc. Class C'));
  assert.equal(normFirm('Microsoft Corp'), normFirm('MICROSOFT'));
  assert.equal(normFirm('TAIWAN SEMICONDUCTOR MANUFACTURING'), normFirm('Taiwan Semiconductor Manufacturing Co Ltd'));
  assert.equal(normFirm('TSMC'), normFirm('TAIWAN SEMICONDUCTOR MANUFACTURING'));
});

test('parseSlozeni / parseProfily: listy → mapy', () => {
  const s = parseSlozeni({ values: [['klic', 'typ', 'nazev', 'vaha', 'sektor', 'zeme', 'datum', 'zdroj'],
    ['IDX', 'firma', 'APPLE', '0.1', 'Information Technology', 'United States', '2026-11-25', 'iShares'],
    ['IDX', 'sektor', 'Information Technology', '0.6', '', '', '2026-11-25', 'iShares'],
    ['IDX', 'zeme', 'Japan', '0.3', '', '', '2026-11-25', 'iShares']] });
  assert.equal(s.IDX.firmy[0].vaha, 0.1);
  assert.equal(s.IDX.sektory['Information Technology'], 0.6);
  assert.equal(s.IDX.zeme.Japan, 0.3);
  assert.equal(s.IDX.asOf, '2026-11-25');
  const p = parseProfily({ values: [['isin', 'trida', 'klic', 'firma', 'sektor', 'zeme', 'poznamka'], ['ETF1', 'Akcie', 'IDX', '', '', '', '']] });
  assert.deepEqual(p.ETF1, { trida: 'Akcie', klic: 'IDX', firma: '', sektor: '', zeme: '', poznamka: '' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xirr, providerTotals, annualPct, navAge, fxOf, mergeTopUp } from '../js/inv-core.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('xirr: jeden vklad, rok → roční výnos', () => {
  near(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }]), 0.10, 1e-3);
});

test('xirr: dva vklady v různých termínech (ne jako by vše leželo od prvního)', () => {
  // 1 M na 1/2025, 1 M na 1/2026, k 1/2026 celkem 2,1 M → první milion vydělal 10 % za rok
  const r = xirr([{ date: '2025-01-01', amount: -1e6 }, { date: '2026-01-01', amount: -1e6 }, { date: '2026-01-01', amount: 2.1e6 }]);
  near(r, 0.10, 1e-3);
});

test('xirr: bez kladného nebo záporného toku → null', () => {
  assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null);
  assert.equal(xirr([]), null);
});

test('providerTotals: fond bez nákupní ceny se nezapočte jako zisk', () => {
  const f = (o) => ({ provider: 'UNICREDIT', mena: 'CZK', pocetCP: 0, nakupNAV: 0, aktualNAV: 0, investovanoCZK: 0, aktualHodnotaCZK: 0, hotovostCZK: 0, ...o });
  const t = providerTotals([f({ investovanoCZK: 100000, aktualHodnotaCZK: 110000 }), f({ aktualHodnotaCZK: 200000 })]);
  assert.equal(t.invested, 100000);
  assert.equal(t.costedCurrent, 110000);
  assert.equal(t.gain, 10000);
  assert.equal(t.uncostedCurrent, 200000);
  assert.equal(t.current, 310000);
  near(t.gainPct, 10);
});

test('annualPct: pod rok se neukazuje (+3 % za 45 dní není 27 % p.a.)', () => {
  assert.equal(annualPct(0.03, 45), null);
  near(annualPct(0.21, 730), 10, 0.01);
});

test('navAge: dny od data kurzu a příznak zastaralosti podle poskytovatele', () => {
  const today = new Date('2026-10-18T12:00:00');
  assert.deepEqual(navAge({ provider: 'CODYA', aktualNAVdatum: '31.8.2026' }, today), { days: 48, stale: false });
  assert.deepEqual(navAge({ provider: 'CODYA', aktualNAVdatum: '30.4.2026' }, today), { days: 171, stale: true });
  assert.equal(navAge({ provider: 'CODYA', aktualNAVdatum: '' }, today), null);
});

test('fxOf: USD fond používá svůj kurz, ne 1 (dřív USD = CZK)', () => {
  assert.equal(fxOf({ mena: 'CZK' }), 1);
  assert.equal(fxOf({ mena: 'USD', kurzEUR: 23.1 }), 23.1);
  assert.equal(fxOf({ mena: 'EUR' }), 25);
  assert.equal(fxOf({ mena: 'USD' }), 0);
});

test('mergeTopUp: dokoupení se přičte, nákupní cena vážená', () => {
  const ex = { investovanoCZK: 500000, nakupNAV: 1.0, nakupDatum: '15.4.2026' };
  const m = mergeTopUp(ex, { castka: 210000, nakupNAV: 1.05, nakupDatum: '20.9.2026', pocetCP: 700000 });
  assert.equal(m.castka, 710000);
  near(m.nakupNAV, 710000 / 700000);
  assert.equal(m.nakupDatum, '15.4.2026');
  // stejný nákup znovu (stejné datum) → nic nepřičítat
  assert.equal(mergeTopUp(ex, { castka: 500000, nakupNAV: 1.0, nakupDatum: '15.4.2026', pocetCP: 500000 }), null);
});

test('providerFlows: nákup každého fondu k jeho datu + hodnota k poslednímu ocenění', async () => {
  const { providerFlows } = await import('../js/inv-core.js');
  const fl = providerFlows([
    { provider: 'CODYA', mena: 'CZK', investovanoCZK: 1e6, aktualHodnotaCZK: 1.1e6, nakupDatum: '1.1.2025', aktualNAVdatum: '31.12.2025' },
    { provider: 'CODYA', mena: 'CZK', investovanoCZK: 1e6, aktualHodnotaCZK: 1e6, nakupDatum: '31.12.2025', aktualNAVdatum: '31.12.2025' },
    { provider: 'CODYA', mena: 'CZK', investovanoCZK: 0, aktualHodnotaCZK: 5e5, nakupDatum: '', aktualNAVdatum: '31.12.2025' },
  ]);
  assert.equal(fl.length, 3);
  assert.equal(fl[2].amount, 2.1e6);
  near(xirr(fl), 0.10, 2e-3);
});

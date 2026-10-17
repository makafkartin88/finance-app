import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConseq, buildFundRow, planAutoImport, detectStatement } from '../js/inv-parse.js';
import { FOND } from '../js/config.js';

// Struktura řádků odpovídá reálnému výpisu CONSEQ (pdf.js, seskupení dle Y),
// čísla a hlavička jsou vymyšlené — repo je veřejné, žádná osobní data.
const CONSEQ_2_FUNDS = [
  'Výpis z investičního účtu',
  'Celková hodnota portfolia k datu 30.09.2026: 300 001,00 CZK',
  'Zhodnocení portfolia za období od 01.07.2026 do 30.09.2026 1,25%',
  'Stav investičního účtu k datu 30.09.2026',
  'Investiční nástroj',
  'Datum ceny Cena / ks Tržní hodnota celkem Směnný Tržní hodnota',
  'ISIN Počet AÚV / ks v měně inv. nástroje kurz v základní měně',
  'Alfa Industrial fond fondů, OPF 30.06.2026 2,0000 CZK/CZK',
  'hgd (CZK) 50 000 100 000,00 CZK 1,0000 100 000,00 CZK',
  'CZ0008475936 Cenný papír kol. invest.',
  'Beta Logistics 30.06.2026 1,0000 CZK/CZK',
  'Development 1 (CZK) 200 001 200 001,00 CZK 1,0000 200 001,00 CZK',
  'CZ1005100618 Cenný papír kol. invest.',
  'Nemovitostní investice celkem: 300 001,00 CZK',
  'Peněžní zůstatky celkem: -0,62 CZK',
  'Účet CZK Počáteční zůstatek: 101 000,13 CZK',
  '24.08.2026 AlfaFFCZK, Nákup 102292287 97382881 Dr. -100 000,00 CZK',
  '24.08.2026 AlfaFFCZK, Vstupní poplatek 102292287 99999999 Dr. -1 000,00 CZK',
  'Konečný zůstatek: -0,62 CZK',
  'Přehled pohybů na majetkovém účtu za období od 01.07.2026 do 30.09.2026',
  'Alfa Industrial fond fondů, OPF 50 000 100 000,00 CZK 1,0000 1 000,00 CZK 30.06.2026',
  'hgd (CZK)',
  'CZ0008475936 Nákup 2,0000 0,00 CZK 100 000,00 CZK 101 000,00 CZK 24.08.2026',
];

const CONSEQ_EUR_FUND = [
  'Stav investičního účtu k datu 31.12.2026',
  'Gama fond EUR 31.12.2026 1,5000 EUR/CZK',
  '(EUR) 1 000 1 500,00 EUR 25,0000 37 500,00 CZK',
  'CZ0008476355 Cenný papír kol. invest.',
  'Konečný zůstatek: 2 500,50 CZK',
];

const byIsin = (funds, isin) => funds.find(f => f.isin === isin);

test('parseConseq: všechny fondy z výpisu, každý se svým počtem kusů a NAV', () => {
  const funds = parseConseq(CONSEQ_2_FUNDS);
  assert.deepEqual(funds.map(f => f.isin), ['CZ0008475936', 'CZ1005100618']);
  const a = byIsin(funds, 'CZ0008475936');
  assert.equal(a.pocetCP, 50000);
  assert.equal(a.aktualNAV, 2);
  assert.equal(a.aktualNAVdatum, '30.6.2026');
  assert.equal(a.mena, 'CZK');
  assert.match(a.nazev, /^Alfa Industrial fond fondů, OPF hgd \(CZK\)$/);
  const b = byIsin(funds, 'CZ1005100618');
  assert.equal(b.pocetCP, 200001);
  assert.equal(b.aktualNAV, 1);
  assert.match(b.nazev, /^Beta Logistics Development 1 \(CZK\)$/);
});

test('parseConseq: nákup jen u fondu, který ho ve výpisu má (částka vč. poplatku)', () => {
  const funds = parseConseq(CONSEQ_2_FUNDS);
  const a = byIsin(funds, 'CZ0008475936');
  assert.equal(a.nakupNAV, 2);
  assert.equal(a.nakupDatum, '24.8.2026');
  assert.equal(a.castka, 101000);
  assert.equal(a.poplatek, 1000);
  const b = byIsin(funds, 'CZ1005100618');
  assert.equal(b.nakupNAV, 0);
  assert.equal(b.castka, 0);
});

test('parseConseq: hotovost jen jednou (první fond), záporný zbytek = 0, ostatním 0', () => {
  const funds = parseConseq(CONSEQ_2_FUNDS);
  assert.equal(funds[0].hotovostCZK, 0);
  assert.equal(funds[1].hotovostCZK, 0);
  const eur = parseConseq(CONSEQ_EUR_FUND);
  assert.equal(eur[0].hotovostCZK, 2500.5);
});

test('parseConseq: fond v EUR — měna, kurz, počet z hodnoty v měně nástroje', () => {
  const [g] = parseConseq(CONSEQ_EUR_FUND);
  assert.equal(g.isin, 'CZ0008476355');
  assert.equal(g.mena, 'EUR');
  assert.equal(g.kurzEUR, 25);
  assert.equal(g.pocetCP, 1000);
  assert.equal(g.aktualNAV, 1.5);
});

test('parseConseq: datum výpisu', () => {
  assert.equal(parseConseq(CONSEQ_2_FUNDS)[0]._statementDate, '30.9.2026');
});

test('buildFundRow: hotovost 0 se zapíše jako 0 (ne prázdno), chybějící zůstane prázdná', () => {
  const base = { provider: 'CONSEQ', isin: 'CZ1005100618', nazev: 'X', mena: 'CZK', pocetCP: 10, aktualNAV: 2, aktualNAVdatum: '30.6.2026' };
  assert.equal(buildFundRow({ ...base, hotovostCZK: 0 })[FOND.hotovostCZK], 0);
  assert.equal(buildFundRow({ ...base })[FOND.hotovostCZK], '');
  assert.equal(buildFundRow({ ...base, hotovostCZK: 1500 })[FOND.hotovostCZK], 1500);
});

test('buildFundRow: investováno ze skutečné částky, hodnota z počtu × NAV × kurz', () => {
  const r = buildFundRow({ provider: 'CODYA', isin: 'CZ0008051711', nazev: 'E', mena: 'EUR', pocetCP: 100, nakupNAV: 1, aktualNAV: 1.2, kurzEUR: 25, castka: 101 });
  assert.equal(r[FOND.investovanoCZK], 2525);
  assert.equal(r[FOND.aktualHodnotaCZK], 3000);
  assert.equal(r[FOND.kurzEUR], 25);
  const n = buildFundRow({ provider: 'UNICREDIT', isin: 'LU1', nazev: 'U', mena: 'CZK', pocetCP: 2, aktualNAV: 10 });
  assert.equal(n[FOND.investovanoCZK], '');
  assert.equal(n[FOND.nakupNAV], '');
});

// ── Automatický import: pojistky ──
const have = (o) => ({ provider: 'CONSEQ', isin: 'CZ1005100618', mena: 'CZK', pocetCP: 100, nakupNAV: 1, aktualNAV: 1, aktualNAVdatum: '30.6.2026', ...o });
const got = (o) => ({ provider: 'CONSEQ', isin: 'CZ1005100618', nazev: 'B', mena: 'CZK', pocetCP: 100, nakupNAV: 0, aktualNAV: 1.1, aktualNAVdatum: '30.9.2026', ...o });

test('planAutoImport: běžný výpis projde a vrátí řádky', () => {
  const p = planAutoImport([got()], 'CONSEQ', 'holdings', [have()]);
  assert.equal(p.ok, true);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0][FOND.aktualNAV], 1.1);
});

test('planAutoImport: nový fond se přidá', () => {
  const p = planAutoImport([got(), got({ isin: 'CZ0008475936', pocetCP: 50 })], 'CONSEQ', 'holdings', [have()]);
  assert.equal(p.ok, true);
  assert.equal(p.rows.length, 2);
});

test('planAutoImport: zmizelý známý fond → ruční kontrola', () => {
  const p = planAutoImport([got()], 'CONSEQ', 'holdings', [have(), have({ isin: 'CZ0008475936' })]);
  assert.equal(p.ok, false);
  assert.match(p.reason, /CZ0008475936/);
});

test('planAutoImport: u výpisu transakcí se zmizelé fondy nehlídají', () => {
  const p = planAutoImport([got({ nakupNAV: 1 })], 'CODYA', 'transactions', [have({ provider: 'CODYA' }), have({ provider: 'CODYA', isin: 'CZ0008042892' })].map(x => x), );
  assert.equal(p.ok, true);
});

test('planAutoImport: nulový počet nebo kurz → ruční kontrola', () => {
  assert.equal(planAutoImport([got({ pocetCP: 0 })], 'CONSEQ', 'holdings', []).ok, false);
  assert.equal(planAutoImport([got({ aktualNAV: 0 })], 'CONSEQ', 'holdings', []).ok, false);
  assert.equal(planAutoImport([], 'CONSEQ', 'holdings', []).ok, false);
});

test('planAutoImport: skok hodnoty fondu o víc než 50 % → ruční kontrola', () => {
  assert.equal(planAutoImport([got({ pocetCP: 200, aktualNAV: 1 })], 'CONSEQ', 'holdings', [have()]).ok, false);
  assert.equal(planAutoImport([got({ pocetCP: 140, aktualNAV: 1 })], 'CONSEQ', 'holdings', [have()]).ok, true);
});

test('planAutoImport: dokoupení známého fondu za jinou cenu → ruční kontrola', () => {
  assert.equal(planAutoImport([got({ nakupNAV: 1.5 })], 'CONSEQ', 'holdings', [have({ nakupNAV: 1 })]).ok, false);
  assert.equal(planAutoImport([got({ nakupNAV: 1 })], 'CONSEQ', 'holdings', [have({ nakupNAV: 1 })]).ok, true);
});

test('planAutoImport: starší kurz z výpisu nepřepíše novější stažený', () => {
  const p = planAutoImport([got({ aktualNAV: 1.05, aktualNAVdatum: '30.6.2026', pocetCP: 110 })], 'CONSEQ', 'holdings',
    [have({ aktualNAV: 1.2, aktualNAVdatum: '2026-08-31T22:00:00.000Z' })]);
  assert.equal(p.ok, true);
  assert.equal(p.rows[0][FOND.aktualNAV], 1.2);
  assert.equal(p.rows[0][FOND.aktualHodnotaCZK], 132);
  assert.equal(p.rows[0][FOND.pocetCP], 110);
});

test('planAutoImport: fondy jiného poskytovatele se neporovnávají', () => {
  const p = planAutoImport([got()], 'CONSEQ', 'holdings', [have(), have({ provider: 'UNICREDIT', isin: 'LU1' })]);
  assert.equal(p.ok, true);
});

test('detectStatement: rozpozná typ výpisu, jinak null', () => {
  assert.deepEqual(detectStatement(['VÝPIS Z MAJETKOVÉHO ÚČTU', 'CODYA investiční společnost']).kind, ['CODYA', 'holdings']);
  assert.deepEqual(detectStatement(['VÝPIS TRANSAKCÍ', 'CODYA']).kind, ['CODYA', 'transactions']);
  assert.deepEqual(detectStatement(['UniCredit Bank', 'Výpis z majetkového účtu cenných papírů k 30.09.2026']).kind, ['UNICREDIT', 'holdings']);
  assert.deepEqual(detectStatement(['Výpis z investičního účtu', 'www.conseq.cz']).kind, ['CONSEQ', 'holdings']);
  assert.equal(detectStatement(['Conseq newsletter', 'Novinky na trzích']), null);
});

test('planAutoImport: EUR fond bez kurzu ve výpisu převezme uložený kurz (ne záložních 25)', () => {
  const p = planAutoImport([got({ mena: 'EUR', kurzEUR: undefined, pocetCP: 100, aktualNAV: 1 })], 'CONSEQ', 'holdings',
    [have({ mena: 'EUR', kurzEUR: 24.3 })]);
  assert.equal(p.rows[0][FOND.kurzEUR], 24.3);
  assert.equal(p.rows[0][FOND.aktualHodnotaCZK], 2430);
});

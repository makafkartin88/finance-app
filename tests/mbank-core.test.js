import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, normAccount, isSavingsTransfer, matchDuplicates } from '../js/mbank-core.js';

test('guessCategory: odchozí „platba" už není kategorie Příjem', () => {
  assert.equal(guessCategory('Odchozí platba', 'Někdo', 'Výdaj'), 'Ostatní');
  assert.equal(guessCategory('Odchozí platba', 'Tesco Stores', 'Výdaj'), 'Jídlo');
  assert.equal(guessCategory('Příchozí platba', 'Zaměstnavatel', 'Příjem'), 'Příjem');
  assert.equal(guessCategory('Odchozí platba', 'Platinum fitness', 'Výdaj'), 'Ostatní');
});

test('normAccount: s předčíslím i bez, nuly na začátku', () => {
  assert.equal(normAccount('000000-1111111111/3030'), '1111111111/3030');
  assert.equal(normAccount('670100-0012345678/6210'), '670100-12345678/6210');
  assert.equal(normAccount('nic'), '');
});

test('isSavingsTransfer: spořicí účet v obou směrech, jiný účet ne', () => {
  const sav = '670100-1234567890/6210';
  assert.equal(isSavingsTransfer('670100-1234567890/6210', sav), true);
  assert.equal(isSavingsTransfer('670100-0001234567890/6210'.replace('000', ''), sav), true);
  assert.equal(isSavingsTransfer('2222222222/3030', sav), false);
  assert.equal(isSavingsTransfer('', sav), false);
  assert.equal(isSavingsTransfer('670100-1234567890/6210', ''), false);
});

test('matchDuplicates: dvě stejné kávy proti jedné ručně zadané → jen jedna je duplicita', () => {
  const existing = [{ id: 'm1', typ: 'Výdaj', castka: 89, datum: '10/5/2026' }];
  const rows = [{ datum: '2026-10-05', castka: 89, typ: 'Výdaj' }, { datum: '2026-10-05', castka: 89, typ: 'Výdaj' }];
  const res = matchDuplicates(rows, existing);
  assert.equal(res.filter(Boolean).length, 1);
});

test('matchDuplicates: tolerance ±2 % a ±2 dny, vybere nejbližší shodu', () => {
  const existing = [{ id: 'a', typ: 'Výdaj', castka: 1000, datum: '10/1/2026' }, { id: 'b', typ: 'Výdaj', castka: 990, datum: '10/2/2026' }];
  const [m] = matchDuplicates([{ datum: '2026-10-02', castka: 989.5, typ: 'Výdaj' }], existing);
  assert.equal(m.id, 'b');
  assert.equal(matchDuplicates([{ datum: '2026-10-01', castka: 950, typ: 'Výdaj' }], existing)[0], null);
  assert.equal(matchDuplicates([{ datum: '2026-10-09', castka: 1000, typ: 'Výdaj' }], existing)[0], null);
  assert.equal(matchDuplicates([{ datum: '2026-10-01', castka: 1000, typ: 'Příjem' }], existing)[0], null);
});

test('guessCategory: věci pro psa → Pejsek (ne lékárna/zdraví lidí)', () => {
  for (const [popis, proti] of [
    ['ZVEROKRUH KLADNO OC KLADNO', 'ZVEROKRUH KLADNO OC KLADNO'],
    ['Platba kartou', 'YOGIS SHOP Praha'],
    ['286 - SUPER ZOO Praha 6', ''],
    ['PetCenter 515 Praha 6', ''],
    ['VET KLINIKA CERVENY PRAHA 6', ''],
    ['VETAPSO SRO HOSTIVICE', ''],
    ['Vinduska Filip - Chovatel Kladno', ''],
    ['ODCHOZÍ OKAMŽITÁ PLATBA', 'GOPAY CZECH WOOFIT.CZ'],
    ['ODCHOZÍ OKAMŽITÁ PLATBA', 'INDY GRANULE A JOGURT'],
  ]) assert.equal(guessCategory(popis, proti, 'Výdaj'), 'Pejsek', popis + ' ' + proti);
  assert.equal(guessCategory('BENU LEKARNA 172', '', 'Výdaj'), 'Zdraví');
  assert.equal(guessCategory('Sladka dilna Petriny', '', 'Výdaj'), 'Ostatní'); // „pet" uvnitř slova
});

test('guessCategory: obchody a služby z reálných výpisů (bez diakritiky, velkými)', () => {
  const cases = {
    'KFC EVROPSKA PRAHA 6': 'Zábava', 'ASIA BOX PRAHA 5 - SMI': 'Zábava', 'TASTY DONER KEBAB PRAHA': 'Zábava',
    'ENTREE RESTAURANT CZK OLOMOUC': 'Zábava', 'BAGETERIE BOULEVARD PLZEN': 'Zábava', 'DELISH BURGER PLZEN': 'Zábava',
    'One Padel s.r.o. Praha': 'Zábava', 'PALA VIZNER TENNIS PRAHA': 'Zábava', 'CG *ticketportal.cz Praha 1': 'Zábava', 'NFCTRON PRAHA': 'Zábava',
    'USTAVNI LEKARNA KLADNO': 'Zdraví', 'OCKOVACI CENTRUM Praha 6': 'Zdraví',
    'JYSK T21 VAM DEKUJE PRAHA': 'Bydlení', 'PEPCO 130087 KLADNO': 'Bydlení', 'TEDI 4512 KLADNO': 'Bydlení',
    'MOEBELIX CESKO CESTLICE': 'Bydlení', 'XXX LUTZ PR 5 PRAHA': 'Bydlení', 'BONAMI.CZ PRAHA 7': 'Bydlení',
    'PC TESCOMA PRAHA BOR': 'Bydlení', 'DATART PRAHA 6 RUZYN': 'Bydlení',
    'parkoviste OC Sestka Praha': 'Doprava', 'AUTOPARK D1 OSTROVACICE': 'Doprava',
    'DM DROGERIE MARKT 1234 KLADNO': 'Jídlo', 'Tesco Praha Novy Smich': 'Jídlo',
  };
  for (const [text, cat] of Object.entries(cases)) assert.equal(guessCategory(text, text, 'Výdaj'), cat, text);
});

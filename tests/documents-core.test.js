import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOK, DOC_MAX_BYTES, VISIBILITY, normText, escHtml, stripExt, docType,
  parseDocRow, visibleDocs, filterDocs, folderCounts, canonicalFolder, validateUpload
} from '../js/documents-core.js';

const row = (o) => {
  const r = new Array(10).fill('');
  for (const [k, v] of Object.entries(o)) r[DOK[k]] = v;
  return r;
};
const doc = (o) => parseDocRow(row({ id: 'd1', nazev: 'X', ...o }));

test('normText: lowercase, bez diakritiky, trim, zhuštěné mezery', () => {
  assert.equal(normText('  Smlouva  na   PSA Ája '), 'smlouva na psa aja');
  assert.equal(normText(null), '');
  assert.equal(normText(123), '123');
});

test('escHtml escapuje HTML znaky', () => {
  assert.equal(escHtml('<Ája> & "co" \'x\''), '&lt;Ája&gt; &amp; &quot;co&quot; &#39;x&#39;');
  assert.equal(escHtml(undefined), '');
});

test('stripExt odstraní jen poslední příponu', () => {
  assert.equal(stripExt('Smlouva – pes.pdf'), 'Smlouva – pes');
  assert.equal(stripExt('foto.2026.JPG'), 'foto.2026');
  assert.equal(stripExt('bezpripony'), 'bezpripony');
  assert.equal(stripExt('.skryty'), '.skryty');
});

test('docType rozliší PDF a obrázek', () => {
  assert.equal(docType('application/pdf'), 'pdf');
  assert.equal(docType('image/jpeg'), 'image');
  assert.equal(docType(''), 'image');
});

test('parseDocRow: hlavička a řádek bez id → null', () => {
  assert.equal(parseDocRow(['id', 'nazev', 'slozka']), null);
  assert.equal(parseDocRow(row({ nazev: 'bez id' })), null);
  assert.equal(parseDocRow(null), null);
});

test('parseDocRow: neznámá/prázdná viditelnost = Oba, velikost číslo', () => {
  const d = parseDocRow(row({ id: 'd1', nazev: 'A', slozka: ' Pes ', viditelnost: '', velikost: '1024' }));
  assert.equal(d.viditelnost, 'Oba');
  assert.equal(d.slozka, 'Pes');
  assert.equal(d.velikost, 1024);
  assert.equal(parseDocRow(row({ id: 'd2', viditelnost: 'Nikdo' })).viditelnost, 'Oba');
  assert.equal(parseDocRow(row({ id: 'd3', viditelnost: 'Šárka' })).viditelnost, 'Šárka');
});

test('parseDocRow: UTC timestamp ze Sheets → lokální datum, text beze změny', () => {
  const iso = new Date(2026, 9, 8).toISOString(); // lokální půlnoc 8. 10. v UTC zápisu
  assert.equal(parseDocRow(row({ id: 'x', datum: iso })).datum, '2026-10-08');
  assert.equal(parseDocRow(row({ id: 'y', datum: '2026-10-08' })).datum, '2026-10-08');
});

test('visibleDocs: Oba vidí všichni, osobní jen vlastník, bez přihlášení vše', () => {
  const docs = [doc({ id: 'a', viditelnost: 'Oba' }), doc({ id: 'm', viditelnost: 'Martin' }), doc({ id: 's', viditelnost: 'Šárka' })];
  assert.deepEqual(visibleDocs(docs, 'Martin').map(d => d.id), ['a', 'm']);
  assert.deepEqual(visibleDocs(docs, 'Šárka').map(d => d.id), ['a', 's']);
  assert.deepEqual(visibleDocs(docs, null).map(d => d.id), ['a', 'm', 's']);
});

test('filterDocs: dotaz bez diakritiky a velikosti písmen, i ve složce, AND se složkou', () => {
  const docs = [
    doc({ id: '1', nazev: 'Smlouva – očkování', slozka: 'Pes' }),
    doc({ id: '2', nazev: 'Technický průkaz', slozka: 'Auto' }),
    doc({ id: '3', nazev: 'Smlouva nájem', slozka: '' }),
  ];
  assert.deepEqual(filterDocs(docs, 'SMLOUVA', null).map(d => d.id), ['1', '3']);
  assert.deepEqual(filterDocs(docs, 'ockov', null).map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, 'pes', null).map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, 'smlouva', 'Pes').map(d => d.id), ['1']);
  assert.deepEqual(filterDocs(docs, '', 'Auto').map(d => d.id), ['2']);
  assert.deepEqual(filterDocs(docs, '', '').map(d => d.id), ['3']);
  assert.deepEqual(filterDocs(docs, '   ', null).map(d => d.id), ['1', '2', '3']);
});

test('folderCounts: počty, české řazení, bez složky poslední', () => {
  const docs = [doc({ id: '1', slozka: 'Pes' }), doc({ id: '2', slozka: 'Auto' }), doc({ id: '3', slozka: 'Pes' }), doc({ id: '4', slozka: '' }), doc({ id: '5', slozka: 'Čerpadlo' })];
  assert.deepEqual(folderCounts(docs), [
    { name: 'Auto', count: 1 }, { name: 'Čerpadlo', count: 1 }, { name: 'Pes', count: 2 }, { name: '', count: 1 }
  ]);
});

test('canonicalFolder: znovupoužije existující zápis, jinak ořízne', () => {
  const existing = ['Pes', 'Ája', 'Auto'];
  assert.equal(canonicalFolder('pes', existing), 'Pes');
  assert.equal(canonicalFolder('  PES  ', existing), 'Pes');
  assert.equal(canonicalFolder('aja', existing), 'Ája');
  assert.equal(canonicalFolder('  Nová   složka ', existing), 'Nová složka');
  assert.equal(canonicalFolder('   ', existing), '');
});

test('validateUpload: velikost, typ, prázdný soubor', () => {
  assert.equal(validateUpload({ name: 'a.pdf', size: 1000, type: 'application/pdf' }), null);
  assert.equal(validateUpload({ name: 'a.jpg', size: 1000, type: 'image/jpeg' }), null);
  assert.match(validateUpload({ name: 'a.pdf', size: DOC_MAX_BYTES + 1, type: 'application/pdf' }), /20 MB/);
  assert.match(validateUpload({ name: 'a.docx', size: 1000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), /PDF nebo obrázek/);
  assert.match(validateUpload({ name: 'a', size: 1000, type: '' }), /PDF nebo obrázek/);
  assert.match(validateUpload({ name: 'a.pdf', size: 0, type: 'application/pdf' }), /prázdný/);
});

test('VISIBILITY konstanta', () => {
  assert.deepEqual(VISIBILITY, ['Oba', 'Martin', 'Šárka']);
});

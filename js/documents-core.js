// Čistá logika sekce Dokumenty — bez DOM a bez sítě, ať jde testovat
// přes `node --test`. UI a volání GAS jsou v documents.js.

export const DOK = { id: 0, nazev: 1, slozka: 2, viditelnost: 3, url: 4, fileId: 5, typ: 6, velikost: 7, nahral: 8, datum: 9 };
export const DOC_MAX_BYTES = 20 * 1024 * 1024;
export const VISIBILITY = ['Oba', 'Martin', 'Šárka'];

export function normText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Hodnota jako argument inline handleru: onclick="fn(${jsArg(x)})".
// Samotné escHtml nestačí — prohlížeč entity v atributu dekóduje dřív, než
// JS běží, takže '&#39;' by z řetězce zase vyskočilo.
export function jsArg(s) {
  return escHtml(JSON.stringify(String(s ?? '')));
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function docType(mime) {
  return mime === 'application/pdf' ? 'pdf' : 'image';
}

// Sheets občas vrátí datum jako ISO timestamp v UTC (pokud si buňku převedl
// na Date) → převést na LOKÁLNÍ yyyy-mm-dd, jinak by se den posunul.
function normDate(v) {
  const s = String(v || '');
  if (!s.includes('T')) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('sv-SE');
}

export function parseDocRow(r) {
  if (!Array.isArray(r) || !r[DOK.id] || r[DOK.id] === 'id') return null;
  const vis = String(r[DOK.viditelnost] || '');
  return {
    id: String(r[DOK.id]),
    nazev: String(r[DOK.nazev] || ''),
    slozka: String(r[DOK.slozka] || '').trim(),
    viditelnost: VISIBILITY.includes(vis) ? vis : 'Oba',
    // List jde zapsat i mimo appku (GAS bez auth) → do href pustit jen https.
    url: /^https:\/\//i.test(String(r[DOK.url] || '')) ? String(r[DOK.url]) : '',
    fileId: String(r[DOK.fileId] || ''),
    typ: String(r[DOK.typ] || 'pdf'),
    velikost: Number(r[DOK.velikost]) || 0,
    nahral: String(r[DOK.nahral] || ''),
    datum: normDate(r[DOK.datum]),
  };
}

// person === null → appka běží bez přihlášení (lokální vývoj) → vše.
export function visibleDocs(docs, person) {
  if (!person) return docs.slice();
  return docs.filter(d => d.viditelnost === 'Oba' || d.viditelnost === person);
}

export function filterDocs(docs, query, folder) {
  const q = normText(query);
  return docs.filter(d =>
    (folder === null || d.slozka === folder) &&
    (!q || normText(d.nazev).includes(q) || normText(d.slozka).includes(q)));
}

export function folderCounts(docs) {
  const m = new Map();
  for (const d of docs) m.set(d.slozka, (m.get(d.slozka) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === '') - (b.name === '') || a.name.localeCompare(b.name, 'cs'));
}

// Návrhy složek v modalu jen z toho, co člověk vidí — jinak by názvy
// soukromých složek druhého prosákly přes našeptávač.
export function folderSuggestions(docs, person) {
  return folderCounts(visibleDocs(docs, person)).map(f => f.name).filter(Boolean);
}

// Odpověď listu → { docs, error }. Chybějící list = zatím nic nenahráno
// (OK); jakákoli jiná chyba = načtení selhalo a nesmí vypadat jako prázdno.
export function docsFromSheet(res) {
  if (res && Array.isArray(res.values)) return { docs: res.values.map(parseDocRow).filter(Boolean), error: false };
  if (res && /neexistuje/.test(String(res.error))) return { docs: [], error: false };
  return { docs: [], error: true };
}

// „pes" / „Pes " / „PES" → stávající „Pes", ať nevznikají duplicitní složky.
export function canonicalFolder(input, existing) {
  const clean = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const hit = existing.find(f => normText(f) === normText(clean));
  return hit ?? clean;
}

export function validateUpload(file) {
  if (!file.size) return 'Soubor je prázdný.';
  if (!(file.type === 'application/pdf' || String(file.type).startsWith('image/')))
    return 'Nahrát jde jen PDF nebo obrázek.';
  if (file.size > DOC_MAX_BYTES) return 'Soubor je větší než 20 MB — zmenši ho nebo rozděl.';
  return null;
}

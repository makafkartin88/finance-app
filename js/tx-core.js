// Čistá logika transakcí a opakovaných plateb — bez DOM a sítě (npm test).

// Unikátní id: čitelné datum + 8 náhodných hex znaků. Dřív se bralo
// `state.txs.length + 1`, takže po smazání nebo souběhu dvou zařízení vznikla
// stejná id a mazání podle id pak mohlo smazat JINÝ řádek.
export function newId(y, m, d, prefix = '') {
  const rnd = (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2) + Date.now().toString(16))
    .replace(/-/g, '').slice(0, 8);
  return `${y}${m}${d}-${prefix}${rnd}`;
}

// Šablona opakované platby → řádek listu Recurring (pořadí = parseRecRow).
export function recRow(rec) {
  return [rec.id, rec.popis, rec.castka, rec.typ, rec.kategorie, rec.osoba, rec.ucet, rec.metoda,
    rec.protistrana, 'monthly', rec.den, rec.aktivni ? 'TRUE' : 'FALSE', rec.posledniGen || '',
    rec.bilance ? 'TRUE' : 'FALSE'];
}

// Měsíc 'YYYY-MM' z buňky — Sheets si text '2026-10' umí převést na datum,
// které pak přijde jako ISO čas v UTC (půlnoc v Praze = předchozí den).
export function normMonth(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d)) return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }).slice(0, 7);
  }
  return s.slice(0, 7);
}

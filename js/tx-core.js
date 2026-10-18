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

/* Souhrn za období — jedna definice pro Přehled i Grafy:
   - spotřeba (spending) = výdaje mimo kategorii Investice
   - investováno = výdaje v kategorii Investice
   - úspora = příjem − spotřeba (investice jsou úspora, ne útrata)
   - volné peníze (cashLeft) = úspora − investováno
   Vyrovnání mezi Martinem a Šárkou se nepočítá do ničeho. */
export function summarize(txs) {
  let income = 0, spending = 0, invested = 0;
  for (const t of txs) {
    if (t.typ === 'Příjem') income += t.castka;
    else if (t.typ === 'Výdaj') { if (t.kategorie === 'Investice') invested += t.castka; else spending += t.castka; }
  }
  const savings = income - spending;
  return { income, spending, invested, savings, cashLeft: savings - invested, savingsRate: income > 0 ? savings / income : 0 };
}

// Měsíce do průměru — bez právě běžícího měsíce (ještě neúplný), pokud
// jsou k dispozici i jiné.
export function completedMonths(months, currentMonth) {
  const done = months.filter(m => m !== currentMonth);
  return done.length ? done : months;
}

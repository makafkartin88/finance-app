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

/* Měsíce, které jdou do průměrů. Výpis z banky za měsíc chodí až v dalším
   měsíci, takže měsíc bez importovaného výpisu je neúplný a průměr by
   „ponižoval". Uzavřené = do měsíce posledního importu z mBank (id s „-mb"),
   nikdy ne právě běžící měsíc. Bez importů aspoň bez běžícího měsíce. */
export function closedMonths(months, txs, currentMonth) {
  let last = -1;
  for (const t of txs) {
    if (!/-mb/.test(String(t.id || ''))) continue;
    const i = months.indexOf(t.mesic);
    if (i > last) last = i;
  }
  const upto = last >= 0 ? months.slice(0, last + 1) : months;
  return completedMonths(upto, currentMonth);
}

/* Průměrná měsíční útrata po kategoriích.
   - kategorie se průměruje od měsíce, kdy se poprvé objevila (pes koupený
     v říjnu nemá mít průměr rozředěný měsíci, kdy ještě nebyl),
   - jen uzavřené měsíce (closedMonths),
   - bez jednorázových výdajů (`jednorazova`) — ty jsou dál vidět v součtech
     a filtrech, jen nezkreslují „běžný měsíc". */
export function categoryAverages(expenses, months, closed) {
  const closedSet = new Set(closed);
  const first = {}, sum = {};
  let overallSum = 0;
  for (const t of expenses) {
    const i = months.indexOf(t.mesic);
    if (i < 0) continue;
    if (first[t.kategorie] === undefined || i < first[t.kategorie]) first[t.kategorie] = i;
    if (closedSet.has(t.mesic) && !t.jednorazova) {
      sum[t.kategorie] = (sum[t.kategorie] || 0) + t.castka;
      overallSum += t.castka;
    }
  }
  const cats = Object.keys(first).map(cat => {
    const n = closed.filter(m => months.indexOf(m) >= first[cat]).length;
    return { cat, avg: n ? (sum[cat] || 0) / n : 0, months: n };
  }).sort((a, b) => b.avg - a.avg);
  return { cats, overall: closed.length ? overallSum / closed.length : 0, monthsUsed: closed.length };
}

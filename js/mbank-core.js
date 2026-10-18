// Čistá logika importu z mBank (bez DOM a pdf.js) — testovaná přes npm test.

export const ACCT_RE = /(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})/;

// Číslo účtu v libovolném zápisu → jednotný tvar ("000000-123/3030" = "123/3030").
export function normAccount(s) {
  const m = String(s || '').replace(/\s/g, '').match(ACCT_RE);
  if (!m) return '';
  const pre = m[1] ? String(parseInt(m[1], 10)) : '0';
  return (pre === '0' ? '' : pre + '-') + String(parseInt(m[2], 10)) + '/' + m[3];
}

// Převod na/ze spořicího účtu (nastavení „Spořicí účet") není příjem ani
// výdaj — přesun mezi vlastními účty. Dřív se vylučoval jen příchozí směr,
// takže odeslání na spoření se počítalo jako útrata.
export function isSavingsTransfer(cpAccount, savingsAccount) {
  const a = normAccount(cpAccount), b = normAccount(savingsAccount);
  return !!a && !!b && a === b;
}

// Kategorie podle popisu a protistrany. „Příjem" jen u příjmu — dřív
// pravidlo /plat/ chytalo každou „Odchozí platbu" a výdaj skončil
// v kategorii Příjem.
export function guessCategory(popis, protistrana, typ) {
  if (typ === 'Příjem') return 'Příjem';
  const text = (popis + ' ' + protistrana).toLowerCase();
  if (/nájem|nájemné|hypotéka|elektřina|plyn|voda|internet|ikea|obi|hornbach|sconto|action b/.test(text)) return 'Bydlení';
  if (/albert|billa|lidl|kaufland|tesco|penny|globus|rohlík|košík|potraviny|rossmann/.test(text)) return 'Jídlo';
  if (/shell|benzín|čerpací|parkoviště|parking|dpp|pid|lítačka|vlak|bus/.test(text)) return 'Doprava';
  if (/kino|cinema|spotify|netflix|steam|xbox|restaurace|hospoda|kavárna|pho |sushi|pizz/.test(text)) return 'Zábava';
  if (/lékárna|doktor|nemocnice|pojišt|zdraví/.test(text)) return 'Zdraví';
  if (/trading 212|degiro|fond|etf|akcie|investic/.test(text)) return 'Investice';
  return 'Ostatní';
}

// 'YYYY-MM-DD' i 'M/D/YYYY' (formát listu Transakce) → číslo dne (UTC, bez DST).
function dayNum(s) {
  const t = String(s || '');
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]) / 864e5;
  return NaN;
}

/* Duplicity řádků výpisu proti už uloženým transakcím.
   Párování 1 : 1 — každá uložená transakce „zablokuje" nejvýš jeden řádek
   výpisu (dřív dvě stejné kávy proti jedné ručně zadané obě zmizely).
   Shoda = stejný typ, ±2 dny, částka ±2 % (ruční zápis bývá zaokrouhlený);
   vybírá se nejbližší kandidát. Vrací pole stejné délky jako `rows`
   (nalezená transakce nebo null). */
export function matchDuplicates(rows, existing) {
  const used = new Set();
  return rows.map(r => {
    const d = dayNum(r.datum);
    let best = null, bestScore = Infinity;
    for (const t of existing) {
      if (used.has(t) || t.typ !== r.typ) continue;
      const dd = Math.abs(dayNum(t.datum) - d);
      const da = Math.abs(t.castka - r.castka) / Math.max(r.castka, 0.01);
      if (!(dd <= 2) || da > 0.02) continue;
      const score = dd + da * 100;
      if (score < bestScore) { best = t; bestScore = score; }
    }
    if (best) used.add(best);
    return best;
  });
}

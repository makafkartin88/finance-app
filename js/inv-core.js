// Čistá matematika investic — bez DOM a sítě (npm test).

export const DEFAULT_EUR = 25; // záložní EUR/CZK, když kurz nikde není

// "D.M.YYYY", "D.M.YYYY HH:mm", "YYYY-MM-DD" nebo ISO čas → Date (půlnoc), jinak null.
export function toDate(v) {
  const s = String(v || '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && !s.includes('T')) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (s.includes('T')) {
    const d = new Date(s);
    if (isNaN(d)) return null;
    const iso = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
    m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  m = s.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

const DAY = 864e5;
const daysBetween = (a, b) => Math.round((b - a) / DAY);

// Kurz měny fondu ke koruně. Dřív platilo „EUR → kurz, cokoli jiného → 1",
// takže fond v USD (UniCredit) se počítal, jako by byl v korunách.
// 0 = kurz neznámý → hodnotu v Kč nelze spočítat (raději nic než špatně).
export function fxOf(f) {
  if (!f.mena || f.mena === 'CZK') return 1;
  if (f.kurzEUR > 0) return f.kurzEUR;
  return f.mena === 'EUR' ? DEFAULT_EUR : 0;
}

export const invCZK = f => f.provider === 'T212' ? (f.investovanoCZK || 0)
  : (f.investovanoCZK || Math.round(f.pocetCP * f.nakupNAV * fxOf(f)));
export const curCZK = f => f.provider === 'T212' ? (f.aktualHodnotaCZK || 0)
  : (f.aktualHodnotaCZK || Math.round(f.pocetCP * f.aktualNAV * fxOf(f)));

/* Součty za poskytovatele. Fond bez nákupní ceny (UniCredit výpis ji
   neuvádí) se do zisku NEPOČÍTÁ — jinak by celá jeho hodnota vypadala jako
   výnos, a naopak kdyby jediný takový fond shodil zisk všech ostatních na „—". */
export function providerTotals(funds) {
  let invested = 0, costedCurrent = 0, uncostedCurrent = 0, cash = 0, uncosted = 0;
  for (const f of funds) {
    const inv = invCZK(f), cur = curCZK(f);
    cash += f.hotovostCZK || 0;
    if (inv > 0) { invested += inv; costedCurrent += cur; }
    else { uncostedCurrent += cur; uncosted++; }
  }
  const gain = costedCurrent - invested;
  return {
    invested, costedCurrent, uncostedCurrent, uncosted, cash, gain,
    current: costedCurrent + uncostedCurrent,
    gainPct: invested > 0 ? gain / invested * 100 : null
  };
}

// Výnos za období → % p.a. Pod rok se nevrací nic: +3 % za 45 dní
// „extrapolováno" na 27 % p.a. je číslo, které nic neříká.
export function annualPct(totalRet, days) {
  if (!(days >= 365)) return null;
  return (Math.pow(1 + totalRet, 365 / days) - 1) * 100;
}

/* XIRR — roční výnos s ohledem na to, KDY peníze přišly (Newton + bisekce).
   flows: [{ date, amount }], vklady záporně, konečná hodnota kladně. */
export function xirr(flows) {
  const fl = (flows || []).map(x => ({ d: toDate(x.date), a: +x.amount })).filter(x => x.d && x.a);
  if (!fl.some(x => x.a < 0) || !fl.some(x => x.a > 0)) return null;
  const t0 = Math.min(...fl.map(x => x.d));
  const ys = fl.map(x => ({ y: (x.d - t0) / DAY / 365, a: x.a }));
  const npv = r => ys.reduce((s, x) => s + x.a / Math.pow(1 + r, x.y), 0);
  const dnpv = r => ys.reduce((s, x) => s - x.y * x.a / Math.pow(1 + r, x.y + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r), d = dnpv(r);
    if (!isFinite(v) || !isFinite(d) || d === 0) break;
    const nr = r - v / d;
    if (nr <= -0.9999 || !isFinite(nr)) break;
    if (Math.abs(nr - r) < 1e-10) return nr;
    r = nr;
  }
  // Newton nekonvergoval → bisekce na (-99,99 %; 1000 %)
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Peněžní toky poskytovatele pro XIRR: nákup každého fondu k jeho datu,
// dnešní hodnota k datu posledního ocenění. Fondy bez ceny/data se vynechají.
export function providerFlows(funds) {
  const flows = [];
  let value = 0, lastNav = null;
  for (const f of funds) {
    const inv = invCZK(f), d = toDate(f.nakupDatum);
    if (!(inv > 0) || !d) continue;
    flows.push({ date: d, amount: -inv });
    value += curCZK(f);
    const n = toDate(f.aktualNAVdatum);
    if (n && (!lastNav || n > lastNav)) lastNav = n;
  }
  if (!flows.length || !lastNav) return [];
  flows.push({ date: lastNav, amount: value });
  return flows;
}

// Stáří kurzu. CODYA/CONSEQ se oceňují měsíčně se zpožděním (~6 týdnů je
// normální), UniCredit se aktualizuje jen čtvrtletním výpisem.
const STALE_DAYS = { UNICREDIT: 100, T212: 7 };
export function navAge(f, today = new Date()) {
  const d = toDate(f.aktualNAVdatum);
  if (!d) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = daysBetween(d, t);
  return { days, stale: days > (STALE_DAYS[f.provider] || 75) };
}

/* Dokoupení z výpisu CONSEQ: výpis za období uvádí jen nákupy v tom období,
   takže přepsat jimi „investováno" by smazalo všechny dřívější vklady.
   Pokud výpis začíná nákupem POZDĚJI, než je uložený první nákup, jde o nové
   peníze → přičíst a nákupní cenu zprůměrovat. Stejný/starší → null (nic).
   Výpis nesmí být starší ani stejný jako ten, ze kterého je uložený stav —
   jinak by opakovaný import téhož výpisu přičetl dokoupení podruhé. */
export function mergeTopUp(existing, f, fx = 1) {
  if (!existing || !(f.castka > 0)) return null;
  const a = toDate(existing.nakupDatum), b = toDate(f.nakupDatum);
  if (!a || !b || b <= a || !(existing.investovanoCZK > 0)) return null;
  const sd = toDate(f._statementDate), last = toDate(existing.vypisDatum);
  if (!sd || (last && sd <= last)) return null;
  const castka = Math.round((existing.investovanoCZK / (fx || 1) + f.castka) * 100) / 100;
  return {
    castka,
    nakupNAV: f.pocetCP > 0 ? castka / f.pocetCP : f.nakupNAV,
    nakupDatum: existing.nakupDatum
  };
}

/* Výnos poskytovatele BEZ vlivu vkladů (time-weighted return, TWR).
   Počítá se z ceny jednoho podílu/akcie (NAV) v Kč, ne z hodnoty portfolia:
   když pošleš desetkrát víc peněz, cena podílu se nezmění, takže to výnos
   nezkreslí. Mezi dvěma po sobě jdoucími daty se výnosy fondů zprůměrují
   váženě podle hodnoty na začátku úseku a úseky se řetězí.
   - hist: [{datum 'YYYY-MM-DD', isin, nav, hodnotaCZK}] (body s hodnotou 0
     jsou staré nákupní kotvy T212 = průměrná nákupní cena, ne tržní → pryč),
   - funds: { isin: { mena } }, fxAt(mena, datum) → kurz ke koruně nebo null
     (bod bez kurzu se vynechá — žádný tichý kurz 1).
   Vrací [{ t, v (index, start 100), raw (hodnota v Kč) }]. */
export function providerTwr(hist, funds, fxAt) {
  const byIsin = {};
  for (const x of hist) {
    if (!(x.nav > 0) || !(x.hodnotaCZK > 0)) continue;
    const mena = (funds[x.isin] && funds[x.isin].mena) || 'CZK';
    const fx = mena === 'CZK' ? 1 : fxAt(mena, x.datum);
    if (!(fx > 0)) continue;
    (byIsin[x.isin] = byIsin[x.isin] || []).push({ t: x.datum, p: x.nav * fx, v: x.hodnotaCZK });
  }
  Object.values(byIsin).forEach(a => a.sort((a1, b1) => a1.t < b1.t ? -1 : a1.t > b1.t ? 1 : 0));
  const at = (a, d) => { let r = null; for (const x of a) { if (x.t <= d) r = x; else break; } return r; };
  const dates = [...new Set(Object.values(byIsin).flatMap(a => a.map(x => x.t)))].sort();
  const raw = d => Object.values(byIsin).reduce((s, a) => s + ((at(a, d) || {}).v || 0), 0);
  const out = [];
  let idx = 100;
  dates.forEach((d1, i) => {
    if (i > 0) {
      const d0 = dates[i - 1];
      let sw = 0, sr = 0;
      for (const a of Object.values(byIsin)) {
        const p0 = at(a, d0);
        if (!p0) continue;                       // fond tehdy ještě nebyl
        const p1 = at(a, d1);
        sw += p0.v; sr += p0.v * (p1.p / p0.p - 1);
      }
      if (sw > 0) idx *= 1 + sr / sw;
    }
    out.push({ t: d1, v: idx, raw: raw(d1) });
  });
  return out;
}

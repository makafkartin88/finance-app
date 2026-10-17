// Čisté parsery investičních výpisů (CODYA / CONSEQ / UniCredit) — bez DOM,
// bez pdf.js a bez sítě, ať jdou testovat přes `npm test`. Vstupem jsou
// řádky (seskupené podle Y) a tokeny v pořadí obsahu PDF, viz inv-import.js.

import { FOND } from './config.js';

export const DEFAULT_EUR = 25; // fallback EUR/CZK, když výpis kurz neuvádí

/* ── ČÍSLA / DATA ── */
// České formáty s různým oddělovačem tisíců: CODYA/CONSEQ používají mezeru
// ("203 383,09"), UniCredit tečku ("7.662,150000"). Desetinná je vždy čárka,
// takže když je v řetězci čárka, jsou všechny tečky oddělovače tisíců.
// (Bez tohohle se "7.662,150000" četlo jako 7,662 — o tři řády vedle.)
export function parseNum(s) {
  if (s == null) return 0;
  let t = String(s).replace(/[\s ]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "2.057.429" bez desetinných
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
// "31. 5. 2026" i "30.06.2026" → "D.M.YYYY"
export function parseDate(s) {
  const m = String(s).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? `${parseInt(m[1])}.${parseInt(m[2])}.${m[3]}` : '';
}

/* ── PARSER: CODYA majetkový výpis (aktuální NAV) ──
   Řádek: NÁZEV… ISIN MĚNA POČET HODNOTA_CP PLATNOST CELKOVÁ
   Sloupce POČET/HODNOTA/CELKOVÁ jsou oddělené jen mezerou (ne tečkou),
   proto se hledá kotva u NAV (4 desetinná místa) — počet je vše
   číselné/mezerové PŘED touto kotvou, celková je poslední 2-desetinné
   číslo ZA ní. Verifikováno proti reálným CODYA výpisům (2026-07-23). */
export function parseCodyaHoldings(lines) {
  const out = [];
  for (const line of lines) {
    const isinM = line.match(/(CZ\d{10})/);
    if (!isinM) continue;
    const isin = isinM[1];
    const nazev = line.slice(0, isinM.index).trim();
    const rest = line.slice(isinM.index + isin.length);
    const mena = /\bEUR\b/.test(rest) ? 'EUR' : 'CZK';
    const navM = rest.match(/(\d+,\d{4})/); // hodnota CP = 4 desetinná
    if (!navM) continue;
    const aktualNAV = parseNum(navM[1]);
    const aktualNAVdatum = parseDate(rest);
    const beforeNav = rest.slice(0, navM.index);
    const pocetM = beforeNav.match(/(\d[\d\s]*\d|\d)\s*$/);
    const pocetCP = pocetM ? parseInt(pocetM[1].replace(/\s/g, ''), 10) : 0;
    const totals = [...rest.matchAll(/(\d[\d\s]*,\d{2})/g)].map(m => parseNum(m[1]));
    const celkova = totals.length ? totals[totals.length - 1] : pocetCP * aktualNAV;
    out.push({ isin, nazev, mena, pocetCP, aktualNAV, aktualNAVdatum, _aktualNativni: celkova });
  }
  return out;
}

/* ── PARSER: CODYA výpis transakcí (nákupní NAV) ──
   Bloky: "FOND: …" → "ISIN: CZ…" → "NÁKUP d.m.r d.m.r POČET NAV POPLATEK ČÁSTKA MĚNA [KURZ]"
   Strukturní regex je nutná — obě data navazují na počet kusů jen
   mezerou (ne tečkou), takže dřívější "trailing digit run" heuristika
   omylem spojovala rok druhého data s počtem (2026+217108 → 2026217108).
   Oprava a ověření proti reálnému výpisu (2026-07-23). */
export function parseCodyaTransactions(lines) {
  const out = [];
  let curIsin = '', curName = '';
  const NAKUP_RE = /^NÁKUP\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s+\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s+([\d\s]+?)\s+(\d+,\d{4})\s+(\d[\d\s]*,\d{2})\s+(\d[\d\s]*,\d{2})\s*(CZK|EUR)(?:\s+(\d+,\d{3}))?/i;
  for (const line of lines) {
    const fondM = line.match(/^FOND:\s*(.+)$/i);
    if (fondM) { curName = fondM[1].trim(); continue; }
    const isinM = line.match(/^ISIN:\s*(CZ\d{10})/i);
    if (isinM) { curIsin = isinM[1]; continue; }
    if (/^NÁKUP/i.test(line) && curIsin) {
      const m = line.match(NAKUP_RE);
      if (m) {
        const pocetCP = parseInt(m[1].replace(/\s/g, ''), 10);
        const nakupNAV = parseNum(m[2]);
        const poplatek = parseNum(m[3]);
        const castka = parseNum(m[4]); // skutečně zaplacená částka (vč. poplatku), v měně `mena`
        const mena = m[5];
        const kurzEUR = m[6] ? parseNum(m[6]) : (mena === 'EUR' ? DEFAULT_EUR : 1);
        const nakupDatum = parseDate(line);
        out.push({ isin: curIsin, nazev: curName, mena, pocetCP, nakupNAV, nakupDatum, poplatek, kurzEUR, castka });
      }
      curIsin = '';
    }
  }
  return out;
}

/* ── PARSER: UniCredit „Výpis z majetkového účtu cenných papírů" ──
   Chodí čtvrtletně, jako zaheslované PDF v ZIPu. Tabulka fondů je sázená
   tak, že seskupení do vizuálních řádků podle Y ji rozláme (dlouhé názvy se
   zalamují a ISIN pak skončí na jiném Y než jeho čísla). Spolehlivé je
   naopak POŘADÍ tokenů: každý fond je v obsahu PDF vysázen jako
       ISIN → počet ks → cena za 1 ks → měna → hodnota pozice v měně CP
   a cena za 1 ks má VŽDY 6 desetinných míst, což je jednoznačná kotva.

   Pozor: výpis NEOBSAHUJE nákupní cenu ani investovanou částku — jde o stav
   k datu, ne o historii obchodů. Fondy proto přijdou bez `nakupNAV`
   a výnos se u nich nepočítá (viz renderProviderView), dokud ho uživatel
   nedoplní ručně v náhledu. */
export function parseUnicredit(toks) {
  const ISIN_RE  = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
  const PRICE_RE = /^\d{1,3}(?:\.\d{3})*,\d{6}$/;      // cena za 1 ks (6 desetinných)
  const QTY_RE   = /^\d{1,3}(?:\.\d{3})*,\d{1,6}$/;    // počet kusů (desetinný)
  const CCY_RE   = /^(CZK|EUR|USD|GBP)$/;
  const AMT_RE   = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;      // částka (2 desetinná)

  // Datum výpisu („… k 30.06.2026")
  const datum = parseDate(toks.find(t => /\d{1,2}\.\d{1,2}\.\d{4}/.test(t)) || '');

  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (!ISIN_RE.test(toks[i])) continue;
    const qty = toks[i + 1], price = toks[i + 2], ccy = toks[i + 3], valCcy = toks[i + 4], valCzk = toks[i + 5];
    if (!QTY_RE.test(qty) || !PRICE_RE.test(price) || !CCY_RE.test(ccy) || !AMT_RE.test(valCcy)) continue;

    // Název stojí těsně před ISINem. Dlouhý název se zalomí na dva tokeny
    // a ten druhý bývá zrovna „CZK"/„EUR" (část názvu fondu, ne měna) —
    // proto se v takovém případě připojí i token předchozí.
    let nazev = toks[i - 1] || '';
    if (CCY_RE.test(nazev)) nazev = ((toks[i - 2] || '') + ' ' + nazev).trim();

    // Hodnota v CZK je hned za hodnotou v měně CP; u korunových fondů je
    // stejná. Kurz se z té dvojice dopočítá přesně a nemusí se nikde
    // dohledávat (odpovídá kurzu ČNB k datu výpisu).
    const vCcy = parseNum(valCcy);
    const vCzk = AMT_RE.test(valCzk || '') ? parseNum(valCzk) : (ccy === 'CZK' ? vCcy : 0);
    const kurz = ccy === 'CZK' ? 1 : (vCcy > 0 && vCzk > 0 ? Math.round((vCzk / vCcy) * 1000) / 1000 : 0);

    out.push({
      isin: toks[i], nazev, mena: ccy,
      pocetCP: parseNum(qty),
      nakupNAV: 0,        // výpis nákupní cenu neuvádí (viz komentář výše)
      nakupDatum: '', poplatek: 0,
      kurzEUR: kurz,
      aktualNAV: parseNum(price),
      aktualNAVdatum: datum,
      _aktualNativni: vCcy
    });
  }
  return out;
}

/* ── PARSER: CONSEQ periodický výpis (vše v jednom, libovolný počet fondů) ──
   Každý fond v tabulce „Stav investičního účtu" zabírá 3 řádky:
     "<jméno 1> <datum ceny> <NAV 4 des.> CZK/CZK"
     "<jméno 2> <počet> <hodnota v měně> <měna> <kurz 4 des.> <hodnota v CZK> CZK"
     "<ISIN> Cenný papír kol. invest."
   Počet kusů je od hodnoty oddělený jen mezerou ("273 329 500 000,74"),
   takže se nedá číst přímo — dopočítá se z jednoznačné hodnoty v CZK
   (poslední číslo řádku) / kurz / NAV, a to pro KAŽDÝ fond zvlášť.
   (Dřív se počítal z „… investice celkem", tj. ze součtu všech fondů —
   s druhým fondem ve výpisu to dávalo dvojnásobné počty.) */
const AMT = String.raw`\d{1,3}(?:\s\d{3})*,\d{2}`;
export function parseConseq(lines) {
  const stLine = lines.find(l => /Stav investičního účtu k datu/i.test(l)) || '';
  const _statementDate = parseDate(stLine);

  const perfLine = lines.find(l => /Zhodnocení portfolia/i.test(l));
  const pM = perfLine ? perfLine.match(/(-?\d+,\d+)\s*%/) : null;
  const poznamka = pM ? `Zhodnocení ${pM[1]} %` : '';

  const out = [];
  lines.forEach((line, i) => {
    const isinM = line.match(/^(CZ\d{10})\s+Cenný papír/i);
    if (!isinM) return;
    const isin = isinM[1];
    const navLine = lines[i - 2] || '', valLine = lines[i - 1] || '';
    const navM = navLine.match(/(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d+,\d{4})\s+(CZK|EUR)\/CZK/);
    const valM = valLine.match(new RegExp(String.raw`(\d+,\d{4})\s+(${AMT})\s*CZK\s*$`));
    if (!navM || !valM) return;
    const aktualNAV = parseNum(navM[2]);
    const mena = navM[3];
    const kurz = parseNum(valM[1]) || 1;
    const hodnotaCZK = parseNum(valM[2]);
    const native = hodnotaCZK / kurz;
    const name1 = navLine.slice(0, navM.index).trim();
    const name2 = (valLine.match(/^(.*?\))\s/) || [])[1] || '';

    // Nákup v tomto období (jen u fondu, který ho má): "<ISIN> Nákup <cena> … <celkem> CZK <datum>"
    const buys = lines.filter(l => new RegExp('^' + isin + String.raw`\s+N[áa]kup`).test(l));
    let nakupNAV = 0, nakupDatum = '', castka = 0, poplatek = 0;
    for (const b of buys) {
      const priceM = b.match(/(\d+,\d{4})/);
      if (!nakupNAV && priceM) nakupNAV = parseNum(priceM[1]);
      const dates = b.match(/\d{1,2}\.\d{1,2}\.\d{4}\s*$/);
      if (dates) nakupDatum = parseDate(dates[0]);
      const amts = [...b.matchAll(new RegExp(String.raw`(?<![\d,])(${AMT})(?=\s*CZK)`, 'g'))].map(m => parseNum(m[1]));
      if (amts.length >= 2) {
        castka += amts[amts.length - 1];
        poplatek += amts[amts.length - 1] - amts[amts.length - 2];
      }
    }

    out.push({
      isin, nazev: (name1 + ' ' + name2).trim() || 'Conseq fond', mena,
      pocetCP: aktualNAV ? Math.round(native / aktualNAV) : 0,
      nakupNAV, nakupDatum,
      poplatek: Math.round(poplatek * 100) / 100,
      castka: Math.round(castka * 100) / 100,
      aktualNAV, aktualNAVdatum: parseDate(navM[1]),
      kurzEUR: mena === 'EUR' ? kurz : 1,
      _aktualNativni: Math.round(native * 100) / 100,
      _statementDate, poznamka,
    });
  });

  // Hotovost na účtu je jedna za celý výpis → jen u prvního fondu, ostatním
  // výslovně 0 (jinak by u nich při upsertu zůstala stará hodnota).
  const cashLine = lines.find(l => /Konečný zůstatek:/i.test(l));
  if (cashLine && out.length) {
    const cM = cashLine.match(new RegExp(String.raw`(-?${AMT})`));
    const cash = cM ? Math.max(0, parseNum(cM[1])) : 0;
    out.forEach((f, k) => { f.hotovostCZK = k === 0 ? cash : 0; });
  }
  return out;
}

/* ── ŘÁDEK PRO LIST Fondy (upsert dle ISIN) ──
   Prázdná hodnota ('') se při upsertu NEPŘEPÍŠE, takže chybějící údaj
   z výpisu nezničí to, co už v listu je. Hotovost je výjimka: 0 je platná
   informace („už nic volného") a musí se zapsat, jinak by zůstala stará
   částka (přesně tak dřív u CONSEQ zůstalo 505 000 Kč po nákupu fondu). */
export function buildFundRow(f) {
  const mena = f.mena || 'CZK';
  const kurzEUR = f.kurzEUR || (mena === 'EUR' ? DEFAULT_EUR : 1);
  const fx = mena === 'EUR' ? kurzEUR : 1;
  const pocetCP = f.pocetCP || 0, nakupNAV = f.nakupNAV || 0, aktualNAV = f.aktualNAV || 0;
  const castka = f.castka || 0;
  const row = new Array(15).fill('');
  row[FOND.provider] = f.provider;
  row[FOND.isin] = f.isin;
  row[FOND.nazev] = f.nazev || '';
  row[FOND.mena] = mena;
  row[FOND.pocetCP] = pocetCP || '';
  row[FOND.nakupNAV] = nakupNAV || '';
  row[FOND.nakupDatum] = f.nakupDatum || '';
  row[FOND.investovanoCZK] = castka ? Math.round(castka * fx) : (nakupNAV ? Math.round(pocetCP * nakupNAV * fx) : '');
  row[FOND.aktualNAV] = aktualNAV || '';
  row[FOND.aktualNAVdatum] = f.aktualNAVdatum || '';
  row[FOND.aktualHodnotaCZK] = aktualNAV ? Math.round(pocetCP * aktualNAV * fx) : '';
  row[FOND.poplatek] = f.poplatek || '';
  row[FOND.kurzEUR] = mena === 'EUR' ? kurzEUR : '';
  row[FOND.hotovostCZK] = typeof f.hotovostCZK === 'number' ? f.hotovostCZK : '';
  row[FOND.poznamka] = f.poznamka || '';
  return row;
}

/* ── ROZPOZNÁNÍ TYPU VÝPISU ──
   null = nejde o podporovaný výpis (newsletter, smlouva…). CONSEQ se
   rozpozná jen podle hlavičky výpisu, ne podle samotného slova „Conseq",
   protože z conseq.cz chodí i jiná PDF. */
export function detectStatement(lines, allTokens = []) {
  const upper = lines.join('\n').toUpperCase();
  let provider, type, docLabel, funds;
  if (upper.includes('VÝPIS Z MAJETKOVÉHO ÚČTU') && upper.includes('CODYA')) {
    provider = 'CODYA'; type = 'holdings'; docLabel = 'majetkový výpis (aktuální NAV)';
    funds = parseCodyaHoldings(lines);
  } else if (upper.includes('VÝPIS TRANSAKCÍ') && upper.includes('CODYA')) {
    provider = 'CODYA'; type = 'transactions'; docLabel = 'výpis transakcí (nákupní NAV)';
    funds = parseCodyaTransactions(lines);
  } else if (upper.includes('UNICREDIT') && upper.includes('MAJETKOVÉHO ÚČTU CENNÝCH PAPÍRŮ')) {
    provider = 'UNICREDIT'; type = 'holdings'; docLabel = 'výpis z majetkového účtu CP';
    funds = parseUnicredit(allTokens);
  } else if (upper.includes('VÝPIS Z INVESTIČNÍHO ÚČTU') && upper.includes('CONSEQ')) {
    provider = 'CONSEQ'; type = 'holdings'; docLabel = 'výpis z investičního účtu';
    funds = parseConseq(lines);
  } else return null;
  funds.forEach(f => { f.provider = provider; });
  return { provider, type, docLabel, kind: [provider, type], funds };
}

// "31.8.2026" / "30.06.2026" / ISO timestamp ze Sheets → "yyyy-mm-dd" ('' když nejde)
function isoOf(v) {
  const s = String(v || '');
  const m = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return s.includes('T') && !isNaN(d) ? d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }) : s.slice(0, 10);
  }
  return '';
}

/* ── AUTOMATICKÝ IMPORT: pojistky ──
   Vrací { ok:true, rows } (bezpečné uložit bez náhledu), nebo
   { ok:false, reason } → výpis zůstane ve frontě a appka ukáže banner
   k ruční kontrole. `existing` = state.investments. */
export function planAutoImport(funds, provider, type, existing) {
  if (!funds || !funds.length) return { ok: false, reason: 've výpisu nejsou žádné fondy' };
  const bad = funds.find(f => !(f.pocetCP > 0) || !(f.aktualNAV > 0));
  if (bad && type !== 'transactions') return { ok: false, reason: `nulový počet kusů nebo kurz u ${bad.isin}` };

  const mine = (existing || []).filter(e => e.provider === provider);
  const byIsin = new Map(mine.map(e => [e.isin, e]));
  if (type === 'holdings') {
    const gone = mine.find(e => !funds.some(f => f.isin === e.isin));
    if (gone) return { ok: false, reason: `ve výpisu chybí fond ${gone.isin}` };
  }

  const out = [];
  for (const f0 of funds) {
    const f = { ...f0 };
    const e = byIsin.get(f.isin);
    if (e) {
      // Výpis CODYA kurz EUR neuvádí → vzít uložený (jinak by se zapsal záložní 25).
      if (f.mena === 'EUR' && !f.kurzEUR && e.kurzEUR > 0) f.kurzEUR = e.kurzEUR;
      if (f.nakupNAV > 0 && e.nakupNAV > 0 && Math.abs(f.nakupNAV - e.nakupNAV) > 1e-6)
        return { ok: false, reason: `dokoupení ${f.isin} za jinou cenu — zkontroluj nákupní cenu` };
      // Novější kurz (typicky stažený z webu fondu) se starším z výpisu nepřepíše.
      const eDate = isoOf(e.aktualNAVdatum), fDate = isoOf(f.aktualNAVdatum);
      if (e.aktualNAV > 0 && eDate && fDate && eDate > fDate) {
        f.aktualNAV = e.aktualNAV;
        f.aktualNAVdatum = e.aktualNAVdatum;
      }
      const oldV = (e.pocetCP || 0) * (e.aktualNAV || 0), newV = (f.pocetCP || 0) * (f.aktualNAV || 0);
      if (type !== 'transactions' && oldV > 0 && Math.abs(newV / oldV - 1) > 0.5)
        return { ok: false, reason: `hodnota ${f.isin} se změnila o víc než 50 %` };
    }
    out.push(buildFundRow(f));
  }
  return { ok: true, rows: out };
}

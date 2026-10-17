// Čisté parsery investičních výpisů (CODYA / CONSEQ / UniCredit) — bez DOM,
// bez pdf.js a bez sítě, ať jdou testovat přes `npm test`. Vstupem jsou
// řádky (seskupené podle Y) a tokeny v pořadí obsahu PDF, viz inv-import.js.

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

/* ── PARSER: CONSEQ periodický výpis (vše v jednom) ──
   Fond je vysázen na 2 řádcích (jméno se zalamuje), s čísly oddělenými
   jen mezerou od navazujícího jména i navzájem — přímé parsování
   "počtu kusů" z těsně sázené tabulky je nespolehlivé. Proto se počet
   dopočítává zpětně z jednoznačného řádku "… investice celkem: X CZK"
   a aktuální NAV (pocetCP = celkem / NAV) — obchází nejednoznačnost.
   Ostatní pole (nákup, poplatky, hotovost) se čtou z izolovaných,
   jednoznačných řádků v sekci pohybů na účtu. Ověřeno proti reálnému
   výpisu (2026-07-23). */
export function parseConseq(lines) {
  const isinIdx = lines.findIndex(l => /^CZ\d{10}\b/.test(l));
  if (isinIdx === -1) return [];
  const isin = lines[isinIdx].match(/^(CZ\d{10})/)[1];

  // Hlavička fondu = 2 řádky před ISIN: "<jméno část 1> <datum> <NAV> <kurz párů>"
  //                                     "<jméno část 2> <počet> <hodnota v měně> <kurz> <hodnota základní>"
  const navLine = lines[isinIdx - 2] || '';
  const navM = navLine.match(/(\d+,\d{4})/);
  const aktualNAV = navM ? parseNum(navM[1]) : 0;
  const aktualNAVdatum = parseDate(navLine);
  let nazev = navLine.replace(/\d{1,2}\.\s*\d{1,2}\.\s*\d{4}.*$/, '').trim();
  const contLine = lines[isinIdx - 1] || '';
  const contNameM = contLine.match(/^(.*?)(?=\d{2,})/);
  if (contNameM && contNameM[1].trim()) nazev = (nazev + ' ' + contNameM[1].trim()).trim();

  // Celková hodnota fondu — jednoznačný řádek "… investice celkem: X CZK"
  const totalLine = lines.find(l => /investice celkem:/i.test(l));
  const aktualHodnotaCZK = totalLine ? parseNum((totalLine.match(/(\d[\d\s]*,\d{2})/) || [])[1]) : 0;
  // Počet kusů dopočítán zpětně (viz komentář výše) — obchází nejednoznačné sloupce
  const pocetCP = aktualNAV ? Math.round(aktualHodnotaCZK / aktualNAV) : 0;

  // Nákupní NAV — jednoznačný řádek "<ISIN> Nákup <NAV 4dec> …"
  const buyLine = lines.find(l => new RegExp(isin + '\\s+N[áa]kup').test(l));
  const buyNavM = buyLine ? buyLine.match(/(\d+,\d{4})/) : null;
  const nakupNAV = buyNavM ? parseNum(buyNavM[1]) : 0;
  const buyDateM = buyLine ? buyLine.match(/\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\s*$/) : null;
  const nakupDatum = buyDateM ? parseDate(buyDateM[0]) : '';

  // Investováno / poplatek — jednoznačné řádky v sekci pohybů na peněžním účtu
  const investLine = lines.find(l => /N[áa]kup.*Dr\./i.test(l) && !/poplatek/i.test(l));
  const feeLine = lines.find(l => /vstupní poplatek/i.test(l) && /Dr\./i.test(l));
  const investM = investLine ? [...investLine.matchAll(/(-?\d[\d\s]*,\d{2})/g)].pop() : null;
  const feeM = feeLine ? [...feeLine.matchAll(/(-?\d[\d\s]*,\d{2})/g)].pop() : null;
  const poplatek = feeM ? Math.abs(parseNum(feeM[1])) : 0;
  const castka = investM ? Math.abs(parseNum(investM[1])) : 0; // skutečně zaplaceno (vč. poplatku), v CZK

  // Hotovost — jednoznačný řádek "Konečný zůstatek: X CZK"
  const cashLine = lines.find(l => /Konečný zůstatek:/i.test(l));
  const hotovostCZK = cashLine ? parseNum((cashLine.match(/(\d[\d\s]*,\d{2})/) || [])[1]) : 0;

  // Zhodnocení %
  const perfLine = lines.find(l => /Zhodnocení portfolia/i.test(l));
  const pM = perfLine ? perfLine.match(/(-?\d+,\d+)\s*%/) : null;
  const poznamka = pM ? `Zhodnocení ${pM[1]} %` : '';

  return [{
    isin, nazev: nazev || 'Conseq fond', mena: 'CZK', pocetCP,
    nakupNAV, nakupDatum, poplatek, castka,
    aktualNAV, aktualNAVdatum,
    kurzEUR: 1,
    _aktualNativni: aktualHodnotaCZK,
    hotovostCZK, poznamka
  }];
}

import { GAS_URL, FOND, FUND_FOCUS } from './config.js';
import { state } from './state.js';
import { toast } from './app.js';
import { loadInvestmentData } from './investments.js';
import { fetchSheet } from './utils.js';

// Heslo k zaheslovaným výpisům (UniCredit) — jen localStorage, nikdy v kódu
const INV_PWD_KEY = 'invPdfPwd';

/* ============================================================
   Import investičních výpisů (CODYA + CONSEQ) přes pdf.js.
   - Auto-detekce typu dokumentu z textu.
   - Poziční/řádkový parser → fondy klíčované ISINem.
   - Editovatelný náhled (záchranná síť při misparse).
   - Uložení = upsert dle ISIN (GAS action:'upsertFund') → dvě
     CODYA PDF (majetkový výpis + transakce) se sloučí do 1 řádku.
   ============================================================ */

const DEFAULT_EUR = 25; // fallback EUR/CZK, když výpis kurz neuvádí

/* ── ČÍSLA / DATA ── */
// České formáty s různým oddělovačem tisíců: CODYA/CONSEQ používají mezeru
// ("203 383,09"), UniCredit tečku ("7.662,150000"). Desetinná je vždy čárka,
// takže když je v řetězci čárka, jsou všechny tečky oddělovače tisíců.
// (Bez tohohle se "7.662,150000" četlo jako 7,662 — o tři řády vedle.)
function parseNum(s) {
  if (s == null) return 0;
  let t = String(s).replace(/[\s ]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "2.057.429" bez desetinných
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
// "31. 5. 2026" i "30.06.2026" → "D.M.YYYY"
function parseDate(s) {
  const m = String(s).match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? `${parseInt(m[1])}.${parseInt(m[2])}.${m[3]}` : '';
}

/* ── MODAL ── */
export function openInvImport() {
  document.getElementById('invImpStatus').style.display = 'none';
  document.getElementById('invImpResults').style.display = 'none';
  document.getElementById('invModal').style.display = 'flex';
}
export function closeInvImport() {
  document.getElementById('invModal').style.display = 'none';
}

/* ── DRAG-DROP ── */
export function invDov(e) { e.preventDefault(); document.getElementById('invZone').classList.add('over'); }
export function invDol() { document.getElementById('invZone').classList.remove('over'); }
export function invDod(e) { e.preventDefault(); invDol(); const f = e.dataTransfer.files[0]; if (f) procInvFile(f); }
export function invOnFile(e) { const f = e.target.files[0]; if (f) procInvFile(f); e.target.value = ''; }

/* ── HLAVNÍ PROCESOR ──
   `src` je buď File (drag-drop / výběr), nebo ArrayBuffer (stažení z Disku
   přes GAS — viz importUcpFromDrive). */
async function procInvFile(src, srcName) {
  const status = document.getElementById('invImpStatus');
  const results = document.getElementById('invImpResults');
  status.style.display = 'block';
  results.style.display = 'none';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">
    <div style="width:28px;height:28px;border:2px solid rgba(55,138,221,.3);border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .8s linear infinite"></div>
    Čtu investiční výpis…</div>`;

  const fname = srcName || src.name || 'vypis.pdf';
  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj připojení');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = src instanceof ArrayBuffer ? src : await src.arrayBuffer();
    // UniCredit výpisy chodí zaheslované — heslo se zeptá jednou a uloží se
    // do localStorage (repo je veřejné, takže nikdy do kódu). CODYA/CONSEQ
    // heslo nemají, u nich se onPassword vůbec nezavolá.
    const savedPwd = localStorage.getItem(INV_PWD_KEY) || '';
    const task = pdfjsLib.getDocument({ data: arrayBuffer, password: savedPwd || undefined });
    let usedPwd = savedPwd;
    task.onPassword = (updateCallback, reason) => {
      const msg = reason === 2 ? 'Nesprávné heslo, zadej znovu:' : 'Zadej heslo k PDF výpisu (zapamatuje se):';
      const pwd = prompt(msg);
      if (pwd !== null) { usedPwd = pwd.trim(); updateCallback(usedPwd); }
      else throw new Error('Import zrušen — heslo nebylo zadáno');
    };
    const pdf = await task.promise;
    if (usedPwd) localStorage.setItem(INV_PWD_KEY, usedPwd);

    const lines = [];
    const allTokens = []; // tokeny v pořadí obsahu PDF — UniCredit výpis se
                          // parsuje z nich (viz parseUnicredit), ne z řádků
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter(it => it.str.trim())
        .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
      items.forEach(it => allTokens.push(it.str));
      // seskupit do vizuálních řádků dle Y (±4px)
      const sorted = items.slice().sort((a, b) => Math.abs(a.y - b.y) > 4 ? b.y - a.y : a.x - b.x);
      let prevY = null, tokens = [];
      for (const it of sorted) {
        if (prevY !== null && Math.abs(it.y - prevY) <= 4) tokens.push(it.str);
        else { if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim()); tokens = [it.str]; prevY = it.y; }
      }
      if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim());
    }

    const text = lines.join('\n');
    const upper = text.toUpperCase();
    let funds = [], provider = '', docType = '';

    if (upper.includes('VÝPIS Z MAJETKOVÉHO ÚČTU') && upper.includes('CODYA')) {
      provider = 'CODYA'; docType = 'majetkový výpis (aktuální NAV)';
      funds = parseCodyaHoldings(lines);
    } else if (upper.includes('VÝPIS TRANSAKCÍ') && upper.includes('CODYA')) {
      provider = 'CODYA'; docType = 'výpis transakcí (nákupní NAV)';
      funds = parseCodyaTransactions(lines);
    } else if (upper.includes('UNICREDIT') && upper.includes('MAJETKOVÉHO ÚČTU CENNÝCH PAPÍRŮ')) {
      provider = 'UNICREDIT'; docType = 'výpis z majetkového účtu CP';
      funds = parseUnicredit(allTokens);
    } else if (upper.includes('CONSEQ')) {
      provider = 'CONSEQ'; docType = 'výpis z investičního účtu';
      funds = parseConseq(lines);
    } else {
      throw new Error('Neznámý typ výpisu. Podporováno: CODYA (majetkový výpis / transakce), CONSEQ a UniCredit (majetkový účet CP).');
    }

    if (!funds.length) throw new Error('Ve výpisu se nepodařilo najít žádné fondy (ISIN). Zkus jiný soubor.');

    funds.forEach(f => { f.provider = provider; });
    status.style.display = 'none';
    showInvPreview(funds, provider, docType, fname);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Podporované výpisy: CODYA (majetkový výpis + transakce) a CONSEQ periodický výpis.</p></div>`;
  }
}

/* ── PARSER: CODYA majetkový výpis (aktuální NAV) ──
   Řádek: NÁZEV… ISIN MĚNA POČET HODNOTA_CP PLATNOST CELKOVÁ
   Sloupce POČET/HODNOTA/CELKOVÁ jsou oddělené jen mezerou (ne tečkou),
   proto se hledá kotva u NAV (4 desetinná místa) — počet je vše
   číselné/mezerové PŘED touto kotvou, celková je poslední 2-desetinné
   číslo ZA ní. Verifikováno proti reálným CODYA výpisům (2026-07-23). */
function parseCodyaHoldings(lines) {
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
function parseCodyaTransactions(lines) {
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
function parseUnicredit(toks) {
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
function parseConseq(lines) {
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

/* ── NÁHLED (editovatelný) ── */
function showInvPreview(funds, provider, docType, fname) {
  window._invParsed = funds;
  const rs = document.getElementById('invImpResults');
  rs.style.display = 'block';
  const rows = funds.map((f, i) => {
    const focus = FUND_FOCUS[f.isin] || '';
    return `<tr>
      <td style="min-width:150px"><input id="if-nazev-${i}" type="text" value="${(f.nazev || '').replace(/"/g, '&quot;')}"/><div style="font-size:10px;color:var(--text3);margin-top:2px">${f.isin} · ${focus}</div></td>
      <td><select id="if-mena-${i}" class="sel" style="font-size:11px;padding:3px 6px"><option ${f.mena === 'CZK' ? 'selected' : ''}>CZK</option><option ${f.mena === 'EUR' ? 'selected' : ''}>EUR</option></select></td>
      <td><input id="if-pocet-${i}" type="number" value="${f.pocetCP || ''}" style="width:90px"/></td>
      <td><input id="if-nakup-${i}" type="number" step="0.0001" value="${f.nakupNAV || ''}" style="width:80px" placeholder="—"/></td>
      <td><input id="if-aktual-${i}" type="number" step="0.0001" value="${f.aktualNAV || ''}" style="width:80px" placeholder="—"/></td>
      <td><input id="if-kurz-${i}" type="number" step="0.001" value="${f.kurzEUR || ''}" style="width:64px" placeholder="1"/></td>
      <td><input id="if-hotovost-${i}" type="number" value="${f.hotovostCZK || ''}" style="width:90px" placeholder="0"/></td>
    </tr>`;
  }).join('');
  rs.innerHTML = `<div class="card" style="padding:0;margin-top:14px">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="font-size:13px"><strong>${provider}</strong> · ${docType}<div style="font-size:11px;color:var(--text3)">${fname} — ${funds.length} fondů · zkontroluj a uprav hodnoty</div></div>
      <div style="display:flex;gap:8px"><button class="btnp" onclick="confirmInvImport()">💾 Uložit do portfolia</button><button class="btn" onclick="document.getElementById('invImpResults').style.display='none'">Zrušit</button></div>
    </div>
    <div class="tw"><table><thead><tr><th>Fond</th><th>Měna</th><th>Počet CP</th><th>Nákup NAV</th><th>Aktuál NAV</th><th>Kurz EUR</th><th>Hotovost CZK</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

/* ── ULOŽENÍ (upsert dle ISIN) ── */
export async function confirmInvImport() {
  const funds = window._invParsed || [];
  const rows = funds.map((f, i) => {
    const g = id => document.getElementById(id + i);
    const nazev = g('if-nazev-')?.value.trim() || f.nazev || '';
    const mena = g('if-mena-')?.value || f.mena || 'CZK';
    const pocetCP = parseFloat(g('if-pocet-')?.value) || f.pocetCP || 0;
    const nakupNAV = parseFloat(g('if-nakup-')?.value) || f.nakupNAV || 0;
    const aktualNAV = parseFloat(g('if-aktual-')?.value) || f.aktualNAV || 0;
    const kurzEUR = parseFloat(g('if-kurz-')?.value) || (mena === 'EUR' ? DEFAULT_EUR : 1);
    const hotovostCZK = parseFloat(g('if-hotovost-')?.value) || f.hotovostCZK || 0;
    const fx = mena === 'EUR' ? kurzEUR : 1;
    // Investováno = skutečně zaplacená částka (vč. poplatku), pokud ji výpis uvádí;
    // jinak dopočet z počtu × NAV (bez poplatku, jen záchranná síť).
    const castka = f.castka || 0;
    const investovanoCZK = castka ? Math.round(castka * fx) : (nakupNAV ? Math.round(pocetCP * nakupNAV * fx) : '');
    const aktualHodnotaCZK = aktualNAV ? Math.round(pocetCP * aktualNAV * fx) : '';

    // Řádek pro sheet — prázdné hodnoty ('') se při upsertu nepřepíšou.
    const row = new Array(15).fill('');
    row[FOND.provider] = f.provider;
    row[FOND.isin] = f.isin;
    row[FOND.nazev] = nazev;
    row[FOND.mena] = mena;
    row[FOND.pocetCP] = pocetCP || '';
    row[FOND.nakupNAV] = nakupNAV || '';
    row[FOND.nakupDatum] = f.nakupDatum || '';
    row[FOND.investovanoCZK] = investovanoCZK;
    row[FOND.aktualNAV] = aktualNAV || '';
    row[FOND.aktualNAVdatum] = f.aktualNAVdatum || '';
    row[FOND.aktualHodnotaCZK] = aktualHodnotaCZK;
    row[FOND.poplatek] = f.poplatek || '';
    row[FOND.kurzEUR] = mena === 'EUR' ? kurzEUR : '';
    row[FOND.hotovostCZK] = hotovostCZK || '';
    row[FOND.poznamka] = f.poznamka || '';
    return row;
  });

  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'upsertFund', values: rows }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    toast(`Uloženo ${rows.length} fondů`, 'ok');
    document.getElementById('invImpResults').style.display = 'none';
    closeInvImport();
    // Import z banneru → označit výpis za vyřízený, ať se nenabízí donekonečna
    if (state._ucpImportFileId) {
      try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'markUcpImported', fileId: state._ucpImportFileId }) }); } catch (e2) {}
      state._ucpImportFileId = null;
      await loadUcpNotification();
    }
    loadInvestmentData();
  } catch (e) {
    toast('Chyba uložení: ' + e.message, 'err');
  }
}

/* ── UNICREDIT: výpisy z majetkového účtu CP zachycené v e-mailu ──
   Stejný vzor jako u mBank výpisů a výplatních pásek: GAS je stáhne z pošty
   (a rozbalí ZIP), appka pak nabídne frontu čekajících a na jedno kliknutí
   soubor stáhne přes GAS, rozparsuje a rovnou ukáže návrh. */
const UCP_MONTHS = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
function ucpLabel(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${UCP_MONTHS[+m[2]] || m[2]} ${m[1]}` : (period || '');
}

export async function loadUcpNotification() {
  try {
    const d = await fetchSheet(GAS_URL + '?sheet=UcpImport');
    const rows = (d.values || []).slice(1).filter(r => r[4] === 'new');
    state._ucpPending = rows
      .map(r => ({ filename: r[1], fileId: r[2], period: r[6] || '', note: r[7] || '' }))
      .sort((a, b) => String(b.period).localeCompare(String(a.period)));
    if (state._ucpPending.length) showUcpBanner(0); else hideUcpBanner();
  } catch (e) { /* list ještě nemusí existovat */ }
}

export function ucpPickPending(i) { showUcpBanner(Number(i)); }

function showUcpBanner(idx) {
  const banner = document.getElementById('invBanner');
  const list = state._ucpPending || [];
  const cur = list[idx];
  if (!banner || !cur) return;
  const esc = s => String(s).replace(/'/g, "\\'");
  const picker = list.length > 1
    ? `<select class="sel" style="font-size:11px;padding:3px 6px" onchange="ucpPickPending(this.value)">
        ${list.slice(0, 12).map((p, i) => `<option value="${i}"${i === idx ? ' selected' : ''}>${ucpLabel(p.period) || p.filename}</option>`).join('')}
       </select>` : '';
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span style="font-size:18px">📈</span>
    <div style="flex:1;min-width:180px">
      <div style="font-weight:600;font-size:13px">Výpis z UniCredit k importu${cur.period ? ' — ' + ucpLabel(cur.period) : ''}</div>
      <div style="font-size:12px;color:var(--text2)">${cur.filename}${list.length > 1 ? ` · čeká ${list.length}` : ''}</div>
      ${cur.note ? `<div style="font-size:11px;color:var(--amber-text)">⚠️ ${cur.note}</div>` : ''}
    </div>
    ${picker}
    <button class="btnp btnsm" onclick="importUcpFromDrive('${esc(cur.fileId)}','${esc(cur.filename)}')">Importovat</button>
    <button class="btn btnsm" onclick="ucpMarkDone('${esc(cur.fileId)}')" title="Skrýt natrvalo">✓ Už mám</button>
    <button class="btn btnsm" onclick="hideUcpBanner()" title="Skrýt jen teď">✕</button>`;
}

export function hideUcpBanner() {
  const b = document.getElementById('invBanner');
  if (b) b.style.display = 'none';
}

export async function ucpMarkDone(fileId) {
  try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'markUcpImported', fileId }) }); } catch (e) {}
  await loadUcpNotification();
}

export async function ucpCheckMail() {
  toast('Kontroluji poštu…');
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'checkUnicreditEmail' }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    await loadUcpNotification();
    const n = (state._ucpPending || []).length;
    toast(d.added ? `Nalezeno ${d.added} nových výpisů · čeká ${n}` : (n ? `Nic nového · čeká ${n}` : 'Žádné nové výpisy'), 'ok');
  } catch (e) { toast('Kontrola pošty selhala: ' + e.message, 'err'); }
}

export async function importUcpFromDrive(fileId, filename) {
  openInvImport();
  const status = document.getElementById('invImpStatus');
  status.style.display = 'block';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">Stahuji výpis z Disku…</div>`;
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'getDriveFile', fileId }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const bin = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    state._ucpImportFileId = fileId;
    await procInvFile(bin.buffer, d.name || filename);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba stažení: ${e.message}</p></div>`;
  }
}

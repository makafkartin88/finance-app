import { GAS_URL, FOND, FUND_FOCUS } from './config.js';
import { state } from './state.js';
import { toast } from './app.js';
import { loadInvestmentData } from './investments.js';

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
// "203 383,09" / "1,9472" / nbsp oddělovače → number
function parseNum(s) {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
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

/* ── HLAVNÍ PROCESOR ── */
async function procInvFile(file) {
  const status = document.getElementById('invImpStatus');
  const results = document.getElementById('invImpResults');
  status.style.display = 'block';
  results.style.display = 'none';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">
    <div style="width:28px;height:28px;border:2px solid rgba(55,138,221,.3);border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .8s linear infinite"></div>
    Čtu investiční výpis…</div>`;

  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj připojení');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter(it => it.str.trim())
        .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
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
    } else if (upper.includes('CONSEQ')) {
      provider = 'CONSEQ'; docType = 'výpis z investičního účtu';
      funds = parseConseq(lines);
    } else {
      throw new Error('Neznámý typ výpisu. Podporováno: CODYA (majetkový výpis / transakce) a CONSEQ.');
    }

    if (!funds.length) throw new Error('Ve výpisu se nepodařilo najít žádné fondy (ISIN). Zkus jiný soubor.');

    funds.forEach(f => { f.provider = provider; });
    status.style.display = 'none';
    showInvPreview(funds, provider, docType, file.name);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Podporované výpisy: CODYA (majetkový výpis + transakce) a CONSEQ periodický výpis.</p></div>`;
  }
}

/* ── PARSER: CODYA majetkový výpis (aktuální NAV) ──
   Řádek: NÁZEV… ISIN MĚNA POČET HODNOTA_CP PLATNOST CELKOVÁ */
function parseCodyaHoldings(lines) {
  const out = [];
  for (const line of lines) {
    const isinM = line.match(/(CZ\d{10})/);
    if (!isinM) continue;
    const isin = isinM[1];
    const nazev = line.slice(0, isinM.index).trim();
    const rest = line.slice(isinM.index + isin.length);
    const mena = /\bEUR\b/.test(rest) ? 'EUR' : 'CZK';
    const navM = rest.match(/(\d+,\d{4})/);           // hodnota CP = 4 desetinná
    if (!navM) continue;
    const aktualNAV = parseNum(navM[1]);
    const aktualNAVdatum = parseDate(rest);
    // počet = celočíselná skupina mezi měnou a NAV
    const beforeNav = rest.slice(0, navM.index);
    const pocetM = beforeNav.match(/(\d[\d\s ]*\d|\d)\s*$/);
    const pocetCP = pocetM ? parseInt(pocetM[1].replace(/[\s ]/g, ''), 10) : 0;
    // celková hodnota = poslední 2-desetinné číslo (v měně fondu)
    const totals = [...rest.matchAll(/(\d[\d\s ]*,\d{2})/g)].map(m => parseNum(m[1]));
    const celkova = totals.length ? totals[totals.length - 1] : pocetCP * aktualNAV;
    out.push({ isin, nazev, mena, pocetCP, aktualNAV, aktualNAVdatum, _aktualNativni: celkova });
  }
  return out;
}

/* ── PARSER: CODYA výpis transakcí (nákupní NAV) ──
   Bloky: "FOND: …" → "ISIN: CZ…" → "NÁKUP d.m.r d.m.r POČET NAV POPLATEK ČÁSTKA MĚNA [KURZ]" */
function parseCodyaTransactions(lines) {
  const out = [];
  let curIsin = '', curName = '';
  for (const line of lines) {
    const fondM = line.match(/^FOND:\s*(.+)$/i);
    if (fondM) { curName = fondM[1].trim(); continue; }
    const isinM = line.match(/^ISIN:\s*(CZ\d{10})/i);
    if (isinM) { curIsin = isinM[1]; continue; }
    if (/^NÁKUP/i.test(line) && curIsin) {
      const mena = /\bEUR\b/.test(line) ? 'EUR' : 'CZK';
      const navM = line.match(/(\d+,\d{4})/);        // hodnota CP
      const nakupNAV = navM ? parseNum(navM[1]) : 0;
      const nakupDatum = parseDate(line);            // první datum (datum kurzu)
      const dvoudes = [...line.matchAll(/(\d[\d\s ]*,\d{2})/g)].map(m => parseNum(m[1]));
      const poplatek = dvoudes.length >= 2 ? dvoudes[0] : 0;   // POPLATEK, pak ČÁSTKA
      const beforeNav = navM ? line.slice(0, navM.index) : line;
      const pocetM = beforeNav.match(/(\d[\d\s ]*\d|\d)\s*$/);
      const pocetCP = pocetM ? parseInt(pocetM[1].replace(/[\s ]/g, ''), 10) : 0;
      // kurz směny na CZK (jen EUR) = 3-desetinné číslo na konci
      let kurzEUR = mena === 'EUR' ? DEFAULT_EUR : 1;
      if (mena === 'EUR') { const kM = line.match(/(\d{2},\d{3})\s*$/); if (kM) kurzEUR = parseNum(kM[1]); }
      out.push({ isin: curIsin, nazev: curName, mena, pocetCP, nakupNAV, nakupDatum, poplatek, kurzEUR });
      curIsin = '';
    }
  }
  return out;
}

/* ── PARSER: CONSEQ periodický výpis (vše v jednom) ── */
function parseConseq(lines) {
  const text = lines.join('\n');
  const isinM = text.match(/(CZ\d{10})/);
  if (!isinM) return [];
  const isin = isinM[1];
  // název: řádek s "Conseq …" před ISINem
  let nazev = 'Conseq fond';
  const nameLine = lines.find(l => /Conseq/i.test(l) && /\(/.test(l) && !/Investment Management/i.test(l));
  if (nameLine) nazev = nameLine.replace(/\s*CZ\d{10}.*$/, '').trim();

  // aktuální NAV: sekce "Stav investičního účtu"
  const holdIdx = lines.findIndex(l => /Stav investičního účtu/i.test(l));
  const holdDatum = parseDate((lines[holdIdx] || ''));
  let aktualNAV = 0, pocetCP = 0, aktualNativni = 0;
  // hledej řádek(y) po holdIdx s NAV (4 des.) a počtem
  for (let i = holdIdx; i < lines.length && i < holdIdx + 8; i++) {
    const navM = lines[i].match(/(\d+,\d{4})/);
    if (navM && /\d[\d\s ]*,\d{2}/.test(lines[i])) {
      aktualNAV = parseNum(navM[1]);
      const beforeNav = lines[i].slice(0, navM.index);
      const pocetM = beforeNav.match(/(\d[\d\s ]{2,}\d)/g);
      if (pocetM) pocetCP = parseInt(pocetM[pocetM.length - 1].replace(/[\s ]/g, ''), 10);
      const tot = [...lines[i].matchAll(/(\d[\d\s ]*,\d{2})/g)].map(m => parseNum(m[1]));
      if (tot.length) aktualNativni = tot[tot.length - 1];
      break;
    }
  }

  // nákupní NAV: řádek "Nákup"
  let nakupNAV = 0, poplatek = 0, nakupDatum = '', investovano = 0;
  const buyLine = lines.find(l => /Nákup/i.test(l) && /(\d+,\d{4})/.test(l));
  if (buyLine) {
    nakupNAV = parseNum(buyLine.match(/(\d+,\d{4})/)[1]);
    nakupDatum = parseDate(buyLine);
    const dvoudes = [...buyLine.matchAll(/(\d[\d\s ]*,\d{2})/g)].map(m => parseNum(m[1]));
    if (dvoudes.length) investovano = dvoudes[0];             // cena celkem (bez poplatku)
    const feeM = buyLine.match(/(\d[\d\s ]*,\d{2})\s*CZK\s*(\d[\d\s ]*,\d{2})\s*CZK/);
    // poplatky = 5 000,00 (druhá hodnota v bloku poplatky/celkem)
    poplatek = dvoudes.length >= 3 ? dvoudes[dvoudes.length - 2] : 0;
  }

  // hotovost (peněžní zůstatky celkem)
  let hotovostCZK = 0;
  const cashLine = lines.find(l => /Peněžní zůstatky celkem/i.test(l)) || lines.find(l => /Konečný zůstatek/i.test(l));
  if (cashLine) { const c = [...cashLine.matchAll(/(\d[\d\s ]*,\d{2})/g)].map(m => parseNum(m[1])); if (c.length) hotovostCZK = c[c.length - 1]; }

  // zhodnocení %
  let poznamka = '';
  const perfLine = lines.find(l => /Zhodnocení portfolia/i.test(l));
  if (perfLine) { const pM = perfLine.match(/(-?\d+,\d+)\s*%/); if (pM) poznamka = `Zhodnocení ${pM[1]} %`; }

  return [{
    isin, nazev, mena: 'CZK', pocetCP,
    nakupNAV, nakupDatum, poplatek,
    aktualNAV, aktualNAVdatum: holdDatum,
    kurzEUR: 1,
    _investovanoNativni: investovano || (pocetCP * nakupNAV),
    _aktualNativni: aktualNativni || (pocetCP * aktualNAV),
    hotovostCZK, poznamka
  }];
}

/* ── NÁHLED (editovatelný) ── */
function fundCZK(f, nav) { return Math.round(f.pocetCP * nav * (f.mena === 'EUR' ? (f.kurzEUR || DEFAULT_EUR) : 1)); }

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
    const investovanoCZK = nakupNAV ? Math.round(pocetCP * nakupNAV * fx) : '';
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
    loadInvestmentData();
  } catch (e) {
    toast('Chyba uložení: ' + e.message, 'err');
  }
}

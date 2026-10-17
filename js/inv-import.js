import { GAS_URL, FOND, FUND_FOCUS } from './config.js';
import { state } from './state.js';
import { toast } from './app.js';
import { loadInvestmentData } from './investments.js';
import { fetchSheet } from './utils.js';
import { DEFAULT_EUR, parseCodyaHoldings, parseCodyaTransactions, parseUnicredit, parseConseq } from './inv-parse.js';

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

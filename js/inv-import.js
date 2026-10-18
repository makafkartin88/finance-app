import { GAS_URL, FUND_FOCUS } from './config.js';
import { state } from './state.js';
import { toast } from './app.js';
import { loadInvestmentData } from './investments.js';
import { fetchSheet, postJson } from './utils.js';
import { DEFAULT_EUR, detectStatement, planAutoImport, buildFundRow } from './inv-parse.js';
import { escHtml, jsArg } from './html.js';

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

/* ── ČTENÍ PDF (pdf.js) → řádky + tokeny ──
   interactive=true: při chybějícím/špatném heslu se zeptá (ruční import).
   interactive=false: jen uložené heslo, jinak chyba — automatický import
   na pozadí nesmí uživatele přepadnout dialogem. */
async function readPdf(arrayBuffer, interactive) {
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj připojení');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  // UniCredit PDF bývá zaheslované — heslo se zeptá jednou a uloží se do
  // localStorage (repo je veřejné, takže nikdy do kódu).
  const savedPwd = localStorage.getItem(INV_PWD_KEY) || '';
  const task = pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false, password: savedPwd || undefined });
  let usedPwd = savedPwd;
  const pwdFail = new Promise((_, reject) => {
    task.onPassword = (updateCallback, reason) => {
      if (!interactive) { reject(new Error('PDF je zaheslované a uložené heslo nesedí')); task.destroy(); return; }
      const pwd = prompt(reason === 2 ? 'Nesprávné heslo, zadej znovu:' : 'Zadej heslo k PDF výpisu (zapamatuje se):');
      if (pwd !== null) { usedPwd = pwd.trim(); updateCallback(usedPwd); }
      else { reject(new Error('Import zrušen — heslo nebylo zadáno')); task.destroy(); }
    };
  });
  const pdf = await Promise.race([task.promise, pwdFail]);
  if (usedPwd) localStorage.setItem(INV_PWD_KEY, usedPwd);

  const lines = [];
  const allTokens = []; // tokeny v pořadí obsahu PDF — UniCredit se parsuje z nich
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
  return { lines, allTokens };
}

/* ── HLAVNÍ PROCESOR (ruční import s náhledem) ──
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
    const arrayBuffer = src instanceof ArrayBuffer ? src : await src.arrayBuffer();
    const { lines, allTokens } = await readPdf(arrayBuffer, true);
    const st = detectStatement(lines, allTokens);
    if (!st) throw new Error('Neznámý typ výpisu. Podporováno: CODYA (majetkový výpis / transakce), CONSEQ a UniCredit (majetkový účet CP).');
    if (!st.funds.length) throw new Error('Ve výpisu se nepodařilo najít žádné fondy (ISIN). Zkus jiný soubor.');
    status.style.display = 'none';
    showInvPreview(st.funds, st.provider, st.docLabel, fname);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${escHtml(e.message)}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Podporované výpisy: CODYA (majetkový výpis + transakce), CONSEQ a UniCredit.</p></div>`;
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
      <td style="min-width:150px"><input id="if-nazev-${i}" type="text" value="${escHtml(f.nazev || '')}"/><div style="font-size:10px;color:var(--text3);margin-top:2px">${escHtml(f.isin)} · ${escHtml(focus)}</div></td>
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
      <div style="font-size:13px"><strong>${escHtml(provider)}</strong> · ${escHtml(docType)}<div style="font-size:11px;color:var(--text3)">${escHtml(fname)} — ${funds.length} fondů · zkontroluj a uprav hodnoty</div></div>
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
    const num = (id, dflt) => { const v = g(id)?.value; return v === undefined || v === '' ? dflt : (parseFloat(v) || 0); };
    const mena = g('if-mena-')?.value || f.mena || 'CZK';
    return buildFundRow({
      ...f,
      nazev: g('if-nazev-')?.value.trim() || f.nazev || '',
      mena,
      pocetCP: num('if-pocet-', f.pocetCP),
      nakupNAV: num('if-nakup-', f.nakupNAV),
      aktualNAV: num('if-aktual-', f.aktualNAV),
      kurzEUR: num('if-kurz-', f.kurzEUR) || (mena === 'EUR' ? DEFAULT_EUR : 1),
      hotovostCZK: num('if-hotovost-', f.hotovostCZK),
    });
  });

  try {
    const d = await postJson({ action: 'upsertFund', values: rows });
    toast(`Uloženo ${rows.length} fondů`, 'ok');
    document.getElementById('invImpResults').style.display = 'none';
    closeInvImport();
    // Import z banneru → označit výpis za vyřízený, ať se nenabízí donekonečna
    if (state._ucpImportFileId) {
      try { await postJson({ action: 'markUcpImported', fileId: state._ucpImportFileId }); } catch (e2) {}
      state._ucpImportFileId = null;
      await loadUcpNotification({ auto: false });
    }
    loadInvestmentData();
  } catch (e) {
    toast('Chyba uložení: ' + e.message, 'err');
  }
}

/* ── VÝPISY ZACHYCENÉ V E-MAILU (UniCredit, CODYA, CONSEQ) ──
   GAS je každé pondělí stáhne z pošty do fronty (list UcpImport, ZIP
   z UniCreditu rovnou rozšifruje). Appka při otevření frontu projde a co
   projde pojistkami (planAutoImport), uloží SAMA bez klikání. Co neprojde,
   zůstane v banneru k ruční kontrole i s důvodem. */
const UCP_MONTHS = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
function ucpLabel(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${UCP_MONTHS[+m[2]] || m[2]} ${m[1]}` : '';
}

/* ── AUTOMATICKÝ IMPORT — stav ── */
const _autoNotes = {};          // fileId → proč se nedal naimportovat sám (pro banner)
const _autoTried = new Set();   // co už v tomhle otevření appky selhalo — nezkoušet dokola
let _autoBusy = false;

export async function loadUcpNotification({ auto = true } = {}) {
  try {
    const d = await fetchSheet(GAS_URL + '?sheet=UcpImport');
    const rows = (d.values || []).slice(1).filter(r => r[4] === 'new');
    state._ucpPending = rows
      .map(r => ({ filename: String(r[1] || ''), fileId: String(r[2] || ''), emailDate: String(r[3] || ''),
                   period: String(r[6] || ''), note: _autoNotes[r[2]] || String(r[7] || '') }))
      .sort((a, b) => b.emailDate.localeCompare(a.emailDate));
    if (state._ucpPending.length) showUcpBanner(0); else hideUcpBanner();
    if (auto && state._ucpPending.length) autoImportPending();
  } catch (e) { /* list ještě nemusí existovat */ }
}

async function autoImportPending() {
  if (_autoBusy || !state._invFresh) return;
  _autoBusy = true;
  let imported = 0;
  try {
    // Od nejstaršího, ať novější výpis vždy skončí jako poslední stav.
    const queue = (state._ucpPending || []).slice().reverse().filter(x => !_autoTried.has(x.fileId));
    for (const item of queue) {
      _autoTried.add(item.fileId);
      if (/\.zip$/i.test(item.filename)) continue; // ještě nerozšifrovaný ZIP — banner s poznámkou z GAS
      try {
        const d = await postJson({ action: 'getDriveFile', fileId: item.fileId }, { tries: 2 });
        const bin = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
        const { lines, allTokens } = await readPdf(bin.buffer, false);
        const st = detectStatement(lines, allTokens);
        if (!st) {
          // Bez jediného ISINu to výpis není (newsletter, smlouva…) → tiše odbavit.
          // S ISINem to nejspíš výpis je, jen ve formátu, který neznáme → banner.
          if (/\b[A-Z]{2}[A-Z0-9]{9}\d\b/.test(lines.join(' '))) _autoNotes[item.fileId] = 'Nerozpoznaný formát výpisu — zkontroluj ručně';
          else await postJson({ action: 'markUcpImported', fileId: item.fileId });
          continue;
        }
        const plan = planAutoImport(st.funds, st.provider, st.type, state.investments);
        if (!plan.ok) { _autoNotes[item.fileId] = 'Automatický import zastaven: ' + plan.reason; continue; }
        if (plan.stale) { await postJson({ action: 'markUcpImported', fileId: item.fileId }); continue; } // už zpracovaný / starší výpis
        await postJson({ action: 'upsertFund', values: plan.rows });
        await postJson({ action: 'markUcpImported', fileId: item.fileId });
        imported++;
        const k = st.funds[0]._statementDate || st.funds[0].aktualNAVdatum || '';
        toast(`✓ Importován výpis ${st.provider}${k ? ' k ' + k : ''} — ${plan.rows.length} fondů`, 'ok');
      } catch (e) {
        _autoNotes[item.fileId] = 'Automatický import selhal: ' + e.message;
      }
    }
  } finally {
    _autoBusy = false;
  }
  if (imported) await loadInvestmentData();
  await loadUcpNotification({ auto: false });
}

export function ucpPickPending(i) { showUcpBanner(Number(i)); }

function showUcpBanner(idx) {
  const banner = document.getElementById('invBanner');
  const list = state._ucpPending || [];
  const cur = list[idx];
  if (!banner || !cur) return;
  const label = p => ucpLabel(p.period) || p.filename;
  const picker = list.length > 1
    ? `<select class="sel" style="font-size:11px;padding:3px 6px" onchange="ucpPickPending(this.value)">
        ${list.slice(0, 12).map((p, i) => `<option value="${i}"${i === idx ? ' selected' : ''}>${escHtml(label(p))}</option>`).join('')}
       </select>` : '';
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span style="font-size:18px">📈</span>
    <div style="flex:1;min-width:180px">
      <div style="font-weight:600;font-size:13px">Investiční výpis k ruční kontrole${ucpLabel(cur.period) ? ' — ' + ucpLabel(cur.period) : ''}</div>
      <div style="font-size:12px;color:var(--text2)">${escHtml(cur.filename)}${list.length > 1 ? ` · čeká ${list.length}` : ''}</div>
      ${cur.note ? `<div style="font-size:11px;color:var(--amber-text)">⚠️ ${escHtml(cur.note)}</div>` : ''}
    </div>
    ${picker}
    <button class="btnp btnsm" onclick="importUcpFromDrive(${jsArg(cur.fileId)},${jsArg(cur.filename)})">Zkontrolovat a importovat</button>
    <button class="btn btnsm" onclick="ucpMarkDone(${jsArg(cur.fileId)})" title="Skrýt natrvalo">✓ Už mám</button>
    <button class="btn btnsm" onclick="hideUcpBanner()" title="Skrýt jen teď">✕</button>`;
}

export function hideUcpBanner() {
  const b = document.getElementById('invBanner');
  if (b) b.style.display = 'none';
}

export async function ucpMarkDone(fileId) {
  try { await postJson({ action: 'markUcpImported', fileId }); } catch (e) {}
  await loadUcpNotification({ auto: false });
}

export async function ucpCheckMail() {
  toast('Kontroluji poštu…');
  try {
    const d = await postJson({ action: 'checkInvestEmail' });
    await loadUcpNotification();
    const n = (state._ucpPending || []).length;
    toast(d.added ? `Nalezeno ${d.added} nových výpisů` : (n ? `Nic nového · čeká ${n}` : 'Žádné nové výpisy'), 'ok');
  } catch (e) { toast('Kontrola pošty selhala: ' + e.message, 'err'); }
}

export async function importUcpFromDrive(fileId, filename) {
  openInvImport();
  const status = document.getElementById('invImpStatus');
  status.style.display = 'block';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">Stahuji výpis z Disku…</div>`;
  try {
    const d = await postJson({ action: 'getDriveFile', fileId }, { tries: 2 });
    const bin = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    state._ucpImportFileId = fileId;
    await procInvFile(bin.buffer, d.name || filename);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba stažení: ${escHtml(e.message)}</p></div>`;
  }
}

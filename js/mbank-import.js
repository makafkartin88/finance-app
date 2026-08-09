import { GAS_URL } from './config.js';
import { state } from './state.js';
import { parseRow } from './utils.js';
import { toast, boot } from './app.js';

// Heslo k PDF výpisu — jen localStorage, nikdy v kódu (repo je veřejné)
const MBANK_PWD_KEY = 'mbankPdfPwd';

/* ── MODAL CONTROL ── */
export function openMbankImport() {
  document.getElementById('mbankResults').style.display = 'none';
  document.getElementById('mbankStatus').style.display = 'none';
  document.getElementById('mbankModal').style.display = 'flex';
}
export function closeMbankImport() {
  document.getElementById('mbankModal').style.display = 'none';
}

/* ── DRAG-DROP ── */
export function mbankDov(e) { e.preventDefault(); document.getElementById('mbankZone').classList.add('over'); }
export function mbankDol()  { document.getElementById('mbankZone').classList.remove('over'); }
export function mbankDod(e) { e.preventDefault(); mbankDol(); const f = e.dataTransfer.files[0]; if (f) procMbankFile(f); }
export function onMbankFile(e) { const f = e.target.files[0]; if (f) procMbankFile(f); }

/* ── MAIN PROCESSOR ──
   `src` je buď File (drag-drop / výběr souboru), nebo ArrayBuffer
   (stažení z Disku přes GAS — viz importMbankFromDrive). */
async function procMbankFile(src, srcName) {
  const status  = document.getElementById('mbankStatus');
  const results = document.getElementById('mbankResults');
  status.style.display = 'block';
  results.style.display = 'none';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">
    <div style="width:28px;height:28px;border:2px solid rgba(55,138,221,.3);border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .8s linear infinite"></div>
    Čtu PDF výpis…
  </div>`;

  const fname = srcName || src.name;
  if (!state._mbankImportFile) state._mbankImportFile = fname;

  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj internetové připojení');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Heslo: z pole v modalu, jinak zapamatované z minula (localStorage —
    // repo je veřejné, heslo tedy NIKDY do kódu). Po úspěchu se uloží,
    // takže další výpisy už heslo nevyžadují.
    const password = document.getElementById('mbankPassword')?.value
      || localStorage.getItem(MBANK_PWD_KEY) || '';
    const osoba    = document.getElementById('mbankOsoba')?.value || state.person || 'Martin';

    const arrayBuffer = src instanceof ArrayBuffer ? src : await src.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: password || undefined });

    let usedPwd = password;
    loadingTask.onPassword = (updateCallback, reason) => {
      const msg = reason === 2 ? 'Nesprávné heslo, zadej znovu:' : 'Zadej heslo k PDF výpisu:';
      const pwd = prompt(msg);
      if (pwd !== null) { usedPwd = pwd; updateCallback(pwd); }
      else throw new Error('Import zrušen — heslo nebylo zadáno');
    };

    const pdf = await loadingTask.promise;
    if (usedPwd) localStorage.setItem(MBANK_PWD_KEY, usedPwd);

    // Collect all text items with position and page info
    const allItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      content.items.forEach(item => {
        if (item.str.trim()) {
          allItems.push({ str: item.str, x: item.transform[4], y: item.transform[5], page: p });
        }
      });
    }

    const rows = parseMbankItems(allItems, osoba);
    if (!rows.length) throw new Error('Nenalezeny žádné transakce. Ověř že nahráváš výpis z mBank (ne jiný dokument).');

    status.style.display = 'none';
    showMbankPreview(rows, fname);
  } catch(e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Ujisti se, že nahráváš PDF výpis z mBank a zadal správné heslo.</p>
    </div>`;
  }
}

/* ── ČÍSLA ÚČTŮ (rozpoznání převodů Martin ↔ Šárka) ──
   Výpis uvádí protistranu ve tvaru "000000-2379078011/3030", uživatel si
   ale v nastavení může zapsat "2379078011/3030" — normalizace obojí srovná
   (zahodí mezery a vedoucí nuly v předčíslí i čísle). */
const ACCT_RE = /(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})/;
function normAccount(s) {
  const m = String(s || '').replace(/\s/g, '').match(ACCT_RE);
  if (!m) return '';
  const pre = m[1] ? String(parseInt(m[1], 10)) : '0';
  return (pre === '0' ? '' : pre + '-') + String(parseInt(m[2], 10)) + '/' + m[3];
}
// "účty z nastavení" (jeden na řádek / oddělené čárkou) → Set normalizovaných
function acctSet(raw) {
  return new Set(String(raw || '').split(/[\n,;]+/).map(normAccount).filter(Boolean));
}

/* ── PDF PARSER ── (exportováno kvůli ověřitelnosti bez reálného PDF) */
export function parseMbankItems(items, osoba) {
  // Sort: page asc → Y desc (top of page = high Y in pdf.js) → X asc
  items.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  // Group into visual lines by Y proximity (tolerance ±4px)
  const lines = [];
  let prevY = null, prevPage = null, tokens = [];

  for (const item of items) {
    const sameRow = prevY !== null && item.page === prevPage && Math.abs(item.y - prevY) <= 4;
    if (sameRow) {
      tokens.push(item.str);
    } else {
      if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim());
      tokens    = [item.str];
      prevY     = item.y;
      prevPage  = item.page;
    }
  }
  if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim());

  // Czech currency: 1-3 digits, optional (space + exactly 3 digits), comma, 2 decimals
  const AMT   = '(-?\\d{1,3}(?:\\s\\d{3})*,\\d{2})';
  // Support both formats:
  //   Monthly:       "11 01.03.2026 01.03.2026 POPIS -502,89 880,67"  (with leading row number)
  //   Custom period: "01.03.2026 01.03.2026 POPIS -502,89 880,67"     (without row number)
  const txRe  = new RegExp(`^(?:\\d{1,3}\\s+)?(\\d{2}\\.\\d{2}\\.\\d{4})\\s+\\d{2}\\.\\d{2}\\.\\d{4}\\s+(.+?)\\s+${AMT}\\s+${AMT}\\s*$`);
  const headRe = /^(?:\d{1,3}\s+)?\d{2}\.\d{2}\.\d{4}/;
  const stopRe = /^(Konečný|Počáteční|Strana|Přehled|mBank\s+S\.|Prosíme|Č\.\s+Datum|Datum\s+za)/i;

  const transactions = [];
  const mAcc = acctSet(state.cfg.uctyMartin), sAcc = acctSet(state.cfg.uctySarka);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m    = line.match(txRe);

    if (m) {
      const dateStr  = m[1];
      const mainDesc = m[2].trim();
      const amtStr   = m[3];

      // Collect continuation lines (sub-rows of the description cell)
      const cont = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (headRe.test(next) || stopRe.test(next)) break;
        cont.push(next);
        j++;
      }
      i = j;

      const amt = parseFloat(amtStr.replace(/\s/g, '').replace(',', '.'));
      if (isNaN(amt) || amt === 0) continue;

      // Skip interest / withholding tax rows
      const full = (mainDesc + ' ' + cont.join(' ')).toUpperCase();
      if (full.includes('PŘIPSÁNÍ ÚROKŮ') || full.includes('DAŇ Z PŘIPSÁNÍ')) continue;

      // Skip internal own-account transfers:
      // 1) VLASTNÍ PŘEVOD — always between own mBank accounts
      // 2) Any incoming transfer where counterparty account is own mBank account (670100-xxxxxxxx/6210)
      const mainUp = mainDesc.toUpperCase();
      const contAccount = cont[1] || '';
      const bilUcet = (state.cfg.bilanceUcet || '670100-2230152615/6210').trim();
      const isOwnAccount = bilUcet ? contAccount.startsWith(bilUcet) : /^670100-\d+\/6210/.test(contAccount);
      if (mainUp.startsWith('VLASTNÍ PŘEVOD')) { i = j; continue; }
      if (isOwnAccount && (
        mainUp.startsWith('PŘÍCHOZÍ PLATBA Z MBANK') ||
        mainUp.startsWith('PŘÍCHOZÍ OKAMŽITÁ PLATBA') ||
        mainUp.startsWith('PŘÍCHOZÍ PLATBA')
      )) { i = j; continue; }

      const { popis, protistrana, metoda } = splitDesc(mainDesc, cont);
      // For PLATBA KARTOU cont structure differs — poznamka not applicable
      const poznamka = mainUp.startsWith('PLATBA KARTOU')
        ? ''
        : cont.slice(2).join(' ').replace(/\b[A-Z]{2}:\d+\b/g, '').trim();

      const txTyp = amt < 0 ? 'Výdaj' : 'Příjem';

      // Bilance Martin ↔ Šárka — pozná se podle účtu protistrany (kdekoli
      // v podřádcích, ne jen na fixní pozici). „osoba" = KDO POSLAL peníze,
      // což odpovídá konvenci u typu Vyrovnání (převod od Martina bilanci
      // zvyšuje, od Šárky snižuje) — u příjmu tedy majitel protiúčtu,
      // u výdaje majitel výpisu.
      const cpAcc = normAccount(cont.find(c => ACCT_RE.test(c)) || '');
      const cpOwner = cpAcc && (mAcc.has(cpAcc) ? 'Martin' : sAcc.has(cpAcc) ? 'Šárka' : null);
      const bilance = !!cpOwner;
      const rowOsoba = bilance ? (txTyp === 'Příjem' ? cpOwner : osoba) : osoba;

      transactions.push({
        datum:       mbankDateToIso(dateStr),
        popis,
        castka:      Math.abs(amt),
        typ:         txTyp,
        kategorie:   guessCategory(popis, protistrana),
        ucet:        'Společný účet',
        metoda:      metoda || 'Převod',
        protistrana,
        poznamka,
        osoba:       rowOsoba,
        bilance,
        _cpAcc:      cpAcc,
        _dupTx: findDuplicate(dateStr, Math.abs(amt), txTyp)
      });
    } else {
      i++;
    }
  }

  return transactions;
}

function splitDesc(mainDesc, cont) {
  // PLATBA KARTOU — two possible formats:
  // Monthly:       cont[0]="DATUM PROVEDENÍ TRANSAKCE: YYYY-MM-DD"
  //                cont[1]="Merchant CZ -xxx,xx CZK -xxx CZK4461 XXXX XXXX 7755"
  // Custom period: cont[0]="Merchant Name DATUM PROVEDENÍ TRANSAKCE:"
  //                cont[1]="YYYY-MM-DD"
  if (mainDesc.toUpperCase().startsWith('PLATBA KARTOU')) {
    let raw = '';
    if (cont[0] && /^DATUM PROVEDENÍ/i.test(cont[0])) {
      // Monthly format — merchant in cont[1]
      raw = cont[1] || '';
    } else {
      // Custom period format — merchant in cont[0], strip trailing "DATUM PROVEDENÍ..."
      raw = (cont[0] || '').replace(/\s*DATUM PROVEDENÍ.*$/i, '').trim();
    }
    // Strip country code + amount suffix (monthly format): " CZ -1 234,56 CZK ..."
    const merchant = raw.replace(/\s+[A-Z]{2}\s+-[\d\s,]+CZK.*$/i, '').trim();
    return { popis: merchant || 'Platba kartou', protistrana: merchant, metoda: 'Karta' };
  }

  const known = [
    'PŘÍCHOZÍ OKAMŽITÁ PLATBA', 'PŘÍCHOZÍ PLATBA Z MBANK',
    'PŘÍCHOZÍ PLATBA', 'ODCHOZÍ PLATBA', 'KARETNÍ TRANSAKCE', 'INKASO', 'VKLAD'
  ];
  for (const k of known) {
    if (mainDesc.toUpperCase().startsWith(k)) {
      return { popis: k.charAt(0) + k.slice(1).toLowerCase(), protistrana: cont[0] || '', metoda: 'Převod' };
    }
  }
  return { popis: mainDesc, protistrana: cont[0] || '', metoda: 'Převod' };
}

function mbankDateToIso(czDate) {
  const [d, m, y] = czDate.split('.');
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function findDuplicate(czDate, amt, typ) {
  const isoMs = Date.parse(mbankDateToIso(czDate));
  if (isNaN(isoMs)) return null;
  return state.txs.find(t => {
    if (t.typ !== typ) return false;
    const tMs = new Date(t.datum).getTime();
    if (isNaN(tMs)) return false;
    return Math.abs(tMs - isoMs) <= 2 * 86400000
      && Math.abs(t.castka - amt) / Math.max(amt, 0.01) <= 0.10;
  }) || null;
}

function guessCategory(popis, protistrana) {
  const text = (popis + ' ' + protistrana).toLowerCase();
  if (/nájem|nájemné|hypotéka|elektřina|plyn|voda|internet|ikea|obi|hornbach|sconto|action b/.test(text)) return 'Bydlení';
  if (/albert|billa|lidl|kaufland|tesco|penny|globus|rohlík|košík|potraviny|rossmann/.test(text)) return 'Jídlo';
  if (/shell|benzín|čerpací|parkoviště|parking|dpp|pid|lítačka|vlak|bus/.test(text)) return 'Doprava';
  if (/kino|cinema|spotify|netflix|steam|xbox|restaurace|hospoda|kavárna|pho |sushi|pizz/.test(text)) return 'Zábava';
  if (/lékárna|doktor|nemocnice|pojišt|zdraví/.test(text)) return 'Zdraví';
  if (/trading 212|degiro|fond|etf|akcie|investic/.test(text)) return 'Investice';
  if (/příchozí|mzda|výplata|plat/.test(text)) return 'Příjem';
  if (/sinsay|h&m|zara|reserved|m&s|marks|primark|pepco/.test(text)) return 'Ostatní';
  return 'Ostatní';
}

/* ── PREVIEW TABLE ── */
function showMbankPreview(rows, fname) {
  const results = document.getElementById('mbankResults');
  results.style.display = 'block';

  const cats     = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní','Příjem'];
  const dupCount = rows.filter(r => r._dupTx).length;
  const dupNote  = dupCount
    ? `<div style="color:var(--amber-text);background:var(--amber-bg);padding:8px 12px;border-radius:var(--rsm);font-size:12px;margin-bottom:10px">⚠ ${dupCount} ${dupCount === 1 ? 'transakce vypadá jako duplicitní' : 'transakcí vypadá jako duplicitních'} — odznačeny. Klikni na <strong>!</strong> pro náhled existující transakce.</div>`
    : '';

  const trs = rows.map((r, i) => {
    const dup = r._dupTx;
    const dupBtn = dup
      ? `<button onclick="toggleMbankDupDetail(${i})" title="Zobrazit existující transakci" style="display:block;margin:3px auto 0;background:var(--amber-bg);color:var(--amber-text);border:1.5px solid var(--amber-text);border-radius:50%;width:20px;height:20px;font-size:11px;font-weight:700;cursor:pointer;padding:0;line-height:1.6">!</button>`
      : '';

    let dupDetailRow = '';
    if (dup) {
      const p = (dup.datum || '').split('/');
      const dispDate = p.length === 3
        ? `${p[2]}-${String(p[0]).padStart(2,'0')}-${String(p[1]).padStart(2,'0')}`
        : dup.datum;
      const info = [dispDate, dup.popis, dup.protistrana, `${dup.castka} Kč`, dup.ucet, dup.kategorie].filter(Boolean).join(' · ');
      const openBtn = dup.id
        ? `<button onclick="openEdit('${dup.id}')" style="margin-left:10px;font-size:11px;padding:2px 8px;cursor:pointer;background:var(--amber-text);color:#fff;border:none;border-radius:4px;white-space:nowrap">Otevřít →</button>`
        : '';
      dupDetailRow = `<tr id="mbdup-${i}" style="display:none"><td></td><td colspan="6" style="background:var(--amber-bg);padding:6px 12px;font-size:12px;color:var(--text1);border-bottom:1px solid var(--border)"><span style="color:var(--amber-text);font-weight:600">Existující:</span> ${info}${openBtn}</td></tr>`;
    }

    return `<tr style="${dup ? 'opacity:.55' : ''}">
    <td style="text-align:center;vertical-align:top;padding-top:8px">
      <input type="checkbox" id="mbc-${i}" ${dup ? '' : 'checked'}>
      ${dupBtn}
    </td>
    <td><input id="mbd-${i}" type="date" value="${r.datum}" style="min-width:130px"/></td>
    <td>
      <input id="mbs-${i}" type="text" value="${r.popis}" style="min-width:150px;margin-bottom:4px"/>
      <input id="mbi-${i}" type="text" value="${r.protistrana}" placeholder="Protistrana" style="min-width:150px"/>
    </td>
    <td>
      <select id="mbt-${i}" class="sel" style="font-size:11px;padding:3px 6px;margin-bottom:4px">
        <option ${r.typ==='Výdaj'?'selected':''}>Výdaj</option>
        <option ${r.typ==='Příjem'?'selected':''}>Příjem</option>
      </select>
      <select id="mbk-${i}" class="sel" style="font-size:11px;padding:3px 6px">
        ${cats.map(c => `<option ${c===r.kategorie?'selected':''}>${c}</option>`).join('')}
      </select>
    </td>
    <td><select id="mbp-${i}" class="sel" style="font-size:11px;padding:3px 6px">
      <option ${r.osoba==='Martin'?'selected':''}>Martin</option>
      <option ${r.osoba==='Šárka'?'selected':''}>Šárka</option>
    </select></td>
    <td style="text-align:center">
      <input type="checkbox" id="mbb-${i}" ${r.bilance ? 'checked' : ''} title="Počítat do bilance Martin ↔ Šárka"/>
      ${r._cpAcc ? `<div style="font-size:10px;color:var(--text3);margin-top:2px;white-space:nowrap">${r._cpAcc}</div>` : ''}
    </td>
    <td><input id="mbm-${i}" type="number" min="0" step="0.01" value="${r.castka}" style="min-width:90px"/></td>
  </tr>${dupDetailRow}`;
  }).join('');

  results.innerHTML = `<div class="card" style="padding:0">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:14px;font-weight:700;margin-bottom:6px">Nalezeno ${rows.length} transakcí — ${fname}</div>
      ${dupNote}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btnp" onclick="confirmMbankImport()">Uložit zaškrtnuté</button>
        <button class="btn" onclick="document.getElementById('mbankResults').style.display='none'">Zrušit</button>
      </div>
    </div>
    <div class="tw"><table>
      <thead><tr><th style="width:36px">✓</th><th>Datum</th><th>Popis / protistrana</th><th>Typ / kategorie</th><th>Osoba</th><th style="width:44px" title="Počítat do bilance Martin ↔ Šárka">⇄</th><th>Částka</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>
  </div>`;

  state._mbankRows = rows;
}

export function toggleMbankDupDetail(i) {
  const el = document.getElementById('mbdup-' + i);
  if (el) el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
}

/* ── CONFIRM & SAVE ── */
export async function confirmMbankImport() {
  // Prevent double-click: disable button immediately
  const btn = document.querySelector('#mbankResults .btnp');
  if (btn) { btn.disabled = true; btn.textContent = 'Ukládám…'; }

  const rows = state._mbankRows || [];
  const mn   = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const allRows = [];

  for (let i = 0; i < rows.length; i++) {
    if (!document.getElementById('mbc-'+i)?.checked) continue;

    const isoDate = document.getElementById('mbd-'+i)?.value || rows[i].datum;
    const popis   = (document.getElementById('mbs-'+i)?.value || rows[i].popis).trim();
    const proti   = (document.getElementById('mbi-'+i)?.value || rows[i].protistrana || '').trim();
    const typ     = document.getElementById('mbt-'+i)?.value || rows[i].typ;
    const kat     = document.getElementById('mbk-'+i)?.value || rows[i].kategorie;
    const osoba   = document.getElementById('mbp-'+i)?.value || rows[i].osoba || 'Martin';
    const metoda  = rows[i].metoda || 'Převod';
    const bilance = document.getElementById('mbb-'+i)?.checked ? 'TRUE' : 'FALSE';
    const castka  = Math.abs(parseFloat(document.getElementById('mbm-'+i)?.value || rows[i].castka) || 0);

    if (!isoDate || !popis || !castka) continue;

    const [yp, mp, dp] = isoDate.split('-');
    const sheetDate = `${parseInt(mp)}/${parseInt(dp)}/${yp}`;
    const mesic     = `${mn[parseInt(mp)]} ${yp}`;
    const sign      = typ === 'Příjem' ? castka : -castka;
    const id        = `${yp}${mp}${dp}-mb${String(state.txs.length + allRows.length + 1).padStart(3,'0')}`;

    // Pořadí musí odpovídat mapě C v config.js — poslední sloupec (index 19)
    // je `bilance`; dřív se neposílal vůbec, takže se převody mezi Martinem
    // a Šárkou z importu nikdy do bilance nezapočítaly.
    const row = [sheetDate, popis, castka, 'CZK', rows[i].ucet || 'Společný účet', typ, kat, osoba, metoda,
                 proti, rows[i].poznamka || '', sign, mesic, yp, id,
                 typ==='Výdaj'?castka:0, typ==='Příjem'?castka:0, sign, '', bilance];
    allRows.push(row);
  }

  // Add to local state immediately
  allRows.forEach(row => state.txs.push(parseRow(row)));

  // Send all rows in a single batch POST to Transakce sheet
  if (allRows.length) {
    try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Transakce', values: allRows }) }); } catch(e) {}
  }

  document.getElementById('mbankResults').style.display = 'none';
  state._mbankRows = null;
  boot();
  toast(`${allRows.length} transakcí importováno z mBank`, 'ok');

  // Mark notification as imported
  const fname = state._mbankImportFile;
  if (fname) {
    try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'markMbankImported', filename: fname }) }); } catch(e) {}
    hideMbankBanner();
    state._mbankImportFile = null;
  }
}

/* ── NOTIFICATIONS (semi-automation) ── */
export async function loadMbankNotification() {
  try {
    const r = await fetch(GAS_URL + '?sheet=MbankImport');
    const d = await r.json();
    if (!d.values || d.values.length < 2) return;
    const newRows = d.values.slice(1).filter(r => r[4] === 'new');
    if (newRows.length) {
      const latest = newRows[newRows.length - 1];
      showMbankBanner(latest[1], latest[2]); // [filename, file_id (starší řádky: celá Drive URL)]
    }
  } catch(e) {}
}

function showMbankBanner(filename, driveRef) {
  const banner = document.getElementById('mbankBanner');
  if (!banner) return;
  state._mbankImportFile = filename;
  // Nové řádky ukládají rovnou fileId (soubor je privátní, čte ho jen GAS).
  // Starší řádky (před opravou sdílení) mají celou Drive URL — z ní se
  // fileId vytáhne stejně jako dřív, ať staré položky v banneru nezůstanou
  // nefunkční.
  const fileId = /^[A-Za-z0-9_-]{20,}$/.test(driveRef) ? driveRef
    : (String(driveRef || '').match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  const esc = s => String(s).replace(/'/g, "\\'");
  banner.style.display = 'flex';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap">
      <span style="font-size:20px">📄</span>
      <div>
        <div style="font-size:13px;font-weight:600">Nový výpis z mBank k importu</div>
        <div style="font-size:11px;color:var(--text2)">${filename}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0;align-items:center">
      ${fileId
        ? `<button class="btnp btnsm" onclick="importMbankFromDrive('${esc(fileId)}','${esc(filename)}')">Načíst a zobrazit návrh →</button>`
        : `<button class="btnp btnsm" onclick="openMbankImport()">Importovat →</button>`}
      <button class="btn btnsm" onclick="hideMbankBanner()">✕</button>
    </div>`;
}

/* ── IMPORT Z DRIVE (přes GAS, žádný CORS ani ruční stahování) ──
   GAS vrátí PDF jako base64 → pdf.js ho rozparsuje se zapamatovaným heslem
   → rovnou se zobrazí náhled navržených transakcí. */
export async function importMbankFromDrive(fileId, filename) {
  openMbankImport();
  const status = document.getElementById('mbankStatus');
  status.style.display = 'block';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">Stahuji výpis z Disku…</div>`;
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'getDriveFile', fileId }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const bin = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    state._mbankImportFile = filename;
    await procMbankFile(bin.buffer, d.name || filename);
  } catch (e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba stažení: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Zkus výpis nahrát ručně přetažením do okna výše.</p></div>`;
  }
}

export function hideMbankBanner() {
  const b = document.getElementById('mbankBanner');
  if (b) b.style.display = 'none';
}

import { GAS_URL } from './config.js';
import { state } from './state.js';
import { parseRow } from './utils.js';
import { toast, boot } from './app.js';

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

/* ── MAIN PROCESSOR ── */
async function procMbankFile(file) {
  const status  = document.getElementById('mbankStatus');
  const results = document.getElementById('mbankResults');
  status.style.display = 'block';
  results.style.display = 'none';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">
    <div style="width:28px;height:28px;border:2px solid rgba(55,138,221,.3);border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .8s linear infinite"></div>
    Čtu PDF výpis…
  </div>`;

  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj internetové připojení');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const password = document.getElementById('mbankPassword')?.value || '';
    const osoba    = document.getElementById('mbankOsoba')?.value || state.person || 'Martin';

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: password || undefined });

    loadingTask.onPassword = (updateCallback, reason) => {
      const msg = reason === 2 ? 'Nesprávné heslo, zadej znovu:' : 'Zadej heslo k PDF výpisu:';
      const pwd = prompt(msg);
      if (pwd !== null) updateCallback(pwd);
      else throw new Error('Import zrušen — heslo nebylo zadáno');
    };

    const pdf = await loadingTask.promise;

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
    showMbankPreview(rows, file.name);
  } catch(e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Ujisti se, že nahráváš PDF výpis z mBank a zadal správné heslo.</p>
    </div>`;
  }
}

/* ── PDF PARSER ── */
function parseMbankItems(items, osoba) {
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
  const txRe  = new RegExp(`^(\\d{1,3})\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+\\d{2}\\.\\d{2}\\.\\d{4}\\s+(.+?)\\s+${AMT}\\s+${AMT}\\s*$`);
  const headRe = /^\d{1,3}\s+\d{2}\.\d{2}\.\d{4}/;
  const stopRe = /^(Konečný|Počáteční|Strana\s+\d|Přehled|mBank\s+S\.|Prosíme|Č\.\s+Datum)/i;

  const transactions = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m    = line.match(txRe);

    if (m) {
      const dateStr  = m[2];
      const mainDesc = m[3].trim();
      const amtStr   = m[4];

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
      const isOwnAccount = /^670100-\d+\/6210/.test(contAccount);
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

      transactions.push({
        datum:       mbankDateToIso(dateStr),
        popis,
        castka:      Math.abs(amt),
        typ:         amt < 0 ? 'Výdaj' : 'Příjem',
        kategorie:   guessCategory(popis, protistrana),
        ucet:        'mBank',
        metoda:      metoda || 'Převod',
        protistrana,
        poznamka,
        osoba,
        _dup: isDuplicate(dateStr, Math.abs(amt))
      });
    } else {
      i++;
    }
  }

  return transactions;
}

function splitDesc(mainDesc, cont) {
  // PLATBA KARTOU has a different continuation structure:
  // cont[0] = "DATUM PROVEDENÍ TRANSAKCE: YYYY-MM-DD"
  // cont[1] = "Merchant Name CZ -xxx,xx CZK ..."
  // cont[2] = "-xxx,xx CZK4461 XXXX XXXX 7755"
  if (mainDesc.toUpperCase().startsWith('PLATBA KARTOU')) {
    const raw = cont[1] || cont[0] || '';
    // Strip country code + amount suffix: " CZ -1 234,56 CZK ..." or " CZ -1234,56 CZK..."
    const merchant = raw.replace(/\s+[A-Z]{2}\s+-[\d\s,]+CZK.*$/i, '').trim();
    return { popis: 'Platba kartou', protistrana: merchant, metoda: 'Karta' };
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

function isDuplicate(czDate, amt) {
  const iso = mbankDateToIso(czDate);
  return state.txs.some(t => {
    // Convert stored datum (M/D/YYYY) back to ISO for comparison
    const p = (t.datum || '').split('/');
    const tIso = p.length === 3
      ? `${p[2]}-${String(p[0]).padStart(2,'0')}-${String(p[1]).padStart(2,'0')}`
      : '';
    return tIso === iso && Math.abs(t.castka - amt) < 0.01 && t.ucet === 'mBank';
  });
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

  const cats    = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní','Příjem'];
  const dupCount = rows.filter(r => r._dup).length;
  const dupNote  = dupCount
    ? `<div style="color:var(--amber-text);background:var(--amber-bg);padding:8px 12px;border-radius:var(--rsm);font-size:12px;margin-bottom:10px">⚠️ ${dupCount} transakcí vypadá jako duplicitní (stejné datum + částka). Odznač je pokud je nechceš importovat.</div>`
    : '';

  const trs = rows.map((r, i) => `<tr style="${r._dup ? 'opacity:.45' : ''}">
    <td style="text-align:center"><input type="checkbox" id="mbc-${i}" ${r._dup ? '' : 'checked'}></td>
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
    <td><input id="mbm-${i}" type="number" min="0" step="0.01" value="${r.castka}" style="min-width:90px"/></td>
  </tr>`).join('');

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
      <thead><tr><th style="width:36px">✓</th><th>Datum</th><th>Popis / protistrana</th><th>Typ / kategorie</th><th>Osoba</th><th>Částka</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>
  </div>`;

  state._mbankRows = rows;
}

/* ── CONFIRM & SAVE ── */
export async function confirmMbankImport() {
  const rows = state._mbankRows || [];
  const mn   = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let saved  = 0;

  for (let i = 0; i < rows.length; i++) {
    if (!document.getElementById('mbc-'+i)?.checked) continue;

    const isoDate = document.getElementById('mbd-'+i)?.value || rows[i].datum;
    const popis   = (document.getElementById('mbs-'+i)?.value || rows[i].popis).trim();
    const proti   = (document.getElementById('mbi-'+i)?.value || rows[i].protistrana || '').trim();
    const typ     = document.getElementById('mbt-'+i)?.value || rows[i].typ;
    const kat     = document.getElementById('mbk-'+i)?.value || rows[i].kategorie;
    const osoba   = document.getElementById('mbp-'+i)?.value || rows[i].osoba || 'Martin';
    const castka  = Math.abs(parseFloat(document.getElementById('mbm-'+i)?.value || rows[i].castka) || 0);

    if (!isoDate || !popis || !castka) continue;

    const [yp, mp, dp] = isoDate.split('-');
    const sheetDate = `${parseInt(mp)}/${parseInt(dp)}/${yp}`;
    const mesic     = `${mn[parseInt(mp)]} ${yp}`;
    const sign      = typ === 'Příjem' ? castka : -castka;
    const id        = `${yp}${mp}${dp}-mb${String(state.txs.length + 1).padStart(3,'0')}`;

    const row = [sheetDate, popis, castka, 'CZK', 'mBank', typ, kat, osoba, 'Převod',
                 proti, rows[i].poznamka || '', sign, mesic, yp, id,
                 typ==='Výdaj'?castka:0, typ==='Příjem'?castka:0, sign, ''];

    state.txs.push(parseRow(row));
    try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ values: [row] }) }); } catch(e) {}
    saved++;
  }

  document.getElementById('mbankResults').style.display = 'none';
  boot();
  toast(`${saved} transakcí importováno z mBank`, 'ok');

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
      showMbankBanner(latest[1], latest[2]); // [filename, driveUrl]
    }
  } catch(e) {}
}

function showMbankBanner(filename, driveUrl) {
  const banner = document.getElementById('mbankBanner');
  if (!banner) return;
  state._mbankImportFile = filename;
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
      ${driveUrl ? `<a href="${driveUrl}" target="_blank" class="btn btnsm">⬇ Stáhnout</a>` : ''}
      <button class="btnp btnsm" onclick="openMbankImport()">Importovat →</button>
      <button class="btn btnsm" onclick="hideMbankBanner()">✕</button>
    </div>`;
}

export function hideMbankBanner() {
  const b = document.getElementById('mbankBanner');
  if (b) b.style.display = 'none';
}

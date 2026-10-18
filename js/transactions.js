import { escHtml, jsArg, safeUrl } from './html.js';
import { state } from './state.js';
import { fmtD, czk, parseRow, base, postJson, isoDate } from './utils.js';
import { newId } from './tx-core.js';
import { toast, boot } from './app.js';
import { applyColumnFilters, applySort, attachRowInteractions, closePopover, thFilter, thAmount, thSort } from './table-filters.js';

let _searchTimer = null;
export function searchTx() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(renderTx, 200);
}

export function renderTx() {
  closePopover();
  const m = document.getElementById('txfMonth')?.value || '';
  const c = document.getElementById('txfCat')?.value || '';
  const a = document.getElementById('txfAcc')?.value || '';
  const q = (document.getElementById('txSearch')?.value || '').toLowerCase().trim();
  let list = base(m || null, c || null);
  if (a) list = list.filter(t => t.ucet === a);
  if (q) list = list.filter(t =>
    (t.popis||'').toLowerCase().includes(q) ||
    (t.protistrana||'').toLowerCase().includes(q) ||
    (t.poznamka||'').toLowerCase().includes(q) ||
    (t.kategorie||'').toLowerCase().includes(q)
  );

  // Render dynamic header
  const head = document.getElementById('txHead');
  if (head) {
    head.innerHTML = `<tr>
      ${thSort('tx','datum','Datum')}
      ${thSort('tx','popis','Popis')}
      ${thFilter('tx','kategorie','Kategorie')}
      ${thSort('tx','typ','Typ')}
      ${thSort('tx','ucet','Účet')}
      ${thSort('tx','metoda','Metoda')}
      ${thSort('tx','protistrana','Protistrana')}
      <th style="text-align:center">Účtenka</th>
      ${thAmount('tx','Částka')}
      <th></th>
    </tr>`;
  }

  // Apply column filters and sort (bez vybraného sloupce = výchozí, nejnovější nahoře)
  list = applyColumnFilters(list, 'tx');
  list = applySort(list, 'tx');

  document.getElementById('txBody').innerHTML = list.map((t,i) => {
    const cls = t.typ === 'Příjem' ? 'ap' : t.typ === 'Vyrovnání' ? 'av' : t.kategorie === 'Investice' ? 'ai' : 'an';
    const bilMark = (t.bilance && t.typ !== 'Vyrovnání') ? ' <span class="av" title="Počítá se do bilance Martin ↔ Šárka">⇄</span>' : '';
    const amtTxt = (t.typ === 'Vyrovnání' ? `⇄ ${czk(t.castka)}` : `${t.typ === 'Příjem' ? '+' : '-'}${czk(t.castka)}`) + bilMark;
    const txIdx = state.txs.indexOf(t);
    const rcpt = safeUrl(t.uctenka) ? `<a href="${safeUrl(t.uctenka)}" target="_blank" rel="noopener noreferrer" class="rcpt-link" title="Zobrazit účtenku">📎</a>` : `<button class="btn btnsm rcpt-add" onclick="triggerReceiptUpload(${txIdx})" title="Nahrát účtenku">+</button>`;
    const e = escHtml;
    return `<tr data-idx="${txIdx}"><td style="color:var(--text2);white-space:nowrap">${fmtD(t.datum)}</td><td class="td-trunc" title="${e(t.popis)}">${e(t.popis)}</td><td><span class="badge b-${e(t.kategorie)}">${e(t.kategorie)}</span></td><td><span class="badge b-${e(t.typ)}">${e(t.typ)}</span></td><td style="color:var(--text2)">${e(t.ucet)}</td><td style="color:var(--text2)">${e(t.metoda)}</td><td class="td-trunc" style="color:var(--text2);max-width:120px" title="${e(t.protistrana)}">${e(t.protistrana)}</td><td style="text-align:center">${rcpt}</td><td class="${cls}" style="white-space:nowrap">${amtTxt}</td><td style="text-align:center"><button class="btn btnsm del-btn" onclick="deleteTx(${txIdx})" title="Smazat transakci">➖</button></td></tr>`;
  }).join('');
  document.getElementById('txEmpty').style.display = list.length ? 'none' : 'block';
  attachRowInteractions(document.getElementById('txBody'));
}

function makeDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = [...new Set(values.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'cs'))
    .map(v => `<option value="${v.replace(/"/g, '&quot;')}"/>`)
    .join('');
}

function normProtiKey(raw) {
  const firstWord = (raw || '').trim().split(/[\s,/]+/)[0];
  return firstWord.toLowerCase().replace(/\.(cz|com|sk|eu|net|org|de|pl|at|hu|io)$/i, '');
}

function populateProtrList() {
  const seen = new Set();
  const values = [];
  state.txs.forEach(t => {
    const raw = (t.protistrana || '').trim();
    if (!raw) return;
    const norm = normProtiKey(raw);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    values.push(norm.charAt(0).toUpperCase() + norm.slice(1));
  });
  makeDatalist('protrList', values);
}

function populateOpisList() {
  makeDatalist('opisList', state.txs.map(t => t.popis));
}

export function openTx(idx) {
  populateProtrList();
  populateOpisList();
  state.editIdx = idx !== undefined ? idx : null;
  document.getElementById('txTitle').textContent = state.editIdx !== null ? 'Upravit transakci' : 'Přidat transakci';
  const today = isoDate(new Date()); // místní datum (toISOString je v UTC → mezi 0 a 2 h „včera")
  if (state.editIdx !== null) {
    const t = state.txs[state.editIdx];
    // t.datum je buď "M/D/YYYY" (lokálně přidaná transakce), nebo ISO
    // timestamp (GAS vrací datumové buňky takhle, Sheets je samo převede
    // na Date). new Date() umí obojí; toLocaleDateString('sv-SE') vrátí
    // YYYY-MM-DD v místním čase, takže bez posunu o den kolem půlnoci UTC.
    // Split podle '/' fungoval jen pro první formát — u ISO stringu selhal
    // a spadl na "dnešek", takže se při KAŽDÉ úpravě transakce datum tiše
    // přepsalo na aktuální den.
    const dObj = new Date(t.datum);
    document.getElementById('fDate').value = !isNaN(dObj.getTime()) ? dObj.toLocaleDateString('sv-SE') : today;
    document.getElementById('fAmt').value = t.castka;
    document.getElementById('fDesc').value = t.popis;
    document.getElementById('fTyp').value = t.typ;
    document.getElementById('fKat').value = t.kategorie;
    document.getElementById('fOsoba').value = t.osoba;
    document.getElementById('fUcet').value = t.ucet;
    document.getElementById('fMetoda').value = t.metoda;
    document.getElementById('fProti').value = t.protistrana;
    document.getElementById('fNotes').value = t.poznamka;
    document.getElementById('fBilance').checked = !!t.bilance;
    syncOsobaRow();
    if (t.uctenka) {
      document.getElementById('fReceiptInfo').innerHTML = `<a href="${safeUrl(t.uctenka)}" target="_blank" rel="noopener noreferrer" style="color:var(--blue-text)">📎 Zobrazit nahranou účtenku</a> <button type="button" class="btn btnsm del-btn" onclick="removeReceipt()" title="Odebrat účtenku" style="margin-left:6px">✕ Odebrat</button>`;
    } else {
      document.getElementById('fReceiptInfo').innerHTML = '';
    }
  } else {
    document.getElementById('fDate').value = today;
    ['fAmt','fDesc','fProti','fNotes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fTyp').value = 'Výdaj'; document.getElementById('fKat').value = 'Jídlo';
    document.getElementById('fOsoba').value = 'Martin'; document.getElementById('fUcet').value = 'mBank';
    document.getElementById('fMetoda').value = 'Karta';
    document.getElementById('fBilance').checked = false;
    syncOsobaRow();
    document.getElementById('fReceiptInfo').innerHTML = '';
  }
  _modalReceiptFile = null;
  document.getElementById('fReceiptName').textContent = 'Žádný soubor';
  document.getElementById('fReceiptFile').value = '';
  document.getElementById('txModal').style.display = 'flex';
}

export function openEdit(i) { openTx(i); }

/* Pole „Kdo poslal" má smysl jen tam, kde se opravdu počítá bilance —
   u běžné (společné) transakce by jen mystifikovalo. Zobrazí se proto jen
   při zaškrtnuté bilanci nebo u typu Vyrovnání. */
export function syncOsobaRow() {
  const row = document.getElementById('fOsobaRow');
  if (!row) return;
  const need = document.getElementById('fBilance')?.checked
    || document.getElementById('fTyp')?.value === 'Vyrovnání';
  row.style.display = need ? '' : 'none';
}

// Zkratka pro zadání vyrovnávací platby mezi Martinem a Šárkou.
export function openVyrovnani() {
  openTx();
  document.getElementById('fTyp').value = 'Vyrovnání';
  document.getElementById('fKat').value = 'Ostatní';
  document.getElementById('fOsoba').value = 'Šárka';
  document.getElementById('fMetoda').value = 'Převod';
  document.getElementById('fDesc').value = 'Vyrovnání';
  syncOsobaRow();
}

export async function deleteTx(idx) {
  const t = state.txs[idx];
  if (!t) return;
  if (!confirm(`Opravdu chceš smazat transakci "${t.popis}" (${t.castka} Kč)?`)) return;
  try {
    await postJson({ action: 'deleteRow', sheet: 'Transakce', txId: t.id });
    const i = state.txs.indexOf(t);
    if (i >= 0) state.txs.splice(i, 1);
    toast('Transakce smazána', 'ok');
  } catch(e) { toast('Smazání se nepodařilo: ' + e.message, 'err'); }
  boot();
}
export function closeTx() { document.getElementById('txModal').style.display = 'none'; }

export async function saveTx() {
  const dv = document.getElementById('fDate').value;
  if (!dv) { toast('Vyplň datum','err'); return; }
  const [y,m,d] = dv.split('-');
  const datum = `${parseInt(m)}/${parseInt(d)}/${y}`;
  const castka = Math.abs(parseFloat(document.getElementById('fAmt').value) || 0);
  if (!castka) { toast('Vyplň částku','err'); return; }
  const popis = document.getElementById('fDesc').value.trim();
  if (!popis) { toast('Vyplň popis','err'); return; }
  const typ = document.getElementById('fTyp').value;
  const kat = document.getElementById('fKat').value;
  // Vydaje jsou spolecne, takze u bezne transakce se osoba neresi a uklada
  // se 'Oba' (do bilance prispiva nulou). Konkretni clovek ma smysl jen tam,
  // kde se bilance opravdu pocita — proto se pole i zobrazuje jen tehdy.
  const bilanceOn = document.getElementById('fBilance').checked;
  const osoba = (bilanceOn || document.getElementById('fTyp').value === 'Vyrovnání')
    ? document.getElementById('fOsoba').value : 'Oba';
  const ucet = document.getElementById('fUcet').value;
  const metoda = document.getElementById('fMetoda').value;
  const proti = document.getElementById('fProti').value;
  const notes = document.getElementById('fNotes').value;
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mesic = `${mn[parseInt(m)]} ${y}`;
  const sign = typ === 'Příjem' ? castka : -castka;
  const isEdit = state.editIdx !== null;
  const old = isEdit ? state.txs[state.editIdx] : null;
  // Úprava si ponechá PŮVODNÍ id (ne nové) — jinak by se rozbily budoucí
  // odkazy na tuhle transakci podle id (např. odebrání účtenky).
  const txId = isEdit ? old.id : newId(y, m, d);
  const uctenka = isEdit ? (old.uctenka || '') : '';
  const bilance = bilanceOn ? 'TRUE' : 'FALSE';
  const row = [datum,popis,castka,'CZK',ucet,typ,kat,osoba,metoda,proti,notes,sign,mesic,y,txId,typ === 'Výdaj' ? castka : 0,typ === 'Příjem' ? castka : 0,sign,uctenka,bilance];
  const tx = parseRow(row);
  // Úprava se zapíše NA MÍSTĚ (updateRow) — dřív smazání + nový zápis,
  // a když druhý krok selhal, transakce zmizela. Při chybě zůstane formulář
  // otevřený s vyplněnými údaji a nic se netváří jako uložené.
  try {
    if (isEdit) await postJson({ action: 'updateRow', sheet: 'Transakce', id: old.id, values: row });
    else await postJson({ sheet: 'Transakce', values: [row] });
  } catch(e) {
    toast('Neuloženo: ' + e.message, 'err');
    return;
  }
  if (isEdit) state.txs[state.editIdx] = tx; else state.txs.push(tx);
  closeTx(); boot(); toast(isEdit ? 'Transakce upravena' : 'Uloženo do Sheets','ok'); state.editIdx = null;

  // Upload receipt if file was selected in modal
  if (_modalReceiptFile) {
    toast('Nahrávám účtenku...');
    try {
      const base64 = await fileToBase64(_modalReceiptFile);
      const rd = await postJson({ action: 'uploadReceipt', txId, fileName: _modalReceiptFile.name, mimeType: _modalReceiptFile.type, data: base64 });
      const t = state.txs.find(t => t.id === txId);
      if (t) t.uctenka = rd.url || '';
      boot();
      toast('Účtenka nahrána','ok');
    } catch(err) { toast('Chyba uploadu účtenky: ' + err.message, 'err'); }
    _modalReceiptFile = null;
  }
}

export async function removeReceipt() {
  if (state.editIdx === null) return;
  if (!confirm('Opravdu chceš odebrat účtenku?')) return;
  const t = state.txs[state.editIdx];
  if (!t) return;
  try {
    await postJson({ action: 'removeReceipt', txId: t.id });
    t.uctenka = '';
    document.getElementById('fReceiptInfo').innerHTML = '';
    toast('Účtenka odebrána', 'ok');
  } catch(e) { toast('Odebrání se nepodařilo: ' + e.message, 'err'); }
  boot();
}

/* ── RECEIPT UPLOAD ── */
let _receiptTxIdx = null;
let _modalReceiptFile = null;

export function onModalReceiptPick(e) {
  const file = e.target.files[0];
  _modalReceiptFile = file || null;
  document.getElementById('fReceiptName').textContent = file ? file.name : 'Žádný soubor';
}

export function triggerReceiptUpload(txIdx) {
  _receiptTxIdx = txIdx;
  document.getElementById('receiptFileIn').click();
}

export async function onReceiptFile(e) {
  const file = e.target.files[0];
  if (!file || _receiptTxIdx === null) return;
  const tx = state.txs[_receiptTxIdx];
  if (!tx) return;

  toast('Nahrávám účtenku...','ok');

  try {
    const base64 = await fileToBase64(file);
    const d = await postJson({ action: 'uploadReceipt', txId: tx.id, fileName: file.name, mimeType: file.type, data: base64 });
    tx.uctenka = d.url || '';
    renderTx();
    toast('Účtenka nahrána','ok');
  } catch(err) {
    toast('Chyba uploadu: ' + err.message, 'err');
  }

  e.target.value = '';
  _receiptTxIdx = null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    // Resize images to max 1600px
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

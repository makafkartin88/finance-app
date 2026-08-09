import { GAS_URL } from './config.js';
import { state } from './state.js';
import { fmtD, czk, parseRow, base } from './utils.js';
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
    const rcpt = t.uctenka ? `<a href="${t.uctenka}" target="_blank" class="rcpt-link" title="Zobrazit účtenku">📎</a>` : `<button class="btn btnsm rcpt-add" onclick="triggerReceiptUpload(${txIdx})" title="Nahrát účtenku">+</button>`;
    const esc = s => (s||'').replace(/"/g,'&quot;');
    return `<tr data-idx="${txIdx}"><td style="color:var(--text2);white-space:nowrap">${fmtD(t.datum)}</td><td class="td-trunc" title="${esc(t.popis)}">${t.popis}</td><td><span class="badge b-${t.kategorie}">${t.kategorie}</span></td><td><span class="badge b-${t.typ}">${t.typ}</span></td><td style="color:var(--text2)">${t.ucet}</td><td style="color:var(--text2)">${t.metoda}</td><td class="td-trunc" style="color:var(--text2);max-width:120px" title="${esc(t.protistrana)}">${t.protistrana}</td><td style="text-align:center">${rcpt}</td><td class="${cls}" style="white-space:nowrap">${amtTxt}</td><td style="text-align:center"><button class="btn btnsm del-btn" onclick="deleteTx(${txIdx})" title="Smazat transakci">➖</button></td></tr>`;
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
  const today = new Date().toISOString().split('T')[0];
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
      document.getElementById('fReceiptInfo').innerHTML = `<a href="${t.uctenka}" target="_blank" style="color:var(--blue-text)">📎 Zobrazit nahranou účtenku</a> <button type="button" class="btn btnsm del-btn" onclick="removeReceipt()" title="Odebrat účtenku" style="margin-left:6px">✕ Odebrat</button>`;
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
  state.txs.splice(idx, 1);
  try {
    await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteRow', sheet: 'Transakce', txId: t.id }) });
    toast('Transakce smazána', 'ok');
  } catch(e) { toast('Lokálně smazáno, chyba sync: ' + e.message, 'err'); }
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
  const txId = isEdit ? old.id : `${y}${m}${d}-${String(state.txs.length+1).padStart(3,'0')}`;
  const uctenka = isEdit ? (old.uctenka || '') : '';
  const bilance = bilanceOn ? 'TRUE' : 'FALSE';
  const row = [datum,popis,castka,'CZK',ucet,typ,kat,osoba,metoda,proti,notes,sign,mesic,y,txId,typ === 'Výdaj' ? castka : 0,typ === 'Příjem' ? castka : 0,sign,uctenka,bilance];
  const tx = parseRow(row);
  try {
    if (isEdit) {
      // GAS neumí update na místě → smaž starý řádek (dle id) a přidej
      // nový (stejný vzor jako u opakovaných plateb v recurring.js).
      await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteRow', sheet: 'Transakce', txId: old.id }) });
    }
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Transakce', values: [row] }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    if (isEdit) state.txs[state.editIdx] = tx; else state.txs.push(tx);
  } catch(e) {
    toast('Chyba zápisu: '+e.message,'err');
    if (isEdit) state.txs[state.editIdx] = tx; else state.txs.push(tx); // aspoň lokálně, ať uživatel nepřijde o zadaná data
  }
  closeTx(); boot(); toast(isEdit ? 'Transakce upravena' : 'Uloženo do Sheets','ok'); state.editIdx = null;

  // Upload receipt if file was selected in modal
  if (_modalReceiptFile) {
    toast('Nahrávám účtenku...');
    try {
      const base64 = await fileToBase64(_modalReceiptFile);
      const rr = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'uploadReceipt', txId, fileName: _modalReceiptFile.name, mimeType: _modalReceiptFile.type, data: base64 })
      });
      const rd = await rr.json();
      if (rd.error) throw new Error(rd.error);
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
  t.uctenka = '';
  document.getElementById('fReceiptInfo').innerHTML = '';
  try {
    await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'removeReceipt', txId: t.id }) });
    toast('Účtenka odebrána', 'ok');
  } catch(e) { toast('Chyba: ' + e.message, 'err'); }
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
    const r = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'uploadReceipt',
        txId: tx.id,
        fileName: file.name,
        mimeType: file.type,
        data: base64
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
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

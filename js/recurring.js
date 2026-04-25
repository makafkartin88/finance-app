import { GAS_URL } from './config.js';
import { state } from './state.js';
import { czk, parseRow } from './utils.js';
import { toast, boot } from './app.js';

/* ── LOAD RECURRING TEMPLATES ── */
export async function loadRecurring() {
  try {
    const r = await fetch(GAS_URL + '?sheet=Recurring');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const rows = (d.values || []).slice(1);
    state.recurring = rows.filter(r => r.length > 2 && r[0]).map(parseRecRow);
  } catch(e) {
    state.recurring = [];
  }
}

function parseRecRow(r) {
  return {
    id: r[0] || '',
    popis: r[1] || '',
    castka: Math.abs(parseFloat((r[2]||'0').toString().replace(/[^\d.-]/g,''))||0),
    typ: r[3] || 'Výdaj',
    kategorie: r[4] || 'Ostatní',
    osoba: r[5] || '',
    ucet: r[6] || 'mBank',
    metoda: r[7] || 'Karta',
    protistrana: r[8] || '',
    frekvence: r[9] || 'monthly',
    den: parseInt(r[10])||1,
    aktivni: r[11] !== 'FALSE' && r[11] !== false,
    posledniGen: r[12] || ''
  };
}

/* ── OPEN RECURRING MODAL ── */
export function openRecurring() {
  renderRecList();
  document.getElementById('recModal').style.display = 'flex';
}

export function closeRecurring() {
  document.getElementById('recModal').style.display = 'none';
}

function renderRecList() {
  const list = state.recurring;
  const el = document.getElementById('recList');
  if (!list.length) {
    el.innerHTML = '<div class="empty">Zatím žádné opakující se transakce.</div>';
    return;
  }
  el.innerHTML = list.map((r, i) => `
    <div class="rec-row">
      <div class="rec-info">
        <div class="rec-name">${r.popis} <span class="badge b-${r.kategorie}">${r.kategorie}</span> <span style="font-size:11px;color:${r.typ==='Příjem'?'var(--green)':'var(--red)'}">${r.typ}</span></div>
        <div class="rec-detail">${czk(r.castka)} · ${r.osoba} · ${r.ucet} · den ${r.den}</div>
      </div>
      <div class="rec-actions">
        <span class="rec-status ${r.aktivni ? 'rec-on' : 'rec-off'}">${r.aktivni ? 'Aktivní' : 'Neaktivní'}</span>
        <button class="btn btnsm" onclick="openRecEdit(${i})">Upravit</button>
        <button class="btn btnsm" onclick="toggleRec(${i})">${r.aktivni ? 'Vypnout' : 'Zapnout'}</button>
        <button class="btn btnsm" onclick="deleteRec(${i})">Smazat</button>
      </div>
    </div>
  `).join('');
}

/* ── ADD / EDIT TEMPLATE ── */
export function openRecForm() {
  state._recEditIdx = null;
  const hdr = document.querySelector('#recFormWrap h3');
  if (hdr) hdr.textContent = 'Nová šablona';
  document.getElementById('recFormWrap').style.display = 'block';
  document.getElementById('rfDesc').value = '';
  document.getElementById('rfAmt').value = '';
  document.getElementById('rfTyp').value = 'Výdaj';
  document.getElementById('rfKat').value = 'Bydlení';
  document.getElementById('rfOsoba').value = 'Martin';
  document.getElementById('rfUcet').value = 'mBank';
  document.getElementById('rfMetoda').value = 'Karta';
  document.getElementById('rfProti').value = '';
  document.getElementById('rfDay').value = '1';
}

export function openRecEdit(i) {
  const r = state.recurring[i];
  if (!r) return;
  state._recEditIdx = i;
  const hdr = document.querySelector('#recFormWrap h3');
  if (hdr) hdr.textContent = 'Upravit šablonu';
  document.getElementById('recFormWrap').style.display = 'block';
  document.getElementById('rfDesc').value = r.popis;
  document.getElementById('rfAmt').value = r.castka;
  document.getElementById('rfTyp').value = r.typ;
  document.getElementById('rfKat').value = r.kategorie;
  document.getElementById('rfOsoba').value = r.osoba;
  document.getElementById('rfUcet').value = r.ucet;
  document.getElementById('rfMetoda').value = r.metoda;
  document.getElementById('rfProti').value = r.protistrana;
  document.getElementById('rfDay').value = r.den;
}

export function closeRecForm() {
  state._recEditIdx = null;
  document.getElementById('recFormWrap').style.display = 'none';
}

export async function saveRecTemplate() {
  const popis = document.getElementById('rfDesc').value.trim();
  if (!popis) { toast('Vyplň popis','err'); return; }
  const castka = Math.abs(parseFloat(document.getElementById('rfAmt').value)||0);
  if (!castka) { toast('Vyplň částku','err'); return; }
  const typ = document.getElementById('rfTyp').value;
  const kat = document.getElementById('rfKat').value;
  const osoba = document.getElementById('rfOsoba').value;
  const ucet = document.getElementById('rfUcet').value;
  const metoda = document.getElementById('rfMetoda').value;
  const proti = document.getElementById('rfProti').value;
  const den = parseInt(document.getElementById('rfDay').value)||1;

  const editIdx = state._recEditIdx;
  const isEdit = editIdx !== null && editIdx !== undefined;
  const old = isEdit ? state.recurring[editIdx] : null;
  const id = isEdit ? old.id : 'REC-' + String(state.recurring.length+1).padStart(3,'0');
  const aktivni = isEdit ? (old.aktivni ? 'TRUE' : 'FALSE') : 'TRUE';
  const posledniGen = isEdit ? (old.posledniGen || '') : '';

  const row = [id, popis, castka, typ, kat, osoba, ucet, metoda, proti, 'monthly', den, aktivni, posledniGen];

  try {
    if (isEdit) {
      // Delete old row then append updated row
      await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteRow', sheet: 'Recurring', txId: old.id }) });
    }
    await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Recurring', values: [row] }) });
  } catch(e) { toast('Chyba zápisu: '+e.message,'err'); }

  if (isEdit) {
    state.recurring[editIdx] = parseRecRow(row);
    toast('Šablona aktualizována','ok');
  } else {
    state.recurring.push(parseRecRow(row));
    toast('Šablona uložena','ok');
  }
  closeRecForm();
  renderRecList();
}

/* ── TOGGLE / DELETE ── */
export async function toggleRec(i) {
  const rec = state.recurring[i];
  if (!rec) return;
  rec.aktivni = !rec.aktivni;
  renderRecList();
  toast(rec.aktivni ? 'Šablona aktivována' : 'Šablona deaktivována', 'ok');
}

export async function deleteRec(i) {
  state.recurring.splice(i, 1);
  renderRecList();
  toast('Šablona smazána', 'ok');
}

/* ── GENERATE TRANSACTIONS FOR CURRENT MONTH ── */
export async function generateRecurring() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const active = state.recurring.filter(r => r.aktivni && r.posledniGen !== curMonth);

  if (!active.length) {
    toast('Žádné šablony k vygenerování tento měsíc', 'ok');
    return;
  }

  let count = 0;
  for (const rec of active) {
    const y = String(now.getFullYear());
    const m = String(now.getMonth()+1).padStart(2,'0');
    const d = String(Math.min(rec.den, 28)).padStart(2,'0');
    const datum = `${parseInt(m)}/${parseInt(d)}/${y}`;
    const mesic = `${mn[parseInt(m)]} ${y}`;
    const sign = rec.typ === 'Příjem' ? rec.castka : -rec.castka;
    const newId = `${y}${m}${d}-R${String(state.txs.length+1).padStart(3,'0')}`;

    const row = [datum, rec.popis, rec.castka, 'CZK', rec.ucet, rec.typ, rec.kategorie, rec.osoba, rec.metoda, rec.protistrana, 'Opakující se', sign, mesic, y, newId, rec.typ === 'Výdaj' ? rec.castka : 0, rec.typ === 'Příjem' ? rec.castka : 0, sign, ''];

    state.txs.push(parseRow(row));

    try {
      await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Transakce', values: [row] }) });
    } catch(e) { /* continue */ }

    rec.posledniGen = curMonth;
    count++;
  }

  boot();
  toast(`Vygenerováno ${count} opakujících se transakcí`, 'ok');
}

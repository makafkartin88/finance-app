import { GAS_URL } from './config.js';
import { state } from './state.js';
import { czk, parseRow, postJson } from './utils.js';
import { newId, recRow, normMonth } from './tx-core.js';
import { toast, boot } from './app.js';

/* ── LOAD RECURRING TEMPLATES ── */
// `pre` = uz nactena odpoved listu (z davkoveho fetchSheets v app.js) —
// bez ni si loader nacte list sam (rucni volani, reload).
export async function loadRecurring(pre) {
  try {
    const d = pre || await (await fetch(GAS_URL + '?sheet=Recurring')).json();
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
    posledniGen: normMonth(r[12]),
    bilance: r[13] === true || (r[13]||'').toString().toUpperCase() === 'TRUE'
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
        <div class="rec-name">${r.popis} <span class="badge b-${r.kategorie}">${r.kategorie}</span> <span style="font-size:11px;color:${r.typ==='Příjem'?'var(--green)':r.typ==='Vyrovnání'?'var(--purple)':'var(--red)'}">${r.typ}</span>${r.bilance ? ' <span style="font-size:11px;color:var(--purple)" title="Počítá se do bilance Martin ↔ Šárka">⇄ bilance</span>' : ''}</div>
        <div class="rec-detail">${czk(r.castka)} · ${r.ucet} · den ${r.den}</div>
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
/* Pole „Kdo poslal" jen kdyz se opravdu pocita bilance (viz transactions.js). */
export function syncRecOsobaRow() {
  const row = document.getElementById('rfOsobaRow');
  if (!row) return;
  const need = document.getElementById('rfBilance')?.checked
    || document.getElementById('rfTyp')?.value === 'Vyrovnání';
  row.style.display = need ? '' : 'none';
}

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
  document.getElementById('rfBilance').checked = false;
  syncRecOsobaRow();
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
  document.getElementById('rfBilance').checked = !!r.bilance;
  syncRecOsobaRow();
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
  // Stejne jako u jednorazove transakce: osoba se resi jen kdyz jde
  // o bilanci nebo vyrovnani, jinak 'Oba' (vydaje jsou spolecne).
  const bilanceOn = document.getElementById('rfBilance').checked;
  const osoba = (bilanceOn || document.getElementById('rfTyp').value === 'Vyrovnání')
    ? document.getElementById('rfOsoba').value : 'Oba';
  const ucet = document.getElementById('rfUcet').value;
  const metoda = document.getElementById('rfMetoda').value;
  const proti = document.getElementById('rfProti').value;
  const den = parseInt(document.getElementById('rfDay').value)||1;
  const bilance = bilanceOn ? 'TRUE' : 'FALSE';

  const editIdx = state._recEditIdx;
  const isEdit = editIdx !== null && editIdx !== undefined;
  const old = isEdit ? state.recurring[editIdx] : null;
  const id = isEdit ? old.id : 'REC-' + newId('', '', '').slice(1);
  const aktivni = isEdit ? (old.aktivni ? 'TRUE' : 'FALSE') : 'TRUE';
  const posledniGen = isEdit ? (old.posledniGen || '') : '';

  const row = [id, popis, castka, typ, kat, osoba, ucet, metoda, proti, 'monthly', den, aktivni, posledniGen, bilance];

  try {
    if (isEdit) await postJson({ action: 'updateRow', sheet: 'Recurring', id: old.id, values: row });
    else await postJson({ sheet: 'Recurring', values: [row] });
  } catch(e) { toast('Neuloženo: ' + e.message, 'err'); return; }

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
  // Dřív jen v paměti — po obnovení stránky se vypnutá šablona vrátila a dál generovala.
  const next = { ...rec, aktivni: !rec.aktivni };
  try { await postJson({ action: 'updateRow', sheet: 'Recurring', id: rec.id, values: recRow(next) }); }
  catch (e) { toast('Nepodařilo se uložit: ' + e.message, 'err'); return; }
  rec.aktivni = next.aktivni;
  renderRecList();
  toast(rec.aktivni ? 'Šablona aktivována' : 'Šablona deaktivována', 'ok');
}

export async function deleteRec(i) {
  const rec = state.recurring[i];
  if (!rec) return;
  if (!confirm(`Smazat šablonu „${rec.popis}"?`)) return;
  try {
    await postJson({ action: 'deleteRow', sheet: 'Recurring', txId: rec.id });
    state.recurring.splice(state.recurring.indexOf(rec), 1);
    renderRecList();
    toast('Šablona smazána', 'ok');
  } catch(e) {
    toast('Smazání se nepodařilo: ' + e.message, 'err');
  }
}

function _curMonthStr(now) {
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mn[now.getMonth()+1]} ${now.getFullYear()}`;
}

function alreadyGeneratedThisMonth(rec, curMonthStr) {
  return state.txs.some(t =>
    t.mesic === curMonthStr &&
    t.poznamka === 'Opakující se' &&
    t.popis === rec.popis &&
    t.typ === rec.typ &&
    Math.abs(t.castka - rec.castka) < 0.01
  );
}

/* ── AUTO-GENERATE ON LOAD (silent) ── */
export async function autoGenerateRecurring() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const curMonthStr = _curMonthStr(now);
  const active = state.recurring.filter(r =>
    r.aktivni && r.posledniGen !== curMonth && !alreadyGeneratedThisMonth(r, curMonthStr)
  );
  if (!active.length) return;
  try { await _doGenerate(active, now, curMonth); } catch (e) { return; } // tichý běh — zkusí se při dalším otevření
  boot();
}

/* ── GENERATE TRANSACTIONS FOR CURRENT MONTH ──
   Zápis a značku „vygenerováno tento měsíc" (posledniGen) dělá server pod
   zámkem (GAS appendRecurring) — dvě zařízení otevřená naráz ani úprava
   vygenerované platby tak nic nevytvoří dvakrát. Lokálně se přidá jen to,
   co server opravdu zapsal. */
async function _doGenerate(active, now, curMonth) {
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = String(now.getFullYear());
  const m = String(now.getMonth()+1).padStart(2,'0');
  const items = active.map(rec => {
    const d = String(Math.min(rec.den, 28)).padStart(2,'0');
    const datum = `${parseInt(m)}/${parseInt(d)}/${y}`;
    const mesic = `${mn[parseInt(m)]} ${y}`;
    const sign = rec.typ === 'Příjem' ? rec.castka : -rec.castka;
    return { recId: rec.id, row: [datum, rec.popis, rec.castka, 'CZK', rec.ucet, rec.typ, rec.kategorie,
      rec.osoba, rec.metoda, rec.protistrana, 'Opakující se', sign, mesic, y, newId(y, m, d, 'R'),
      rec.typ === 'Výdaj' ? rec.castka : 0, rec.typ === 'Příjem' ? rec.castka : 0, sign, '',
      rec.bilance ? 'TRUE' : 'FALSE'] };
  });
  const d = await postJson({ action: 'appendRecurring', month: curMonth, items });
  const added = new Set(d.added || []);
  items.filter(it => added.has(it.recId)).forEach(it => { try { state.txs.push(parseRow(it.row)); } catch(e) {} });
  active.forEach(rec => { rec.posledniGen = curMonth; }); // i přeskočené: server je už má za tento měsíc
  return added.size;
}

export async function generateRecurring() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const curMonthStr = _curMonthStr(now);
  const active = state.recurring.filter(r =>
    r.aktivni && r.posledniGen !== curMonth && !alreadyGeneratedThisMonth(r, curMonthStr)
  );

  if (!active.length) {
    toast('Žádné šablony k vygenerování tento měsíc', 'ok');
    return;
  }

  let count;
  try { count = await _doGenerate(active, now, curMonth); }
  catch (e) { toast('Generování selhalo: ' + e.message, 'err'); return; }
  boot();
  toast(`Vygenerováno ${count} opakujících se transakcí`, 'ok');
}

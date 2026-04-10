import { GAS_URL } from './config.js';
import { state } from './state.js';
import { fmtD, czk, parseRow, base } from './utils.js';
import { toast, boot } from './app.js';

export function renderTx() {
  const m = document.getElementById('txfMonth')?.value || '';
  const c = document.getElementById('txfCat')?.value || '';
  const a = document.getElementById('txfAcc')?.value || '';
  let list = base(m || null, c || null);
  if (a) list = list.filter(t => t.ucet === a);
  list.sort((a,b) => new Date(b.datum)-new Date(a.datum));
  document.getElementById('txBody').innerHTML = list.map((t,i) => {
    const cls = t.typ === 'Příjem' ? 'ap' : t.kategorie === 'Investice' ? 'ai' : 'an';
    return `<tr><td style="color:var(--text2);white-space:nowrap">${fmtD(t.datum)}</td><td>${t.popis}</td><td><span class="badge b-${t.kategorie}">${t.kategorie}</span></td><td><span class="badge b-${t.typ}">${t.typ}</span></td><td><span class="badge ${t.osoba === 'Martin' ? 'bme' : 'bsa'}">${t.osoba}</span></td><td style="color:var(--text2)">${t.ucet}</td><td style="color:var(--text2)">${t.metoda}</td><td style="color:var(--text2);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.protistrana}</td><td class="${cls}" style="white-space:nowrap">${t.typ === 'Příjem' ? '+' : '-'}${czk(t.castka)}</td><td><button class="btn btnsm" onclick="openEdit(${state.txs.indexOf(t)})">Upravit</button></td></tr>`;
  }).join('');
  document.getElementById('txEmpty').style.display = list.length ? 'none' : 'block';
}

export function openTx(idx) {
  state.editIdx = idx !== undefined ? idx : null;
  document.getElementById('txTitle').textContent = state.editIdx !== null ? 'Upravit transakci' : 'Přidat transakci';
  const today = new Date().toISOString().split('T')[0];
  if (state.editIdx !== null) {
    const t = state.txs[state.editIdx], p = (t.datum||'').split('/');
    document.getElementById('fDate').value = p.length === 3 ? `${p[2]}-${String(p[0]).padStart(2,'0')}-${String(p[1]).padStart(2,'0')}` : today;
    document.getElementById('fAmt').value = t.castka;
    document.getElementById('fDesc').value = t.popis;
    document.getElementById('fTyp').value = t.typ;
    document.getElementById('fKat').value = t.kategorie;
    document.getElementById('fOsoba').value = t.osoba;
    document.getElementById('fUcet').value = t.ucet;
    document.getElementById('fMetoda').value = t.metoda;
    document.getElementById('fProti').value = t.protistrana;
    document.getElementById('fNotes').value = t.poznamka;
  } else {
    document.getElementById('fDate').value = today;
    ['fAmt','fDesc','fProti','fNotes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fTyp').value = 'Výdaj'; document.getElementById('fKat').value = 'Jídlo';
    document.getElementById('fOsoba').value = 'Martin'; document.getElementById('fUcet').value = 'mBank';
    document.getElementById('fMetoda').value = 'Karta';
  }
  document.getElementById('txModal').style.display = 'flex';
}

export function openEdit(i) { openTx(i); }
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
  const osoba = document.getElementById('fOsoba').value;
  const ucet = document.getElementById('fUcet').value;
  const metoda = document.getElementById('fMetoda').value;
  const proti = document.getElementById('fProti').value;
  const notes = document.getElementById('fNotes').value;
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mesic = `${mn[parseInt(m)]} ${y}`;
  const sign = typ === 'Příjem' ? castka : -castka;
  const newId = `${y}${m}${d}-${String(state.txs.length+1).padStart(3,'0')}`;
  const row = [datum,popis,castka,'CZK',ucet,typ,kat,osoba,metoda,proti,notes,sign,mesic,y,newId,typ === 'Výdaj' ? castka : 0,typ === 'Příjem' ? castka : 0,sign];
  const tx = parseRow(row);
  if (state.editIdx !== null) { state.txs[state.editIdx] = tx; } else {
    state.txs.push(tx);
    try {
      const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Transakce', values: [row] }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
    } catch(e) { toast('Chyba zápisu: '+e.message,'err'); }
  }
  closeTx(); boot(); toast(state.editIdx !== null ? 'Transakce upravena' : 'Uloženo do Sheets','ok'); state.editIdx = null;
}

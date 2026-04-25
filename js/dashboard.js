import { state } from './state.js';
import { fmtD, czk, rangeLabel, getMonths, base } from './utils.js';

export function renderDash() {
  const month = state.drill.month;
  const cat = state.drill.cat;
  const b = base(month, null);
  const shown = cat ? b.filter(t => t.kategorie === cat) : b;
  const drillChip = document.getElementById('dashDrill');
  if (drillChip) {
    const drillTxt = cat ? `Kategorie: ${cat}` : month ? `Měsíc: ${month}` : '';
    drillChip.textContent = drillTxt;
    drillChip.style.display = drillTxt ? 'inline-flex' : 'none';
  }

  const income = b.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
  const exp = b.filter(t => t.typ === 'Výdaj' && t.kategorie !== 'Investice').reduce((s,t) => s+t.castka, 0);
  const inv = b.filter(t => t.kategorie === 'Investice').reduce((s,t) => s+t.castka, 0);
  const sav = income - exp - inv;
  const sr = income > 0 ? Math.round((sav/income)*100) : 0;

  document.getElementById('m1').textContent = '+'+czk(income);
  document.getElementById('m2').textContent = '-'+czk(exp);
  const m3 = document.getElementById('m3');
  m3.textContent = (sav >= 0 ? '+' : '')+czk(sav); m3.className = 'mv '+(sav >= 0 ? 'green' : 'red');
  document.getElementById('m3s').textContent = sr+'% míra úspor';
  document.getElementById('m4').textContent = czk(inv);

  // Cash flow
  const months = getMonths(base(null,null)).slice(-6);
  const allF = base(null,null);
  const maxV = Math.max(...months.map(m => {
    const mt = allF.filter(t => t.mesic === m);
    return Math.max(mt.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0), mt.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0));
  }), 1);
  document.getElementById('cfChart').innerHTML = months.map(m => {
    const mt = allF.filter(t => t.mesic === m);
    const inc = mt.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
    const ex = mt.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0);
    const ih = Math.round((inc/maxV)*100), eh = Math.round((ex/maxV)*100);
    const isSel = state.drill.month === m ? ' sel' : '';
    return `<div class="bg${isSel}" onclick="drillM('${m}')" title="${m}: Příjmy ${czk(inc)}, Výdaje ${czk(ex)}"><div class="bar" style="height:${ih}px;background:var(--green)"></div><div class="bar" style="height:${eh}px;background:var(--red)"></div></div>`;
  }).join('');
  document.getElementById('cfLabels').innerHTML = months.map(m => `<div class="bl">${m.split(' ')[0]}</div>`).join('');

  // Cat bars
  const cats = {};
  b.filter(t => t.typ === 'Výdaj').forEach(t => { cats[t.kategorie] = (cats[t.kategorie]||0)+t.castka; });
  const sorted = Object.entries(cats).sort((a,z) => z[1]-a[1]);
  const maxC = sorted[0]?.[1] || 1;
  const colors = {Bydlení:'var(--amber)',Jídlo:'var(--green)',Doprava:'var(--blue)',Zábava:'var(--purple)',Zdraví:'var(--red)',Investice:'#378ADD',Ostatní:'var(--text3)'};
  document.getElementById('catBars').innerHTML = sorted.map(([c,v]) =>
    `<div class="crow${state.drill.cat === c ? ' sel' : ''}" onclick="drillC('${c}')" title="Filtrovat: ${c}"><div class="cname">${c}</div><div class="ctrack"><div class="cfill" style="width:${Math.round((v/maxC)*100)}%;background:${colors[c]||'var(--text3)'}"></div></div><div class="cval">${czk(v)}</div></div>`
  ).join('') || '<div class="empty">Žádné výdaje</div>';

  // Table
  document.getElementById('recentTitle').textContent = cat ? `Transakce — ${cat}${state.drill.month ? ' ('+state.drill.month+')' : ''}` : state.drill.month ? 'Transakce — '+state.drill.month : `Poslední transakce (${rangeLabel(state._range.from, state._range.to)})`;
  const list = [...shown].sort((a,b) => new Date(b.datum)-new Date(a.datum)).slice(0, 20);
  document.getElementById('recentBody').innerHTML = list.map(t => {
    const cls = t.typ === 'Příjem' ? 'ap' : t.kategorie === 'Investice' ? 'ai' : 'an';
    const txIdx = state.txs.indexOf(t);
    const rcpt = t.uctenka ? `<a href="${t.uctenka}" target="_blank" class="rcpt-link" title="Zobrazit účtenku">📎</a>` : `<button class="btn btnsm rcpt-add" onclick="triggerReceiptUpload(${txIdx})" title="Nahrát účtenku">+</button>`;
    const esc = s => (s||'').replace(/"/g,'&quot;');
    return `<tr><td style="color:var(--text2);white-space:nowrap">${fmtD(t.datum)}</td><td class="td-trunc" title="${esc(t.popis)}">${t.popis}</td><td><span class="badge b-${t.kategorie}">${t.kategorie}</span></td><td><span class="badge ${t.osoba === 'Martin' ? 'bme' : 'bsa'}">${t.osoba}</span></td><td style="color:var(--text2)">${t.ucet}</td><td style="text-align:center">${rcpt}</td><td class="${cls}" style="white-space:nowrap">${t.typ === 'Příjem' ? '+' : '-'}${czk(t.castka)}</td></tr>`;
  }).join('');
  document.getElementById('recentEmpty').style.display = list.length ? 'none' : 'block';
}

export function drillM(m) {
  state.drill.month = state.drill.month === m ? null : m;
  if (state.drill.month) state.drill.cat = null;
  renderDash();
}

export function drillC(c) {
  state.drill.cat = state.drill.cat === c ? null : c;
  renderDash();
}

export function clearDrill() {
  state.drill = { month: null, cat: null };
  renderDash();
}

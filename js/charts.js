import { CATEGORY_COLORS } from './config.js';
import { fmtD, czk, getMonths, base } from './utils.js';

// Interní stav pro výběr kategorie v protistrany-grafu
let _catFilter = null;
let _catExpenses = null;

export function renderMetricRows(id, rows, empty = 'Žádná data') {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = rows.map(r => `<div class="metric-row"><div><strong>${r.label}</strong><span>${r.sub||''}</span></div><strong>${r.value}</strong></div>`).join('') || `<div class="empty">${empty}</div>`;
}

export function renderInsightRows(id, rows, empty = 'Žádná data') {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = rows.map(r => `<div class="insight"><strong>${r.title}</strong><span>${r.body}</span></div>`).join('') || `<div class="empty">${empty}</div>`;
}

export function renderCB(id, list) {
  const colors = CATEGORY_COLORS;
  const cats = {}; list.forEach(t => { cats[t.kategorie] = (cats[t.kategorie]||0)+t.castka; });
  const sorted = Object.entries(cats).sort((a,z) => z[1]-a[1]);
  const maxV = sorted[0]?.[1] || 1;
  document.getElementById(id).innerHTML = sorted.map(([c,v]) =>
    `<div class="crow"><div class="cname">${c}</div><div class="ctrack"><div class="cfill" style="width:${Math.round((v/maxV)*100)}%;background:${colors[c]||'var(--text3)'}"></div></div><div class="cval">${czk(v)}</div></div>`
  ).join('') || '<div class="empty">Žádné výdaje</div>';
}

// Horizontální barplot protistran pro vybranou kategorii
function renderCatBars(cat) {
  const el = document.getElementById('chartCatBars');
  if (!el || !cat || !_catExpenses) return;
  const subset = _catExpenses.filter(t => t.kategorie === cat);
  const cpTotals = {};
  subset.forEach(t => { const key = t.protistrana || t.popis || 'Neznámá'; cpTotals[key] = (cpTotals[key]||0)+t.castka; });
  const sorted = Object.entries(cpTotals).sort((a,b) => b[1]-a[1]).slice(0,10);
  const maxV = sorted[0]?.[1] || 1;
  const color = CATEGORY_COLORS[cat] || 'var(--text3)';
  el.innerHTML = sorted.map(([name, val]) => {
    const pct = Math.round((val/maxV)*100);
    return `<div class="hbar-row">
      <div class="hbar-name" title="${name}">${name}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="hbar-val">${czk(val)}</div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:24px 0">Žádné transakce</div>';
}

// Voláno z onclick chipu v HTML — přepne kategorii
window.selectCatFilter = function(cat) {
  _catFilter = cat;
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c.textContent === cat));
  renderCatBars(cat);
};

export function renderCharts() {
  const all = base(null, null);
  const months = getMonths(all);
  const monthStats = months.map(m => {
    const mt = all.filter(t => t.mesic === m);
    const income = mt.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
    const expense = mt.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0);
    return { month: m, income, expense, rate: income > 0 ? Math.max(0, Math.round(((income-expense)/income)*100)) : 0 };
  });
  const maxV = Math.max(...monthStats.map(m => Math.max(m.income, m.expense)), 1);

  // Roční přehled — gradienty místo inline barev
  document.getElementById('yrChart').innerHTML = monthStats.map(m =>
    `<div class="bg"><div class="bar bar-income" style="height:${Math.round((m.income/maxV)*100)}px"></div><div class="bar bar-expense" style="height:${Math.round((m.expense/maxV)*100)}px"></div></div>`
  ).join('');
  document.getElementById('yrLabels').innerHTML = monthStats.map(m => `<div class="bl">${m.month.split(' ')[0]}</div>`).join('');

  // Míra úspor — gradient třídy dle výše úspor
  const maxR = Math.max(...monthStats.map(m => m.rate), 1);
  document.getElementById('srChart').innerHTML = monthStats.map(m => {
    const barClass = m.rate > 30 ? 'bar-savings-good' : m.rate > 15 ? 'bar-savings-mid' : 'bar-savings-low';
    return `<div class="bg"><div class="bar ${barClass}" style="height:${Math.round((m.rate/maxR)*100)}px;flex:1" title="${m.month}: ${m.rate}%"></div></div>`;
  }).join('');
  document.getElementById('srLabels').innerHTML = monthStats.map(m => `<div class="bl">${m.month.split(' ')[0]}<br><b>${m.rate}%</b></div>`).join('');

  const expenses = all.filter(t => t.typ === 'Výdaj');
  const totalExpense = expenses.reduce((s,t) => s+t.castka, 0);
  const martin = expenses.filter(t => t.osoba === 'Martin').reduce((s,t) => s+t.castka, 0);
  const sarka = expenses.filter(t => t.osoba === 'Šárka').reduce((s,t) => s+t.castka, 0);
  const activeMonths = Math.max(months.length, 1);
  const categoryTotals = {}; expenses.forEach(t => { categoryTotals[t.kategorie] = (categoryTotals[t.kategorie]||0)+t.castka; });
  const topCategory = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('ca1').textContent = czk(martin);
  document.getElementById('ca1s').textContent = totalExpense ? `${Math.round((martin/totalExpense)*100)} % všech výdajů` : 'Bez dat';
  document.getElementById('ca2').textContent = czk(sarka);
  document.getElementById('ca2s').textContent = totalExpense ? `${Math.round((sarka/totalExpense)*100)} % všech výdajů` : 'Bez dat';
  document.getElementById('ca3').textContent = czk(Math.round(totalExpense/activeMonths));
  document.getElementById('ca3s').textContent = `Průměr za ${activeMonths} měsíců`;
  document.getElementById('ca4').textContent = topCategory ? topCategory[0] : '—';
  document.getElementById('ca4s').textContent = topCategory ? czk(topCategory[1]) : 'Bez dat';

  // Donut chart — Martin vs. Šárka
  const splitBase = Math.max(totalExpense, 1);
  const mPct = martin / splitBase, sPct = sarka / splitBase;
  const r = 54, circ = 2 * Math.PI * r;
  const mDash = mPct * circ, sDash = sPct * circ;
  const mOffset = circ / 4;
  const sOffset = mOffset - mDash;
  document.getElementById('donutChart').innerHTML = `<svg viewBox="0 0 160 160" width="140" height="140">
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="22"/>
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--blue)" stroke-width="22"
      stroke-dasharray="${mDash.toFixed(1)} ${(circ-mDash).toFixed(1)}"
      stroke-dashoffset="${mOffset.toFixed(1)}"/>
    <circle cx="80" cy="80" r="${r}" fill="none" stroke="#d76593" stroke-width="22"
      stroke-dasharray="${sDash.toFixed(1)} ${(circ-sDash).toFixed(1)}"
      stroke-dashoffset="${sOffset.toFixed(1)}"/>
    <text x="80" y="75" text-anchor="middle" font-size="24" font-weight="800" fill="var(--text)" font-family="-apple-system,sans-serif">${Math.round(mPct*100)}%</text>
    <text x="80" y="93" text-anchor="middle" font-size="11" fill="var(--text2)" font-family="-apple-system,sans-serif">Martin</text>
  </svg>`;
  document.getElementById('spendLegend').innerHTML = `
    <div class="split-line"><span><span class="split-dot split-dot-m"></span>Martin</span><strong>${czk(martin)} · ${Math.round(mPct*100)} %</strong></div>
    <div class="split-line"><span><span class="split-dot split-dot-s"></span>Šárka</span><strong>${czk(sarka)} · ${Math.round(sPct*100)} %</strong></div>`;

  // Průměrná měsíční útrata — jen kategorie + průměr/měsíc
  const avgEl = document.getElementById('avgCats');
  avgEl.innerHTML = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1]).slice(0,6).map(([cat,val]) => {
    const color = CATEGORY_COLORS[cat] || 'var(--text3)';
    return `<div class="avg-cat-row"><span class="avg-cat-dot" style="background:${color}"></span><span class="avg-cat-name">${cat}</span><strong class="avg-cat-val">${czk(Math.round(val/activeMonths))}</strong></div>`;
  }).join('') || '<div class="empty">Žádné kategorie</div>';

  // Protistrany dle kategorie — interaktivní kombinovaná karta
  _catExpenses = expenses;
  const catsSorted = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1]);
  // Pokud je uložená kategorie stále v datech, zachovat výběr; jinak přepnout na top
  if (!_catFilter || !categoryTotals[_catFilter]) _catFilter = catsSorted[0]?.[0] || null;
  const chipsEl = document.getElementById('catChips');
  if (chipsEl) {
    chipsEl.innerHTML = catsSorted.map(([cat]) =>
      `<button class="cat-chip${cat === _catFilter ? ' active' : ''}" onclick="selectCatFilter('${cat.replace(/'/g,'\\\'')}')">${cat}</button>`
    ).join('');
  }
  renderCatBars(_catFilter);

  renderInsightRows('topMonths', monthStats.slice().sort((a,b) => b.expense-a.expense).slice(0,3).map(m => ({title: m.month, body: `Výdaje ${czk(m.expense)}, příjmy ${czk(m.income)} a míra úspor ${m.rate} %.`})), 'Žádné měsíce v rozsahu');
  renderInsightRows('topExpenses', expenses.slice().sort((a,b) => b.castka-a.castka).slice(0,3).map(t => ({title: `${t.popis} · ${czk(t.castka)}`, body: `${fmtD(t.datum)} · ${t.kategorie} · ${t.osoba}`})), 'Žádné výdaje v rozsahu');

  const incomeTotal = all.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
  const bestRate = monthStats.slice().sort((a,b) => b.rate-a.rate)[0];
  const worstSpend = monthStats.slice().sort((a,b) => b.expense-a.expense)[0];
  renderInsightRows('chartInsights', [
    {title: 'Bilance rozsahu', body: `Příjmy ${czk(incomeTotal)}, výdaje ${czk(totalExpense)} a čistá rezerva ${czk(incomeTotal-totalExpense)}.`},
    {title: 'Nejzdravější měsíc', body: bestRate ? `${bestRate.month} měl míru úspor ${bestRate.rate} %.` : 'Bez dat.'},
    {title: 'Nejnáročnější měsíc', body: worstSpend ? `${worstSpend.month} spolkl ${czk(worstSpend.expense)}.` : 'Bez dat.'}
  ], 'Žádné insighty');

  renderCB('cbM', expenses.filter(t => t.osoba === 'Martin'));
  renderCB('cbS', expenses.filter(t => t.osoba === 'Šárka'));
}

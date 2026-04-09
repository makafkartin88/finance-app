import { CATEGORY_COLORS } from './config.js';
import { fmtD, czk, getMonths, base } from './utils.js';

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
  document.getElementById('yrChart').innerHTML = monthStats.map(m =>
    `<div class="bg"><div class="bar" style="height:${Math.round((m.income/maxV)*100)}px;background:var(--green)"></div><div class="bar" style="height:${Math.round((m.expense/maxV)*100)}px;background:var(--red)"></div></div>`
  ).join('');
  document.getElementById('yrLabels').innerHTML = monthStats.map(m => `<div class="bl">${m.month.split(' ')[0]}</div>`).join('');
  const maxR = Math.max(...monthStats.map(m => m.rate), 1);
  document.getElementById('srChart').innerHTML = monthStats.map(m => {
    const col = m.rate > 30 ? 'var(--green)' : m.rate > 15 ? 'var(--amber)' : 'var(--red)';
    return `<div class="bg"><div class="bar" style="height:${Math.round((m.rate/maxR)*100)}px;background:${col};flex:1" title="${m.month}: ${m.rate}%"></div></div>`;
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

  const splitBase = Math.max(totalExpense, 1);
  document.getElementById('spendMartin').style.width = `${Math.round((martin/splitBase)*100)}%`;
  document.getElementById('spendSarka').style.width = `${Math.round((sarka/splitBase)*100)}%`;
  document.getElementById('spendLegend').innerHTML = [
    `<div class="split-line"><span>Martin</span><strong>${czk(martin)} · ${Math.round((martin/splitBase)*100)} %</strong></div>`,
    `<div class="split-line"><span>Šárka</span><strong>${czk(sarka)} · ${Math.round((sarka/splitBase)*100)} %</strong></div>`
  ].join('');

  const avgCats = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1]).slice(0,6).map(([cat,val]) => ({label: cat, sub: `Průměrně ${czk(Math.round(val/activeMonths))} za měsíc`, value: czk(val)}));
  renderMetricRows('avgCats', avgCats, 'Žádné kategorie v rozsahu');

  const cpTotals = {};
  expenses.forEach(t => { const key = t.protistrana || t.popis || 'Neznámá'; cpTotals[key] = (cpTotals[key]||0)+t.castka; });
  const cpRows = Object.entries(cpTotals).sort((a,b) => b[1]-a[1]).slice(0,6).map(([label,val]) => ({label, sub: `${expenses.filter(t => (t.protistrana || t.popis || 'Neznámá') === label).length} transakcí`, value: czk(val)}));
  renderMetricRows('counterpartySpend', cpRows, 'Žádné protistrany v rozsahu');

  const catCounterparty = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1]).slice(0,5).map(([cat]) => {
    const subset = expenses.filter(t => t.kategorie === cat);
    const top = Object.entries(subset.reduce((acc,t) => { const key = t.protistrana || t.popis || 'Neznámá'; acc[key] = (acc[key]||0)+t.castka; return acc; }, {})).sort((a,b) => b[1]-a[1])[0];
    return { title: cat, body: top ? `Nejvíc padá u ${top[0]}: ${czk(top[1])}.` : 'Bez jasné protistrany.' };
  });
  renderInsightRows('categoryCounterparty', catCounterparty, 'Žádné kategorie v rozsahu');

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

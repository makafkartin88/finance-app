import { CATEGORY_COLORS } from './config.js';
import { state } from './state.js';
import { fmtD, czk, getMonths, base, scopedTxs } from './utils.js';

// Interní stav pro výběr kategorie v protistrany-grafu
let _catFilter = null;
let _catExpenses = null;
// Lokální drill stav pro výběr měsíce v grafech (NEovlivňuje globální state._range)
let _chartMonths = new Set();

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
  const cpTotals = {};  // normKey → total
  const cpDisplay = {}; // normKey → best display name
  subset.forEach(t => {
    const raw = (t.protistrana || t.popis || 'Neznámá').trim();
    // Normalizace na první slovo = název značky (odstraní adresu pobočky, pokladní suffisy, doménové přípony)
    const firstWord = raw.split(/[\s,/]+/)[0];
    const norm = firstWord.toLowerCase().replace(/\.(cz|com|sk|eu|net|org|de|pl|at|hu|io)$/i, '');
    cpTotals[norm] = (cpTotals[norm]||0) + t.castka;
    // Title-case bez domény jako display name (Mujkoberec, Alza, Billa…)
    cpDisplay[norm] = norm.charAt(0).toUpperCase() + norm.slice(1);
  });
  const sorted = Object.entries(cpTotals).sort((a,b) => b[1]-a[1]).slice(0,10);
  const maxV = sorted[0]?.[1] || 1;
  const color = CATEGORY_COLORS[cat] || 'var(--text3)';
  el.innerHTML = sorted.map(([norm, val]) => {
    const name = cpDisplay[norm] || norm;
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

// Voláno z onclick baru v ročním/saldo grafu — lokální drill (NEovlivňuje globální rozsah)
window.chartDrillMonth = function(m, event) {
  if (m === null) { _chartMonths.clear(); renderCharts(); return; }
  if (event?.ctrlKey || event?.metaKey) {
    if (_chartMonths.has(m)) _chartMonths.delete(m); else _chartMonths.add(m);
  } else {
    if (_chartMonths.size === 1 && _chartMonths.has(m)) _chartMonths.clear();
    else { _chartMonths.clear(); _chartMonths.add(m); }
  }
  renderCharts();
};

export function renderCharts() {
  // Overview grafy — vždy celý rozsah
  const all = base(null, null);
  const months = getMonths(all);
  const monthStats = months.map(m => {
    const mt = all.filter(t => t.mesic === m);
    const income = mt.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
    const expense = mt.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0);
    return { month: m, income, expense, rate: income > 0 ? Math.max(0, Math.round(((income-expense)/income)*100)) : 0 };
  });
  const maxV = Math.max(...monthStats.map(m => Math.max(m.income, m.expense)), 1);
  const kFmt = n => n >= 10000 ? Math.round(n/1000)+'k' : n >= 1000 ? (n/1000).toFixed(1)+'k' : Math.round(n).toString();

  // Pokud vybraný měsíc už v datech není, resetovat drill
  _chartMonths = new Set([..._chartMonths].filter(m => months.includes(m)));

  // Detail data — filtrovat na vybraný měsíc(e), nebo celý rozsah
  const detail = _chartMonths.size ? base(_chartMonths, null) : all;

  // Roční přehled — bar labels + click na měsíc
  document.getElementById('yrChart').innerHTML = monthStats.map(m => {
    const isSel = _chartMonths.has(m.month);
    return `<div class="bg${isSel ? ' sel' : ''}" onclick="chartDrillMonth('${m.month}', event)" title="${m.month}">
      <div class="bar-lbl"><span class="bv-i">${kFmt(m.income)}</span><span class="bv-e">${kFmt(m.expense)}</span></div>
      <div class="bar bar-income" style="height:${Math.round((m.income/maxV)*100)}px"></div>
      <div class="bar bar-expense" style="height:${Math.round((m.expense/maxV)*100)}px"></div>
    </div>`;
  }).join('');
  document.getElementById('yrLabels').innerHTML = monthStats.map(m => `<div class="bl">${m.month.split(' ')[0]}</div>`).join('');

  // Saldo měsíce — diverging bar chart (nahoře = kladné, dole = záporné)
  const maxAbs = Math.max(...monthStats.map(m => Math.abs(m.income - m.expense)), 1);
  document.getElementById('srChart').innerHTML = monthStats.map(m => {
    const net = m.income - m.expense;
    const h = Math.round((Math.abs(net) / maxAbs) * 50);
    const isSel = _chartMonths.has(m.month);
    return `<div class="bg net-bg${isSel ? ' sel' : ''}" onclick="chartDrillMonth('${m.month}', event)" title="${m.month}: ${czk(net)}">
      <div class="net-pos">${net >= 0 ? `<div class="bar bar-income net-bar" style="height:${h}px"></div>` : ''}</div>
      <div class="net-neg">${net < 0 ? `<div class="bar bar-expense net-bar" style="height:${h}px"></div>` : ''}</div>
    </div>`;
  }).join('');
  const netFmt = n => (n >= 0 ? '+' : '') + (Math.abs(n) >= 1000 ? Math.round(n/1000)+'k' : Math.round(n).toString());
  document.getElementById('srLabels').innerHTML = monthStats.map(m => {
    const net = m.income - m.expense;
    return `<div class="bl">${m.month.split(' ')[0]}<br><b style="color:${net>=0?'var(--green)':'var(--red)'}">${netFmt(net)}</b></div>`;
  }).join('');

  // Drill label v topbaru — zobrazit vybraný měsíc nebo celý rozsah
  const cTxt = document.getElementById('chRangeTxt');
  if (cTxt) {
    if (_chartMonths.size) {
      const sel = [..._chartMonths].join(', ');
      cTxt.innerHTML = `<strong>${sel}</strong><span>${detail.length} transakcí · <a href="#" onclick="chartDrillMonth(null);return false" style="color:var(--blue-text)">zrušit výběr</a></span>`;
    }
    // Při prázdném výběru ponechat label nastavený z populateSels()
  }

  // Detail karty — počítány z 'detail' (vybraný měsíc nebo celý rozsah)
  const expenses = detail.filter(t => t.typ === 'Výdaj');
  const totalExpense = expenses.reduce((s,t) => s+t.castka, 0);
  const martin = expenses.filter(t => t.osoba === 'Martin').reduce((s,t) => s+t.castka, 0);
  const sarka = expenses.filter(t => t.osoba === 'Šárka').reduce((s,t) => s+t.castka, 0);
  const activeMonths = Math.max(_chartMonths.size ? _chartMonths.size : months.length, 1);
  const categoryTotals = {}; expenses.forEach(t => { categoryTotals[t.kategorie] = (categoryTotals[t.kategorie]||0)+t.castka; });
  const topCategory = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1])[0];
  // ca1/ca2 — příspěvek každé osoby (jejich výdaje = co do toho vrazili)
  const totalBoth = Math.max(martin + sarka, 1);
  document.getElementById('ca1').textContent = czk(martin);
  document.getElementById('ca1s').textContent = totalExpense ? `${Math.round((martin/totalBoth)*100)} % z celku` : 'Bez dat';
  document.getElementById('ca2').textContent = czk(sarka);
  document.getElementById('ca2s').textContent = totalExpense ? `${Math.round((sarka/totalBoth)*100)} % z celku` : 'Bez dat';
  document.getElementById('ca3').textContent = czk(Math.round(totalExpense/activeMonths));
  document.getElementById('ca3s').textContent = _chartMonths.size ? [..._chartMonths].join(', ') : `Průměr za ${activeMonths} měsíců`;
  document.getElementById('ca4').textContent = topCategory ? topCategory[0] : '—';
  document.getElementById('ca4s').textContent = topCategory ? czk(topCategory[1]) : 'Bez dat';


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

  // Insighty vždy z celého rozsahu
  const incomeTotal = all.filter(t => t.typ === 'Příjem').reduce((s,t) => s+t.castka, 0);
  const allTotalExpense = all.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0);
  const bestRate = monthStats.slice().sort((a,b) => b.rate-a.rate)[0];
  const worstSpend = monthStats.slice().sort((a,b) => b.expense-a.expense)[0];
  renderInsightRows('chartInsights', [
    {title: 'Bilance rozsahu', body: `Příjmy ${czk(incomeTotal)}, výdaje ${czk(allTotalExpense)} a čistá rezerva ${czk(incomeTotal-allTotalExpense)}.`},
    {title: 'Nejzdravější měsíc', body: bestRate ? `${bestRate.month} měl míru úspor ${bestRate.rate} %.` : 'Bez dat.'},
    {title: 'Nejnáročnější měsíc', body: worstSpend ? `${worstSpend.month} spolkl ${czk(worstSpend.expense)}.` : 'Bez dat.'}
  ], 'Žádné insighty');

  // ── Kumulativní bilance — line chart
  const bilAll = scopedTxs({ ignorePerson: true });
  const bilMonths = getMonths(bilAll);
  const bilEl = document.getElementById('bilChart');
  if (bilEl) {
    if (!bilMonths.length) { bilEl.innerHTML = '<div class="empty">Žádná data</div>'; return; }
    const offset = state.cfg.bilanceOffset || 0;
    let cum = offset;
    const cumPts = bilMonths.map(m => {
      const txs = bilAll.filter(t => t.mesic === m && t.typ === 'Výdaj');
      cum += txs.filter(t => t.osoba === 'Martin').reduce((s,t) => s+t.castka, 0)
           - txs.filter(t => t.osoba === 'Šárka').reduce((s,t) => s+t.castka, 0);
      return cum;
    });
    const last = cumPts[cumPts.length - 1];
    const color = last >= 0 ? 'var(--blue)' : '#d76593';
    const fillClr = last >= 0 ? 'rgba(55,138,221,0.1)' : 'rgba(215,101,147,0.1)';
    const W = 700, H = 140;
    const pL = 58, pR = 16, pT = 20, pB = 28;
    const cW = W - pL - pR, cH = H - pT - pB;
    const n = bilMonths.length;
    const xOf = i => pL + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
    const minV = Math.min(...cumPts, 0);
    const maxV = Math.max(...cumPts, 0);
    const range = Math.max(maxV - minV, 1);
    const yOf = v => pT + cH - ((v - minV) / range) * cH;
    const y0 = yOf(0);
    const coords = cumPts.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
    const linePath = coords.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const areaPath = `M${pL.toFixed(1)},${y0.toFixed(1)} ` + coords.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L${xOf(n-1).toFixed(1)},${y0.toFixed(1)} Z`;
    const kFmt = v => { const a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '−' : ''; return a >= 1000 ? s + Math.round(a/1000) + 'k' : (v === 0 ? '0' : s + Math.round(a)); };
    const ticks = [{ v: 0, y: y0 }];
    if (Math.abs(yOf(minV) - y0) > 14) ticks.push({ v: minV, y: yOf(minV) });
    if (Math.abs(yOf(maxV) - y0) > 14) ticks.push({ v: maxV, y: yOf(maxV) });
    const lastCoord = coords[n - 1];
    // label above last point, flip below if too close to top
    const lblY = lastCoord.y - 9 < pT + 4 ? lastCoord.y + 14 : lastCoord.y - 9;
    bilEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
      <line x1="${pL}" y1="${y0.toFixed(1)}" x2="${pL+cW}" y2="${y0.toFixed(1)}" stroke="var(--text3)" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>
      <path d="${areaPath}" fill="${fillClr}"/>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${coords.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>`).join('')}
      <text x="${lastCoord.x.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}" font-family="-apple-system,sans-serif">${czk(last)}</text>
      ${ticks.map(t => `<text x="${(pL-4).toFixed(1)}" y="${(t.y+3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text3)" font-family="-apple-system,sans-serif">${kFmt(t.v)}</text>`).join('')}
      ${bilMonths.map((m, i) => `<text x="${xOf(i).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="-apple-system,sans-serif">${m.split(' ')[0]}</text>`).join('')}
    </svg>
    <div class="bil-summary">
      <span>Bilance: <strong style="color:${color}">${last >= 0 ? 'Martin' : 'Šárka'} +${czk(Math.abs(last))}</strong>${offset ? ` <span class="bil-offset">(vč. poč. saldo ${czk(offset)})</span>` : ''}</span>
    </div>`;
  }
}

import { CATEGORY_COLORS } from './config.js';
import { state } from './state.js';
import { fmtD, czk, getMonths, base } from './utils.js';

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
  const activeMonths = Math.max(_chartMonths.size ? _chartMonths.size : months.length, 1);
  const categoryTotals = {}; expenses.forEach(t => { categoryTotals[t.kategorie] = (categoryTotals[t.kategorie]||0)+t.castka; });
  const topCategory = Object.entries(categoryTotals).sort((a,b) => b[1]-a[1])[0];
  renderBilance();
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

}

// Bilance společných příspěvků (kladné = Martin přispěl víc).
// = ruční počáteční stav (state.cfg.bilanceOffset) + transakce typu „Vyrovnání":
//   vyrovnání od Martina bilanci zvyšuje, od Šárky snižuje.
function renderBilance() {
  const card = document.getElementById('bilCard');
  if (!card) return;
  const base = state.cfg.bilanceOffset || 0;
  const settle = state.txs.filter(t => t.typ === 'Vyrovnání');
  const adj = settle.reduce((s, t) => s + (t.osoba === 'Šárka' ? -t.castka : t.castka), 0);
  const val = base + adj;
  const ahead = val > 0 ? 'Martin' : val < 0 ? 'Šárka' : null;
  const color = val > 0 ? 'var(--blue)' : val < 0 ? '#d76593' : 'var(--text2)';
  card.style.borderLeftColor = color;
  const valEl = document.getElementById('caBil');
  valEl.style.color = color;
  valEl.textContent = ahead ? `${ahead} +${czk(Math.abs(val))}` : 'Vyrovnáno';
  const sub = ahead
    ? `${ahead} přispěl${val < 0 ? 'a' : ''} o tolik více`
    : 'Oba přispěli stejně';
  document.getElementById('caBils').textContent = settle.length
    ? `${sub} · základ ${czk(base)} + ${settle.length}× vyrovnání`
    : sub;
}

window.editBilance = function() {
  const valEl = document.getElementById('caBil');
  if (!valEl) return;
  const val = state.cfg.bilanceOffset || 0;
  const who = val < 0 ? 'Šárka' : 'Martin';
  valEl.innerHTML = `<div class="bil-edit">
    <select id="bilWho">
      <option value="Martin"${who === 'Martin' ? ' selected' : ''}>Martin</option>
      <option value="Šárka"${who === 'Šárka' ? ' selected' : ''}>Šárka</option>
    </select>
    <span>+</span>
    <input id="bilAmt" type="number" min="0" value="${Math.abs(val)}"/>
    <button class="btn btnsm" onclick="saveBilance()">✓</button>
    <button class="btn btnsm" onclick="renderCharts()">✕</button>
  </div>`;
  const amt = document.getElementById('bilAmt');
  amt.focus(); amt.select();
  amt.onkeydown = e => { if (e.key === 'Enter') window.saveBilance(); if (e.key === 'Escape') renderCharts(); };
};

window.saveBilance = function() {
  const who = document.getElementById('bilWho')?.value || 'Martin';
  const amt = Math.abs(Number(document.getElementById('bilAmt')?.value) || 0);
  state.cfg.bilanceOffset = who === 'Šárka' ? -amt : amt;
  localStorage.setItem('fincfg', JSON.stringify(state.cfg));
  renderCharts();
};

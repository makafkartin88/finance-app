import { GAS_URL, FOND, FUND_FOCUS } from './config.js';
import { state } from './state.js';
import { czk } from './utils.js';
import { toast } from './app.js';
import { isInvestmentsAllowed } from './auth.js';

/* ============================================================
   Stránka Investice — dva pohledy: CODYA a CONSEQ.
   Data z privátního listu "Fondy" (klíč = ISIN). Pro každý fond
   nákupní vs. aktuální NAV, rozdíl v % i absolutně, hodnota v CZK.
   ============================================================ */

const DEFAULT_EUR = 25;
let activeTab = 'codya';
let _lastRefresh = null; // { updated, failed[], eur, when } — feedback z posledního refreshe

// Google Sheets převádí datumové buňky na Date → GAS je vrací jako ISO
// timestamp ("2026-04-15T00:00:00.000Z"). Normalizace zpět na "YYYY-MM-DD"
// TZ-bezpečně (Europe/Prague), aby nedošlo k posunu o den.
function normDate(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes('T')) {
    try { return new Date(s).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' }); } catch (e) {}
  }
  const m = s.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return s.slice(0, 10);
}
// "YYYY-MM-DD" → "D.M.YYYY" pro zobrazení
function czFromIso(iso) { const p = iso.split('-'); return p.length === 3 ? `${+p[2]}.${+p[1]}.${p[0]}` : iso; }

/* ── TABS ── */
export function invTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.inv-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('inv-' + tab)?.classList.add('active');
  if (btn) btn.classList.add('active');
}

/* ── REFRESH NAV (scrape aktuálních kurzů přes GAS) ── */
export async function refreshInvNav() {
  const btn = document.getElementById('invRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Aktualizuji…'; }
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'refreshNav' }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    // odfiltruj S&P500 z failed → to je benchmark, ne fond
    const failedFunds = (d.failed || []).filter(x => /^CZ\d{10}$/.test(x));
    _lastRefresh = { updated: d.updated || 0, failed: failedFunds, eur: d.eur, when: new Date() };
    const okMsg = `Aktualizováno ${d.updated} kurzů${d.eur ? ` · EUR ${d.eur.toFixed(2)}` : ''}`;
    toast(failedFunds.length ? `${okMsg} · ${failedFunds.length} selhalo` : okMsg, failedFunds.length ? 'err' : 'ok');
    await loadInvestmentData();
  } catch (e) {
    _lastRefresh = { error: e.message, when: new Date() };
    toast('Chyba aktualizace kurzů: ' + e.message, 'err');
    renderInv();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Aktualizovat kurzy'; }
  }
}

// Název fondu z ISIN (pro feedback o selhání)
function fundName(isin) { const f = (state.investments || []).find(x => x.isin === isin); return f ? f.nazev : isin; }

/* ── LOAD ── */
export async function loadInvestmentData() {
  if (!isInvestmentsAllowed()) { state.investments = []; renderInv(); return; }
  try {
    const [fR, tR, fhR, thR] = await Promise.all([
      fetch(GAS_URL + '?sheet=Fondy').then(r => r.json()).catch(() => ({ error: 1 })),
      fetch(GAS_URL + '?sheet=Trh').then(r => r.json()).catch(() => ({ values: [] })),
      fetch(GAS_URL + '?sheet=FondyHist').then(r => r.json()).catch(() => ({ values: [] })),
      fetch(GAS_URL + '?sheet=TrhHist').then(r => r.json()).catch(() => ({ values: [] }))
    ]);
    if (fR.error) { state.investments = []; state.market = []; renderInv(); return; }
    state.investments = (fR.values || []).map(parseFundRow).filter(f => /^CZ\d{10}$/.test(f.isin));
    const pn = v => parseFloat(String(v).replace(',', '.')) || 0;
    state.market = (tR.values || []).slice(1).filter(r => r[0]).map(r => ({
      provider: r[0], startDate: r[1],
      spStart: pn(r[2]), spCurrent: pn(r[3]), spCurrentDate: r[4] || '',
      spStartCzk: pn(r[5]), spCurrentCzk: pn(r[6])   // devizově korigované (CZK)
    }));
    state.invHist = (fhR.values || []).slice(1).filter(r => r[0] && r[1]).map(r => ({
      datum: normDate(r[0]), isin: String(r[1]), provider: r[2], nav: pn(r[3]), hodnotaCZK: pn(r[4])
    }));
    state.trhHist = (thR.values || []).slice(1).filter(r => r[0]).map(r => ({
      datum: normDate(r[0]), spCzk: pn(r[3]) || pn(r[1])   // preferuj CZK; fallback USD
    })).filter(r => r.spCzk > 0);
    renderInv();
  } catch (e) { /* investice jsou volitelné — neshodit boot */ }
}

// datum (D.M.YYYY nebo ISO) → Date (pro výpočet délky držby)
function czDate(s) {
  const iso = normDate(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : null;
}
// Anualizace: z výnosu za `days` dní → tempo p.a. (extrapolace)
function annualize(totalRet, days) {
  if (!days || days < 1) return 0;
  return (Math.pow(1 + totalRet, 365 / days) - 1) * 100;
}

function parseFundRow(r) {
  const num = i => { const n = parseFloat(String(r[i]).replace(/[\s ]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  return {
    provider: r[FOND.provider] || '',
    isin: String(r[FOND.isin] || ''),
    nazev: r[FOND.nazev] || '',
    mena: r[FOND.mena] || 'CZK',
    pocetCP: num(FOND.pocetCP),
    nakupNAV: num(FOND.nakupNAV),
    nakupDatum: r[FOND.nakupDatum] || '',
    investovanoCZK: num(FOND.investovanoCZK),
    aktualNAV: num(FOND.aktualNAV),
    aktualNAVdatum: r[FOND.aktualNAVdatum] || '',
    aktualHodnotaCZK: num(FOND.aktualHodnotaCZK),
    poplatek: num(FOND.poplatek),
    kurzEUR: num(FOND.kurzEUR),
    hotovostCZK: num(FOND.hotovostCZK),
    poznamka: r[FOND.poznamka] || ''
  };
}

/* ── VÝPOČTY ── */
const fx = f => f.mena === 'EUR' ? (f.kurzEUR || DEFAULT_EUR) : 1;
const invCZK = f => f.investovanoCZK || Math.round(f.pocetCP * f.nakupNAV * fx(f));
const curCZK = f => f.aktualHodnotaCZK || Math.round(f.pocetCP * f.aktualNAV * fx(f));
const navPct = f => f.nakupNAV ? (f.aktualNAV / f.nakupNAV - 1) * 100 : 0;
const pctTxt = p => (p >= 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + ' %';

/* ── RENDER ── */
export function renderInv() {
  renderOverview();
  renderProviderView('codya', 'CODYA');
  renderProviderView('conseq', 'CONSEQ');
}

/* ── PŘEHLED: alokace + graf vývoje vs S&P ── */
let _chartSel = 'all';
let _allocView = 'provider';   // 'provider' | 'funds'
let _allocSel = null;          // vybraný výsek koláče (klíč: 'CODYA'|'CONSEQ'|'Volná hotovost'|'isin:...')
let _lineCtx = null;           // kontext grafu pro hover
window.invChartSel = function (v) { _chartSel = v; _allocSel = (v === 'all') ? null : v; renderOverview(); };
window.invAllocView = function (v) { _allocView = v; renderOverview(); };
// Klik na výsek/řádek alokace → zvýraznění + filtr grafu (druhý klik zruší)
window.invAllocPick = function (key) {
  _allocSel = (_allocSel === key) ? null : key;
  _chartSel = (!_allocSel || _allocSel === 'Volná hotovost') ? 'all' : _allocSel;
  renderOverview();
};

const CZK_COLORS = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--purple)', '#d76593', '#38bdb8', '#e8833a', 'var(--text3)'];

function renderOverview() {
  const el = document.getElementById('inv-overview');
  if (!el) return;
  const funds = state.investments || [];
  if (!funds.length) {
    el.innerHTML = `<div class="empty" style="padding:48px 0">Zatím žádná data. Nahraj výpis přes „📥 Nahrát výpis".</div>`;
    return;
  }

  // --- Feedback z poslední aktualizace ---
  let fb = '';
  if (_lastRefresh) {
    if (_lastRefresh.error) {
      fb = `<div class="card" style="border-left:3px solid var(--red);margin-bottom:16px"><strong style="color:var(--red)">Aktualizace kurzů selhala</strong><div style="font-size:12px;color:var(--text2);margin-top:4px">${_lastRefresh.error}</div></div>`;
    } else {
      const t = _lastRefresh.when.toLocaleString('cs-CZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' });
      const fails = (_lastRefresh.failed || []).length
        ? `<div style="font-size:12px;color:var(--red);margin-top:4px">Nepodařilo se: ${_lastRefresh.failed.map(fundName).join(', ')}</div>` : '';
      fb = `<div class="card" style="border-left:3px solid ${(_lastRefresh.failed || []).length ? 'var(--amber)' : 'var(--green)'};margin-bottom:16px">
        <strong>Aktualizováno ${_lastRefresh.updated} kurzů</strong> <span style="font-size:12px;color:var(--text3)">${t}${_lastRefresh.eur ? ` · kurz EUR ${_lastRefresh.eur.toFixed(2)}` : ''}</span>${fails}</div>`;
    }
  }

  // --- Alokace (donut s přepínačem poskytovatel / fondy) ---
  let segs;
  if (_allocView === 'funds') {
    segs = funds.slice().sort((a, b) => curCZK(b) - curCZK(a)).map((f, i) => ({ label: f.nazev || f.isin, key: 'isin:' + f.isin, val: curCZK(f), color: CZK_COLORS[i % CZK_COLORS.length] }));
    const cashTot = funds.reduce((s, f) => s + (f.hotovostCZK || 0), 0);
    if (cashTot > 0) segs.push({ label: 'Volná hotovost', key: 'Volná hotovost', val: cashTot, color: 'var(--text3)' });
  } else {
    const provVal = {}; let cash = 0;
    funds.forEach(f => { provVal[f.provider] = (provVal[f.provider] || 0) + curCZK(f); cash += (f.hotovostCZK || 0); });
    segs = [
      { label: 'CODYA', key: 'CODYA', val: provVal['CODYA'] || 0, color: 'var(--blue)' },
      { label: 'CONSEQ', key: 'CONSEQ', val: provVal['CONSEQ'] || 0, color: 'var(--green)' },
      { label: 'Volná hotovost', key: 'Volná hotovost', val: cash, color: 'var(--text3)' }
    ];
  }
  segs = segs.filter(s => s.val > 0);
  const totAlloc = segs.reduce((s, x) => s + x.val, 0) || 1;
  const allocCard = `<div class="card">
    <div class="card-hdr"><div class="ct">Celková alokace majetku</div>
      <div class="inv-tabs" style="margin:0"><button class="inv-tab${_allocView === 'provider' ? ' active' : ''}" onclick="invAllocView('provider')">Poskytovatelé</button><button class="inv-tab${_allocView === 'funds' ? ' active' : ''}" onclick="invAllocView('funds')">Fondy</button></div>
    </div>
    <div class="donut-wrap">${donutSVG(segs, totAlloc, _allocSel)}
      <div class="donut-legend">${segs.map(s => {
        const sel = _allocSel === s.key;
        return `<div class="portfolio-row alloc-row${sel ? ' sel' : ''}" onclick="invAllocPick('${s.key}')" style="cursor:pointer${sel ? `;border-left:3px solid ${s.color};padding-left:8px;background:var(--surface2)` : ''}"><div><div class="portfolio-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px"></span>${s.label}</div></div><div class="portfolio-val">${czk(s.val)}</div><div class="portfolio-pct">${Math.round(s.val / totAlloc * 100)} %</div></div>`;
      }).join('')}</div>
    </div>
  </div>`;

  // --- Graf vývoje vs S&P ---
  el.innerHTML = fb + allocCard + `<div class="card" style="margin-top:16px">
    <div class="card-hdr"><div class="ct">Vývoj vs. S&amp;P 500 (rebasováno na 100, v CZK)</div>
      <select class="sel" onchange="invChartSel(this.value)">${chartSelOptions()}</select></div>
    <div id="invChart"></div>
  </div>`;
  document.getElementById('invChart').innerHTML = buildChart();
  attachChartHover();
}

// SVG donut — klikací výseky (filtr grafu), hover tooltip, středový součet.
// selKey = vybraný výsek → zvýrazní se (silnější), ostatní ztlumí.
function donutSVG(segs, total, selKey) {
  const r = 52, C = 2 * Math.PI * r;
  let off = C / 4; // start nahoře
  const arcs = segs.map(s => {
    const frac = s.val / total, len = frac * C;
    const dash = `${len.toFixed(2)} ${(C - len).toFixed(2)}`;
    const isSel = selKey === s.key;
    const dim = selKey && !isSel;
    const sw = isSel ? 25 : 20;
    const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 70 70)" onclick="invAllocPick('${s.key}')" style="cursor:pointer"${dim ? ' opacity="0.3"' : ''}><title>${s.label}: ${czk(s.val)} · ${Math.round(frac * 100)} %${selKey ? ' — klik zruší filtr' : ' — klik = filtr grafu'}</title></circle>`;
    off -= len;
    return arc;
  }).join('');
  const center = selKey
    ? (() => { const s = segs.find(x => x.key === selKey); return s ? `<text x="70" y="66" text-anchor="middle" font-size="9" fill="var(--text3)">${Math.round(s.val / total * 100)} %</text><text x="70" y="82" text-anchor="middle" font-size="12" font-weight="800" fill="var(--text)">${(s.val / 1e6).toFixed(2)} M</text>` : ''; })()
    : `<text x="70" y="66" text-anchor="middle" font-size="10" fill="var(--text3)">Celkem</text><text x="70" y="82" text-anchor="middle" font-size="14" font-weight="800" fill="var(--text)">${(total / 1e6).toFixed(2)} M</text>`;
  return `<svg viewBox="0 0 140 140" width="150" height="150" style="flex-shrink:0">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="20"/>${arcs}${center}
  </svg>`;
}

function chartSelOptions() {
  const opts = [['all', 'CODYA + CONSEQ + S&P'], ['CODYA', 'CODYA celkem vs S&P'], ['CONSEQ', 'CONSEQ celkem vs S&P']];
  (state.investments || []).forEach(f => opts.push(['isin:' + f.isin, (f.nazev || f.isin).slice(0, 40) + ' vs S&P']));
  return opts.map(([v, l]) => `<option value="${v}"${v === _chartSel ? ' selected' : ''}>${l}</option>`).join('');
}

const purchaseOf = isin => { const f = (state.investments || []).find(x => x.isin === isin); return f ? normDate(f.nakupDatum) : null; };

// Časová řada hodnoty portfolia pro filtr. Fondy mají body na RŮZNÝCH
// datech (nákup + měsíční přecenění) → hodnota k datu = součet posledních
// známých hodnot jednotlivých fondů (forward-fill), ne jen bodů přesně
// k tomu datu. Body před datem nákupu fondu se ignorují (chrání proti
// datu zahájení úpisu, které scraper někdy zachytí — viz FIDUROCK 16.1.).
function histSeries(filterFn) {
  const rows = (state.invHist || []).filter(filterFn)
    .filter(h => { const p = purchaseOf(h.isin); return !p || h.datum >= p; });
  if (!rows.length) return [];
  const byFund = {};
  rows.forEach(h => { (byFund[h.isin] = byFund[h.isin] || []).push({ t: h.datum, v: h.hodnotaCZK }); });
  Object.keys(byFund).forEach(k => byFund[k].sort((a, b) => a.t < b.t ? -1 : 1));
  const dates = [...new Set(rows.map(h => h.datum))].sort();
  return dates.map(d => {
    let sum = 0;
    for (const k in byFund) { let v = 0; for (const p of byFund[k]) { if (p.t <= d) v = p.v; else break; } sum += v; }
    return { t: d, v: sum };
  });
}
// Rebase řady na 100 v prvním bodě (raw = původní hodnota CZK)
function rebase(pts) {
  if (!pts.length || !pts[0].v) return [];
  const base = pts[0].v;
  return pts.map(p => ({ t: p.t, v: p.v / base * 100, raw: p.v }));
}
// S&P (CZK) rebasovaná na 100 k danému startovnímu datu
function spSeries(startISO) {
  const th = (state.trhHist || []).slice().sort((a, b) => a.datum < b.datum ? -1 : 1);
  if (!th.length) return [];
  let base = 0;
  for (const r of th) { if (r.datum <= startISO) base = r.spCzk; }
  if (!base) base = th[0].spCzk;
  return th.filter(r => r.datum >= startISO).map(r => ({ t: r.datum, v: r.spCzk / base * 100, raw: r.spCzk }));
}

function buildChart() {
  const series = [];
  const codya = rebase(histSeries(h => h.provider === 'CODYA'));
  const conseq = rebase(histSeries(h => h.provider === 'CONSEQ'));
  const startOf = s => s.length ? s[0].t : null;

  if (_chartSel === 'all') {
    if (codya.length) series.push({ label: 'CODYA', color: 'var(--blue)', pts: codya, money: true });
    if (conseq.length) series.push({ label: 'CONSEQ', color: 'var(--green)', pts: conseq, money: true });
    const earliest = [startOf(codya), startOf(conseq)].filter(Boolean).sort()[0];
    if (earliest) series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(earliest) });
  } else if (_chartSel === 'CODYA' || _chartSel === 'CONSEQ') {
    const s = _chartSel === 'CODYA' ? codya : conseq;
    if (s.length) { series.push({ label: _chartSel, color: 'var(--blue)', pts: s, money: true }); series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(s[0].t) }); }
  } else if (_chartSel.startsWith('isin:')) {
    const isin = _chartSel.slice(5);
    const s = rebase(histSeries(h => h.isin === isin));
    if (s.length) { series.push({ label: (state.investments.find(f => f.isin === isin) || {}).nazev || isin, color: 'var(--purple)', pts: s, money: true }); series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(s[0].t) }); }
  }
  return lineChartSVG(series);
}

// SVG multi-line graf. series: [{label,color,pts:[{t,v,raw}],money}] (rebased)
function lineChartSVG(series) {
  const withPts = series.filter(s => s.pts && s.pts.length);
  _lineCtx = null;
  if (!withPts.length) return `<div class="empty" style="padding:32px 0">Historie se zatím sbírá — po pár aktualizacích kurzů se tu objeví křivky. (Klikni na „🔄 Aktualizovat kurzy".)</div>`;
  const W = 720, H = 260, padL = 40, padR = 14, padT = 16, padB = 34;
  const allDates = [...new Set(withPts.flatMap(s => s.pts.map(p => p.t)))].sort();
  const t2i = {}; allDates.forEach((d, i) => t2i[d] = i);
  const xN = Math.max(allDates.length - 1, 1);
  const vals = withPts.flatMap(s => s.pts.map(p => p.v));
  const vMin = Math.min(...vals, 100), vMax = Math.max(...vals, 100);
  const pad = (vMax - vMin) * 0.12 || 5;
  const lo = vMin - pad, hi = vMax + pad;
  const x = i => padL + (i / xN) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  // vodorovná mřížka: 100 (baseline) + hi + lo
  let grid = '';
  [lo, 100, hi].forEach(gv => {
    grid += `<line x1="${padL}" y1="${y(gv)}" x2="${W - padR}" y2="${y(gv)}" stroke="var(--border)" stroke-width="${gv === 100 ? 1.5 : 1}"${gv === 100 ? '' : ' stroke-dasharray="3 3"'}/>
      <text x="${padL - 5}" y="${y(gv) + 3}" text-anchor="end" font-size="9" fill="var(--text3)">${Math.round(gv)}</text>`;
  });
  // osa X: svislé rysky na začátku každého měsíce + popisek M/RR.
  // Popisky se nesmí překrývat → min. rozestup + zarovnání u okrajů.
  let prevMon = '', lastLabelX = -999;
  allDates.forEach((d, i) => {
    const mon = d.slice(0, 7); // YYYY-MM
    if (mon === prevMon) return;
    prevMon = mon;
    const p = d.split('-'), xi = x(i);
    grid += `<line x1="${xi.toFixed(1)}" y1="${padT}" x2="${xi.toFixed(1)}" y2="${H - padB}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 4" opacity="0.5"/>`;
    if (xi - lastLabelX < 30) return;                 // moc blízko → popisek vynech
    lastLabelX = xi;
    const anchor = xi < padL + 14 ? 'start' : (xi > W - padR - 14 ? 'end' : 'middle');
    const tx = anchor === 'start' ? padL : (anchor === 'end' ? W - padR : xi);
    grid += `<text x="${tx.toFixed(1)}" y="${H - padB + 15}" text-anchor="${anchor}" font-size="9" fill="var(--text3)">${+p[1]}/${p[0].slice(2)}</text>`;
  });

  const lines = withPts.map(s => {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(t2i[p.t]).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const dots = s.pts.length <= 14 ? s.pts.map(p => `<circle cx="${x(t2i[p.t]).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="${s.color}"/>`).join('') : '';
    const last = s.pts[s.pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}
      <text x="${(x(t2i[last.t]) - 2).toFixed(1)}" y="${(y(last.v) - 5).toFixed(1)}" text-anchor="end" font-size="9" font-weight="700" fill="${s.color}">${last.v.toFixed(0)}</text>`;
  }).join('');
  const legend = `<div class="legend" style="margin-top:8px">${withPts.map(s => `<div class="li"><div class="ld" style="background:${s.color};border-radius:3px"></div>${s.label}${s.pts.length === 1 ? ' (1 bod)' : ''}</div>`).join('')}</div>`;

  // kontext pro hover
  _lineCtx = { series: withPts, allDates, t2i, W, H, padL, padR, padT, padB, lo, hi, xN };

  return `<div id="invChartWrap" style="position:relative">
    <svg id="invChartSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">${grid}
      <line id="invCrosshair" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="var(--text3)" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
      <g id="invHoverDots"></g>${lines}</svg>
    <div id="invChartTip" style="position:absolute;display:none;pointer-events:none;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:7px 9px;font-size:11px;box-shadow:0 4px 14px rgba(0,0,0,.12);z-index:5;white-space:nowrap"></div>
  </div>${legend}`;
}

// Hodnota série k danému indexu data (lineární interpolace mezi body)
function seriesValueAt(s, idx, t2i) {
  const pts = s.pts.map(p => ({ i: t2i[p.t], v: p.v, raw: p.raw })).sort((a, b) => a.i - b.i);
  if (idx <= pts[0].i) return null;              // před začátkem série → nezobrazuj
  if (idx >= pts[pts.length - 1].i) return pts[pts.length - 1];
  for (let k = 1; k < pts.length; k++) {
    if (idx <= pts[k].i) {
      const a = pts[k - 1], b = pts[k], f = (idx - a.i) / (b.i - a.i);
      return { i: idx, v: a.v + (b.v - a.v) * f, raw: a.raw + (b.raw - a.raw) * f };
    }
  }
  return pts[pts.length - 1];
}

function attachChartHover() {
  const svg = document.getElementById('invChartSvg');
  const tip = document.getElementById('invChartTip');
  const cross = document.getElementById('invCrosshair');
  const dotsG = document.getElementById('invHoverDots');
  if (!svg || !_lineCtx) return;
  const ctx = _lineCtx;
  const xPix = i => ctx.padL + (i / ctx.xN) * (ctx.W - ctx.padL - ctx.padR);
  const yPix = v => ctx.padT + (1 - (v - ctx.lo) / (ctx.hi - ctx.lo)) * (ctx.H - ctx.padT - ctx.padB);

  svg.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const vbX = (e.clientX - rect.left) / rect.width * ctx.W;   // do viewBox souřadnic
    let idx = Math.round((vbX - ctx.padL) / (ctx.W - ctx.padL - ctx.padR) * ctx.xN);
    idx = Math.max(0, Math.min(ctx.allDates.length - 1, idx));
    const date = ctx.allDates[idx];
    const cx = xPix(idx);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    let dots = '', rows = '';
    ctx.series.forEach(s => {
      const val = seriesValueAt(s, idx, ctx.t2i);
      if (!val) return;
      dots += `<circle cx="${cx.toFixed(1)}" cy="${yPix(val.v).toFixed(1)}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"/>`;
      const dpct = val.v - 100;
      rows += `<div style="display:flex;gap:8px;justify-content:space-between"><span style="color:${s.color};font-weight:600">${s.label}</span><span>${dpct >= 0 ? '+' : ''}${dpct.toFixed(1).replace('.', ',')} %${s.money ? ' · ' + czk(Math.round(val.raw)) : ''}</span></div>`;
    });
    dotsG.innerHTML = dots;
    tip.innerHTML = `<div style="font-weight:700;margin-bottom:3px">${czFromIso(date)}</div>${rows}`;
    tip.style.display = 'block';
    // umísti tooltip poblíž kurzoru (v pixelech kontejneru)
    const wrapRect = document.getElementById('invChartWrap').getBoundingClientRect();
    let left = e.clientX - wrapRect.left + 12;
    if (left + 160 > wrapRect.width) left = e.clientX - wrapRect.left - 160;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = (e.clientY - wrapRect.top + 12) + 'px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.style.display = 'none'; dotsG.innerHTML = ''; });
}

function renderProviderView(tabId, provider) {
  const el = document.getElementById('inv-' + tabId);
  if (!el) return;
  const funds = (state.investments || []).filter(f => f.provider === provider);

  if (!funds.length) {
    el.innerHTML = `<div class="empty" style="padding:48px 0">
      Zatím žádná data z ${provider}. Nahraj výpis přes „📥 Nahrát výpis".</div>`;
    return;
  }

  const invested = funds.reduce((s, f) => s + invCZK(f), 0);
  const current = funds.reduce((s, f) => s + curCZK(f), 0);
  const cash = funds.reduce((s, f) => s + (f.hotovostCZK || 0), 0);
  const gain = current - invested;
  const gainPct = invested ? (gain / invested) * 100 : 0;
  const totalWithCash = current + cash;

  // metric karty
  const cards = `<div class="mgrid">
    <div class="mc" style="border-left-color:var(--blue)"><div class="ml">Investováno</div><div class="mv">${czk(invested)}</div><div class="ms">${funds.length} ${funds.length === 1 ? 'fond' : funds.length < 5 ? 'fondy' : 'fondů'}${funds.some(f => f.poplatek) ? ' · vč. poplatků navíc' : ''}</div></div>
    <div class="mc" style="border-left-color:var(--green)"><div class="ml">Aktuální hodnota fondů</div><div class="mv">${czk(current)}</div><div class="ms">${cash ? 'volná hotovost ' + czk(cash) : 'k datu posledního výpisu'}</div></div>
    <div class="mc" style="border-left-color:${gain >= 0 ? 'var(--green)' : 'var(--red)'}"><div class="ml">Zisk / ztráta</div><div class="mv ${gain >= 0 ? 'green' : 'red'}">${gain >= 0 ? '+' : ''}${czk(gain)}</div><div class="ms">oproti nákupní ceně</div></div>
    <div class="mc" style="border-left-color:var(--amber)"><div class="ml">Výnos</div><div class="mv ${gainPct >= 0 ? 'green' : 'red'}">${pctTxt(gainPct)}</div><div class="ms">${cash ? 'celkem u ' + provider + ' ' + czk(totalWithCash) : provider}${funds[0].poznamka ? ' · ' + funds[0].poznamka : ''}</div></div>
  </div>`;

  // tabulka fondů
  const sorted = funds.slice().sort((a, b) => curCZK(b) - curCZK(a));
  const rows = sorted.map(f => {
    const p = navPct(f);
    const dCZK = curCZK(f) - invCZK(f);
    const focus = FUND_FOCUS[f.isin] || '';
    const col = p >= 0 ? 'ap' : 'an';
    return `<tr>
      <td><div style="font-weight:600">${f.nazev || f.isin}</div><div style="font-size:11px;color:var(--text3)">${focus}${f.mena === 'EUR' ? ' · EUR' : ''}</div></td>
      <td style="color:var(--text2);white-space:nowrap">${f.pocetCP.toLocaleString('cs-CZ')}</td>
      <td style="white-space:nowrap">${f.nakupNAV ? f.nakupNAV.toLocaleString('cs-CZ', { minimumFractionDigits: 4 }) : '—'}</td>
      <td style="white-space:nowrap">${f.aktualNAV ? f.aktualNAV.toLocaleString('cs-CZ', { minimumFractionDigits: 4 }) : '—'}</td>
      <td class="${col}" style="white-space:nowrap;font-weight:700">${f.nakupNAV && f.aktualNAV ? pctTxt(p) : '—'}</td>
      <td class="${col}" style="white-space:nowrap">${f.nakupNAV && f.aktualNAV ? (dCZK >= 0 ? '+' : '') + czk(dCZK) : '—'}</td>
      <td style="white-space:nowrap;font-weight:600">${czk(curCZK(f))}</td>
    </tr>`;
  }).join('');

  const cashRow = cash ? `<div class="metric-row" style="margin-top:12px"><div><strong>Volná hotovost</strong><span>nezainvestováno u ${provider}</span></div><strong>${czk(cash)}</strong></div>` : '';

  // ── VÝKONNOST & SROVNÁNÍ (období, anualizace, S&P 500) ──
  const SAVINGS_PA = 4; // referenční spořák % p.a. (orientační)
  const startDates = funds.map(f => czDate(f.nakupDatum)).filter(Boolean);
  const navDates = funds.map(f => czDate(f.aktualNAVdatum)).filter(Boolean);
  const startDate = startDates.length ? new Date(Math.min(...startDates)) : null;
  const navDate = navDates.length ? new Date(Math.max(...navDates)) : new Date();
  let compCard = '';
  if (startDate && invested > 0) {
    const days = Math.max(Math.round((navDate - startDate) / 864e5), 1);
    const months = (days / 30.44);
    const periodRet = gain / invested;              // frakce
    const annPct = annualize(periodRet, days);
    const perLabel = months >= 1.5 ? `${months.toFixed(1).replace('.', ',')} měsíce` : `${days} dní`;
    const mkt = (state.market || []).find(m => m.provider === provider);
    let mktRows = '';
    // Preferuj devizově korigované (CZK) hodnoty; fallback na USD
    const useCzk = mkt && mkt.spStartCzk > 0 && mkt.spCurrentCzk > 0;
    const spA = useCzk ? (mkt && mkt.spStartCzk) : (mkt && mkt.spStart);
    const spB = useCzk ? (mkt && mkt.spCurrentCzk) : (mkt && mkt.spCurrent);
    if (mkt && spA > 0 && spB > 0) {
      const mDays = Math.max(days, 1);
      const mktRet = spB / spA - 1;
      const mktAnn = annualize(mktRet, mDays);
      const diffPP = (periodRet - mktRet) * 100;    // procentní body za období
      // Debug rozklad: index v USD × pohyb kurzu USD/CZK = výsledek v CZK
      let debug = '';
      if (useCzk && mkt.spStart > 0) {
        const idxUsdPct = (mkt.spCurrent / mkt.spStart - 1) * 100;
        const fxStart = mkt.spStartCzk / mkt.spStart, fxCur = mkt.spCurrentCzk / mkt.spCurrent;
        const fxPct = (fxCur / fxStart - 1) * 100;
        debug = `<div style="font-size:11px;color:var(--text3);margin:2px 0 0 12px;line-height:1.6">
          ↳ index ${idxUsdPct >= 0 ? '+' : ''}${idxUsdPct.toFixed(1).replace('.', ',')} % (USD) × kurz USD/CZK ${fxStart.toFixed(2).replace('.', ',')}→${fxCur.toFixed(2).replace('.', ',')} (${fxPct >= 0 ? '+' : ''}${fxPct.toFixed(1).replace('.', ',')} %) = ${pctTxt(mktRet * 100)} v CZK</div>`;
      }
      mktRows = `
        <div class="metric-row"><div><strong>S&amp;P 500 za stejné období</strong><span>americký trh${useCzk ? ' (v CZK)' : ''} · ~${(mktAnn).toFixed(1).replace('.', ',')} % p.a.</span></div><strong class="${mktRet >= 0 ? 'ap' : 'an'}">${pctTxt(mktRet * 100)}</strong></div>${debug}
        <div class="insight insight-badged" style="margin-top:10px"><div><strong>${diffPP >= 0 ? '✅ Předbíháš trh' : '⚠️ Zaostáváš za trhem'}</strong><span>Tvé fondy vs. S&amp;P 500${useCzk ? ' (korigováno kurzem USD/CZK)' : ''} za ${perLabel}.</span></div><strong class="insight-badge" style="color:${diffPP >= 0 ? 'var(--green)' : 'var(--red)'}">${diffPP >= 0 ? '+' : ''}${diffPP.toFixed(1).replace('.', ',')} pp</strong></div>`;
    } else {
      mktRows = `<div style="font-size:11px;color:var(--text3);margin-top:8px">Srovnání s S&amp;P 500 se doplní po kliknutí na „🔄 Aktualizovat kurzy".</div>`;
    }
    compCard = `<div class="card" style="margin-top:16px">
      <div class="card-hdr"><div class="ct">Výkonnost &amp; srovnání</div></div>
      <div class="metric-row"><div><strong>Zhodnocení fondů</strong><span>za ${perLabel} · tempo ~${annPct.toFixed(1).replace('.', ',')} % p.a. (extrapolace)</span></div><strong class="${periodRet >= 0 ? 'ap' : 'an'}">${pctTxt(periodRet * 100)}</strong></div>
      <div class="metric-row"><div><strong>Typický spořicí účet</strong><span>orientační reference</span></div><strong style="color:var(--text2)">~${SAVINGS_PA} % p.a.</strong></div>
      ${mktRows}
    </div>`;
  }

  el.innerHTML = cards + compCard + `<div class="card" style="margin-top:16px">
    <div class="card-hdr"><div class="ct">Fondy — nákupní vs. aktuální cena</div></div>
    <div class="tw"><table><thead><tr><th>Fond</th><th>Počet CP</th><th>Nákup NAV</th><th>Aktuál NAV</th><th>Změna</th><th>Změna CZK</th><th>Hodnota</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${cashRow}
    <div style="font-size:11px;color:var(--text3);margin-top:12px">Aktuální NAV k datu ${funds[0].aktualNAVdatum || '—'}${_lastRefresh && !_lastRefresh.error ? ` · 🔄 staženo z webu ${_lastRefresh.when.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}. Tyto fondy se oceňují měsíčně, nejde o realtime kurz.</div>
  </div>`;
}

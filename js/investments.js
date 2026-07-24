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
    toast(`Kurzy aktualizovány (${d.updated} fondů${d.eur ? `, EUR ${d.eur.toFixed(2)}` : ''})`, 'ok');
    await loadInvestmentData();
  } catch (e) {
    toast('Chyba aktualizace kurzů: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Aktualizovat kurzy'; }
  }
}

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
      datum: r[0], isin: String(r[1]), provider: r[2], nav: pn(r[3]), hodnotaCZK: pn(r[4])
    }));
    state.trhHist = (thR.values || []).slice(1).filter(r => r[0]).map(r => ({
      datum: r[0], spCzk: pn(r[3]) || pn(r[1])   // preferuj CZK; fallback USD
    })).filter(r => r.spCzk > 0);
    renderInv();
  } catch (e) { /* investice jsou volitelné — neshodit boot */ }
}

// "26.2.2026" → Date (pro výpočet délky držby)
function czDate(s) {
  const m = String(s).match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
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
window.invChartSel = function (v) { _chartSel = v; renderOverview(); };

function renderOverview() {
  const el = document.getElementById('inv-overview');
  if (!el) return;
  const funds = state.investments || [];
  if (!funds.length) {
    el.innerHTML = `<div class="empty" style="padding:48px 0">Zatím žádná data. Nahraj výpis přes „📥 Nahrát výpis".</div>`;
    return;
  }

  // --- Alokace: CODYA / CONSEQ / hotovost ---
  const provVal = {};
  let cash = 0;
  funds.forEach(f => { provVal[f.provider] = (provVal[f.provider] || 0) + curCZK(f); cash += (f.hotovostCZK || 0); });
  const segs = [
    { label: 'CODYA', val: provVal['CODYA'] || 0, color: 'var(--blue)' },
    { label: 'CONSEQ', val: provVal['CONSEQ'] || 0, color: 'var(--green)' },
    { label: 'Volná hotovost', val: cash, color: 'var(--text3)' }
  ].filter(s => s.val > 0);
  const totAlloc = segs.reduce((s, x) => s + x.val, 0) || 1;
  const bar = segs.map(s => `<div style="width:${(s.val / totAlloc * 100).toFixed(1)}%;background:${s.color}"></div>`).join('');
  const legend = segs.map(s => `<div class="portfolio-row"><div><div class="portfolio-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px"></span>${s.label}</div></div><div class="portfolio-val">${czk(s.val)}</div><div class="portfolio-pct">${Math.round(s.val / totAlloc * 100)} %</div></div>`).join('');
  const allocCard = `<div class="card">
    <div class="card-hdr"><div class="ct">Celková alokace majetku</div></div>
    <div class="split-track" style="margin-bottom:14px">${bar}</div>
    ${legend}
    <div class="portfolio-total"><span>Celkem</span><span>${czk(totAlloc)}</span></div>
  </div>`;

  // --- Graf vývoje vs S&P ---
  el.innerHTML = allocCard + `<div class="card" style="margin-top:16px">
    <div class="card-hdr"><div class="ct">Vývoj vs. S&amp;P 500 (rebasováno na 100, v CZK)</div>
      <select class="sel" onchange="invChartSel(this.value)">${chartSelOptions()}</select></div>
    <div id="invChart"></div>
  </div>`;
  document.getElementById('invChart').innerHTML = buildChart();
}

function chartSelOptions() {
  const opts = [['all', 'CODYA + CONSEQ + S&P'], ['CODYA', 'CODYA celkem vs S&P'], ['CONSEQ', 'CONSEQ celkem vs S&P']];
  (state.investments || []).forEach(f => opts.push(['isin:' + f.isin, (f.nazev || f.isin).slice(0, 40) + ' vs S&P']));
  return opts.map(([v, l]) => `<option value="${v}"${v === _chartSel ? ' selected' : ''}>${l}</option>`).join('');
}

// Časová řada hodnoty portfolia (součet hodnotaCZK) pro filtr, seřazená dle data
function histSeries(filterFn) {
  const byDate = {};
  (state.invHist || []).filter(filterFn).forEach(h => { byDate[h.datum] = (byDate[h.datum] || 0) + h.hodnotaCZK; });
  return Object.keys(byDate).sort().map(d => ({ t: d, v: byDate[d] }));
}
// Rebase řady na 100 v prvním bodě
function rebase(pts) {
  if (!pts.length || !pts[0].v) return [];
  const base = pts[0].v;
  return pts.map(p => ({ t: p.t, v: p.v / base * 100 }));
}
// S&P (CZK) rebasovaná na 100 k danému startovnímu datu
function spSeries(startISO) {
  const th = (state.trhHist || []).slice().sort((a, b) => a.datum < b.datum ? -1 : 1);
  if (!th.length) return [];
  let base = 0;
  for (const r of th) { if (r.datum <= startISO) base = r.spCzk; }
  if (!base) base = th[0].spCzk;
  return th.filter(r => r.datum >= startISO).map(r => ({ t: r.datum, v: r.spCzk / base * 100 }));
}

function buildChart() {
  const series = [];
  const codya = rebase(histSeries(h => h.provider === 'CODYA'));
  const conseq = rebase(histSeries(h => h.provider === 'CONSEQ'));
  const startOf = s => s.length ? s[0].t : null;

  if (_chartSel === 'all') {
    if (codya.length) series.push({ label: 'CODYA', color: 'var(--blue)', pts: codya });
    if (conseq.length) series.push({ label: 'CONSEQ', color: 'var(--green)', pts: conseq });
    const earliest = [startOf(codya), startOf(conseq)].filter(Boolean).sort()[0];
    if (earliest) series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(earliest) });
  } else if (_chartSel === 'CODYA' || _chartSel === 'CONSEQ') {
    const s = _chartSel === 'CODYA' ? codya : conseq;
    if (s.length) { series.push({ label: _chartSel, color: 'var(--blue)', pts: s }); series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(s[0].t) }); }
  } else if (_chartSel.startsWith('isin:')) {
    const isin = _chartSel.slice(5);
    const s = rebase(histSeries(h => h.isin === isin));
    if (s.length) { series.push({ label: (state.investments.find(f => f.isin === isin) || {}).nazev || isin, color: 'var(--purple)', pts: s }); series.push({ label: 'S&P 500', color: 'var(--amber)', pts: spSeries(s[0].t) }); }
  }
  return lineChartSVG(series);
}

// SVG multi-line graf. series: [{label,color,pts:[{t:'YYYY-MM-DD',v}]}] (rebased)
function lineChartSVG(series) {
  const withPts = series.filter(s => s.pts && s.pts.length);
  if (!withPts.length) return `<div class="empty" style="padding:32px 0">Historie se zatím sbírá — po pár aktualizacích kurzů se tu objeví křivky. (Klikni na „🔄 Aktualizovat kurzy".)</div>`;
  const W = 720, H = 260, padL = 40, padR = 12, padT = 16, padB = 40;
  const allDates = [...new Set(withPts.flatMap(s => s.pts.map(p => p.t)))].sort();
  const t2i = {}; allDates.forEach((d, i) => t2i[d] = i);
  const xN = Math.max(allDates.length - 1, 1);
  const vals = withPts.flatMap(s => s.pts.map(p => p.v));
  const vMin = Math.min(...vals, 100), vMax = Math.max(...vals, 100);
  const pad = (vMax - vMin) * 0.1 || 5;
  const lo = vMin - pad, hi = vMax + pad;
  const x = i => padL + (i / xN) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  // mřížka: 100 (baseline) + min/max
  let grid = '';
  [100, hi, lo].forEach(gv => {
    grid += `<line x1="${padL}" y1="${y(gv)}" x2="${W - padR}" y2="${y(gv)}" stroke="var(--border)" stroke-width="${gv === 100 ? 1.5 : 1}" ${gv === 100 ? '' : 'stroke-dasharray="3 3"'}/>
      <text x="${padL - 5}" y="${y(gv) + 3}" text-anchor="end" font-size="9" fill="var(--text3)">${Math.round(gv)}</text>`;
  });
  // osa X: první a poslední datum
  const fmtD = iso => { const p = iso.split('-'); return p[2] + '.' + p[1] + '.'; };
  grid += `<text x="${padL}" y="${H - padB + 16}" font-size="9" fill="var(--text3)">${fmtD(allDates[0])}</text>
    <text x="${W - padR}" y="${H - padB + 16}" text-anchor="end" font-size="9" fill="var(--text3)">${fmtD(allDates[allDates.length - 1])}</text>`;

  const lines = withPts.map(s => {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(t2i[p.t]).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const dots = s.pts.length <= 12 ? s.pts.map(p => `<circle cx="${x(t2i[p.t]).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="${s.color}"/>`).join('') : '';
    const last = s.pts[s.pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}
      <text x="${(x(t2i[last.t]) - 2).toFixed(1)}" y="${(y(last.v) - 5).toFixed(1)}" text-anchor="end" font-size="9" font-weight="700" fill="${s.color}">${last.v.toFixed(0)}</text>`;
  }).join('');
  const legend = `<div class="legend" style="margin-top:8px">${withPts.map(s => `<div class="li"><div class="ld" style="background:${s.color};border-radius:3px"></div>${s.label}${s.pts.length === 1 ? ' (1 bod)' : ''}</div>`).join('')}</div>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">${grid}${lines}</svg>${legend}`;
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
      mktRows = `
        <div class="metric-row"><div><strong>S&amp;P 500 za stejné období</strong><span>americký trh${useCzk ? ' (v CZK)' : ''} · ~${(mktAnn).toFixed(1).replace('.', ',')} % p.a.</span></div><strong class="${mktRet >= 0 ? 'ap' : 'an'}">${pctTxt(mktRet * 100)}</strong></div>
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
    <div style="font-size:11px;color:var(--text3);margin-top:12px">Aktuální NAV k datu posledního výpisu (${funds[0].aktualNAVdatum || '—'}). Tyto fondy se oceňují měsíčně, nejde o realtime kurz.</div>
  </div>`;
}

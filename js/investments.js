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
    const r = await fetch(GAS_URL + '?sheet=Fondy');
    const d = await r.json();
    if (d.error) { state.investments = []; renderInv(); return; } // list ještě neexistuje
    state.investments = (d.values || []).map(parseFundRow).filter(f => /^CZ\d{10}$/.test(f.isin));
    renderInv();
  } catch (e) { /* investice jsou volitelné — neshodit boot */ }
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
  renderProviderView('codya', 'CODYA');
  renderProviderView('conseq', 'CONSEQ');
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

  el.innerHTML = cards + `<div class="card" style="margin-top:16px">
    <div class="card-hdr"><div class="ct">Fondy — nákupní vs. aktuální cena</div></div>
    <div class="tw"><table><thead><tr><th>Fond</th><th>Počet CP</th><th>Nákup NAV</th><th>Aktuál NAV</th><th>Změna</th><th>Změna CZK</th><th>Hodnota</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${cashRow}
    <div style="font-size:11px;color:var(--text3);margin-top:12px">Aktuální NAV k datu posledního výpisu (${funds[0].aktualNAVdatum || '—'}). Tyto fondy se oceňují měsíčně, nejde o realtime kurz.</div>
  </div>`;
}

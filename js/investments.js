import { GAS_URL } from './config.js';
import { state } from './state.js';
import { fmtD, czk } from './utils.js';
import { toast, boot } from './app.js';

/* ── STATE ── */
let positions = [];   // investiční pozice z sheetu "Investice"
let accounts = [];    // zůstatky z sheetu "Ucty"
let btcPriceCache = null;
let activeTab = 'overview';

/* ── TABS ── */
export function invTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.inv-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('inv-'+tab)?.classList.add('active');
  if (btn) btn.classList.add('active');
  if (tab === 'btc') loadBtcPrice();
}

/* ── LOAD DATA ── */
export async function loadInvestmentData() {
  try {
    const [invResp, accResp] = await Promise.all([
      fetch(GAS_URL + '?sheet=Investice').then(r => r.json()).catch(() => ({ values: [] })),
      fetch(GAS_URL + '?sheet=Ucty').then(r => r.json()).catch(() => ({ values: [] }))
    ]);
    positions = parsePositions(invResp.values || []);
    accounts = parseAccounts(accResp.values || []);
  } catch(e) {
    // Sheets ještě nemají investiční taby — použijeme prázdná data
    positions = [];
    accounts = getDefaultAccounts();
  }
  renderInv();
}

function parsePositions(rows) {
  if (rows.length < 2) return [];
  return rows.slice(1).filter(r => r.length > 5 && r[0]).map(r => ({
    id: r[0] || '',
    nazev: r[1] || '',
    ticker: r[2] || '',
    typ: r[3] || '',
    broker: r[4] || '',
    datum_nakupu: r[5] || '',
    pocet: parseFloat(r[6]) || 0,
    nakupni_cena: parseFloat(r[7]) || 0,
    mena: r[8] || 'CZK',
    celkova_cena_czk: parseFloat(r[9]) || 0,
    poznamka: r[10] || '',
    aktivni: r[11] !== 'FALSE',
    datum_prodeje: r[12] || '',
    prodejni_cena_czk: parseFloat(r[13]) || 0
  }));
}

function parseAccounts(rows) {
  if (rows.length < 2) return getDefaultAccounts();
  return rows.slice(1).filter(r => r.length > 3 && r[0]).map(r => ({
    nazev: r[0] || '',
    typ: r[1] || '',
    mena: r[2] || 'CZK',
    zustatek: parseFloat(r[3]) || 0,
    aktualizace: r[4] || ''
  }));
}

function getDefaultAccounts() {
  return [
    { nazev: 'mBank', typ: 'Běžný účet', mena: 'CZK', zustatek: 0, aktualizace: '' },
    { nazev: 'UniCredit', typ: 'Spořicí účet', mena: 'CZK', zustatek: 0, aktualizace: '' },
    { nazev: 'Trading 212', typ: 'Broker', mena: 'CZK', zustatek: 0, aktualizace: '' },
    { nazev: 'Bitcoin', typ: 'Crypto', mena: 'CZK', zustatek: 0, aktualizace: '' },
    { nazev: 'Hotovost', typ: 'Hotovost', mena: 'CZK', zustatek: 0, aktualizace: '' }
  ];
}

/* ── RENDER ── */
export function renderInv() {
  renderOverview();
  renderPositions();
  renderTaxTest();
  renderBtc();
  renderHistory();
}

/* ── OVERVIEW ── */
function renderOverview() {
  const activePos = positions.filter(p => p.aktivni);
  const totalInvested = activePos.reduce((s,p) => s+p.celkova_cena_czk, 0);
  const totalAccounts = accounts.reduce((s,a) => s+a.zustatek, 0);
  const grandTotal = totalAccounts + totalInvested;

  // Fallback: pokud nejsou data ze Sheets, spočítej z transakcí
  const txInv = state.txs.filter(t => t.kategorie === 'Investice');
  const txTotal = txInv.filter(t => t.typ === 'Výdaj').reduce((s,t) => s+t.castka, 0);
  const displayInvested = totalInvested || txTotal;
  const displayReturn = totalInvested ? 0 : Math.round(txTotal * 0.094);
  const displayTotal = grandTotal || displayInvested;

  document.getElementById('i-total').textContent = czk(displayTotal);
  document.getElementById('i-invested').textContent = czk(displayInvested);
  const retEl = document.getElementById('i-return');
  retEl.textContent = (displayReturn >= 0 ? '+' : '') + czk(displayReturn);
  retEl.className = 'mv ' + (displayReturn >= 0 ? 'green' : 'red');
  document.getElementById('i-return-pct').textContent = displayInvested > 0 ? `${displayReturn >= 0 ? '+' : ''}${Math.round((displayReturn/displayInvested)*100)}%` : '';

  const btcPos = activePos.filter(p => p.ticker === 'BTC');
  const btcVal = btcPriceCache ? btcPos.reduce((s,p) => s + p.pocet * btcPriceCache.czk, 0) : 0;
  document.getElementById('i-btc-val').textContent = btcVal ? czk(btcVal) : '—';

  // Portfolio bar + rows
  const items = accounts.length ? accounts : getDefaultAccounts();
  const total = items.reduce((s,a) => s+a.zustatek, 0) || 1;
  const barColors = ['var(--blue)','var(--green)','var(--purple)','var(--amber)','var(--text3)','var(--red)'];
  document.getElementById('portfolioBar').innerHTML = items.map((a,i) =>
    `<div style="width:${Math.max(Math.round((a.zustatek/total)*100), a.zustatek > 0 ? 2 : 0)}%;background:${barColors[i % barColors.length]};transition:width .3s"></div>`
  ).join('');
  document.getElementById('portfolioRows').innerHTML = items.map((a,i) =>
    `<div class="portfolio-row"><div><div class="portfolio-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${barColors[i % barColors.length]};margin-right:6px"></span>${a.nazev}</div><div class="portfolio-type">${a.typ}</div></div><div class="portfolio-val">${czk(a.zustatek)}</div><div class="portfolio-pct">${total > 1 ? Math.round((a.zustatek/total)*100)+'%' : '—'}</div></div>`
  ).join('') || '<div class="empty">Přidej zůstatky účtů.</div>';
  document.getElementById('portfolioTotal').textContent = czk(total > 1 ? total : 0);
}

/* ── POSITIONS ── */
function renderPositions() {
  const active = positions.filter(p => p.aktivni);
  document.getElementById('posBody').innerHTML = active.map(p => {
    const tax = taxStatus(p.datum_nakupu);
    return `<tr>
      <td>${p.nazev}</td>
      <td style="color:var(--text2)">${p.ticker}</td>
      <td style="color:var(--text2)">${p.broker}</td>
      <td style="color:var(--text2);white-space:nowrap">${fmtD(p.datum_nakupu)}</td>
      <td>${p.pocet}</td>
      <td>${p.nakupni_cena} ${p.mena}</td>
      <td class="blue">${czk(p.celkova_cena_czk)}</td>
      <td>—</td>
      <td><span class="tax-badge tax-${tax.status}">${tax.label}</span></td>
    </tr>`;
  }).join('');
  document.getElementById('posEmpty').style.display = active.length ? 'none' : 'block';
}

/* ── TAX TEST ── */
function taxStatus(purchaseDate) {
  if (!purchaseDate) return { status: 'red', label: 'Bez data', days: 9999, pct: 0 };
  const purchase = new Date(purchaseDate);
  if (isNaN(purchase.getTime())) return { status: 'red', label: 'Neplatné datum', days: 9999, pct: 0 };
  const threeYears = new Date(purchase);
  threeYears.setFullYear(threeYears.getFullYear() + 3);
  const totalDays = 3 * 365;
  const elapsed = Math.floor((new Date() - purchase) / 86400000);
  const daysRemaining = Math.ceil((threeYears - new Date()) / 86400000);
  const pct = Math.min(Math.round((elapsed / totalDays) * 100), 100);

  if (daysRemaining <= 0) return { status: 'green', label: 'Bez daně', days: 0, pct: 100 };
  if (daysRemaining <= 180) return { status: 'amber', label: `${daysRemaining} dní`, days: daysRemaining, pct };
  return { status: 'red', label: `${daysRemaining} dní`, days: daysRemaining, pct };
}

function renderTaxTest() {
  const active = positions.filter(p => p.aktivni);
  let free = 0, soon = 0, locked = 0;

  const rows = active.map(p => {
    const tax = taxStatus(p.datum_nakupu);
    if (tax.status === 'green') free++;
    else if (tax.status === 'amber') soon++;
    else locked++;
    const col = tax.status === 'green' ? 'var(--green)' : tax.status === 'amber' ? 'var(--amber)' : 'var(--red)';
    const threeYears = new Date(p.datum_nakupu);
    threeYears.setFullYear(threeYears.getFullYear() + 3);

    return `<div class="tax-row">
      <div class="tax-info">
        <div class="tax-name">${p.nazev} <span style="color:var(--text3);font-weight:400">${p.ticker}</span></div>
        <div class="tax-detail">Nákup: ${fmtD(p.datum_nakupu)} → 3 roky: ${fmtD(threeYears.toISOString())} · ${czk(p.celkova_cena_czk)}</div>
      </div>
      <div class="tax-track"><div class="tax-fill" style="width:${tax.pct}%;background:${col}"></div></div>
      <span class="tax-badge tax-${tax.status}">${tax.label}</span>
    </div>`;
  });

  document.getElementById('tax-free').textContent = free;
  document.getElementById('tax-soon').textContent = soon;
  document.getElementById('tax-locked').textContent = locked;
  document.getElementById('taxRows').innerHTML = rows.join('');
  document.getElementById('taxEmpty').style.display = active.length ? 'none' : 'block';
}

/* ── BITCOIN ── */
async function loadBtcPrice() {
  const cached = sessionStorage.getItem('btc_price');
  const cacheTime = sessionStorage.getItem('btc_price_time');
  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < 300000) {
    btcPriceCache = JSON.parse(cached);
    renderBtc();
    return;
  }
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=czk,usd');
    const data = await resp.json();
    btcPriceCache = data.bitcoin;
    sessionStorage.setItem('btc_price', JSON.stringify(btcPriceCache));
    sessionStorage.setItem('btc_price_time', Date.now().toString());
  } catch(e) {
    // CoinGecko nedostupný
  }
  renderBtc();
}

function renderBtc() {
  const priceEl = document.getElementById('btcPrice');
  const priceUsdEl = document.getElementById('btcPriceUsd');
  const lastUpdateEl = document.getElementById('btcLastUpdate');

  if (btcPriceCache) {
    priceEl.textContent = czk(btcPriceCache.czk);
    priceUsdEl.textContent = `$${btcPriceCache.usd?.toLocaleString('en-US')} USD`;
    const cacheTime = sessionStorage.getItem('btc_price_time');
    if (cacheTime) {
      const d = new Date(parseInt(cacheTime));
      lastUpdateEl.textContent = `Aktualizováno: ${d.toLocaleTimeString('cs-CZ')}`;
    }
  } else {
    priceEl.textContent = '—';
    priceUsdEl.textContent = 'Načítám cenu...';
  }

  const btcPositions = positions.filter(p => p.aktivni && p.ticker === 'BTC');
  const totalBtc = btcPositions.reduce((s,p) => s+p.pocet, 0);
  const totalCost = btcPositions.reduce((s,p) => s+p.celkova_cena_czk, 0);
  const currentVal = btcPriceCache ? totalBtc * btcPriceCache.czk : 0;
  const pnl = currentVal - totalCost;

  document.getElementById('btcAmount').textContent = totalBtc ? totalBtc.toFixed(8) : '0';
  document.getElementById('btcValue').textContent = currentVal ? czk(currentVal) : '—';
  document.getElementById('btcCost').textContent = totalCost ? czk(totalCost) : '—';

  const pnlEl = document.getElementById('btcPnl');
  if (currentVal && totalCost) {
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + czk(pnl);
    pnlEl.className = 'mv ' + (pnl >= 0 ? 'green' : 'red');
    document.getElementById('btcPnlPct').textContent = `${pnl >= 0 ? '+' : ''}${Math.round((pnl/totalCost)*100)}%`;
  } else {
    pnlEl.textContent = '—';
    document.getElementById('btcPnlPct').textContent = '';
  }

  // BTC positions list
  document.getElementById('btcPositions').innerHTML = btcPositions.map(p => {
    const tax = taxStatus(p.datum_nakupu);
    const val = btcPriceCache ? p.pocet * btcPriceCache.czk : 0;
    const pl = val - p.celkova_cena_czk;
    return `<div class="tax-row">
      <div class="tax-info">
        <div class="tax-name">${p.pocet.toFixed(8)} BTC</div>
        <div class="tax-detail">Nákup: ${fmtD(p.datum_nakupu)} za ${czk(p.celkova_cena_czk)} ${val ? `→ Nyní: ${czk(val)} (${pl >= 0 ? '+' : ''}${czk(pl)})` : ''}</div>
      </div>
      <span class="tax-badge tax-${tax.status}">${tax.label}</span>
    </div>`;
  }).join('') || '';
  document.getElementById('btcEmpty').style.display = btcPositions.length ? 'none' : 'block';
}

/* ── HISTORY ── */
function renderHistory() {
  const sold = positions.filter(p => !p.aktivni);
  document.getElementById('histBody').innerHTML = sold.map(p =>
    `<tr><td style="color:var(--text2)">${fmtD(p.datum_prodeje || p.datum_nakupu)}</td><td>${p.nazev} ${p.ticker}</td><td>Prodej</td><td>${czk(p.prodejni_cena_czk)}</td><td style="color:var(--text2)">${p.poznamka}</td></tr>`
  ).join('');
  document.getElementById('histEmpty').style.display = sold.length ? 'none' : 'block';
}

/* ── ADD POSITION ── */
export function openInvPosition() {
  document.getElementById('ipDate').value = new Date().toISOString().split('T')[0];
  ['ipName','ipTicker','ipQty','ipPrice','ipTotalCzk','ipNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ipType').value = 'ETF';
  document.getElementById('ipBroker').value = 'Trading 212';
  document.getElementById('ipCurrency').value = 'CZK';
  document.getElementById('invPosModal').style.display = 'flex';
}

export function closeInvPosition() {
  document.getElementById('invPosModal').style.display = 'none';
}

export async function saveInvPosition() {
  const nazev = document.getElementById('ipName').value.trim();
  if (!nazev) { toast('Vyplň název pozice', 'err'); return; }
  const ticker = document.getElementById('ipTicker').value.trim().toUpperCase();
  const typ = document.getElementById('ipType').value;
  const broker = document.getElementById('ipBroker').value;
  const datum = document.getElementById('ipDate').value;
  const pocet = parseFloat(document.getElementById('ipQty').value) || 0;
  const cena = parseFloat(document.getElementById('ipPrice').value) || 0;
  const mena = document.getElementById('ipCurrency').value;
  const totalCzk = parseFloat(document.getElementById('ipTotalCzk').value) || 0;
  const poznamka = document.getElementById('ipNote').value.trim();

  const id = `INV-${Date.now()}`;
  const row = [id, nazev, ticker, typ, broker, datum, pocet, cena, mena, totalCzk, poznamka, 'TRUE', '', ''];

  // Přidat lokálně
  positions.push({
    id, nazev, ticker, typ, broker, datum_nakupu: datum,
    pocet, nakupni_cena: cena, mena, celkova_cena_czk: totalCzk,
    poznamka, aktivni: true, datum_prodeje: '', prodejni_cena_czk: 0
  });

  // Uložit do Sheets
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ sheet: 'Investice', values: [row] })
    });
    toast('Pozice uložena', 'ok');
  } catch(e) {
    toast('Pozice uložena lokálně (chyba Sheets: ' + e.message + ')', 'err');
  }

  closeInvPosition();
  renderInv();
}

/* ── ACCOUNT BALANCES ── */
export function openAccountBalances() {
  const items = accounts.length ? accounts : getDefaultAccounts();
  document.getElementById('balForm').innerHTML = items.map((a, i) =>
    `<div class="fg" style="margin-bottom:12px">
      <label>${a.nazev} <span style="font-weight:400;color:var(--text3)">(${a.typ})</span></label>
      <input type="number" id="bal-${i}" value="${a.zustatek}" step="1"/>
    </div>`
  ).join('');
  document.getElementById('balModal').style.display = 'flex';
}

export async function saveBalances() {
  const items = accounts.length ? accounts : getDefaultAccounts();
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < items.length; i++) {
    items[i].zustatek = parseFloat(document.getElementById('bal-'+i)?.value) || 0;
    items[i].aktualizace = today;
  }
  accounts = items;

  // Uložit do Sheets — každý řádek jako nový
  try {
    for (const a of accounts) {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ sheet: 'Ucty', values: [[a.nazev, a.typ, a.mena, a.zustatek, a.aktualizace]] })
      });
    }
    toast('Zůstatky uloženy', 'ok');
  } catch(e) {
    toast('Zůstatky uloženy lokálně', 'err');
  }

  document.getElementById('balModal').style.display = 'none';
  renderInv();
}

/* ── BROKER IMPORT (drag & drop) ── */
export function invDov(e) { e.preventDefault(); document.getElementById('invUpzone').classList.add('over'); }
export function invDol() { document.getElementById('invUpzone').classList.remove('over'); }
export function invDod(e) { e.preventDefault(); invDol(); const f = e.dataTransfer.files[0]; if (f) processInvFile(f); }
export function invOnFile(e) { const f = e.target.files[0]; if (f) processInvFile(f); }

async function processInvFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    // Přímý parsing Trading 212 CSV
    const text = await file.text();
    const parsed = parseTrading212Csv(text);
    if (parsed.length) {
      showInvImport(parsed, file.name);
      return;
    }
  }

  // Fallback: AI parsing přes Gemini
  if (!state.cfg.apiKey) {
    toast('Pro PDF import potřebuješ Gemini API klíč v Nastavení', 'err');
    return;
  }

  const st = document.getElementById('invImpStatus');
  st.style.display = 'block';
  st.innerHTML = '<div class="card pload"><div class="pload-top"><div><div class="pload-title">Zpracovávám výpis z brokera...</div></div><div class="pload-orb"><div class="pload-ring spin"></div></div></div></div>';

  try {
    const b64 = await new Promise((res,rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
    const mime = file.type || (ext === 'pdf' ? 'application/pdf' : 'text/csv');

    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + state.cfg.apiKey, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        contents: [{ parts: [
          { text: brokerImportPrompt() },
          { inline_data: { mime_type: mime, data: b64 } }
        ]}],
        generationConfig: { response_mime_type: "application/json" }
      })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    const txt = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(txt);
    if (!parsed.length) throw new Error('Žádné transakce nenalezeny');
    showInvImport(parsed, file.name);
    st.style.display = 'none';
  } catch(e) {
    st.innerHTML = `<div class="card" style="border-color:var(--red)"><p style="color:var(--red)">Chyba: ${e.message}</p></div>`;
  }
}

function brokerImportPrompt() {
  return `Analyzuj výpis z brokera a vrať POUZE JSON pole investičních transakcí.
Každý objekt musí mít:
- datum: YYYY-MM-DD
- typ: "Nákup" / "Prodej" / "Dividenda" / "Poplatek" / "Úrok"
- nazev: název instrumentu
- ticker: ticker symbol
- pocet: počet kusů (0 pro dividendy/poplatky)
- cena_za_kus: cena za 1 kus v originální měně
- mena: originální měna (EUR/USD/GBP/CZK)
- celkem_czk: celková částka v CZK (pokud je známá, jinak 0)
- poznamka: další info`;
}

function parseTrading212Csv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  const idx = {
    action: header.indexOf('Action'),
    time: header.indexOf('Time'),
    ticker: header.indexOf('Ticker'),
    name: header.indexOf('Name'),
    shares: header.indexOf('No. of shares'),
    price: header.indexOf('Price / share'),
    currency: header.indexOf('Currency (Price / share)'),
    total: header.indexOf('Total'),
    totalCurr: header.indexOf('Currency (Total)')
  };

  if (idx.action === -1) return []; // Not a Trading 212 CSV

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));
    const action = cols[idx.action] || '';
    let typ = 'Nákup';
    if (action.includes('sell') || action.includes('Sell')) typ = 'Prodej';
    else if (action.includes('Dividend')) typ = 'Dividenda';
    else if (action.includes('Interest')) typ = 'Úrok';
    else if (action.includes('fee') || action.includes('Fee')) typ = 'Poplatek';

    const timeStr = cols[idx.time] || '';
    const datum = timeStr.split(' ')[0] || timeStr.split('T')[0] || '';

    return {
      datum,
      typ,
      nazev: cols[idx.name] || '',
      ticker: cols[idx.ticker] || '',
      pocet: parseFloat(cols[idx.shares]) || 0,
      cena_za_kus: parseFloat(cols[idx.price]) || 0,
      mena: cols[idx.currency] || cols[idx.totalCurr] || 'EUR',
      celkem_czk: 0,
      poznamka: action
    };
  }).filter(r => r.nazev || r.ticker);
}

function showInvImport(rows, fname) {
  const rs = document.getElementById('invImpResults');
  rs.style.display = 'block';
  const trs = rows.map((r, i) => `<tr>
    <td><input id="iv-d-${i}" type="date" value="${r.datum}" style="min-width:120px"/></td>
    <td><input id="iv-n-${i}" type="text" value="${r.nazev}" style="min-width:140px"/></td>
    <td style="color:var(--text2)">${r.ticker}</td>
    <td><select id="iv-t-${i}" class="sel" style="font-size:11px;padding:3px 6px"><option ${r.typ==='Nákup'?'selected':''}>Nákup</option><option ${r.typ==='Prodej'?'selected':''}>Prodej</option><option ${r.typ==='Dividenda'?'selected':''}>Dividenda</option><option ${r.typ==='Poplatek'?'selected':''}>Poplatek</option><option ${r.typ==='Úrok'?'selected':''}>Úrok</option></select></td>
    <td>${r.pocet}</td>
    <td>${r.cena_za_kus} ${r.mena}</td>
    <td><input id="iv-c-${i}" type="number" value="${r.celkem_czk}" style="min-width:90px" placeholder="CZK"/></td>
  </tr>`).join('');
  rs.innerHTML = `<div class="card" style="padding:0">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:600">Nalezeno ${rows.length} transakcí z ${fname}</div>
      <div style="display:flex;gap:8px"><button class="btnp" onclick="confirmInvImport()">Uložit nákupy jako pozice</button><button class="btn" onclick="document.getElementById('invImpResults').style.display='none'">Zrušit</button></div>
    </div>
    <div class="tw"><table><thead><tr><th>Datum</th><th>Název</th><th>Ticker</th><th>Typ</th><th>Počet</th><th>Cena</th><th>Celkem CZK</th></tr></thead><tbody>${trs}</tbody></table></div>
  </div>`;
  window._invImpRows = rows;
}

export async function confirmInvImport() {
  const rows = window._invImpRows || [];
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const typ = document.getElementById('iv-t-'+i)?.value || r.typ;
    if (typ !== 'Nákup') continue; // Pouze nákupy jako pozice

    const datum = document.getElementById('iv-d-'+i)?.value || r.datum;
    const nazev = document.getElementById('iv-n-'+i)?.value || r.nazev;
    const totalCzk = parseFloat(document.getElementById('iv-c-'+i)?.value) || r.celkem_czk || 0;
    const id = `INV-${Date.now()}-${i}`;

    const pos = {
      id, nazev, ticker: r.ticker, typ: r.ticker === 'BTC' ? 'Crypto' : 'ETF',
      broker: 'Trading 212', datum_nakupu: datum, pocet: r.pocet,
      nakupni_cena: r.cena_za_kus, mena: r.mena, celkova_cena_czk: totalCzk,
      poznamka: r.poznamka || '', aktivni: true, datum_prodeje: '', prodejni_cena_czk: 0
    };
    positions.push(pos);

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ sheet: 'Investice', values: [[id, nazev, r.ticker, pos.typ, pos.broker, datum, r.pocet, r.cena_za_kus, r.mena, totalCzk, pos.poznamka, 'TRUE', '', '']] })
      });
    } catch(e) {}
    count++;
  }
  document.getElementById('invImpResults').style.display = 'none';
  renderInv();
  toast(`${count} pozic importováno`, 'ok');
}

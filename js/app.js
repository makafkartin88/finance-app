import { GAS_URL, DEMO, VERSION } from './config.js';
import { state } from './state.js';
import { parseRow, ensureRange, isoDate, rangeLabel, getBounds, scopedTxs, getMonths, fetchSheet, fetchSheets } from './utils.js';
import { renderDash, drillM, drillC, clearDrill } from './dashboard.js';
import { renderTx, openTx, openEdit, openVyrovnani, closeTx, saveTx, searchTx, triggerReceiptUpload, onReceiptFile, onModalReceiptPick, deleteTx, removeReceipt, syncOsobaRow } from './transactions.js';
import { renderBudgets, renderBudLimForm, saveLimits } from './budgets.js';
import { renderCharts } from './charts.js';
import { renderInv, invTab, loadInvestmentData, refreshInvNav } from './investments.js';
import { openInvImport, closeInvImport, invDov, invDol, invDod, invOnFile, confirmInvImport } from './inv-import.js';
import { reloadSheets, saveSettings, initSettings } from './settings.js';
import { initAuth, logout, isInvestmentsAllowed, isSalaryAllowed } from './auth.js';
import { loadRecurring, autoGenerateRecurring, openRecurring, closeRecurring, openRecForm, openRecEdit, closeRecForm, saveRecTemplate, generateRecurring, toggleRec, deleteRec, syncRecOsobaRow } from './recurring.js';
import { openMbankImport, closeMbankImport, mbankDov, mbankDol, mbankDod, onMbankFile, confirmMbankImport, loadMbankNotification, hideMbankBanner, toggleMbankDupDetail, importMbankFromDrive, mbankPickPending, mbankMarkDone, mbankCheckMail } from './mbank-import.js';
import { openColPopover, closePopover, toggleSort, cpSelectAll, cpClearFilter, cpApplyMulti, cpApplyRange } from './table-filters.js';
import { renderSalary, salApplyRange, salResetRange, salSelect } from './salary.js';
import { openSalaryImport, closeSalaryImport, salaryDov, salaryDol, salaryDod, onSalaryFile, confirmSalaryImport, loadSalaryData, hideSalaryBanner, importPayslipFromDrive, salaryPickPending, salaryMarkDone, salaryCheckMail } from './salary-import.js';

/* ── TOAST ── */
export function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show'+(type ? ' '+type : '');
  clearTimeout(state._tt);
  state._tt = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ── AUTH STATUS ── */
function setAuth(ok) {
  document.getElementById('adot').className = 'adot'+(ok ? ' ok' : '');
  document.getElementById('atext').textContent = ok ? 'Připojeno' : 'Nepřipojeno';
}

/* ── SHEETS (APPS SCRIPT) ──
   Apps Script se u KAŽDÉHO požadavku rozjíždí několik sekund, takže dřívější
   načítání (9 samostatných listů, část souběžně) trvalo desítky sekund.
   Teď ve třech krocích, aby appka byla použitelná co nejdřív:
     1. cache z localStorage → Přehled/Transakce se vykreslí okamžitě
     2. list Transakce samostatně → hlavní obsah je aktuální jako první
     3. zbytek JEDNÍM dávkovým požadavkem (?sheets=A,B,C) na pozadí
   Kroky 2 a 3 jsou oddělené schválně — kdyby se tahaly spolu, čekalo by se
   na to nejpomalejší (historie kurzů) i kvůli obyčejným transakcím. */
const TX_CACHE_KEY = 'txCacheV1';

export async function loadSheets() {
  // 1) Okamžité vykreslení z posledního známého stavu (bez čekání na síť)
  let hadCache = false;
  try {
    const cached = JSON.parse(localStorage.getItem(TX_CACHE_KEY) || 'null');
    if (cached && cached.length) {
      state.txs = cached.map(parseRow);
      boot();
      hadCache = true;
    }
  } catch (e) { /* poškozená cache nesmí zabránit načtení ze sítě */ }

  if (!hadCache) toast('Načítám data z Tabulky...');
  try {
    // 2) Transakce jako první — na nich stojí Přehled i stránka Transakce
    const d = await fetchSheet(GAS_URL + '?sheet=Transakce');
    if (d.error) throw new Error(d.error);
    const rows = (d.values || []).slice(1).filter(r => r.length > 2 && r[0]);
    state.txs = rows.map(parseRow);
    boot(); toast('Načteno ' + state.txs.length + ' transakcí', 'ok');
    setAuth(true);
    try { localStorage.setItem(TX_CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* plná quota */ }

    // 3) Zbytek na pozadí, jedním požadavkem. Listy pro skryté sekce se
    //    ani nestahují (gating stejný jako v samotných loaderech).
    const names = ['Recurring', 'MbankImport'];
    if (isInvestmentsAllowed()) names.push('Fondy', 'Trh', 'FondyHist', 'TrhHist');
    if (isSalaryAllowed()) names.push('Mzdy', 'MzdyImport');
    fetchSheets(names).then(s => {
      loadInvestmentData(isInvestmentsAllowed() ? s : undefined);
      loadRecurring(s.Recurring).then(autoGenerateRecurring);
      loadMbankNotification(s.MbankImport);
      loadSalaryData(s.Mzdy, s.MzdyImport);
    }).catch(() => { /* doplňková data — výpadek nesmí shodit appku */ });
  } catch(e) {
    toast('Chyba spojení s tabulkou: ' + e.message, 'err');
    if (!hadCache) { state.txs = DEMO.map(parseRow); boot(); }
    setAuth(false);
    loadInvestmentData();
    loadRecurring();
  }
}

/* ── BOOT ── */
export function boot() {
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv(); renderBudLimForm();
}

function populateSels() {
  ensureRange();
  const scoped = scopedTxs();
  const months = getMonths(scoped);
  const bMonth = document.getElementById('bMonth');
  if (bMonth) {
    const cur = bMonth.value;
    bMonth.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
    bMonth.value = months.includes(cur) ? cur : (months[months.length-1]||'');
  }
  const tf = document.getElementById('txfMonth');
  if (tf) tf.innerHTML = '<option value="">Všechny měsíce</option>'+months.map(m => `<option value="${m}">${m}</option>`).join('');
  const from = document.getElementById('dFrom'), to = document.getElementById('dTo');
  if (from) from.value = state._range.from;
  if (to) to.value = state._range.to;
  const dTxt = document.getElementById('dRangeTxt'); if (dTxt) dTxt.innerHTML = `<strong>${scoped.length} transakcí</strong>`;
  const cTxt = document.getElementById('chRangeTxt'); if (cTxt) cTxt.innerHTML = `<strong>${rangeLabel(state._range.from, state._range.to)}</strong><span>${scoped.length} transakcí</span>`;
  const scope = document.getElementById('dashScope'); if (scope) scope.textContent = `Rozsah: ${rangeLabel(state._range.from, state._range.to)}`;
}


/* ── NAV ── */
export function nav(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('p-'+id).classList.add('active');
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (id === 'transactions') {
    renderTx();
    ['txfMonth','txfCat','txfAcc'].forEach(sid => { const s = document.getElementById(sid); if (s) s.onchange = renderTx; });
  }
  if (id === 'charts') renderCharts();
  if (id === 'salary') renderSalary();
  if (id === 'settings') initSettings();
  location.hash = '#'+id;
}

/* Vydaje jsou spolecne — prepinac osoby (Oba/Martin/Sarka) uz v UI neni
   a state.person zustava natrvalo 'Oba'. Pole `osoba` na transakci dal
   existuje, ale slouzi uz jen bilanci prispevku Martin <-> Sarka. */

function applyRangeFromInputs() {
  const from = document.getElementById('dFrom')?.value;
  const to = document.getElementById('dTo')?.value;
  if (!from || !to) return;
  state._range = { from: from <= to ? from : to, to: from <= to ? to : from };
  state.drill = { months: new Set(), cat: null };
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
}


function resetRange() {
  const { min } = getBounds();
  state._range = { from: isoDate(min), to: isoDate(new Date()) };
  state.drill = { months: new Set(), cat: null };
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
}

/* ── HASH ROUTING ── */
function handleHash() {
  const hash = location.hash.slice(1) || 'dashboard';
  const validPages = ['dashboard','transactions','budgets','charts','investments','salary','settings'];
  const page = validPages.includes(hash) ? hash : 'dashboard';
  nav(page, document.querySelector(`.ni[data-page="${page}"]`));
}

/* ── EXPOSE TO WINDOW (for inline onclick handlers) ── */
window.nav = nav;
window.openTx = openTx;
window.openEdit = openEdit;
window.openVyrovnani = openVyrovnani;
window.closeTx = closeTx;
window.saveTx = saveTx;
window.searchTx = searchTx;
window.triggerReceiptUpload = triggerReceiptUpload;
window.onReceiptFile = onReceiptFile;
window.onModalReceiptPick = onModalReceiptPick;
window.drillM = drillM;
window.drillC = drillC;
window.clearDrill = clearDrill;
window.applyRangeFromInputs = applyRangeFromInputs;
window.resetRange = resetRange;
window.reloadSheets = () => loadSheets();
window.saveSettings = saveSettings;
window.saveLimits = saveLimits;
window.renderBudgets = renderBudgets;
window.logout = logout;
window.invTab = invTab;
window.refreshInvNav = refreshInvNav;
window.openInvImport = openInvImport;
window.closeInvImport = closeInvImport;
window.invDov = invDov;
window.invDol = invDol;
window.invDod = invDod;
window.invOnFile = invOnFile;
window.confirmInvImport = confirmInvImport;
window.openRecurring = openRecurring;
window.openRecEdit = openRecEdit;
window.closeRecurring = closeRecurring;
window.openRecForm = openRecForm;
window.closeRecForm = closeRecForm;
window.saveRecTemplate = saveRecTemplate;
window.generateRecurring = generateRecurring;
window.toggleRec = toggleRec;
window.deleteRec = deleteRec;
window.deleteTx = deleteTx;
window.syncOsobaRow = syncOsobaRow;
window.syncRecOsobaRow = syncRecOsobaRow;
window.removeReceipt = removeReceipt;
window.openMbankImport = openMbankImport;
window.openColPopover = openColPopover;
window.toggleSort = toggleSort;
window.cpSelectAll = cpSelectAll;
window.cpClearFilter = cpClearFilter;
window.cpApplyMulti = cpApplyMulti;
window.cpApplyRange = cpApplyRange;
window.closeMbankImport = closeMbankImport;
window.mbankDov = mbankDov;
window.mbankDol = mbankDol;
window.mbankDod = mbankDod;
window.onMbankFile = onMbankFile;
window.confirmMbankImport = confirmMbankImport;
window.hideMbankBanner = hideMbankBanner;
window.toggleMbankDupDetail = toggleMbankDupDetail;
window.importMbankFromDrive = importMbankFromDrive;
window.mbankPickPending = mbankPickPending;
window.mbankMarkDone = mbankMarkDone;
window.mbankCheckMail = mbankCheckMail;
window.renderSalary = renderSalary;
window.salApplyRange = salApplyRange;
window.salResetRange = salResetRange;
window.salSelect = salSelect;
window.openSalaryImport = openSalaryImport;
window.closeSalaryImport = closeSalaryImport;
window.salaryDov = salaryDov;
window.salaryDol = salaryDol;
window.salaryDod = salaryDod;
window.onSalaryFile = onSalaryFile;
window.confirmSalaryImport = confirmSalaryImport;
window.hideSalaryBanner = hideSalaryBanner;
window.importPayslipFromDrive = importPayslipFromDrive;
window.salaryPickPending = salaryPickPending;
window.salaryMarkDone = salaryMarkDone;
window.salaryCheckMail = salaryCheckMail;


/* ── INIT ── */
(function init() {
  const sc = localStorage.getItem('fincfg'); if (sc) Object.assign(state.cfg, JSON.parse(sc));
  const sl = localStorage.getItem('finlim'); if (sl) Object.assign(state.limits, JSON.parse(sl));
  const vEl = document.getElementById('appVersion');
  if (vEl) vEl.textContent = `v${VERSION}`;

  initAuth(() => {
    loadSheets();
  });

  window.addEventListener('hashchange', handleHash);
})();

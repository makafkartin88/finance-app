import { GAS_URL, DEMO } from './config.js';
import { state } from './state.js';
import { parseRow, ensureRange, isoDate, rangeLabel, getBounds, scopedTxs, getMonths } from './utils.js';
import { renderDash, drillM, drillC, clearDrill } from './dashboard.js';
import { renderTx, openTx, openEdit, closeTx, saveTx, searchTx, triggerReceiptUpload, onReceiptFile, onModalReceiptPick, deleteTx, removeReceipt } from './transactions.js';
import { renderBudgets, renderBudLimForm, saveLimits } from './budgets.js';
import { renderCharts } from './charts.js';
import { renderInv, invTab, openInvPosition, closeInvPosition, saveInvPosition, openAccountBalances, saveBalances, invDov, invDol, invDod, invOnFile, confirmInvImport, loadInvestmentData } from './investments.js';
import { reloadSheets } from './settings.js';
import { initAuth, logout } from './auth.js';
import { loadRecurring, openRecurring, closeRecurring, openRecForm, openRecEdit, closeRecForm, saveRecTemplate, generateRecurring, toggleRec, deleteRec } from './recurring.js';
import { openMbankImport, closeMbankImport, mbankDov, mbankDol, mbankDod, onMbankFile, confirmMbankImport, loadMbankNotification, hideMbankBanner } from './mbank-import.js';
import { openColPopover, closePopover, toggleAmountSort, cpSelectAll, cpClearFilter, cpApplyMulti, cpApplyRange } from './table-filters.js';

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

/* ── SHEETS (APPS SCRIPT) ── */
export async function loadSheets() {
  toast('Načítám data z Tabulky...');
  try {
    const r = await fetch(GAS_URL + '?sheet=Transakce');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const rows = (d.values || []).slice(1);
    state.txs = rows.filter(r => r.length > 2 && r[0]).map(parseRow);
    boot(); toast('Načteno ' + state.txs.length + ' transakcí', 'ok');
    setAuth(true);
    loadInvestmentData();
    loadRecurring();
    loadMbankNotification();
  } catch(e) {
    toast('Chyba spojení s tabulkou: ' + e.message, 'err');
    state.txs = DEMO.map(parseRow);
    boot();
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
  location.hash = '#'+id;
}

function applyPersonTheme() {
  document.body.classList.remove('theme-martin','theme-sarka');
  if (state.person === 'Martin') document.body.classList.add('theme-martin');
  if (state.person === 'Šárka') document.body.classList.add('theme-sarka');
}

function setPerson(p, btn) {
  state.person = p;
  document.querySelectorAll('.pb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyPersonTheme();
  state.drill = { month: null, cat: null };
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
}

function applyRangeFromInputs() {
  const from = document.getElementById('dFrom')?.value;
  const to = document.getElementById('dTo')?.value;
  if (!from || !to) return;
  state._range = { from: from <= to ? from : to, to: from <= to ? to : from };
  state.drill = { month: null, cat: null };
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
}

function chartSetMonth(monthStr) {
  const ord = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const [mn, yr] = monthStr.split(' ');
  const m = ord[mn]; if (!m || !yr) return;
  const y = parseInt(yr);
  const from = `${y}-${String(m).padStart(2,'0')}-01`;
  const to = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;
  state._range = { from, to };
  state.drill = { month: null, cat: null };
  const dFrom = document.getElementById('dFrom'); if (dFrom) dFrom.value = from;
  const dTo = document.getElementById('dTo'); if (dTo) dTo.value = to;
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
  nav('dashboard', document.querySelectorAll('.ni')[0]);
}

function resetRange() {
  const { min } = getBounds();
  state._range = { from: isoDate(min), to: isoDate(new Date()) };
  state.drill = { month: null, cat: null };
  populateSels(); renderDash(); renderTx(); renderBudgets(); renderCharts(); renderInv();
}

/* ── HASH ROUTING ── */
function handleHash() {
  const hash = location.hash.slice(1) || 'dashboard';
  const validPages = ['dashboard','transactions','budgets','charts','investments','settings'];
  const page = validPages.includes(hash) ? hash : 'dashboard';
  const navItems = document.querySelectorAll('.ni');
  const pageMap = { dashboard: 0, transactions: 1, budgets: 2, charts: 3, investments: 4, settings: 5 };
  nav(page, navItems[pageMap[page]]);
}

/* ── EXPOSE TO WINDOW (for inline onclick handlers) ── */
window.nav = nav;
window.setPerson = setPerson;
window.openTx = openTx;
window.openEdit = openEdit;
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
window.saveLimits = saveLimits;
window.renderBudgets = renderBudgets;
window.logout = logout;
window.invTab = invTab;
window.openInvPosition = openInvPosition;
window.closeInvPosition = closeInvPosition;
window.saveInvPosition = saveInvPosition;
window.openAccountBalances = openAccountBalances;
window.saveBalances = saveBalances;
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
window.removeReceipt = removeReceipt;
window.openMbankImport = openMbankImport;
window.openColPopover = openColPopover;
window.toggleAmountSort = toggleAmountSort;
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
window.chartSetMonth = chartSetMonth;

/* ── INIT ── */
(function init() {
  const sl = localStorage.getItem('finlim'); if (sl) Object.assign(state.limits, JSON.parse(sl));
  applyPersonTheme();

  initAuth(() => {
    loadSheets();
  });

  window.addEventListener('hashchange', handleHash);
})();

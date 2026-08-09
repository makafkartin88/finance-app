import { state } from './state.js';
import { czk } from './utils.js';
import { openTx } from './transactions.js';
import { renderTx } from './transactions.js';
import { renderDash } from './dashboard.js';

/* ── POPOVER (singleton) ── */
let popoverEl = null;
let popoverAnchor = null;
let suppressClick = false;

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement('div');
  popoverEl.id = 'colPopover';
  popoverEl.className = 'col-popover';
  popoverEl.style.display = 'none';
  document.body.appendChild(popoverEl);
  // Outside-click dismisses popover
  document.addEventListener('mousedown', (e) => {
    if (popoverEl.style.display === 'none') return;
    if (popoverEl.contains(e.target)) return;
    if (popoverAnchor && popoverAnchor.contains(e.target)) return;
    closePopover();
  });
  return popoverEl;
}

export function closePopover() {
  if (!popoverEl) return;
  popoverEl.style.display = 'none';
  popoverEl.innerHTML = '';
  popoverAnchor = null;
}

function positionPopover(anchor) {
  const r = anchor.getBoundingClientRect();
  const top = window.scrollY + r.bottom + 4;
  const left = Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 280);
  popoverEl.style.top = top + 'px';
  popoverEl.style.left = Math.max(8, left) + 'px';
}

/* ── HELPERS ── */
function getTableState(tableKey) {
  return state.tableFilters[tableKey];
}

function rerender(tableKey) {
  if (tableKey === 'tx') renderTx();
  else renderDash();
}

function uniqueValues(list, key) {
  const set = new Set();
  list.forEach(t => { if (t[key]) set.add(t[key]); });
  return [...set].sort((a, b) => String(a).localeCompare(String(b), 'cs'));
}

/* ── FILTER & SORT APPLICATION ── */
export function applyColumnFilters(list, tableKey) {
  const f = getTableState(tableKey);
  let out = list;
  if (f.kategorie.size > 0) out = out.filter(t => f.kategorie.has(t.kategorie));
  if (f.osoba.size > 0) out = out.filter(t => f.osoba.has(t.osoba));
  const min = f.castkaRange.min, max = f.castkaRange.max;
  if (min !== null && isFinite(min)) out = out.filter(t => t.castka >= min);
  if (max !== null && isFinite(max)) out = out.filter(t => t.castka <= max);
  return out;
}

// Hodnota pro porovnání per sloupec — texty se řadí česky (localeCompare),
// datum jako skutečné datum (ne jako text — "9/1/2026" by se jinak řadilo
// před "10/1/2026"), částka jako číslo. Účtenka se neřadí (nedává smysl).
const SORT_GETTERS = {
  datum: t => new Date(t.datum).getTime() || 0,
  popis: t => (t.popis || '').toLowerCase(),
  kategorie: t => (t.kategorie || '').toLowerCase(),
  typ: t => (t.typ || '').toLowerCase(),
  ucet: t => (t.ucet || '').toLowerCase(),
  metoda: t => (t.metoda || '').toLowerCase(),
  protistrana: t => (t.protistrana || '').toLowerCase(),
  castka: t => t.castka || 0
};

export function applySort(list, tableKey) {
  const f = getTableState(tableKey);
  const get = f.sortCol && SORT_GETTERS[f.sortCol];
  if (!get) return [...list].sort((a, b) => new Date(b.datum) - new Date(a.datum)); // výchozí: nejnovější nahoře
  const dir = f.sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = get(a), bv = get(b);
    return typeof av === 'string' ? av.localeCompare(bv, 'cs') * dir : (av - bv) * dir;
  });
}

/* ── HEADER INDICATOR ── */
export function isFilterActive(tableKey, col) {
  const f = getTableState(tableKey);
  if (col === 'kategorie' || col === 'osoba') return f[col].size > 0;
  if (col === 'castka') return isFinite(f.castkaRange.min) || isFinite(f.castkaRange.max);
  return false;
}

function sortState(tableKey, col) {
  const f = getTableState(tableKey);
  const active = f.sortCol === col;
  return { active, dir: active ? f.sortDir : null };
}

/* ── POPOVER OPENERS ── */
export function openColPopover(anchorEl, tableKey, col) {
  if (suppressClick) return;
  // Sloupce s vlastním filtrem (Kategorie, Částka) mají na jednoklik řazení
  // a na dvojklik filtr — dvojklik proto zruší čekající (odloženou) změnu
  // řazení, ať se po otevření filtru netriskne ještě řazení navíc.
  cancelPendingSort(tableKey, col);
  ensurePopover();
  popoverAnchor = anchorEl;
  if (col === 'kategorie' || col === 'osoba') {
    renderMultiSelectPopover(tableKey, col);
  } else if (col === 'castka') {
    renderRangePopover(tableKey);
  }
  popoverEl.style.display = 'block';
  positionPopover(anchorEl);
}

function renderMultiSelectPopover(tableKey, col) {
  const f = getTableState(tableKey);
  // Universe of values from all transactions (not yet column-filtered)
  const values = uniqueValues(state.txs, col);
  const selected = f[col];
  const items = values.map(v => `
    <label class="cp-row">
      <input type="checkbox" data-value="${v.replace(/"/g,'&quot;')}" ${(selected.size === 0 || selected.has(v)) ? 'checked' : ''}/>
      <span>${v}</span>
    </label>`).join('');
  popoverEl.innerHTML = `
    <div class="cp-title">${col === 'kategorie' ? 'Kategorie' : 'Osoba'}</div>
    <div class="cp-list">${items || '<div style="color:var(--text2);font-size:12px">Žádné hodnoty</div>'}</div>
    <div class="cp-actions">
      <button class="btn btnsm" onclick="cpSelectAll('${tableKey}','${col}')">Vše</button>
      <button class="btn btnsm" onclick="cpClearFilter('${tableKey}','${col}')">Vyčistit</button>
      <button class="btnp btnsm" onclick="cpApplyMulti('${tableKey}','${col}')">Použít</button>
    </div>`;
}

function renderRangePopover(tableKey) {
  const f = getTableState(tableKey);
  // Compute actual data bounds from all transactions
  const amounts = state.txs.map(t => t.castka).filter(v => v !== undefined && isFinite(v));
  const dataMin = amounts.length ? Math.min(...amounts) : 0;
  const dataMax = amounts.length ? Math.max(...amounts) : 0;
  // Use stored filter value if set, otherwise fall back to data bounds as placeholder
  const minVal = f.castkaRange.min !== null ? f.castkaRange.min : dataMin;
  const maxVal = f.castkaRange.max !== null ? f.castkaRange.max : dataMax;
  const isActive = f.castkaRange.min !== null || f.castkaRange.max !== null;
  popoverEl.innerHTML = `
    <div class="cp-title">Částka — rozpětí</div>
    <div class="cp-fields">
      <label>Od (Kč)<input type="number" id="cpMin" value="${minVal}" step="1" min="0"/></label>
      <label>Do (Kč)<input type="number" id="cpMax" value="${maxVal}" step="1" min="0"/></label>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Rozsah dat: ${dataMin} – ${dataMax} Kč</div>
    <div class="cp-actions">
      ${isActive ? `<button class="btn btnsm" onclick="cpClearFilter('${tableKey}','castka')">Vyčistit</button>` : ''}
      <button class="btnp btnsm" onclick="cpApplyRange('${tableKey}')">Použít</button>
    </div>`;
}

/* ── POPOVER ACTIONS (window-bound) ── */
export function cpSelectAll(tableKey, col) {
  popoverEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
}

export function cpClearFilter(tableKey, col) {
  const f = getTableState(tableKey);
  if (col === 'kategorie' || col === 'osoba') f[col].clear();
  else if (col === 'castka') f.castkaRange = { min: null, max: null };
  closePopover();
  rerender(tableKey);
}

export function cpApplyMulti(tableKey, col) {
  const f = getTableState(tableKey);
  const checks = popoverEl.querySelectorAll('input[type=checkbox]');
  const totalCount = checks.length;
  const checkedValues = [];
  checks.forEach(cb => { if (cb.checked) checkedValues.push(cb.dataset.value); });
  // If all checked = no filter (empty Set)
  if (checkedValues.length === totalCount) f[col].clear();
  else f[col] = new Set(checkedValues);
  closePopover();
  rerender(tableKey);
}

export function cpApplyRange(tableKey) {
  const f = getTableState(tableKey);
  const minRaw = popoverEl.querySelector('#cpMin').value;
  const maxRaw = popoverEl.querySelector('#cpMax').value;
  const min = minRaw === '' ? null : Number(minRaw);
  const max = maxRaw === '' ? null : Number(maxRaw);
  f.castkaRange = {
    min: (min !== null && isFinite(min)) ? min : null,
    max: (max !== null && isFinite(max)) ? max : null
  };
  closePopover();
  rerender(tableKey);
}

/* ── ŘAZENÍ (klik na hlavičku) ──
   Cyklus stejný pro všechny sloupce: bez řazení → sestupně → vzestupně →
   bez řazení. U sloupců, které mají navíc vlastní filtr (Kategorie,
   Částka), se přepnutí řazení odloží o 280 ms, aby dvojklik (otevře filtr)
   mohl tu jednu odloženou změnu zrušit — stejný trik, jaký měla dřív jen
   Částka, teď obecně přes `deferred`. */
const _sortTimers = {};
function cancelPendingSort(tableKey, col) {
  const key = tableKey + '|' + col;
  if (_sortTimers[key]) { clearTimeout(_sortTimers[key]); delete _sortTimers[key]; }
}
export function toggleSort(tableKey, col, deferred) {
  const apply = () => {
    const f = getTableState(tableKey);
    if (f.sortCol !== col) { f.sortCol = col; f.sortDir = 'desc'; }
    else if (f.sortDir === 'desc') f.sortDir = 'asc';
    else { f.sortCol = null; f.sortDir = null; }
    rerender(tableKey);
  };
  if (!deferred) { apply(); return; }
  cancelPendingSort(tableKey, col);
  _sortTimers[tableKey + '|' + col] = setTimeout(apply, 280);
}

/* ── HEADER HTML BUILDERS ── */
function caretHtml(tableKey, col) {
  const { active, dir } = sortState(tableKey, col);
  const cls = active ? `th-caret ${dir}` : 'th-caret';
  return `<span class="${cls}">${dir === 'asc' ? '▴' : '▾'}</span>`;
}

// Prosté sloupce (Datum, Popis, Typ, Účet, Metoda, Protistrana) — jen
// řazení, žádný vlastní filtr → jednoklik řadí hned, bez odkladu.
export function thSort(tableKey, col, label) {
  return `<th class="th-sort" data-col="${col}" onclick="toggleSort('${tableKey}','${col}')">${label} ${caretHtml(tableKey, col)}</th>`;
}

// Kategorie — jednoklik řadí, dvojklik otevře multi-select filtr.
export function thFilter(tableKey, col, label) {
  const active = isFilterActive(tableKey, col);
  return `<th class="th-sort${active ? ' th-filtered' : ''}" data-col="${col}" onclick="toggleSort('${tableKey}','${col}',true)" ondblclick="openColPopover(this,'${tableKey}','${col}')">${label} ${caretHtml(tableKey, col)}${active ? '<span class="th-dot"></span>' : ''}</th>`;
}

// Částka — jednoklik řadí, dvojklik otevře filtr na rozsah.
export function thAmount(tableKey, label) {
  const active = isFilterActive(tableKey, 'castka');
  return `<th class="th-sort th-amt${active ? ' th-filtered' : ''}" data-col="castka" onclick="toggleSort('${tableKey}','castka',true)" ondblclick="openColPopover(this,'${tableKey}','castka')">${label} ${caretHtml(tableKey, 'castka')}${active ? '<span class="th-dot"></span>' : ''}</th>`;
}

/* ── ROW INTERACTIONS (dblclick + long-press) ── */
export function attachRowInteractions(tbodyEl) {
  if (!tbodyEl) return;
  tbodyEl.querySelectorAll('tr[data-idx]').forEach(row => {
    const idx = Number(row.dataset.idx);
    if (isNaN(idx)) return;

    // Desktop: double-click
    row.addEventListener('dblclick', (e) => {
      // Ignore dblclick on action buttons (delete)
      if (e.target.closest('button, a, input, select')) return;
      openTx(idx);
    });

    // Mobile: long-press
    let pressTimer = null;
    let startX = 0, startY = 0;
    let pressed = false;

    row.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY;
      pressed = true;
      pressTimer = setTimeout(() => {
        if (!pressed) return;
        pressed = false;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 350);
        openTx(idx);
      }, 500);
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (!pressed) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        clearTimeout(pressTimer);
        pressed = false;
      }
    }, { passive: true });

    row.addEventListener('touchend', () => {
      pressed = false;
      clearTimeout(pressTimer);
    });

    row.addEventListener('touchcancel', () => {
      pressed = false;
      clearTimeout(pressTimer);
    });
  });
}

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
  if (isFinite(min)) out = out.filter(t => t.castka >= min);
  if (isFinite(max)) out = out.filter(t => t.castka <= max);
  return out;
}

export function applySort(list, tableKey) {
  const f = getTableState(tableKey);
  if (f.castkaSort === 'asc')  return [...list].sort((a, b) => a.castka - b.castka);
  if (f.castkaSort === 'desc') return [...list].sort((a, b) => b.castka - a.castka);
  return list;
}

/* ── HEADER INDICATOR ── */
export function isFilterActive(tableKey, col) {
  const f = getTableState(tableKey);
  if (col === 'kategorie' || col === 'osoba') return f[col].size > 0;
  if (col === 'castka') return isFinite(f.castkaRange.min) || isFinite(f.castkaRange.max);
  return false;
}

export function getSortDir(tableKey) {
  return getTableState(tableKey).castkaSort;
}

/* ── POPOVER OPENERS ── */
export function openColPopover(anchorEl, tableKey, col) {
  if (suppressClick) return;
  // If user dblclicks Částka header, cancel the pending sort toggle
  if (col === 'castka' && _amtTimer) { clearTimeout(_amtTimer); _amtTimer = null; }
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
      <input type="checkbox" data-value="${v.replace(/"/g,'&quot;')}" ${selected.has(v) ? 'checked' : ''}/>
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
  const minVal = isFinite(f.castkaRange.min) ? f.castkaRange.min : '';
  const maxVal = isFinite(f.castkaRange.max) ? f.castkaRange.max : '';
  popoverEl.innerHTML = `
    <div class="cp-title">Částka — rozpětí</div>
    <div class="cp-fields">
      <label>Od (Kč)<input type="number" id="cpMin" value="${minVal}" step="any"/></label>
      <label>Do (Kč)<input type="number" id="cpMax" value="${maxVal}" step="any"/></label>
    </div>
    <div class="cp-actions">
      <button class="btn btnsm" onclick="cpClearFilter('${tableKey}','castka')">Vyčistit</button>
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
    min: isFinite(min) ? min : null,
    max: isFinite(max) ? max : null
  };
  closePopover();
  rerender(tableKey);
}

/* ── AMOUNT SORT TOGGLE (single click) ── */
let _amtTimer = null;
export function toggleAmountSort(tableKey, ev) {
  if (ev) ev.stopPropagation();
  // Defer the toggle so a dblclick can cancel it (dblclick opens range popover instead)
  if (_amtTimer) clearTimeout(_amtTimer);
  _amtTimer = setTimeout(() => {
    _amtTimer = null;
    const f = getTableState(tableKey);
    if (f.castkaSort === null) f.castkaSort = 'desc';
    else if (f.castkaSort === 'desc') f.castkaSort = 'asc';
    else f.castkaSort = null;
    rerender(tableKey);
  }, 280);
}

/* ── HEADER HTML BUILDER ── */
export function thFilter(tableKey, col, label) {
  const active = isFilterActive(tableKey, col);
  return `<th class="th-sort" data-col="${col}" onclick="openColPopover(this,'${tableKey}','${col}')">${label} <span class="th-caret">▾</span>${active ? '<span class="th-dot"></span>' : ''}</th>`;
}

export function thAmount(tableKey, label) {
  const dir = getSortDir(tableKey);
  const active = isFilterActive(tableKey, 'castka');
  const caretClass = dir ? `th-caret ${dir}` : 'th-caret';
  const caretChar = dir === 'asc' ? '▴' : dir === 'desc' ? '▾' : '▾';
  return `<th class="th-sort th-amt" data-col="castka" onclick="toggleAmountSort('${tableKey}',event)" ondblclick="openColPopover(this,'${tableKey}','castka')">${label} <span class="${caretClass}">${caretChar}</span>${active ? '<span class="th-dot"></span>' : ''}</th>`;
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

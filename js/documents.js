import { state } from './state.js';
import { getCurrentPerson } from './auth.js';
import { parseDocRow, visibleDocs, filterDocs, folderCounts, escHtml } from './documents-core.js';

let _query = '';
let _folder = null; // null = všechny složky, '' = bez složky

// `pre` = odpověď listu Dokumenty z dávkového fetchSheets v app.js.
export function loadDocuments(pre) {
  state.docs = (pre && Array.isArray(pre.values)) ? pre.values.map(parseDocRow).filter(Boolean) : [];
  state._docsLoaded = true;
  renderDocs();
}

export function docSearch(q) { _query = q; renderDocs(); }
export function docPickFolder(name) { _folder = (_folder === name) ? null : name; renderDocs(); }

const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : iso; };
const folderLabel = n => n || 'Bez složky';

export function renderDocs() {
  const list = document.getElementById('docList');
  if (!list) return;
  const chips = document.getElementById('docFolders');
  if (!state._docsLoaded) {
    chips.innerHTML = '';
    list.innerHTML = '<div class="loading-state"><div class="loading-spinner spin"></div>Načítám dokumenty…</div>';
    return;
  }
  const mine = visibleDocs(state.docs, getCurrentPerson());
  const folders = folderCounts(mine);
  if (_folder !== null && !folders.some(f => f.name === _folder)) _folder = null;

  chips.innerHTML = [`<button class="chip${_folder === null ? ' active' : ''}" onclick="docPickFolder(null)">Vše ${mine.length}</button>`]
    .concat(folders.map(f => `<button class="chip${_folder === f.name ? ' active' : ''}" onclick="docPickFolder(${escHtml(JSON.stringify(f.name))})">${escHtml(folderLabel(f.name))} ${f.count}</button>`))
    .join('');

  if (!mine.length) {
    list.innerHTML = '<div class="empty">Zatím žádné dokumenty. Nahraj první přes „+ Nahrát".</div>';
    return;
  }
  const shown = filterDocs(mine, _query, _folder)
    .sort((a, b) => b.datum.localeCompare(a.datum) || a.nazev.localeCompare(b.nazev, 'cs'));
  if (!shown.length) {
    list.innerHTML = '<div class="empty">Nic nenalezeno.</div>';
    return;
  }
  list.innerHTML = shown.map(d => {
    const vis = d.viditelnost === 'Oba' ? '<span class="doc-vis">Oba</span>' : `<span class="doc-vis priv">jen ${escHtml(d.viditelnost)}</span>`;
    return `<div class="doc-row">
      <div class="doc-ico ${d.typ === 'pdf' ? 'pdf' : 'image'}">${d.typ === 'pdf' ? 'PDF' : 'IMG'}</div>
      <a class="doc-main" href="${escHtml(d.url)}" target="_blank" rel="noopener noreferrer">
        <div class="doc-name">${escHtml(d.nazev)}</div>
        <div class="doc-meta">${escHtml(folderLabel(d.slozka))} · ${fmtDate(d.datum)} · ${fmtSize(d.velikost)}${d.nahral ? ' · ' + escHtml(d.nahral) : ''}</div>
      </a>
      ${vis}
      <div class="doc-actions">
        <button class="btn btnsm" onclick="openDocEdit('${escHtml(d.id)}')" title="Upravit">✎</button>
        <button class="btn btnsm" onclick="deleteDoc('${escHtml(d.id)}')" title="Smazat">🗑</button>
      </div>
    </div>`;
  }).join('');
}

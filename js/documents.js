import { state } from './state.js';
import { GAS_URL } from './config.js';
import { getCurrentPerson } from './auth.js';
import { toast } from './app.js';
import { parseDocRow, visibleDocs, filterDocs, folderCounts, escHtml,
         validateUpload, canonicalFolder, stripExt, VISIBILITY, DOK } from './documents-core.js';

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

/* ── MODAL: nahrání i úprava ── */
let _editId = null;   // null = nahrávání nového
let _file = null;
let _vis = 'Oba';
let _busy = false;

const $ = id => document.getElementById(id);
const visLabel = v => v === 'Oba' ? 'Oba' : 'jen ' + v;

function renderVis() {
  $('docVis').innerHTML = VISIBILITY.map(v =>
    `<button type="button" class="chip${_vis === v ? ' active' : ''}" onclick="docSetVis('${v}')">${visLabel(v)}</button>`).join('');
}
export function docSetVis(v) { _vis = v; renderVis(); }

function fillFolderList() {
  $('docFolderList').innerHTML = folderCounts(state.docs).filter(f => f.name)
    .map(f => `<option value="${escHtml(f.name)}"></option>`).join('');
}

function showErr(msg) { const e = $('docErr'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }

function openModal(title, withFile) {
  _busy = false;
  $('docModalTitle').textContent = title;
  $('docZone').style.display = withFile ? '' : 'none';
  $('docZoneLabel').textContent = 'Přetáhni PDF nebo obrázek sem';
  $('docSaveBtn').disabled = false;
  $('docSaveBtn').textContent = 'Uložit';
  showErr('');
  fillFolderList();
  renderVis();
  $('docModal').style.display = 'flex';
}

export function openDocUpload() {
  _editId = null; _file = null; _vis = 'Oba';
  $('docName').value = ''; $('docFolder').value = _folder || '';
  openModal('Nahrát dokument', true);
}

export function openDocEdit(id) {
  const d = state.docs.find(x => x.id === id);
  if (!d) return;
  _editId = id; _file = null; _vis = d.viditelnost;
  $('docName').value = d.nazev; $('docFolder').value = d.slozka;
  openModal('Upravit dokument', false);
}

export function closeDocModal() { if (!_busy) $('docModal').style.display = 'none'; }

function pickFile(f) {
  const err = validateUpload({ name: f.name, size: f.size, type: f.type });
  if (err) { _file = null; showErr(err); return; }
  _file = f; showErr('');
  $('docZoneLabel').textContent = '📎 ' + f.name;
  if (!$('docName').value.trim()) $('docName').value = stripExt(f.name);
}
export function docDov(e) { e.preventDefault(); $('docZone').classList.add('over'); }
export function docDol() { $('docZone').classList.remove('over'); }
export function docDod(e) { e.preventDefault(); docDol(); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }
export function onDocFile(e) { const f = e.target.files[0]; if (f) pickFile(f); e.target.value = ''; }

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Soubor nejde přečíst.'));
    r.readAsDataURL(file);
  });
}

async function postGas(payload) {
  const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

// GAS vrací objekt podle hlavičky → převést na řádek a projet stejným parserem jako načtení.
const docFromServer = o => parseDocRow(Object.keys(DOK).map(k => o[k]));

export async function saveDoc() {
  if (_busy) return;
  const nazev = $('docName').value.trim();
  const existing = folderCounts(state.docs).map(f => f.name).filter(Boolean);
  const slozka = canonicalFolder($('docFolder').value, existing);
  if (!_editId && !_file) { showErr('Vyber soubor.'); return; }
  if (!nazev) { showErr('Vyplň název.'); return; }

  _busy = true; showErr('');
  const btn = $('docSaveBtn');
  btn.disabled = true;
  btn.textContent = _editId ? 'Ukládám…' : 'Nahrávám…';
  try {
    let d;
    if (_editId) {
      d = await postGas({ action: 'updateDocument', id: _editId, nazev, slozka, viditelnost: _vis });
      state.docs = state.docs.map(x => x.id === _editId ? docFromServer(d.doc) : x);
    } else {
      const data = await readBase64(_file);
      d = await postGas({ action: 'uploadDocument', nazev, slozka, viditelnost: _vis,
        nahral: getCurrentPerson() || '', fileName: _file.name, mimeType: _file.type, data });
      state.docs = state.docs.concat(docFromServer(d.doc));
    }
    _busy = false;
    $('docModal').style.display = 'none';
    toast(_editId ? 'Dokument upraven' : 'Dokument nahrán', 'ok');
    renderDocs();
  } catch (e) {
    _busy = false;
    btn.disabled = false; btn.textContent = 'Uložit';
    showErr('Nepodařilo se uložit: ' + e.message);
  }
}

export async function deleteDoc(id) {
  const d = state.docs.find(x => x.id === id);
  if (!d || !confirm(`Smazat „${d.nazev}"?\nSoubor se přesune do koše na Google Drive (30 dní jde obnovit).`)) return;
  try {
    await postGas({ action: 'deleteDocument', id });
    state.docs = state.docs.filter(x => x.id !== id);
    toast('Dokument smazán', 'ok');
    renderDocs();
  } catch (e) {
    toast('Smazání selhalo: ' + e.message, 'err');
  }
}

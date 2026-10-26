import { onActivity } from './utils.js';

/* ============================================================
   Viditelná odezva na zápis. Apps Script odpovídá i několik sekund a do té
   doby appka vypadala, jako by kliknutí neproběhlo (a druhé kliknutí uložilo
   transakci dvakrát). Proto:
   - proužek nahoře + štítek „Ukládám…", dokud běží jakýkoli zápis,
   - kliknuté tlačítko se zablokuje a ukáže kolečko,
   - pole formuláře se během ukládání zašednou,
   - zavření stránky uprostřed zápisu se musí potvrdit.
   Navázané na postJson (utils.js), takže to platí pro všechny zápisy.
   ============================================================ */

const LABEL = { save: 'Ukládám…', delete: 'Mažu…', work: 'Pracuji…' };

// Tlačítko z PRÁVĚ probíhajícího kliknutí/odeslání formuláře. Platí jen do
// konce téhle události (setTimeout 0) — zápis spuštěný na pozadí (import při
// otevření, generování opakovaných plateb) se tak nepřipíše náhodnému
// tlačítku, na které člověk zrovna klikl kvůli něčemu jinému.
let trigger = null;
function remember(btn) {
  if (!btn) return;
  trigger = btn;
  setTimeout(() => { if (trigger === btn) trigger = null; }, 0);
}
document.addEventListener('click', e => remember(e.target.closest && e.target.closest('button')), true);
document.addEventListener('submit', e => remember(e.target.querySelector('button[type=submit], .btnp')), true);

const counts = { save: 0, delete: 0, work: 0 };
let bar, pill;
function ensureEls() {
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'save-bar';
  pill = document.createElement('div');
  pill.className = 'save-pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  document.body.append(bar, pill);
}
function updateIndicator() {
  ensureEls();
  const kind = counts.save ? 'save' : counts.delete ? 'delete' : counts.work ? 'work' : null;
  bar.classList.toggle('on', !!kind);
  pill.classList.toggle('on', !!kind);
  if (kind) pill.innerHTML = `<span class="btn-spin"></span>${LABEL[kind]}`;
}

function markBusy(btn, kind) {
  btn._busyCount = (btn._busyCount || 0) + 1;
  if (btn._busyCount > 1) return;
  btn._busyHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="btn-spin"></span>${LABEL[kind]}`;
  const modal = btn.closest('.modal');
  if (modal) { modal.classList.add('is-saving'); btn._busyModal = modal; }
}
function unmarkBusy(btn) {
  if (--btn._busyCount > 0) return;
  btn.disabled = false;
  btn.classList.remove('is-busy');
  btn.removeAttribute('aria-busy');
  btn.innerHTML = btn._busyHtml;
  if (btn._busyModal) { btn._busyModal.classList.remove('is-saving'); btn._busyModal = null; }
}

onActivity(e => {
  if (e.type === 'start') {
    counts[e.kind]++;
    // Tlačítko, které si zablokovalo samo (s vlastním textem), nechat být.
    const btn = trigger;
    if (btn && btn.isConnected && (!btn.disabled || btn._busyCount)) {
      markBusy(btn, e.kind);
      busyBtns.set(e.id, btn);
    }
  } else {
    counts[e.kind] = Math.max(0, counts[e.kind] - 1);
    const btn = busyBtns.get(e.id);
    if (btn) { busyBtns.delete(e.id); unmarkBusy(btn); }
  }
  updateIndicator();
});
const busyBtns = new Map(); // id požadavku → tlačítko

window.addEventListener('beforeunload', e => {
  if (counts.save || counts.delete) { e.preventDefault(); e.returnValue = ''; }
});

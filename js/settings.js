import { state } from './state.js';
import { GAS_URL } from './config.js';
import { toast } from './app.js';

// Bilance a čísla účtů (uctyMartin/uctySarka/bilanceUcet/bilanceOffset) jsou
// sdílené mezi zařízeními — zapisují se do listu Nastaveni přes GAS, ne jen
// do localStorage prohlížeče. apiKey (Gemini, pro OCR účtenek) záměrně
// zůstává jen lokálně — je to osobní klíč, ne rodinné nastavení, a nemá
// smysl ho tahat přes stejný sdílený list.
export async function persistCfg() {
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({
      action: 'saveSettings',
      bilanceOffset: state.cfg.bilanceOffset,
      bilanceUcet: state.cfg.bilanceUcet,
      uctyMartin: state.cfg.uctyMartin,
      uctySarka: state.cfg.uctySarka
    }) });
    const d = await r.json();
    return !d.error;
  } catch (e) { return false; }
}

export async function saveSettings() {
  const apiEl = document.getElementById('sApiKey');
  if (apiEl) state.cfg.apiKey = apiEl.value;
  state.cfg.bilanceOffset = Number(document.getElementById('sBilanceOffset')?.value) || 0;
  state.cfg.bilanceUcet = (document.getElementById('sBilanceUcet')?.value || '').trim();
  state.cfg.uctyMartin = (document.getElementById('sUctyMartin')?.value || '').trim();
  state.cfg.uctySarka = (document.getElementById('sUctySarka')?.value || '').trim();
  localStorage.setItem('fincfg', JSON.stringify(state.cfg));
  const ok = await persistCfg();
  toast(ok ? 'Nastavení uloženo' : 'Uloženo lokálně, ale zápis na server selhal — zkus to znovu', ok ? 'ok' : 'err');
}

export function initSettings() {
  const off = document.getElementById('sBilanceOffset');
  if (off) off.value = state.cfg.bilanceOffset ?? 20000;
  const ucet = document.getElementById('sBilanceUcet');
  if (ucet) ucet.value = state.cfg.bilanceUcet || '670100-2230152615/6210';
  const um = document.getElementById('sUctyMartin');
  if (um) um.value = state.cfg.uctyMartin || '';
  const us = document.getElementById('sUctySarka');
  if (us) us.value = state.cfg.uctySarka || '';
}

export function reloadSheets() {
  import('./app.js').then(m => m.loadSheets());
}

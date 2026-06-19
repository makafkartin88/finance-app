import { state } from './state.js';
import { toast } from './app.js';

export function saveSettings() {
  const apiEl = document.getElementById('sApiKey');
  if (apiEl) state.cfg.apiKey = apiEl.value;
  state.cfg.bilanceOffset = Number(document.getElementById('sBilanceOffset')?.value) || 0;
  state.cfg.bilanceUcet = (document.getElementById('sBilanceUcet')?.value || '').trim();
  localStorage.setItem('fincfg', JSON.stringify(state.cfg));
  toast('Nastavení uloženo', 'ok');
}

export function initSettings() {
  const off = document.getElementById('sBilanceOffset');
  if (off) off.value = state.cfg.bilanceOffset ?? 20000;
  const ucet = document.getElementById('sBilanceUcet');
  if (ucet) ucet.value = state.cfg.bilanceUcet || '670100-2230152615/6210';
}

export function reloadSheets() {
  import('./app.js').then(m => m.loadSheets());
}

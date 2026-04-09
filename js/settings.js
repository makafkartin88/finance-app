import { state } from './state.js';
import { toast } from './app.js';

export function saveSettings() {
  state.cfg.apiKey = document.getElementById('sApiKey').value;
  localStorage.setItem('fincfg', JSON.stringify(state.cfg));
  toast('Nastavení uloženo','ok');
}

export function reloadSheets() {
  // Triggers loadSheets from app.js
  import('./app.js').then(m => m.loadSheets());
}

import { state } from './state.js';
import { postJson, serverAuth } from './utils.js';
import { toast } from './app.js';

// Bilance a čísla účtů (uctyMartin/uctySarka/bilanceUcet/bilanceOffset) jsou
// sdílené mezi zařízeními — zapisují se do listu Nastaveni přes GAS.
// Posílají se JEN zadaná pole (server ostatní nechá), a nic, dokud se řádek
// ze serveru nenačetl — jinak by výchozí/staré hodnoty z tohohle prohlížeče
// (např. po odhlášení) přepsaly sdílená čísla účtů a bilanci.
const CFG_FIELDS = ['bilanceOffset', 'bilanceUcet', 'uctyMartin', 'uctySarka', 'limity'];
export async function persistCfg(fields = CFG_FIELDS) {
  if (!state._cfgLoaded) return false;
  const body = { action: 'saveSettings' };
  for (const f of fields) body[f] = f === 'limity' ? JSON.stringify(state.limits) : state.cfg[f];
  try {
    await postJson(body);
    return true;
  } catch (e) { return false; }
}

export async function saveSettings() {
  state.cfg.bilanceOffset = Number(document.getElementById('sBilanceOffset')?.value) || 0;
  state.cfg.bilanceUcet = (document.getElementById('sBilanceUcet')?.value || '').trim();
  state.cfg.uctyMartin = (document.getElementById('sUctyMartin')?.value || '').trim();
  state.cfg.uctySarka = (document.getElementById('sUctySarka')?.value || '').trim();
  localStorage.setItem('fincfg', JSON.stringify(state.cfg));
  const ok = await persistCfg(['bilanceOffset', 'bilanceUcet', 'uctyMartin', 'uctySarka']);
  toast(ok ? 'Nastavení uloženo' : 'Uloženo lokálně, ale zápis na server selhal — zkus to znovu', ok ? 'ok' : 'err');
}

export function initSettings() {
  const off = document.getElementById('sBilanceOffset');
  if (off) off.value = state.cfg.bilanceOffset ?? 0;
  const ucet = document.getElementById('sBilanceUcet');
  if (ucet) ucet.value = state.cfg.bilanceUcet || '';
  const um = document.getElementById('sUctyMartin');
  if (um) um.value = state.cfg.uctyMartin || '';
  const us = document.getElementById('sUctySarka');
  if (us) us.value = state.cfg.uctySarka || '';
  const au = document.getElementById('sAuthStatus');
  if (au) au.textContent = serverAuth.who === undefined ? 'Server zatím neodpověděl (nebo běží starší verze GAS).'
    : serverAuth.who ? `✅ Server ověřil přihlášení (${serverAuth.who})${serverAuth.enforced ? ' · vynucení zapnuto' : ' · AUTH_ENFORCE jde bezpečně zapnout'}.`
    : '⚠️ Server přihlášení NEověřil — AUTH_ENFORCE zatím nezapínej.';
}

export function reloadSheets() {
  import('./app.js').then(m => m.loadSheets());
}

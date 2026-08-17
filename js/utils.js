import { C, GAS_URL } from './config.js';
import { state } from './state.js';

/* Fetch listu z GAS s opakováním. Apps Script občas místo JSON vrátí HTML
   chybovou stránku (redirect na script.googleusercontent.com skončí 404),
   typicky když je skript vytížený. Jeden takový zásah dřív shodil celý load
   do DEMO dat — proto se to párkrát zkusí znovu s prodlevou. Vrací
   naparsovaný JSON, nebo hodí chybu po vyčerpání pokusů. */
export async function fetchSheet(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const t = await r.text();
      if (t.trim().startsWith('<')) throw new Error(`Apps Script vrátil HTML (HTTP ${r.status}) místo dat`);
      return JSON.parse(t);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/* Načte VÍC listů jedním požadavkem (?sheets=A,B,C). Apps Script se
   u každého požadavku rozjíždí několik sekund, takže devět samostatných
   fetchů byl hlavní důvod pomalého startu. Vrací { NazevListu: {values|error} }.
   Když GAS ještě neumí `sheets` (starší nasazení), spadne to zpátky na
   postupné načítání po jednom — appka funguje i před redeployem. */
const BATCH_CAP_KEY = 'gasBatchUnsupported';
export async function fetchSheets(names) {
  // Starší nasazení parametr `sheets` ignoruje a vrátí { values } prvního
  // listu. Takový pokus stojí stejně dlouho jako běžný požadavek (~15 s),
  // takže se výsledek zapamatuje — jinak by se ta daň platila při každém
  // načtení appky, dokud se GAS nepřehraje. Klíč se váže na GAS_URL, takže
  // nové nasazení (nová URL) se otestuje znovu.
  let capKey = null;
  try {
    capKey = BATCH_CAP_KEY + ':' + GAS_URL.slice(-24);
    if (localStorage.getItem(capKey) !== '1') {
      const d = await fetchSheet(GAS_URL + '?sheets=' + encodeURIComponent(names.join(',')));
      if (d && d.sheets) return d.sheets;
      localStorage.setItem(capKey, '1'); // umí jen po jednom
    }
  } catch (e) { /* výpadek → zkusit po jednom níže */ }
  const out = {};
  for (const n of names) out[n] = await fetchSheet(GAS_URL + '?sheet=' + n).catch(() => ({ error: 1 }));
  return out;
}

export function parseRow(r) {
  const raw = (r[C.castka]||'0').toString().replace(/[^\d.-]/g,'');
  let d = r[C.datum];
  let dateObj = new Date(d);
  let isDate = d && !isNaN(dateObj.getTime());
  let mStr = r[C.mesic]||'';
  let yStr = r[C.rok]||'';
  if (isDate) {
    const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    mStr = `${mn[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
    yStr = dateObj.getFullYear().toString();
  }
  return {
    datum: d||'',
    popis: r[C.popis]||'',
    castka: Math.abs(parseFloat(raw)||0),
    mena: r[C.mena]||'CZK',
    ucet: r[C.ucet]||'',
    typ: r[C.typ]||'Výdaj',
    kategorie: r[C.kategorie]||'Ostatní',
    osoba: r[C.osoba]||'',
    metoda: r[C.metoda]||'',
    protistrana: r[C.protistrana]||'',
    poznamka: r[C.poznamka]||'',
    mesic: mStr,
    rok: yStr,
    id: r[C.id]||'',
    uctenka: r[C.uctenka]||'',
    bilance: r[C.bilance] === true || (r[C.bilance]||'').toString().toUpperCase() === 'TRUE'
  };
}

export function fmtD(d) {
  if (!d) return '';
  const date = new Date(d);
  if (!isNaN(date.getTime())) {
    return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
  }
  return d;
}

export function czk(n) { return Math.round(n).toLocaleString('cs-CZ')+' Kč'; }

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function parseTxDate(d) {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function getBounds(list) {
  if (!list) list = state.txs;
  const dates = list.map(t => parseTxDate(t.datum)).filter(Boolean).sort((a,b) => a-b);
  if (!dates.length) {
    const today = new Date();
    return { min: today, max: today };
  }
  return { min: dates[0], max: dates[dates.length-1] };
}

export function ensureRange() {
  const { min } = getBounds();
  const today = new Date();
  if (!state._range) state._range = { from: '', to: '' };
  if (!state._range.from) state._range.from = isoDate(min);
  if (!state._range.to) state._range.to = isoDate(today);
  if (state._range.from > state._range.to) state._range = { from: isoDate(min), to: isoDate(today) };
}

export function rangeLabel(from, to) {
  return `${fmtD(from)} – ${fmtD(to)}`;
}

export function inRange(t) {
  ensureRange();
  const dt = parseTxDate(t.datum);
  if (!dt) return false;
  const iso = isoDate(dt);
  return iso >= state._range.from && iso <= state._range.to;
}

export function scopedTxs(opts = {}) {
  let list = opts.ignorePerson || state.person === 'Oba' ? state.txs : state.txs.filter(t => t.osoba === state.person);
  if (!opts.ignoreRange) list = list.filter(inRange);
  if (opts.month) list = list.filter(t => t.mesic === opts.month);
  if (opts.months && opts.months.size) list = list.filter(t => opts.months.has(t.mesic));
  if (opts.cat) list = list.filter(t => t.kategorie === opts.cat);
  return list;
}

export function getMonths(list) {
  if (!list) list = state.txs;
  const ord = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  return [...new Set(list.map(t => t.mesic).filter(Boolean))].sort((a,b) => {
    const [ma,ya] = a.split(' '), [mb,yb] = b.split(' ');
    return (parseInt(ya)*100+(ord[ma]||0)) - (parseInt(yb)*100+(ord[mb]||0));
  });
}

export function base(m, c) {
  if (m instanceof Set) return scopedTxs({ months: m, cat: c });
  return scopedTxs({ month: m, cat: c });
}

import { C } from './config.js';
import { state } from './state.js';

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
    id: r[C.id]||''
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
  const { min, max } = getBounds();
  if (!state._range) state._range = { from: '', to: '' };
  if (!state._range.from) state._range.from = isoDate(min);
  if (!state._range.to) state._range.to = isoDate(max);
  if (state._range.from > state._range.to) state._range = { from: isoDate(min), to: isoDate(max) };
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
  return scopedTxs({ month: m, cat: c });
}

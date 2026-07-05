import { state } from './state.js';
import { czk } from './utils.js';
import { cumulativeInflation } from './inflation-data.js';

const MONTH_NAMES = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const ymLabel = s => `${s.mesic}/${s.rok}`;

export function renderSalary() {
  const data = state.salary; // seřazené vzestupně dle id (YYYY-MM)
  const empty = document.getElementById('salEmpty');
  if (!document.getElementById('salChart')) return;

  if (!data.length) {
    ['sal1','sal2','sal3','sal4'].forEach(id => document.getElementById(id).textContent = '—');
    ['sal1s','sal2s','sal3s','sal4s'].forEach(id => document.getElementById(id).textContent = '');
    document.getElementById('salChart').innerHTML = '';
    document.getElementById('salLabels').innerHTML = '';
    document.getElementById('salInflation').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salTarif').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salStructure').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salPremie').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salBody').innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const last = data[data.length - 1];

  /* ── METRIKY ── */
  document.getElementById('sal1').textContent = czk(last.cistaMzda);
  document.getElementById('sal1s').textContent = `${MONTH_NAMES[last.mesic]} ${last.rok} · k výplatě ${czk(last.kVyplate)}`;
  document.getElementById('sal2').textContent = czk(last.hrubaMzda);
  document.getElementById('sal2s').textContent = `tarif ${czk(last.tarif)} + prémie ${czk(last.premie)}`;

  // Meziroční růst — stejný měsíc před rokem (hrubá)
  const yearAgo = data.find(s => s.rok === last.rok - 1 && s.mesic === last.mesic);
  if (yearAgo && yearAgo.hrubaMzda) {
    const g = ((last.hrubaMzda - yearAgo.hrubaMzda) / yearAgo.hrubaMzda) * 100;
    document.getElementById('sal3').textContent = `${g >= 0 ? '+' : ''}${g.toFixed(1)} %`;
    document.getElementById('sal3').className = 'mv ' + (g >= 0 ? 'green' : 'red');
    document.getElementById('sal3s').textContent = `hrubá vs ${yearAgo.mesic}/${yearAgo.rok} (${czk(yearAgo.hrubaMzda)})`;
  } else {
    document.getElementById('sal3').textContent = '—';
    document.getElementById('sal3s').textContent = 'chybí páska ze stejného měsíce loni';
  }

  /* ── ZÁKLADNA pro inflační srovnání ── */
  const sel = document.getElementById('salBaseline');
  const prevSel = sel.value;
  sel.innerHTML = data.slice(0, -1).map(s =>
    `<option value="${s.id}">${MONTH_NAMES[s.mesic]} ${s.rok} — hrubá ${czk(s.hrubaMzda)}</option>`
  ).join('') || `<option value="${last.id}">${MONTH_NAMES[last.mesic]} ${last.rok}</option>`;
  // default: poslední změna tarifu, jinak první záznam
  let defBase = data[0].id;
  for (let i = 1; i < data.length; i++) if (data[i].tarif !== data[i-1].tarif) defBase = data[i].id;
  sel.value = [...sel.options].some(o => o.value === prevSel) ? prevSel : defBase;
  const base = data.find(s => s.id === sel.value) || data[0];

  /* ── REÁLNÝ RŮST (metrika 4) + INFLAČNÍ POMOCNÍK ── */
  const infl = cumulativeInflation(base.id, last.id);
  const nomGrowth = base.hrubaMzda ? ((last.hrubaMzda - base.hrubaMzda) / base.hrubaMzda) * 100 : 0;
  const realGrowth = ((1 + nomGrowth / 100) / (1 + infl.pct / 100) - 1) * 100;
  const neededSalary = Math.round(base.hrubaMzda * (1 + infl.pct / 100));

  document.getElementById('sal4').textContent = `${realGrowth >= 0 ? '+' : ''}${realGrowth.toFixed(1)} %`;
  document.getElementById('sal4').className = 'mv ' + (realGrowth >= 0 ? 'green' : 'red');
  document.getElementById('sal4s').textContent = `od ${base.mesic}/${base.rok}, inflace ${infl.pct.toFixed(1)} %`;

  const diff = last.hrubaMzda - neededSalary;
  document.getElementById('salInflation').innerHTML = `
    <div class="metric-row"><div><strong>Kumulativní inflace</strong><span>od ${MONTH_NAMES[base.mesic]} ${base.rok}</span></div><strong>${infl.pct.toFixed(1)} %</strong></div>
    <div class="metric-row"><div><strong>Růst hrubé mzdy</strong><span>${czk(base.hrubaMzda)} → ${czk(last.hrubaMzda)}</span></div><strong class="${nomGrowth >= infl.pct ? 'ap' : 'an'}">${nomGrowth >= 0 ? '+' : ''}${nomGrowth.toFixed(1)} %</strong></div>
    <div class="metric-row"><div><strong>Mzda držící krok s inflací</strong><span>kolik by dnes musela být</span></div><strong>${czk(neededSalary)}</strong></div>
    <div class="insight" style="margin-top:10px">
      <strong>${diff >= 0 ? '✅ Předbíháš inflaci' : '⚠️ Zaostáváš za inflací'}</strong>
      <span>${diff >= 0
        ? `Reálně máš o ${czk(diff)} (${realGrowth.toFixed(1)} %) víc, než kdyby mzda jen kopírovala inflaci.`
        : `Aby mzda od ${base.mesic}/${base.rok} jen držela kupní sílu, musela by být o ${czk(-diff)} vyšší — argument pro vyjednávání.`}
      ${infl.monthsMissing ? ` (pozn.: ${infl.monthsMissing} měsíců inflace chybí v tabulce — dopočítáno bez nich)` : ''}</span>
    </div>`;

  /* ── GRAF VÝVOJE (hrubá + čistá) ── */
  const maxV = Math.max(...data.map(s => Math.max(s.hrubaMzda, s.cistaMzda)), 1);
  const kFmt = n => n >= 1000 ? Math.round(n / 1000) + 'k' : Math.round(n).toString();
  document.getElementById('salChart').innerHTML = data.map(s => `
    <div class="bg" title="${ymLabel(s)}: hrubá ${czk(s.hrubaMzda)}, čistá ${czk(s.cistaMzda)}">
      <div class="bar-lbl"><span class="bv-i">${kFmt(s.hrubaMzda)}</span><span style="color:var(--blue)" class="bv-e">${kFmt(s.cistaMzda)}</span></div>
      <div class="bar bar-income" style="height:${Math.round((s.hrubaMzda / maxV) * 100)}px"></div>
      <div class="bar" style="height:${Math.round((s.cistaMzda / maxV) * 100)}px;background:var(--blue)"></div>
    </div>`).join('');
  document.getElementById('salLabels').innerHTML = data.map(s => `<div class="bl">${s.mesic}/${String(s.rok).slice(2)}</div>`).join('');

  /* ── TARIF TIMELINE ── */
  const tarifChanges = [];
  data.forEach((s, i) => {
    if (i === 0 || s.tarif !== data[i-1].tarif) tarifChanges.push({ from: s, prev: i ? data[i-1] : null });
  });
  document.getElementById('salTarif').innerHTML = tarifChanges.map(ch => {
    const pct = ch.prev && ch.prev.tarif ? ((ch.from.tarif - ch.prev.tarif) / ch.prev.tarif) * 100 : null;
    return `<div class="metric-row">
      <div><strong>${MONTH_NAMES[ch.from.mesic]} ${ch.from.rok}</strong><span>${pct === null ? 'první záznam' : (pct >= 0 ? 'zvýšení' : 'snížení') + ' o ' + Math.abs(pct).toFixed(1) + ' %'}</span></div>
      <strong class="${pct !== null && pct > 0 ? 'ap' : ''}">${czk(ch.from.tarif)}</strong>
    </div>`;
  }).join('') + (tarifChanges.length === 1 ? '<div class="insight" style="margin-top:10px"><strong>Tarif beze změny</strong><span>Za celé sledované období se základ nezvedl — mrkni na inflačního pomocníka vlevo.</span></div>' : '');

  /* ── STRUKTURA POSLEDNÍ PÁSKY ── */
  const parts = [
    ['Základní mzda', last.zakladniMzda, 'var(--green)'],
    ['Prémie', last.premie, 'var(--blue)'],
    ['Svátek', last.svatek, 'var(--amber)'],
    ['Dovolená', last.dovolenaKc, 'var(--purple)'],
    ['Stravenky', last.stravenky, 'var(--text3)'],
  ].filter(x => x[1] > 0);
  const maxPart = Math.max(...parts.map(x => x[1]), 1);
  document.getElementById('salStructure').innerHTML = parts.map(([name, val, color]) => `
    <div class="crow"><div class="cname">${name}</div>
    <div class="ctrack"><div class="cfill" style="width:${Math.round((val / maxPart) * 100)}%;background:${color}"></div></div>
    <div class="cval">${czk(val)}</div></div>`).join('')
    + `<div class="metric-row" style="margin-top:8px"><div><strong>Odvody + daň</strong><span>ZP ${czk(last.zpPrac)} · SP ${czk(last.spPrac)} · daň ${czk(last.danPoSleve)}</span></div><strong class="an">−${czk(last.zpPrac + last.spPrac + last.danPoSleve)}</strong></div>`;

  /* ── PRÉMIE V ČASE ── */
  const maxPrem = Math.max(...data.map(s => s.premie), 1);
  document.getElementById('salPremie').innerHTML = data.map(s => {
    const pctOfGross = s.hrubaMzda ? (s.premie / s.hrubaMzda) * 100 : 0;
    return `<div class="crow"><div class="cname">${ymLabel(s)}</div>
      <div class="ctrack"><div class="cfill" style="width:${Math.round((s.premie / maxPrem) * 100)}%;background:var(--blue)"></div></div>
      <div class="cval">${czk(s.premie)} · ${pctOfGross.toFixed(0)} %</div></div>`;
  }).join('');

  /* ── TABULKA ── */
  document.getElementById('salBody').innerHTML = data.slice().reverse().map(s => `
    <tr><td style="white-space:nowrap"><b>${MONTH_NAMES[s.mesic]} ${s.rok}</b></td>
    <td>${czk(s.tarif)}</td><td>${czk(s.hrubaMzda)}</td><td class="ap">${czk(s.cistaMzda)}</td>
    <td><b>${czk(s.kVyplate)}</b></td><td style="color:var(--text2)">${s.odpracHod}</td>
    <td style="color:var(--text2)">${s.dovolenaZustatek} h</td>
    <td style="color:var(--text3);font-size:11px">${s.soubor || ''}</td></tr>`).join('');
}

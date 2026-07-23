import { state } from './state.js';
import { czk } from './utils.js';
import { cumulativeInflation } from './inflation-data.js';

const MONTH_NAMES = ['', 'leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const ymLabel = s => `${s.mesic}/${String(s.rok).slice(2)}`;
const kFmt = n => Math.abs(n) >= 1000 ? (Math.round(n / 100) / 10).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace('.', ',') + 'k' : Math.round(n).toString();

// Bonus / vratka daně — vše, co v čisté mzdě přesahuje standardní výpočet
// (hrubá − ZP − SP − daň). Zachytí např. roční zúčtování daně (kód 097).
const bonusOf = s => Math.round(s.cistaMzda - (s.hrubaMzda - s.zpPrac - s.spPrac - s.danPoSleve));

/* ── Lokální stav stránky (neovlivňuje zbytek appky) ── */
let _salRange = { from: null, to: null }; // 'YYYY-MM' nebo null = celý rozsah
let _salSelected = null;                  // id vybraného měsíce pro detail

export function salApplyRange() {
  _salRange = {
    from: document.getElementById('salFrom')?.value || null,
    to: document.getElementById('salTo')?.value || null,
  };
  renderSalary();
}
export function salResetRange() {
  _salRange = { from: null, to: null };
  const f = document.getElementById('salFrom'), t = document.getElementById('salTo');
  if (f) f.value = ''; if (t) t.value = '';
  renderSalary();
}
export function salSelect(id) {
  _salSelected = _salSelected === id ? null : id;
  renderSalary();
}

function filtered() {
  return state.salary.filter(s =>
    (!_salRange.from || s.id >= _salRange.from) && (!_salRange.to || s.id <= _salRange.to));
}

/* ── SVG graf vývoje mzdy ── */
function salChartSVG(data, selectedId) {
  const W = 720, H = 240, padL = 44, padR = 8, padT = 30, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxRaw = Math.max(...data.map(s => Math.max(s.hrubaMzda, s.cistaMzda)), 1);
  const step = maxRaw > 40000 ? 20000 : 10000;
  const maxV = Math.ceil(maxRaw / step) * step;
  const y = v => padT + plotH - (v / maxV) * plotH;
  const groupW = plotW / data.length;
  const barW = Math.min(26, groupW * 0.28);

  // Mřížka + osa Y
  let grid = '';
  for (let v = 0; v <= maxV; v += step) {
    grid += `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="var(--border)" stroke-width="1"/>
      <text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="var(--text3)">${v / 1000}k</text>`;
  }

  const groups = data.map((s, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const bonus = bonusOf(s);
    const isSel = s.id === selectedId;
    const hY = y(s.hrubaMzda), cY = y(s.cistaMzda);
    const lblFs = data.length > 9 ? 8 : 10;
    return `<g onclick="salSelect('${s.id}')" style="cursor:pointer">
      ${isSel ? `<rect x="${cx - groupW / 2 + 2}" y="${padT - 16}" width="${groupW - 4}" height="${plotH + 34}" rx="6" fill="var(--blue-bg, rgba(55,138,221,.10))" stroke="var(--blue)" stroke-width="1"/>` : ''}
      <rect x="${cx - barW - 1.5}" y="${hY}" width="${barW}" height="${padT + plotH - hY}" rx="3" fill="var(--green)"/>
      <rect x="${cx + 1.5}" y="${cY}" width="${barW}" height="${padT + plotH - cY}" rx="3" fill="var(--blue)"/>
      <text x="${cx - barW / 2 - 1.5}" y="${hY - 4}" text-anchor="middle" font-size="${lblFs}" font-weight="700" fill="var(--green)">${kFmt(s.hrubaMzda)}</text>
      <text x="${cx + barW / 2 + 1.5}" y="${cY - 4}" text-anchor="middle" font-size="${lblFs}" font-weight="700" fill="var(--blue)">${kFmt(s.cistaMzda)}</text>
      ${bonus > 100 ? `<circle cx="${cx}" cy="${padT - 8}" r="3.5" fill="var(--amber)"/>
        <text x="${cx + 6}" y="${padT - 5}" font-size="${lblFs}" font-weight="700" fill="var(--amber)">+${kFmt(bonus)}</text>` : ''}
      <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${isSel ? 'var(--blue)' : 'var(--text3)'}" font-weight="${isSel ? 700 : 400}">${ymLabel(s)}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">${grid}${groups}</svg>`;
}

export function renderSalary() {
  if (!document.getElementById('salChart')) return;
  const all = state.salary;
  const data = filtered();
  const empty = document.getElementById('salEmpty');

  const rangeTxt = document.getElementById('salRangeTxt');
  if (rangeTxt) rangeTxt.innerHTML = `<strong>${data.length} pásek</strong>`;

  if (!data.length) {
    ['sal1','sal2','sal3','sal4'].forEach(id => document.getElementById(id).textContent = '—');
    ['sal1s','sal2s','sal3s','sal4s'].forEach(id => document.getElementById(id).textContent = '');
    document.getElementById('salChart').innerHTML = '<div class="empty">Žádné pásky v rozsahu</div>';
    document.getElementById('salDetail').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salInflation').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salTarif').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salPremie').innerHTML = '<div class="empty">Žádná data</div>';
    document.getElementById('salBody').innerHTML = '';
    if (empty) empty.style.display = all.length ? 'none' : 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Výběr měsíce — null = žádný filtr (celý rozsah); druhý klik odznačí (viz salSelect)
  if (_salSelected && !data.some(s => s.id === _salSelected)) _salSelected = null;
  const last = data[data.length - 1];
  const sel = _salSelected ? data.find(s => s.id === _salSelected) : null;
  const focus = sel || last; // měsíc pro Detail pásky

  // Dovolená čerpaná v daném měsíci (pokles zůstatku vůči předchozí pásce,
  // fallback: dovolená v Kč / hodinový průměr)
  const usageOf = s => {
    const idx = all.indexOf(s);
    if (idx > 0) {
      const d = all[idx - 1].dovolenaZustatek - s.dovolenaZustatek;
      if (d > 0) return d;
    }
    return (s.dovolenaKc > 0 && s.prumerHod > 0) ? Math.round(s.dovolenaKc / s.prumerHod) : 0;
  };
  const days = h => (h / 8).toLocaleString('cs-CZ', { maximumFractionDigits: 1 });

  /* ── METRIKY — cross-filter: výběr měsíce v grafu je filtruje (PBI styl) ── */
  const mSrc = sel || last;
  document.getElementById('sal1').textContent = czk(mSrc.cistaMzda);
  document.getElementById('sal1s').textContent = `${sel ? '' : 'poslední: '}${MONTH_NAMES[mSrc.mesic]} ${mSrc.rok} · k výplatě ${czk(mSrc.kVyplate)}`;
  document.getElementById('sal2').textContent = czk(mSrc.hrubaMzda);
  document.getElementById('sal2s').textContent = `tarif ${czk(mSrc.tarif)} + prémie ${czk(mSrc.premie)}`;

  // Bonusy & vratky — vybraný měsíc, jinak suma za rozsah
  if (sel) {
    const b = bonusOf(sel);
    document.getElementById('sal3').textContent = Math.abs(b) > 100 ? (b > 0 ? '+' : '') + czk(b) : '0 Kč';
    document.getElementById('sal3').className = 'mv' + (b > 100 ? ' green' : '');
    document.getElementById('sal3s').textContent = `${MONTH_NAMES[sel.mesic]} ${sel.rok} · klik znovu zruší výběr`;
  } else {
    const bonuses = data.map(s => ({ s, b: bonusOf(s) })).filter(x => Math.abs(x.b) > 100);
    const bonusSum = bonuses.reduce((sum, x) => sum + x.b, 0);
    document.getElementById('sal3').textContent = bonusSum ? (bonusSum > 0 ? '+' : '') + czk(bonusSum) : '0 Kč';
    document.getElementById('sal3').className = 'mv' + (bonusSum > 0 ? ' green' : '');
    document.getElementById('sal3s').textContent = bonuses.length
      ? bonuses.map(x => `${x.s.mesic}/${x.s.rok}: ${x.b > 0 ? '+' : ''}${kFmt(x.b)}`).join(' · ')
      : 'žádné mimořádné položky v rozsahu';
  }

  // Dovolená čerpaná — vybraný měsíc, jinak celý rozsah
  const usedH = sel ? usageOf(sel) : data.reduce((sum, s) => sum + usageOf(s), 0);
  document.getElementById('sal4').textContent = `${days(usedH)} dní`;
  document.getElementById('sal4s').textContent = sel
    ? `${usedH} h v ${sel.mesic}/${sel.rok} · zůstatek ${sel.dovolenaZustatek} h = ${days(sel.dovolenaZustatek)} dní`
    : `${usedH} h v rozsahu · zůstatek ${last.dovolenaZustatek} h = ${days(last.dovolenaZustatek)} dní`;

  /* ── GRAF ── */
  document.getElementById('salChart').innerHTML = salChartSVG(data, _salSelected);

  /* ── DETAIL PÁSKY (vybraný měsíc, jinak poslední) ── */
  document.getElementById('salDetailTitle').textContent = `Detail pásky — ${MONTH_NAMES[focus.mesic]} ${focus.rok}${sel ? '' : ' (poslední)'}`;
  const focusBonus = bonusOf(focus);
  const parts = [
    ['Základní mzda', focus.zakladniMzda, 'var(--green)'],
    ['Prémie', focus.premie, 'var(--blue)'],
    ['Svátek', focus.svatek, 'var(--amber)'],
    ['Dovolená', focus.dovolenaKc, 'var(--purple)'],
  ].filter(x => x[1] > 0);
  const maxPart = Math.max(...parts.map(x => x[1]), 1);
  document.getElementById('salDetail').innerHTML =
    parts.map(([name, val, color]) => `
      <div class="crow" style="cursor:default"><div class="cname">${name}</div>
      <div class="ctrack"><div class="cfill" style="width:${Math.round((val / maxPart) * 100)}%;background:${color}"></div></div>
      <div class="cval cval-w">${czk(val)}</div></div>`).join('')
    + `<div class="metric-row"><div><strong>Hrubá mzda</strong><span>odprac. ${focus.odpracHod} h${focus.neodpracHod ? ` + ${focus.neodpracHod} h neodprac.` : ''}</span></div><strong>${czk(focus.hrubaMzda)}</strong></div>
    <div class="metric-row"><div><strong>Odvody + daň</strong><span>ZP ${czk(focus.zpPrac)} · SP ${czk(focus.spPrac)} · daň ${czk(focus.danPoSleve)}</span></div><strong class="an">−${czk(focus.zpPrac + focus.spPrac + focus.danPoSleve)}</strong></div>
    ${Math.abs(focusBonus) > 100 ? `<div class="metric-row"><div><strong>Bonus / vratka daně</strong><span>např. roční zúčtování daně</span></div><strong class="${focusBonus > 0 ? 'ap' : 'an'}">${focusBonus > 0 ? '+' : ''}${czk(focusBonus)}</strong></div>` : ''}
    ${focus.stravenky ? `<div class="metric-row"><div><strong>Stravenkový paušál</strong><span>nad rámec čisté mzdy</span></div><strong class="ap">+${czk(focus.stravenky)}</strong></div>` : ''}
    ${focus.multisport ? `<div class="metric-row"><div><strong>Multisport</strong><span>srážka ze mzdy</span></div><strong class="an">−${czk(focus.multisport)}</strong></div>` : ''}
    <div class="metric-row" style="border-top:2px solid var(--border2)"><div><strong>K výplatě na účet</strong><span>čistá ${czk(focus.cistaMzda)}</span></div><strong style="font-size:15px">${czk(focus.kVyplate)}</strong></div>`;

  /* ── ZÁKLAD + PRÉMIE: detekce skokových změn (ratchet — ignoruje proraci) ──
     Prémie klesá jen prorací (dovolená/neodprac.), nikdy nestoupne nad
     smluvní úroveň → běžící max zachytí jen skutečná navýšení (55k → 60k). */
  const compOf = s => (s.tarif || 0) + (s.premie || 0);
  const currentComp = Math.max(...all.map(compOf), 0);
  const compChanges = [];
  let plateau = 0;
  all.forEach(s => {
    const c = compOf(s);
    if (c > plateau * 1.03) { compChanges.push({ s, comp: c, prev: plateau || null }); plateau = c; }
    else if (c > plateau) plateau = c;
  });
  const lastChange = compChanges[compChanges.length - 1] || { s: all[0], comp: currentComp, prev: null };
  const plateauStart = lastChange.s;

  /* ── INFLAČNÍ POMOCNÍK & VYJEDNÁVÁNÍ (na bázi základ+prémie) ── */
  const baseSel = document.getElementById('salBaseline');
  const prevBase = baseSel.value;
  const lastAll = all[all.length - 1];
  baseSel.innerHTML = all.map(s =>
    `<option value="${s.id}">${MONTH_NAMES[s.mesic]} ${s.rok} — základ+prémie ${czk(compOf(s))}</option>`
  ).join('');
  // Default základna = měsíc poslední skokové změny (uživatel může přepnout)
  baseSel.value = [...baseSel.options].some(o => o.value === prevBase) ? prevBase : plateauStart.id;
  const base = all.find(s => s.id === baseSel.value) || plateauStart;
  const baseComp = compOf(base);

  const infl = cumulativeInflation(base.id, lastAll.id);
  const suggested = Math.round(baseComp * (1 + infl.pct / 100)); // mzda držící kupní sílu
  const inflAbs = suggested - baseComp;      // o kolik inflace zvedla cenovou hladinu
  const gapAbs = suggested - currentComp;    // kolik chybí, aby držel krok
  const estWarn = infl.monthsMissing > 0;

  document.getElementById('salInflation').innerHTML = `
    <div class="metric-row"><div><strong>Poslední změna mzdy</strong><span>${MONTH_NAMES[plateauStart.mesic]} ${plateauStart.rok} · aktuální základ+prémie</span></div><strong>${czk(currentComp)}</strong></div>
    <div class="metric-row"><div><strong>Kumulativní inflace</strong><span>od ${MONTH_NAMES[base.mesic]} ${base.rok} k dnešku</span></div><strong>${infl.pct.toFixed(1).replace('.', ',')} % · ${czk(inflAbs)}</strong></div>
    <div class="metric-row"><div><strong>Mzda držící krok s inflací</strong><span>${czk(baseComp)} × inflace</span></div><strong>${czk(suggested)}</strong></div>
    <div class="insight insight-badged" style="margin-top:10px">
      <div><strong>${gapAbs > 0 ? '⚠️ Zaostáváš za inflací' : '✅ Držíš krok'}</strong>
      <span>${gapAbs > 0
        ? `Aby základ+prémie (${czk(currentComp)}) od ${plateauStart.mesic}/${plateauStart.rok} udržel kupní sílu, měl by dnes být aspoň ${czk(suggested)} — tj. o ${czk(gapAbs)} víc. Podklad pro vyjednávání.`
        : `Základ+prémie ${czk(currentComp)} kupní sílu drží i po inflaci ${infl.pct.toFixed(1).replace('.', ',')} %.`}</span></div>
      <strong class="insight-badge" style="color:${gapAbs > 0 ? 'var(--red)' : 'var(--green)'}">${gapAbs > 0 ? '+' : ''}${czk(gapAbs)}</strong>
    </div>
    ${estWarn ? `<div style="font-size:11px;color:var(--text3);margin-top:8px">⚠️ Část období (${infl.monthsMissing} měs.) používá odhad inflace — čísla jsou orientační.</div>` : ''}`;

  /* ── ZÁKLAD + PRÉMIE TIMELINE ── */
  document.getElementById('salTarif').innerHTML = compChanges.map((ch, i) => {
    const isLast = i === compChanges.length - 1;
    const comp = isLast ? currentComp : ch.comp;   // poslední úroveň = smluvní max
    const pct = ch.prev ? ((comp - ch.prev) / ch.prev) * 100 : null;
    return `<div class="metric-row">
      <div><strong>${MONTH_NAMES[ch.s.mesic]} ${ch.s.rok}</strong><span>${pct === null ? 'první záznam' : 'zvýšení o ' + pct.toFixed(1).replace('.', ',') + ' %'} · základ ${czk(ch.s.tarif)} + prémie ${czk(comp - ch.s.tarif)}</span></div>
      <strong class="${pct ? 'ap' : ''}">${czk(comp)}</strong>
    </div>`;
  }).join('') + (compChanges.length <= 1 ? '<div class="insight" style="margin-top:10px"><strong>Beze změny</strong><span>Za sledované období se základ+prémie nezvedl — mrkni na inflačního pomocníka.</span></div>' : '');

  /* ── PRÉMIE V ČASE (rozsah, klikací) ── */
  const maxPrem = Math.max(...data.map(s => s.premie), 1);
  document.getElementById('salPremie').innerHTML = data.map(s => {
    const pctOfGross = s.hrubaMzda ? (s.premie / s.hrubaMzda) * 100 : 0;
    return `<div class="crow${s.id === _salSelected ? ' sel' : ''}" onclick="salSelect('${s.id}')"><div class="cname">${ymLabel(s)}</div>
      <div class="ctrack"><div class="cfill" style="width:${Math.round((s.premie / maxPrem) * 100)}%;background:var(--blue)"></div></div>
      <div class="cval cval-w">${czk(s.premie)} · ${pctOfGross.toFixed(0)} %</div></div>`;
  }).join('');

  /* ── TABULKA (rozsah, klikací) ── */
  document.getElementById('salBody').innerHTML = data.slice().reverse().map(s => {
    const b = bonusOf(s);
    return `<tr onclick="salSelect('${s.id}')" style="cursor:pointer" class="${s.id === _salSelected ? 'sel' : ''}">
    <td style="white-space:nowrap"><b>${MONTH_NAMES[s.mesic]} ${s.rok}</b></td>
    <td>${czk(s.tarif)}</td><td>${czk(s.hrubaMzda)}</td><td class="ap">${czk(s.cistaMzda)}</td>
    <td class="${Math.abs(b) > 100 ? (b > 0 ? 'ap' : 'an') : ''}" style="white-space:nowrap">${Math.abs(b) > 100 ? (b > 0 ? '+' : '') + czk(b) : '—'}</td>
    <td><b>${czk(s.kVyplate)}</b></td><td style="color:var(--text2)">${s.odpracHod}</td>
    <td style="color:var(--text2)">${days(s.dovolenaZustatek)} dní</td></tr>`;
  }).join('');
}

import { GAS_URL, MZ } from './config.js';
import { state } from './state.js';
import { toast } from './app.js';
import { renderSalary } from './salary.js';
import { isSalaryAllowed } from './auth.js';

/* ── HESLO K PDF (fixní, uložené lokálně — nikdy do repa) ── */
function getSalaryPwd() { return localStorage.getItem('salaryPdfPwd') || ''; }
function saveSalaryPwd(p) { localStorage.setItem('salaryPdfPwd', p); }

/* ── MODAL CONTROL ── */
export function openSalaryImport() {
  document.getElementById('salaryResults').style.display = 'none';
  document.getElementById('salaryStatus').style.display = 'none';
  document.getElementById('salaryModal').style.display = 'flex';
}
export function closeSalaryImport() {
  document.getElementById('salaryModal').style.display = 'none';
}

/* ── DRAG-DROP ── */
export function salaryDov(e) { e.preventDefault(); document.getElementById('salaryZone').classList.add('over'); }
export function salaryDol()  { document.getElementById('salaryZone').classList.remove('over'); }
export function salaryDod(e) { e.preventDefault(); salaryDol(); const f = e.dataTransfer.files[0]; if (f) procSalaryFile(f); }
export function onSalaryFile(e) { const f = e.target.files[0]; if (f) procSalaryFile(f); e.target.value = ''; }

/* ── ČÍSELNÉ PARSOVÁNÍ (české formáty: "59 893", "160,00", "343,75") ── */
const parseNum = s => {
  const n = parseFloat(String(s).replace(/\s| /g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

/* ── MAIN PROCESSOR ── */
async function procSalaryFile(file, presetName) {
  const status  = document.getElementById('salaryStatus');
  const results = document.getElementById('salaryResults');
  status.style.display = 'block';
  results.style.display = 'none';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">
    <div style="width:28px;height:28px;border:2px solid rgba(55,138,221,.3);border-top-color:var(--blue);border-radius:50%;margin:0 auto 10px;animation:spin .8s linear infinite"></div>
    Čtu výplatní pásku…
  </div>`;

  try {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js se nepodařilo načíst — zkontroluj internetové připojení');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const fname = presetName || file.name || 'paska.pdf';
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: getSalaryPwd() || undefined });

    loadingTask.onPassword = (updateCallback, reason) => {
      const msg = reason === 2 ? 'Nesprávné heslo k pásce, zadej znovu:' : 'Zadej heslo k PDF výplatní pásky (zapamatuje se):';
      const pwd = prompt(msg);
      if (pwd !== null) { saveSalaryPwd(pwd.trim()); updateCallback(pwd.trim()); }
      else throw new Error('Import zrušen — heslo nebylo zadáno');
    };

    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1); // páska je jednostránková
    const content = await page.getTextContent();
    const items = content.items
      .filter(it => it.str.trim())
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

    const parsed = parsePayslip(items);
    parsed.soubor = fname;
    if (!parsed.hrubaMzda || !parsed.cistaMzda) throw new Error('Nepodařilo se najít hrubou/čistou mzdu. Je to výplatní páska od Harnol/Logio?');

    state._salaryParsed = parsed;
    status.style.display = 'none';
    showSalaryPreview(parsed);
  } catch(e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba: ${e.message}</p>
      <p style="color:var(--text2);font-size:12px;margin-top:6px">Ujisti se, že nahráváš PDF výplatní pásku a zadal správné heslo.</p>
    </div>`;
  }
}

/* ── PARSER PÁSKY ──
   Pozičně sázené PDF: kódované složky čteme řádkově (Y-grouping),
   hlavičkové boxy (Tarif, Průměr, Dovolená, měsíc/rok) pozičně — hodnota pod labelem. */
function parsePayslip(items) {
  // 1) Seskupit do vizuálních řádků dle Y (tolerance ±4px)
  const sorted = items.slice().sort((a, b) => Math.abs(a.y - b.y) > 4 ? b.y - a.y : a.x - b.x);
  const lines = [];
  let prevY = null, tokens = [];
  for (const it of sorted) {
    if (prevY !== null && Math.abs(it.y - prevY) <= 4) tokens.push(it.str);
    else {
      if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim());
      tokens = [it.str]; prevY = it.y;
    }
  }
  if (tokens.length) lines.push(tokens.join(' ').replace(/\s{2,}/g, ' ').trim());

  const p = { mesic: 0, rok: 0, tarif: 0, prumerHod: 0, zakladniMzda: 0, svatek: 0, premie: 0,
    dovolenaKc: 0, stravenky: 0, hrubaMzda: 0, hrubyPrijem: 0, danPoSleve: 0, zpPrac: 0, spPrac: 0,
    cistaMzda: 0, kVyplate: 0, odpracHod: 0, neodpracHod: 0, dovolenaNarok: 0, dovolenaZustatek: 0, multisport: 0 };

  // 2) Kódované složky — pozičně: částka = nejpravější číslo na stejném
  //    Y-řádku do ~335px od kódu (páska má dva sloupce, tohle je nesmíchá)
  const NUM_ONLY = /^-?\d{1,3}(?:[\s ]\d{3})*(?:,\d+)?$/;
  // 111 = Stravenkový paušál do limitu, 794 = Stravovací paušál (starší pásky)
  const CODE_MAP = { '001': 'zakladniMzda', '008': 'svatek', '432': 'premie', '211': 'dovolenaKc', '111': 'stravenky', '794': 'stravenky', '923': 'multisport' };
  // Kód složky = 3ciferné číslo, které má hned napravo textový popisek
  const isCode = it => /^\d{3}$/.test(it.str)
    && items.some(t => Math.abs(t.y - it.y) <= 4 && t.x > it.x && t.x - it.x < 40 && /^[A-Za-zÁ-Žá-žĚŠČŘŽýůú]/.test(t.str));
  const codeItems = items.filter(isCode);
  codeItems.forEach(codeIt => {
    const key = CODE_MAP[codeIt.str];
    if (!key) return;
    // Částka = nejpravější číslo mezi tímto kódem a dalším kódem na stejném řádku
    const boundary = Math.min(...codeItems
      .filter(o => o !== codeIt && Math.abs(o.y - codeIt.y) <= 4 && o.x > codeIt.x)
      .map(o => o.x), Infinity);
    const nums = items.filter(it => !isCode(it) && Math.abs(it.y - codeIt.y) <= 4
      && it.x > codeIt.x + 15 && it.x < boundary && NUM_ONLY.test(it.str));
    if (nums.length) p[key] = parseNum(nums.sort((a, b) => b.x - a.x)[0].str);
  });

  // Souhrnné labely — hodnota hned za labelem na Y-řádku
  const LABEL_MAP = [
    [/Hrubá mzda:/i, 'hrubaMzda'], [/Hrubý příjem:/i, 'hrubyPrijem'],
    [/Čistá mzda:/i, 'cistaMzda'], [/K výplatě:/i, 'kVyplate'],
    [/Daň po slevě:/i, 'danPoSleve'], [/ZP prac\.:/i, 'zpPrac'], [/SP prac\.:/i, 'spPrac'],
    [/Odprac\. hodiny:/i, 'odpracHod'], [/Neodprac\. hodiny:/i, 'neodpracHod'],
  ];
  for (const line of lines) {
    for (const [re, key] of LABEL_MAP) {
      if (re.test(line) && !p[key]) {
        const after = line.split(re)[1] || '';
        const m = after.match(/(-?\d{1,3}(?:[\s ]\d{3})*(?:,\d+)?)/);
        if (m) p[key] = parseNum(m[1]);
      }
    }
  }

  // 3) Hlavičkové boxy — hodnota POD labelem (menší y, podobné x)
  const findLabel = txt => items.find(it => it.str === txt || it.str.startsWith(txt));
  const valueBelow = (labelIt, re) => {
    if (!labelIt) return 0;
    const cands = items.filter(it => it !== labelIt && it.y < labelIt.y && labelIt.y - it.y < 30
      && Math.abs(it.x - labelIt.x) < 30 && re.test(it.str));
    cands.sort((a, b) => (labelIt.y - a.y) - (labelIt.y - b.y));
    return cands.length ? parseNum(cands[0].str) : 0;
  };
  const NUM_RE = /^-?\d{1,3}(?:[\s ]\d{3})*(?:,\d+)?$/;
  p.tarif            = valueBelow(findLabel('Tarif'), NUM_RE);
  p.prumerHod        = valueBelow(findLabel('Průměr'), NUM_RE);
  p.dovolenaNarok    = valueBelow(findLabel('Dovolená nárok'), NUM_RE);
  p.dovolenaZustatek = valueBelow(findLabel('Dovolená zůstatek'), NUM_RE);

  // 4) Měsíc/rok — samostatný rok 20xx v horní části, měsíc = číslo 1-12 nad ním
  const yearIt = items.filter(it => /^20\d{2}$/.test(it.str)).sort((a, b) => b.y - a.y)[0];
  if (yearIt) {
    p.rok = parseInt(yearIt.str);
    const monthIt = items.filter(it => /^([1-9]|1[0-2])$/.test(it.str)
      && it.y > yearIt.y && it.y - yearIt.y < 30 && Math.abs(it.x - yearIt.x) < 40)
      .sort((a, b) => (a.y - yearIt.y) - (b.y - yearIt.y))[0];
    if (monthIt) p.mesic = parseInt(monthIt.str);
  }

  return p;
}

/* ── PREVIEW ── */
const FIELDS = [
  ['mesic', 'Měsíc'], ['rok', 'Rok'], ['tarif', 'Tarif (Kč)'], ['prumerHod', 'Průměr (Kč/h)'],
  ['zakladniMzda', 'Základní mzda'], ['svatek', 'Svátek tarifem'], ['premie', 'Měsíční prémie'],
  ['dovolenaKc', 'Dovolená (Kč)'], ['stravenky', 'Stravenkový paušál'],
  ['hrubaMzda', 'Hrubá mzda'], ['hrubyPrijem', 'Hrubý příjem'], ['danPoSleve', 'Daň po slevě'],
  ['zpPrac', 'ZP zaměstnanec'], ['spPrac', 'SP zaměstnanec'],
  ['cistaMzda', 'Čistá mzda'], ['kVyplate', 'K výplatě'],
  ['odpracHod', 'Odpracované hodiny'], ['neodpracHod', 'Neodpracované hodiny'],
  ['dovolenaNarok', 'Dovolená nárok (h)'], ['dovolenaZustatek', 'Dovolená zůstatek (h)'],
  ['multisport', 'Multisport'],
];

function showSalaryPreview(p) {
  const results = document.getElementById('salaryResults');
  const id = `${p.rok}-${String(p.mesic).padStart(2, '0')}`;
  const dup = state.salary.some(s => s.id === id);
  results.style.display = 'block';
  results.innerHTML = `
    ${dup ? `<div style="background:var(--amber-bg,#fdf3e0);border:1px solid var(--amber);border-radius:var(--rsm);padding:8px 12px;margin-bottom:10px;font-size:12px">⚠️ Páska za <b>${id}</b> už je uložená — uložením vznikne duplicita.</div>` : ''}
    <div class="fgrid" style="grid-template-columns:1fr 1fr;gap:8px;max-height:320px;overflow-y:auto;padding-right:4px">
      ${FIELDS.map(([key, label]) => `
        <div class="fg"><label>${label}</label>
        <input type="number" step="any" id="salF_${key}" value="${p[key] ?? 0}"/></div>`).join('')}
    </div>
    <button class="btnp" style="margin-top:12px;width:100%" onclick="confirmSalaryImport()">💾 Uložit pásku ${id}</button>`;
}

/* ── SAVE ── */
export async function confirmSalaryImport() {
  const p = { ...(state._salaryParsed || {}) };
  FIELDS.forEach(([key]) => {
    const el = document.getElementById('salF_' + key);
    if (el) p[key] = parseFloat(el.value) || 0;
  });
  if (!p.mesic || !p.rok) { toast('Vyplň měsíc a rok', 'err'); return; }
  const id = `${p.rok}-${String(p.mesic).padStart(2, '0')}`;
  const row = [];
  row[MZ.id] = id; row[MZ.mesic] = p.mesic; row[MZ.rok] = p.rok; row[MZ.tarif] = p.tarif;
  row[MZ.prumerHod] = p.prumerHod; row[MZ.zakladniMzda] = p.zakladniMzda; row[MZ.svatek] = p.svatek;
  row[MZ.premie] = p.premie; row[MZ.dovolenaKc] = p.dovolenaKc; row[MZ.stravenky] = p.stravenky;
  row[MZ.hrubaMzda] = p.hrubaMzda; row[MZ.hrubyPrijem] = p.hrubyPrijem; row[MZ.danPoSleve] = p.danPoSleve;
  row[MZ.zpPrac] = p.zpPrac; row[MZ.spPrac] = p.spPrac; row[MZ.cistaMzda] = p.cistaMzda;
  row[MZ.kVyplate] = p.kVyplate; row[MZ.odpracHod] = p.odpracHod; row[MZ.neodpracHod] = p.neodpracHod;
  row[MZ.dovolenaNarok] = p.dovolenaNarok; row[MZ.dovolenaZustatek] = p.dovolenaZustatek;
  row[MZ.multisport] = p.multisport; row[MZ.soubor] = p.soubor || '';

  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ sheet: 'Mzdy', values: [row] }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    state.salary.push(parseSalaryRow(row));
    state.salary.sort((a, b) => a.id.localeCompare(b.id));
    toast(`Páska ${id} uložena`, 'ok');
    // Pokud šlo o import z banneru, označit jako imported
    if (state._salaryImportFile) {
      try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'markPayslipImported', filename: state._salaryImportFile }) }); } catch(e) {}
      state._salaryImportFile = null;
      hideSalaryBanner();
    }
    closeSalaryImport();
    renderSalary();
  } catch(e) { toast('Chyba zápisu: ' + e.message, 'err'); }
}

/* ── LOAD (list Mzdy) ── */
// Sheets si "2026-05" automaticky převede na datum a GAS vrátí ISO string
// ("2026-05-01T00:00:00.000Z", případně s TZ posunem) — normalizovat zpět na YYYY-MM
function normSalaryId(v) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    dt.setUTCHours(dt.getUTCHours() + 12); // tolerance ±12 h na TZ posun
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return '';
}

export function parseSalaryRow(r) {
  const num = i => parseNum(r[i]);
  return {
    id: normSalaryId(r[MZ.id]), mesic: num(MZ.mesic), rok: num(MZ.rok), tarif: num(MZ.tarif),
    prumerHod: num(MZ.prumerHod), zakladniMzda: num(MZ.zakladniMzda), svatek: num(MZ.svatek),
    premie: num(MZ.premie), dovolenaKc: num(MZ.dovolenaKc), stravenky: num(MZ.stravenky),
    hrubaMzda: num(MZ.hrubaMzda), hrubyPrijem: num(MZ.hrubyPrijem), danPoSleve: num(MZ.danPoSleve),
    zpPrac: num(MZ.zpPrac), spPrac: num(MZ.spPrac), cistaMzda: num(MZ.cistaMzda),
    kVyplate: num(MZ.kVyplate), odpracHod: num(MZ.odpracHod), neodpracHod: num(MZ.neodpracHod),
    dovolenaNarok: num(MZ.dovolenaNarok), dovolenaZustatek: num(MZ.dovolenaZustatek),
    multisport: num(MZ.multisport), soubor: String(r[MZ.soubor] || '')
  };
}

export async function loadSalaryData() {
  if (!isSalaryAllowed()) return;
  try {
    const r = await fetch(GAS_URL + '?sheet=Mzdy');
    const d = await r.json();
    if (d.error) { state.salary = []; renderSalary(); return; } // list ještě neexistuje
    // GAS list auto-vytváří bez hlavičky — filtrovat dle tvaru id, ne slice(1)
    state.salary = (d.values || []).map(parseSalaryRow).filter(s => s.id);
    state.salary.sort((a, b) => a.id.localeCompare(b.id));
    renderSalary();
    loadPayslipNotification();
  } catch(e) { /* mzdy jsou volitelné — nechceme rozbít boot */ }
}

/* ── BANNER: nová páska z e-mailu ── */
export async function loadPayslipNotification() {
  try {
    const r = await fetch(GAS_URL + '?sheet=MzdyImport');
    const d = await r.json();
    if (d.error || !d.values) return;
    const rows = d.values.slice(1).filter(x => x[4] === 'new');
    if (!rows.length) return;
    const latest = rows[rows.length - 1];
    showSalaryBanner(latest[1], latest[2]); // [_, soubor, fileId]
  } catch(e) {}
}

function showSalaryBanner(filename, fileId) {
  const banner = document.getElementById('salaryBanner');
  if (!banner) return;
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span style="font-size:18px">💵</span>
    <div style="flex:1;min-width:180px">
      <div style="font-weight:600;font-size:13px">Nová výplatní páska</div>
      <div style="font-size:12px;color:var(--text2)">${filename}</div>
    </div>
    <button class="btnp btnsm" onclick="importPayslipFromDrive('${fileId}','${filename.replace(/'/g, '\\\'')}')">Importovat</button>
    <button class="btn btnsm" onclick="hideSalaryBanner()">✕</button>`;
}

export function hideSalaryBanner() {
  const b = document.getElementById('salaryBanner');
  if (b) b.style.display = 'none';
}

/* ── IMPORT Z DRIVE (přes GAS, žádný CORS) ── */
export async function importPayslipFromDrive(fileId, filename) {
  openSalaryImport();
  const status = document.getElementById('salaryStatus');
  status.style.display = 'block';
  status.innerHTML = `<div class="card" style="text-align:center;padding:20px;color:var(--text2)">Stahuji pásku z Disku…</div>`;
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'getDriveFile', fileId }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const bin = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    state._salaryImportFile = filename;
    await procSalaryFile(bin.buffer, d.name || filename);
  } catch(e) {
    status.innerHTML = `<div class="card" style="border-color:var(--red);padding:16px">
      <p style="color:var(--red);font-weight:600">Chyba stažení: ${e.message}</p></div>`;
  }
}

// Rozložení portfolia (typ aktiv, odvětví, země, firmy) — čistá logika bez
// DOM a sítě (npm test). Fondy a ETF se „rozbalí" podle svého složení
// (list Slozeni), přímé akcie a nemovitostní fondy podle profilu (list Profily).

const SEKTORY = {
  'Information Technology': 'Technologie', 'Financials': 'Finance', 'Health Care': 'Zdravotnictví',
  'Consumer Discretionary': 'Spotřební zboží', 'Consumer Staples': 'Základní spotřeba',
  'Industrials': 'Průmysl', 'Communication': 'Komunikace a média', 'Communication Services': 'Komunikace a média',
  'Energy': 'Energie (ropa, plyn)', 'Materials': 'Suroviny a materiály', 'Utilities': 'Energetika a utility',
  'Real Estate': 'Nemovitosti (akcie)', 'Cash and/or Derivatives': 'Hotovost', 'Cash': 'Hotovost', 'Other': 'Ostatní',
};
const ZEME = {
  'United States': 'USA', 'Japan': 'Japonsko', 'United Kingdom': 'Velká Británie', 'Canada': 'Kanada',
  'France': 'Francie', 'Germany': 'Německo', 'Switzerland': 'Švýcarsko', 'Netherlands': 'Nizozemsko',
  'Australia': 'Austrálie', 'Taiwan': 'Tchaj-wan', 'China': 'Čína', 'India': 'Indie', 'Korea (South)': 'Jižní Korea',
  'South Korea': 'Jižní Korea', 'Korea': 'Jižní Korea', 'Brazil': 'Brazílie', 'Sweden': 'Švédsko', 'Denmark': 'Dánsko',
  'Spain': 'Španělsko', 'Italy': 'Itálie', 'Ireland': 'Irsko', 'Hong Kong': 'Hongkong', 'Saudi Arabia': 'Saúdská Arábie',
  'South Africa': 'Jižní Afrika', 'Mexico': 'Mexiko', 'Finland': 'Finsko', 'Norway': 'Norsko', 'Belgium': 'Belgie',
  'Czech Republic': 'Česko', 'Czechia': 'Česko', 'Poland': 'Polsko', 'Slovakia': 'Slovensko', 'Austria': 'Rakousko',
  'Singapore': 'Singapur', 'Israel': 'Izrael', 'Indonesia': 'Indonésie', 'Thailand': 'Thajsko', 'Malaysia': 'Malajsie',
};
export const sektorCz = s => SEKTORY[s] || s || 'Neznámé';
export const zemeCz = z => ZEME[z] || z || 'Neznámé';

const SUFFIX = new Set(['INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'AG', 'SA', 'NV', 'SE',
  'AB', 'ASA', 'SPA', 'OYJ', 'AS', 'HOLDINGS', 'HOLDING', 'GROUP', 'REG', 'ADR', 'SHS', 'THE']);
const ALIAS = { 'TSMC': 'TAIWAN SEMICONDUCTOR MANUFACTURING', 'GOOGLE': 'ALPHABET', 'FACEBOOK': 'META PLATFORMS',
  'META': 'META PLATFORMS', 'AMAZONCOM': 'AMAZON' };

// Jméno firmy → klíč pro sčítání napříč zdroji („ALPHABET INC CLASS C",
// „Alphabet Inc. Class A" i „Alphabet" = ALPHABET).
export function normFirm(name) {
  let t = String(name || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.COM\b/g, 'COM').replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ci = t.findIndex((w, i) => (w === 'CLASS' || w === 'CL') && i > 0);
  if (ci > 0) t = t.slice(0, ci);
  while (t.length > 1 && SUFFIX.has(t[t.length - 1])) t.pop();
  const k = t.join(' ');
  return ALIAS[k] || ALIAS[k.replace(/ /g, '')] || k;
}
// Klíč → zobrazované jméno (krátká slova typu SK, AMD nechá velkými).
function displayFirm(key) {
  return key.split(' ').map(w => w.length <= 3 && !/[AEIOUY]/.test(w.slice(1)) ? w : w[0] + w.slice(1).toLowerCase()).join(' ');
}

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

// List Slozeni → { klic: { firmy:[], sektory:{}, zeme:{}, asOf, zdroj } }
export function parseSlozeni(res) {
  const out = {};
  for (const r of (res && res.values || []).slice(1)) {
    const k = String(r[0] || '').trim();
    if (!k) continue;
    const o = out[k] = out[k] || { firmy: [], sektory: {}, zeme: {}, asOf: '', zdroj: '' };
    const typ = r[1], nazev = String(r[2] || '').trim(), vaha = num(r[3]);
    if (typ === 'firma') o.firmy.push({ nazev, vaha, sektor: r[4] || '', zeme: r[5] || '' });
    else if (typ === 'sektor') o.sektory[nazev] = (o.sektory[nazev] || 0) + vaha;
    else if (typ === 'zeme') o.zeme[nazev] = (o.zeme[nazev] || 0) + vaha;
    if (r[6] && String(r[6]) > o.asOf) o.asOf = String(r[6]).slice(0, 10);
    if (r[7]) o.zdroj = r[7];
  }
  return out;
}

// List Profily → { isin: { trida, klic, firma, sektor, zeme, poznamka } }
export function parseProfily(res) {
  const out = {};
  for (const r of (res && res.values || []).slice(1)) {
    const k = String(r[0] || '').trim();
    if (k) out[k] = { trida: r[1] || '', klic: r[2] || '', firma: r[3] || '', sektor: r[4] || '', zeme: r[5] || '', poznamka: r[6] || '' };
  }
  return out;
}

/* holdings: [{ isin, nazev, czk }], cash: Kč volné hotovosti,
   limity: { fond, firma } — od jakého podílu na celku varovat. */
export function allocation(holdings, cash, profily, slozeni, limity = { fond: 0.25, firma: 0.05 }) {
  const trida = new Map(), sektory = new Map(), zeme = new Map(), firmy = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const addFirm = (name, v, pres) => {
    const key = normFirm(name);
    const f = firmy.get(key) || { name: displayFirm(key), czk: 0, pres: new Set() };
    f.czk += v; f.pres.add(pres); firmy.set(key, f);
  };
  let total = 0, rozepsano = 0, akcie = 0;
  const varovani = [];

  for (const h of holdings) {
    const v = h.czk || 0;
    if (!(v > 0)) continue;
    total += v;
    const p = profily[h.isin];
    if (!p || !p.trida) { add(trida, 'Nezařazeno', v); add(sektory, 'Neznámé', v); add(zeme, 'Neznámé', v); continue; }
    add(trida, p.trida, v);
    if (p.trida === 'Akcie') akcie += v;
    const s = p.klic && slozeni[p.klic];
    if (s) {
      // sektory/země ze složení; když fond uvádí jen top 10 firem, chybí zbytek → „Neznámé"
      const sumS = Object.values(s.sektory).reduce((a, b) => a + b, 0);
      for (const [k, w] of Object.entries(s.sektory)) add(sektory, sektorCz(k), v * w);
      if (sumS < 0.999) add(sektory, 'Neznámé', v * (1 - sumS));
      const sumZ = Object.values(s.zeme).reduce((a, b) => a + b, 0);
      for (const [k, w] of Object.entries(s.zeme)) add(zeme, zemeCz(k), v * w);
      if (sumZ < 0.999) add(zeme, zemeCz(p.zeme) || 'Neznámé', v * (1 - sumZ));
      for (const f of s.firmy) { addFirm(f.nazev, v * f.vaha, h.nazev); rozepsano += v * f.vaha; }
    } else {
      add(sektory, p.sektor ? sektorCz(p.sektor) : 'Neznámé', v);
      add(zeme, zemeCz(p.zeme), v);
      if (p.firma) { addFirm(p.firma, v, h.nazev); rozepsano += v; }
    }
  }
  if (cash > 0) { total += cash; add(trida, 'Hotovost', cash); add(sektory, 'Hotovost', cash); add(zeme, 'Hotovost', cash); }

  const list = m => [...m.entries()].map(([name, czk]) => ({ name, czk, pct: total ? czk / total : 0 })).sort((a, b) => b.czk - a.czk);
  const firmList = [...firmy.values()].map(f => ({ name: f.name, czk: f.czk, pct: total ? f.czk / total : 0, pres: [...f.pres] }))
    .sort((a, b) => b.czk - a.czk);

  for (const h of holdings) if (total && h.czk / total > limity.fond)
    varovani.push(`${h.nazev}: ${Math.round(h.czk / total * 100)} % portfolia v jednom fondu/pozici`);
  for (const f of firmList) if (f.pct > limity.firma)
    varovani.push(`${f.name}: ${(f.pct * 100).toFixed(1).replace('.', ',')} % portfolia v jedné firmě`);

  return { total, trida: list(trida), sektory: list(sektory), zeme: list(zeme), firmy: firmList, varovani,
    pokryti: akcie ? Math.min(rozepsano / akcie, 1) : 0 };
}

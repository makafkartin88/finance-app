import { DEFAULT_LIMITS } from './config.js';

export const state = {
  txs: [],
  person: 'Oba',
  editIdx: null,
  // uctyMartin / uctySarka — čísla účtů (jedno na řádek, klidně víc variant).
  // Při importu z mBank se podle protistrany pozná převod mezi Martinem
  // a Šárkou a automaticky se označí „do bilance" (viz mbank-import.js).
  cfg: { apiKey: '', bilanceOffset: 20000, bilanceUcet: '670100-2230152615/6210', uctyMartin: '', uctySarka: '' },
  limits: { ...DEFAULT_LIMITS },
  drill: { months: new Set(), cat: null },
  _range: null,
  recurring: [],
  investments: [],       // investiční fondy (list Fondy) — CODYA + CONSEQ
  market: [],            // S&P 500 benchmark per provider (list Trh)
  invHist: [],           // historie hodnot fondů (list FondyHist)
  trhHist: [],           // denní S&P + USD/CZK (list TrhHist)
  salary: [],            // parsované výplatní pásky (list Mzdy)
  _salaryParsed: null,   // aktuálně naparsovaná páska v preview modalu
  _salaryImportFile: null, // název souboru při importu z banneru (pro markPayslipImported)
  _importBusy: false,
  _impRows: [],
  _tt: null,
  tableFilters: {
    dash: { kategorie: new Set(), osoba: new Set(), castkaSort: null, castkaRange: { min: null, max: null } },
    tx:   { kategorie: new Set(), osoba: new Set(), castkaSort: null, castkaRange: { min: null, max: null } }
  }
};

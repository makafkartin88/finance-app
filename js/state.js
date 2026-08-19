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
  _salaryImportFile: null,   // název souboru při importu z banneru (pro zobrazení)
  _salaryImportFileId: null, // Drive fileId při importu z banneru (pro markPayslipImported)
  _salaryPending: [],    // fronta nevyřízených pásek z e-mailu (list MzdyImport, status 'new')
  _ucpPending: [],       // fronta nevyřízených UniCredit výpisů CP (list UcpImport)
  _ucpImportFileId: null, // Drive fileId při importu z banneru (pro markUcpImported)
  _importBusy: false,
  _impRows: [],
  _tt: null,
  tableFilters: {
    // sortCol/sortDir = obecné řazení (libovolný sloupec, viz table-filters.js);
    // castkaRange zůstává samostatně (filtr na rozsah částky, ne řazení).
    dash: { kategorie: new Set(), osoba: new Set(), sortCol: null, sortDir: null, castkaRange: { min: null, max: null } },
    tx:   { kategorie: new Set(), osoba: new Set(), sortCol: null, sortDir: null, castkaRange: { min: null, max: null } }
  }
};

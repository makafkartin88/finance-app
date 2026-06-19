import { DEFAULT_LIMITS } from './config.js';

export const state = {
  txs: [],
  person: 'Oba',
  editIdx: null,
  cfg: { apiKey: '', bilanceOffset: 20000, bilanceUcet: '670100-2230152615/6210' },
  limits: { ...DEFAULT_LIMITS },
  drill: { months: new Set(), cat: null },
  _range: null,
  recurring: [],
  _importBusy: false,
  _impRows: [],
  _tt: null,
  tableFilters: {
    dash: { kategorie: new Set(), osoba: new Set(), castkaSort: null, castkaRange: { min: null, max: null } },
    tx:   { kategorie: new Set(), osoba: new Set(), castkaSort: null, castkaRange: { min: null, max: null } }
  }
};

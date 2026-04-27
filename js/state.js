import { DEFAULT_LIMITS } from './config.js';

export const state = {
  txs: [],
  person: 'Oba',
  editIdx: null,
  cfg: { apiKey: '' },
  limits: { ...DEFAULT_LIMITS },
  drill: { month: null, cat: null },
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

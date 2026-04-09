import { DEFAULT_LIMITS } from './config.js';

export const state = {
  txs: [],
  person: 'Oba',
  editIdx: null,
  cfg: { apiKey: '' },
  limits: { ...DEFAULT_LIMITS },
  drill: { month: null, cat: null },
  _range: null,
  _importBusy: false,
  _impRows: [],
  _tt: null
};

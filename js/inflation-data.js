import { normMonth } from './tx-core.js';
// ============================================================
// Index spotřebitelských cen ČR — bazický index (průměr 2025 = 100), úhrn,
// domácnosti celkem. Zdroj: ČSÚ, datová sada CEN0101E (open data).
// Kumulativní inflace = poměr indexů CPI[do] / CPI[od] − 1 (metodika ČSÚ).
//
// Tabulka je jen historie do 9/2026 — novější měsíce si každé pondělí
// stahuje GAS z ČSÚ do listu "Inflace" (syncInflation) a appka je připojí
// přes cpiWith(). Ručně se tu nic doplňovat nemusí.
// ============================================================
export const CPI_CZ = {
  '2015-01': 64.2, '2015-02': 64.2, '2015-03': 64.3, '2015-04': 64.6, '2015-05': 64.7, '2015-06': 64.8, '2015-07': 64.7, '2015-08': 64.6, '2015-09': 64.5, '2015-10': 64.5, '2015-11': 64.2, '2015-12': 64.2,
  '2016-01': 64.5, '2016-02': 64.6, '2016-03': 64.5, '2016-04': 64.9, '2016-05': 64.8, '2016-06': 64.8, '2016-07': 65.1, '2016-08': 64.9, '2016-09': 64.8, '2016-10': 65.0, '2016-11': 65.2, '2016-12': 65.4,
  '2017-01': 65.9, '2017-02': 66.2, '2017-03': 66.2, '2017-04': 66.2, '2017-05': 66.3, '2017-06': 66.3, '2017-07': 66.6, '2017-08': 66.6, '2017-09': 66.5, '2017-10': 66.9, '2017-11': 66.9, '2017-12': 66.9,
  '2018-01': 67.4, '2018-02': 67.3, '2018-03': 67.3, '2018-04': 67.5, '2018-05': 67.8, '2018-06': 68.1, '2018-07': 68.2, '2018-08': 68.2, '2018-09': 68.1, '2018-10': 68.3, '2018-11': 68.2, '2018-12': 68.3,
  '2019-01': 69.0, '2019-02': 69.2, '2019-03': 69.3, '2019-04': 69.3, '2019-05': 69.8, '2019-06': 69.9, '2019-07': 70.2, '2019-08': 70.2, '2019-09': 69.9, '2019-10': 70.2, '2019-11': 70.4, '2019-12': 70.5,
  '2020-01': 71.5, '2020-02': 71.7, '2020-03': 71.7, '2020-04': 71.5, '2020-05': 71.8, '2020-06': 72.2, '2020-07': 72.6, '2020-08': 72.5, '2020-09': 72.2, '2020-10': 72.3, '2020-11': 72.3, '2020-12': 72.1,
  '2021-01': 73.1, '2021-02': 73.2, '2021-03': 73.3, '2021-04': 73.7, '2021-05': 73.9, '2021-06': 74.3, '2021-07': 75.0, '2021-08': 75.5, '2021-09': 75.7, '2021-10': 76.5, '2021-11': 76.6, '2021-12': 76.9,
  '2022-01': 80.3, '2022-02': 81.3, '2022-03': 82.7, '2022-04': 84.1, '2022-05': 85.6, '2022-06': 87.0, '2022-07': 88.2, '2022-08': 88.5, '2022-09': 89.3, '2022-10': 88.0, '2022-11': 89.0, '2022-12': 89.0,
  '2023-01': 94.4, '2023-02': 94.9, '2023-03': 95.1, '2023-04': 94.9, '2023-05': 95.2, '2023-06': 95.5, '2023-07': 95.9, '2023-08': 96.1, '2023-09': 95.4, '2023-10': 95.5, '2023-11': 95.5, '2023-12': 95.1,
  '2024-01': 96.5, '2024-02': 96.8, '2024-03': 97.0, '2024-04': 97.6, '2024-05': 97.6, '2024-06': 97.3, '2024-07': 98.0, '2024-08': 98.2, '2024-09': 97.9, '2024-10': 98.1, '2024-11': 98.2, '2024-12': 98.0,
  '2025-01': 99.3, '2025-02': 99.4, '2025-03': 99.5, '2025-04': 99.4, '2025-05': 99.9, '2025-06': 100.2, '2025-07': 100.6, '2025-08': 100.7, '2025-09': 100.1, '2025-10': 100.6, '2025-11': 100.3, '2025-12': 100.0,
  '2026-01': 100.9, '2026-02': 100.8, '2026-03': 101.4, '2026-04': 101.9, '2026-05': 102.0, '2026-06': 101.7, '2026-07': 102.3, '2026-08': 102.6, '2026-09': 102.6,
};

// Řada z tabulky + řádky listu Inflace ([mesic 'YYYY-MM', index]).
export function cpiWith(sheetValues) {
  const out = { ...CPI_CZ };
  for (const r of sheetValues || []) {
    const ym = normMonth(r[0]); // Sheets může měsíc převést na datum (UTC → o den dřív)
    const v = parseFloat(String(r[1]).replace(',', '.'));
    if (/^\d{4}-\d{2}$/.test(ym) && v > 0) out[ym] = v;
  }
  return out;
}

const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsBetween = (a, b) => {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

// Kumulativní inflace mezi měsíci (%). Měsíce za posledním zveřejněným
// indexem se odhadnou průměrným měsíčním tempem za posledních 12 měsíců
// (dřív se počítaly jako 0 %) a vrátí se jejich počet, ať to UI přizná.
// Vrací { pct, monthsMissing, lastKnown }.
export function cumulativeInflation(fromYM, toYM, cpi = CPI_CZ) {
  const keys = Object.keys(cpi).sort();
  const lastKnown = keys[keys.length - 1];
  if (!fromYM || !toYM || fromYM >= toYM) return { pct: 0, monthsMissing: 0, lastKnown };
  const at = (ym) => {
    if (cpi[ym]) return { v: cpi[ym], missing: 0 };
    if (ym > lastKnown) {
      const yearAgo = cpi[addMonths(lastKnown, -12)];
      const rate = yearAgo ? Math.pow(cpi[lastKnown] / yearAgo, 1 / 12) : 1;
      const n = monthsBetween(lastKnown, ym);
      return { v: cpi[lastKnown] * Math.pow(rate, n), missing: n };
    }
    const before = keys.filter(k => k < ym).pop() || keys[0];
    return { v: cpi[before], missing: 1 };
  };
  const a = at(fromYM), b = at(toYM);
  return { pct: (b.v / a.v - 1) * 100, monthsMissing: Math.max(0, b.missing - a.missing), lastKnown };
}

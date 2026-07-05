// ============================================================
// Meziroční inflace ČR (CPI, y/y %) — zdroj: ČSÚ
// https://csu.gov.cz/inflace-mira-inflace-metodika
// Ručně udržovaná tabulka — přidávej nové měsíce průběžně
// (stačí požádat Clauda: „aktualizuj inflační data z ČSÚ").
// Klíč: 'YYYY-MM', hodnota: meziroční inflace v %
// ============================================================
export const INFLATION_CZ = {
  '2024-01': 2.3, '2024-02': 2.0, '2024-03': 2.0, '2024-04': 2.9,
  '2024-05': 2.6, '2024-06': 2.0, '2024-07': 2.2, '2024-08': 2.2,
  '2024-09': 2.6, '2024-10': 2.8, '2024-11': 2.8, '2024-12': 3.0,
  '2025-01': 2.8, '2025-02': 2.7, '2025-03': 2.7, '2025-04': 1.8,
  '2025-05': 2.4, '2025-06': 2.9, '2025-07': 2.7, '2025-08': 2.5,
  // ── ODHADY (doplň skutečná čísla z ČSÚ) ──
  '2025-09': 2.5, '2025-10': 2.5, '2025-11': 2.5, '2025-12': 2.5,
  '2026-01': 2.5, '2026-02': 2.5, '2026-03': 2.5, '2026-04': 2.5,
  '2026-05': 2.5, '2026-06': 2.5,
};

// Vrátí seznam 'YYYY-MM' klíčů mezi from a to (včetně), vzestupně
function monthRange(fromYM, toYM) {
  const out = [];
  let [y, m] = fromYM.split('-').map(Number);
  const [ty, tm] = toYM.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Kumulativní inflace mezi dvěma měsíci (%).
// Aproximace: meziroční míru každého měsíce převedeme na měsíční
// tempo (1+yoy)^(1/12) a zřetězíme. Vrací { pct, monthsCovered, monthsMissing }.
export function cumulativeInflation(fromYM, toYM) {
  if (!fromYM || !toYM || fromYM >= toYM) return { pct: 0, monthsCovered: 0, monthsMissing: 0 };
  const months = monthRange(fromYM, toYM).slice(1); // první měsíc je základna
  let factor = 1, covered = 0, missing = 0;
  months.forEach(ym => {
    const yoy = INFLATION_CZ[ym];
    if (yoy === undefined) { missing++; return; }
    factor *= Math.pow(1 + yoy / 100, 1 / 12);
    covered++;
  });
  return { pct: (factor - 1) * 100, monthsCovered: covered, monthsMissing: missing };
}

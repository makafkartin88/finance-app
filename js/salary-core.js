// Čistá logika mzdy (bez DOM) — testovaná přes npm test.

export const compOf = s => (s.tarif || 0) + (s.premie || 0);
const TOL = 0.03; // rozdíl do 3 % = stejná úroveň (zaokrouhlení, drobná proraca)
const near = (a, b) => a > 0 && b > 0 && Math.abs(a / b - 1) <= TOL;
const median = xs => { const a = xs.filter(x => x > 0).sort((p, q) => p - q); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };

/* Změny smluvní úrovně základ+prémie.
   - Nová úroveň se uzná, až když ji potvrdí víc pásek po sobě: zvýšení 2,
     snížení 3 (dva měsíce s dovolenou po sobě nesmí vypadat jako snížení).
     Jednorázově vyšší prémie tak zvýšení není.
   - Začátek změny = první měsíc, kdy se částka od staré úrovně odchýlila
     (typicky poměrně krácený měsíc, kdy zvýšení začalo uprostřed).
   - Poměrně krácená první páska se přeskočí — úroveň začne, až když dvě
     pásky souhlasí.
   Vrací [{ s, idx, comp, prev }] — comp = úroveň (max potvrzených měsíců). */
export function detectChanges(list) {
  const c = list.map(compOf);
  const out = [];
  let plateau = null;
  for (let i = 0; i < c.length; i++) {
    if (plateau === null) {
      if (near(c[i], c[i + 1])) { plateau = Math.max(c[i], c[i + 1]); out.push({ idx: i, comp: plateau, prev: null }); i++; }
      continue;
    }
    if (near(c[i], plateau)) { plateau = Math.max(plateau, c[i]); out[out.length - 1].comp = plateau; continue; }
    const up = c[i] > plateau;
    const need = up ? 2 : 3;
    // Potvrzení: `need` měsíců od i (nebo od i+1, když i je přechodový
    // poměrný měsíc) se shoduje na nové úrovni.
    for (const from of [i, i + 1]) {
      const win = c.slice(from, from + need);
      if (win.length < need || !win.every(x => near(x, win[win.length - 1])) || near(win[win.length - 1], plateau)) continue;
      if ((win[win.length - 1] > plateau) !== up) continue;
      const level = up ? Math.max(...win) : median(win);
      out.push({ idx: i, comp: level, prev: plateau });
      plateau = level;
      i = from + need - 1;
      break;
    }
  }
  return out.map(x => ({ ...x, s: list[x.idx] }));
}

// Úroveň platná v měsíci `id` (poslední změna, která v něm už platila).
export function levelAt(changes, list, id) {
  let lvl = 0;
  for (const ch of changes) if (ch.s.id <= id) lvl = ch.comp;
  return lvl || compOf(list.find(s => s.id === id) || {});
}

// Typická čistá mzda v období (medián — dovolená/bonus ho nevychýlí).
export function typicalNet(list, fromId, toId) {
  return median(list.filter(s => s.id >= fromId && s.id <= toId).map(s => s.cistaMzda));
}

// Roční souhrny. Náklad zaměstnavatele = hrubá × 1,338 (SP 24,8 % + ZP 9 %).
export function yearSummaries(list) {
  const by = {};
  for (const s of list) {
    const y = by[s.rok] || (by[s.rok] = { rok: s.rok, pocet: 0, hruba: 0, cista: 0, odvody: 0 });
    y.pocet++;
    y.hruba += s.hrubaMzda || 0;
    y.cista += s.cistaMzda || 0;
    y.odvody += (s.zpPrac || 0) + (s.spPrac || 0) + (s.danPoSleve || 0);
  }
  return Object.values(by).sort((a, b) => a.rok - b.rok).map(y => ({
    ...y, sazba: y.hruba ? y.odvody / y.hruba : 0, nakladZam: Math.round(y.hruba * 1.338),
  }));
}

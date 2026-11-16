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

/* Čerpání dovolené v měsíci (h) — z poklesu zůstatku proti předchozí pásce.
   - nový kalendářní rok: dovolená se čerpá v kalendářním roce, v lednu
     naskočí nový nárok → čerpáno = nárok − zůstatek,
   - změna nároku během roku (nová smlouva): zůstatek se posune o rozdíl,
   - bez předchozí pásky: dovolená v Kč / průměrný hodinový výdělek. */
export function vacationUsed(prev, s) {
  if (prev) {
    let d;
    if (s.rok !== prev.rok) d = (s.dovolenaNarok || 0) - (s.dovolenaZustatek || 0);
    else d = (prev.dovolenaZustatek || 0) + ((s.dovolenaNarok || 0) - (prev.dovolenaNarok || 0)) - (s.dovolenaZustatek || 0);
    if (d > 0) return d;
    if (d === 0) return 0;
  }
  return (s.dovolenaKc > 0 && s.prumerHod > 0) ? Math.round(s.dovolenaKc / s.prumerHod) : 0;
}

/* Prémie jako % z maximální možné. Prémie se krátí přesně podle odpracovaných
   hodin (prémie = maximum × odpracováno / fond), takže maximum jde dopočítat
   i z kráceného měsíce. Vyšší maximum platí hned; nižší až když stejná
   hodnota vyjde 3 měsíce po sobě (jednorázově nižší prémie není nové maximum).
   `krac` = proč je měsíc krácený: neodpracované hodiny; `dovolena` jen když
   pokles zůstatku dovolené přesně odpovídá neodpracovaným hodinám. */
export function bonusSeries(list) {
  const out = [];
  let level = null, run = [];
  list.forEach((s, i) => {
    const odprac = s.odpracHod || 0, neodprac = s.neodpracHod || 0, fond = odprac + neodprac;
    const factor = fond > 0 ? odprac / fond : 1;
    const full = factor > 0 && s.premie > 0 ? Math.round(s.premie / factor / 100) * 100 : null;
    let maxChanged = false, confirmed = null;
    if (full != null) {
      if (level == null || full > level) { maxChanged = level != null; level = full; run = []; }
      else if (full < level) {
        run = run.length && out[run[0]].fullCand === full ? run.concat(i) : [i];
        if (run.length >= 3) { confirmed = run; level = full; run = []; }
      } else run = [];
    }
    const krac = neodprac > 0 ? {
      neodpracHod: neodprac, fond,
      dovolena: vacationUsed(i > 0 ? list[i - 1] : null, s) === neodprac && i > 0,
    } : null;
    out.push({ id: s.id, rok: s.rok, mesic: s.mesic, premie: s.premie || 0, max: level || 0, maxChanged, krac, fullCand: full });
    // potvrzené nižší maximum platí zpětně od prvního z těch měsíců
    if (confirmed) confirmed.forEach((j, k) => { out[j].max = level; out[j].maxChanged = k === 0; });
  });
  return out.map(({ fullCand, ...x }) => ({ ...x, pct: x.max > 0 ? x.premie / x.max : 0 }));
}

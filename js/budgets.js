import { state } from './state.js';
import { czk, base } from './utils.js';
import { escHtml } from './html.js';
import { toast } from './app.js';
import { persistCfg } from './settings.js';

export function renderBudgets() {
  const month = document.getElementById('bMonth')?.value || '';
  const list = base(month, null).filter(t => t.typ === 'Výdaj');
  const cats = {}; list.forEach(t => { cats[t.kategorie] = (cats[t.kategorie]||0)+t.castka; });
  let ok = 0, over = 0, tB = 0, tS = 0;
  const rows = Object.entries(state.limits).map(([c,lim]) => {
    const sp = cats[c]||0; const pct = lim > 0 ? Math.min(Math.round((sp/lim)*100), 999) : 0;
    const isO = sp > lim; if (isO) over++; else ok++; tB += lim; tS += sp;
    const col = isO ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)';
    return `<div class="budrow"><div class="budinf"><div class="budn">${escHtml(c)}</div><div class="buds">${czk(sp)} / ${czk(lim)}</div></div><div class="budtrack"><div class="budfill" style="width:${Math.min(pct,100)}%;background:${col}"></div></div><div class="budpct" style="color:${col}">${pct}%${isO ? ' ⚠' : ''}</div></div>`;
  });
  document.getElementById('b1').textContent = ok; document.getElementById('b2').textContent = over;
  document.getElementById('b3').textContent = czk(tB);
  const b4 = document.getElementById('b4'); b4.textContent = czk(tS); b4.className = 'mv '+(tS > tB ? 'red' : '');
  document.getElementById('budRows').innerHTML = rows.join('');
}

export function renderBudLimForm() {
  // id podle pořadí, ne podle názvu kategorie (název jde ze sdíleného listu)
  document.getElementById('budLimForm').innerHTML = Object.keys(state.limits).map((c, i) =>
    `<div class="fg"><label>${escHtml(c)}</label><input type="number" id="bl-${i}" value="${Number(state.limits[c]) || 0}"/></div>`
  ).join('');
}

export async function saveLimits() {
  Object.keys(state.limits).forEach((c, i) => {
    const v = parseInt(document.getElementById('bl-' + i)?.value) || 0;
    state.limits[c] = v;
  });
  localStorage.setItem('finlim', JSON.stringify(state.limits));
  renderBudgets();
  // Limity jsou sdílené (list Nastaveni) — stejné na všech zařízeních.
  const ok = await persistCfg(['limity']);
  toast(ok ? 'Limity uloženy' : 'Uloženo jen v tomhle prohlížeči — zápis na server selhal', ok ? 'ok' : 'err');
}

import { GAS_URL } from './config.js';
import { state } from './state.js';
import { parseRow } from './utils.js';
import { toast, boot, nav } from './app.js';

export function dov(e) { e.preventDefault(); document.getElementById('upzone').classList.add('over'); }
export function dol() { document.getElementById('upzone').classList.remove('over'); }
export function dod(e) { e.preventDefault(); dol(); const f = e.dataTransfer.files[0]; if (f) procFile(f); }
export function onFile(e) { const f = e.target.files[0]; if (f) procFile(f); }

function setImportBusy(busy) {
  const zone = document.getElementById('upzone');
  const input = document.getElementById('pdfIn');
  if (zone) zone.classList.toggle('busy', !!busy);
  if (input) input.disabled = !!busy;
  state._importBusy = !!busy;
}

function renderImportStatus(fileName, step, detail) {
  const st = document.getElementById('impStatus');
  const defs = [
    {key:'read',label:'Načítám soubor'},
    {key:'upload',label:'Posílám data AI'},
    {key:'analyze',label:'AI čte dokument'},
    {key:'prepare',label:'Připravuju návrh transakcí'}
  ];
  const activeIdx = Math.max(defs.findIndex(s => s.key === step), 0);
  const steps = defs.map((s,idx) => {
    const cls = idx < activeIdx ? 'pload-step done' : idx === activeIdx ? 'pload-step active' : 'pload-step';
    return `<div class="${cls}"><div class="pload-dot"></div><div class="pload-text">${s.label}</div></div>`;
  }).join('');
  const pct = Math.max(10, Math.min(100, Math.round(((activeIdx+1)/defs.length)*100)));
  st.style.display = 'block';
  st.innerHTML = `<div class="card pload">
    <div class="pload-top">
      <div>
        <div class="pload-title">AI zpracovává ${fileName}</div>
        <div class="pload-sub">${detail||'Tohle může chvíli trvat podle velikosti dokumentu.'}</div>
      </div>
      <div class="pload-orb"><div class="pload-ring spin"></div></div>
    </div>
    <div class="pload-bar"><div class="pload-fill" style="width:${pct}%"></div></div>
    <div class="pload-steps">${steps}</div>
  </div>`;
}

function fileMimeType(file) {
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  if (file.type) return file.type;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'application/octet-stream';
}

function importPrompt(file) {
  const mime = fileMimeType(file);
  const isPdf = mime === 'application/pdf';
  const sourceLabel = isPdf ? 'bankovního výpisu' : 'účtenky nebo screenshotu platby';
  return `Analyzuj obsah ${sourceLabel} a vrať POUZE JSON pole transakcí bez markdownu a bez vysvětlení.
Každý objekt musí mít přesně tato pole:
- datum: MM/DD/YYYY, pokud datum chybí tak použij dnešní datum
- popis: stručný název obchodníka nebo účelu platby
- castka: číslo bez měny a bez znaménka
- typ: "Výdaj" nebo "Příjem"
- kategorie: jedna z hodnot Bydlení, Jídlo, Doprava, Zábava, Zdraví, Investice, Ostatní, Příjem
- ucet: název účtu nebo banky pokud je známý, jinak "Import"
- metoda: "Karta", "Převod" nebo "Hotovost" pokud je známá, jinak ""
- protistrana: obchodník, firma nebo odesílatel/příjemce, pokud je známý
- poznamka: krátká poznámka nebo ""

Pravidla:
- Vrať samostatný objekt pro každou nalezenou transakci.
- Nevymýšlej transakce, které v dokumentu nejsou.
- Pokud je v bankovním výpisu zjevný odchozí pohyb, nastav typ na "Výdaj".
- Pokud je zjevný příchozí pohyb, nastav typ na "Příjem".
- Kategorii odhadni co nejrozumněji.
- U účtenky obvykle vrať jednu transakci, pokud z ní není jasně více plateb.

Příklad:
[{"datum":"03/15/2026","popis":"Albert","castka":840,"typ":"Výdaj","kategorie":"Jídlo","ucet":"mBank","metoda":"Karta","protistrana":"Albert","poznamka":""}]`;
}

function normalizeImpDate(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  const text = value.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.split(/[./-]/).map(s => s.trim());
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const [y,m,d] = parts;
      return `${y}-${String(parseInt(m)||1).padStart(2,'0')}-${String(parseInt(d)||1).padStart(2,'0')}`;
    }
    const [a,b,c] = parts;
    if (c.length === 4) {
      const first = parseInt(a)||1;
      const second = parseInt(b)||1;
      const month = first > 12 ? second : first;
      const day = first > 12 ? first : second;
      return `${c}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  }
  return new Date().toISOString().split('T')[0];
}

function sanitizeImpRows(rows) {
  const cats = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní','Příjem'];
  return (Array.isArray(rows) ? rows : []).map((r,idx) => {
    const amount = Math.abs(Number(r.castka)||0);
    const typ = r.typ === 'Příjem' ? 'Příjem' : 'Výdaj';
    const kat = cats.includes(r.kategorie) ? r.kategorie : (typ === 'Příjem' ? 'Příjem' : 'Ostatní');
    return {
      datum: normalizeImpDate(r.datum),
      popis: (r.popis || r.protistrana || `Import ${idx+1}`).toString().trim(),
      castka: amount,
      typ,
      kategorie: kat,
      ucet: (r.ucet||'Import').toString().trim() || 'Import',
      metoda: (r.metoda||'').toString().trim(),
      protistrana: (r.protistrana||'').toString().trim(),
      poznamka: (r.poznamka||'').toString().trim()
    };
  }).filter(r => r.popis && r.castka > 0);
}

async function procFile(file) {
  if (state._importBusy) return;
  if (!state.cfg.apiKey) {
    toast('Nejdřív v Nastavení zadej Gemini API klíč!', 'err');
    nav('settings', document.querySelectorAll('.ni')[6]);
    return;
  }

  const st = document.getElementById('impStatus'), rs = document.getElementById('impResults');
  setImportBusy(true);
  st.style.display = 'block'; rs.style.display = 'none';
  renderImportStatus(file.name, 'read', 'Načítám soubor a připravuju ho pro AI zpracování.');

  try {
    renderImportStatus(file.name, 'read', 'Převádím soubor do formátu pro odeslání.');
    const b64 = await toB64(file);
    const mime = fileMimeType(file);
    if (mime !== 'application/pdf' && !mime.startsWith('image/')) throw new Error('Podporuji jen PDF a obrázky účtenek');
    renderImportStatus(file.name, 'upload', 'Odesílám dokument modelu. U větších PDF to může trvat déle.');

    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + state.cfg.apiKey, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        contents: [{
          parts: [
            {text: importPrompt(file)},
            {inline_data: {mime_type: mime, data: b64}}
          ]
        }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    renderImportStatus(file.name, 'analyze', 'AI čte dokument a extrahuje návrh transakcí.');
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    renderImportStatus(file.name, 'prepare', 'Dokončuju kontrolu výsledku a skládám návrh do tabulky.');
    const txt = data.candidates[0].content.parts[0].text;
    const parsed = sanitizeImpRows(JSON.parse(txt));
    if (!parsed.length) throw new Error('AI nenašla žádné použitelné transakce');
    showImp(parsed, file.name); st.style.display = 'none';
  } catch(e) {
    st.innerHTML = `<div class="card" style="border-color:var(--red)"><p style="color:var(--red)">Chyba: ${e.message}</p></div>`;
  } finally {
    setImportBusy(false);
  }
}

function toB64(file) { return new Promise((res,rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = () => rej(new Error('Chyba čtení')); r.readAsDataURL(file); }); }

function showImp(rows, fname) {
  const rs = document.getElementById('impResults'); rs.style.display = 'block';
  const cats = ['Bydlení','Jídlo','Doprava','Zábava','Zdraví','Investice','Ostatní','Příjem'];
  const accounts = ['mBank','UniCredit','Trading 212','Hotovost','Import'];
  const methods = ['Karta','Převod','Hotovost',''];
  const trs = rows.map((r,i) => `<tr>
    <td><input id="id-${i}" type="date" value="${r.datum}" style="min-width:140px"/></td>
    <td>
      <input id="is-${i}" type="text" value="${r.popis}" placeholder="Popis" style="min-width:180px;margin-bottom:6px"/>
      <input id="ii-${i}" type="text" value="${r.protistrana||''}" placeholder="Protistrana" style="min-width:180px"/>
    </td>
    <td>
      <select id="it-${i}" class="sel" style="font-size:11px;padding:3px 6px;margin-bottom:6px"><option ${r.typ==='Výdaj'?'selected':''}>Výdaj</option><option ${r.typ==='Příjem'?'selected':''}>Příjem</option></select>
      <select id="ic-${i}" class="sel" style="font-size:11px;padding:3px 6px">${cats.map(c => `<option ${c===r.kategorie?'selected':''}>${c}</option>`).join('')}</select>
    </td>
    <td>
      <select id="ip-${i}" class="sel" style="font-size:11px;padding:3px 6px;margin-bottom:6px"><option>Martin</option><option>Šárka</option></select>
      <select id="ia-${i}" class="sel" style="font-size:11px;padding:3px 6px">${accounts.map(a => `<option ${a===r.ucet?'selected':''}>${a}</option>`).join('')}</select>
    </td>
    <td>
      <input id="im-${i}" type="number" min="0" step="0.01" value="${r.castka}" style="min-width:110px;margin-bottom:6px"/>
      <select id="ix-${i}" class="sel" style="font-size:11px;padding:3px 6px">${methods.map(m => `<option value="${m}" ${m===r.metoda?'selected':''}>${m||'Metoda neznámá'}</option>`).join('')}</select>
    </td>
  </tr>`).join('');
  rs.innerHTML = `<div class="card" style="padding:0"><div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><div style="font-size:14px;font-weight:600">Nalezeno ${rows.length} transakcí z ${fname}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btnp" onclick="confirmImp()">Uložit vše (${rows.length})</button><button class="btn" onclick="document.getElementById('impResults').style.display='none'">Zrušit</button></div></div><div class="tw"><table><thead><tr><th>Datum</th><th>Popis / protistrana</th><th>Typ / kategorie</th><th>Osoba / účet</th><th>Částka / metoda</th></tr></thead><tbody>${trs}</tbody></table></div></div>`;
  state._impRows = rows;
}

export async function confirmImp() {
  const rows = state._impRows || [];
  const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const datum = document.getElementById('id-'+i)?.value || r.datum;
    const popis = (document.getElementById('is-'+i)?.value || r.popis).trim();
    const proti = (document.getElementById('ii-'+i)?.value || r.protistrana || '').trim();
    const typ = document.getElementById('it-'+i)?.value || r.typ;
    const cat = document.getElementById('ic-'+i)?.value || r.kategorie;
    const prs = document.getElementById('ip-'+i)?.value || 'Martin';
    const ucet = document.getElementById('ia-'+i)?.value || r.ucet || 'Import';
    const metoda = document.getElementById('ix-'+i)?.value || r.metoda || '';
    const castka = Math.abs(parseFloat(document.getElementById('im-'+i)?.value || r.castka) || 0);
    if (!datum || !popis || !castka) continue;
    const [yp,mp,dp] = datum.split('-');
    const mesic = `${mn[parseInt(mp)]} ${yp}`;
    const sheetDate = `${parseInt(mp)}/${parseInt(dp)}/${yp}`;
    const sign = typ === 'Příjem' ? castka : -castka;
    const row = [sheetDate,popis,castka,'CZK',ucet,typ,cat,prs,metoda,proti,'',sign,mesic,yp,`${yp}${mp}${dp}-i${i}`,typ === 'Výdaj' ? castka : 0,typ === 'Príjem' ? castka : 0,sign];
    state.txs.push(parseRow(row)); try { await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ values: [row] }) }); } catch(e) {}
  }
  document.getElementById('impResults').style.display = 'none'; boot(); toast(rows.length+' transakcí importováno','ok');
}

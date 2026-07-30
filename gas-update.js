// ============================================================
// GOOGLE APPS SCRIPT — aktualizace pro podporu více listů
// ============================================================
// Tento kód nahradí stávající kód v tvém Google Apps Script projektu.
// Zpětně kompatibilní: pokud se nepošle parametr "sheet", použije se výchozí list.
//
// POSTUP:
// 1. Otevři https://script.google.com a najdi svůj Apps Script projekt
// 2. Nahraď celý obsah Code.gs tímto kódem
// 3. V Google Sheets vytvoř dva nové listy: "Investice" a "Ucty"
// 4. Do listu "Investice" přidej hlavičku (řádek 1):
//    id | nazev | ticker | typ | broker | datum_nakupu | pocet | nakupni_cena | mena | celkova_cena_czk | poznamka | aktivni | datum_prodeje | prodejni_cena_czk
// 5. Do listu "Ucty" přidej hlavičku (řádek 1):
//    nazev | typ | mena | zustatek | posledni_aktualizace
// 6. Klikni na "Deploy" → "New deployment" → Web app → Anyone → Deploy
// 7. Zkopíruj novou URL do js/config.js (GAS_URL)
// ============================================================

function doGet(e) {
  var sheetName = (e && e.parameter && e.parameter.sheet) || null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Pokud je zadaný konkrétní list
  if (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'List "' + sheetName + '" neexistuje' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var data = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify({ values: data }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Výchozí chování — vrátit první list (transakce)
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  return ContentService.createTextOutput(JSON.stringify({ values: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // ── RECEIPT UPLOAD ──
    if (body.action === 'uploadReceipt') {
      return handleReceiptUpload(body);
    }

    // ── DELETE ROW ──
    if (body.action === 'deleteRow') {
      return handleDeleteRow(body);
    }

    // ── REMOVE RECEIPT ──
    if (body.action === 'removeReceipt') {
      return handleRemoveReceipt(body);
    }

    // ── MARK MBANK IMPORTED ──
    if (body.action === 'markMbankImported') {
      return handleMarkMbankImported(body);
    }

    // ── GET DRIVE FILE (base64) ──
    if (body.action === 'getDriveFile') {
      return handleGetDriveFile(body);
    }

    // ── MARK PAYSLIP IMPORTED ──
    if (body.action === 'markPayslipImported') {
      return handleMarkPayslipImported(body);
    }

    // ── UPSERT FUND (merge dle ISIN, list Fondy) ──
    if (body.action === 'upsertFund') {
      return handleUpsertFund(body);
    }

    // ── REFRESH NAV (scrape aktuálních kurzů z webů fondů) ──
    if (body.action === 'refreshNav') {
      return refreshNav();
    }

    // ── REFRESH TRADING 212 (čtení pozic + hotovosti přes T212 API, read-only) ──
    if (body.action === 'refreshT212') {
      return refreshT212();
    }

    var sheetName = body.sheet || null;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet;

    if (sheetName) {
      sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        // Automaticky vytvoří list pokud neexistuje
        sheet = ss.insertSheet(sheetName);
      }
    } else {
      // Výchozí — první list (transakce)
      sheet = ss.getSheets()[0];
    }

    var values = body.values;
    if (values && values.length > 0) {
      for (var i = 0; i < values.length; i++) {
        sheet.appendRow(values[i]);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── REMOVE RECEIPT URL FROM TRANSACTION ──
function handleRemoveReceipt(body) {
  try {
    var txId = body.txId;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Transakce') || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][14] === txId) {
        sheet.getRange(i + 1, 19).setValue(''); // sloupec S = uctenka URL
        return ContentService.createTextOutput(JSON.stringify({ success: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ error: 'Transakce nenalezena' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── DELETE ROW BY TX ID ──
function handleDeleteRow(body) {
  try {
    var sheetName = body.sheet || 'Transakce';
    var txId = body.txId;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    // Transakce: ID at column O (index 14); Recurring: ID at column A (index 0)
    var idCol = (sheetName === 'Recurring') ? 0 : 14;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idCol] === txId) {
        sheet.deleteRow(i + 1);
        return ContentService.createTextOutput(JSON.stringify({ success: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ error: 'Řádek nenalezen' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── RECEIPT UPLOAD TO GOOGLE DRIVE ──
function handleReceiptUpload(body) {
  try {
    var txId = body.txId;
    var fileName = body.fileName || 'uctenka';
    var mimeType = body.mimeType || 'image/jpeg';
    var data = body.data; // base64

    // Najdi nebo vytvoř složku Finance-Uctenky
    var folders = DriveApp.getFoldersByName('Finance-Uctenky');
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('Finance-Uctenky');
    }

    // Dekóduj base64 a ulož soubor
    var blob = Utilities.newBlob(Utilities.base64Decode(data), mimeType, txId + '_' + fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var url = file.getUrl();

    // Zapsat URL do sloupce P (index 15, 1-based = 16) v listu Transakce
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Transakce') || ss.getSheets()[0];
    var dataRange = sheet.getDataRange().getValues();
    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][14] === txId) { // sloupec O (index 14) = ID
        sheet.getRange(i + 1, 19).setValue(url); // sloupec S = uctenka URL
        break;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, url: url }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── MARK MBANK IMPORT AS DONE ──
function handleMarkMbankImported(body) {
  try {
    var filename = body.filename;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('MbankImport');
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] === filename && data[i][4] === 'new') {
        sheet.getRange(i + 1, 5).setValue('imported');
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── GET DRIVE FILE AS BASE64 (pro import výplatní pásky bez CORS) ──
function handleGetDriveFile(body) {
  try {
    var file = DriveApp.getFileById(body.fileId);
    var blob = file.getBlob();
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      name: file.getName(),
      data: Utilities.base64Encode(blob.getBytes())
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── MARK PAYSLIP IMPORT AS DONE ──
function handleMarkPayslipImported(body) {
  try {
    var filename = body.filename;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('MzdyImport');
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] === filename && data[i][4] === 'new') {
        sheet.getRange(i + 1, 5).setValue('imported');
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Hlavička listu "Fondy" — musí odpovídat FOND v js/config.js. `pplNative`/
// `fxPplNative` (17., 18. sloupec) jsou nové kvůli Trading 212 — u CODYA/CONSEQ
// zůstávají prázdné.
var FOND_HEADER = ['provider','isin','nazev','mena','pocetCP','nakupNAV','nakupDatum','investovanoCZK','aktualNAV','aktualNAVdatum','aktualHodnotaCZK','poplatek','kurzEUR','hotovostCZK','poznamka','pplNative','fxPplNative'];

// Rozšíří hlavičku existujícího listu Fondy o nové sloupce, pokud tam ještě
// nejsou (list vznikl před Trading 212 integrací) — nedestruktivní.
function ensureFondyHeader(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < FOND_HEADER.length) {
    sheet.getRange(1, lastCol + 1, 1, FOND_HEADER.length - lastCol).setValues([FOND_HEADER.slice(lastCol)]);
  }
}

// Upsert řádků do listu dle ISIN (sloupec B/index 1). Prázdné buňky ('' nebo
// null) NEPŘEPISUJÍ existující hodnotu → dvě CODYA PDF (majetkový výpis +
// transakce), nebo opakovaný T212 refresh, se sloučí do jednoho řádku fondu.
function upsertFundRows(sheet, rows) {
  var ISIN_COL = 1;
  var data = sheet.getDataRange().getValues();
  for (var r = 0; r < rows.length; r++) {
    var incoming = rows[r];
    var isin = incoming[ISIN_COL];
    if (!isin) continue;
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][ISIN_COL] === isin) { foundRow = i; break; }
    }
    if (foundRow === -1) {
      sheet.appendRow(incoming);
      data.push(incoming);
    } else {
      var existing = data[foundRow];
      for (var c = 0; c < incoming.length; c++) {
        var v = incoming[c];
        if (v !== '' && v !== null && v !== undefined) existing[c] = v;
      }
      sheet.getRange(foundRow + 1, 1, 1, existing.length).setValues([existing]);
    }
  }
}

// ── UPSERT FUND (list Fondy, klíč = ISIN) — akce z appky (PDF import) ──
function handleUpsertFund(body) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) { sheet = ss.insertSheet('Fondy'); sheet.appendRow(FOND_HEADER); }
    ensureFondyHeader(sheet);
    upsertFundRows(sheet, body.values || []);
    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// ── TRADING 212: čtení pozic + hotovosti přes veřejné (read-only) API ──
// Klíč + secret se čtou ze Script Properties (script.google.com → Project
// Settings → Script Properties → T212_API_KEY, T212_API_SECRET) — NIKDY
// v appce/kódu (repo je veřejné, appka běží v prohlížeči). Musí mít jen
// scopes "Portfolio" + "Account data" (čtení) — bez orders/pies, appka
// nepotřebuje obchodovat. Nový typ klíče vyžaduje HTTP Basic auth
// (base64 klíč:secret) — starší "jen klíč v Authorization" formát u něj
// vrací 401.
var T212_BASE = 'https://live.trading212.com/api/v0/equity';

function refreshT212() {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('T212_API_KEY');
    var secret = props.getProperty('T212_API_SECRET');
    if (!key) return jsonOut({ error: 'T212_API_KEY není nastaven ve Script Properties.' });
    if (!secret) return jsonOut({ error: 'T212_API_SECRET není nastaven ve Script Properties (nový typ klíče v T212 appce vydává API Key + API Secret Key společně — je potřeba obojí).' });
    // Nový T212 klíč (API Key + API Secret Key) se autentizuje HTTP Basic
    // auth: Authorization: Basic base64(apiKey:apiSecret). Starší "jen
    // klíč" formát (Authorization: <key>) u tohoto typu klíče nefunguje.
    var authHeader = 'Basic ' + Utilities.base64Encode(key + ':' + secret);

    var info = t212Fetch('/account/info', authHeader);
    if (info.err) return jsonOut({ error: 'T212 account/info: ' + info.err });
    var cash = t212Fetch('/account/cash', authHeader);
    if (cash.err) return jsonOut({ error: 'T212 account/cash: ' + cash.err });
    var portfolio = t212Fetch('/portfolio', authHeader);
    if (portfolio.err) return jsonOut({ error: 'T212 portfolio: ' + portfolio.err });
    // Metadata (jméno + SKUTEČNÁ měna nástroje) — volitelné, ne kritické.
    // Pozice bez ní zůstanou jen s tickerem a bez CZK hodnoty (bezpečný
    // fallback), pokud klíč nemá scope "Metadata" nebo endpoint selže.
    var meta = t212Fetch('/metadata/instruments', authHeader);
    var instrByTicker = {};
    var metaOk = !meta.err && Object.prototype.toString.call(meta.data) === '[object Array]';
    if (metaOk) {
      for (var mi = 0; mi < meta.data.length; mi++) {
        if (meta.data[mi] && meta.data[mi].ticker) instrByTicker[meta.data[mi].ticker] = meta.data[mi];
      }
    }

    var currency = (info.data && info.data.currencyCode) || 'EUR';
    var rateCache = {};
    rateCache[currency] = 1;
    if (currency !== 'CZK') {
      var acctRateR = fetchCnbRate(currency);
      if (!acctRateR.v) return jsonOut({ error: 'Kurz ' + currency + '/CZK (ČNB) nenalezen: ' + (acctRateR.err || '') });
      rateCache[currency] = acctRateR.v;
    }
    rateCache['CZK'] = 1;
    var rate = rateCache[currency]; // kurz měny ÚČTU/CZK — pro ppl/fxPpl (ty T212 počítá v měně účtu)
    function rateFor(code) {
      if (rateCache[code] != null) return rateCache[code];
      var r = fetchCnbRate(code);
      rateCache[code] = r.v || null;
      return rateCache[code];
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) { sheet = ss.insertSheet('Fondy'); sheet.appendRow(FOND_HEADER); }
    ensureFondyHeader(sheet);

    // Přesný čas refreshe (ne jen datum) — ceny jsou volatilní, uživatel
    // potřebuje vědět, jak stará je tahle snímka, ne jen "dnes".
    var nowStamp = Utilities.formatDate(new Date(), 'Europe/Prague', 'd.M.yyyy HH:mm');
    var rows = [];
    var c = cash.data || {};
    var unresolved = 0;

    // Pozice — pro každou dohledáme SKUTEČNOU měnu nástroje v metadatech
    // (ne měnu účtu!) a tou přepočteme hodnotu do CZK. Bez metadat necháváme
    // hodnotu prázdnou (raději chybějící číslo než špatná měna). ppl/fxPpl
    // jsou od T212 už v měně účtu → převádí se kurzem účtu (rate) výše.
    var positions = portfolio.data || [];
    var posInvestedCzk = 0, posValueCzk = 0;
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      if (!p.ticker) continue;
      var instr = instrByTicker[p.ticker];
      var instrCcy = instr && instr.currencyCode;
      var instrRate = instrCcy ? rateFor(instrCcy) : null;
      var investCzk = instrRate != null ? Math.round(p.quantity * p.averagePrice * instrRate) : '';
      var curCzk = instrRate != null ? Math.round(p.quantity * p.currentPrice * instrRate) : '';
      if (investCzk === '') unresolved++;
      else { posInvestedCzk += investCzk; posValueCzk += curCzk; }
      rows.push(fondRow({
        provider: 'T212', isin: p.ticker, nazev: (instr && (instr.name || instr.shortname)) || p.ticker,
        mena: instrCcy || currency,
        pocetCP: p.quantity, nakupNAV: p.averagePrice, nakupDatum: t212DateToCz(p.initialFillDate),
        investovanoCZK: investCzk,
        aktualNAV: p.currentPrice, aktualNAVdatum: nowStamp,
        aktualHodnotaCZK: curCzk,
        kurzEUR: instrRate != null ? instrRate : rate, pplNative: p.ppl, fxPplNative: p.fxPpl
      }));
    }

    // Souhrnný řádek — hotovost + celkový ppl z /account/cash (autoritativní,
    // T212 vlastní číslo). Investováno/hodnota se NEČTOU odsud, ale sečtou
    // z pozic výše (teď máme spolehlivou měnu nástroje) — jinak by se
    // portfolio počítalo dvakrát (jednou tady, jednou per pozice).
    rows.push(fondRow({
      provider: 'T212', isin: 'T212_CASH', nazev: 'Trading 212 — souhrn účtu', mena: currency,
      aktualNAVdatum: nowStamp,
      kurzEUR: rate, hotovostCZK: Math.round((c.free || 0) * rate),
      poznamka: 'ppl ' + Math.round(c.ppl || 0) + ' ' + currency + (unresolved ? (' · ' + unresolved + ' pozic bez metadat') : ''),
      pplNative: c.ppl, fxPplNative: ''
    }));

    upsertFundRows(sheet, rows);
    return jsonOut({ success: true, updated: rows.length, currency: currency, rate: rate, metaOk: metaOk, unresolved: unresolved });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function t212Fetch(path, key) {
  try {
    var resp = UrlFetchApp.fetch(T212_BASE + path, { muteHttpExceptions: true, headers: { 'Authorization': key } });
    var code = resp.getResponseCode();
    if (code !== 200) return { err: 'HTTP ' + code + ' — ' + resp.getContentText().slice(0, 200) };
    return { data: JSON.parse(resp.getContentText()) };
  } catch (e) { return { err: e.message }; }
}

function t212DateToCz(iso) {
  if (!iso) return '';
  try { return Utilities.formatDate(new Date(iso), 'Europe/Prague', 'd.M.yyyy'); } catch (e) { return ''; }
}

// Řádek pole dle FOND_HEADER — chybějící pole zůstanou '' (upsert je nepřepíše).
function fondRow(o) {
  var r = new Array(FOND_HEADER.length).fill('');
  r[0] = o.provider || ''; r[1] = o.isin || ''; r[2] = o.nazev || ''; r[3] = o.mena || '';
  r[4] = o.pocetCP != null ? o.pocetCP : ''; r[5] = o.nakupNAV != null ? o.nakupNAV : ''; r[6] = o.nakupDatum || '';
  r[7] = o.investovanoCZK != null ? o.investovanoCZK : ''; r[8] = o.aktualNAV != null ? o.aktualNAV : ''; r[9] = o.aktualNAVdatum || '';
  r[10] = o.aktualHodnotaCZK != null ? o.aktualHodnotaCZK : ''; r[11] = o.poplatek != null ? o.poplatek : '';
  r[12] = o.kurzEUR != null ? o.kurzEUR : ''; r[13] = o.hotovostCZK != null ? o.hotovostCZK : ''; r[14] = o.poznamka || '';
  r[15] = o.pplNative != null ? o.pplNative : ''; r[16] = o.fxPplNative != null ? o.fxPplNative : '';
  return r;
}

// ── REFRESH NAV: scrape aktuálních kurzů fondů z webů CODYA/CONSEQ ──
// Voláno z appky (action:'refreshNav') NEBO jako time-trigger (týdně).
// Fondy se oceňují měsíčně; scrape drží aktuální NAV bez ručního re-importu.
// Sloupce listu Fondy musí odpovídat FOND v js/config.js.
var FOND_C = { isin: 1, mena: 3, pocetCP: 4, aktualNAV: 8, aktualNAVdatum: 9, aktualHodnotaCZK: 10, kurzEUR: 12 };

// CODYA nemá jednotný popisek napříč fondy — obchodované třídy mají
// "Aktuální kurz/hodnota …", třídy v úpisu "Zahájeno/Zahájení upisovací(ho)
// období". Kotvy jsou ZKRÁCENÉ (bez "investiční akcie"), protože na některé
// stránce je to slovo s překlepem ("investíční" u Axelor E) → shoda by
// selhala. Zkouší se v pořadí, první nalezená vyhrává. Ověřeno 2026-07-25.
var CODYA_ANCHORS = ['Aktuální kurz', 'Aktuální hodnota',
  'Zahájeno upisovací období', 'Zahájení upisovacího období', 'Zahájení upisovací období'];

// ISIN → veřejná stránka fondu + textová kotva/kotvy NAV.
var NAV_SOURCES = {
  'CZ0008042892': { url: 'https://www.codyainvest.cz/nase-fondy/zdr-sicav-a-s-trida-a', anchor: CODYA_ANCHORS },
  'CZ0008045333': { url: 'https://www.codyainvest.cz/nase-fondy/ambeat-ii-realitni-podfond-trida-a', anchor: CODYA_ANCHORS },
  'CZ0008051224': { url: 'https://www.codyainvest.cz/nase-fondy/axelor-fund-watt-build-podfond-trida-a', anchor: CODYA_ANCHORS },
  'CZ0008051711': { url: 'https://www.codyainvest.cz/nase-fondy/axelor-fund-watt-build-podfond-trida-e', anchor: CODYA_ANCHORS },
  'CZ1005201499': { url: 'https://www.codyainvest.cz/nase-fondy/direct-pro-sicav-investicni-fond-a-s-direct-pro-podfond-trida-r', anchor: CODYA_ANCHORS },
  'CZ1005201655': { url: 'https://www.codyainvest.cz/nase-fondy/direct-pro-sicav-investicni-fond-a-s-direct-pro-podfond-trida-e', anchor: CODYA_ANCHORS },
  'CZ1005202968': { url: 'https://www.codyainvest.cz/nase-fondy/fidurock-retail-parks-fund-trida-pia-a', anchor: CODYA_ANCHORS },
  'CZ1005100618': { url: 'https://www.conseq.cz/investice/prehled-fondu/conseq-panattoni-logistics-developement-1-czk', anchor: 'Cena za kus' }
};

function refreshNav() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) return jsonOut({ error: 'List Fondy neexistuje — nejdřív naimportuj výpis.' });
    var data = sheet.getDataRange().getValues();
    var eurR = fetchCnbEur(); // { v, err }
    var eur = eurR.v;
    var updated = 0, log = [], failed = [];
    if (!eur) log.push('ČNB EUR: ' + (eurR.err || 'nenačteno'));
    for (var i = 1; i < data.length; i++) {
      var isin = String(data[i][FOND_C.isin] || '');
      var src = NAV_SOURCES[isin];
      if (!src) continue;
      var res = scrapeNav(src.url, src.anchor);
      if (!res || !res.nav) { log.push(isin + ': ' + ((res && res.err) || 'nenačteno')); failed.push(isin); continue; }
      data[i][FOND_C.aktualNAV] = res.nav;
      if (res.datum) data[i][FOND_C.aktualNAVdatum] = res.datum;
      var mena = data[i][FOND_C.mena];
      var kurz = (mena === 'EUR') ? (eur || numCz(data[i][FOND_C.kurzEUR]) || 25) : 1;
      if (mena === 'EUR' && eur) data[i][FOND_C.kurzEUR] = eur;
      var pocet = numCz(data[i][FOND_C.pocetCP]);
      data[i][FOND_C.aktualHodnotaCZK] = Math.round(pocet * res.nav * kurz);
      updated++;
      log.push(isin + ': ' + res.nav + (res.datum ? ' (' + res.datum + ')' : ''));
    }
    sheet.getDataRange().setValues(data);

    // S&P 500 + USD/CZK z Yahoo (jednou, sdíleno pro summary i historii)
    var sp = fetchYahoo('%5EGSPC');       // ^GSPC
    var fx = fetchYahoo('USDCZK%3DX');    // USDCZK=X
    // Summary karta → list Trh (per provider, i v CZK přes USD/CZK)
    var market = updateMarket(ss, data, sp, fx);
    if (!market.ok) { failed.push('S&P500'); log.push(market.err || 'S&P: nenačteno'); }
    // Historie → listy TrhHist (denní S&P+FX) a FondyHist (řídké body fondů)
    var hist = updateHistory(ss, data, sp, fx);
    if (!hist.ok) log.push(hist.err || 'historie: nezapsána');

    // Upozornění e-mailem když scrape selže (funguje hlavně pro týdenní trigger;
    // při ručním volání z appky se stav vrací i v JSON logu).
    if (failed.length) sendNavAlert(failed, log);

    return jsonOut({ success: true, updated: updated, eur: eur, failed: failed, log: log });
  } catch (err) {
    try { sendNavAlert(['VÝJIMKA'], [err.message]); } catch (e2) {}
    return jsonOut({ error: err.message });
  }
}

// Summary karta → list "Trh" per provider. Sloupce:
// [provider, startDate, spStart, spCurrent, spCurrentDate, spStartCzk, spCurrentCzk]
// CZK verze = S&P (USD) × USD/CZK k danému datu → devizově korigované srovnání.
function updateMarket(ss, fondyData, sp, fx) {
  try {
    if (!sp || !sp.pairs) return { ok: false, err: 'S&P: ' + ((sp && sp.err) || 'nenačteno') };
    var byProv = {};
    for (var i = 1; i < fondyData.length; i++) {
      var prov = fondyData[i][0]; // FOND.provider = 0
      var d = parseCzDate(fondyData[i][6]); // FOND.nakupDatum = 6
      if (!prov || !d) continue;
      if (!byProv[prov] || d < byProv[prov]) byProv[prov] = d;
    }
    var sheet = ss.getSheetByName('Trh');
    if (!sheet) sheet = ss.insertSheet('Trh');
    sheet.clear();
    sheet.appendRow(['provider', 'startDate', 'spStart', 'spCurrent', 'spCurrentDate', 'spStartCzk', 'spCurrentCzk']);
    var curDate = Utilities.formatDate(sp.currentDate, 'Europe/Prague', 'd.M.yyyy');
    var fxCur = (fx && fx.pairs) ? fx.current : null;
    for (var prov in byProv) {
      var start = byProv[prov];
      var spStart = closeOnOrBefore(sp, start);
      var fxStart = (fx && fx.pairs) ? closeOnOrBefore(fx, start) : null;
      var spStartCzk = (spStart && fxStart) ? Math.round(spStart * fxStart) : '';
      var spCurCzk = (fxCur) ? Math.round(sp.current * fxCur) : '';
      sheet.appendRow([prov, Utilities.formatDate(start, 'Europe/Prague', 'd.M.yyyy'),
        spStart || '', sp.current, curDate, spStartCzk, spCurCzk]);
    }
    return { ok: true };
  } catch (e) { return { ok: false, err: 'S&P zápis: ' + e.message }; }
}

// Historie: TrhHist (denní S&P+FX, přepisuje se) + FondyHist (řídké body
// fondů, append+dedup). Umožní graf vývoje rebasovaný na 100 v CZK.
function updateHistory(ss, fondyData, sp, fx) {
  try {
    // --- TrhHist: plná denní řada S&P + USD/CZK + S&P v CZK (přepis) ---
    if (sp && sp.pairs) {
      var th = ss.getSheetByName('TrhHist');
      if (!th) th = ss.insertSheet('TrhHist');
      th.clear();
      var rows = [['datum', 'spClose', 'usdCzk', 'spCzk']];
      for (var i = 0; i < sp.pairs.length; i++) {
        var d = sp.pairs[i].t;
        var iso = Utilities.formatDate(d, 'Europe/Prague', 'yyyy-MM-dd');
        var usd = (fx && fx.pairs) ? closeOnOrBefore(fx, d) : null;
        rows.push([iso, sp.pairs[i].c, usd || '', usd ? Math.round(sp.pairs[i].c * usd) : '']);
      }
      th.getRange(1, 1, rows.length, 4).setValues(rows);
    }

    // --- FondyHist: řídké body fondů (nákupní kotva + bod k datu platnosti NAV) ---
    // Bod se ukládá k DATU PLATNOSTI NAV (měsíční přecenění), ne k dnešku —
    // fondy se oceňují měsíčně, takže série tak přirozeně roste měsíc po měsíci
    // se správnými daty. Dedup je odolný vůči tomu, že Sheets datum převede na Date.
    var fh = ss.getSheetByName('FondyHist');
    if (!fh) { fh = ss.insertSheet('FondyHist'); fh.appendRow(['datum', 'isin', 'provider', 'nav', 'hodnotaCZK']); }
    var existing = {};
    var have = fh.getDataRange().getValues();
    for (var r = 1; r < have.length; r++) existing[have[r][1] + '|' + histIso(have[r][0])] = true; // isin|datum
    var todayIso = Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
    var append = [];
    for (var k = 1; k < fondyData.length; k++) {
      var row = fondyData[k];
      var isin = row[FOND_C.isin]; if (!isin) continue;
      var prov2 = row[0];
      // nákupní kotva (jednorázově)
      var pd = parseCzDate(row[6]); // nakupDatum
      if (pd) {
        var pIso = Utilities.formatDate(pd, 'Europe/Prague', 'yyyy-MM-dd');
        if (!existing[isin + '|' + pIso]) { append.push([pIso, isin, prov2, numCz(row[5]), numCz(row[7])]); existing[isin + '|' + pIso] = true; }
      }
      // bod k datu platnosti aktuálního NAV (fallback: dnešek)
      var nd = parseCzDate(row[FOND_C.aktualNAVdatum]);
      var snapIso = nd ? Utilities.formatDate(nd, 'Europe/Prague', 'yyyy-MM-dd') : todayIso;
      if (!existing[isin + '|' + snapIso] && numCz(row[FOND_C.aktualNAV])) {
        append.push([snapIso, isin, prov2, numCz(row[FOND_C.aktualNAV]), numCz(row[FOND_C.aktualHodnotaCZK])]);
        existing[isin + '|' + snapIso] = true;
      }
    }
    if (append.length) fh.getRange(fh.getLastRow() + 1, 1, append.length, 5).setValues(append);
    return { ok: true };
  } catch (e) { return { ok: false, err: 'historie: ' + e.message }; }
}

// Obecný fetch denní řady z Yahoo Finance (symbol už URL-enkódovaný).
function fetchYahoo(symbol) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?range=1y&interval=1d';
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    var code = resp.getResponseCode();
    if (code !== 200) return { err: 'HTTP ' + code };
    var j = JSON.parse(resp.getContentText());
    var r = j.chart.result[0];
    var ts = r.timestamp, cl = r.indicators.quote[0].close;
    var pairs = [];
    for (var i = 0; i < ts.length; i++) if (cl[i] != null) pairs.push({ t: new Date(ts[i] * 1000), c: cl[i] });
    if (!pairs.length) return { err: 'prázdná data' };
    var current = r.meta && r.meta.regularMarketPrice ? r.meta.regularMarketPrice : pairs[pairs.length - 1].c;
    return { pairs: pairs, current: current, currentDate: pairs[pairs.length - 1].t };
  } catch (e) { return { err: e.message }; }
}

// close k datu (poslední bod na/před daným datem)
function closeOnOrBefore(series, date) {
  var best = null;
  for (var i = 0; i < series.pairs.length; i++) {
    if (series.pairs[i].t <= date) best = series.pairs[i].c; else break;
  }
  return best;
}

// "26.2.2026" → Date
function parseCzDate(s) {
  var m = String(s).match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  return m ? new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) : null;
}

// Normalizace libovolného datumu (Date z coerce, ISO, D.M.YYYY) na "yyyy-MM-dd"
// pro spolehlivý dedup ve FondyHist (Sheets si textové datum převede na Date).
function histIso(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Prague', 'yyyy-MM-dd');
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.indexOf('T') > 0) { try { return Utilities.formatDate(new Date(s), 'Europe/Prague', 'yyyy-MM-dd'); } catch (e) {} }
  var m = s.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

// Upozornění na selhání scrapu (jen když umíme zjistit adresu — bez PII v repu)
function sendNavAlert(failed, log) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return; // ruční volání z web appky nemá uživatele → přeskočit (stav je v JSON)
    MailApp.sendEmail(to, 'Finance App: aktualizace kurzů selhala',
      'Nepodařilo se načíst: ' + failed.join(', ') + '\n\nLog:\n' + log.join('\n') +
      '\n\nZkontroluj, jestli nezměnily web CODYA/CONSEQ (parser v NAV_SOURCES).');
  } catch (e) {}
}

// Stáhne stránku fondu, odstraní HTML tagy a najde NAV (4 desetinná místa)
// za textovou kotvou + datum platnosti. `anchor` může být string nebo pole
// kotev zkoušených v pořadí (CODYA nemá jednotný popisek napříč fondy).
// Vrací {nav, datum, err} — err nese důvod selhání pro diagnostiku.
function scrapeNav(url, anchor) {
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html', 'Accept-Language': 'cs,en' } });
    var code = resp.getResponseCode();
    if (code !== 200) return { nav: null, err: 'HTTP ' + code };
    var html = resp.getContentText();
    var text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    var anchors = Array.isArray(anchor) ? anchor : (anchor ? [anchor] : ['']);
    for (var a = 0; a < anchors.length; a++) {
      var start = anchors[a] ? text.indexOf(anchors[a]) : 0;
      if (start < 0) continue;
      var scope = text.substring(start, start + 400); // hledej hned za kotvou
      // NAV = X,XXXX — preferuj číslo navázané na měnu (přesnější), jinak první
      var navM = scope.match(/(\d{1,3},\d{4})\s*(?:CZK|EUR)/) || scope.match(/(\d{1,3},\d{4})/);
      var nav = navM ? parseFloat(navM[1].replace(',', '.')) : null;
      if (nav !== null && (nav <= 0.1 || nav >= 1000)) nav = null; // sanity
      if (nav === null) continue;
      var dm = scope.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
      var datum = dm ? (parseInt(dm[1]) + '.' + parseInt(dm[2]) + '.' + dm[3]) : '';
      return { nav: nav, datum: datum };
    }
    return { nav: null, err: 'žádná kotva nenalezena (' + anchors.length + ' zkoušeno)' };
  } catch (e) { return { nav: null, err: e.message }; }
}

// Kurz libovolné měny/CZK z oficiálního denního kurzu ČNB (textový feed,
// bez CORS/klíče). Vrací { v, err } — v = kurz za 1 jednotku dané měny.
function fetchCnbRate(code) {
  try {
    var resp = UrlFetchApp.fetch('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt',
      { muteHttpExceptions: true });
    var respCode = resp.getResponseCode();
    if (respCode !== 200) return { v: null, err: 'HTTP ' + respCode };
    var lines = resp.getContentText().split('\n');
    for (var i = 0; i < lines.length; i++) {
      var p = lines[i].split('|'); // země|měna|množství|kód|kurz
      if (p.length >= 5 && p[3] === code) {
        var amount = numCz(p[2]) || 1;
        return { v: numCz(p[4]) / amount, err: null };
      }
    }
    return { v: null, err: code + ' řádek nenalezen' };
  } catch (e) { return { v: null, err: e.message }; }
}
// EUR/CZK — zpětně kompatibilní wrapper (refreshNav volá jen EUR).
function fetchCnbEur() { return fetchCnbRate('EUR'); }

function numCz(v) { var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ── GMAIL → DRIVE → SHEET: VÝPLATNÍ PÁSKY ──
// Spusť ručně nebo nastav time-trigger: Triggers → checkPayslipEmail → Time-driven → Day timer
function checkPayslipEmail() {
  var threads = GmailApp.search('from:harnol.cz has:attachment newer_than:35d', 0, 10);
  if (!threads.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('MzdyImport');
  if (!sheet) {
    sheet = ss.insertSheet('MzdyImport');
    sheet.appendRow(['datum_detekce', 'soubor', 'file_id', 'datum_emailu', 'status']);
  }

  // Dedup dle názvu souboru
  var existing = {};
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) {
    existing[rows[r][1]] = true;
  }

  // Najdi nebo vytvoř složku Finance-Vyplaty (privátní — bez sdílení)
  var folders = DriveApp.getFoldersByName('Finance-Vyplaty');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Finance-Vyplaty');

  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      msg.getAttachments().forEach(function(att) {
        if (att.getContentType() !== 'application/pdf') return;
        var name = att.getName();
        if (existing[name]) return;

        var file = folder.createFile(att); // záměrně BEZ setSharing — čte ho jen GAS

        sheet.appendRow([
          new Date(),      // datum_detekce
          name,            // soubor
          file.getId(),    // file_id (pro akci getDriveFile)
          msg.getDate(),   // datum_emailu
          'new'            // status
        ]);
        existing[name] = true;
      });
    });
  });
}

// ── GMAIL → DRIVE → SHEET NOTIFICATION ──
// Spusť ručně nebo nastav time-trigger: Triggers → checkMbankEmail → Time-driven → Month timer
function checkMbankEmail() {
  var threads = GmailApp.search('from:wyciag@mbank.pl OR from:kontakt@mbank.cz newer_than:35d has:attachment', 0, 10);
  if (!threads.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('MbankImport');
  if (!sheet) {
    sheet = ss.insertSheet('MbankImport');
    sheet.appendRow(['datum_detekce', 'soubor', 'drive_url', 'datum_emailu', 'status']);
  }

  // Získej existující soubory (aby se nepřidávaly duplicity)
  var existing = {};
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) {
    existing[rows[r][1]] = true;
  }

  // Najdi nebo vytvoř složku Finance-Vypisy
  var folders = DriveApp.getFoldersByName('Finance-Vypisy');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Finance-Vypisy');

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(msg) {
      var attachments = msg.getAttachments();
      attachments.forEach(function(att) {
        if (att.getContentType() !== 'application/pdf') return;
        var name = att.getName();
        if (existing[name]) return; // už bylo zpracováno

        var file = folder.createFile(att);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        sheet.appendRow([
          new Date(),      // datum_detekce
          name,            // soubor
          file.getUrl(),   // drive_url
          msg.getDate(),   // datum_emailu
          'new'            // status
        ]);
        existing[name] = true;
      });
    });
  });
}

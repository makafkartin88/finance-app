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

// ── UPSERT FUND (list Fondy, klíč = ISIN, sloupec B/index 1) ──
// body.values = pole řádků; každý řádek se sloučí do existujícího dle ISIN.
// Prázdné buňky ('' nebo null) NEPŘEPISUJÍ existující hodnotu → dvě CODYA PDF
// (majetkový výpis + transakce) se sloučí do jednoho řádku fondu.
function handleUpsertFund(body) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) {
      sheet = ss.insertSheet('Fondy');
      sheet.appendRow(['provider','isin','nazev','mena','pocetCP','nakupNAV','nakupDatum','investovanoCZK','aktualNAV','aktualNAVdatum','aktualHodnotaCZK','poplatek','kurzEUR','hotovostCZK','poznamka']);
    }
    var ISIN_COL = 1; // index sloupce isin
    var data = sheet.getDataRange().getValues();
    var rows = body.values || [];
    for (var r = 0; r < rows.length; r++) {
      var incoming = rows[r];
      var isin = incoming[ISIN_COL];
      if (!isin) continue;
      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (data[i][ISIN_COL] === isin) { foundRow = i; break; }
      }
      if (foundRow === -1) {
        // nový fond → append
        sheet.appendRow(incoming);
        data.push(incoming);
      } else {
        // merge: přepiš jen neprázdná příchozí pole
        var existing = data[foundRow];
        for (var c = 0; c < incoming.length; c++) {
          var v = incoming[c];
          if (v !== '' && v !== null && v !== undefined) existing[c] = v;
        }
        sheet.getRange(foundRow + 1, 1, 1, existing.length).setValues([existing]);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── REFRESH NAV: scrape aktuálních kurzů fondů z webů CODYA/CONSEQ ──
// Voláno z appky (action:'refreshNav') NEBO jako time-trigger (týdně).
// Fondy se oceňují měsíčně; scrape drží aktuální NAV bez ručního re-importu.
// Sloupce listu Fondy musí odpovídat FOND v js/config.js.
var FOND_C = { isin: 1, mena: 3, pocetCP: 4, aktualNAV: 8, aktualNAVdatum: 9, aktualHodnotaCZK: 10, kurzEUR: 12 };

// ISIN → veřejná stránka fondu + textová kotva NAV. Ověřeno 2026-07-23.
var NAV_SOURCES = {
  'CZ0008042892': { url: 'https://www.codyainvest.cz/nase-fondy/zdr-sicav-a-s-trida-a', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ0008045333': { url: 'https://www.codyainvest.cz/nase-fondy/ambeat-ii-realitni-podfond-trida-a', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ0008051224': { url: 'https://www.codyainvest.cz/nase-fondy/axelor-fund-watt-build-podfond-trida-a', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ0008051711': { url: 'https://www.codyainvest.cz/nase-fondy/axelor-fund-watt-build-podfond-trida-e', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ1005201499': { url: 'https://www.codyainvest.cz/nase-fondy/direct-pro-sicav-investicni-fond-a-s-direct-pro-podfond-trida-r', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ1005201655': { url: 'https://www.codyainvest.cz/nase-fondy/direct-pro-sicav-investicni-fond-a-s-direct-pro-podfond-trida-e', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ1005202968': { url: 'https://www.codyainvest.cz/nase-fondy/fidurock-retail-parks-fund-trida-pia-a', anchor: 'Aktuální hodnota investiční akcie' },
  'CZ1005100618': { url: 'https://www.conseq.cz/investice/prehled-fondu/conseq-panattoni-logistics-developement-1-czk', anchor: 'Cena za kus' }
};

function refreshNav() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) return jsonOut({ error: 'List Fondy neexistuje — nejdřív naimportuj výpis.' });
    var data = sheet.getDataRange().getValues();
    var eur = fetchCnbEur(); // number nebo null
    var updated = 0, log = [];
    for (var i = 1; i < data.length; i++) {
      var isin = String(data[i][FOND_C.isin] || '');
      var src = NAV_SOURCES[isin];
      if (!src) continue;
      var res = scrapeNav(src.url, src.anchor);
      if (!res || !res.nav) { log.push(isin + ': nenačteno'); continue; }
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
    return jsonOut({ success: true, updated: updated, eur: eur, log: log });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// Stáhne stránku fondu, odstraní HTML tagy a najde NAV (4 desetinná místa)
// za textovou kotvou + datum platnosti. Defenzivní: vrací null když nenajde.
function scrapeNav(url, anchor) {
  try {
    var html = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinanceApp/1.0)' } }).getContentText();
    var text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    var start = anchor ? text.indexOf(anchor) : 0;
    if (start < 0) start = 0;
    var scope = text.substring(start, start + 400); // hledej hned za kotvou
    var navM = scope.match(/(\d{1,3},\d{4})/);       // NAV = X,XXXX
    var nav = navM ? parseFloat(navM[1].replace(',', '.')) : null;
    if (nav !== null && (nav <= 0.1 || nav >= 1000)) nav = null; // sanity
    // datum s rokem (u CODYA rozsahu "1.5. - 31.5.2026" chytne koncové 31.5.2026)
    var dm = scope.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    var datum = dm ? (parseInt(dm[1]) + '.' + parseInt(dm[2]) + '.' + dm[3]) : '';
    return { nav: nav, datum: datum };
  } catch (e) { return null; }
}

// EUR/CZK z oficiálního denního kurzu ČNB (textový feed, bez CORS/klíče)
function fetchCnbEur() {
  try {
    var txt = UrlFetchApp.fetch('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt',
      { muteHttpExceptions: true }).getContentText();
    var lines = txt.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var p = lines[i].split('|'); // země|měna|množství|kód|kurz
      if (p.length >= 5 && p[3] === 'EUR') {
        var amount = numCz(p[2]) || 1;
        return numCz(p[4]) / amount;
      }
    }
  } catch (e) {}
  return null;
}

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

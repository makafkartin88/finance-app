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

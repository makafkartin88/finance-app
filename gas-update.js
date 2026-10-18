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
  if (authEnforced()) return jsonOut({ error: 'Čtení jen přes přihlášenou appku (POST read).' });
  var sheetName = (e && e.parameter && e.parameter.sheet) || null;
  var sheetsParam = (e && e.parameter && e.parameter.sheets) || null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // VÍC LISTŮ NAJEDNOU (?sheets=A,B,C) — appka jich potřebuje ~9 a každý
  // samostatný požadavek znamená nový (pomalý) start Apps Scriptu. Takhle
  // se všechny přečtou v jedné exekuci ze stejného sešitu → místo devíti
  // několikasekundových round-tripů jeden.
  if (sheetsParam) {
    var names = String(sheetsParam).split(',');
    var out = {};
    for (var n = 0; n < names.length; n++) {
      var nm = names[n].trim();
      if (!nm) continue;
      var sh = ss.getSheetByName(nm);
      out[nm] = sh ? { values: sh.getDataRange().getValues() }
                   : { error: 'List "' + nm + '" neexistuje' };
    }
    return ContentService.createTextOutput(JSON.stringify({ sheets: out }))
      .setMimeType(ContentService.MimeType.JSON);
  }

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

    // ── KDO VOLÁ (Firebase ID token) + oprávnění ──
    var who = verifyCaller(body.idToken);
    delete body.idToken;
    if (authEnforced() && !who) return jsonOut({ error: 'Nepřihlášený požadavek — přihlas se v appce znovu.' });
    var denied = authorize(who, body);
    if (denied) return jsonOut({ error: denied });

    // ── ČTENÍ LISTŮ (POST, aby token nebyl v URL) ──
    if (body.action === 'read') {
      return jsonOut({ sheets: readSheetsFor(who, body.sheets || []) });
    }

    // ── RECEIPT UPLOAD ──
    if (body.action === 'uploadReceipt') {
      return handleReceiptUpload(body);
    }

    // ── DELETE ROW ──
    if (body.action === 'deleteRow') {
      return handleDeleteRow(body);
    }

    // ── UPDATE ROW (úprava transakce / šablony na místě, pod zámkem) ──
    if (body.action === 'updateRow') {
      return handleUpdateRow(body);
    }

    // ── OPAKOVANÉ PLATBY: vygenerovat měsíc pod zámkem + zapsat posledniGen ──
    if (body.action === 'appendRecurring') {
      return handleAppendRecurring(body);
    }

    // ── REMOVE RECEIPT ──
    if (body.action === 'removeReceipt') {
      return handleRemoveReceipt(body);
    }

    // ── MARK MBANK IMPORTED ──
    if (body.action === 'markMbankImported') {
      return handleMarkMbankImported(body);
    }

    // ── ZKONTROLOVAT POŠTU HNED (nečekat na měsíční trigger) ──
    if (body.action === 'checkMbankEmail') {
      return jsonOut({ success: true, added: checkMbankEmail() });
    }

    // ── GET DRIVE FILE (base64) ──
    if (body.action === 'getDriveFile') {
      return handleGetDriveFile(body, who);
    }

    // ── MARK PAYSLIP IMPORTED ──
    if (body.action === 'markPayslipImported') {
      return handleMarkPayslipImported(body);
    }

    // ── ZKONTROLOVAT POŠTU HNED (výplatní pásky, nečekat na denní trigger) ──
    if (body.action === 'checkPayslipEmail') {
      return jsonOut({ success: true, added: checkPayslipEmail() });
    }

    // ── UNICREDIT: výpisy z majetkového účtu CP (čtvrtletně, ZIP v e-mailu) ──
    if (body.action === 'checkUnicreditEmail') {
      return jsonOut(checkUnicreditEmail());
    }
    if (body.action === 'checkInvestEmail') {
      return jsonOut(checkInvestEmail());
    }
    if (body.action === 'markUcpImported') {
      return handleMarkUcpImported(body);
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

    // ── ULOŽIT NASTAVENÍ (bilance + čísla účtů) — sdílené, ne per-zařízení ──
    if (body.action === 'saveSettings') {
      return handleSaveSettings(body);
    }

    // ── DOKUMENTY (Drive + list Dokumenty) ──
    if (body.action === 'uploadDocument') return handleUploadDocument(body);
    if (body.action === 'updateDocument') return handleUpdateDocument(body);
    if (body.action === 'deleteDocument') return handleDeleteDocument(body);

    var sheetName = body.sheet || null;
    // Pod zámkem (souběžné zápisy z více zařízení) a jedním setValues.
    return withLock(function () {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = sheetName ? (ss.getSheetByName(sheetName) || ss.insertSheet(sheetName)) : ss.getSheets()[0];
      var rows = padRows(body.values || []);
      if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      return jsonOut({ success: true, added: rows.length });
    });
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
  return withLock(function () {
    var sheetName = body.sheet || 'Transakce';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.getSheets()[0];
    var i = findRowById(sheet, idColFor(sheetName), body.txId);
    if (i < 0) return jsonOut({ error: 'Řádek nenalezen' });
    sheet.deleteRow(i + 1);
    return jsonOut({ success: true });
  });
}

// ============================================================
// OVĚŘENÍ VOLAJÍCÍHO (Firebase ID token)
// Appka posílá v každém POSTu `idToken` přihlášeného uživatele. Token se
// ověří u Googlu (Identity Toolkit accounts:lookup — kontroluje podpis
// i expiraci) a podle e-mailu se dohledají práva. Vynucuje se až se
// Script Property AUTH_ENFORCE = 1; do té doby se jen ověřuje (bez
// odmítání), ať se přechod dá vyzkoušet bez výpadku.
// ============================================================
var FIREBASE_WEB_API_KEY = 'AIzaSyBZAuuCcSsuiKA8UFLJoyKgUUcWNzHPL58'; // veřejný klíč webové appky (je i v js/auth.js)

// SHA-256 e-mailu → práva (stejné otisky jako AUTH_USERS v js/config.js)
var AUTH_USERS_GAS = {
  'd14e742dcc719565cd7a4766e3964f9680d3d8361a458f1f28a5f935afc1d1e6': { person: 'Martin', investments: true, salary: true },
  'e77847f6d15bf76210fce7d8783776a4af7573c1837ae13765e1bf19a264a3f7': { person: 'Martin', investments: true, salary: true },
  '1a3717be8c1b580778fbb4e309cbe70e3bcf6ca274f17e009673d96daf04b638': { person: 'Šárka', investments: false, salary: false }
};

function authEnforced() {
  return PropertiesService.getScriptProperties().getProperty('AUTH_ENFORCE') === '1';
}

function sha256Hex(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Vrací { email, person, investments, salary } nebo null.
function verifyCaller(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + sha256Hex(token).slice(0, 40);
  var hit = cache.get(key);
  var email = hit || null;
  if (!email) {
    var resp = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ idToken: token })
    });
    if (resp.getResponseCode() !== 200) return null;
    var u = (JSON.parse(resp.getContentText()).users || [])[0];
    if (!u || !u.email || u.emailVerified === false) return null;
    email = String(u.email).toLowerCase();
    // Cache max. do expirace tokenu (a nejvýš 50 min).
    var ttl = 3000;
    try {
      var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1])).getDataAsString());
      ttl = Math.max(0, Math.min(3000, Math.floor(payload.exp - Date.now() / 1000) - 60));
    } catch (e) {}
    if (ttl > 0) cache.put(key, email, ttl);
  }
  var role = AUTH_USERS_GAS[sha256Hex(email)];
  if (!role) return null;
  return { email: email, person: role.person, investments: role.investments, salary: role.salary };
}

var SALARY_SHEETS = { Mzdy: 1, MzdyImport: 1 };
var INVEST_SHEETS = { Fondy: 1, Trh: 1, FondyHist: 1, TrhHist: 1, UcpImport: 1 };
var SALARY_ACTIONS = { markPayslipImported: 1, checkPayslipEmail: 1 };
var INVEST_ACTIONS = { upsertFund: 1, refreshNav: 1, refreshT212: 1, checkInvestEmail: 1, checkUnicreditEmail: 1, markUcpImported: 1 };

// Bez vynucení se nic neodmítá (who může být null). S vynucením: mzda a
// investice jen pro ty, kdo je mají povolené — i kdyby šli na server přímo.
function authorize(who, body) {
  if (!who) return '';
  var a = body.action, sh = body.sheet;
  if ((SALARY_ACTIONS[a] || (!a && SALARY_SHEETS[sh])) && !who.salary) return 'Bez oprávnění (mzda).';
  if ((INVEST_ACTIONS[a] || (!a && INVEST_SHEETS[sh])) && !who.investments) return 'Bez oprávnění (investice).';
  return '';
}

function sheetAllowed(who, name) {
  if (!who) return !authEnforced();
  if (SALARY_SHEETS[name] && !who.salary) return false;
  if (INVEST_SHEETS[name] && !who.investments) return false;
  return true;
}

function readSheetsFor(who, names) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = {};
  names.forEach(function (nm) {
    nm = String(nm).trim();
    if (!nm) return;
    if (!sheetAllowed(who, nm)) { out[nm] = { error: 'Bez oprávnění' }; return; }
    var sh = ss.getSheetByName(nm);
    if (!sh) { out[nm] = { error: 'List "' + nm + '" neexistuje' }; return; }
    var values = sh.getDataRange().getValues();
    // Dokumenty: soukromé („jen Martin/Šárka") se druhému vůbec nepošlou.
    if (nm === 'Dokumenty' && who) values = values.filter(function (r, i) {
      return i === 0 || !r[3] || r[3] === 'Oba' || r[3] === who.person;
    });
    out[nm] = { values: values };
  });
  return out;
}

// ── ZÁPIS: společné pomocníky ──
var ID_COL = { Transakce: 14, Recurring: 0, Mzdy: 0 };
function idColFor(sheetName) { return ID_COL.hasOwnProperty(sheetName) ? ID_COL[sheetName] : 14; }

function findRowById(sheet, idCol, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var v = data[i][idCol];
    // Id měsíce 'YYYY-MM' (list Mzdy) si Sheets převede na datum.
    var key = v instanceof Date ? Utilities.formatDate(v, 'Europe/Prague', 'yyyy-MM') : String(v);
    if (key === String(id)) return i;
  }
  return -1;
}

// Text začínající "=", "+" nebo "@" by Sheets uložil jako vzorec — data z PDF
// a e-mailů nejsou důvěryhodná, apostrof je vynutí jako obyčejný text.
function safeCell(v) { return (typeof v === 'string' && /^[=+@]/.test(v)) ? "'" + v : v; }

// Řádky různé délky → obdélník pro setValues.
function padRows(values) {
  var w = 0;
  values.forEach(function (r) { w = Math.max(w, r.length); });
  return values.map(function (r) { var o = r.map(safeCell); while (o.length < w) o.push(''); return o; });
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonOut({ error: 'Tabulka se právě upravuje jinde, zkus to za chvíli.' });
  try { return fn(); }
  catch (err) { return jsonOut({ error: err.message }); }
  finally { lock.releaseLock(); }
}

// Úprava řádku NA MÍSTĚ. Dřív se dělalo smazání + nový zápis dvěma požadavky
// — když druhý selhal, transakce zmizela.
function handleUpdateRow(body) {
  return withLock(function () {
    var sheetName = body.sheet || 'Transakce';
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return jsonOut({ error: 'List ' + sheetName + ' neexistuje' });
    var i = findRowById(sheet, idColFor(sheetName), body.id);
    if (i < 0) return jsonOut({ error: 'Řádek nenalezen (možná ho mezitím někdo smazal).' });
    var row = (body.values || []).map(safeCell);
    sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
    return jsonOut({ success: true });
  });
}

function normMonthGas(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Prague', 'yyyy-MM');
  return String(v || '').slice(0, 7);
}

// Opakované platby: transakce za měsíc se zapíšou NA SERVERU pod zámkem a
// u šablony se rovnou poznamená posledniGen. Dřív si to appka pamatovala jen
// v paměti — po úpravě vygenerované platby nebo na druhém zařízení se
// generovala znovu.
function handleAppendRecurring(body) {
  return withLock(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var rec = ss.getSheetByName('Recurring');
    var tx = ss.getSheetByName('Transakce') || ss.getSheets()[0];
    if (!rec) return jsonOut({ error: 'List Recurring neexistuje' });
    var month = String(body.month || '');
    var data = rec.getDataRange().getValues();
    var byId = {};
    for (var i = 1; i < data.length; i++) byId[String(data[i][0])] = i;
    var rows = [], added = [];
    (body.items || []).forEach(function (it) {
      var k = byId[String(it.recId)];
      if (k === undefined || normMonthGas(data[k][12]) === month) return;
      rows.push(it.row);
      added.push(String(it.recId));
      rec.getRange(k + 1, 13).setNumberFormat('@').setValue(month);
      data[k][12] = month;
    });
    var padded = padRows(rows);
    if (padded.length) tx.getRange(tx.getLastRow() + 1, 1, padded.length, padded[0].length).setValues(padded);
    return jsonOut({ success: true, added: added });
  });
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
// Soubor smí být jen ze složek appky (Finance-*, i podsložky dokumentů) —
// jinak by endpoint vydal cokoli z celého Disku, stačí znát ID.
function isAppFile(file) {
  var queue = [], it = file.getParents();
  while (it.hasNext()) queue.push({ f: it.next(), d: 0 });
  while (queue.length) {
    var x = queue.shift();
    if (/^Finance-/.test(x.f.getName())) return x.f.getName();
    if (x.d < 2) { var up = x.f.getParents(); while (up.hasNext()) queue.push({ f: up.next(), d: x.d + 1 }); }
  }
  return '';
}

function handleGetDriveFile(body, who) {
  try {
    var file = DriveApp.getFileById(body.fileId);
    var area = isAppFile(file);
    if (!area) return jsonOut({ error: 'Soubor není ze složek aplikace.' });
    if (who && area === 'Finance-Vyplaty' && !who.salary) return jsonOut({ error: 'Bez oprávnění (mzda).' });
    if (who && /^Finance-Vypisy-(CP|Fondy)$/.test(area) && !who.investments) return jsonOut({ error: 'Bez oprávnění (investice).' });
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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('MzdyImport');
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    // fileId je unikátní i když se víc pásek jmenuje stejně (viz
    // checkPayslipEmail) — dřív se matchovalo podle jména, takže by tohle
    // označilo za vyřízené VŠECHNY pásky se stejným názvem najednou.
    var fileId = body.fileId;
    for (var i = 1; i < data.length; i++) {
      if (data[i][2] === fileId && data[i][4] === 'new') {
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
var FOND_HEADER = ['provider','isin','nazev','mena','pocetCP','nakupNAV','nakupDatum','investovanoCZK','aktualNAV','aktualNAVdatum','aktualHodnotaCZK','poplatek','kurzEUR','hotovostCZK','poznamka','pplNative','fxPplNative','vypisDatum'];

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
  // Zámek: appka teď ukládá výpisy sama při otevření — dvě zařízení naráz
  // by jinak oba appendRow-ly nový fond (duplicitní ISIN), a souběžný
  // refreshNav by upsert přepsal svým snímkem listu.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return jsonOut({ error: 'List Fondy se právě aktualizuje — zkus to za chvíli.' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) { sheet = ss.insertSheet('Fondy'); sheet.appendRow(FOND_HEADER); }
    ensureFondyHeader(sheet);
    upsertFundRows(sheet, body.values || []);
    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ── NASTAVENÍ (bilance + čísla účtů Martin/Šárka) ──
// Dřív se ukládalo jen do localStorage prohlížeče — na jiném zařízení/
// prohlížeči proto appka vypadala, jako by nic uloženo nebylo. Je to JEDEN
// sdílený řádek (ne per-uživatel), protože bilance vzájemných příspěvků a
// rozpoznávání převodů mezi Martinem a Šárkou při mBank importu potřebuje
// znát účty obou najednou, ne jen toho, kdo je zrovna přihlášený.
// limity = rozpočtové limity kategorií (JSON) — dřív jen v prohlížeči,
// takže každé zařízení mělo jiné.
var NASTAVENI_HEADER = ['bilanceOffset', 'bilanceUcet', 'uctyMartin', 'uctySarka', 'limity'];

function handleSaveSettings(body) {
  return withLock(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Nastaveni');
    if (!sheet) { sheet = ss.insertSheet('Nastaveni'); sheet.appendRow(NASTAVENI_HEADER); }
    sheet.getRange(1, 1, 1, NASTAVENI_HEADER.length).setValues([NASTAVENI_HEADER]);
    var cur = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, 1, NASTAVENI_HEADER.length).getValues()[0] : [];
    sheet.getRange(2, 1, 1, NASTAVENI_HEADER.length).setValues([[
      body.bilanceOffset != null ? body.bilanceOffset : (cur[0] != null ? cur[0] : ''),
      body.bilanceUcet != null ? body.bilanceUcet : (cur[1] || ''),
      body.uctyMartin != null ? body.uctyMartin : (cur[2] || ''),
      body.uctySarka != null ? body.uctySarka : (cur[3] || ''),
      body.limity != null ? body.limity : (cur[4] || '')
    ]]);
    return jsonOut({ success: true });
  });
}

// ── DOKUMENTY ──
// Soubory: Finance-Dokumenty/<slozka>/<soubor>, sdílení „kdo má odkaz"
// (stejně jako účtenky). Viditelnost Oba/Martin/Šárka vynucuje jen appka —
// endpoint nemá autentizaci (vědomé rozhodnutí, viz spec 2026-10-08).
var DOK_HEADER = ['id', 'nazev', 'slozka', 'viditelnost', 'url', 'fileId', 'typ', 'velikost', 'nahral', 'datum'];
var DOK_VIS = ['Oba', 'Martin', 'Šárka'];

function dokSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Dokumenty');
  if (!sheet) {
    sheet = ss.insertSheet('Dokumenty');
    sheet.appendRow(DOK_HEADER);
    // Sloupec datum jako čistý text — jinak ho Sheets převede na Date a ten
    // se do JSON serializuje v UTC (o půlnoci CET = předchozí den).
    sheet.getRange('J:J').setNumberFormat('@');
  }
  return sheet;
}

function dokFolder(slozka) {
  var it = DriveApp.getFoldersByName('Finance-Dokumenty');
  var root = it.hasNext() ? it.next() : DriveApp.createFolder('Finance-Dokumenty');
  if (!slozka) return root;
  var sub = root.getFoldersByName(slozka);
  return sub.hasNext() ? sub.next() : root.createFolder(slozka);
}

function dokRowToObj(r) {
  var o = {};
  for (var i = 0; i < DOK_HEADER.length; i++) o[DOK_HEADER[i]] = r[i];
  return o;
}

function dokFindRow(sheet, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(id)) return { idx: i + 1, row: data[i] };
  return null;
}

function handleUploadDocument(body) {
  try {
    if (!body.data) return jsonOut({ error: 'Chybí data souboru.' });
    var slozka = String(body.slozka || '').trim();
    var vis = DOK_VIS.indexOf(body.viditelnost) >= 0 ? body.viditelnost : 'Oba';
    var mime = body.mimeType || 'application/octet-stream';
    var blob = Utilities.newBlob(Utilities.base64Decode(body.data), mime, body.fileName || 'dokument');
    var file = dokFolder(slozka).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var id = 'doc_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var row = [id, String(body.nazev || body.fileName || 'Dokument').trim(), slozka, vis,
      file.getUrl(), file.getId(), mime === 'application/pdf' ? 'pdf' : 'image',
      blob.getBytes().length, String(body.nahral || ''),
      Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd')];
    dokSheet().appendRow(row);
    return jsonOut({ success: true, doc: dokRowToObj(row) });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function handleUpdateDocument(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonOut({ error: 'Dokumenty se právě upravují jinde, zkus to za chvíli.' });
  try {
    var sheet = dokSheet();
    var hit = dokFindRow(sheet, body.id);
    if (!hit) return jsonOut({ error: 'Dokument nenalezen (možná už byl smazán).' });
    var row = hit.row;
    if (body.nazev != null && String(body.nazev).trim()) row[1] = String(body.nazev).trim();
    if (body.viditelnost != null && DOK_VIS.indexOf(body.viditelnost) >= 0) row[3] = body.viditelnost;
    if (body.slozka != null) {
      var nova = String(body.slozka).trim();
      if (nova !== String(row[2])) {
        DriveApp.getFileById(row[5]).moveTo(dokFolder(nova));
        row[2] = nova;
      }
    }
    sheet.getRange(hit.idx, 1, 1, DOK_HEADER.length).setValues([row.slice(0, DOK_HEADER.length)]);
    return jsonOut({ success: true, doc: dokRowToObj(row) });
  } catch (err) {
    return jsonOut({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteDocument(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonOut({ error: 'Dokumenty se právě upravují jinde, zkus to za chvíli.' });
  try {
    var sheet = dokSheet();
    var hit = dokFindRow(sheet, body.id);
    if (!hit) return jsonOut({ error: 'Dokument nenalezen (možná už byl smazán).' });
    // Koš, ne trvalé smazání — 30 dní jde obnovit přímo na Drive.
    try { DriveApp.getFileById(hit.row[5]).setTrashed(true); } catch (e) { /* soubor už neexistuje */ }
    sheet.deleteRow(hit.idx);
    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ error: err.message });
  } finally {
    lock.releaseLock();
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
    // Pozice bez nich zůstanou bez CZK hodnoty (bezpečný fallback), pokud
    // klíč nemá scope "Metadata" nebo endpoint selže.
    // Seznam nástrojů má ~13 tisíc položek (několik MB) — stahovat ho při
    // KAŽDÉM refreshi je pomalé a přetěžuje skript, proto se z něj uloží
    // jen mapa pro tickery, které skutečně držíme, a příště se sáhne po ní.
    // Nový nákup = neznámý ticker → jednorázově se seznam stáhne znovu.
    var heldTickers = [];
    var pf = portfolio.data || [];
    for (var ti = 0; ti < pf.length; ti++) if (pf[ti] && pf[ti].ticker) heldTickers.push(pf[ti].ticker);

    var instrByTicker = {};
    try { instrByTicker = JSON.parse(props.getProperty('T212_INSTR_CACHE') || '{}'); } catch (e) { instrByTicker = {}; }
    var missing = heldTickers.filter(function (t) { return !instrByTicker[t]; });
    var metaOk = missing.length === 0; // vše už v cache → metadata netřeba
    if (missing.length) {
      var meta = t212Fetch('/metadata/instruments', authHeader);
      metaOk = !meta.err && Object.prototype.toString.call(meta.data) === '[object Array]';
      if (metaOk) {
        for (var mi = 0; mi < meta.data.length; mi++) {
          var it = meta.data[mi];
          if (it && it.ticker && missing.indexOf(it.ticker) !== -1) {
            instrByTicker[it.ticker] = { currencyCode: it.currencyCode, name: it.name || it.shortname || '' };
          }
        }
        props.setProperty('T212_INSTR_CACHE', JSON.stringify(instrByTicker));
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
    var positions = pf;
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      if (!p.ticker) continue;
      var instr = instrByTicker[p.ticker];
      var instrCcy = instr && instr.currencyCode;
      var instrRate = instrCcy ? rateFor(instrCcy) : null;
      var investCzk = instrRate != null ? Math.round(p.quantity * p.averagePrice * instrRate) : '';
      var curCzk = instrRate != null ? Math.round(p.quantity * p.currentPrice * instrRate) : '';
      if (investCzk === '') unresolved++;
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

    // Souhrnný řádek = AUTORITATIVNÍ čísla přímo z /account/cash. T212 je
    // počítá samo v měně účtu (invested/ppl/total/free), takže platí i když
    // se metadata nástrojů nedohledají — headline se pak nikdy nerozbije.
    // aktualHodnotaCZK = total − free (jen pozice, bez volné hotovosti, aby
    // se nezapočítala dvakrát). Souhrn je zároveň JEDINÝ zdroj pro celkovou
    // alokaci na Přehledu; jednotlivé T212 pozice se tam nesčítají (viz
    // renderOverview), aby portfolio nevyšlo dvojnásobně.
    rows.push(fondRow({
      provider: 'T212', isin: 'T212_CASH', nazev: 'Trading 212 — souhrn účtu', mena: currency,
      investovanoCZK: Math.round((c.invested || 0) * rate),
      aktualNAVdatum: nowStamp,
      aktualHodnotaCZK: Math.round(((c.total || 0) - (c.free || 0)) * rate),
      kurzEUR: rate, hotovostCZK: Math.round((c.free || 0) * rate),
      poznamka: 'ppl ' + Math.round(c.ppl || 0) + ' ' + currency + (unresolved ? (' · ' + unresolved + ' pozic bez metadat') : ''),
      pplNative: c.ppl, fxPplNative: ''
    }));

    // Zápis pod zámkem — refreshNav přepisuje list Fondy celý naráz ze
    // svého snímku, takže souběžný běh obou by si navzájem přemazal data.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(60000)) return jsonOut({ error: 'List Fondy je právě aktualizován jiným během — zkus to za chvíli.' });
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Fondy');
      if (!sheet) { sheet = ss.insertSheet('Fondy'); sheet.appendRow(FOND_HEADER); }
      ensureFondyHeader(sheet);
      upsertFundRows(sheet, rows);
    } finally { lock.releaseLock(); }
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
// Voláno z appky (action:'refreshNav') NEBO jako time-trigger (týdně):
// Triggers → refreshNav → Time-driven → Week timer → pondělí, 6-7am.
// Trigger se zakládá klikacím rozhraním, ne kódem — ScriptApp.newTrigger()
// by vyžadovalo scope script.scriptapp v manifestu a tím i novou autorizaci
// celé web appky. Redeploy pro založení triggeru netřeba, běží nad uloženým
// kódem projektu.
// Týdně, ne měsíčně: fondy přeceňují měsíčně, ale na web to dávají s
// nepravidelným zpožděním — běh 1. dne v měsíci by nové ocenění mohl minout
// a data by pak čekala celý další měsíc.
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

// Zdroj kurzu pro fond: ruční záznam v NAV_SOURCES, jinak u CONSEQ obecná
// stránka fondu podle ISIN (má stejné „Cena za kus") — nový fond CONSEQ se
// tak začne stahovat sám, bez úpravy kódu. CODYA takovou stránku nemá.
function navSourceFor(provider, isin) {
  if (NAV_SOURCES[isin]) return NAV_SOURCES[isin];
  if (provider === 'CONSEQ' && /^CZ\d{10}$/.test(isin))
    return { url: 'https://www.conseq.cz/investment/mutual-funds/' + isin.toLowerCase() + '?lang=cs-cz', anchor: 'Cena za kus' };
  return null;
}

function refreshNav(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Fondy');
    if (!sheet) return jsonOut({ error: 'List Fondy neexistuje — nejdřív naimportuj výpis.' });
    var data = sheet.getDataRange().getValues();
    var eurR = fetchCnbEur(); // { v, err }
    var eur = eurR.v;
    var updated = 0, log = [], failed = [];
    if (!eur) log.push('ČNB EUR: ' + (eurR.err || 'nenačteno'));
    // Scrape (dlouhý, běží BEZ zámku) → výsledky se odkládají do mapy dle
    // ISIN. Zápis se pak provede pod zámkem nad ČERSTVĚ načteným listem a
    // dotkne se jen polí, která scrape opravdu mění. Dřív se list přepisoval
    // celý naráz ze snímku pořízeného před scrapem, takže cokoliv, co mezitím
    // zapsal refreshT212 (řádky T212), se tím vrátilo na stará data.
    var navUpdates = {};
    for (var i = 1; i < data.length; i++) {
      var isin = String(data[i][FOND_C.isin] || '');
      var src = navSourceFor(String(data[i][0] || ''), isin);
      if (!src) continue;
      var res = scrapeNav(src.url, src.anchor);
      if (!res || !res.nav) { log.push(isin + ': ' + ((res && res.err) || 'nenačteno')); failed.push(isin); continue; }
      navUpdates[isin] = { nav: res.nav, datum: res.datum || '' };
      updated++;
      log.push(isin + ': ' + res.nav + (res.datum ? ' (' + res.datum + ')' : ''));
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(60000)) return jsonOut({ error: 'List Fondy je právě aktualizován jiným během — zkus to za chvíli.' });
    try {
      data = sheet.getDataRange().getValues(); // čerstvý stav (může obsahovat nové T212 řádky)
      for (var j = 1; j < data.length; j++) {
        var jIsin = String(data[j][FOND_C.isin] || '');
        var u = navUpdates[jIsin];
        if (!u) continue;
        data[j][FOND_C.aktualNAV] = u.nav;
        if (u.datum) data[j][FOND_C.aktualNAVdatum] = u.datum;
        var mena = data[j][FOND_C.mena];
        var kurz = (mena === 'EUR') ? (eur || numCz(data[j][FOND_C.kurzEUR]) || 25) : 1;
        if (mena === 'EUR' && eur) data[j][FOND_C.kurzEUR] = eur;
        data[j][FOND_C.aktualHodnotaCZK] = Math.round(numCz(data[j][FOND_C.pocetCP]) * u.nav * kurz);
      }
      sheet.getDataRange().setValues(data);
    } finally { lock.releaseLock(); }

    // S&P 500 + USD/CZK z Yahoo (jednou, sdíleno pro summary i historii)
    var sp = fetchYahoo('%5EGSPC');       // ^GSPC
    var fx = fetchYahoo('USDCZK%3DX');    // USDCZK=X
    // Summary karta → list Trh (per provider, i v CZK přes USD/CZK)
    var market = updateMarket(ss, data, sp, fx);
    if (!market.ok) { failed.push('S&P500'); log.push(market.err || 'S&P: nenačteno'); }
    // Historie → listy TrhHist (denní S&P+FX) a FondyHist (řídké body fondů)
    var hist = updateHistory(ss, data, sp, fx);
    if (!hist.ok) log.push(hist.err || 'historie: nezapsána');

    // Týdenní časovač (e.triggerUid) projde navíc poštu: výpisy UniCredit,
    // CODYA a CONSEQ → fronta, kterou appka při otevření sama naimportuje.
    // Z tlačítka v appce se nevolá — zdržovalo by to aktualizaci kurzů.
    if (e && e.triggerUid) {
      try { log.push(syncInflation()); }
      catch (ei) { failed.push('INFLACE'); log.push('Inflace z ČSÚ: ' + ei.message); }
      try { log.push('Záloha: ' + weeklyBackup()); }
      catch (eb) { failed.push('ZÁLOHA'); log.push('Záloha selhala: ' + eb.message); }
      try { healthCheck().forEach(function (w) { failed.push('KONTROLA'); log.push(w); }); }
      catch (eh) { log.push('Kontrola zdrojů selhala: ' + eh.message); }
      try {
        var mail = checkInvestEmail();
        log.push('Pošta: ' + (mail.added || 0) + ' nových výpisů' + (mail.fixed ? ', ' + mail.fixed + ' rozbaleno dodatečně' : ''));
        if (mail.error) { failed.push('POŠTA'); log.push(mail.error); }
        (mail.problems || []).forEach(function (pr) { failed.push('VÝPIS'); log.push(pr); });
      } catch (em) { failed.push('POŠTA'); log.push('Kontrola pošty: ' + em.message); }
    }

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

// ── INFLACE: index spotřebitelských cen z ČSÚ ──
// Předpřipravený výběr DataStatu CEN0101ET03 (měsíční indexy, ~35 KB, posledních
// ~13 měsíců). Celá datová sada má 67 MB — na UrlFetch moc. Bazický index
// (2025 = 100) za úhrn ČR se týdně připíše do listu Inflace [mesic, index];
// appka ho napojí na historickou tabulku v js/inflation-data.js.
var CZ_MONTHS = { 'leden': 1, 'únor': 2, 'březen': 3, 'duben': 4, 'květen': 5, 'červen': 6, 'červenec': 7,
  'srpen': 8, 'září': 9, 'říjen': 10, 'listopad': 11, 'prosinec': 12 };

function parseCpiCsv(text) {
  var rows = Utilities.parseCsv ? Utilities.parseCsv(text) : text.split('\n').map(function (l) {
    return (l.match(/"([^"]*)"/g) || []).map(function (x) { return x.slice(1, -1); });
  });
  var h = rows[0] || [], ix = {};
  h.forEach(function (n, i) { ix[n] = i; });
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length < h.length) continue;
    if (!/Bazický index \(2025 = 100\)/.test(r[ix['Typ indexu']]) || r[ix['Území']] !== 'Česko' ||
        r[ix['Skupiny domácností']] !== 'Domácnosti celkem' || r[ix['Klasifikace COICOP 2018-Oddíl']] !== 'Úhrn') continue;
    var m = String(r[ix['Měsíce']]).match(/^(\S+)\s+(\d{4})$/);
    var mon = m && CZ_MONTHS[m[1]];
    var v = parseFloat(String(r[ix['Hodnota']]).replace(',', '.'));
    if (mon && v > 0) out.push([m[2] + '-' + ('0' + mon).slice(-2), v]);
  }
  return out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
}

function syncInflation() {
  var resp = UrlFetchApp.fetch('https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CEN0101ET03?format=CSV', { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('ČSÚ HTTP ' + resp.getResponseCode());
  var fresh = parseCpiCsv(resp.getContentText('UTF-8'));
  if (!fresh.length) throw new Error('ČSÚ: ve výběru nebyl bazický index (změnil se formát?)');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Inflace');
  if (!sh) { sh = ss.insertSheet('Inflace'); sh.appendRow(['mesic', 'index2025']); sh.getRange('A:A').setNumberFormat('@'); }
  var have = {}, v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) have[normMonthGas(v[i][0])] = i + 1;
  var added = 0;
  fresh.forEach(function (r) {
    if (have[r[0]]) sh.getRange(have[r[0]], 2).setValue(r[1]);   // ČSÚ občas revidovat nebude, ale ať to sedí
    else { sh.appendRow(r); added++; }
  });
  return 'Inflace: ' + fresh[fresh.length - 1][0] + ' (' + added + ' nových měsíců)';
}

// ── TÝDENNÍ ZÁLOHA TABULKY ── kopie do Finance-Backup, drží se 12 posledních.
function weeklyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var it = DriveApp.getFoldersByName('Finance-Backup');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Finance-Backup');
  var name = 'Finance zaloha ' + Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  var files = [], f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(12).forEach(function (x) { x.setTrashed(true); });
  return name;
}

// ── KONTROLA ZDROJŮ ── pásky a výpisy chodí měsíčně, kurzy fondů s ~1–3 měs.
// zpožděním. Když je nejnovější záznam starší než limit, nejspíš se něco
// rozbilo (jiný odesílatel, změněný web) — ať se to nepozná až po půl roce.
function healthCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), warn = [], now = new Date();
  var days = function (d) { return Math.floor((now - d) / 864e5); };
  [['MzdyImport', 40, 'výplatní páska'], ['MbankImport', 40, 'výpis mBank']].forEach(function (c) {
    var sh = ss.getSheetByName(c[0]);
    if (!sh) return;
    var v = sh.getDataRange().getValues(), last = null;
    for (var i = 1; i < v.length; i++) { var d = v[i][3] instanceof Date ? v[i][3] : null; if (d && (!last || d > last)) last = d; }
    if (last && days(last) > c[1]) warn.push('Poslední ' + c[2] + ' přišla před ' + days(last) + ' dny (' + Utilities.formatDate(last, 'Europe/Prague', 'd.M.yyyy') + ').');
  });
  var fondy = ss.getSheetByName('Fondy');
  if (fondy) {
    var fv = fondy.getDataRange().getValues();
    for (var j = 1; j < fv.length; j++) {
      if (fv[j][0] !== 'CODYA' && fv[j][0] !== 'CONSEQ') continue;
      var nd = fv[j][9] instanceof Date ? fv[j][9] : parseCzDate(fv[j][9]);
      if (nd && days(nd) > 120) warn.push('Kurz ' + fv[j][1] + ' je starý ' + days(nd) + ' dní.');
    }
  }
  return warn;
}

// Upozornění na selhání scrapu (jen když umíme zjistit adresu — bez PII v repu)
function sendNavAlert(failed, log) {
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return; // ruční volání z web appky nemá uživatele → přeskočit (stav je v JSON)
    MailApp.sendEmail(to, 'Finance App: týdenní kontrola našla problém',
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
// Spusť ručně, přes akci 'checkPayslipEmail' z appky, nebo time-trigger:
// Triggers → checkPayslipEmail → Time-driven → Day timer.
// Vrací počet nově přidaných pásek.
var PAYSLIP_HEADER = ['datum_detekce', 'soubor', 'file_id', 'datum_emailu', 'status', 'msg_id', 'obdobi'];
function ensurePayslipHeader(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < PAYSLIP_HEADER.length) {
    sheet.getRange(1, lastCol + 1, 1, PAYSLIP_HEADER.length - lastCol).setValues([PAYSLIP_HEADER.slice(lastCol)]);
  }
}
// "Logio s.r.o. - výplatní páska za 07/2026" → "2026-07"
function payslipPeriodFromSubject(subject) {
  var m = String(subject || '').match(/(\d{1,2})\s*\/\s*(\d{4})/);
  return m ? (m[2] + '-' + ('0' + m[1]).slice(-2)) : '';
}
function checkPayslipEmail() {
  // 400 dní (ne 35) — bezpečnostní rezerva, kdyby trigger jednou nevyšel
  // nebo appka delší dobu neběžela; dedup níže stejně nic nepřidá dvakrát.
  var threads = GmailApp.search('from:harnol.cz has:attachment newer_than:400d', 0, 30);
  if (!threads.length) return 0;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('MzdyImport');
  if (!sheet) { sheet = ss.insertSheet('MzdyImport'); sheet.appendRow(PAYSLIP_HEADER); }
  ensurePayslipHeader(sheet);

  // Dedup dle ID ZPRÁVY, ne názvu přílohy — příloha se u Harnolu jmenuje
  // pokaždé stejně ("Výplatní lístek pevný.pdf"), takže dedup podle jména
  // by po první zachycené pásce navždy tiše přeskakoval úplně všechny další
  // (přesně tohle se v produkci stalo — od června nepřibyla ani jedna).
  var existing = {};
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) existing[rows[r][5]] = true; // msg_id

  // Najdi nebo vytvoř složku Finance-Vyplaty (privátní — bez sdílení)
  var folders = DriveApp.getFoldersByName('Finance-Vyplaty');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Finance-Vyplaty');

  var added = 0;
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(msg) {
      var msgId = msg.getId();
      if (existing[msgId]) return;
      var pdfAtts = msg.getAttachments().filter(function(a) { return a.getContentType() === 'application/pdf'; });
      if (!pdfAtts.length) return;

      var att = pdfAtts[0];
      var period = payslipPeriodFromSubject(msg.getSubject());
      // Unikátní jméno na Disku (jinak by se stejně pojmenované soubory
      // v jedné složce jen matly) — obdobím, když ho známe, jinak msg_id.
      var file = folder.createFile(att.copyBlob().setName((period || msgId) + '_' + att.getName()));
      // záměrně BEZ setSharing — jsou to výplatní pásky, čte je jen GAS

      sheet.appendRow([
        new Date(),        // datum_detekce
        att.getName(),     // soubor (původní jméno, pro zobrazení)
        file.getId(),      // file_id (pro akci getDriveFile)
        msg.getDate(),     // datum_emailu
        'new',             // status
        msgId,             // msg_id (dedup klíč)
        period             // období "YYYY-MM" z předmětu, pro řazení v appce
      ]);
      existing[msgId] = true;
      added++;
    });
  });
  return added;
}

// ── GMAIL → DRIVE → SHEET NOTIFICATION ──
// Spusť ručně, přes akci 'checkMbankEmail' z appky, nebo time-trigger:
// Triggers → checkMbankEmail → Time-driven → Month timer.
// Okno je záměrně roční (ne 35 dní): když trigger jednou nevyjde nebo se
// appka delší dobu nepoužívá, jinak by se výpisy nenávratně přeskočily.
// Dedup dle názvu souboru zajistí, že se nic nepřidá dvakrát.
// Vrací počet nově přidaných souborů.
function checkMbankEmail() {
  var threads = GmailApp.search('from:wyciag@mbank.pl OR from:kontakt@mbank.cz newer_than:400d has:attachment', 0, 30);
  if (!threads.length) return 0;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('MbankImport');
  if (!sheet) {
    sheet = ss.insertSheet('MbankImport');
    sheet.appendRow(['datum_detekce', 'soubor', 'file_id', 'datum_emailu', 'status']);
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

  var added = 0;
  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(msg) {
      var attachments = msg.getAttachments();
      attachments.forEach(function(att) {
        if (att.getContentType() !== 'application/pdf') return;
        var name = att.getName();
        if (existing[name]) return; // už bylo zpracováno

        var file = folder.createFile(att); // záměrně BEZ setSharing — jsou to bankovní výpisy, čte je jen GAS

        sheet.appendRow([
          new Date(),      // datum_detekce
          name,            // soubor
          file.getId(),    // file_id (pro akci getDriveFile)
          msg.getDate(),   // datum_emailu
          'new'            // status
        ]);
        existing[name] = true;
        added++;
      });
    });
  });
  return added;
}

// ── GMAIL → DRIVE → SHEET: UNICREDIT VÝPISY Z MAJETKOVÉHO ÚČTU CP ──
// Chodí čtvrtletně jako ZIP s heslem chráněným PDF uvnitř. GAS ZIP rozbalí
// (Utilities.unzip) a na Disk uloží samotné PDF — heslo pak řeší až appka
// v prohlížeči přes pdf.js, stejně jako u mBank výpisů a výplatních pásek.
// Kdyby byl heslem chráněný i samotný ZIP, unzip selže — pak se uloží
// originál a řádek dostane poznámku, ať je jasné, co se stalo.
// Spusť ručně, akcí 'checkUnicreditEmail' z appky, nebo time-triggerem.
var UCP_HEADER = ['datum_detekce', 'soubor', 'file_id', 'datum_emailu', 'status', 'msg_id', 'obdobi', 'poznamka'];

// ── ZIPCRYPTO: rozšifrování ZIPu z UniCreditu ──
// UniCredit posílá ZIP chráněný klasickým PKWARE ZipCrypto, který
// Utilities.unzip neumí. Šifra je jednoduchá (3 klíče aktualizované přes
// CRC32), takže ji jde rozšifrovat tady: z dat se sloupne šifra a složí se
// NEšifrovaný ZIP, který už rozbalí Utilities.unzip (ten řeší i deflate).
// Vstup i výstup = pole bajtů (vstup smí být i podepsané -128..127 z GAS).
// AES-šifrované ZIPy (metoda 99) nepodporuje — dá srozumitelnou chybu.
var ZC_CRC = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function zcUpdate(keys, b) {
  keys[0] = (ZC_CRC[(keys[0] ^ b) & 0xff] ^ (keys[0] >>> 8)) >>> 0;
  keys[1] = (Math.imul((keys[1] + (keys[0] & 0xff)) >>> 0, 134775813) + 1) >>> 0;
  keys[2] = (ZC_CRC[(keys[2] ^ (keys[1] >>> 24)) & 0xff] ^ (keys[2] >>> 8)) >>> 0;
}

function zipDecryptToPlain(input, password) {
  var b = input.map(function (x) { return x & 0xff; });
  var u16 = function (p) { return b[p] | (b[p + 1] << 8); };
  var u32 = function (p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; };
  var e = -1;
  for (var i = b.length - 22; i >= 0; i--) if (u32(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Soubor není ZIP (chybí konec archivu).');

  var count = u16(e + 10), p = u32(e + 16);
  var entries = [];
  for (var n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) throw new Error('Poškozený adresář ZIPu.');
    var fnLen = u16(p + 28), exLen = u16(p + 30), cmLen = u16(p + 32);
    entries.push({ flags: u16(p + 8), method: u16(p + 10), time: u16(p + 12), date: u16(p + 14),
      crc: u32(p + 16), csize: u32(p + 20), usize: u32(p + 24), off: u32(p + 42),
      name: b.slice(p + 46, p + 46 + fnLen) });
    p += 46 + fnLen + exLen + cmLen;
  }

  var out = [], cd = [];
  var put16 = function (a, v) { a.push(v & 0xff, (v >>> 8) & 0xff); };
  var put32 = function (a, v) { a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  entries.forEach(function (en) {
    if (en.method === 99) throw new Error('ZIP je šifrovaný AES — tohle rozšifrovat neumím.');
    var start = en.off + 30 + u16(en.off + 26) + u16(en.off + 28);
    var data = b.slice(start, start + en.csize);
    if (en.flags & 1) {
      var keys = [0x12345678, 0x23456789, 0x34567890];
      for (var k = 0; k < password.length; k++) zcUpdate(keys, password.charCodeAt(k) & 0xff);
      var plain = new Array(data.length);
      for (var j = 0; j < data.length; j++) {
        var t = (keys[2] | 2) & 0xffff;
        var c = data[j] ^ (((t * (t ^ 1)) >>> 8) & 0xff);
        zcUpdate(keys, c);
        plain[j] = c;
      }
      var check = (en.flags & 8) ? ((en.time >>> 8) & 0xff) : ((en.crc >>> 24) & 0xff);
      if (plain[11] !== check) throw new Error('Špatné heslo k ZIPu (UCP_ZIP_PASSWORD).');
      data = plain.slice(12);
    }
    var flags = en.flags & ~9; // bez šifry a bez data descriptoru
    var off = out.length;
    put32(out, 0x04034b50); put16(out, 20); put16(out, flags); put16(out, en.method);
    put16(out, en.time); put16(out, en.date); put32(out, en.crc); put32(out, data.length); put32(out, en.usize);
    put16(out, en.name.length); put16(out, 0);
    Array.prototype.push.apply(out, en.name);
    for (var q = 0; q < data.length; q++) out.push(data[q]);
    put32(cd, 0x02014b50); put16(cd, 20); put16(cd, 20); put16(cd, flags); put16(cd, en.method);
    put16(cd, en.time); put16(cd, en.date); put32(cd, en.crc); put32(cd, data.length); put32(cd, en.usize);
    put16(cd, en.name.length); put16(cd, 0); put16(cd, 0); put16(cd, 0); put16(cd, 0); put32(cd, 0); put32(cd, off);
    Array.prototype.push.apply(cd, en.name);
  });
  var cdOff = out.length;
  for (var r = 0; r < cd.length; r++) out.push(cd[r]);
  put32(out, 0x06054b50); put16(out, 0); put16(out, 0); put16(out, entries.length); put16(out, entries.length);
  put32(out, cd.length); put32(out, cdOff); put16(out, 0);
  return out;
}

// ZIP z UniCreditu → PDF blob. Nejdřív zkusí běžné rozbalení, pak ZipCrypto
// s heslem ze Script Properties (UCP_ZIP_PASSWORD). Vrací { blob, note } —
// blob je PDF, nebo null (pak note říká proč).
function ucpExtractPdf(zipBlob) {
  var inner = null, note = '';
  try {
    inner = Utilities.unzip(zipBlob.setContentType('application/zip'));
  } catch (e) {
    var pwd = PropertiesService.getScriptProperties().getProperty('UCP_ZIP_PASSWORD');
    if (!pwd) return { blob: null, note: 'ZIP je zaheslovaný — doplň heslo do Script Properties jako UCP_ZIP_PASSWORD' };
    try {
      var plain = zipDecryptToPlain(zipBlob.getBytes(), pwd)
        .map(function (x) { return x > 127 ? x - 256 : x; });
      inner = Utilities.unzip(Utilities.newBlob(plain, 'application/zip', 'plain.zip'));
    } catch (e2) {
      return { blob: null, note: e2.message };
    }
  }
  for (var k = 0; k < inner.length; k++) if (/\.pdf$/i.test(inner[k].getName())) return { blob: inner[k], note: note };
  return { blob: null, note: 'V ZIPu nebylo PDF' };
}

function checkUnicreditEmail() {
  var threads = GmailApp.search('from:vypisy_cennepapiry@unicreditgroup.cz newer_than:400d has:attachment', 0, 30);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('UcpImport');
  if (!sheet) { sheet = ss.insertSheet('UcpImport'); sheet.appendRow(UCP_HEADER); }
  var lastCol = sheet.getLastColumn();
  if (lastCol < UCP_HEADER.length) {
    sheet.getRange(1, lastCol + 1, 1, UCP_HEADER.length - lastCol).setValues([UCP_HEADER.slice(lastCol)]);
  }
  // (Bez předčasného návratu při prázdné poště — zaseknuté ZIPy ve frontě
  // se mají zkusit znovu, i když nepřišel nový e-mail.)

  // Zámek: bez něj dvě souběžná spuštění (např. dvojklik na "Zkontrolovat
  // poštu") obě přečtou `existing` PŘED tím, než druhá dopíše své řádky —
  // dedup podle msg_id pak nezabrání duplicitě. Přesně tohle se stalo
  // (každá zpráva v UcpImport zapsaná dvakrát, s odstupem ~1-2 s).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, error: 'Kontrola pošty právě běží jinde, zkus to za chvíli.' };

  try {
  // Dedup dle ID zprávy — název přílohy se může opakovat.
  var existing = {};
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) existing[rows[r][5]] = true;

  var folders = DriveApp.getFoldersByName('Finance-Vypisy-CP');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Finance-Vypisy-CP');

  // Čekající ZIPy zachycené dřív, než šlo rozšifrovat (nebo bez hesla) →
  // zkusit znovu, ať se frontou neplouží nezpracovatelný ZIP.
  var fixed = 0;
  for (var z = 1; z < rows.length; z++) {
    if (rows[z][4] !== 'new' || !/\.zip$/i.test(String(rows[z][1]))) continue;
    try {
      var old = DriveApp.getFileById(rows[z][2]);
      var exz = ucpExtractPdf(old.getBlob());
      if (!exz.blob) { sheet.getRange(z + 1, 8).setValue(exz.note); continue; }
      var nf = folder.createFile(exz.blob.setName(rows[z][5] + '_' + exz.blob.getName()));
      sheet.getRange(z + 1, 2, 1, 2).setValues([[exz.blob.getName(), nf.getId()]]);
      sheet.getRange(z + 1, 8).setValue('');
      old.setTrashed(true);
      fixed++;
    } catch (ez) { sheet.getRange(z + 1, 8).setValue('Opakované rozbalení selhalo: ' + ez.message); }
  }

  var added = 0, problems = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var msgId = msg.getId();
      if (existing[msgId]) return;
      // Jen skutečný výpis (ZIP/PDF) — email má i vložený podpisový obrázek
      // (image001.gif apod.), který GAS vidí jako další "přílohu". Bez
      // téhle filtrace se atts[0] mohl trefit do obrázku místo výpisu.
      var atts = msg.getAttachments().filter(function (a) { return /\.(zip|pdf)$/i.test(a.getName() || ''); });
      if (!atts.length) return;

      // Období z předmětu/textu ("k 30.06.2026") → "2026-06"
      var period = '';
      var pm = (msg.getSubject() + ' ' + msg.getPlainBody().slice(0, 800)).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (pm) period = pm[3] + '-' + ('0' + pm[2]).slice(-2);

      var att = atts[0];
      var name = att.getName();
      var blob = att.copyBlob();
      var note = '';

      // ZIP rozbalit (i zaheslovaný — ZipCrypto, viz ucpExtractPdf)
      if (/\.zip$/i.test(name) || /zip/i.test(att.getContentType())) {
        var ex = ucpExtractPdf(blob);
        if (ex.blob) { blob = ex.blob; name = ex.blob.getName(); }
        note = ex.note;
      }

      var file = folder.createFile(blob.setName((period || msgId) + '_' + name));
      // záměrně BEZ setSharing — jsou to výpisy z majetkového účtu, čte je jen GAS

      sheet.appendRow([new Date(), name, file.getId(), msg.getDate(), 'new', msgId, period, note]);
      existing[msgId] = true;
      added++;
      if (note) problems.push(name + ': ' + note);
    });
  });
  return { success: true, added: added, fixed: fixed, problems: problems };
  } finally {
    lock.releaseLock();
  }
}

// Kontrola pošty pro investiční výpisy (tlačítko v appce + týdenní běh).
// Jen UniCredit — u CODYA/CONSEQ se složení fondů nemění, stačí kurzy z webu.
function checkInvestEmail() {
  return checkUnicreditEmail();
}

function handleMarkUcpImported(body) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('UcpImport');
    if (!sheet) return jsonOut({ success: true });
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][2] === body.fileId && data[i][4] === 'new') sheet.getRange(i + 1, 5).setValue('imported');
    }
    return jsonOut({ success: true });
  } catch (err) { return jsonOut({ error: err.message }); }
}

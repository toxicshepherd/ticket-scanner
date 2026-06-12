/***** Konfiguration *****/

const PERSONEN_SHEET = 'Personen';
const QR_SHEET = 'QR-Codes';

// Blatt "Personen": eine Zeile pro Person
const P_HEADER = ['Anrede', 'Name', 'Vorname', 'Studiengruppe', 'Studienort',
                  'Tickets', 'Eingecheckt', 'Check-ins', 'ID'];
const P = { ANREDE: 1, NAME: 2, VORNAME: 3, GRUPPE: 4, ORT: 5,
            TICKETS: 6, STATUS: 7, CHECKINS: 8, ID: 9 };

// Blatt "QR-Codes": eine Zeile pro Ticket
const Q_HEADER = ['ID', 'Name', 'Vorname', 'Ticket', 'QR-Code', 'QR-Bild', 'Check-in'];
const Q = { ID: 1, NAME: 2, VORNAME: 3, TICKET: 4, CODE: 5, BILD: 6, CHECKIN: 7 };

const COLOR_FULL = '#d9ead3';    // grün: alle Tickets eingecheckt
const COLOR_PARTIAL = '#fff2cc'; // gelb: teilweise eingecheckt
const COLOR_REVIEW = '#fce5cd';  // orange: Namens-Trennung beim Import unsicher

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Check-in')
    .addItem('Teilnehmer-PDFs hochladen', 'showUploadDialog')
    .addItem('Ticket-Anzahl pro Person festlegen', 'setTicketCount')
    .addItem('QR-Codes mit Ticket-Anzahl abgleichen', 'syncAllTickets')
    .addItem('Eintrittskarten (PDF) erzeugen', 'generateTicketPdf')
    .addSeparator()
    .addItem('Altes Teilnehmer-Blatt übernehmen (Migration)', 'migrateOldSheet')
    .addToUi();
}

function showUploadDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Upload')
    .setWidth(420).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Teilnehmer-PDFs hochladen');
}

/***** Blätter *****/

function getSheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function personenSheet_() {
  const sheet = getSheet_(PERSONEN_SHEET, P_HEADER);
  if (!sheet.isColumnHiddenByUser(P.ID)) sheet.hideColumns(P.ID);
  return sheet;
}

function qrSheet_() {
  return getSheet_(QR_SHEET, Q_HEADER);
}

/***** QR-Codes *****/

/**
 * Erzeugt den String, der im QR-Code landet.
 * Hier anpassen, falls euer Scanner ein bestimmtes Format erwartet.
 */
function buildQrString(anrede, name, vorname, gruppe, ort) {
  return Utilities.getUuid();
}

function qrImageFormula(qrString) {
  return '=IMAGE("https://quickchart.io/qr?size=200&text=" & ENCODEURL("' +
    qrString.replace(/"/g, '""') + '"))';
}

/***** PDF-Import (wird pro Datei aus dem Upload-Dialog aufgerufen) *****/

function processPdf(base64Data, fileName) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64Data), 'application/pdf', fileName);

  // PDF nach Drive hochladen und in ein Google Doc konvertieren
  const tempFile = Drive.Files.create(
    { name: fileName, mimeType: 'application/vnd.google-apps.document' },
    blob,
    { ocrLanguage: 'de' }
  );

  const doc = DocumentApp.openById(tempFile.id);
  const body = doc.getBody();

  // 1. Versuch: echte Tabellen im Doc auslesen (zuverlässigster Weg)
  let rows = extractFromTables(body).map(cells => [cells, false]);

  // 2. Fallback: Fließtext parsen
  if (rows.length === 0) {
    rows = extractFromText(body.getText());
  }

  Drive.Files.remove(tempFile.id);

  if (rows.length === 0) throw new Error(fileName + ': keine Datenzeilen gefunden.');

  const ps = personenSheet_();
  const qs = qrSheet_();
  const startRow = ps.getLastRow() + 1;

  // Jede importierte Person bekommt die über das Menü festgelegte
  // Ticket-Anzahl (Standard: 1)
  const n = defaultTicketCount_();
  const pValues = [];
  const tickets = [];
  rows.forEach(([cells]) => {
    const id = Utilities.getUuid();
    pValues.push(cells.concat([n, '0/' + n, '', id]));
    for (let k = 1; k <= n; k++) {
      const code = buildQrString.apply(null, cells);
      tickets.push([id, cells[1], cells[2], k + '/' + n, code, qrImageFormula(code), '']);
    }
  });

  ps.getRange(startRow, 1, pValues.length, P_HEADER.length).setValues(pValues);
  const qStart = qs.getLastRow() + 1;
  qs.getRange(qStart, 1, tickets.length, Q_HEADER.length).setValues(tickets);
  qs.setRowHeights(qStart, tickets.length, 60); // Platz für die QR-Bilder

  // Unsichere Namens-Trennungen orange markieren
  let flagged = 0;
  rows.forEach(([cells, unsicher], i) => {
    if (unsicher) {
      ps.getRange(startRow + i, 1, 1, P_HEADER.length).setBackground(COLOR_REVIEW);
      flagged++;
    }
  });

  return fileName + ': ' + pValues.length + ' Personen importiert' +
    (flagged ? ' (' + flagged + ' orange markierte bitte prüfen)' : '') + '.';
}

function extractFromTables(body) {
  const rows = [];
  const tables = body.getTables();
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    for (let r = 0; r < table.getNumRows(); r++) {
      const row = table.getRow(r);
      const cells = [];
      for (let c = 0; c < row.getNumCells(); c++) {
        // Zeilenumbrüche in Zellen ("Freiherr von\nSenden") glätten
        cells.push(row.getCell(c).getText().replace(/\s+/g, ' ').trim());
      }
      if (cells.length < 5) continue;
      if (cells[0] === 'Anrede') continue;            // Kopfzeile überspringen
      if (!/^(Herr|Frau)$/.test(cells[0])) continue;  // Leer-/Müllzeilen
      rows.push(cells.slice(0, 5));
    }
  }
  return rows;
}

function extractFromText(text) {
  const rows = [];
  // Findet jeden Datensatz einzeln, auch wenn mehrere in einem Absatz stehen:
  // Anrede ... Namen ... Studiengruppe (XX/XX/XXX) Studienort
  const re = /(Herr|Frau)\s+(.+?)\s+(\d{2}\/\d{2}\/\d+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tokens = m[2].replace(/\s+/g, ' ').trim().split(' ');
    // Spaltengrenze Name|Vorname ist im Fließtext nicht erkennbar.
    // Heuristik: letztes Wort = Vorname, Rest = Name. Bei mehr als zwei
    // Wörtern ist das unsicher -> Zeile wird zur Prüfung markiert.
    const vorname = tokens.pop();
    const name = tokens.join(' ');
    rows.push([[m[1], name, vorname, m[3], m[4]], tokens.length > 1]);
  }
  return rows;
}

/***** Ticket-Anzahl pro Person *****/

/**
 * Legt die Ticket-Anzahl für ALLE Personen auf der Liste fest
 * und gleicht die QR-Codes direkt ab.
 */
function setTicketCount() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Ticket-Anzahl festlegen',
    'Wie viele Tickets soll jede Person erhalten?',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const n = parseInt(resp.getResponseText(), 10);
  if (!(n >= 1 && n <= 20)) {
    ui.alert('Bitte eine Zahl zwischen 1 und 20 eingeben.');
    return;
  }

  // Merken, damit auch später importierte Personen diese Anzahl bekommen
  PropertiesService.getDocumentProperties()
    .setProperty('TICKET_COUNT', String(n));

  const ps = personenSheet_();
  const lastRow = ps.getLastRow();
  if (lastRow < 2) { ui.alert('Keine Personen vorhanden.'); return; }
  ps.getRange(2, P.TICKETS, lastRow - 1, 1)
    .setValues(Array.from({ length: lastRow - 1 }, () => [n]));
  ui.alert(syncTickets_());
}

function defaultTicketCount_() {
  const v = parseInt(
    PropertiesService.getDocumentProperties().getProperty('TICKET_COUNT'), 10);
  return v >= 1 && v <= 20 ? v : 1;
}

function syncAllTickets() {
  SpreadsheetApp.getUi().alert(syncTickets_());
}

/**
 * Bringt das QR-Blatt mit der Spalte "Tickets" in Einklang:
 * fehlende Tickets werden erzeugt, überzählige (noch nicht eingecheckte)
 * entfernt, die Nummerierung (1/2, 2/2, ...) aktualisiert.
 * Bereits eingecheckte Tickets werden nie gelöscht.
 */
function syncTickets_() {
  const ps = personenSheet_();
  const qs = qrSheet_();
  const lastP = ps.getLastRow();
  if (lastP < 2) return 'Keine Personen vorhanden.';

  const pData = ps.getRange(2, 1, lastP - 1, P_HEADER.length).getValues();

  // Vorhandene Tickets nach Personen-ID gruppieren
  const lastQ = qs.getLastRow();
  const byId = {};
  if (lastQ >= 2) {
    qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).getValues().forEach(row => {
      const id = row[Q.ID - 1];
      (byId[id] = byId[id] || []).push(row);
    });
  }

  const out = [];
  const greenRows = [];
  let added = 0, removed = 0;
  const problems = [];

  pData.forEach((p, i) => {
    if (!p[P.NAME - 1] && !p[P.VORNAME - 1]) return;
    const row = i + 2;

    // Manuell ergänzte Personen bekommen hier ihre ID
    let id = p[P.ID - 1];
    if (!id) {
      id = Utilities.getUuid();
      ps.getRange(row, P.ID).setValue(id);
    }

    let n = Math.max(1, parseInt(p[P.TICKETS - 1], 10) || 1);

    const tickets = byId[id] || [];
    const checked = tickets.filter(t => t[Q.CHECKIN - 1]);
    const open = tickets.filter(t => !t[Q.CHECKIN - 1]);

    // Reduktion unter die Zahl bereits erfolgter Check-ins ist nicht möglich
    if (checked.length > n) {
      problems.push(p[P.NAME - 1] + ', ' + p[P.VORNAME - 1] + ': bereits ' +
        checked.length + ' Check-ins – Ticket-Anzahl auf ' + checked.length + ' gesetzt.');
      n = checked.length;
    }
    if (p[P.TICKETS - 1] != n) ps.getRange(row, P.TICKETS).setValue(n);

    const keep = checked.concat(open).slice(0, n);
    removed += tickets.length - keep.length;
    while (keep.length < n) {
      const code = buildQrString(p[0], p[1], p[2], p[3], p[4]);
      keep.push([id, p[P.NAME - 1], p[P.VORNAME - 1], '', code, '', '']);
      added++;
    }

    keep.forEach((t, k) => {
      t[Q.TICKET - 1] = (k + 1) + '/' + n;
      t[Q.NAME - 1] = p[P.NAME - 1];
      t[Q.VORNAME - 1] = p[P.VORNAME - 1];
      t[Q.BILD - 1] = qrImageFormula(String(t[Q.CODE - 1]));
      if (t[Q.CHECKIN - 1]) greenRows.push(out.length + 2);
      out.push(t);
    });

    updatePersonStatus_(ps, row, keep.filter(t => t[Q.CHECKIN - 1]).length, n);
  });

  // QR-Blatt komplett neu schreiben (sortiert in Personen-Reihenfolge)
  if (lastQ >= 2) qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).clear();
  if (out.length) {
    qs.getRange(2, 1, out.length, Q_HEADER.length).setValues(out);
    qs.setRowHeights(2, out.length, 60);
    greenRows.forEach(r =>
      qs.getRange(r, 1, 1, Q_HEADER.length).setBackground(COLOR_FULL));
  }

  let msg = 'QR-Codes abgeglichen: ' + out.length + ' Tickets gesamt, ' +
    added + ' neu, ' + removed + ' entfernt.';
  if (problems.length) msg += '\n\nHinweise:\n' + problems.join('\n');
  return msg;
}

function updatePersonStatus_(ps, row, scanned, total) {
  ps.getRange(row, P.STATUS).setValue(scanned + '/' + total);
  const color = scanned === 0 ? null :
    (scanned >= total ? COLOR_FULL : COLOR_PARTIAL);
  ps.getRange(row, 1, 1, P_HEADER.length).setBackground(color);
}

/***** Check-in *****/

const TIME_FORMAT = 'dd.MM.yyyy HH:mm';

function fmt_(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), TIME_FORMAT);
}

function findPerson_(ps, id) {
  const lastRow = ps.getLastRow();
  if (lastRow < 2 || !id) return null;
  const data = ps.getRange(2, 1, lastRow - 1, P_HEADER.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][P.ID - 1] === id) {
      return { row: i + 2, anrede: data[i][0], name: data[i][1],
               vorname: data[i][2], gruppe: data[i][3], ort: data[i][4] };
    }
  }
  return null;
}

function stats_(qData) {
  let sumChecked = 0;
  qData.forEach(r => { if (r[Q.CHECKIN - 1]) sumChecked++; });
  return { sumChecked: sumChecked, sumTotal: qData.length };
}

/**
 * Gleicht einen gescannten Code mit dem QR-Blatt ab, trägt den Check-in ein
 * und aktualisiert den Zähler (1/2, 2/2, ...) auf dem Personen-Blatt.
 */
function checkIn(code) {
  code = String(code || '').trim();
  if (!code) return { status: 'invalid' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // verhindert Doppel-Check-ins bei mehreren Scannern
  try {
    const ps = personenSheet_();
    const qs = qrSheet_();
    const lastQ = qs.getLastRow();
    if (lastQ < 2) return { status: 'invalid' };

    const qData = qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).getValues();
    let hit = -1;
    for (let i = 0; i < qData.length; i++) {
      if (String(qData[i][Q.CODE - 1]).trim() === code) { hit = i; break; }
    }
    if (hit < 0) return Object.assign({ status: 'invalid' }, stats_(qData));

    const ticket = qData[hit];
    const person = findPerson_(ps, ticket[Q.ID - 1]);
    const label = person
      ? person.anrede + ' ' + person.vorname + ' ' + person.name
      : ticket[Q.VORNAME - 1] + ' ' + ticket[Q.NAME - 1];
    const info = person ? person.gruppe + ' · ' + person.ort : '';

    if (ticket[Q.CHECKIN - 1]) {
      return Object.assign({
        status: 'duplicate', person: label, info: info,
        ticket: String(ticket[Q.TICKET - 1]),
        time: fmt_(ticket[Q.CHECKIN - 1])
      }, stats_(qData));
    }

    const now = new Date();
    qs.getRange(hit + 2, Q.CHECKIN).setValue(now);
    qs.getRange(hit + 2, 1, 1, Q_HEADER.length).setBackground(COLOR_FULL);
    qData[hit][Q.CHECKIN - 1] = now;

    // Zähler und Zeiten auf dem Personen-Blatt nachführen
    let scanned = 0, total = 0;
    qData.forEach(r => {
      if (r[Q.ID - 1] === ticket[Q.ID - 1]) {
        total++;
        if (r[Q.CHECKIN - 1]) scanned++;
      }
    });
    if (person) {
      updatePersonStatus_(ps, person.row, scanned, total);
      const prev = ps.getRange(person.row, P.CHECKINS).getValue();
      ps.getRange(person.row, P.CHECKINS)
        .setValue(prev ? prev + ', ' + fmt_(now) : fmt_(now));
    }

    return Object.assign({
      status: 'ok', person: label, info: info,
      ticket: scanned + '/' + total,
      time: fmt_(now)
    }, stats_(qData));
  } finally {
    lock.releaseLock();
  }
}

/***** Web-App-Endpunkte *****/

// Liefert die Fallback-Scanner-Seite aus (ohne Live-Kamera, siehe README)
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Scanner')
    .setTitle('Ticket-Check-in')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  const code = (e.postData && e.postData.contents || '').trim();
  const res = checkIn(code);
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/***** Migration vom alten Ein-Blatt-Layout *****/

/**
 * Übernimmt das gerade geöffnete alte Teilnehmer-Blatt
 * (A Anrede ... F QR-Code, G QR-Bild, H Check-in) in die neue Struktur.
 * Das alte Blatt bleibt unverändert.
 */
function migrateOldSheet() {
  const ui = SpreadsheetApp.getUi();
  const old = SpreadsheetApp.getActiveSheet();
  if (old.getName() === PERSONEN_SHEET || old.getName() === QR_SHEET) {
    ui.alert('Bitte zuerst das alte Teilnehmer-Blatt öffnen und dann die Migration starten.');
    return;
  }
  const lastRow = old.getLastRow();
  if (lastRow < 2) { ui.alert('Keine Daten gefunden.'); return; }

  const data = old.getRange(2, 1, lastRow - 1, 8).getValues();
  const ps = personenSheet_();
  const qs = qrSheet_();

  const pValues = [], tickets = [], greenIdx = [];
  data.forEach(r => {
    if (!/^(Herr|Frau)$/.test(String(r[0]))) return;
    const id = Utilities.getUuid();
    const code = String(r[5]).trim() || Utilities.getUuid();
    const checkin = r[7];
    if (checkin) greenIdx.push(pValues.length);
    pValues.push([r[0], r[1], r[2], r[3], r[4], 1,
                  checkin ? '1/1' : '0/1', checkin ? fmt_(checkin) : '', id]);
    tickets.push([id, r[1], r[2], '1/1', code, qrImageFormula(code), checkin || '']);
  });
  if (!pValues.length) { ui.alert('Keine Datenzeilen (Herr/Frau in Spalte A) gefunden.'); return; }

  const pStart = ps.getLastRow() + 1;
  ps.getRange(pStart, 1, pValues.length, P_HEADER.length).setValues(pValues);
  const qStart = qs.getLastRow() + 1;
  qs.getRange(qStart, 1, tickets.length, Q_HEADER.length).setValues(tickets);
  qs.setRowHeights(qStart, tickets.length, 60);
  greenIdx.forEach(i => {
    ps.getRange(pStart + i, 1, 1, P_HEADER.length).setBackground(COLOR_FULL);
    qs.getRange(qStart + i, 1, 1, Q_HEADER.length).setBackground(COLOR_FULL);
  });

  ui.alert(pValues.length + ' Personen übernommen. ' +
    'Das alte Blatt wurde nicht verändert und kann nach Kontrolle gelöscht werden.');
}

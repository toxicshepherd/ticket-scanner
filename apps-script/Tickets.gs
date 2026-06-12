/***** Eintrittskarten als PDF erzeugen (Serien-Generierung über Google Slides) *****
 *
 * Schritt 1: Menü "Check-in" → "Karten-Vorlage (Slides) erzeugen".
 *   Importiert die fertige Vorlage (design/Eintrittskarten-Vorlage.pptx aus
 *   dem GitHub-Repo) als Google-Slides-Datei — mit exakter Kartengröße
 *   (21,2 x 10 cm) und zwei Folien: Vorderseite (QR-Platzhalter auf dem
 *   Abriss, Name + Ticket-Nr. darunter) und Rückseite. Die Vorlagen-ID
 *   wird automatisch gespeichert; in Slides beliebig nachjustierbar.
 *
 * Schritt 2: Menü "Check-in" → "Eintrittskarten (PDF) erzeugen".
 *   Pro Zeile im Blatt "QR-Codes" entstehen Vorder- UND Rückseite
 *   hintereinander (duplexfähig); das Druck-PDF landet in Google Drive.
 *   Voraussetzung: der erweiterte Dienst "Google Slides API" muss im
 *   Script-Editor aktiviert sein (Dienste → Slides API hinzufügen) —
 *   die Karten werden gebündelt per batchUpdate erzeugt, sonst dauert
 *   die Generierung viele Minuten.
 *
 * Platzhalter in der Vorlage:
 *   pro Ticket: {{QR}} (Rechteck, wird durch den QR-Code ersetzt),
 *               {{NAME}}, {{TICKET}}, {{GRUPPE}}, {{ORT}} (Studienort)
 *   Eckdaten vom Dashboard (für alle Karten gleich): {{ART}}, {{ART_GROSS}},
 *               {{JAHRGANG}}, {{DATUM}}, {{DATUM_LANG}}, {{UHRZEIT}},
 *               {{EINLASS}}, {{VERANSTALTUNGSORT}}
 */

// Fertige Vorlage in Kartengröße — liegt im GitHub-Repo
const TICKET_TEMPLATE_URL =
  'https://raw.githubusercontent.com/toxicshepherd/ticket-scanner/main/design/Eintrittskarten-Vorlage.pptx';

function templateId_() {
  return PropertiesService.getDocumentProperties().getProperty('TICKET_TEMPLATE_ID');
}

/** Importiert die Vorlage nach Google Slides und merkt sich ihre ID. */
function buildTicketTemplate() {
  const ui = SpreadsheetApp.getUi();

  // PPTX laden und von Drive nach Google Slides konvertieren lassen —
  // nur so bleibt die exakte Kartengröße erhalten (die Slides API
  // ignoriert pageSize beim Anlegen)
  const resp = UrlFetchApp.fetch(TICKET_TEMPLATE_URL,
    { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Vorlage konnte nicht von GitHub geladen werden ' +
      '(HTTP ' + resp.getResponseCode() + '). Ist das Repo erreichbar?');
  }
  // Ohne expliziten Dateityp lehnt die Drive-Konvertierung den Upload
  // als "Bad Request" ab (der Download kommt als octet-stream an)
  const blob = resp.getBlob()
    .setName('Eintrittskarten-Vorlage.pptx')
    .setContentType(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const file = Drive.Files.create(
    { name: 'Eintrittskarten-Vorlage',
      mimeType: 'application/vnd.google-apps.presentation' },
    blob
  );

  PropertiesService.getDocumentProperties()
    .setProperty('TICKET_TEMPLATE_ID', file.id);

  ui.alert('Vorlage erstellt und verknüpft (Folie 1 = Vorderseite, ' +
    'Folie 2 = Rückseite).\n\nZum Nachjustieren öffnen:\n' +
    'https://docs.google.com/presentation/d/' + file.id + '/edit');
}

/** Öffnet den Dialog mit Fortschrittsbalken, der die Generierung startet. */
function showTicketProgressDialog() {
  CacheService.getScriptCache().remove('TICKET_PROGRESS');
  const html = HtmlService.createHtmlOutputFromFile('TicketProgress')
    .setWidth(420).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, 'Eintrittskarten erzeugen');
}

function setProgress_(done, total, label) {
  CacheService.getScriptCache().put('TICKET_PROGRESS',
    JSON.stringify({ done: done, total: total, label: label }), 600);
}

function getTicketProgress() {
  const v = CacheService.getScriptCache().get('TICKET_PROGRESS');
  return v ? JSON.parse(v) : null;
}

/** Wird aus dem Fortschritts-Dialog per google.script.run aufgerufen. */
function generateTicketPdf() {
  const templateId = templateId_();
  if (!templateId) {
    throw new Error('Bitte zuerst über das Menü "Karten-Vorlage (Slides) ' +
      'erzeugen" die Vorlage anlegen.');
  }

  const qs = qrSheet_();
  const ps = personenSheet_();
  const lastQ = qs.getLastRow();
  if (lastQ < 2) throw new Error('Keine Tickets im Blatt "' + QR_SHEET + '" gefunden.');
  const qData = qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).getValues();

  setProgress_(0, qData.length, 'Vorlage wird kopiert …');

  // Personendaten (Anrede, Gruppe, Ort) über die ID dazuholen
  const persons = {};
  const lastP = ps.getLastRow();
  if (lastP >= 2) {
    ps.getRange(2, 1, lastP - 1, P_HEADER.length).getValues().forEach(p => {
      persons[p[P.ID - 1]] = p;
    });
  }

  // Vorlage kopieren und pro Ticket Vorder- + Rückseite anhängen.
  // Alle Operationen laufen gebündelt über die Slides API (batchUpdate),
  // sonst dauern hunderte Einzelaufrufe viele Minuten.
  const copy = DriveApp.getFileById(templateId)
    .makeCopy('Eintrittskarten ' + fmt_(new Date()));
  const presId = copy.getId();

  const pres = Slides.Presentations.get(presId);
  const frontId = pres.slides[0].objectId;
  const backId = pres.slides.length > 1 ? pres.slides[1].objectId : null;

  const tickets = qData.filter(t => String(t[Q.CODE - 1]).trim());
  let slideCount = pres.slides.length;
  const CHUNK = 30; // Karten pro batchUpdate-Aufruf

  for (let c = 0; c < tickets.length; c += CHUNK) {
    const built = cardRequests_(tickets.slice(c, c + CHUNK), persons,
      frontId, backId, slideCount, 't' + c + '_');
    slideCount = built.slideCount;
    Slides.Presentations.batchUpdate({ requests: built.requests }, presId);
    setProgress_(Math.min(c + CHUNK, tickets.length), tickets.length,
      'Karten werden erzeugt …');
  }

  // Eckdaten vom Dashboard einsetzen, Vorlagen-Folien entfernen
  const cleanup = settingsReplaces_();
  cleanup.push({ deleteObject: { objectId: frontId } });
  if (backId) cleanup.push({ deleteObject: { objectId: backId } });
  Slides.Presentations.batchUpdate({ requests: cleanup }, presId);

  setProgress_(tickets.length, tickets.length, 'PDF wird exportiert …');

  const pdf = DriveApp.createFile(
    copy.getAs('application/pdf').setName(copy.getName() + '.pdf'));
  copy.setTrashed(true); // Slides-Zwischendatei aufräumen

  // Für den Direkt-Download aus dem Sheet merken (Drive kann gesperrt sein)
  PropertiesService.getDocumentProperties()
    .setProperty('LAST_PDF_ID', pdf.getId());

  return { count: tickets.length, url: pdf.getUrl(),
           fileId: pdf.getId(), name: pdf.getName() };
}

function textReplace_(slideId, find, repl) {
  return { replaceAllText: {
    containsText: { text: find, matchCase: true },
    replaceText: String(repl || ''),
    pageObjectIds: [slideId]
  }};
}

/**
 * Ersetzt die Veranstaltungs-Platzhalter auf ALLEN Folien durch die
 * Eckdaten vom Dashboard-Blatt (siehe getEventSettings_ in Code.gs).
 */
function settingsReplaces_() {
  const s = getEventSettings_();
  return [
    ['{{ART_GROSS}}', s.art.toUpperCase()],
    ['{{ART}}', s.art],
    ['{{JAHRGANG}}', s.jahrgang],
    ['{{DATUM_LANG}}', s.datumLang],
    ['{{DATUM}}', s.datum],
    ['{{UHRZEIT}}', s.uhrzeit],
    ['{{EINLASS}}', s.einlass],
    ['{{VERANSTALTUNGSORT}}', s.ort]
  ].map(pair => ({ replaceAllText: {
    containsText: { text: pair[0], matchCase: true },
    replaceText: String(pair[1] || '')
  }}));
}

/**
 * Baut die batchUpdate-Requests für eine Gruppe Tickets:
 * pro Ticket Vorder- (+ Rück-)Seite duplizieren, ans Ende schieben,
 * Platzhalter ersetzen, QR-Bild einsetzen.
 */
function cardRequests_(tickets, persons, frontId, backId, startCount, prefix) {
  const requests = [];
  let slideCount = startCount;
  tickets.forEach((t, j) => {
    const code = String(t[Q.CODE - 1]).trim();
    const p = persons[t[Q.ID - 1]];
    const name = (p ? p[P.ANREDE - 1] + ' ' : '') +
      t[Q.VORNAME - 1] + ' ' + t[Q.NAME - 1];
    const fId = prefix + 'f' + j;
    const bId = prefix + 'b' + j;

    requests.push({ duplicateObject:
      { objectId: frontId, objectIds: { [frontId]: fId } } });
    const moveIds = [fId];
    if (backId) {
      requests.push({ duplicateObject:
        { objectId: backId, objectIds: { [backId]: bId } } });
      moveIds.push(bId);
    }
    slideCount += moveIds.length;
    requests.push({ updateSlidesPosition:
      { slideObjectIds: moveIds, insertionIndex: slideCount } });

    requests.push(textReplace_(fId, '{{NAME}}', name));
    requests.push(textReplace_(fId, '{{TICKET}}',
      'Ticket ' + ticketNo_(t[Q.TICKET - 1])));
    requests.push(textReplace_(fId, '{{GRUPPE}}', p ? p[P.GRUPPE - 1] : ''));
    requests.push(textReplace_(fId, '{{ORT}}', p ? p[P.ORT - 1] : ''));

    requests.push({ replaceAllShapesWithImage: {
      containsText: { text: '{{QR}}' },
      imageUrl: 'https://quickchart.io/qr?size=600&margin=1&text=' +
        encodeURIComponent(code),
      imageReplaceMethod: 'CENTER_INSIDE',
      pageObjectIds: [fId]
    }});
  });
  return { requests: requests, slideCount: slideCount };
}

/***** Einzel-PDFs pro Ticket für den Mailversand über Outlook *****
 *
 * Erzeugt pro Ticket eine eigene PDF (Vorder- + Rückseite) mit dem
 * Dateinamen "Nachname, Vorname - Ticket 1von3.pdf" und packt alles
 * in ZIP-Dateien (max. ~35 MB pro Teil) zum Direkt-Download.
 * Der Versand läuft dann über das Outlook-Makro (outlook/SendTickets.bas),
 * das alle Tickets einer Person in eine Mail hängt.
 */

function showZipDialog() {
  CacheService.getScriptCache().remove('TICKET_PROGRESS');
  const html = HtmlService.createHtmlOutputFromFile('ZipProgress')
    .setWidth(440).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Einzel-PDFs für Mailversand');
}

// pdf-lib zum Zerlegen der PDFs nachladen (einmal pro Lauf)
function loadPdfLib_() {
  // Apps Script kennt kein setTimeout; pdf-lib braucht es intern.
  // Synchroner Ersatz reicht hier völlig.
  if (typeof globalThis.setTimeout === 'undefined') {
    globalThis.setTimeout = function (fn) { fn(); return 0; };
    globalThis.clearTimeout = function () {};
  }
  const code = UrlFetchApp.fetch(
    'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js').getContentText();
  eval(code);
  return globalThis.PDFLib || PDFLib;
}

/** Wird aus dem ZIP-Dialog per google.script.run aufgerufen. */
async function generateTicketZips() {
  const templateId = templateId_();
  if (!templateId) {
    throw new Error('Bitte zuerst über das Menü "Karten-Vorlage (Slides) ' +
      'erzeugen" die Vorlage anlegen.');
  }

  const qs = qrSheet_();
  const ps = personenSheet_();
  const lastQ = qs.getLastRow();
  if (lastQ < 2) throw new Error('Keine Tickets im Blatt "' + QR_SHEET + '" gefunden.');
  const qData = qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).getValues();

  const persons = {};
  const lastP = ps.getLastRow();
  if (lastP >= 2) {
    ps.getRange(2, 1, lastP - 1, P_HEADER.length).getValues().forEach(p => {
      persons[p[P.ID - 1]] = p;
    });
  }

  const tickets = qData.filter(t => String(t[Q.CODE - 1]).trim());
  setProgress_(0, tickets.length, 'Einzel-PDFs werden erzeugt …');
  const PDFLib = loadPdfLib_();

  const SEG = 25;             // Tickets pro Zwischen-PDF (hält Speicher klein)
  const MAX_ZIP = 35 * 1024 * 1024; // Blob-Limit von Apps Script ist 50 MB
  const parts = [];
  const csvRows = ['Nachname;Vorname;Empfänger;Ticket;Datei'];
  let bucket = [], bucketSize = 0, partNo = 1;

  const flush = () => {
    if (!bucket.length) return;
    const zip = Utilities.zip(bucket, 'Eintrittskarten_Teil' + partNo + '.zip');
    const f = DriveApp.createFile(zip);
    parts.push({ fileId: f.getId(), name: f.getName() });
    partNo++;
    bucket = [];
    bucketSize = 0;
  };

  for (let s = 0; s < tickets.length; s += SEG) {
    const seg = tickets.slice(s, s + SEG);

    // Mini-Deck für dieses Segment bauen und als PDF exportieren
    const copy = DriveApp.getFileById(templateId).makeCopy('tmp Karten ' + s);
    const presId = copy.getId();
    const pres = Slides.Presentations.get(presId);
    const frontId = pres.slides[0].objectId;
    const backId = pres.slides.length > 1 ? pres.slides[1].objectId : null;

    const built = cardRequests_(seg, persons, frontId, backId,
      pres.slides.length, 'z' + s + '_');
    const cleanup = settingsReplaces_();
    cleanup.push({ deleteObject: { objectId: frontId } });
    if (backId) cleanup.push({ deleteObject: { objectId: backId } });
    Slides.Presentations.batchUpdate(
      { requests: built.requests.concat(cleanup) }, presId);

    const segPdf = copy.getAs('application/pdf');
    copy.setTrashed(true);

    // Segment-PDF in Einzel-PDFs (2 Seiten pro Ticket) zerlegen
    const pagesPerTicket = backId ? 2 : 1;
    const src = await PDFLib.PDFDocument.load(new Uint8Array(segPdf.getBytes()));
    for (let k = 0; k < seg.length; k++) {
      const doc = await PDFLib.PDFDocument.create();
      const idx = [];
      for (let pg = 0; pg < pagesPerTicket; pg++) idx.push(k * pagesPerTicket + pg);
      const copied = await doc.copyPages(src, idx);
      copied.forEach(page => doc.addPage(page));
      const bytes = await doc.save();

      const t = seg[k];
      const ticketLabel = String(ticketNo_(t[Q.TICKET - 1])).replace('/', 'von');
      const fname = t[Q.NAME - 1] + ', ' + t[Q.VORNAME - 1] +
        ' - Ticket ' + ticketLabel + '.pdf';
      csvRows.push([t[Q.NAME - 1], t[Q.VORNAME - 1],
        t[Q.VORNAME - 1] + ' ' + t[Q.NAME - 1], ticketLabel, fname].join(';'));

      if (bucketSize + bytes.length > MAX_ZIP) flush();
      bucket.push(Utilities.newBlob(bytes, 'application/pdf', fname));
      bucketSize += bytes.length;
    }
    setProgress_(Math.min(s + SEG, tickets.length), tickets.length,
      'Einzel-PDFs werden erzeugt …');
  }

  // Versandliste mit in den letzten Teil packen
  bucket.push(Utilities.newBlob(csvRows.join('\r\n'), 'text/csv', 'Versandliste.csv'));
  setProgress_(tickets.length, tickets.length, 'ZIP wird gepackt …');
  flush();

  PropertiesService.getDocumentProperties()
    .setProperty('LAST_ZIP_IDS', JSON.stringify(parts));
  return { count: tickets.length, parts: parts };
}

function getLastZips() {
  const v = PropertiesService.getDocumentProperties().getProperty('LAST_ZIP_IDS');
  return v ? JSON.parse(v) : null;
}

/***** Direkt-Download des PDFs aus dem Sheet (ohne Google Drive) *****/

const PDF_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB pro Häppchen

/**
 * Liefert das PDF stückweise als Base64 an den Dialog, der daraus im
 * Browser die Datei zusammensetzt — funktioniert auch dort, wo
 * drive.google.com gesperrt ist.
 */
function getPdfChunk(fileId, index) {
  const file = DriveApp.getFileById(fileId);
  const bytes = file.getBlob().getBytes();
  const start = index * PDF_CHUNK_SIZE;
  const end = Math.min(start + PDF_CHUNK_SIZE, bytes.length);
  return {
    data: Utilities.base64Encode(bytes.slice(start, end)),
    more: end < bytes.length,
    name: file.getName()
  };
}

function getLastPdf() {
  const id = PropertiesService.getDocumentProperties().getProperty('LAST_PDF_ID');
  if (!id) return null;
  try {
    return { fileId: id, name: DriveApp.getFileById(id).getName() };
  } catch (e) {
    return null; // Datei wurde gelöscht
  }
}

function showPdfDownloadDialog() {
  if (!getLastPdf()) {
    SpreadsheetApp.getUi().alert('Noch kein Karten-PDF erzeugt. Bitte zuerst ' +
      '"Eintrittskarten (PDF) erzeugen" ausführen.');
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('Download')
    .setWidth(380).setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, 'Karten-PDF herunterladen');
}

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
 *
 * Platzhalter in der Vorlage: {{QR}} (Rechteck, wird durch den QR-Code
 * ersetzt), {{NAME}}, {{TICKET}}, {{GRUPPE}}, {{ORT}}.
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
  const blob = UrlFetchApp.fetch(TICKET_TEMPLATE_URL).getBlob();
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

  // Vorlage kopieren und pro Ticket Vorder- + Rückseite anhängen
  const copy = DriveApp.getFileById(templateId)
    .makeCopy('Eintrittskarten ' + fmt_(new Date()));
  const deck = SlidesApp.openById(copy.getId());
  const tplSlides = deck.getSlides();
  const frontTpl = tplSlides[0];
  const backTpl = tplSlides.length > 1 ? tplSlides[1] : null;

  let done = 0;
  qData.forEach(t => {
    done++;
    if (done % 3 === 0 || done === qData.length) {
      setProgress_(done, qData.length, 'Karten werden erzeugt …');
    }
    const code = String(t[Q.CODE - 1]).trim();
    if (!code) return;
    const p = persons[t[Q.ID - 1]];
    const name = (p ? p[P.ANREDE - 1] + ' ' : '') +
      t[Q.VORNAME - 1] + ' ' + t[Q.NAME - 1];

    const slide = frontTpl.duplicate();
    slide.move(deck.getSlides().length); // ans Ende, hält die Reihenfolge
    slide.replaceAllText('{{NAME}}', name);
    slide.replaceAllText('{{TICKET}}', 'Ticket ' + ticketNo_(t[Q.TICKET - 1]));
    slide.replaceAllText('{{GRUPPE}}', p ? String(p[P.GRUPPE - 1]) : '');
    slide.replaceAllText('{{ORT}}', p ? String(p[P.ORT - 1]) : '');

    // {{QR}}-Rechteck durch das QR-Bild ersetzen (behält Größe/Position)
    slide.getShapes().forEach(shape => {
      const txt = shape.getText && shape.getText().asString();
      if (txt && txt.indexOf('{{QR}}') !== -1) {
        shape.replaceWithImage(
          'https://quickchart.io/qr?size=600&margin=1&text=' +
          encodeURIComponent(code));
      }
    });

    // Rückseite direkt hinter die Vorderseite
    if (backTpl) backTpl.duplicate().move(deck.getSlides().length);
  });

  // Vorlagen-Folien aus dem Ergebnis entfernen
  frontTpl.remove();
  if (backTpl) backTpl.remove();
  setProgress_(qData.length, qData.length, 'PDF wird exportiert …');
  deck.saveAndClose();

  const pdf = DriveApp.createFile(
    copy.getAs('application/pdf').setName(copy.getName() + '.pdf'));
  copy.setTrashed(true); // Slides-Zwischendatei aufräumen

  return { count: qData.length, url: pdf.getUrl() };
}

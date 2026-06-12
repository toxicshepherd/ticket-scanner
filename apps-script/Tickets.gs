/***** Eintrittskarten als PDF erzeugen (Serien-Generierung über Google Slides) *****
 *
 * Schritt 1: Menü "Check-in" → "Karten-Vorlage (Slides) erzeugen".
 *   Baut die Slides-Vorlage automatisch: Karten-Design als Hintergrund,
 *   QR-Code-Platzhalter auf dem Abriss (vorne links), Name + Ticket-Nr.
 *   darunter. Die Vorlagen-ID wird automatisch gespeichert.
 *   Voraussetzung: der erweiterte Dienst "Google Slides API" muss im
 *   Script-Editor aktiviert sein (Dienste → Slides API hinzufügen) —
 *   er wird nur für das Anlegen mit der richtigen Foliengröße gebraucht.
 *   Die Vorlage kann danach in Slides beliebig nachjustiert werden.
 *
 * Schritt 2: Menü "Check-in" → "Eintrittskarten (PDF) erzeugen".
 *   Pro Zeile im Blatt "QR-Codes" entsteht eine Karte; das fertige
 *   Druck-PDF wird in Google Drive abgelegt.
 *
 * Platzhalter in der Vorlage: {{QR}} (Rechteck, wird durch den QR-Code
 * ersetzt), {{NAME}}, {{TICKET}}, {{GRUPPE}}, {{ORT}}.
 */

// Karten-Design (Vorderseite, 300 dpi) — liegt im GitHub-Repo
const TICKET_DESIGN_URL =
  'https://raw.githubusercontent.com/toxicshepherd/ticket-scanner/main/design/karte-vorderseite.png';

// Kartenmaß in Punkt (aus dem InDesign-PDF: 21,2 x 10 cm)
const CARD_W = 600.945;
const CARD_H = 283.465;

function templateId_() {
  return PropertiesService.getDocumentProperties().getProperty('TICKET_TEMPLATE_ID');
}

/** Baut die Slides-Vorlage automatisch und merkt sich ihre ID. */
function buildTicketTemplate() {
  const ui = SpreadsheetApp.getUi();

  // Folie in Kartengröße anlegen (geht nur über die Slides API)
  const created = Slides.Presentations.create({
    title: 'Eintrittskarten-Vorlage',
    pageSize: {
      width:  { magnitude: CARD_W, unit: 'PT' },
      height: { magnitude: CARD_H, unit: 'PT' }
    }
  });
  const deck = SlidesApp.openById(created.presentationId);
  const slide = deck.getSlides()[0];
  slide.getPageElements().forEach(el => el.remove()); // Standard-Platzhalter weg

  // Design als Hintergrund in voller Kartengröße
  slide.insertImage(TICKET_DESIGN_URL, 0, 0, CARD_W, CARD_H);

  // {{QR}}-Rechteck oben auf dem Abriss (Abriss = linke ~114 pt)
  const qr = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 14.5, 22, 85, 85);
  qr.getFill().setSolidFill('#FFFFFF');
  qr.getBorder().setTransparent();
  qr.getText().setText('{{QR}}');
  qr.getText().getTextStyle().setFontSize(10).setForegroundColor('#000000');
  qr.getText().getParagraphStyle()
    .setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // Name + Ticket-Nr. unter dem QR-Code, weiß auf blau
  const tb = slide.insertTextBox('{{NAME}}\n{{TICKET}}', 4, 112, 106, 42);
  const text = tb.getText();
  text.getTextStyle().setFontSize(8).setForegroundColor('#FFFFFF');
  text.getParagraphStyle()
    .setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  text.getRange(0, '{{NAME}}'.length).getTextStyle().setBold(true);

  deck.saveAndClose();
  PropertiesService.getDocumentProperties()
    .setProperty('TICKET_TEMPLATE_ID', created.presentationId);

  ui.alert('Vorlage erstellt und verknüpft.\n\nZum Nachjustieren öffnen:\n' +
    'https://docs.google.com/presentation/d/' + created.presentationId + '/edit');
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

  // Vorlage kopieren und pro Ticket eine Folie füllen
  const copy = DriveApp.getFileById(templateId)
    .makeCopy('Eintrittskarten ' + fmt_(new Date()));
  const deck = SlidesApp.openById(copy.getId());
  const template = deck.getSlides()[0];

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

    const slide = template.duplicate();
    slide.replaceAllText('{{NAME}}', name);
    slide.replaceAllText('{{TICKET}}', 'Ticket ' + t[Q.TICKET - 1]);
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
  });

  template.remove(); // Vorlagen-Folie aus dem Ergebnis entfernen
  setProgress_(qData.length, qData.length, 'PDF wird exportiert …');
  deck.saveAndClose();

  const pdf = DriveApp.createFile(
    copy.getAs('application/pdf').setName(copy.getName() + '.pdf'));
  copy.setTrashed(true); // Slides-Zwischendatei aufräumen

  return { count: qData.length, url: pdf.getUrl() };
}

/***** Eintrittskarten als PDF erzeugen (Serien-Generierung über Google Slides) *****
 *
 * Einmalige Vorbereitung:
 * 1. Neue Google-Slides-Präsentation anlegen, Seitenformat auf die Karten-
 *    größe stellen (Datei → Seiteneinrichtung → Benutzerdefiniert,
 *    z. B. 21 x 9,9 cm für DIN lang).
 * 2. Das Karten-Design als Bild einfügen (PDF-Seite vorher als PNG/JPG
 *    exportieren) und auf die volle Foliengröße ziehen.
 * 3. Dort, wo der QR-Code hin soll, ein Rechteck einfügen, das als Text
 *    nur {{QR}} enthält. Größe/Position des Rechtecks = Größe des QR-Codes.
 * 4. Optional Textfelder mit Platzhaltern einfügen:
 *    {{NAME}}, {{TICKET}}, {{GRUPPE}}, {{ORT}}
 * 5. Die ID der Präsentation (aus der URL zwischen /d/ und /edit)
 *    unten bei TICKET_TEMPLATE_ID eintragen.
 *
 * Danach: Menü "Check-in" → "Eintrittskarten (PDF) erzeugen".
 * Pro Zeile im Blatt "QR-Codes" entsteht eine Karte; das fertige PDF
 * wird in Google Drive abgelegt.
 */

const TICKET_TEMPLATE_ID = 'HIER_SLIDES_VORLAGEN_ID_EINTRAGEN';

function generateTicketPdf() {
  const ui = SpreadsheetApp.getUi();
  if (TICKET_TEMPLATE_ID.indexOf('HIER_') === 0) {
    ui.alert('Bitte zuerst in Tickets.gs die ID der Slides-Vorlage bei ' +
      'TICKET_TEMPLATE_ID eintragen (Anleitung im Dateikopf).');
    return;
  }

  const qs = qrSheet_();
  const ps = personenSheet_();
  const lastQ = qs.getLastRow();
  if (lastQ < 2) { ui.alert('Keine Tickets im Blatt "' + QR_SHEET + '" gefunden.'); return; }
  const qData = qs.getRange(2, 1, lastQ - 1, Q_HEADER.length).getValues();

  // Personendaten (Anrede, Gruppe, Ort) über die ID dazuholen
  const persons = {};
  const lastP = ps.getLastRow();
  if (lastP >= 2) {
    ps.getRange(2, 1, lastP - 1, P_HEADER.length).getValues().forEach(p => {
      persons[p[P.ID - 1]] = p;
    });
  }

  // Vorlage kopieren und pro Ticket eine Folie füllen
  const copy = DriveApp.getFileById(TICKET_TEMPLATE_ID)
    .makeCopy('Eintrittskarten ' + fmt_(new Date()));
  const deck = SlidesApp.openById(copy.getId());
  const template = deck.getSlides()[0];

  qData.forEach(t => {
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
  deck.saveAndClose();

  const pdf = DriveApp.createFile(
    copy.getAs('application/pdf').setName(copy.getName() + '.pdf'));
  copy.setTrashed(true); // Slides-Zwischendatei aufräumen

  ui.alert(qData.length + ' Eintrittskarten erzeugt.\n\nPDF in Google Drive:\n' +
    pdf.getUrl());
}

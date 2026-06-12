# Ticket-Scanner

Check-in-System für Veranstaltungen: Teilnehmer werden per PDF in ein Google Sheet
importiert, bekommen pro Person eine einstellbare Anzahl QR-Code-Tickets, und am
Einlass werden die Codes mit der Handykamera über diese Scanner-Seite gescannt.

**Scanner (GitHub Pages):** https://toxicshepherd.github.io/ticket-scanner/

## Aufbau

| Teil | Ort |
|---|---|
| `index.html` | Scanner-Seite, gehostet über GitHub Pages |
| `apps-script/Code.gs` | Apps Script (an das Google Sheet gebunden): PDF-Import, Ticket-Verwaltung, Check-in-Endpunkt |
| `apps-script/Upload.html` | Dialog zum Hochladen mehrerer Teilnehmer-PDFs |
| `apps-script/Scanner.html` | Fallback-Scanner direkt in der Web-App (nur Foto-Modus, da Apps Script die Live-Kamera blockiert) |

### Tabellenstruktur

Das Script legt zwei Blätter automatisch an:

- **Personen** — eine Zeile pro Person: Anrede, Name, Vorname, Studiengruppe,
  Studienort, **Tickets** (Anzahl), **Eingecheckt** (z. B. `1/2`, `2/2`),
  **Check-ins** (Datum + Uhrzeit jedes Scans). Farben: gelb = teilweise
  eingecheckt, grün = vollständig eingecheckt, orange = Namens-Trennung beim
  PDF-Import unsicher (bitte prüfen).
- **QR-Codes** — eine Zeile pro Ticket: Name, Vorname, Ticket-Nr. (z. B. `2/2`),
  QR-String, QR-Bild, Check-in-Zeitstempel. Eingecheckte Tickets werden grün.

Die ausgeblendete Spalte „ID" auf dem Personen-Blatt verknüpft beide Blätter —
nicht löschen.

## Bedienung (Menü „Check-in" im Sheet)

- **Teilnehmer-PDFs hochladen** — eine oder mehrere PDFs auswählen; jede Person
  bekommt automatisch die zuletzt festgelegte Ticket-Anzahl (Standard: 1).
- **Ticket-Anzahl pro Person festlegen** — gilt immer für **alle** Personen auf
  der Liste (auch für spätere Importe); QR-Codes werden automatisch
  erzeugt/entfernt und neu nummeriert (`1/3`, `2/3`, `3/3`). Bereits
  eingecheckte Tickets werden nie gelöscht. Nach einer Migration einmal
  ausführen, damit auch die übernommenen Personen die richtige Anzahl erhalten.
- **Karten-Vorlage (Slides) erzeugen** — importiert die fertige Vorlage
  (`design/Eintrittskarten-Vorlage.pptx`) als Google-Slides-Datei in exakter
  Kartengröße (21,2 × 10 cm) mit zwei Folien: Vorderseite (QR-Platzhalter auf
  dem Abriss, Name + Ticket-Nr. darunter) und Rückseite. Die Vorlagen-ID wird
  automatisch gespeichert; die Vorlage kann danach in Slides nachjustiert werden.
- **Eintrittskarten (PDF) erzeugen** — Serien-Generierung aus der Vorlage
  (`apps-script/Tickets.gs`): pro Ticket Vorder- **und** Rückseite
  hintereinander (duplexfähig), mit personalisiertem QR-Code und den
  Platzhaltern `{{NAME}}`, `{{TICKET}}`, `{{GRUPPE}}`, `{{ORT}}`.
  Das fertige Druck-PDF landet in Google Drive.
- **Altes Teilnehmer-Blatt übernehmen (Migration)** — überführt ein Blatt im
  alten Ein-Blatt-Layout (QR in Spalte F, Check-in in Spalte H) in die neue
  Struktur; vorhandene Codes und Check-ins bleiben gültig.

## Scanner-Seite

Zeigt nach jedem Scan groß und farbig:

- **grün:** „✔ Eingecheckt (Ticket 1/2)" mit Name, Studiengruppe · Studienort und Uhrzeit
- **gelb:** „⚠ BEREITS EINGECHECKT" mit Person, Ticket-Nr. und ursprünglicher Einlasszeit
- **rot:** „✘ Ungültiger Code"

plus Vibration und Gesamt-Zähler („Eingecheckt gesamt: X von Y Tickets").
Nach jedem Scan geht es automatisch nach 3 Sekunden weiter; der
„Weiter"-Button überspringt die Wartezeit.

## Einrichtung

1. **Apps Script:** Inhalte aus `apps-script/` in den an das Sheet gebundenen
   Script-Editor kopieren (`Code.gs`, plus HTML-Dateien `Upload` und `Scanner`).
   Der erweiterte Dienst **Drive API** muss aktiviert sein (für den PDF-Import).
2. **Web-App bereitstellen:** Bereitstellen → Neue Bereitstellung → Web-App,
   Zugriff „Jeder". Die `/exec`-URL kopieren. Nach Code-Änderungen die
   Bereitstellung aktualisieren, sonst läuft die alte Version weiter.
3. **Scanner verbinden:** Beim ersten Aufruf der Scanner-Seite die `/exec`-URL
   eingeben (wird im `localStorage` gespeichert; später änderbar über
   „⚙ API-URL ändern" unten auf der Seite) — oder als fertigen Link verteilen
   (die URL aus dem Link wird ebenfalls dauerhaft gespeichert):
   ```
   https://toxicshepherd.github.io/ticket-scanner/?api=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
   ```
4. **GitHub Pages:** Settings → Pages → Source „Deploy from a branch",
   Branch `main`, Ordner `/ (root)`.

## Hinweise

- **HTTPS ist Pflicht:** Browser geben die Kamera (`getUserMedia`) nur über HTTPS
  frei. GitHub Pages liefert automatisch HTTPS.
- Die Scanner-Seite wird bewusst **extern** (GitHub Pages) gehostet: Apps Script
  HtmlService rendert Seiten in einem sandboxed iframe, der den Live-Kamerazugriff
  blockiert. Die mitgelieferte `Scanner.html` in der Web-App dient nur als
  Foto-Fallback.
- Der POST an Apps Script verwendet `Content-Type: text/plain` und
  `redirect: "follow"`, damit kein CORS-Preflight entsteht (den Apps Script nicht
  beantwortet) und der `/exec`-Weiterleitung gefolgt wird.

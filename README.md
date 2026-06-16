# Eintrittskarten – Polizeiakademie Niedersachsen (Offline)

Zwei eigenständige HTML-Dateien für **Ausgabe** und **Einlasskontrolle** digitaler
Eintrittskarten – **vollständig offline**, ohne Installation, ohne Internet, ohne
externe Dienste. Beide Dateien werden einfach **per Doppelklick** im Browser
geöffnet (auch auf einem abgeschotteten Windows-PC).

| Datei | Zweck |
|---|---|
| **`ticket-generator.html`** | Organisator: liest die Teilnehmer-Liste (Excel/CSV) und erzeugt personalisierte Karten-PDFs (Vorder- + Rückseite) im Polizeiakademie-Design, dazu `tokens.json` und ein Versand-Manifest – alles in **einer ZIP**. |
| **`einlass-scanner.html`** | Einlass: prüft Codes gegen `tokens.json`, entwertet gültige Tickets, exportiert den Stand. |
| `beispiel-teilnehmer.csv` | 10 Demozeilen im Spalten-Layout der Gesamtliste. |

Alle Bibliotheken (QR-Erzeugung, PDF, ZIP, Excel-Import, Kamera-QR-Erkennung) und
die Karten-Hintergründe (aus der PowerPoint-Vorlage) sind als Quellcode bzw. Bild
**direkt eingebettet**. Es gibt **keine** `<script src>`-Tags, keinen `fetch`-/
Netzwerkzugriff, keine CDN-Aufrufe. Im DevTools-Netzwerk-Tab erscheint keine
externe Anfrage.

## Bedienung in 5 Schritten

1. **Generator öffnen.** `ticket-generator.html` doppelklicken. Oben unter
   **„Anlass & Texte"** die passende **Vorlage** wählen (Abschlussfeier,
   Vereidigung, Dienstbesprechung, Ernennung …) und Datum/Jahrgang/Ort
   bei Bedarf anpassen.
2. **Liste laden.** Die **Excel-Datei** (`.xlsx`, z. B. die Gesamtliste) oder eine
   CSV auswählen. Bei Excel das **Tabellenblatt** wählen (Standard: erstes Blatt,
   „ausgeplant" wird übersprungen). Die Spalten *Anrede, Name, Vorname, StO,
   Einstellungsjahr, neue StGr* werden automatisch erkannt – Zuordnung kurz prüfen.
3. **Karten erzeugen.** Tickets pro Person setzen (Standard 1), dann
   **„Karten erzeugen & ZIP herunterladen"**. Es entsteht je ein PDF
   (Vorder-/Rückseite) pro Ticket, plus `tokens.json` und `versand_manifest.csv`.
4. **Versenden.** Die PDFs aus der ZIP entpacken und per Outlook-Makro
   (`outlook/SendTickets.bas`) verschicken – der Dateiname
   `Nachname, Vorname - Ticket 1von2.pdf` wird vom Makro automatisch der richtigen
   Person zugeordnet.
5. **Einlass kontrollieren.** `einlass-scanner.html` am Eingangs-PC öffnen,
   **`tokens.json`** laden und Codes mit dem **USB-2D-Scanner** (oder der Kamera,
   falls erlaubt) scannen. Ampel: **grün = gültig**, **gelb = bereits benutzt**,
   **rot = ungültig**. Regelmäßig **„Stand sichern"** klicken; nach einem Neustart
   mit **„Stand laden"** fortsetzen.

> **Datenhaltung:** Auf `file://` ist `localStorage` unzuverlässig. Der
> Einlass-Stand bleibt nur **im Speicher** – daher regelmäßig als Datei sichern
> (der Scanner erinnert automatisch alle 25 Scans).

## ticket-generator.html

- **Eingabe:** Excel (`.xlsx`/`.xls`, SheetJS eingebettet) mit Blattauswahl, oder
  CSV (Trennzeichen `;`/`,`/Tab automatisch). Spalten der Gesamtliste werden per
  Synonym automatisch zugeordnet (`Name` → Nachname, `StO` → Studienort,
  `neue StGr` → Studiengruppe); manuell korrigierbar.
- **Token:** pro Ticket ein zufälliges, nicht erratbares Token (16 Byte aus
  `crypto.getRandomValues` → base64url). QR-Inhalt = **nur das Token**.
- **Karte (PDF):** A6-Querformat (212 × 100 mm), Vorder- + Rückseite im
  Original-Design (Hintergrund aus der PPTX-Vorlage). Aufdruck: QR + Name +
  „Ticket k/N" auf dem Abriss links, Anlass/Datum/Ort rechts.
- **Mehrere Tickets pro Person:** durchnummeriert `1/N … N/N`, jedes mit eigenem
  Token und eigener PDF-Datei.
- **Ausgabe (eine ZIP):** je ein PDF pro Ticket, `tokens.json`
  `{token, anrede, vorname, nachname, studienort, einstellungsjahr,
  studiengruppe, ticketNr, ticketAnzahl}` (nur für den Scanner) und
  `versand_manifest.csv` (`Nachname;Vorname;TicketNr;Anzahl;Dateiname`).
- **Fortschrittsanzeige** auch bei vielen Hundert Karten.

## einlass-scanner.html

- `tokens.json` laden. Zwei Eingabewege: **USB-2D-Scanner** (Tastatur, Enter prüft –
  Standardweg) und **Kamera** (falls vom Browser erlaubt, sonst sauberer Fallback).
- Prüflogik: gültig → **grün** + Name, Ticket-Nr., Studiengruppe/Studienort;
  schon benutzt → **gelb** + letzte Einlasszeit; nicht in Liste → **rot**.
- Zähler „Eingecheckt: X / Gesamt", Verlauf, Ton/Vibration. **Stand sichern/laden**
  als CSV (`token;name;zeit;ergebnis`) zur Wiederaufnahme; Hinweis alle 25 Scans.

## Konfigurieren

- **Anlass/Datum/Ort:** in der Oberfläche unter „Anlass & Texte" (Vorlagen +
  freie Felder). Neue Vorlagen: im `<script>`-Block von
  `src/ticket-generator.template.html` das Objekt `VORLAGEN` ergänzen.
- **Spalten:** Standard ist das Gesamtlisten-Layout; weitere Überschriften über
  die Synonym-Listen in `src/core-generator.js` (`SYNONYME`) ergänzbar.
- **Karten-Design austauschen:** Hintergrundbilder in `src/assets/front.jpg`
  (neutrale Vorderseite) und `src/assets/back.jpg` (Rückseite) ersetzen; die
  Textpositionen stehen klar markiert in `zeichneFront()` in
  `src/core-generator.js` (Maße in mm, direkt aus der `.pptx` übernommen). Danach
  neu bauen (siehe unten).

## Sicherheit

Fälschungsschutz über **zufällige 128-Bit-Token** + **Mitgliedschaftsprüfung** gegen
`tokens.json`: nur enthaltene Tokens sind gültig, Tokens sind praktisch nicht
erratbar, der QR enthält keine personenbezogenen Daten. `tokens.json` bleibt
vertraulich (nur am Einlass-PC).

## Hinweise

- **Kamera per Doppelklick (`file://`)** wird von vielen Browsern gesperrt – der
  **USB-2D-Scanner** ist der vorgesehene, immer funktionierende Weg.
- Excel bitte als normale `.xlsx` speichern; CSV als **UTF-8**.

## Neu bauen (für Entwickler)

Die fertigen Dateien sind eingecheckt und sofort lauffähig. Nach Änderungen an
`src/…`, `vendor/…` oder `src/assets/…`:

```
node build.mjs           # bettet vendor + assets + src/core-*.js in die HTML ein
node test/test-core.mjs  # Logik-Tests (ohne Zusatzpakete)
```

| Ordner/Datei | Inhalt |
|---|---|
| `vendor/` | eingebettete Libs: qrcode-generator, jsPDF, JSZip, jsQR, xlsx (mini) |
| `src/assets/` | Karten-Hintergründe (front/back) aus der PowerPoint-Vorlage |
| `src/core-generator.js`, `src/core-scanner.js` | reine Logik (Browser **und** Tests) |
| `src/*.template.html` | Oberflächen mit `<!--INLINE:…-->`-Markern |
| `build.mjs` | fügt alles zu zwei eigenständigen HTML zusammen, prüft auf externe Referenzen |

Bibliotheken: qrcode-generator (MIT), jsPDF (MIT), JSZip (MIT/GPLv3), jsQR
(Apache-2.0), SheetJS/xlsx (Apache-2.0). Karten-Design/Logo: Polizeiakademie
Niedersachsen.

---
---

# Alt-System (Google Sheets / Apps Script) — benötigt Internet

> Das folgende, ältere System (`index.html` + `apps-script/` + `outlook/` +
> `design/`) arbeitet mit einem Google Sheet, Google Apps Script und einem über
> GitHub Pages gehosteten Online-Scanner. Es **benötigt Internet und Google-Dienste**
> und wird für den oben beschriebenen, abgeschotteten Offline-PC durch das
> Offline-System ersetzt. Die Dokumentation bleibt hier erhalten.

Check-in-System für Veranstaltungen: Teilnehmer werden per XLSX-Liste in ein
Google Sheet importiert, bekommen pro Person eine einstellbare Anzahl QR-Code-Tickets, und am
Einlass werden die Codes mit der Handykamera über diese Scanner-Seite gescannt.

**Scanner (GitHub Pages):** https://toxicshepherd.github.io/ticket-scanner/

## Aufbau

| Teil | Ort |
|---|---|
| `index.html` | Scanner-Seite, gehostet über GitHub Pages |
| `apps-script/Code.gs` | Apps Script (an das Google Sheet gebunden): XLSX-Import, Ticket-Verwaltung, Check-in-Endpunkt |
| `apps-script/Upload.html` | Dialog zum Hochladen mehrerer Teilnehmerlisten (XLSX) |
| `apps-script/Scanner.html` | Fallback-Scanner direkt in der Web-App (nur Foto-Modus, da Apps Script die Live-Kamera blockiert) |

### Tabellenstruktur

Das Script legt zwei Blätter automatisch an:

- **Personen** — eine Zeile pro Person: Anrede, Name, Vorname, Studiengruppe,
  Studienort, Einstellungsjahr, **Tickets** (Anzahl), **Eingecheckt**
  (z. B. `1/2`, `2/2`), **Check-ins** (Datum + Uhrzeit jedes Scans).
  Farben: gelb = teilweise eingecheckt, grün = vollständig eingecheckt.
- **QR-Codes** — eine Zeile pro Ticket: Name, Vorname, Ticket-Nr. (z. B. `2/2`),
  QR-String, QR-Bild, Check-in-Zeitstempel. Eingecheckte Tickets werden grün.

Die ausgeblendete Spalte „ID" auf dem Personen-Blatt verknüpft beide Blätter —
nicht löschen.

## Mailversand über Outlook

1. Im Sheet **„Einzel-PDFs für Mailversand (ZIP) erzeugen"** ausführen und die
   ZIP(s) in einen Ordner entpacken (z. B. `C:\Eintrittskarten`).
2. Das Makro `outlook/SendTickets.bas` in Outlook einbinden
   (Alt+F11 → Modul einfügen → Code hineinkopieren), oben `TICKET_FOLDER`
   anpassen und `EintrittskartenVersenden` ausführen (Alt+F8).
3. Das Makro hängt **alle Tickets einer Person in eine Mail**, löst den
   Empfänger als „Vorname Nachname" über das Outlook-Adressbuch auf und legt
   die Mails standardmäßig als **Entwürfe** an (`SEND_DIRECT = True` für
   Direktversand).

## Einrichtung (Alt-System)

1. **Apps Script:** Inhalte aus `apps-script/` in den an das Sheet gebundenen
   Script-Editor kopieren (`Code.gs`, plus HTML-Dateien `Upload` und `Scanner`).
   Die erweiterten Dienste **Drive API** und **Slides API** müssen aktiviert sein.
2. **Web-App bereitstellen:** Bereitstellen → Neue Bereitstellung → Web-App,
   Zugriff „Jeder". Die `/exec`-URL kopieren.
3. **Scanner verbinden:** Beim ersten Aufruf der Scanner-Seite die `/exec`-URL
   eingeben (im `localStorage` gespeichert), oder als Link verteilen:
   ```
   https://toxicshepherd.github.io/ticket-scanner/?api=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
   ```
4. **GitHub Pages:** Settings → Pages → Source „Deploy from a branch",
   Branch `main`, Ordner `/ (root)`.

- **HTTPS ist Pflicht:** Browser geben die Kamera (`getUserMedia`) nur über HTTPS
  frei. GitHub Pages liefert automatisch HTTPS.

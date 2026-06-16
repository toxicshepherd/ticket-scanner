# Ticket-Scanner – Offline-System

Zwei eigenständige HTML-Dateien für **Ausgabe** und **Einlasskontrolle** digitaler
Eintrittskarten – **vollständig offline**, ohne Installation, ohne Internet, ohne
externe Dienste. Gedacht für einen einzelnen, stark eingeschränkten Windows-PC:
beide Dateien werden einfach **per Doppelklick** im Browser geöffnet.

| Datei | Zweck |
|---|---|
| **`ticket-generator.html`** | Organisator: erzeugt aus einer CSV personalisierte Ticket-PDFs, `tokens.json` und ein Versand-Manifest (alles in einer ZIP). |
| **`einlass-scanner.html`** | Einlass: scannt/prüft Codes gegen `tokens.json`, entwertet gültige Tickets, exportiert den Stand. |
| `beispiel-teilnehmer.csv` | 10 Demozeilen zum Ausprobieren. |

Alle benötigten Bibliotheken (QR-Erzeugung, PDF, ZIP, Kamera-QR-Erkennung) sind als
Quellcode **direkt in die HTML eingebettet**. Es gibt **keine** `<script src>`-Tags,
keinen `fetch`-/Netzwerkzugriff und keine CDN-Aufrufe. Im DevTools-Netzwerk-Tab
erscheint keine einzige externe Anfrage.

---

## Bedienung in 5 Schritten

1. **Teilnehmerliste vorbereiten.** Eine CSV mit den Spalten
   `Anrede; Vorname; Nachname; Email; Block; Platz` (Trennzeichen `;` oder `,`,
   UTF-8). Als Vorlage dient `beispiel-teilnehmer.csv`.
2. **Tickets erzeugen.** `ticket-generator.html` doppelklicken → oben ggf.
   Anlass/Datum/Ort anpassen → CSV auswählen → Spaltenzuordnung kurz prüfen →
   **„Tickets erzeugen & ZIP herunterladen"**. Es entsteht eine ZIP mit je einem
   A6-PDF pro Person, `tokens.json` und `versand_manifest.csv`.
3. **PDFs versenden.** Die PDFs aus der ZIP per Mail verteilen. Das
   `versand_manifest.csv` (`Email;Dateiname`) ordnet einem Outlook-Makro den
   richtigen Anhang zu (siehe `outlook/SendTickets.bas`).
4. **Scanner vorbereiten.** `einlass-scanner.html` am Einlass-PC doppelklicken
   und **`tokens.json`** laden. `tokens.json` bleibt **lokal** und wird nur hier
   gebraucht – niemals an die Gäste geben.
5. **Einlass kontrollieren.** Code mit dem **USB-2D-Scanner** scannen (er tippt in
   das Eingabefeld, `Enter` prüft) – oder über die Kamera, falls der Browser sie
   freigibt. Ampel: **grün = gültig**, **gelb = bereits benutzt**, **rot =
   ungültig**. Regelmäßig **„Stand sichern"** (CSV) klicken; nach einem Neustart
   mit **„Stand laden"** fortsetzen.

> **Wichtig (Datenhaltung):** Auf `file://` ist `localStorage` unzuverlässig. Der
> Einlass-Stand wird daher nur **im Speicher** gehalten. Verlassen Sie sich nicht
> darauf – sichern Sie den Stand regelmäßig als Datei (der Scanner erinnert
> automatisch alle 25 Scans daran).

---

## ticket-generator.html

- **Eingabe:** CSV per Datei-Auswahl. Trennzeichen (`;`/`,`/Tab) und UTF-8 werden
  automatisch erkannt; ein UTF-8-BOM wird entfernt. Die Spalten werden anhand der
  Überschrift automatisch zugeordnet und können in der Oberfläche korrigiert werden.
- **Token:** pro Zeile ein zufälliges, nicht erratbares Token (16 Byte aus
  `crypto.getRandomValues` → base64url, 22 Zeichen).
- **QR-Code:** lokal erzeugt; Inhalt ist **ausschließlich das Token** – keine
  personenbezogenen Daten im QR.
- **PDF:** A6-Karte mit Anlass/Datum/Ort, Name, Block + Platz und QR. Der QR wird
  als gestochen scharfe Vektorgrafik gezeichnet (gut scanbar im Druck).
- **Ausgabe (eine ZIP):**
  - je ein PDF pro Person (Dateiname-Muster konfigurierbar, Standard enthält
    Nachname/Vorname/Email),
  - `tokens.json` – alle gültigen Tickets `{token, anrede, vorname, nachname,
    email, block, platz}` (nur für den Scanner),
  - `versand_manifest.csv` – `Email;Dateiname`.
- **Fortschrittsanzeige** auch bei ~1.000 PDFs; läuft komplett im Browser.

## einlass-scanner.html

- **Liste laden:** `tokens.json` per Datei-Auswahl.
- **Zwei Eingabewege:**
  1. **USB-2D-Scanner als Tastatur** (robuster Standardweg): Code landet im
     Eingabefeld, `Enter` prüft. Das Feld bleibt automatisch fokussiert.
  2. **Kamera** (eingebettete QR-Erkennung), falls der Browser sie erlaubt –
     sonst sauberer Hinweis und Rückfall auf den Scanner-Modus.
- **Prüflogik:**
  - in Liste + noch nicht benutzt → **grün „Gültig"** + Name/Block/Platz, danach
    als benutzt markiert (mit Zeitstempel),
  - in Liste + schon benutzt → **gelb „Bereits benutzt"** + letzte Einlasszeit,
  - nicht in Liste → **rot „Ungültig"**.
- **Zähler** „Eingecheckt: X / Gesamt", Verlauf der letzten Scans, akustisches/
  haptisches Feedback.
- **„Stand sichern"** → Einlass-Log als CSV (`token; name; zeit; ergebnis`).
  **„Stand laden"** → Log wieder importieren (Wiederaufnahme nach Neustart; mehrere
  Logs werden zusammengeführt, Dubletten entfernt). Automatischer Hinweis alle 25
  Scans.

---

## Konfigurieren

### Anlass / Datum / Ort (und Ticket-Design)
Am Anfang des `<script>`-Blocks in **`ticket-generator.html`** steht der Block
`KONSTANTEN` (Anlass, Datum, Uhrzeit, Ort, Fußzeile, QR-Fehlerkorrektur,
Dateiname-Muster, Farbe). Diese Werte sind die Standardvorgaben; in der Oberfläche
lassen sie sich pro Lauf überschreiben.

### CSV-Spalten
Standard: `Anrede, Vorname, Nachname, Email, Block, Platz`. Andere Überschriften
werden über Synonyme erkannt (z. B. „Name" → Nachname, „E-Mail" → Email). Stimmt die
automatische Zuordnung nicht, kann sie in der Oberfläche per Auswahlfeld korrigiert
werden.

### Ticket-Design ändern
Das Layout ist an **zwei klar markierten Stellen** hinterlegt und sollte parallel
angepasst werden:
- **PDF:** Funktion `zeichneTicket(doc, rec, cfg)` in `src/core-generator.js`
  (Maße in mm, A6 = 105 × 148).
- **HTML-Vorschau:** der Block `<!-- VORLAGE: HTML-Karte -->` samt CSS-Klassen
  `.karte …` in `src/ticket-generator.template.html`.

Nach Änderungen an `src/…` die Dateien neu bauen (siehe unten). Wer nur Texte/Farben
in der fertigen `ticket-generator.html` anpassen will, kann den `KONSTANTEN`-Block
und die `zeichneTicket`-Funktion auch direkt dort suchen.

---

## Sicherheit / Fälschungsschutz

Tickets sind durch **zufällige 128-Bit-Token** + **Mitgliedschaftsprüfung gegen die
Liste** abgesichert: Nur Tokens, die in `tokens.json` stehen, sind gültig; Tokens
sind praktisch nicht erratbar. Der QR enthält keine personenbezogenen Daten. Eine
optionale HMAC-Signatur ist nicht nötig, solange `tokens.json` vertraulich bleibt
(nur am Einlass-PC).

## Hinweise / Fehlerbehebung

- **Kamera bleibt grau / „nicht verfügbar":** Beim Öffnen per Doppelklick
  (`file://`) geben viele Browser die Kamera nicht frei – das ist erwartet. Der
  **USB-2D-Scanner** ist der vorgesehene, immer funktionierende Weg.
- **Falsche/leere CSV oder JSON:** Beide Tools zeigen klare deutsche Fehlermeldungen.
- **Umlaute:** Die PDFs unterstützen deutsche Umlaute/ß. CSV bitte als **UTF-8**
  speichern.

---

## Neu bauen (optional, für Entwickler)

Die fertigen Dateien `ticket-generator.html` und `einlass-scanner.html` sind
eingecheckt und sofort lauffähig. Wer Quellen oder Bibliotheken ändert, baut sie neu:

```
node build.mjs          # bettet vendor/ + src/core-*.js in die Vorlagen ein
node test/test-core.mjs  # 48 Tests der reinen Logik (ohne Zusatzpakete)
```

Aufbau des Quellbaums:

| Ordner/Datei | Inhalt |
|---|---|
| `vendor/` | eingebettete Bibliotheken: qrcode-generator, jsPDF, JSZip, jsQR (+ `LIZENZEN.md`) |
| `src/core-generator.js`, `src/core-scanner.js` | reine Logik (im Browser **und** in den Tests genutzt) |
| `src/*.template.html` | Oberflächen mit `<!--INLINE:…-->`-Markern |
| `build.mjs` | fügt alles zu den zwei eigenständigen HTML zusammen und prüft auf externe Referenzen |
| `test/test-core.mjs` | Token-, CSV-, Mapping-, PDF/ZIP-, QR-Round-Trip- und Prüflogik-Tests |

Bibliotheken: qrcode-generator (MIT), jsPDF (MIT), JSZip (MIT/GPLv3), jsQR (Apache-2.0).

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

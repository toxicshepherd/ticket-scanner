# Eintrittskarten – Polizeiakademie Niedersachsen

Drei schlanke HTML-Werkzeuge + ein optionaler Sync-Dienst. **Personendaten
bleiben lokal** – auf die (gehostete) Scanner-Seite gelangen nur anonyme Tokens.

| Teil | Wo | Zweck |
|---|---|---|
| **`ticket-generator.html`** | lokal (Doppelklick) | Excel/CSV einlesen → Karten-PDFs (Vorder-/Rückseite) + **`tokens.json`** (nur Token + Ticket-Nr.) + **`zuordnung.csv`** (Token ↔ Klarname, bleibt lokal). |
| **`einlass-scanner.html`** / `index.html` | gehostet über **HTTPS** (empfohlen: **Cloudflare Pages**, alternativ GitHub Pages) | scannt per **Kamera oder USB-Handscanner**, prüft gegen `tokens.json`, synchronisiert mehrere Geräte in Echtzeit (optional), exportiert das Ergebnis. |
| **`auswertung.html`** | lokal (Doppelklick) | gleicht die (anonymen) Scan-Ergebnisse mit `zuordnung.csv` ab → Klarnamen-Ergebnis + **Doppelscan-/Vorfallbericht**. |
| `backend/` | **Cloudflare Worker** (optional, EU-gepinnt) | Echtzeit-Sync mehrerer Scan-Geräte; speichert **nur Token + Zeit + Gerätename**, keine Personendaten. |

> **Empfehlung: alles bei Cloudflare (kostenlos).** Cloudflare **Pages** hostet den
> Scanner (wie GitHub Pages, deployt direkt aus dem Repo) und der Cloudflare
> **Worker** übernimmt den Live-Sync — ein Anbieter, kostenloser Plan, Daten per
> `jurisdiction:"eu"` in der EU. Schritt-für-Schritt: [`backend/README.md`](backend/README.md).

## Datenschutz / Aufteilung

- **`tokens.json`** (öffentlich, wird hochgeladen): nur `{token, ticketNr, ticketAnzahl}` – keine Namen.
- **`zuordnung.csv`** (bleibt lokal beim Organisator): verknüpft Token ↔ Nachname/Vorname/Studiengruppe/…
- Der **Sync-Dienst** sieht nur Tokens + Zeitstempel. Die Auflösung auf Klarnamen passiert **ausschließlich lokal** in `auswertung.html`.

## Ablauf

1. **Generieren (lokal).** `ticket-generator.html` öffnen → Anlass-Vorlage wählen, Felder prüfen → Excel/CSV laden → „Karten erzeugen". Ergebnis-ZIP enthält die PDFs, `tokens.json` und `zuordnung.csv`.
2. **Versenden.** PDFs aus der ZIP per Outlook-Makro (`outlook/SendTickets.bas`) verschicken (Dateiname `Nachname, Vorname - Ticket 1von2.pdf`).
3. **Hochladen.** Nur **`tokens.json`** in das GitHub-Pages-Repo legen (in den Ordner neben `index.html`); der Scanner lädt sie automatisch. `zuordnung.csv` **lokal** sicher aufbewahren.
4. **Einlass.** Scanner über HTTPS öffnen — die Pages-Startseite **ist** der Scanner: `https://toxicshepherd.github.io/ticket-scanner/` (Kamera/USB). Bei mehreren Geräten denselben Sync-Dienst + dieselbe Event-Kennung eintragen → live gemeinsamer Stand und gerätübergreifende Doppelerkennung.

> **Hosting:** Empfohlen **Cloudflare Pages** (Repo verbinden, kein Build, Ausgabe `/`) — siehe [`backend/README.md`](backend/README.md). Alternativ **GitHub Pages** (Settings → Pages → Branch `main`, Ordner `/ (root)`). In beiden Fällen ist `index.html` der Scanner; `tokens.json` ins Repo-Root legen.
5. **Auswerten (lokal).** Nach dem Einlass „Ergebnis sichern" (CSV) und in `auswertung.html` zusammen mit `zuordnung.csv` laden → Klarnamen-Ergebnis, Doppelscan-Vorfälle, Nicht-Erschienene.

## ticket-generator.html (lokal)

- **Eingabe:** Excel (`.xlsx`, SheetJS eingebettet, Blattauswahl, „ausgeplant" wird übersprungen) oder CSV. Spalten *Anrede / Name / Vorname / StO / Einstellungsjahr / neue StGr* werden automatisch erkannt.
- **Anlass-Vorlagen** (Abschlussfeier, Vereidigung, Dienstbesprechung, Ernennung) füllen die Textfelder vor; alles editierbar.
- **Mehrere Tickets pro Person** (`1/N … N/N`), jedes mit eigenem Token.
- **Design:** Original-Karte (A6-Quer 212×100 mm, Vorder-/Rückseite) – Hintergrund aus der PowerPoint-Vorlage in voller Auflösung (~300 dpi). Option „Kompakte PDFs" für sehr große Mengen.
- **QR:** enthält nur das Zufalls-Token (16 Byte → base64url).

## einlass-scanner.html (über HTTPS hosten)

- Lädt `tokens.json` automatisch von der Seite (oder manuell per Datei).
- **Kamera** (jsQR, Rückkamera bevorzugt, Kamera-Auswahl) **und USB-Handscanner** (Tastatur, Enter) parallel.
- Ampel grün/gelb/rot. Da die Liste anonym ist, zeigt der Scanner **keine Namen**, sondern Ticket-Nr. + Token (für die spätere Zuordnung).
- **Echtzeit-Sync (optional):** unter „Einstellungen" Sync-URL, Event-Kennung, Schlüssel, Gerätename eintragen – oder per Link `…/einlass-scanner.html?api=<URL>&event=<EVENT>&key=<KEY>&device=<NAME>`. Alle Geräte mit derselben Event-Kennung teilen den Stand; ein an Gerät A entwertetes Ticket gilt sofort auch an Gerät B.
- **„Ergebnis sichern":** mit Sync exportiert es das **gerätübergreifende** Gesamtergebnis, sonst den lokalen Stand (CSV). Ohne Sync zusätzlich „Stand laden" zur Wiederaufnahme.

> **Warum HTTPS?** Kamera (`getUserMedia`) und mehrere andere Browser-Funktionen sind nur in einem „sicheren Kontext" (HTTPS oder `http://localhost`) verfügbar – per Doppelklick (`file://`) gesperrt. Deshalb wird der Scanner gehostet; der USB-Handscanner funktioniert in jedem Fall.

## Mehrgeräte-Sync einrichten (`backend/`, Cloudflare)

Optional, für Echtzeit über mehrere Geräte. Speichert nur Tokens + Zeit + Gerät
(keine Personendaten). Zwei Wege — **vollständige Anleitung:**
[`backend/README.md`](backend/README.md):

- **Ohne Installation, nur im Browser** (für gesperrte Rechner): Worker im
  Cloudflare-**Dashboard** anlegen, Code aus `backend/worker-kv.js` einfügen,
  KV-Namespace binden, `SCAN_KEY` als Secret setzen.
- **Mit EU-Datenstandort** (Durable Object, `jurisdiction:"eu"`): `backend/worker.js`
  per `npx wrangler deploy` auf einem Rechner mit Node.

Danach Worker-URL/Event/Schlüssel im Scanner unter „Einstellungen" eintragen oder als
`?api=…&event=…&key=…`-Link verteilen. Lokal testen ohne Cloudflare:
`node backend/mock-server.mjs`.

## auswertung.html (lokal, für Vorfälle & Abschluss)

`zuordnung.csv` + eine oder mehrere Ergebnis-Exporte (Backend-Gesamtexport
*oder* einzelne Geräte-Logs) laden. Ergebnis:

- **Eingecheckt** – Klarnamen + Zeit + Gerät.
- **Doppelscan-Vorfälle** – Tokens mit mehrfachem Einlass, auf Klarname aufgelöst, inkl. aller Scans (Zeit/Gerät) – für die Klärung „zu wem gehört das doppelt gescannte Ticket?".
- **Nicht erschienen** und **unbekannte Codes**.
- Export als `ergebnis_klarnamen.csv` bzw. `vorfall_bericht.csv`.

## Konfigurieren

- **Anlass-Texte:** Oberfläche („Anlass & Texte") oder Objekt `VORLAGEN` in `src/ticket-generator.template.html`.
- **Spalten:** Synonyme in `src/core-generator.js` (`SYNONYME`).
- **Karten-Design:** `src/assets/front.jpg` / `back.jpg` ersetzen; Textpositionen (aus der `.pptx` übernommen) in `zeichneFront()` in `src/core-generator.js`.

## Sicherheit

Zufällige 128-Bit-Token + Mitgliedschaftsprüfung gegen `tokens.json`; Tokens sind
praktisch nicht erratbar. Keine Personendaten im QR, in `tokens.json` oder im
Sync-Dienst. Der Sync-Dienst ist über einen gemeinsamen Schlüssel (`X-Key`)
geschützt.

## Neu bauen (für Entwickler)

```
node build.mjs           # bettet vendor + assets + src/core-*.js in generator/scanner ein
node test/test-core.mjs  # Generator-/Scanner-Logik
node test/test-sync.mjs  # Echtzeit-Sync gegen den lokalen Mock-Dienst
```

| Ordner/Datei | Inhalt |
|---|---|
| `vendor/` | qrcode-generator, jsPDF, JSZip, jsQR, xlsx (mini) |
| `src/assets/` | Karten-Hintergründe (front/back) aus der PowerPoint-Vorlage |
| `src/core-generator.js`, `src/core-scanner.js` | reine Logik (Browser **und** Tests) |
| `src/*.template.html` | Oberflächen mit `<!--INLINE:…-->`-Markern |
| `auswertung.html` | eigenständig (keine externen Libs) |
| `backend/` | Cloudflare Worker (`worker.js`, `wrangler.toml`) + lokaler Mock |

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

> Hinweis: Die GitHub-Pages-Startseite (`index.html`) ist jetzt der **neue
> Scanner** des Offline-Systems. Der alte Apps-Script-Scanner wurde nach
> `legacy-google-scanner.html` archiviert.

## Aufbau

| Teil | Ort |
|---|---|
| `legacy-google-scanner.html` | alte Scanner-Seite (früher `index.html`), Apps-Script-Anbindung |
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

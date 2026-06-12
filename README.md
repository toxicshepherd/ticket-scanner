# Ticket-Scanner

Statische Scanner-Seite für das Ticket-Check-in-System. Die Seite scannt QR-Codes
mit der Handykamera und meldet den gescannten Code an ein Google-Apps-Script,
das die Teilnehmerliste in Google Sheets abgleicht und den Check-in-Zeitstempel einträgt.

**Live-URL (GitHub Pages):** https://toxicshepherd.github.io/ticket-scanner/

## Einrichtung

### 1. Apps-Script-Web-App-URL eintragen

Beim ersten Aufruf fragt die Seite nach der URL der Apps-Script-Web-App
(die `/exec`-URL aus der Bereitstellung, Zugriff: „Jeder"). Die URL wird im
`localStorage` des Browsers gespeichert und muss nur einmal pro Gerät eingegeben werden.

Alternativ kann die URL als Parameter übergeben werden, z. B. zum Verteilen
eines fertigen Links an das Einlass-Team:

```
https://toxicshepherd.github.io/ticket-scanner/?api=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

### 2. GitHub Pages aktivieren

Im Repository unter **Settings → Pages**:

- **Source:** Deploy from a branch
- **Branch:** `main`, Ordner `/ (root)`

Nach wenigen Minuten ist die Seite unter https://toxicshepherd.github.io/ticket-scanner/ erreichbar.

## Hinweise

- **HTTPS ist Pflicht:** Browser geben die Kamera (`getUserMedia`) nur über HTTPS
  frei. GitHub Pages liefert automatisch HTTPS — die Seite daher nicht lokal über
  `file://` oder unverschlüsseltes HTTP verwenden.
- Die Seite wird bewusst **extern** (GitHub Pages) gehostet und nicht über Apps Script
  ausgeliefert: `HtmlService` rendert Seiten in einem sandboxed iframe, der den
  Kamerazugriff blockiert.
- Der POST an Apps Script verwendet `Content-Type: text/plain` und `redirect: "follow"`,
  damit kein CORS-Preflight entsteht (den Apps Script nicht beantwortet) und der
  `/exec`-Weiterleitung gefolgt wird.

## Ergebnisanzeige

| Antwort des Scripts | Anzeige |
|---|---|
| `{status: "ok", person: …}` | grün: „✔ [Person] eingecheckt" |
| `{status: "duplicate", person: …, time: …}` | gelb: „⚠ BEREITS EINGECHECKT ([Zeit]): [Person]" |
| `{status: "invalid"}` | rot: „✘ Ungültiger Code" |

Nach jedem Treffer pausiert der Scanner; mit **„Nächsten scannen"** geht es weiter.

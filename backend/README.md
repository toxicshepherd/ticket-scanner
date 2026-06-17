# Einlass-Sync auf Cloudflare (kostenlos)

Alles bei **einem** Anbieter: **Scanner** als statische Seite über **Cloudflare
Pages**, **Echtzeit-Sync** als **Cloudflare Worker**. Speichert nur **Token +
Zeit + Gerätename** – keine Personendaten.

> **Ohne Installation, nur im Browser** (für gesperrte Dienst-Rechner): siehe
> Weg 1. Wer Node installieren darf und den Datenstandort fest an die **EU**
> binden will, nimmt Weg 2.

---

## Scanner hosten (Cloudflare Pages) — reine Browser-Bedienung

1. cloudflare.com → Konto → **Workers & Pages → Create → Pages → Connect to Git** → dieses Repo, Branch `main`.
2. **Kein Build-Befehl**, Ausgabeverzeichnis `/`. Deploy → `https://<projekt>.pages.dev/` (HTTPS → Kamera geht).
3. **`tokens.json`** (aus der Generator-ZIP, PII-frei) ins Repo legen — am einfachsten über die **GitHub-Weboberfläche** (Repo → *Add file → Upload files*). Der Scanner lädt sie automatisch.

> **⚠ Wichtig bei `npx wrangler deploy` (Workers Static Assets):** Cloudflare lädt
> sonst **das ganze Repo** öffentlich hoch – inklusive `.git/` und der **lokalen
> PII-Werkzeuge** `ticket-generator.html` / `auswertung.html`. Die Datei
> **`.assetsignore`** im Repo-Root verhindert das und gibt **nur** `index.html`,
> `einlass-scanner.html` und `tokens.json` frei. Nach dem Deploy gegenprüfen:
> `https://<host>/.git/config` muss **404** liefern.

Damit läuft der Scanner schon — auf beliebig vielen Geräten **unabhängig**
(Doppelscans werden am Ende in `auswertung.html` erkannt). Für **Live**-Sync über
alle Geräte zusätzlich einen der folgenden Wege.

---

## Weg 1 — Worker per Cloudflare-Dashboard (ohne Installation)

Nutzt `worker-kv.js` (ein KV-Namespace, keine Migration). Alles im Browser:

1. **Workers & Pages → Create application → Worker** → Namen vergeben → **Deploy**.
2. **Edit code** → Inhalt von **`backend/worker-kv.js`** komplett einfügen → **Deploy**.
3. **Storage & Databases → KV → Create namespace** (z. B. `einlass`).
4. Zurück zum Worker → **Settings → Bindings → Add → KV namespace**:
   Variablenname **`EINLASS`** → den Namespace wählen → speichern.
5. **Settings → Variables and Secrets → Add → Secret**: Name **`SCAN_KEY`**,
   Wert = frei gewählter gemeinsamer Schlüssel → Deploy.

Worker-URL: `https://<worker-name>.<konto>.workers.dev`.

> Hinweis Datenstandort: Cloudflare **KV** ist global repliziert (nicht fest EU).
> Gespeichert werden nur Zufalls-Tokens + Zeit + Gerätename (keine Namen). Wenn der
> Datenstandort zwingend in der EU liegen muss → **Weg 2**.

## Weg 2 — Worker per wrangler, EU-Datenstandort (Durable Object)

Auf einem Rechner mit Node (nicht zwingend ein Dienst-Rechner). Nutzt `worker.js`
+ `wrangler.toml` (Durable Object, `jurisdiction:"eu"` → Daten bleiben in der EU):

```
cd backend
npx wrangler login
npx wrangler secret put SCAN_KEY
npx wrangler deploy
```

---

## Scanner verbinden

Auf jedem Einlass-Gerät die Pages-Seite öffnen → **Einstellungen** → Worker-URL,
Event-Kennung, Schlüssel, Gerätename eintragen. Oder als Link verteilen:

```
https://<projekt>.pages.dev/?api=https://<worker>.workers.dev&event=abschlussfeier-2026&key=GEHEIM&device=Eingang-Nord
```

Alle Geräte mit derselben **Event-Kennung** teilen den Stand in Echtzeit; ein an
einem Gerät entwertetes Ticket gilt sofort an allen anderen.

## Protokoll (alle Anfragen mit Header `X-Key: <SCAN_KEY>`)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/scan` `{event,token,device}` | prüft/markiert → `{status:"first"\|"duplicate", firstZeit, firstDevice, eingecheckt}` |
| GET | `/state?event=E&since=N` | neue Ereignisse seit `N` + Zähler (Polling ~2,5 s) |
| GET | `/export?event=E` | Gesamtergebnis als CSV (`token;device;zeit;status`) |
| POST | `/reset` `{event}` | Stand dieses Events löschen |

## Lokal testen (ohne Cloudflare)

```
node mock-server.mjs            # http://localhost:8787, gleiches Protokoll
node ../test/test-sync.mjs      # zwei simulierte Geräte gegen den Mock
node ../test/test-worker-kv.mjs # KV-Worker-Logik gegen In-Memory-KV
```

## Datenschutz

Im Dienst liegen ausschließlich Zufalls-Tokens (128 Bit) + Zeit + Gerätename, keine
Personendaten. Klarnamen-Auflösung nur lokal in `auswertung.html`. Cloudflare ist dem
EU Cloud Code of Conduct beigetreten (BSI-C5); mit Weg 2 (`JURISDICTION="eu"`)
bleiben die Daten in der EU.

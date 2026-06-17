# Einlass-Sync auf Cloudflare (kostenlos, EU)

Alles bei **einem** Anbieter, kostenlos: der **Scanner** als statische Seite über
**Cloudflare Pages**, der **Echtzeit-Sync** als **Cloudflare Worker** (Durable
Object). Der Dienst speichert nur **Tokens + Zeitstempel + Gerätename** – keine
Personendaten – und ist über `jurisdiction:"eu"` an **EU-Rechenzentren** gebunden.

## A) Scanner hosten (Cloudflare Pages)

1. Cloudflare-Konto anlegen → **Workers & Pages → Create → Pages → Connect to Git**.
2. Dieses Repo wählen, Branch `main`. **Kein Build-Befehl**, Ausgabeverzeichnis `/`
   (die Seite ist statisch; `index.html` ist der Scanner).
3. Nach dem Deploy ist der Scanner unter `https://<projekt>.pages.dev/` erreichbar
   (HTTPS → Kamera funktioniert).
4. **`tokens.json`** (aus der Generator-ZIP, PII-frei) ins Repo-Root legen/committen –
   der Scanner lädt sie automatisch.

## B) Sync-Dienst deployen (Cloudflare Worker)

Voraussetzung: Node.js. Im Ordner `backend/`:

```
npx wrangler login
npx wrangler secret put SCAN_KEY      # gemeinsamen Schlüssel eingeben (frei wählbar)
npx wrangler deploy                    # gibt die Worker-URL aus: https://einlass-sync.<konto>.workers.dev
```

- Durable Objects mit SQLite-Speicher laufen im **kostenlosen** Plan.
- `JURISDICTION="eu"` in `wrangler.toml` hält die Daten in der EU.
- `ALLOW_ORIGIN` optional auf die Pages-URL einschränken (z. B.
  `https://<projekt>.pages.dev`).

## C) Scanner mit dem Sync-Dienst verbinden

Auf jedem Einlass-Gerät die Scanner-Seite öffnen → **Einstellungen** → Worker-URL,
Event-Kennung, Schlüssel, Gerätename eintragen. Oder als fertigen Link verteilen:

```
https://<projekt>.pages.dev/?api=https://einlass-sync.<konto>.workers.dev&event=abschlussfeier-2026&key=GEHEIM&device=Eingang-Nord
```

Alle Geräte mit derselben **Event-Kennung** teilen den Stand in Echtzeit; ein an
einem Gerät entwertetes Ticket gilt sofort an allen anderen.

## Protokoll (alle Anfragen mit Header `X-Key: <SCAN_KEY>`)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/scan` `{event,token,device}` | prüft/markiert → `{status:"first"\|"duplicate", firstZeit, firstDevice, eingecheckt}` |
| GET | `/state?event=E&since=N` | neue Ereignisse seit `N` + Zähler (Polling alle ~2,5 s) |
| GET | `/export?event=E` | Gesamtergebnis als CSV (`token;device;zeit;status`) |
| POST | `/reset` `{event}` | Stand dieses Events löschen |

## Lokal testen (ohne Cloudflare)

```
node mock-server.mjs          # http://localhost:8787, gleiches Protokoll
node ../test/test-sync.mjs    # zwei simulierte Geräte gegen den Mock
```

## Datenschutz

Im Dienst liegen ausschließlich Zufalls-Tokens (128 Bit) + Zeit + Gerätename, keine
Personendaten. Die Auflösung auf Klarnamen passiert nur lokal in `auswertung.html`.
Cloudflare ist dem EU Cloud Code of Conduct beigetreten (BSI-C5-Testat); mit
`JURISDICTION="eu"` bleiben die Daten in der EU.

/* Node-Tests der reinen Logik (Polizeiakademie-Variante).
 * Lädt dieselben vendor-Bibliotheken + Karten-Hintergründe wie die HTML.
 * Aufruf:  node test/test-core.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const V = path.join(ROOT, 'vendor') + '/', A = path.join(ROOT, 'src', 'assets') + '/';

const qrcode = require(V + 'qrcode-generator.js');
const jsqr = require(V + 'jsqr.js');
const jspdfNS = require(V + 'jspdf.umd.min.js');
const JSZip = require(V + 'jszip.min.js');
const XLSX = require(V + 'xlsx.mini.min.js');
const jsQR = jsqr.default || jsqr;
const jsPDF = jspdfNS.jsPDF || (jspdfNS.default && jspdfNS.default.jsPDF);
globalThis.qrcode = qrcode;

const TG = require(path.join(ROOT, 'src', 'core-generator.js'));
const TS = require(path.join(ROOT, 'src', 'core-scanner.js'));
const b64 = (f, m) => 'data:' + m + ';base64,' + fs.readFileSync(A + f).toString('base64');
const assets = { front: b64('front.jpg', 'image/jpeg'), back: b64('back.jpg', 'image/jpeg') };

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ FAIL: ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')'); }
function sec(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- GENERATOR ---------------- */
sec('Token');
ok(/^[A-Za-z0-9_-]{22}$/.test(TG.neuerToken()), 'Token 22-stellig base64url');
const set = new Set(); for (let i = 0; i < 3000; i++) set.add(TG.neuerToken());
ok(set.size === 3000, 'Tokens eindeutig (3000)');

sec('Spalten-Mapping (echtes Listen-Layout)');
const HEADER = ['Anrede', 'Name', 'Vorname', 'StO', 'Einstellungsjahr', 'bisherige StGr', 'Zuteilung', 'neue StGr'];
const map = TG.autoMapping(HEADER);
eq(map, { anrede: 0, vorname: 2, nachname: 1, studienort: 3, einstellungsjahr: 4, studiengruppe: 7 }, 'Mapping: Name->nachname, StO->studienort, "neue StGr"->studiengruppe (nicht "bisherige")');
ok(TG.hatUeberschrift([HEADER, ['Herr', 'Arnekker', 'Louis', 'Hann. Münden', 'BA 23/23', 201, 'Modul 13.3', 301]]) === true, 'Überschrift erkannt');

sec('XLSX-Lesepfad (gleiche Lib wie eingebettet)');
{
  // kleines XLSX im Speicher bauen und mit der mini-Lib wieder lesen
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ['Frau', 'Schäfer', 'Eva', 'Oldenburg', 'BA 24/24', 204, 'Modul 1', 305]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Tabelle1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const wb2 = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb2.Sheets['Tabelle1'], { header: 1, blankrows: false, defval: '' });
  const recs = TG.datensaetzeAusRows(rows, TG.autoMapping(rows[0]), true);
  eq(recs[0], { anrede: 'Frau', vorname: 'Eva', nachname: 'Schäfer', studienort: 'Oldenburg', einstellungsjahr: 'BA 24/24', studiengruppe: '305' }, 'XLSX -> Datensatz korrekt zugeordnet');
}

sec('Dateiname (Outlook-kompatibel)');
eq(TG.dateiname('{nachname}, {vorname} - Ticket {nr}von{anzahl}', { nachname: 'Müller', vorname: 'Max' }, { nr: 1, anzahl: 2 }), 'Müller, Max - Ticket 1von2.pdf', 'Trennzeichen ", " und " - Ticket " bleiben erhalten');
ok(TG.dateiname('{nachname}', { nachname: 'A/B:C' }, {}).indexOf('/') === -1, 'verbotene Zeichen ersetzt');

sec('Kompletter Lauf: 3 Personen x 2 Tickets, PDF(Vorder+Rück)+ZIP');
const personen = [
  { anrede: 'Herr', vorname: 'Max', nachname: 'Müller', studienort: 'Hann. Münden', einstellungsjahr: 'BA 23/23', studiengruppe: '301' },
  { anrede: 'Frau', vorname: 'Eva', nachname: 'Schäfer', studienort: 'Oldenburg', einstellungsjahr: 'BA 24/24', studiengruppe: '305' },
  { anrede: 'Herr', vorname: 'Max', nachname: 'Müller', studienort: 'Hann. Münden', einstellungsjahr: 'BA 23/23', studiengruppe: '301' }
];
const cfg = { qrFehlerkorrektur: 'M', ticketsProPerson: 2, dateinameMuster: '{nachname}, {vorname} - Ticket {nr}von{anzahl}', linksTitel: 'ABSCHLUSSFEIER', linksZusatz: 'des Bachelor-Studienjahrgangs 20/21', linksDatum: '30.09.2024 um 12:00 Uhr', linksEinlass: 'Einlass ab 10:30 Uhr', datumLang: 'Montag, 30. September 2024 | 12:00 Uhr', anlass: 'zur Abschlussfeier des Bachelor-Studienjahrgangs 20/21', ort: 'Swiss Life Hall | Hannover' };
const res = await TG.baueAlles({ records: personen, cfg, assets, jsPDFCtor: jsPDF, JSZipCtor: JSZip });
const zbuf = await res.zip.generateAsync({ type: 'nodebuffer' });
const back = await JSZip.loadAsync(zbuf);
const namen = Object.keys(back.files);
const pdfs = namen.filter(n => /\.pdf$/i.test(n));
eq(pdfs.length, 6, '6 PDFs (3 Personen x 2 Tickets)');
ok(new Set(pdfs.map(s => s.toLowerCase())).size === 6, 'Dateinamen eindeutig (auch bei Namensgleichheit)');
const tj = JSON.parse(await back.file('tokens.json').async('string'));
eq(tj.length, 6, 'tokens.json: 6 Einträge');
ok(new Set(tj.map(t => t.token)).size === 6, '6 eindeutige Tokens');
ok(tj.every(t => t.ticketAnzahl === 2 && (t.ticketNr === 1 || t.ticketNr === 2)), 'ticketNr/Anzahl gesetzt (1/2, 2/2)');
ok(tj.filter(t => t.ticketNr === 1).length === 3 && tj.filter(t => t.ticketNr === 2).length === 3, '3 Personen x 2 Tickets (je 3x Nr.1 und Nr.2)');
eq(Object.keys(tj[0]).sort(), ['ticketAnzahl', 'ticketNr', 'token'], 'tokens.json ist PII-frei (nur token + Ticket-Nr.)');
const pdf0 = Buffer.from(await back.file(pdfs[0]).async('arraybuffer'));
ok(pdf0.slice(0, 5).toString('latin1') === '%PDF-', 'PDF beginnt mit %PDF-');
ok(pdf0.length > 5000, 'PDF enthält eingebettete Bilder (Größe ' + pdf0.length + ')');
const zu = await back.file('zuordnung.csv').async('string');
ok(zu.indexOf('token;Nachname;Vorname;Studiengruppe;Studienort;Einstellungsjahr;TicketNr;Anzahl;Dateiname') >= 0, 'zuordnung.csv Kopfzeile (lokal, mit Token)');
ok(zu.indexOf(';Müller;Max;301;Hann. Münden;BA 23/23;1;2;') >= 0, 'zuordnung.csv Zeile verknüpft Token mit Klarname');
ok(tj.every(t => zu.indexOf(t.token) >= 0), 'jeder Token ist in der lokalen Zuordnung auffindbar');

sec('QR-Round-Trip Generator -> jsQR');
let qrOk = 0;
for (const t of tj.slice(0, 4)) {
  const qr = qrcode(0, 'M'); qr.addData(t.token); qr.make();
  const n = qr.getModuleCount(), q = 4, s = 6, dim = (n + 2 * q) * s;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c))
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const o = (((r + q) * s + y) * dim + ((c + q) * s + x)) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
  const d = jsQR(data, dim, dim); if (d && d.data === t.token) qrOk++;
}
ok(qrOk === 4, 'jsQR liest erzeugte Tokens exakt (' + qrOk + '/4)');

/* ---------------- SCANNER ---------------- */
sec('Scanner: laden + Anzeige');
const tokenMap = TS.ladeTokens(JSON.stringify(tj));
eq(tokenMap.size, 6, 'ladeTokens: 6 Tickets');
const rec0 = tokenMap.get(tj[0].token);
ok(TS.name(rec0) === '', 'Scanner-Liste ist PII-frei (kein Name)');
ok(/Ticket \d\/2/.test(TS.detail(rec0)), 'Detail zeigt Ticket-Nr: ' + TS.detail(rec0));
let threw = false; try { TS.ladeTokens('[]'); } catch (e) { threw = true; } ok(threw, 'leere Liste -> Fehler');
threw = false; try { TS.ladeTokens('{kaputt'); } catch (e) { threw = /JSON/.test(e.message); } ok(threw, 'kaputtes JSON -> klarer Fehler');

sec('Scanner: grün/gelb/rot + Log/Wiederaufnahme');
const state = new Map();
eq(TS.pruefe(tj[0].token, tokenMap, state).ergebnis, 'gueltig', 'erster Scan grün');
const g2 = TS.pruefe(tj[0].token, tokenMap, state);
eq(g2.ergebnis, 'benutzt', 'zweiter Scan gelb'); ok(!!g2.vorigeZeit, 'gelb nennt vorige Zeit');
eq(TS.pruefe('FREMD', tokenMap, state).ergebnis, 'ungueltig', 'fremder Code rot');
eq(state.size, 1, 'genau 1 entwertet');

const log = [];
const scan = (t) => { const r = TS.pruefe(t, tokenMap, state); log.push({ token: r.token, name: TS.name(r.rec), zeit: r.zeit, ergebnis: TS.ERG_TEXT[r.ergebnis] }); };
state.clear(); log.length = 0;
scan(tj[0].token); scan(tj[1].token); scan(tj[0].token); scan('FREMD');
const csv = TS.logToCsv(log);
ok(csv.indexOf('token;name;zeit;ergebnis') >= 0, 'Log-CSV Kopf');
const wieder = TS.csvToLog(csv); eq(wieder.length, 4, 'csvToLog: 4 Ereignisse');
const state2 = TS.zustandAusLog(wieder); eq(state2.size, 2, 'zustandAusLog: 2 entwertet wiederhergestellt');
eq(TS.pruefe(tj[0].token, tokenMap, state2).ergebnis, 'benutzt', 'nach Wiederaufnahme erneut -> gelb');

console.log('\n=================================');
console.log('Bestanden: ' + pass + '   Fehlgeschlagen: ' + fail);
console.log('=================================');
process.exit(fail ? 1 : 0);

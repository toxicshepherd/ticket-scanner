/* Node-Tests für die reine Logik beider Tools.
 * Lädt dieselben vendor-Bibliotheken, die auch in die HTML eingebettet werden,
 * und prüft die Kern-Algorithmen (Token, CSV, Mapping, PDF/ZIP-Lauf, QR-Round-
 * trip Generator->Scanner, Prüflogik, Log-Export/Import).
 * Aufruf:  node test/test-core.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const V = path.join(ROOT, 'vendor') + '/';

const qrcode = require(V + 'qrcode-generator.js');
const jsqr = require(V + 'jsqr.js');
const jspdfNS = require(V + 'jspdf.umd.min.js');
const JSZip = require(V + 'jszip.min.js');
const jsQR = jsqr.default || jsqr;
const jsPDF = jspdfNS.jsPDF || (jspdfNS.default && jspdfNS.default.jsPDF);
globalThis.qrcode = qrcode; // core-generator nutzt das globale qrcode

const TG = require(path.join(ROOT, 'src', 'core-generator.js'));
const TS = require(path.join(ROOT, 'src', 'core-scanner.js'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '  (got ' + JSON.stringify(a) + ')'); }
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- GENERATOR ---------------- */
section('Generator: Token');
const tk = TG.neuerToken();
ok(/^[A-Za-z0-9_-]{22}$/.test(tk), 'Token ist 22-stelliges base64url: ' + tk);
const set = new Set(); for (let i = 0; i < 5000; i++) set.add(TG.neuerToken());
ok(set.size === 5000, 'Tokens sind eindeutig (5000/5000): ' + set.size);

section('Generator: CSV');
eq(TG.erkenneTrennzeichen('a;b;c'), ';', 'Trennzeichen ;');
eq(TG.erkenneTrennzeichen('a,b,c'), ',', 'Trennzeichen ,');
const csv = 'Anrede;Vorname;Nachname;Email;Block;Platz\r\n' +
  'Herr;Max;"Müller; jr.";max@x.de;A;12\r\n' +   // Delimiter im Feld + Quotes
  'Frau;Eva;"O""Brien";eva@x.de;B;3\n';            // doppelte Quotes
const p = TG.parseCSV(csv);
eq(p.delim, ';', 'CSV erkennt ; als Trennzeichen');
eq(p.rows.length, 3, 'CSV: 3 Zeilen (inkl. Kopf)');
eq(p.rows[1][2], 'Müller; jr.', 'CSV: Delimiter innerhalb Quotes bleibt erhalten');
eq(p.rows[2][2], 'O"Brien', 'CSV: doppelte Quotes -> ein Quote');
const bom = TG.parseCSV('﻿a;b\r\n1;2');
eq(bom.rows[0], ['a', 'b'], 'CSV: BOM wird entfernt');

section('Generator: Spalten-Mapping');
const map = TG.autoMapping(p.rows[0]);
eq(map, { anrede: 0, vorname: 1, nachname: 2, email: 3, block: 4, platz: 5 }, 'autoMapping erkennt Standardspalten');
ok(TG.hatUeberschrift(p.rows) === true, 'Überschrift erkannt');
const recs = TG.datensaetzeAusRows(p.rows, map, true);
eq(recs.length, 2, '2 Datensätze ohne Kopfzeile');
eq(recs[0].nachname, 'Müller; jr.', 'Datensatz übernimmt Feld korrekt');
// alternatives Mapping: "Name" -> nachname
eq(TG.autoMapping(['Name', 'Vorname', 'E-Mail']), { anrede: -1, vorname: 1, nachname: 0, email: 2, block: -1, platz: -1 }, 'Synonyme: Name->nachname, E-Mail->email');

section('Generator: Dateiname');
ok(/^Ticket_Mueller.*\.pdf$/i.test('x') === false, '(setup)');
const fn = TG.dateiname('Ticket_{nachname}_{vorname}_{email}', { nachname: 'Müller', vorname: 'Max', email: 'max@x.de' }, 0);
ok(/\.pdf$/.test(fn) && fn.indexOf('/') === -1 && fn.indexOf(':') === -1, 'Dateiname ist PDF + ohne unerlaubte Zeichen: ' + fn);
eq(TG.dateiname('T_{index}', {}, 6), 'T_0007.pdf', 'Index wird 4-stellig aufgefüllt');

section('Generator: tokens.json / manifest');
const meta = recs.map((r, i) => Object.assign({}, r, { token: TG.neuerToken(), dateiname: 'f' + i + '.pdf' }));
const tj = TG.tokensJson(meta);
eq(Object.keys(tj[0]).sort(), ['anrede', 'block', 'email', 'nachname', 'platz', 'token', 'vorname'], 'tokens.json Felder vollständig');
const man = TG.manifestCsv(meta);
ok(man.indexOf('Email;Dateiname') >= 0 && man.indexOf('f0.pdf') >= 0, 'manifest hat Kopf + Dateinamen');

section('Generator: kompletter Lauf (PDF+ZIP) mit echten Libs');
const cfg = { anlass: 'Tag der offenen Tür', datum: '16.06.2026', uhrzeit: '10:00', ort: 'Musterbehörde', qrFehlerkorrektur: 'M', dateinameMuster: 'Ticket_{nachname}_{vorname}_{email}', farbe: { r: 31, g: 108, b: 180 }, fusszeile: 'Nur mit gültigem Ausweis.' };
const eingang = [
  { anrede: 'Herr', vorname: 'Max', nachname: 'Müller', email: 'max@x.de', block: 'A', platz: '12' },
  { anrede: 'Frau', vorname: 'Eva', nachname: 'Schäfer', email: 'eva@x.de', block: 'B', platz: '3' },
  { anrede: 'Herr', vorname: 'Max', nachname: 'Müller', email: 'max2@x.de', block: 'A', platz: '13' } // Namensgleich -> eindeutiger Dateiname
];
const res = await TG.baueAlles({ records: eingang, cfg, jsPDFCtor: jsPDF, JSZipCtor: JSZip });
const zbuf = await res.zip.generateAsync({ type: 'nodebuffer' });
ok(zbuf.slice(0, 2).toString('latin1') === 'PK', 'ZIP-Header PK');
// ZIP wieder einlesen und Inhalt prüfen
const back = await JSZip.loadAsync(zbuf);
const namen = Object.keys(back.files);
const pdfs = namen.filter(n => /\.pdf$/i.test(n));
eq(pdfs.length, 3, 'ZIP enthält 3 PDFs');
ok(new Set(pdfs.map(s => s.toLowerCase())).size === 3, 'PDF-Dateinamen eindeutig (auch bei Namensgleichheit)');
ok(namen.indexOf('tokens.json') >= 0, 'ZIP enthält tokens.json');
ok(namen.indexOf('versand_manifest.csv') >= 0, 'ZIP enthält versand_manifest.csv');
const tjson = JSON.parse(await back.file('tokens.json').async('string'));
eq(tjson.length, 3, 'tokens.json hat 3 Einträge');
ok(tjson.every(t => /^[A-Za-z0-9_-]{22}$/.test(t.token)), 'alle tokens base64url(22)');
ok(new Set(tjson.map(t => t.token)).size === 3, 'tokens eindeutig');
const firstPdf = await back.file(pdfs[0]).async('nodebuffer');
ok(firstPdf.slice(0, 5).toString('latin1') === '%PDF-', 'PDF beginnt mit %PDF-');
ok(firstPdf.length > 800, 'PDF ist nicht leer: ' + firstPdf.length + ' Bytes');
const manStr = await back.file('versand_manifest.csv').async('string');
ok(tjson.every(t => manStr.indexOf(t.email) >= 0), 'manifest enthält alle E-Mails');

section('QR-Round-Trip Generator -> Scanner (jsQR liest, was erzeugt wurde)');
function qrToImageData(token, ec) {
  const qr = qrcode(0, ec || 'M'); qr.addData(token); qr.make();
  const n = qr.getModuleCount(), q = 4, s = 6, dim = (n + 2 * q) * s;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c))
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const px = (((r + q) * s + y) * dim + ((c + q) * s + x)) * 4;
      data[px] = data[px + 1] = data[px + 2] = 0;
    }
  return { data, dim };
}
let qrOk = 0;
for (const t of tjson) {
  const { data, dim } = qrToImageData(t.token, cfg.qrFehlerkorrektur);
  const dec = jsQR(data, dim, dim);
  if (dec && dec.data === t.token) qrOk++;
}
ok(qrOk === tjson.length, 'jsQR dekodiert alle erzeugten Tokens exakt (' + qrOk + '/' + tjson.length + ')');

/* ---------------- SCANNER ---------------- */
section('Scanner: tokens.json laden + Fehler');
const tokenMap = TS.ladeTokens(JSON.stringify(tjson));
eq(tokenMap.size, 3, 'ladeTokens: 3 Tickets');
let threw = false; try { TS.ladeTokens('{kaputt'); } catch (e) { threw = /JSON/.test(e.message); }
ok(threw, 'ladeTokens wirft klaren Fehler bei kaputtem JSON');
threw = false; try { TS.ladeTokens('123'); } catch (e) { threw = true; }
ok(threw, 'ladeTokens wirft bei Nicht-Array');
threw = false; try { TS.ladeTokens('[]'); } catch (e) { threw = true; }
ok(threw, 'ladeTokens wirft bei leerer Liste');

section('Scanner: Prüflogik grün/gelb/rot');
const state = new Map();
const g1 = TS.pruefe(tjson[0].token, tokenMap, state);
eq(g1.ergebnis, 'gueltig', 'erster Scan = gueltig (grün)');
ok(TS.name(g1.rec).indexOf('Müller') >= 0, 'Ergebnis liefert Namen: ' + TS.name(g1.rec));
const g2 = TS.pruefe(tjson[0].token, tokenMap, state);
eq(g2.ergebnis, 'benutzt', 'zweiter Scan = benutzt (gelb)');
ok(!!g2.vorigeZeit, 'benutzt liefert vorige Zeit');
const g3 = TS.pruefe('FREMDER_CODE_XYZ', tokenMap, state);
eq(g3.ergebnis, 'ungueltig', 'fremder Code = ungueltig (rot)');
eq(state.size, 1, 'genau 1 Ticket entwertet (Zähler eingecheckt)');

section('Scanner: Log Export/Import + Wiederaufnahme');
const log = [];
function scanUndLog(tok) {
  const r = TS.pruefe(tok, tokenMap, state);
  log.push({ token: r.token, name: TS.name(r.rec), zeit: r.zeit, ergebnis: TS.ERG_TEXT[r.ergebnis] });
  return r;
}
// frischer Zustand
state.clear(); log.length = 0;
scanUndLog(tjson[0].token); // gültig
scanUndLog(tjson[1].token); // gültig
scanUndLog(tjson[0].token); // bereits benutzt
scanUndLog('FREMD');         // ungültig
const csvLog = TS.logToCsv(log);
ok(csvLog.indexOf('token;name;zeit;ergebnis') >= 0, 'Log-CSV hat Kopfzeile');
const wieder = TS.csvToLog(csvLog);
eq(wieder.length, 4, 'csvToLog liest 4 Ereignisse');
eq(wieder[0].ergebnis, 'Gültig', 'Ergebnis-Text bleibt erhalten');
// "Neustart": frischer state, aus Log rekonstruieren
const state2 = TS.zustandAusLog(wieder);
eq(state2.size, 2, 'zustandAusLog: 2 Tickets als entwertet wiederhergestellt');
ok(state2.has(tjson[0].token) && state2.has(tjson[1].token), 'richtige Tokens wiederhergestellt');
// nach Wiederaufnahme erneut scannen -> benutzt
const nach = TS.pruefe(tjson[0].token, tokenMap, state2);
eq(nach.ergebnis, 'benutzt', 'nach Wiederaufnahme: erneuter Scan = benutzt');

section('Scanner: mergeLog dedupliziert');
const merged = TS.mergeLog(wieder, wieder.slice(0, 2));
eq(merged.length, 4, 'mergeLog entfernt Dubletten');

/* ---------------- Ergebnis ---------------- */
console.log('\n=================================');
console.log('Bestanden: ' + pass + '   Fehlgeschlagen: ' + fail);
console.log('=================================');
process.exit(fail ? 1 : 0);

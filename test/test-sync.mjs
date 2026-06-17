/* Testet den Echtzeit-Sync-Client (core-scanner) gegen den lokalen Mock-Dienst.
 * Startet backend/mock-server.mjs, simuliert zwei Geräte.
 *   node test/test-sync.mjs
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const TS = require(path.join(ROOT, 'src', 'core-scanner.js'));

const PORT = 8799;
const srv = spawn(process.execPath, [path.join(ROOT, 'backend', 'mock-server.mjs')], { env: Object.assign({}, process.env, { PORT: String(PORT) }) });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ')');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function ready() { for (let i = 0; i < 50; i++) { try { await fetch('http://localhost:' + PORT + '/state?event=x'); return true; } catch (e) { await wait(100); } } return false; }

try {
  if (!(await ready())) throw new Error('Mock-Server nicht erreichbar');
  const base = 'http://localhost:' + PORT, event = 'e' + Date.now();
  const g1 = { base, event, key: '', device: 'Kasse1' };
  const g2 = { base, event, key: '', device: 'Kasse2' };

  console.log('== Cross-Device Dedup ==');
  const a1 = await TS.syncScan(g1, 'TOKEN_A');
  eq(a1.status, 'first', 'Kasse1 scannt A -> first (grün)');
  eq(a1.eingecheckt, 1, 'eingecheckt = 1');
  const a2 = await TS.syncScan(g2, 'TOKEN_A');
  eq(a2.status, 'duplicate', 'Kasse2 scannt A -> duplicate (gelb) — gerätübergreifend erkannt');
  eq(a2.firstDevice, 'Kasse1', 'meldet erstes Gerät (Kasse1)');
  ok(!!a2.firstZeit, 'meldet erste Zeit');
  const b1 = await TS.syncScan(g2, 'TOKEN_B');
  eq(b1.status, 'first', 'Kasse2 scannt B -> first');
  eq(b1.eingecheckt, 2, 'eingecheckt = 2 (gerätübergreifend gezählt)');

  console.log('== ergebnisAusSync ==');
  eq(TS.ergebnisAusSync('TOKEN_A', { token: 'TOKEN_A' }, a1).ergebnis, 'gueltig', 'first -> gueltig');
  const ge = TS.ergebnisAusSync('TOKEN_A', { token: 'TOKEN_A' }, a2);
  eq(ge.ergebnis, 'benutzt', 'duplicate -> benutzt');
  ok(ge.vorigesGeraet === 'Kasse1', 'benutzt nennt voriges Gerät');

  console.log('== State-Polling + Export ==');
  const s = await TS.syncState(g1, 0);
  eq(s.events.length, 3, 'state liefert 3 Ereignisse seit 0');
  eq(s.eingecheckt, 2, 'state: eingecheckt 2');
  const seitMitte = await TS.syncState(g1, 2);
  eq(seitMitte.events.length, 1, 'state seit seq 2 -> nur neuere Ereignisse');
  const csv = await TS.syncExport(g1);
  ok(/token;device;zeit;status/.test(csv), 'Export-CSV Kopfzeile');
  ok((csv.match(/TOKEN_A/g) || []).length === 2, 'Export enthält beide A-Scans (Doppelscan sichtbar)');

  console.log('\nBestanden: ' + pass + '   Fehlgeschlagen: ' + fail);
} catch (e) {
  console.error('Fehler:', e.message); fail++;
} finally {
  srv.kill();
}
process.exit(fail ? 1 : 0);

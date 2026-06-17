/* Testet backend/worker-kv.js (KV-Variante) gegen einen In-Memory-KV-Mock.
 * Validiert dasselbe Protokoll wie der echte Cloudflare-Worker.
 *   node test/test-worker-kv.mjs
 */
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// worker-kv.js nutzt ESM-export -> als .mjs kopieren, damit Node es importiert
const tmp = path.join(os.tmpdir(), 'wkv-' + Date.now() + '.mjs');
fs.copyFileSync(path.join(ROOT, 'backend', 'worker-kv.js'), tmp);
const worker = (await import('file://' + tmp)).default;

// In-Memory-KV (get/put/list/delete mit Metadaten)
function makeKV() {
  const m = new Map();
  return {
    async get(k, t) { const e = m.get(k); if (e == null) return null; return t === 'json' ? JSON.parse(e.v) : e.v; },
    async put(k, v, opt) { m.set(k, { v: String(v), metadata: opt && opt.metadata }); },
    async delete(k) { m.delete(k); },
    async list(o) {
      o = o || {}; let keys = [...m.keys()].filter(k => k.startsWith(o.prefix || '')).sort();
      keys = keys.map(name => ({ name, metadata: m.get(name).metadata }));
      return { keys: keys.slice(0, o.limit || 1000), list_complete: true, cursor: null };
    }
  };
}
const env = { EINLASS: makeKV(), SCAN_KEY: 'geheim', ALLOW_ORIGIN: '*' };
const base = 'https://w.example';
function req(method, p, body) {
  return new Request(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Key': 'geheim' }, body: body ? JSON.stringify(body) : undefined });
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ')');

console.log('== worker-kv: Auth + Scan ==');
let r = await worker.fetch(new Request(base + '/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env);
eq(r.status, 401, 'ohne X-Key -> 401');

r = await worker.fetch(req('POST', '/scan', { event: 'e', token: 'A', device: 'K1' }), env);
let j = await r.json();
eq(j.status, 'first', 'A@K1 -> first');
eq(j.eingecheckt, 1, 'eingecheckt 1');

j = await (await worker.fetch(req('POST', '/scan', { event: 'e', token: 'A', device: 'K2' }), env)).json();
eq(j.status, 'duplicate', 'A@K2 -> duplicate (gerätübergreifend)');
eq(j.firstDevice, 'K1', 'firstDevice K1');

j = await (await worker.fetch(req('POST', '/scan', { event: 'e', token: 'B', device: 'K2' }), env)).json();
eq(j.eingecheckt, 2, 'B@K2 -> eingecheckt 2');

console.log('== worker-kv: State + Export ==');
j = await (await worker.fetch(req('GET', '/state?event=e&since=0'), env)).json();
eq(j.events.length, 3, 'state: 3 Ereignisse'); eq(j.eingecheckt, 2, 'state eingecheckt 2'); eq(j.seq, 3, 'state seq 3');
j = await (await worker.fetch(req('GET', '/state?event=e&since=2'), env)).json();
eq(j.events.length, 1, 'state since=2 -> 1 neues Ereignis');
const csv = await (await worker.fetch(req('GET', '/export?event=e'), env)).text();
ok(/token;device;zeit;status/.test(csv) && (csv.match(/\bA\b/g) || []).length === 2, 'Export enthält A zweimal (Doppelscan)');

console.log('== worker-kv: getrennte Events ==');
j = await (await worker.fetch(req('POST', '/scan', { event: 'e2', token: 'A', device: 'K1' }), env)).json();
eq(j.status, 'first', 'gleiches Token in anderem Event -> first (getrennt)');

fs.unlinkSync(tmp);
console.log('\nBestanden: ' + pass + '   Fehlgeschlagen: ' + fail);
process.exit(fail ? 1 : 0);

/* Lokaler Mock des Einlass-Sync-Dienstes (gleiches Protokoll wie worker.js).
 * Nur zum Testen/Entwickeln auf dem eigenen Rechner — KEIN Produktionsserver.
 *   node backend/mock-server.mjs           # Port 8787
 * Speichert nur Tokens + Zeitstempel + Gerätename im Arbeitsspeicher.
 */
import http from 'http';
const PORT = process.env.PORT || 8787;
const KEY = process.env.SCAN_KEY || '';
const events = new Map(); // event -> { tokens:Map, log:[], seq }

function ev(name) {
  name = String(name || 'default').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'default';
  if (!events.has(name)) events.set(name, { tokens: new Map(), log: [], seq: 0 });
  return events.get(name);
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Key' };
const send = (res, code, obj, type) => { res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8' }, CORS)); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (KEY && req.headers['x-key'] !== KEY) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}
    const e = ev(url.searchParams.get('event') || body.event);
    const p = url.pathname;
    if (p.endsWith('/scan') && req.method === 'POST') {
      const token = String(body.token || '').trim(); const device = String(body.device || 'unbekannt');
      if (!token) return send(res, 400, { error: 'no token' });
      const now = new Date().toISOString(); e.seq++;
      let status, firstZeit, firstDevice;
      if (e.tokens.has(token)) { status = 'duplicate'; const f = e.tokens.get(token); firstZeit = f.zeit; firstDevice = f.device; }
      else { status = 'first'; firstZeit = now; firstDevice = device; e.tokens.set(token, { zeit: now, device }); }
      e.log.push({ seq: e.seq, token, device, status, zeit: now });
      return send(res, 200, { status, zeit: now, firstZeit, firstDevice, seq: e.seq, eingecheckt: e.tokens.size });
    }
    if (p.endsWith('/state') && req.method === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      return send(res, 200, { events: e.log.filter(x => x.seq > since), seq: e.seq, eingecheckt: e.tokens.size });
    }
    if (p.endsWith('/export') && req.method === 'GET') {
      const lines = ['token;device;zeit;status']; e.log.forEach(v => lines.push([v.token, v.device, v.zeit, v.status].join(';')));
      return send(res, 200, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8');
    }
    if (p.endsWith('/reset') && req.method === 'POST') { events.delete(url.searchParams.get('event') || body.event || 'default'); return send(res, 200, { ok: true }); }
    send(res, 404, { error: 'not found' });
  });
}).listen(PORT, () => console.log('Einlass-Sync Mock auf http://localhost:' + PORT));

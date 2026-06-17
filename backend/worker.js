/* =====================================================================
 * Einlass-Sync — Cloudflare Worker + Durable Object
 * ---------------------------------------------------------------------
 * Echtzeit-Synchronisierung der Check-ins über mehrere Scan-Geräte.
 * Speichert AUSSCHLIESSLICH Tokens + Zeitstempel + Gerätename — KEINE
 * Personendaten. Der Klarnamen-Abgleich passiert lokal (auswertung.html).
 *
 * Endpunkte (alle benötigen Header  X-Key: <SCAN_KEY>):
 *   POST /scan    {event, token, device}
 *        -> { status:'first'|'duplicate', zeit, firstZeit, firstDevice,
 *             seq, eingecheckt }
 *   GET  /state?event=E&since=N
 *        -> { events:[{seq,token,device,status,zeit}], seq, eingecheckt }
 *   GET  /export?event=E   -> CSV (token;device;zeit;status)
 *   POST /reset   {event}  -> Stand dieses Events löschen
 *
 * Deploy: siehe backend/README.md  (wrangler)
 * ===================================================================== */

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Key',
    'Access-Control-Max-Age': '86400'
  };
}
function json(obj, env, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(env))
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    // Schlüsselprüfung (einfacher gemeinsamer Schlüssel)
    if (env.SCAN_KEY && request.headers.get('X-Key') !== env.SCAN_KEY) {
      return json({ error: 'unauthorized' }, env, 401);
    }

    const url = new URL(request.url);
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch (e) { body = {}; } }
    const event = (url.searchParams.get('event') || body.event || 'default').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'default';

    // Datenstandort an die EU binden (DSGVO) — per Variable JURISDICTION="eu"
    var ns = env.JURISDICTION ? env.EVENT.jurisdiction(env.JURISDICTION) : env.EVENT;
    const id = ns.idFromName(event);
    const stub = ns.get(id);
    // Anfrage an das Durable Object weiterreichen (Pfad + Query + Body)
    const inner = new URL(request.url);
    return stub.fetch(new Request(inner.toString(), {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.method === 'POST' ? JSON.stringify(body) : undefined
    })).then(async (res) => {
      const txt = await res.text();
      return new Response(txt, { status: res.status, headers: Object.assign({ 'Content-Type': res.headers.get('Content-Type') || 'application/json' }, cors(env)) });
    });
  }
};

export class EventDO {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/.*\//, '/');
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }
    const st = this.state.storage;

    if (path.endsWith('/scan') && request.method === 'POST') {
      const token = String(body.token || '').trim();
      const device = String(body.device || 'unbekannt').slice(0, 40);
      if (!token) return new Response(JSON.stringify({ error: 'no token' }), { status: 400 });
      const now = new Date().toISOString();
      let seq = (await st.get('seq')) || 0; seq++;
      let eingecheckt = (await st.get('count')) || 0;
      const tokKey = 'tok:' + token;
      const existing = await st.get(tokKey);
      let status, firstZeit, firstDevice;
      if (existing) {
        status = 'duplicate'; firstZeit = existing.zeit; firstDevice = existing.device;
      } else {
        status = 'first'; firstZeit = now; firstDevice = device; eingecheckt++;
        await st.put(tokKey, { zeit: now, device: device });
        await st.put('count', eingecheckt);
      }
      await st.put('seq', seq);
      await st.put('log:' + String(seq).padStart(8, '0'), { seq, token, device, status, zeit: now });
      return new Response(JSON.stringify({ status, zeit: now, firstZeit, firstDevice, seq, eingecheckt }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    if (path.endsWith('/state') && request.method === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const map = await st.list({ prefix: 'log:', start: 'log:' + String(since + 1).padStart(8, '0'), limit: 1000 });
      const events = []; map.forEach(v => events.push(v));
      return new Response(JSON.stringify({ events, seq: (await st.get('seq')) || 0, eingecheckt: (await st.get('count')) || 0 }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    if (path.endsWith('/export') && request.method === 'GET') {
      const map = await st.list({ prefix: 'log:', limit: 100000 });
      const lines = ['token;device;zeit;status'];
      map.forEach(v => lines.push([v.token, v.device, v.zeit, v.status].join(';')));
      return new Response('﻿' + lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    }

    if (path.endsWith('/reset') && request.method === 'POST') {
      await st.deleteAll();
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
}

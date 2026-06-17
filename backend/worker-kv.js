/* =====================================================================
 * Einlass-Sync — Cloudflare Worker (KV-Variante, OHNE wrangler deploybar)
 * ---------------------------------------------------------------------
 * Diese Variante kommt mit EINEM KV-Namespace aus und lässt sich komplett
 * im Browser über das Cloudflare-Dashboard einrichten (kein Build, keine
 * Migration, keine Installation). Anleitung: backend/README.md.
 *
 * Speichert nur Token + Zeit + Gerätename — KEINE Personendaten.
 * Hinweis Datenstandort: Cloudflare KV ist global repliziert (nicht fix EU).
 * Wer den Datenstandort fest an die EU binden muss, nimmt worker.js
 * (Durable Object, jurisdiction "eu") per wrangler.
 *
 * Dashboard-Schnellanleitung:
 *   1. Workers & Pages → Create application → Worker → Name → Deploy
 *   2. Edit code → diesen Inhalt einfügen → Deploy
 *   3. KV → Create namespace (z. B. "einlass")
 *   4. Worker → Settings → Bindings → Add → KV namespace,
 *      Variablenname  EINLASS  → den Namespace wählen → Deploy
 *   5. Settings → Variables → Secret  SCAN_KEY  setzen (frei wählbarer Schlüssel)
 * ===================================================================== */

function cors(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOW_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Key'
  };
}
function json(obj, env, status) {
  return new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(env))
  });
}
function evName(s) { return String(s || 'default').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'default'; }

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (env.SCAN_KEY && request.headers.get('X-Key') !== env.SCAN_KEY) return json({ error: 'unauthorized' }, env, 401);
    if (!env.EINLASS) return json({ error: 'KV-Namespace "EINLASS" nicht gebunden' }, env, 500);

    const url = new URL(request.url);
    const path = url.pathname.replace(/.*\//, '/');
    let body = {};
    if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }
    const ev = evName(url.searchParams.get('event') || body.event);
    const kv = env.EINLASS;

    if (path === '/scan' && request.method === 'POST') {
      const token = String(body.token || '').trim();
      const device = String(body.device || 'unbekannt').slice(0, 40);
      if (!token) return json({ error: 'no token' }, env, 400);
      const now = new Date().toISOString();
      const tokKey = ev + ':tok:' + token;
      const existing = await kv.get(tokKey, 'json');
      let status, firstZeit, firstDevice;
      let count = parseInt((await kv.get(ev + ':count')) || '0', 10);
      if (existing) { status = 'duplicate'; firstZeit = existing.zeit; firstDevice = existing.device; }
      else {
        status = 'first'; firstZeit = now; firstDevice = device;
        await kv.put(tokKey, JSON.stringify({ zeit: now, device: device }));
        count += 1; await kv.put(ev + ':count', String(count));
      }
      let seq = parseInt((await kv.get(ev + ':seq')) || '0', 10) + 1;
      await kv.put(ev + ':seq', String(seq));
      await kv.put(ev + ':log:' + String(seq).padStart(9, '0'), '1',
        { metadata: { seq: seq, token: token, device: device, status: status, zeit: now } });
      return json({ status, zeit: now, firstZeit, firstDevice, seq, eingecheckt: count }, env);
    }

    if (path === '/state' && request.method === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const list = await kv.list({ prefix: ev + ':log:', limit: 1000 });
      const events = [];
      list.keys.forEach(function (k) { const m = k.metadata; if (m && m.seq > since) events.push(m); });
      events.sort(function (a, b) { return a.seq - b.seq; });
      return json({ events: events, seq: parseInt((await kv.get(ev + ':seq')) || '0', 10), eingecheckt: parseInt((await kv.get(ev + ':count')) || '0', 10) }, env);
    }

    if (path === '/export' && request.method === 'GET') {
      const lines = ['token;device;zeit;status'];
      let cursor, all = [];
      do {
        const list = await kv.list({ prefix: ev + ':log:', limit: 1000, cursor: cursor });
        list.keys.forEach(function (k) { if (k.metadata) all.push(k.metadata); });
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);
      all.sort(function (a, b) { return a.seq - b.seq; });
      all.forEach(function (m) { lines.push([m.token, m.device, m.zeit, m.status].join(';')); });
      return new Response('﻿' + lines.join('\r\n') + '\r\n', { headers: Object.assign({ 'Content-Type': 'text/csv; charset=utf-8' }, cors(env)) });
    }

    if (path === '/reset' && request.method === 'POST') {
      let cursor;
      do {
        const list = await kv.list({ prefix: ev + ':', limit: 1000, cursor: cursor });
        for (const k of list.keys) await kv.delete(k.name);
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);
      return json({ ok: true }, env);
    }

    return json({ error: 'not found' }, env, 404);
  }
};

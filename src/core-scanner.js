/* =====================================================================
 * core-scanner.js  —  Reine Logik für einlass-scanner.html
 * ---------------------------------------------------------------------
 * Kein DOM-/UI-Code -> läuft im Browser (inline) und in den Node-Tests.
 * Keine Abhängigkeiten (jsQR wird nur im UI-Teil für die Kamera genutzt).
 * ===================================================================== */
(function (root) {
  'use strict';

  var TS = {};

  var ERG_TEXT = { gueltig: 'Gültig', benutzt: 'Bereits benutzt', ungueltig: 'Ungültig', leer: 'Leer' };
  TS.ERG_TEXT = ERG_TEXT;

  /* ---------- tokens.json laden -------------------------------------- */
  function ladeTokens(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('Die Datei ist kein gültiges JSON (tokens.json).'); }
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.tickets)) data = data.tickets;
      else throw new Error('Die JSON-Datei enthält keine Ticket-Liste (Array erwartet).');
    }
    var map = new Map();
    for (var i = 0; i < data.length; i++) {
      var t = data[i];
      if (!t || typeof t.token !== 'string' || !t.token) continue;
      map.set(t.token, {
        token: t.token,
        anrede: t.anrede || '', vorname: t.vorname || '', nachname: t.nachname || '',
        email: t.email || '', block: t.block || '', platz: t.platz || ''
      });
    }
    if (map.size === 0) throw new Error('Keine gültigen Tickets in der Datei gefunden.');
    return map;
  }

  function name(rec) {
    if (!rec) return '';
    return [rec.anrede, rec.vorname, rec.nachname].filter(Boolean).join(' ');
  }

  /* ---------- Prüflogik ---------------------------------------------
   * state: Map token -> { zeit: ISO-String }   (vorhanden => entwertet)
   * Gibt das Scan-Ergebnis zurück und entwertet bei "gueltig".
   * ------------------------------------------------------------------ */
  function pruefe(rawToken, tokenMap, state, jetzt) {
    var token = String(rawToken == null ? '' : rawToken).trim();
    var zeitISO = (jetzt || new Date()).toISOString();
    if (!token) return { ergebnis: 'leer', token: '', zeit: zeitISO };
    var rec = tokenMap.get(token);
    if (!rec) return { ergebnis: 'ungueltig', token: token, zeit: zeitISO };
    if (state.has(token)) {
      return { ergebnis: 'benutzt', token: token, rec: rec, zeit: zeitISO, vorigeZeit: state.get(token).zeit };
    }
    state.set(token, { zeit: zeitISO });
    return { ergebnis: 'gueltig', token: token, rec: rec, zeit: zeitISO };
  }

  /* ---------- Einlass-Log (CSV) -------------------------------------- */
  function csvFeld(v) {
    v = (v == null ? '' : String(v));
    return /["\r\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // log: Array von { token, name, zeit, ergebnis }
  function logToCsv(log) {
    var d = ';', lines = ['token' + d + 'name' + d + 'zeit' + d + 'ergebnis'];
    log.forEach(function (e) {
      lines.push([csvFeld(e.token), csvFeld(e.name), csvFeld(e.zeit), csvFeld(e.ergebnis)].join(d));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  // Minimaler CSV-Parser (Anführungszeichen + ""), Trennzeichen ; oder ,
  function parseCsv(text) {
    text = String(text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var firstLine = text.split(/\r\n|\n|\r/)[0] || '';
    var delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], field = '', inQ = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { if (text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  function csvToLog(text) {
    var rows = parseCsv(text);
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var hasHeader = header.indexOf('token') !== -1;
    var idx = {
      token: header.indexOf('token'), name: header.indexOf('name'),
      zeit: header.indexOf('zeit'), ergebnis: header.indexOf('ergebnis')
    };
    var out = [];
    for (var i = hasHeader ? 1 : 0; i < rows.length; i++) {
      var r = rows[i];
      var g = function (key, pos) {
        return hasHeader ? (idx[key] >= 0 ? String(r[idx[key]] || '').trim() : '') : String(r[pos] || '').trim();
      };
      var ev = { token: g('token', 0), name: g('name', 1), zeit: g('zeit', 2), ergebnis: g('ergebnis', 3) };
      if (ev.token) out.push(ev);
    }
    return out;
  }

  // Zustand (entwertete Tokens) aus einem Log rekonstruieren:
  // entwertet, sobald ein "Gültig"-Eintrag existiert; früheste Zeit gewinnt.
  function zustandAusLog(log) {
    var state = new Map();
    log.forEach(function (e) {
      var erg = String(e.ergebnis || '').toLowerCase();
      var istGueltig = erg.indexOf('gült') === 0 || erg === 'gueltig' || erg === 'ok' || erg === 'valid';
      if (!istGueltig || !e.token) return;
      var prev = state.get(e.token);
      var zeit = e.zeit || new Date().toISOString();
      if (!prev || (zeit && zeit < prev.zeit)) state.set(e.token, { zeit: zeit });
    });
    return state;
  }

  // Zwei Logs vereinen (Dubletten nach token|zeit|ergebnis entfernen)
  function mergeLog(a, b) {
    var seen = Object.create(null), out = [];
    function key(e) { return e.token + '|' + e.zeit + '|' + e.ergebnis; }
    a.forEach(function (e) { if (!seen[key(e)]) { seen[key(e)] = 1; out.push(e); } });
    b.forEach(function (e) { if (!seen[key(e)]) { seen[key(e)] = 1; out.push(e); } });
    return out;
  }

  /* ---------- Export ------------------------------------------------- */
  TS.ladeTokens = ladeTokens;
  TS.name = name;
  TS.pruefe = pruefe;
  TS.logToCsv = logToCsv;
  TS.parseCsv = parseCsv;
  TS.csvToLog = csvToLog;
  TS.zustandAusLog = zustandAusLog;
  TS.mergeLog = mergeLog;

  root.TS = TS;
  if (typeof module !== 'undefined' && module.exports) module.exports = TS;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

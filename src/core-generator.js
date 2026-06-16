/* =====================================================================
 * core-generator.js  —  Reine Logik für ticket-generator.html
 * ---------------------------------------------------------------------
 * Enthält KEINEN DOM-/UI-Code, damit dieselbe Logik sowohl im Browser
 * (inline eingebettet) als auch in den Node-Tests (test/) läuft.
 *
 * Abhängigkeiten:
 *   - globales  qrcode  (qrcode-generator)   -> für die QR-Erzeugung
 *   - jsPDF-Konstruktor und JSZip-Konstruktor werden als Parameter
 *     übergeben (im Browser aus window.jspdf.jsPDF bzw. window.JSZip).
 * ===================================================================== */
(function (root) {
  'use strict';

  var TG = {};

  /* ---------- Token: 16 Byte Zufall -> base64url (22 Zeichen) -------- */
  function base64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function neuerToken() {
    var b = new Uint8Array(16);
    (root.crypto || crypto).getRandomValues(b);
    return base64url(b);
  }

  /* ---------- CSV ---------------------------------------------------- */
  // Trennzeichen anhand der ersten Zeile erkennen (; bevorzugt vor ,)
  function erkenneTrennzeichen(text) {
    var firstLine = String(text).split(/\r\n|\n|\r/)[0] || '';
    var semi = (firstLine.match(/;/g) || []).length;
    var comma = (firstLine.match(/,/g) || []).length;
    var tab = (firstLine.match(/\t/g) || []).length;
    if (tab > semi && tab > comma) return '\t';
    return semi >= comma ? ';' : ',';
  }

  // Robuster CSV-Parser: behandelt Anführungszeichen, doppelte "", und
  // Zeilenumbrüche innerhalb von Feldern. UTF-8 BOM wird entfernt.
  function parseCSV(text, delim) {
    text = String(text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    if (!delim) delim = erkenneTrennzeichen(text);

    var rows = [], row = [], field = '', inQ = false, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { if (text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    // komplett leere Zeilen verwerfen
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    return { delim: delim, rows: rows };
  }

  /* ---------- Spalten automatisch zuordnen --------------------------- */
  var FELDER = ['anrede', 'vorname', 'nachname', 'email', 'block', 'platz'];
  var SYNONYME = {
    anrede:   ['anrede', 'titel', 'anrede/titel', 'salutation'],
    vorname:  ['vorname', 'firstname', 'first name', 'first', 'given name', 'rufname'],
    nachname: ['nachname', 'name', 'familienname', 'lastname', 'last name', 'last', 'surname', 'zuname'],
    email:    ['email', 'e-mail', 'e mail', 'mail', 'emailadresse', 'e-mail-adresse', 'mailadresse'],
    block:    ['block', 'bereich', 'sektor', 'reihe', 'section', 'tisch'],
    platz:    ['platz', 'sitz', 'sitzplatz', 'platznr', 'platz-nr', 'platznummer', 'seat', 'nr']
  };
  function normHeader(h) { return String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' '); }

  function autoMapping(header) {
    var map = {};
    FELDER.forEach(function (f) { map[f] = -1; });
    (header || []).forEach(function (h, idx) {
      var nh = normHeader(h);
      for (var fi = 0; fi < FELDER.length; fi++) {
        var f = FELDER[fi];
        if (map[f] !== -1) continue;
        if (SYNONYME[f].indexOf(nh) !== -1) { map[f] = idx; break; }
      }
    });
    return map;
  }
  // Heuristik: ist die erste Zeile eine Überschrift?
  function hatUeberschrift(rows) {
    if (!rows.length) return false;
    var m = autoMapping(rows[0]);
    var treffer = FELDER.reduce(function (a, f) { return a + (m[f] >= 0 ? 1 : 0); }, 0);
    return treffer >= 2;
  }

  function datensaetzeAusRows(rows, mapping, hatHeader) {
    var start = hatHeader ? 1 : 0, out = [];
    for (var i = start; i < rows.length; i++) {
      var r = rows[i];
      out.push(felderHolen(r, mapping));
    }
    return out;
  }
  function felderHolen(r, mapping) {
    var rec = {};
    FELDER.forEach(function (f) {
      var idx = mapping[f];
      rec[f] = (idx >= 0 && idx < r.length) ? String(r[idx] == null ? '' : r[idx]).trim() : '';
    });
    return rec;
  }

  /* ---------- Dateinamen --------------------------------------------- */
  function sanitize(s) {
    return String(s == null ? '' : s)
      .normalize('NFC')
      .replace(/[\u0000-\u001f]+/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[ .]+$/, '');
  }
  function dateiname(muster, rec, index) {
    var name = String(muster || 'Ticket_{nachname}_{vorname}_{email}')
      .replace(/\{(\w+)\}/g, function (m, k) {
        k = k.toLowerCase();
        if (k === 'index' || k === 'nr' || k === 'id') return String(index + 1).padStart(4, '0');
        return rec[k] != null ? String(rec[k]) : '';
      });
    name = sanitize(name);
    if (!name) name = 'ticket_' + String(index + 1).padStart(4, '0');
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    return name;
  }

  /* ---------- Ausgabedateien ----------------------------------------- */
  function tokensJson(records) {
    return records.map(function (r) {
      return {
        token: r.token, anrede: r.anrede, vorname: r.vorname, nachname: r.nachname,
        email: r.email, block: r.block, platz: r.platz
      };
    });
  }
  function csvFeld(v, d) {
    v = (v == null ? '' : String(v));
    return (v.indexOf('"') >= 0 || v.indexOf('\r') >= 0 || v.indexOf('\n') >= 0 || v.indexOf(d) >= 0)
      ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function manifestCsv(records) {
    var d = ';', lines = ['Email' + d + 'Dateiname'];
    records.forEach(function (r) { lines.push(csvFeld(r.email, d) + d + csvFeld(r.dateiname, d)); });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /* ===================================================================
   * VORLAGE (PDF)  —  Hier das Ticket-Layout anpassen.
   * Maße in Millimetern, A6 = 105 x 148 mm (Hochformat).
   * Siehe auch die HTML/CSS-Vorschau in ticket-generator.html, die
   * dasselbe Layout zeigt; beide bei Designänderungen abgleichen.
   * =================================================================== */
  function zeichneQR(doc, token, x, y, sizeMM, ecLevel) {
    var qr = qrcode(0, ecLevel || 'M');
    qr.addData(token);
    qr.make();
    var n = qr.getModuleCount();
    var cell = sizeMM / n;
    doc.setFillColor(0, 0, 0);
    // Pro Zeile zusammenhängende dunkle Module als EIN Rechteck zeichnen
    // (weniger Operationen, keine Haarlinien-Lücken).
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) {
          var c2 = c;
          while (c2 + 1 < n && qr.isDark(r, c2 + 1)) c2++;
          doc.rect(x + c * cell, y + r * cell, (c2 - c + 1) * cell, cell, 'F');
          c = c2 + 1;
        } else c++;
      }
    }
    return n;
  }

  function zeichneTicket(doc, rec, cfg) {
    var W = 105, H = 148, M = 7;
    var col = cfg.farbe || { r: 31, g: 108, b: 180 };

    // Rahmen
    doc.setDrawColor(col.r, col.g, col.b);
    doc.setLineWidth(0.5);
    doc.roundedRect(M * 0.5, M * 0.5, W - M, H - M, 3, 3, 'S');

    // Kopfband mit Anlass / Datum / Ort
    var hdrY = M * 0.5, hdrH = 23;
    doc.setFillColor(col.r, col.g, col.b);
    doc.rect(M * 0.5, hdrY, W - M, hdrH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(String(cfg.anlass || ''), W / 2, hdrY + 8, { align: 'center', maxWidth: W - 2 * M });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    var zeile2 = [cfg.datum, cfg.uhrzeit].filter(Boolean).join('   |   ');
    if (zeile2) doc.text(zeile2, W / 2, hdrY + 14, { align: 'center', maxWidth: W - 2 * M });
    if (cfg.ort) doc.text(String(cfg.ort), W / 2, hdrY + 19, { align: 'center', maxWidth: W - 2 * M });

    // "Eintrittskarte"
    doc.setTextColor(110, 110, 110);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('E I N T R I T T S K A R T E', W / 2, 36, { align: 'center' });

    // Name
    var name = [rec.anrede, rec.vorname, rec.nachname].filter(Boolean).join(' ') || '—';
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(name, W / 2, 45, { align: 'center', maxWidth: W - 2 * M });

    // Block / Platz
    var bp = [];
    if (rec.block) bp.push('Block ' + rec.block);
    if (rec.platz) bp.push('Platz ' + rec.platz);
    if (bp.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);
      doc.text(bp.join('      '), W / 2, 53, { align: 'center', maxWidth: W - 2 * M });
    }

    // QR-Code (Inhalt = NUR das Token) mit weißem Hintergrund + Ruhezone
    var qrSize = 48, qrX = (W - qrSize) / 2, qrY = 60, quiet = 4;
    doc.setFillColor(255, 255, 255);
    doc.rect(qrX - quiet, qrY - quiet, qrSize + 2 * quiet, qrSize + 2 * quiet, 'F');
    zeichneQR(doc, rec.token, qrX, qrY, qrSize, cfg.qrFehlerkorrektur);

    // Hinweis
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(90, 90, 90);
    doc.text('Bitte diesen Code am Einlass vorzeigen.', W / 2, qrY + qrSize + 10,
      { align: 'center', maxWidth: W - 2 * M });

    // Fußzeile
    if (cfg.fusszeile) {
      doc.setFontSize(7); doc.setTextColor(140, 140, 140);
      doc.text(String(cfg.fusszeile), W / 2, H - M, { align: 'center', maxWidth: W - 2 * M });
    }
  }

  function erzeugeTicketBytes(jsPDFCtor, rec, cfg) {
    var doc = new jsPDFCtor({ unit: 'mm', format: 'a6', orientation: 'portrait', compress: true });
    zeichneTicket(doc, rec, cfg);
    return doc.output('arraybuffer');
  }

  /* ---------- Gesamtlauf: Tokens + PDFs + ZIP ------------------------ */
  // opts: { records, cfg, jsPDFCtor, JSZipCtor, onProgress(fertig,gesamt) }
  // gibt zurück: { zip, records }   (zip noch nicht serialisiert)
  function baueAlles(opts) {
    var records = opts.records, cfg = opts.cfg;
    var zip = new opts.JSZipCtor();
    var verwendet = Object.create(null);
    var meta = [];
    var p = Promise.resolve();

    records.forEach(function (src, i) {
      p = p.then(function () {
        var rec = {};
        FELDER.forEach(function (f) { rec[f] = src[f] || ''; });
        rec.token = neuerToken();

        var fn = dateiname(cfg.dateinameMuster, rec, i);
        if (verwendet[fn.toLowerCase()]) {
          var base = fn.replace(/\.pdf$/i, ''), k = 2;
          while (verwendet[(base + '_' + k + '.pdf').toLowerCase()]) k++;
          fn = base + '_' + k + '.pdf';
        }
        verwendet[fn.toLowerCase()] = true;
        rec.dateiname = fn;

        zip.file(fn, erzeugeTicketBytes(opts.jsPDFCtor, rec, cfg));
        meta.push(rec);
        if (opts.onProgress) return opts.onProgress(i + 1, records.length);
      });
    });

    return p.then(function () {
      zip.file('tokens.json', JSON.stringify(tokensJson(meta), null, 2));
      zip.file('versand_manifest.csv', manifestCsv(meta));
      return { zip: zip, records: meta };
    });
  }

  /* ---------- Export ------------------------------------------------- */
  TG.FELDER = FELDER;
  TG.base64url = base64url;
  TG.neuerToken = neuerToken;
  TG.erkenneTrennzeichen = erkenneTrennzeichen;
  TG.parseCSV = parseCSV;
  TG.autoMapping = autoMapping;
  TG.hatUeberschrift = hatUeberschrift;
  TG.datensaetzeAusRows = datensaetzeAusRows;
  TG.felderHolen = felderHolen;
  TG.sanitize = sanitize;
  TG.dateiname = dateiname;
  TG.tokensJson = tokensJson;
  TG.manifestCsv = manifestCsv;
  TG.zeichneQR = zeichneQR;
  TG.zeichneTicket = zeichneTicket;
  TG.erzeugeTicketBytes = erzeugeTicketBytes;
  TG.baueAlles = baueAlles;

  root.TG = TG;
  if (typeof module !== 'undefined' && module.exports) module.exports = TG;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

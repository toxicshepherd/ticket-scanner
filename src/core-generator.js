/* =====================================================================
 * core-generator.js  —  Reine Logik für ticket-generator.html
 * ---------------------------------------------------------------------
 * Kein DOM-/UI-Code -> dieselbe Logik läuft im Browser (eingebettet)
 * und in den Node-Tests (test/).
 *
 * Abhängigkeiten (werden übergeben bzw. global bereitgestellt):
 *   - global  qrcode  (qrcode-generator)
 *   - jsPDF-Konstruktor, JSZip-Konstruktor (als Parameter)
 *   - assets = { logo, foto, rueck }  (Data-URLs der eingebetteten Bilder)
 *   - Das Einlesen von XLSX/CSV passiert im UI-Teil; hier wird mit
 *     "rows" (Array von Zeilen-Arrays) weitergearbeitet.
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

  /* ---------- CSV (Fallback neben XLSX) ------------------------------ */
  function erkenneTrennzeichen(text) {
    var firstLine = String(text).split(/\r\n|\n|\r/)[0] || '';
    var semi = (firstLine.match(/;/g) || []).length;
    var comma = (firstLine.match(/,/g) || []).length;
    var tab = (firstLine.match(/\t/g) || []).length;
    if (tab > semi && tab > comma) return '\t';
    return semi >= comma ? ';' : ',';
  }
  function parseCSV(text, delim) {
    text = String(text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    return { delim: delim, rows: rows };
  }

  /* ---------- Spalten automatisch zuordnen ---------------------------
   * Datenmodell der Polizeiakademie-Liste (Blatt "Tabelle1"):
   *   Anrede | Name | Vorname | StO | Einstellungsjahr | bisherige StGr |
   *   Zuteilung | neue StGr
   * Übernommen: Anrede, Name(->nachname), Vorname, StO(->studienort),
   * Einstellungsjahr, neue StGr(->studiengruppe).
   * ------------------------------------------------------------------ */
  var FELDER = ['anrede', 'vorname', 'nachname', 'studienort', 'einstellungsjahr', 'studiengruppe'];
  var FELD_LABELS = {
    anrede: 'Anrede', vorname: 'Vorname', nachname: 'Name',
    studienort: 'Studienort (StO)', einstellungsjahr: 'Einstellungsjahr', studiengruppe: 'Studiengruppe (neue StGr)'
  };
  var SYNONYME = {
    anrede:          ['anrede', 'titel', 'anrede/titel'],
    vorname:         ['vorname', 'first name', 'firstname', 'rufname'],
    nachname:        ['name', 'nachname', 'familienname', 'zuname', 'last name', 'surname'],
    studienort:      ['sto', 'studienort', 'standort', 'studienstandort', 'sto.'],
    einstellungsjahr:['einstellungsjahr', 'einstellung', 'ej', 'einstellungs-jahr'],
    studiengruppe:   ['neue stgr', 'studiengruppe', 'stgr neu', 'neue studiengruppe', 'gruppe', 'stgr']
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
  function hatUeberschrift(rows) {
    if (!rows.length) return false;
    var m = autoMapping(rows[0]);
    var treffer = FELDER.reduce(function (a, f) { return a + (m[f] >= 0 ? 1 : 0); }, 0);
    return treffer >= 2;
  }
  function datensaetzeAusRows(rows, mapping, hatHeader) {
    var start = hatHeader ? 1 : 0, out = [];
    for (var i = start; i < rows.length; i++) out.push(felderHolen(rows[i], mapping));
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
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[ .]+$/, '');
  }
  // opts: { index (global, 1-basiert), nr (Ticket-Nr.), anzahl }
  function dateiname(muster, rec, opts) {
    opts = opts || {};
    var name = String(muster || '{nachname}, {vorname} - Ticket {nr}von{anzahl}')
      .replace(/\{(\w+)\}/g, function (m, k) {
        k = k.toLowerCase();
        if (k === 'index') return String(opts.index || 1).padStart(4, '0');
        if (k === 'nr') return String(opts.nr || 1);
        if (k === 'anzahl' || k === 'von') return String(opts.anzahl || 1);
        return rec[k] != null ? String(rec[k]) : '';
      });
    name = sanitize(name);
    if (!name) name = 'ticket_' + String(opts.index || 1).padStart(4, '0');
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    return name;
  }

  /* ---------- Ausgabedateien ----------------------------------------- */
  function tokensJson(records) {
    return records.map(function (r) {
      return {
        token: r.token, anrede: r.anrede, vorname: r.vorname, nachname: r.nachname,
        studienort: r.studienort, einstellungsjahr: r.einstellungsjahr,
        studiengruppe: r.studiengruppe, ticketNr: r.ticketNr, ticketAnzahl: r.ticketAnzahl
      };
    });
  }
  function csvFeld(v, d) {
    v = (v == null ? '' : String(v));
    return (v.indexOf('"') >= 0 || v.indexOf('\r') >= 0 || v.indexOf('\n') >= 0 || v.indexOf(d) >= 0)
      ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // Ohne E-Mail in der Liste: Versand erfolgt namensbasiert (Outlook-Makro
  // löst "Vorname Nachname" über das Adressbuch auf).
  function manifestCsv(records) {
    var d = ';', lines = ['Nachname' + d + 'Vorname' + d + 'TicketNr' + d + 'Anzahl' + d + 'Dateiname'];
    records.forEach(function (r) {
      lines.push([csvFeld(r.nachname, d), csvFeld(r.vorname, d), r.ticketNr, r.ticketAnzahl, csvFeld(r.dateiname, d)].join(d));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ===================================================================
   * VORLAGE (PDF)  —  Polizeiakademie-Eintrittskarte (Querformat 212x100 mm)
   * Hintergrund = Originalvorlage als Bild (assets.front / assets.back,
   * aus der PowerPoint-Vorlage). Darüber werden NUR die variablen Texte und
   * der QR an den EXAKTEN Positionen der Vorlage platziert (Maße in mm,
   * direkt aus der .pptx übernommen).
   * Felder in cfg (alle als Text frei editierbar / über Anlass-Vorlagen):
   *   linksTitel, linksZusatz, linksDatum, linksEinlass  (Abriss links)
   *   datumLang (graue Leiste rechts), anlass (rechts), ort (rechts)
   * =================================================================== */
  var KARTE = { W: 212, H: 100 };

  // mehrzeilig ausgeben; align 'center'|'left'; gibt das y NACH dem Block zurück
  function textBlock(doc, text, x, y, lh, maxW, align) {
    var zeilen = doc.splitTextToSize(String(text), maxW);
    for (var i = 0; i < zeilen.length; i++) doc.text(zeilen[i], x, y + i * lh, align ? { align: align } : undefined);
    return y + zeilen.length * lh;
  }

  function zeichneQR(doc, token, x, y, sizeMM, ecLevel) {
    var qr = qrcode(0, ecLevel || 'M');
    qr.addData(token); qr.make();
    var n = qr.getModuleCount(), cell = sizeMM / n;
    doc.setFillColor(0, 0, 0);
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) {
          var c2 = c; while (c2 + 1 < n && qr.isDark(r, c2 + 1)) c2++;
          doc.rect(x + c * cell, y + r * cell, (c2 - c + 1) * cell, cell, 'F');
          c = c2 + 1;
        } else c++;
      }
    }
  }

  function zeichneFront(doc, rec, cfg, assets) {
    var W = KARTE.W, H = KARTE.H;
    // Hintergrund = Originalvorlage (Foto + blaues Panel + Logo + EINTRITTSKARTE + graue Leiste)
    if (assets && assets.front) { try { doc.addImage(assets.front, 'JPEG', 0, 0, W, H); } catch (e) {} }
    else { doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, 'F'); }

    // QR auf weißem Feld (Abriss links) — Platzhalter {{QR}}: x5.1 y7.8 30x30 mm
    var qx = 5.1, qy = 7.8, qs = 30;
    doc.setFillColor(255, 255, 255); doc.rect(qx - 2.4, qy - 2.4, qs + 4.8, qs + 4.8, 'F');
    zeichneQR(doc, rec.token, qx, qy, qs, cfg.qrFehlerkorrektur);

    // Name + Ticket — {{NAME}}{{TICKET}}: Box x1.4 y39.5 w37.4, 8pt zentriert, weiß
    var cxL = 1.4 + 37.4 / 2;
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    var name = [rec.anrede, rec.vorname, rec.nachname].filter(Boolean).join(' ') || '—';
    var yy = textBlock(doc, name, cxL, 39.5 + 3, 3.3, 36, 'center');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('Ticket ' + (rec.ticketNr || 1) + ' / ' + (rec.ticketAnzahl || 1), cxL, yy + 0.4, { align: 'center' });

    // Linker Anlass-Block — Box x0.7 y61 w39.2, 8pt zentriert, weiß
    var cxB = 0.7 + 39.2 / 2, by = 61 + 3;
    doc.setTextColor(255, 255, 255);
    if (cfg.linksTitel) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); by = textBlock(doc, cfg.linksTitel, cxB, by, 3.4, 38, 'center') + 0.9; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    if (cfg.linksZusatz) { by = textBlock(doc, cfg.linksZusatz, cxB, by, 3.3, 38, 'center') + 0.6; }
    if (cfg.linksDatum) { by = textBlock(doc, cfg.linksDatum, cxB, by, 3.3, 38, 'center') + 2.4; }
    if (cfg.linksEinlass) { doc.setFont('helvetica', 'bold'); textBlock(doc, cfg.linksEinlass, cxB, by, 3.3, 38, 'center'); }

    // Rechtes Panel — Datum auf grauer Leiste — Box x106.9 y66, 11pt, dunkel
    doc.setTextColor(30, 35, 60); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    if (cfg.datumLang) doc.text(String(cfg.datumLang), 106.9, 66 + 5, { maxWidth: 103 });
    // Anlass — Box x106.9 y75.8, 12pt, weiß fett
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    if (cfg.anlass) textBlock(doc, cfg.anlass, 106.9, 75.8 + 4.6, 5.4, 103.7);
    // Veranstaltungsort — Box x106.9 y92.1, ~7.5pt, weiß fett
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    if (cfg.ort) doc.text(String(cfg.ort), 106.9, 92.1 + 3.3, { maxWidth: 103.7 });
  }

  function zeichneBack(doc, cfg, assets) {
    if (assets && assets.back) { try { doc.addImage(assets.back, 'JPEG', 0, 0, KARTE.W, KARTE.H); return; } catch (e) {} }
    doc.setFillColor(238, 240, 243); doc.rect(0, 0, KARTE.W, KARTE.H, 'F');
  }

  function erzeugeTicketBytes(jsPDFCtor, rec, cfg, assets) {
    var doc = new jsPDFCtor({ unit: 'mm', format: [KARTE.W, KARTE.H], orientation: 'landscape', compress: true });
    zeichneFront(doc, rec, cfg, assets);
    doc.addPage([KARTE.W, KARTE.H], 'landscape');
    zeichneBack(doc, cfg, assets);
    return doc.output('arraybuffer');
  }

  /* ---------- Gesamtlauf: Personen -> Tickets -> PDFs + ZIP ----------
   * opts: { records, cfg, assets, jsPDFCtor, JSZipCtor, onProgress }
   * cfg.ticketsProPerson (>=1) erzeugt pro Person mehrere Tickets (1/N..N/N),
   * jedes mit eigenem Token.
   * ------------------------------------------------------------------ */
  function baueAlles(opts) {
    var personen = opts.records, cfg = opts.cfg, assets = opts.assets;
    var anzahl = Math.max(1, parseInt(cfg.ticketsProPerson, 10) || 1);
    var zip = new opts.JSZipCtor();
    var verwendet = Object.create(null), meta = [], laufnr = 0;
    var gesamt = personen.length * anzahl;
    var p = Promise.resolve();

    personen.forEach(function (person) {
      for (var t = 1; t <= anzahl; t++) {
        (function (nr) {
          p = p.then(function () {
            laufnr++;
            var rec = {};
            FELDER.forEach(function (f) { rec[f] = person[f] || ''; });
            rec.ticketNr = nr; rec.ticketAnzahl = anzahl;
            rec.token = neuerToken();

            var fn = dateiname(cfg.dateinameMuster, rec, { index: laufnr, nr: nr, anzahl: anzahl });
            if (verwendet[fn.toLowerCase()]) {
              var base = fn.replace(/\.pdf$/i, ''), k = 2;
              while (verwendet[(base + '_' + k + '.pdf').toLowerCase()]) k++;
              fn = base + '_' + k + '.pdf';
            }
            verwendet[fn.toLowerCase()] = true;
            rec.dateiname = fn;

            zip.file(fn, erzeugeTicketBytes(opts.jsPDFCtor, rec, cfg, assets));
            meta.push(rec);
            if (opts.onProgress) return opts.onProgress(laufnr, gesamt);
          });
        })(t);
      }
    });

    return p.then(function () {
      zip.file('tokens.json', JSON.stringify(tokensJson(meta), null, 2));
      zip.file('versand_manifest.csv', manifestCsv(meta));
      return { zip: zip, records: meta };
    });
  }

  /* ---------- Export ------------------------------------------------- */
  TG.FELDER = FELDER; TG.FELD_LABELS = FELD_LABELS;
  TG.base64url = base64url; TG.neuerToken = neuerToken;
  TG.erkenneTrennzeichen = erkenneTrennzeichen; TG.parseCSV = parseCSV;
  TG.autoMapping = autoMapping; TG.hatUeberschrift = hatUeberschrift;
  TG.datensaetzeAusRows = datensaetzeAusRows; TG.felderHolen = felderHolen;
  TG.sanitize = sanitize; TG.dateiname = dateiname;
  TG.tokensJson = tokensJson; TG.manifestCsv = manifestCsv;
  TG.zeichneQR = zeichneQR; TG.zeichneFront = zeichneFront; TG.zeichneBack = zeichneBack;
  TG.erzeugeTicketBytes = erzeugeTicketBytes; TG.baueAlles = baueAlles;
  TG.KARTE = KARTE;

  root.TG = TG;
  if (typeof module !== 'undefined' && module.exports) module.exports = TG;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

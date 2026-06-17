/* =====================================================================
 * build.mjs  —  Baut die zwei eigenständigen, OFFLINE lauffähigen Dateien
 *               ticket-generator.html  und  einlass-scanner.html
 *
 * Vorgehen: Bibliotheks-Quellcode (vendor/) + reine Logik (src/core-*.js)
 * werden DIREKT als <script>…</script> in die Vorlagen (src/*.template.html)
 * an den Markern <!--INLINE:name--> eingefügt. Ergebnis: keine externen
 * Referenzen, keine CDN-Tags, kein Netzwerkzugriff zur Laufzeit.
 *
 * Aufruf:  node build.mjs
 * ===================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => path.join(__dirname, p);

// Marker -> Quelldatei
const QUELLEN = {
  qrcode: 'vendor/qrcode-generator.js',
  jspdf: 'vendor/jspdf.umd.min.js',
  jszip: 'vendor/jszip.min.js',
  jsqr: 'vendor/jsqr.js',
  xlsx: 'vendor/xlsx.mini.min.js',
  'core-generator': 'src/core-generator.js',
  'core-scanner': 'src/core-scanner.js'
};

// Karten-Hintergründe (aus der PowerPoint-Vorlage) als Data-URLs einbetten
function assetsBlock() {
  const data = {
    front: 'data:image/jpeg;base64,' + fs.readFileSync(R('src/assets/front.jpg')).toString('base64'),
    back: 'data:image/jpeg;base64,' + fs.readFileSync(R('src/assets/back.jpg')).toString('base64')
  };
  return '<script>\n/* ===== eingebettete Karten-Hintergründe (Originalvorlage, lokal) ===== */\n'
    + 'window.__ASSETS=' + JSON.stringify(data) + ';\n</' + 'script>';
}

// JS für die sichere Einbettung in <script> aufbereiten
function aufbereiten(code) {
  return code
    // sourceMappingURL-Verweise entfernen (sonst Versuch, .map nachzuladen)
    .replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '')
    // </script> im Quelltext darf das Inline-Skript nicht beenden
    .replace(/<\/script/gi, '<\\/script');
}

function inlineBlock(marker) {
  const datei = QUELLEN[marker];
  const code = fs.readFileSync(R(datei), 'utf8');
  return '<script>\n/* ===== eingebettet: ' + datei + ' (lokal, keine externe Referenz) ===== */\n'
    + aufbereiten(code) + '\n</script>';
}

function baue(template, ziel) {
  let html = fs.readFileSync(R(template), 'utf8');
  html = html.replace(/<!--INLINE:([\w-]+)-->/g, (m, name) => {
    if (name === 'assets') return assetsBlock();
    if (!QUELLEN[name]) throw new Error('Unbekannter Inline-Marker: ' + name);
    return inlineBlock(name);
  });

  // Sicherheits-Checks: keine Restmarker
  const restMarker = html.match(/<!--INLINE:[\w-]+-->/g);
  if (restMarker) throw new Error('Nicht ersetzte Marker in ' + ziel + ': ' + restMarker.join(', '));

  // Strukturprüfung auf der HTML-Auszeichnung (Skript-Inhalte herausgenommen,
  // damit String-Literale in den Bibliotheken keine Fehlalarme auslösen):
  // keine externen Referenzen in Markup oder CSS.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const probleme = [];
  if (/<script[^>]*\bsrc\s*=/i.test(markup)) probleme.push('<script src=…>');
  if (/<link[^>]+stylesheet/i.test(markup)) probleme.push('<link rel=stylesheet>');
  const refs = markup.match(/(?:src|href)\s*=\s*["']https?:\/\//gi);
  if (refs) probleme.push('externe src/href: ' + refs.join(', '));
  const cssUrls = markup.match(/url\(\s*["']?https?:\/\//gi);
  if (cssUrls) probleme.push('externe CSS-URL: ' + cssUrls.join(', '));
  if (/@import\s+(?:url\()?["']?https?:/i.test(markup)) probleme.push('@import (extern)');
  if (probleme.length) throw new Error('Externe Referenz in ' + ziel + ': ' + probleme.join(' | '));

  fs.writeFileSync(R(ziel), html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log('✓ ' + ziel + '  (' + kb + ' KB)');
}

baue('src/ticket-generator.template.html', 'ticket-generator.html');
baue('src/einlass-scanner.template.html', 'einlass-scanner.html');
// Für GitHub Pages: der Scanner ist zugleich die Startseite (index.html)
baue('src/einlass-scanner.template.html', 'index.html');
console.log('Fertig. Generator offline; Scanner zusätzlich als index.html (GitHub Pages).');

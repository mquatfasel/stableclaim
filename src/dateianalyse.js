// src/dateianalyse.js
// Liest hochgeladene CSV- und Excel-Dateien (.xlsx) wirklich aus — ohne
// externe Pakete. Für .xlsx wird ein bewusst minimaler ZIP-/OOXML-Reader
// verwendet (nur so viel wie nötig, um Zellwerte des ersten Arbeitsblatts
// zu lesen); Node bringt mit dem eingebauten "zlib" bereits alles mit, was
// für das DEFLATE-komprimierte ZIP-Format gebraucht wird.

const zlib = require('zlib');

// ---------- sehr kleiner ZIP-Reader ----------
function readZipEntries(buffer) {
  // End-of-central-directory-Signatur suchen (0x06054b50), von hinten.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Keine gültige .xlsx-Datei (ZIP-Struktur nicht erkannt).');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cdOffset = buffer.readUInt32LE(eocd + 16);

  const entries = {};
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(cdOffset + 10);
    const compressedSize = buffer.readUInt32LE(cdOffset + 20);
    const nameLen = buffer.readUInt16LE(cdOffset + 28);
    const extraLen = buffer.readUInt16LE(cdOffset + 30);
    const commentLen = buffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
    const name = buffer.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);
    entries[name] = { compressionMethod, compressedSize, localHeaderOffset };
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buffer, entries, name) {
  const entry = entries[name];
  if (!entry) return null;
  const off = entry.localHeaderOffset;
  if (buffer.readUInt32LE(off) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt.');
  const nameLen = buffer.readUInt16LE(off + 26);
  const extraLen = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buffer.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return raw;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(raw);
  throw new Error('Nicht unterstützte Komprimierung in .xlsx-Datei.');
}

function stripTags(xmlFragment) {
  return xmlFragment.replace(/<[^>]+>/g, '');
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    out.push(decodeXmlEntities(stripTags(m[1])));
  }
  return out;
}

function colLetterToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowXml = rowMatch[1];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    const row = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowXml))) {
      const attrs = cellMatch[1] !== undefined ? cellMatch[1] : cellMatch[3];
      const inner = cellMatch[2] || '';
      const rAttr = /r="([A-Z]+)\d+"/.exec(attrs || '');
      const colIdx = rAttr ? colLetterToIndex(rAttr[1]) : row.length;
      const tAttr = /t="([a-zA-Z]+)"/.exec(attrs || '');
      const type = tAttr ? tAttr[1] : 'n';
      let value = '';
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const idx = v ? Number(decodeXmlEntities(v[1])) : -1;
        value = sharedStrings[idx] != null ? sharedStrings[idx] : '';
      } else if (type === 'inlineStr') {
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        value = t ? decodeXmlEntities(stripTags(t[1])) : '';
      } else if (type === 'str' || type === 'e' || type === 'b') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXmlEntities(v[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = v ? decodeXmlEntities(v[1]) : '';
      }
      while (row.length < colIdx) row.push('');
      row[colIdx] = value;
    }
    rows.push(row);
  }
  return rows;
}

function readXlsxRows(buffer) {
  const entries = readZipEntries(buffer);
  const sheetName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(entries).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetName) throw new Error('Kein Arbeitsblatt in der Datei gefunden.');
  const sharedStringsBuf = readZipFile(buffer, entries, 'xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedStringsBuf ? sharedStringsBuf.toString('utf8') : '');
  const sheetBuf = readZipFile(buffer, entries, sheetName);
  const rows = parseSheetRows(sheetBuf.toString('utf8'), sharedStrings);
  return { rows, sheetName: 'Tabelle1', sheetNames: ['Tabelle1'] };
}

// ---------- CSV ----------
function readCsvRows(text) {
  const delimiter = (text.match(/;/g) || []).length > (text.match(/,/g) || []).length ? ';' : ',';
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.map((line) => {
    // einfache CSV-Zerlegung mit Unterstützung für in Anführungszeichen
    // gesetzte Felder (reicht für Preislisten-/Bestellexporte).
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
}

// ---------- Spalten erkennen & Zeilen in Kandidaten umwandeln ----------
const NAME_HEADERS = ['artikel', 'bezeichnung', 'name', 'produkt', 'artikelbezeichnung'];
const NUMMER_HEADERS = ['artikelnummer', 'art.-nr', 'art-nr', 'artikelnr', 'nummer', 'artnr'];
const PREIS_HEADERS = ['preis', 'ek-preis', 'einkaufspreis', 'preis pro gebinde', 'gebindepreis', 'netto', 'ek'];
const KATEGORIE_HEADERS = ['kategorie', 'warengruppe', 'gruppe'];

function matchHeader(headerRow, candidates) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().trim();
    if (candidates.some((c) => h.includes(c))) return i;
  }
  return -1;
}

function parseNumber(raw) {
  if (raw == null || raw === '') return null;
  const cleaned = String(raw).replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  // deutsches Format "1.234,56" -> "1234.56"; sonst als englisches Format lesen
  let normalized = cleaned;
  if (/,\d{1,2}$/.test(cleaned) && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/,\d{1,2}$/.test(cleaned)) {
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function extractCandidates(rows) {
  if (!rows.length) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const rowText = rows[i].join(' ').toLowerCase();
    if (NAME_HEADERS.some((h) => rowText.includes(h))) { headerIdx = i; break; }
  }
  const header = rows[headerIdx] || [];
  const nameCol = matchHeader(header, NAME_HEADERS);
  const nummerCol = matchHeader(header, NUMMER_HEADERS);
  const preisCol = matchHeader(header, PREIS_HEADERS);
  const kategorieCol = matchHeader(header, KATEGORIE_HEADERS);

  const dataRows = rows.slice(headerIdx + 1);
  const candidates = [];
  dataRows.forEach((row, i) => {
    const name = nameCol >= 0 ? row[nameCol] : row[0];
    if (!name || !String(name).trim()) return;
    const preis = preisCol >= 0 ? parseNumber(row[preisCol]) : null;
    candidates.push({
      rowIndex: i,
      name: String(name).trim(),
      artikelnummer: nummerCol >= 0 ? String(row[nummerCol] || '').trim() : '',
      kategorie: kategorieCol >= 0 ? String(row[kategorieCol] || '').trim() : '',
      preisProGebinde: preis,
    });
  });
  return { candidates, nameCol, preisCol };
}

module.exports = { readXlsxRows, readCsvRows, extractCandidates, parseNumber };

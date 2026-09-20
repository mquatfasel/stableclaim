// src/vorlagen.js
// Erzeugt fertige, druckbare HACCP- und Reinigungsplan-Vorlagen als eigenständige
// HTML-Seiten (A4, druckoptimiert). Der Nutzer lädt sie herunter bzw. öffnet sie
// im Browser und druckt sie aus (oder speichert sie über den Browser als PDF), um
// sie anschließend von Hand auszufüllen — siehe Auftrag: "das haccp die putzpläne
// sollen fertige seiten sein die der nutzer runterladen kann um sie dann
// auszufüllen zu können".

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function baseStyles() {
  return `
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #14181c; margin: 0; padding: 28px 34px; }
    h1 { font-size: 1.35rem; margin: 0 0 2px; }
    h1 small { display:block; font-size: .78rem; font-weight: 600; color:#5b6570; margin-top: 4px; text-transform: uppercase; letter-spacing: .04em; }
    .kopf { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #14181c; padding-bottom: 10px; margin-bottom: 16px; }
    .kopf .felder { text-align: right; font-size: .78rem; color: #3a4048; }
    .kopf .felder div { margin-bottom: 3px; }
    .feld-linie { display:inline-block; min-width: 110px; border-bottom: 1px solid #8a9099; margin-left: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: .76rem; }
    th, td { border: 1px solid #b6bcc4; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #eef0f2; font-size: .68rem; text-transform: uppercase; letter-spacing: .03em; color: #3a4048; }
    tbody tr td { height: 22px; }
    .hinweis { font-size: .74rem; color: #5b6570; margin: 4px 0 16px; }
    .unterschrift { display:flex; gap:40px; margin-top: 22px; font-size: .78rem; }
    .unterschrift div { flex:1; border-top: 1px solid #8a9099; padding-top: 4px; }
    .fusszeile { margin-top: 26px; font-size: .68rem; color: #8a9099; display:flex; justify-content: space-between; }
    @media print {
      body { padding: 12mm 14mm; }
      @page { size: A4; margin: 10mm; }
    }
  `;
}

function kopfBlock({ titel, untertitel, betrieb, bereich }) {
  return `
    <div class="kopf">
      <h1>${esc(titel)}<small>${esc(untertitel)}</small></h1>
      <div class="felder">
        <div>Betrieb: <strong>${esc(betrieb)}</strong></div>
        <div>Bereich: <strong>${esc(bereich)}</strong></div>
        <div>Monat/Jahr: <span class="feld-linie">&nbsp;</span></div>
      </div>
    </div>
  `;
}

function fusszeile(quelle) {
  return `<div class="fusszeile"><span>StableClaim — Gastrozentrale</span><span>${esc(quelle)}</span></div>`;
}

function leereZeilen(anzahl, spalten) {
  const zelle = '<td>&nbsp;</td>';
  const zeile = `<tr>${zelle.repeat(spalten)}</tr>`;
  return zeile.repeat(anzahl);
}

// ---------- HACCP: Temperaturkontrolle ----------
function renderHaccpVorlage({ betrieb, bereich }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>HACCP-Kontrollliste – ${esc(bereich)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${kopfBlock({ titel: 'HACCP-Kontrollliste', untertitel: 'Temperaturkontrolle & Wareneingang', betrieb, bereich })}

  <p class="hinweis">Kontrolle nach Eigenkontrollkonzept (HACCP). Abweichungen von der Solltemperatur sind mit Korrekturmaßnahme zu dokumentieren. Diese Liste ist mindestens 2 Jahre aufzubewahren.</p>

  <table>
    <thead>
      <tr>
        <th style="width:9%">Datum</th>
        <th style="width:9%">Uhrzeit</th>
        <th style="width:20%">Gerät / Kontrollpunkt</th>
        <th style="width:9%">Soll-Temp. (°C)</th>
        <th style="width:9%">Ist-Temp. (°C)</th>
        <th style="width:9%">i.O. (✓/✗)</th>
        <th style="width:20%">Abweichung / Korrekturmaßnahme</th>
        <th style="width:15%">Mitarbeiter (Kürzel)</th>
      </tr>
    </thead>
    <tbody>
      ${leereZeilen(31, 8)}
    </tbody>
  </table>

  <p class="hinweis">Zusätzliche Kontrollpunkte in diesem Bereich (z. B. Fritteusenöl, Personalhygiene, Schädlingskontrolle) bitte auf separatem Blatt oder Rückseite dokumentieren.</p>

  <div class="unterschrift">
    <div>Verantwortliche Person (Name, Unterschrift)</div>
    <div>Geprüft von Geschäftsleitung / HACCP-Verantwortlicher am</div>
  </div>

  ${fusszeile('HACCP-Vorlage – zum Ausdrucken und handschriftlichen Ausfüllen')}
</body>
</html>`;
}

// ---------- Reinigungsplan ----------
const REINIGUNGS_VORSCHLAEGE = {
  default: [
    ['Arbeitsflächen', 'Feucht abwischen, Desinfektionsmittel', 'täglich'],
    ['Boden', 'Kehren, feucht wischen', 'täglich'],
    ['Handwaschbecken', 'Reinigen, desinfizieren', 'täglich'],
    ['Abfalleimer', 'Leeren, Behälter reinigen', 'täglich'],
    ['Regale / Ablagen', 'Abwischen, entstauben', 'wöchentlich'],
    ['Wände / Fliesen', 'Abwischen', 'wöchentlich'],
    ['Türen / Griffe', 'Desinfizieren', 'täglich'],
    ['Lüftung / Abzug', 'Filter reinigen', 'monatlich'],
  ],
  küche: [
    ['Arbeitsflächen & Schneidbretter', 'Reinigen, desinfizieren', 'nach jeder Nutzung'],
    ['Herd / Kochfeld', 'Reinigen, Fett entfernen', 'täglich'],
    ['Fritteuse', 'Öl filtern/wechseln, Becken reinigen', 'siehe Herstellerangabe'],
    ['Konvektomat / Backofen', 'Reinigungsprogramm', 'täglich'],
    ['Dunstabzug / Fettfilter', 'Filter reinigen', 'wöchentlich'],
    ['Boden inkl. Ablauf', 'Kehren, wischen, Ablauf reinigen', 'täglich'],
    ['Kühlhaus / Kühlschränke', 'Auswischen, Temperatur kontrollieren', 'wöchentlich'],
    ['Messer & Kleingeräte', 'Spülen, desinfizieren', 'nach jeder Nutzung'],
  ],
  kühlhaus: [
    ['Böden', 'Wischen, desinfizieren', 'wöchentlich'],
    ['Regale', 'Abwischen', 'wöchentlich'],
    ['Türdichtungen', 'Reinigen, auf Beschädigung prüfen', 'monatlich'],
    ['Kondensator / Lüfter', 'Entstauben', 'monatlich'],
    ['Temperaturfühler', 'Kalibrierung prüfen', 'vierteljährlich'],
  ],
  bar: [
    ['Theke / Arbeitsflächen', 'Abwischen, desinfizieren', 'täglich'],
    ['Zapfanlage', 'Spülen nach Reinigungsplan Hersteller', 'wöchentlich'],
    ['Gläserspülmaschine', 'Reinigen, entkalken', 'wöchentlich'],
    ['Eiswürfelmaschine', 'Reinigen, desinfizieren', 'monatlich'],
    ['Boden', 'Wischen', 'täglich'],
  ],
  spülbereich: [
    ['Spülmaschine', 'Reinigen, entkalken', 'wöchentlich'],
    ['Becken / Siebe', 'Reinigen, Speisereste entfernen', 'täglich'],
    ['Ablageflächen', 'Abwischen, desinfizieren', 'täglich'],
    ['Boden inkl. Ablauf', 'Wischen, Ablauf reinigen', 'täglich'],
  ],
};

function reinigungsVorschlaegeFuer(bereich) {
  const key = String(bereich || '').trim().toLowerCase();
  for (const k of Object.keys(REINIGUNGS_VORSCHLAEGE)) {
    if (k !== 'default' && key.includes(k)) return REINIGUNGS_VORSCHLAEGE[k];
  }
  return REINIGUNGS_VORSCHLAEGE.default;
}

function renderReinigungsplanVorlage({ betrieb, bereich }) {
  const vorschlaege = reinigungsVorschlaegeFuer(bereich);
  const vorschlagZeilen = vorschlaege.map(([was, wie, intervall]) => `
    <tr>
      <td>${esc(was)}</td>
      <td>${esc(wie)}</td>
      <td>${esc(intervall)}</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Reinigungsplan – ${esc(bereich)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${kopfBlock({ titel: 'Reinigungsplan', untertitel: 'Reinigung & Desinfektion', betrieb, bereich })}

  <p class="hinweis">Vorbelegte Zeilen sind Vorschläge für diesen Bereich und können angepasst/gestrichen werden. Dosierung laut Herstellerangabe des jeweiligen Reinigungs-/Desinfektionsmittels beachten.</p>

  <table>
    <thead>
      <tr>
        <th style="width:20%">Was wird gereinigt?</th>
        <th style="width:24%">Wie / Mittel</th>
        <th style="width:12%">Intervall</th>
        <th style="width:14%">Verantwortlich</th>
        <th style="width:12%">Datum</th>
        <th style="width:18%">Kontrolle (Kürzel)</th>
      </tr>
    </thead>
    <tbody>
      ${vorschlagZeilen}
      ${leereZeilen(10, 6)}
    </tbody>
  </table>

  <div class="unterschrift">
    <div>Verantwortliche Person (Name, Unterschrift)</div>
    <div>Geprüft von Geschäftsleitung / HACCP-Verantwortlicher am</div>
  </div>

  ${fusszeile('Reinigungsplan-Vorlage – zum Ausdrucken und handschriftlichen Ausfüllen')}
</body>
</html>`;
}

module.exports = { renderHaccpVorlage, renderReinigungsplanVorlage, reinigungsVorschlaegeFuer };


// src/leads.js
// Regelbasierter "Anfragen-Agent": liest den Freitext einer eingefügten E-Mail
// und erkennt Kunde, Termin, Personenzahl, Art der Bewirtung, Budget und
// Allergien über Muster-/Stichwortsuche (kein externer KI-Dienst nötig).
// Bewusst konservativ: lieber ein Feld leer lassen, als etwas Falsches raten —
// im Antwortentwurf wird nach fehlenden Angaben gefragt.

const store = require('./store');

const EVENT_TYP_KEYWORDS = [
  [/\bbuffet\b/i, 'Buffet'],
  [/\bmen(ü|u)\b/i, 'Menü'],
  [/finger ?food/i, 'Fingerfood'],
  [/catering/i, 'Catering'],
  [/à la carte|a la carte/i, 'À la carte'],
];

const ANLASS_KEYWORDS = [
  'Hochzeit', 'Geburtstag', 'Weihnachtsfeier', 'Firmenfeier', 'Firmenveranstaltung',
  'Jubiläum', 'Taufe', 'Konfirmation', 'Kommunion', 'Trauerfeier', 'Beerdigung',
  'Junggesellenabschied', 'Tagung', 'Teamevent', 'Betriebsfeier', 'Sommerfest',
  'Silvester', 'Neujahr', 'Abschlussfeier', 'Geburtstagsfeier',
];

const ALLERGEN_KEYWORDS = [
  [/glutenfrei|\bgluten\b/i, 'Glutenhaltiges Getreide'],
  [/krebstier/i, 'Krebstiere und -erzeugnisse'],
  [/\bei\b|\beier\b|eiallergie/i, 'Eier und -erzeugnisse'],
  [/\bfisch\b/i, 'Fisch und -erzeugnisse'],
  [/erdnuss|erdnüsse/i, 'Erdnüsse und -erzeugnisse'],
  [/\bsoja\b/i, 'Sojabohnen und -erzeugnisse'],
  [/laktose|milchallergie|\bmilch\b/i, 'Milch und -erzeugnisse (Laktose)'],
  [/schalenfr(ü|u)chte|n(ü|u)ssen\b|n(ü|u)sse\b|\bnuss\w*/i, 'Schalenfrüchte (Nüsse)'],
  [/sellerie/i, 'Sellerie'],
  [/\bsenf\b/i, 'Senf'],
  [/sesam/i, 'Sesamsamen'],
  [/sulfit|schwefel/i, 'Schwefeldioxid und Sulfite'],
  [/lupine/i, 'Lupinen und -erzeugnisse'],
  [/weichtier/i, 'Weichtiere und -erzeugnisse'],
];

const MONATE = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
  august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

function findPersonen(text) {
  const m = text.match(/(\d{1,4})\s*(personen|gästen|gäste|pax|erwachsene)/i);
  return m ? Number(m[1]) : null;
}

function findTermin(text) {
  // "20.12.2026", "20.12.", "20. Dezember 2026", "20. Dezember"
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\b/);
  if (m) {
    const tag = m[1].padStart(2, '0');
    const monat = m[2].padStart(2, '0');
    const jahr = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear());
    return `${tag}.${monat}.${jahr}`;
  }
  m = text.match(/\b(\d{1,2})\.\s*(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})?\b/i);
  if (m) {
    const tag = m[1].padStart(2, '0');
    const monatName = m[2].toLowerCase();
    const monat = String(MONATE[monatName] || 1).padStart(2, '0');
    const jahr = m[3] || String(new Date().getFullYear());
    return `${tag}.${monat}.${jahr}`;
  }
  return null;
}

function findBudget(text) {
  const waehrung = '(?:€|eur|euro)';
  let m = text.match(new RegExp(`(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*${waehrung}\\s*(?:pro|\\/|p\\.?\\s*p\\.?)\\s*(?:person|pp)?`, 'i'));
  if (!m) m = text.match(new RegExp(`(?:budget|p\\.?\\s*p\\.?)[^\\d€]{0,15}(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*${waehrung}`, 'i'));
  if (!m) m = text.match(new RegExp(`(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*${waehrung}\\b`, 'i'));
  return m ? `${m[1].replace('.', ',')} €` : null;
}

function findKontakt(text, from) {
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) return email[0];
  const telefon = text.match(/(\+49|0)[0-9 /-]{6,}/);
  if (telefon) return telefon[0].trim();
  return from || null;
}

function findKundeName(text, from) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const grussIdx = lines.findIndex((l) => /^(mit freundlichen grüßen|freundliche grüße|viele grüße|beste grüße|liebe grüße|mfg|lg)\b/i.test(l));
  if (grussIdx !== -1 && lines[grussIdx + 1]) {
    const candidate = lines[grussIdx + 1];
    if (candidate.length <= 60 && !/[@:]/.test(candidate)) return candidate;
  }
  if (from) {
    const local = String(from).split('@')[0].replace(/[._-]+/g, ' ').trim();
    if (local) return local.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function findAnlass(text) {
  const found = ANLASS_KEYWORDS.find((k) => new RegExp(`\\b${k}\\b`, 'i').test(text));
  return found || null;
}

function findEventTyp(text) {
  const hit = EVENT_TYP_KEYWORDS.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

function findAllergien(text) {
  const gefunden = new Set();
  ALLERGEN_KEYWORDS.forEach(([re, label]) => {
    if (re.test(text)) gefunden.add(label);
  });
  return Array.from(gefunden);
}

function parseAnfrageEmail({ from, subject, text }) {
  const body = String(text || '');
  const anlass = findAnlass(body) || findAnlass(String(subject || ''));
  return {
    kundeName: findKundeName(body, from),
    kundeKontakt: findKontakt(body, from),
    anlass,
    eventTyp: findEventTyp(body) || (anlass ? 'Sonstiges' : null),
    personen: findPersonen(body),
    datum: findTermin(body),
    budgetProPerson: findBudget(body),
    allergien: findAllergien(body),
  };
}

function buildEntwurf(parsed) {
  const anrede = parsed.kundeName ? `Sehr geehrte/r Frau/Herr ${parsed.kundeName},` : 'Sehr geehrte Damen und Herren,';
  const teile = [];
  if (parsed.anlass) teile.push(`Ihre ${parsed.anlass}`);
  else teile.push('Ihre Veranstaltungsanfrage');
  if (parsed.datum) teile.push(`am ${parsed.datum}`);
  if (parsed.personen) teile.push(`für ${parsed.personen} Personen`);
  const zusammenfassung = teile.join(' ');

  const fehlend = [];
  if (!parsed.personen) fehlend.push('die ungefähre Personenzahl');
  if (!parsed.datum) fehlend.push('das gewünschte Datum');
  if (!parsed.eventTyp) fehlend.push('ob Sie sich eher Buffet, Menü oder à la carte vorstellen');
  if (!parsed.budgetProPerson) fehlend.push('einen groben Rahmen für das Budget pro Person');

  const rueckfrage = fehlend.length
    ? `\n\nDamit wir Ihnen ein möglichst passendes Angebot erstellen können, teilen Sie uns bitte noch mit: ${fehlend.join(', ')}.`
    : '';
  const allergienHinweis = parsed.allergien && parsed.allergien.length
    ? `\n\nWir haben notiert, dass folgende Allergene relevant sein könnten: ${parsed.allergien.join(', ')}. Gerne stimmen wir die Speisenauswahl entsprechend ab.`
    : '';

  return `${anrede}\n\nvielen Dank für ${zusammenfassung}. Wir kümmern uns gerne um eine passende Planung für Sie.${rueckfrage}${allergienHinweis}\n\nWir melden uns in Kürze mit einem konkreten Vorschlag bei Ihnen.\n\nMit freundlichen Grüßen\nIhr Team`;
}

module.exports = { parseAnfrageEmail, buildEntwurf };

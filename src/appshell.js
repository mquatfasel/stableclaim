// src/appshell.js
// REST-Handler für die neuen, echten Module der App-Shell (siehe
// public/dashboard.js): Anfragen, Kalkulation (Kartenpositionen),
// Rezepturen (nutzt dieselben Daten wie Kalkulation), Artikelstamm,
// Lieferanten & Preisvergleich, Allergene/Gerichte, HACCP (Ausrüstung +
// Konzept), Reinigungspläne (Einträge), Aufgaben, E-Mail-Anfragen-Agent,
// Dokumentenanalyse/-archiv, Support. Reines Node.js, keine externen Pakete.

const crypto = require('crypto');
const store = require('./store');
const leads = require('./leads');
const dateianalyse = require('./dateianalyse');
const vorlagenModul = require('./vorlagen');

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024; // 16 MB Rohdaten (Base64 ist ~33% größer als die Datei)

function readJSONBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (maxBytes || MAX_BODY_BYTES)) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function requireUser(auth, req, res) {
  const { user } = auth.currentUser(req);
  if (!user) {
    sendJSON(res, 401, { error: 'Nicht angemeldet.' });
    return null;
  }
  return user;
}

async function withBody(req, res, fn, maxBytes) {
  let body;
  try {
    body = await readJSONBody(req, maxBytes);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }
  return fn(body);
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(n, dec) {
  if (n == null) return null;
  const f = Math.pow(10, dec);
  return Math.round(n * f) / f;
}

// ---------- Einheiten & Preisumrechnung ----------
function baseUnitFor(gebindeeinheit) {
  const e = String(gebindeeinheit || '').toLowerCase();
  if (e === 'g') return 'kg';
  if (e === 'ml') return 'l';
  if (e === 'stück' || e === 'stueck') return 'stück';
  return e || 'kg';
}
function toBaseMenge(gebindegroesse, gebindeeinheit) {
  const e = String(gebindeeinheit || '').toLowerCase();
  const menge = num(gebindegroesse) || 0;
  if (e === 'g' || e === 'ml') return menge / 1000;
  return menge;
}
function computeEinheitspreis(preisProGebinde, gebindegroesse, gebindeeinheit) {
  const preis = num(preisProGebinde);
  const baseMenge = toBaseMenge(gebindegroesse, gebindeeinheit);
  if (preis == null || !baseMenge) return null;
  return round(preis / baseMenge, 4);
}

module.exports = function createAppshellHandlers({ auth }) {
  // ---------- Artikelstamm ----------
  async function handleArticlesList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    await store.seedArticlesForBetriebIfEmpty(user.betrieb);
    const articles = store.articlesStore.list(user.betrieb).map((a) => ({ ...a }));
    return sendJSON(res, 200, { articles, allergene: store.ALLERGENE_14 });
  }

  async function handleArticlesCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Bitte einen Artikelnamen angeben.' });
      const gebindegroesse = num(body.gebindegroesse) || 1;
      const gebindeeinheit = String(body.gebindeeinheit || 'kg');
      const preisProGebinde = num(body.preisProGebinde);
      const article = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        name,
        artikelnummer: String(body.artikelnummer || '').trim(),
        kategorie: String(body.kategorie || '').trim(),
        lieferantId: body.lieferantId || null,
        gebindegroesse,
        gebindeeinheit,
        einheit: baseUnitFor(gebindeeinheit),
        einheitspreis: computeEinheitspreis(preisProGebinde, gebindegroesse, gebindeeinheit),
        preisProGebinde,
        vorherigerPreisProGebinde: null,
        preisAenderungProzent: null,
        preisHistorie: preisProGebinde != null ? [{ preis: preisProGebinde, datum: new Date().toISOString() }] : [],
        mindestbestand: num(body.mindestbestand),
        aktuellerBestand: num(body.aktuellerBestand),
        allergene: Array.isArray(body.allergene) ? body.allergene.map(store.normalizeAllergen) : [],
        allergeneUnbekannt: false,
        notizen: String(body.notizen || ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.articlesStore.insert(article);
      return sendJSON(res, 201, { article });
    });
  }

  async function handleArticlesDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.articlesStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // Preis eines Artikels aktualisieren (mit Preisverlauf) — wird von der
  // Dokumentenanalyse beim Übernehmen erkannter Preisänderungen genutzt.
  async function updateArticlePrice(betrieb, articleId, neuerPreis) {
    const article = store.articlesStore.findById(articleId, betrieb);
    if (!article) return null;
    const alterPreis = article.preisProGebinde;
    const historie = Array.isArray(article.preisHistorie) ? article.preisHistorie.slice(-19) : [];
    historie.push({ preis: neuerPreis, datum: new Date().toISOString() });
    const patch = {
      preisProGebinde: neuerPreis,
      einheitspreis: computeEinheitspreis(neuerPreis, article.gebindegroesse, article.gebindeeinheit),
      preisHistorie: historie,
    };
    if (alterPreis != null && alterPreis > 0) {
      patch.vorherigerPreisProGebinde = alterPreis;
      patch.preisAenderungProzent = round(((neuerPreis - alterPreis) / alterPreis) * 100, 1);
    }
    return store.articlesStore.update(articleId, betrieb, patch);
  }

  // ---------- Lieferanten ----------
  async function handleSuppliersList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { suppliers: store.suppliersStore.list(user.betrieb) });
  }

  async function handleSuppliersCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen angeben.' });
      const supplier = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        name,
        ansprechpartner: String(body.ansprechpartner || ''),
        bestelltage: String(body.bestelltage || ''),
        mindestbestellwert: num(body.mindestbestellwert),
        lieferkosten: num(body.lieferkosten),
        zahlungsbedingungen: String(body.zahlungsbedingungen || ''),
        telefon: String(body.telefon || ''),
        email: String(body.email || ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.suppliersStore.insert(supplier);
      return sendJSON(res, 201, { supplier });
    });
  }

  async function handleSuppliersDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.suppliersStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    // Zugehörige Preise mit entfernen (siehe Bestätigungstext im Frontend).
    const prices = store.supplierPricesStore.list(user.betrieb).filter((p) => p.supplierId === id);
    for (const p of prices) {
      try { await store.supplierPricesStore.remove(p.id, user.betrieb); } catch (e) { /* bereits weg */ }
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Preise je Lieferant + Preisvergleich ----------
  async function handleSupplierPricesCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const supplierId = String(body.supplierId || '');
      const artikelName = String(body.artikelName || '').trim();
      const gebindegroesse = num(body.gebindegroesse);
      const preisProGebinde = num(body.preisProGebinde);
      if (!supplierId || !artikelName || !gebindegroesse || preisProGebinde == null) {
        return sendJSON(res, 400, { error: 'Bitte Lieferant, Artikel, Gebindegröße und Preis angeben.' });
      }
      const supplier = store.suppliersStore.findById(supplierId, user.betrieb);
      if (!supplier) return sendJSON(res, 404, { error: 'Lieferant nicht gefunden.' });
      const gebindeeinheit = String(body.gebindeeinheit || 'kg');
      const price = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        supplierId,
        artikelName,
        kategorie: String(body.kategorie || ''),
        gebindegroesse,
        gebindeeinheit,
        einheit: baseUnitFor(gebindeeinheit),
        preisProGebinde,
        einheitspreis: computeEinheitspreis(preisProGebinde, gebindegroesse, gebindeeinheit),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.supplierPricesStore.insert(price);
      return sendJSON(res, 201, { price });
    });
  }

  async function handleSupplierPricesDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.supplierPricesStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  function handlePriceComparison(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    const prices = store.supplierPricesStore.list(user.betrieb);
    const suppliers = Object.fromEntries(store.suppliersStore.list(user.betrieb).map((s) => [s.id, s]));
    const groups = {};
    prices.forEach((p) => {
      const key = p.artikelName.trim().toLowerCase();
      if (!groups[key]) groups[key] = { artikelName: p.artikelName.trim(), kategorie: p.kategorie || '', angebote: [] };
      groups[key].angebote.push({
        id: p.id,
        lieferantId: p.supplierId,
        lieferantName: suppliers[p.supplierId] ? suppliers[p.supplierId].name : 'Unbekannt',
        gebindegroesse: p.gebindegroesse,
        gebindeeinheit: p.gebindeeinheit,
        preisProGebinde: p.preisProGebinde,
        einheitspreis: p.einheitspreis,
        einheit: p.einheit,
      });
    });
    const vergleich = Object.values(groups).map((g) => {
      g.angebote.sort((a, b) => (a.einheitspreis == null ? Infinity : a.einheitspreis) - (b.einheitspreis == null ? Infinity : b.einheitspreis));
      const preise = g.angebote.map((a) => a.einheitspreis).filter((n) => n != null);
      const min = preise.length ? Math.min(...preise) : null;
      const max = preise.length ? Math.max(...preise) : null;
      g.spanneProzent = min ? round(((max - min) / min) * 100, 0) : 0;
      return g;
    }).sort((a, b) => a.artikelName.localeCompare(b.artikelName, 'de'));
    return sendJSON(res, 200, { vergleich });
  }

  // ---------- Kalkulation (Kartenpositionen) ----------
  function computeKalkFelder({ kartenpreis, wareneinsatz, nurImMix }) {
    if (nurImMix || kartenpreis == null || wareneinsatz == null) {
      return { wareneinsatzquote: null, deckungsbeitrag: null, bewertung: null };
    }
    const nettoVk = kartenpreis / 1.07;
    const wareneinsatzquote = round((wareneinsatz / nettoVk) * 100, 1);
    const deckungsbeitrag = round(nettoVk - wareneinsatz, 2);
    let bewertung = 'Kritisch';
    if (wareneinsatzquote <= 25) bewertung = 'Solide';
    else if (wareneinsatzquote <= 30) bewertung = 'Beobachten';
    else if (wareneinsatzquote <= 40) bewertung = 'Prüfen';
    return { wareneinsatzquote, deckungsbeitrag, bewertung };
  }

  function handleKalkulationList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    const kalkulation = store.kalkulationPositionenStore.list(user.betrieb);
    return sendJSON(res, 200, { kalkulation });
  }

  async function handleKalkulationCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen angeben.' });
      const nurImMix = !!body.nurImMix;
      const kartenpreis = num(body.kartenpreis);
      const wareneinsatz = num(body.wareneinsatz);
      const position = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        kategorie: String(body.kategorie || '').trim(),
        name,
        nurImMix,
        kartenpreis: nurImMix ? null : kartenpreis,
        wareneinsatz,
        faktor3Brutto: num(body.faktor3Brutto),
        faktor4Brutto: num(body.faktor4Brutto),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...computeKalkFelder({ kartenpreis, wareneinsatz, nurImMix }),
      };
      await store.kalkulationPositionenStore.insert(position);
      return sendJSON(res, 201, { position });
    });
  }

  async function handleKalkulationUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const nurImMix = !!body.nurImMix;
      const kartenpreis = num(body.kartenpreis);
      const wareneinsatz = num(body.wareneinsatz);
      const patch = {
        kategorie: body.kategorie !== undefined ? String(body.kategorie || '').trim() : undefined,
        name: body.name !== undefined ? String(body.name || '').trim() : undefined,
        nurImMix,
        kartenpreis: nurImMix ? null : kartenpreis,
        wareneinsatz,
        faktor3Brutto: num(body.faktor3Brutto),
        faktor4Brutto: num(body.faktor4Brutto),
        ...computeKalkFelder({ kartenpreis, wareneinsatz, nurImMix }),
      };
      try {
        const position = await store.kalkulationPositionenStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { position });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleKalkulationDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.kalkulationPositionenStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Allergene je Gericht ----------
  function computeGerichtStatus(allergenStatus) {
    const entries = Object.entries(allergenStatus || {});
    if (!entries.length) return 'Offen';
    if (entries.some(([, v]) => v === '?')) return 'Offen';
    return 'Geprüft';
  }

  function handleGerichteList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { gerichte: store.gerichteStore.list(user.betrieb), allergene: store.ALLERGENE_14 });
  }

  async function handleGerichteCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen angeben.' });
      const allergenStatus = body.allergenStatus && typeof body.allergenStatus === 'object' ? body.allergenStatus : {};
      const gericht = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        name,
        nummer: String(body.nummer || ''),
        verkaufspreis: num(body.verkaufspreis),
        allergenStatus,
        zusatzstoffeAktiv: [],
        status: computeGerichtStatus(allergenStatus),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.gerichteStore.insert(gericht);
      return sendJSON(res, 201, { gericht });
    });
  }

  async function handleGerichteUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const allergenStatus = body.allergenStatus && typeof body.allergenStatus === 'object' ? body.allergenStatus : {};
      const patch = {
        name: body.name !== undefined ? String(body.name || '').trim() : undefined,
        nummer: body.nummer !== undefined ? String(body.nummer || '') : undefined,
        verkaufspreis: num(body.verkaufspreis),
        allergenStatus,
        status: computeGerichtStatus(allergenStatus),
      };
      try {
        const gericht = await store.gerichteStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { gericht });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleGerichteDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.gerichteStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Anfragen (Leads) ----------
  const EVENT_TYPES = ['À la carte', 'Buffet', 'Menü', 'Fingerfood', 'Catering', 'Sonstiges'];
  const LEAD_STATUS_VALUES = ['Neue Anfrage', 'Bearbeitung', 'Angebot erstellt', 'Angebot versendet', 'Rückfrage', 'Bestätigt', 'Abgelehnt', 'Abgeschlossen'];

  function handleLeadsList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { leads: store.leadsStore.list(user.betrieb), eventTypes: EVENT_TYPES, statusValues: LEAD_STATUS_VALUES });
  }

  async function handleLeadsCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const kundeName = String(body.kundeName || '').trim();
      if (!kundeName) return sendJSON(res, 400, { error: 'Bitte einen Kundennamen angeben.' });
      const lead = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        kundeName,
        kundeKontakt: String(body.kundeKontakt || ''),
        anlass: String(body.anlass || ''),
        eventTyp: String(body.eventTyp || ''),
        personen: num(body.personen),
        termin: String(body.termin || ''),
        budgetProPerson: String(body.budgetProPerson || ''),
        allergien: Array.isArray(body.allergien) ? body.allergien : [],
        status: 'Neue Anfrage',
        quelle: body.quelle === 'email' ? 'email' : 'manuell',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.leadsStore.insert(lead);
      return sendJSON(res, 201, { lead });
    });
  }

  async function handleLeadsUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const patch = {};
      if (body.status !== undefined) patch.status = String(body.status);
      try {
        const lead = await store.leadsStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { lead });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleLeadsDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.leadsStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  async function handleLeadsFromEmail(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const text = String(body.text || '').trim();
      if (!text) return sendJSON(res, 400, { error: 'Bitte den Nachrichtentext einfügen.' });
      const parsed = leads.parseAnfrageEmail({ from: body.from, subject: body.subject, text });
      const entwurf = leads.buildEntwurf(parsed);
      const lead = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        kundeName: parsed.kundeName || '',
        kundeKontakt: parsed.kundeKontakt || String(body.from || ''),
        anlass: parsed.anlass || '',
        eventTyp: parsed.eventTyp || '',
        personen: parsed.personen,
        termin: parsed.datum || '',
        budgetProPerson: parsed.budgetProPerson || '',
        allergien: parsed.allergien || [],
        status: 'Neue Anfrage',
        quelle: 'email',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.leadsStore.insert(lead);
      return sendJSON(res, 200, { parsed, entwurf, lead });
    });
  }

  // ---------- Aufgaben ----------
  function handleAufgabenList(req, res, statusFilter) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    let aufgaben = store.aufgabenStore.list(user.betrieb);
    if (statusFilter) aufgaben = aufgaben.filter((a) => a.status === statusFilter);
    return sendJSON(res, 200, { aufgaben });
  }

  async function handleAufgabenCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const titel = String(body.titel || '').trim();
      if (!titel) return sendJSON(res, 400, { error: 'Bitte einen Titel eingeben.' });
      const aufgabe = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        titel,
        bereich: String(body.bereich || ''),
        verantwortlicher: String(body.verantwortlicher || ''),
        prioritaet: ['niedrig', 'mittel', 'hoch'].includes(body.prioritaet) ? body.prioritaet : 'mittel',
        deadline: String(body.deadline || ''),
        beschreibung: String(body.beschreibung || ''),
        status: 'offen',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.aufgabenStore.insert(aufgabe);
      return sendJSON(res, 201, { aufgabe });
    });
  }

  async function handleAufgabenUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const patch = {};
      if (body.status !== undefined && ['offen', 'in_arbeit', 'erledigt'].includes(body.status)) patch.status = body.status;
      try {
        const aufgabe = await store.aufgabenStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { aufgabe });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleAufgabenDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.aufgabenStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- HACCP: Bibliothek (statisch), Ausrüstung, Konzept ----------
  function handleHaccpLibrary(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { templates: store.HACCP_LIBRARY, equipmentTypes: store.HACCP_EQUIPMENT_TYPES });
  }

  function handleHaccpEquipmentList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { equipment: store.haccpEquipmentStore.list(user.betrieb) });
  }

  async function handleHaccpEquipmentCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'Bitte eine Bezeichnung angeben.' });
      const equipment = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        name,
        typ: store.HACCP_EQUIPMENT_TYPES.some((t) => t.id === body.typ) ? body.typ : 'sonstiges',
        standort: String(body.standort || ''),
        sollwertMin: num(body.sollwertMin),
        sollwertMax: num(body.sollwertMax),
        einheit: String(body.einheit || '°C'),
        notizen: String(body.notizen || ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.haccpEquipmentStore.insert(equipment);
      return sendJSON(res, 201, { equipment });
    });
  }

  async function handleHaccpEquipmentDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.haccpEquipmentStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    // Zuordnung in Konzept-Bausteinen aufheben, nicht die Bausteine löschen.
    const konzept = store.haccpConceptStore.list(user.betrieb).filter((c) => c.equipmentId === id);
    for (const c of konzept) {
      try { await store.haccpConceptStore.update(c.id, user.betrieb, { equipmentId: null }); } catch (e) { /* ignore */ }
    }
    return sendJSON(res, 200, { ok: true });
  }

  function handleHaccpConceptList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { concept: store.haccpConceptStore.list(user.betrieb) });
  }

  async function handleHaccpConceptCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      let item;
      if (body.templateId) {
        const tmpl = store.HACCP_LIBRARY.find((t) => t.id === body.templateId);
        if (!tmpl) return sendJSON(res, 404, { error: 'Baustein nicht in der Bibliothek gefunden.' });
        item = {
          id: crypto.randomUUID(),
          betrieb: user.betrieb,
          templateId: tmpl.id,
          custom: false,
          name: tmpl.name,
          kategorie: tmpl.kategorie,
          intervall: tmpl.intervall,
          equipmentId: null,
          sollwertMin: tmpl.sollwertMin,
          sollwertMax: tmpl.sollwertMax,
          einheit: tmpl.einheit,
          beschreibung: tmpl.beschreibung,
          aktiv: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        const name = String(body.name || '').trim();
        if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen angeben.' });
        item = {
          id: crypto.randomUUID(),
          betrieb: user.betrieb,
          templateId: null,
          custom: true,
          name,
          kategorie: String(body.kategorie || 'Sonstiges'),
          intervall: String(body.intervall || ''),
          equipmentId: body.equipmentId || null,
          sollwertMin: num(body.sollwertMin),
          sollwertMax: num(body.sollwertMax),
          einheit: String(body.einheit || ''),
          beschreibung: String(body.beschreibung || ''),
          aktiv: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      await store.haccpConceptStore.insert(item);
      return sendJSON(res, 201, { item });
    });
  }

  async function handleHaccpConceptUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const patch = {};
      if (body.aktiv !== undefined) patch.aktiv = !!body.aktiv;
      try {
        const item = await store.haccpConceptStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { item });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleHaccpConceptDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.haccpConceptStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Reinigungspläne: Vorlagen (aus den echten Bereichen) + Einträge ----------
  function reinigungsVorlageFuerBereich(bereich) {
    const vorschlaege = vorlagenModul.reinigungsVorschlaegeFuer(bereich.name);
    const taeglich = vorschlaege.filter((v) => /täglich|nach jeder nutzung/i.test(v[2]));
    const woechentlich = vorschlaege.filter((v) => /wöchentlich/i.test(v[2]));
    const monatlich = vorschlaege.filter((v) => /monatlich|vierteljährlich|siehe herstellerangabe/i.test(v[2]));
    return {
      id: bereich.id,
      bereich: bereich.name,
      taeglicheKategorien: taeglich.map((v) => v[0]),
      woechentlicheAufgaben: woechentlich.map((v) => `${v[0]} – ${v[1]}`),
      monatlicheAufgaben: monatlich.map((v) => `${v[0]} – ${v[1]}`),
      hinweis: 'Dosierung laut Herstellerangabe des jeweiligen Reinigungs-/Desinfektionsmittels. Eine vollständige, druckbare Vorlage für diesen Bereich lässt sich unter „Bereiche" als PDF-taugliche Seite herunterladen.',
      durchfuehrung: 'lt. Reinigungsplan',
      kontrolle: 'Verantwortliche Person zeichnet gegen',
    };
  }

  function handleReinigungVorlagen(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    const bereiche = store.getBereiche(user.betrieb);
    const vorlagen = bereiche.map(reinigungsVorlageFuerBereich);
    return sendJSON(res, 200, { vorlagen, statusWerte: ['X', '-', '!'] });
  }

  function handleReinigungEintraegeList(req, res, bereichId) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    let eintraege = store.reinigungEintraegeStore.list(user.betrieb);
    if (bereichId) eintraege = eintraege.filter((e) => e.bereichId === bereichId);
    return sendJSON(res, 200, { eintraege });
  }

  async function handleReinigungEintraegeCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const bereichId = String(body.bereichId || '');
      if (!bereichId) return sendJSON(res, 400, { error: 'Bitte einen Bereich angeben.' });
      const eintrag = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        bereichId,
        datum: String(body.datum || new Date().toISOString().slice(0, 10)),
        taeglichStatus: body.taeglichStatus && typeof body.taeglichStatus === 'object' ? body.taeglichStatus : {},
        verantwortlicher: String(body.verantwortlicher || ''),
        notizen: String(body.notizen || ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.reinigungEintraegeStore.insert(eintrag);
      return sendJSON(res, 201, { eintrag });
    });
  }

  async function handleReinigungEintraegeDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.reinigungEintraegeStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Support ----------
  const SUPPORT_KATEGORIEN = ['IT / Technik', 'HACCP-Frage', 'Rezeptur-Frage', 'Artikelstamm', 'Zugang / Account', 'Sonstiges'];
  const SUPPORT_DRINGLICHKEITEN = ['niedrig', 'normal', 'hoch'];

  function handleSupportList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return sendJSON(res, 200, { anfragen: store.supportStore.list(user.betrieb), kategorien: SUPPORT_KATEGORIEN, dringlichkeiten: SUPPORT_DRINGLICHKEITEN });
  }

  async function handleSupportCreate(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const betreff = String(body.betreff || '').trim();
      const nachricht = String(body.nachricht || '').trim();
      if (!betreff || !nachricht) return sendJSON(res, 400, { error: 'Bitte Betreff und Nachricht angeben.' });
      const anfrage = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        betreff,
        nachricht,
        kategorie: SUPPORT_KATEGORIEN.includes(body.kategorie) ? body.kategorie : 'Sonstiges',
        dringlichkeit: SUPPORT_DRINGLICHKEITEN.includes(body.dringlichkeit) ? body.dringlichkeit : 'normal',
        status: 'offen',
        erstelltVon: user.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.supportStore.insert(anfrage);
      return sendJSON(res, 201, { anfrage });
    });
  }

  async function handleSupportUpdate(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const patch = {};
      if (body.status !== undefined && ['offen', 'in_bearbeitung', 'beantwortet', 'geschlossen'].includes(body.status)) patch.status = body.status;
      try {
        const anfrage = await store.supportStore.update(id, user.betrieb, patch);
        return sendJSON(res, 200, { anfrage });
      } catch (e) {
        return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
      }
    });
  }

  async function handleSupportDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.supportStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Dokumente & Dokumentenanalyse ----------
  function handleDocumentsList(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    const documents = store.documentsStore.list(user.betrieb).map((d) => {
      const { fileBase64, ...rest } = d;
      return rest;
    });
    return sendJSON(res, 200, { documents });
  }

  async function handleDocumentsAnalyze(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const filename = String(body.filename || 'Datei').trim();
      const contentBase64 = String(body.contentBase64 || '');
      if (!contentBase64) return sendJSON(res, 400, { error: 'Keine Datei übermittelt.' });
      if (contentBase64.length > MAX_UPLOAD_BYTES) return sendJSON(res, 413, { error: 'Datei ist zu groß (max. 15 MB).' });
      // (Größenprüfung erfolgt hier zusätzlich zur Grenze in readJSONBody, siehe unten.)

      let buffer;
      try {
        buffer = Buffer.from(contentBase64, 'base64');
      } catch (e) {
        return sendJSON(res, 400, { error: 'Datei konnte nicht gelesen werden.' });
      }

      let rows = [];
      let sheetName = null;
      let sheetNames = [];
      let warning = null;
      try {
        if (/\.xlsx$/i.test(filename)) {
          const parsed = dateianalyse.readXlsxRows(buffer);
          rows = parsed.rows;
          sheetName = parsed.sheetName;
          sheetNames = parsed.sheetNames;
        } else if (/\.csv$/i.test(filename)) {
          rows = dateianalyse.readCsvRows(buffer.toString('utf8'));
        } else {
          return sendJSON(res, 400, { error: 'Bitte eine .xlsx- oder .csv-Datei hochladen.' });
        }
      } catch (e) {
        return sendJSON(res, 400, { error: `Datei konnte nicht gelesen werden: ${e.message}` });
      }

      const { candidates: rawCandidates } = dateianalyse.extractCandidates(rows);
      if (!rawCandidates.length) warning = 'Es konnten keine Artikelzeilen in der Datei erkannt werden. Bitte Spaltenüberschriften wie „Artikel" und „Preis" prüfen.';

      await store.seedArticlesForBetriebIfEmpty(user.betrieb);
      const existingArticles = store.articlesStore.list(user.betrieb);
      const byName = new Map(existingArticles.map((a) => [a.name.trim().toLowerCase(), a]));
      const byNummer = new Map(existingArticles.filter((a) => a.artikelnummer).map((a) => [a.artikelnummer, a]));

      const candidates = rawCandidates.map((c) => {
        const match = (c.artikelnummer && byNummer.get(c.artikelnummer)) || byName.get(c.name.trim().toLowerCase());
        if (!match) {
          return { ...c, status: 'neu', matchedArticleId: null, preisAlt: null, preisDiffProzent: null };
        }
        if (c.preisProGebinde == null || match.preisProGebinde == null) {
          return { ...c, status: 'unklar', matchedArticleId: match.id, preisAlt: match.preisProGebinde, preisDiffProzent: null };
        }
        const diff = round(((c.preisProGebinde - match.preisProGebinde) / match.preisProGebinde) * 100, 1);
        if (Math.abs(diff) < 0.05) {
          return { ...c, status: 'unveraendert', matchedArticleId: match.id, preisAlt: match.preisProGebinde, preisDiffProzent: 0 };
        }
        return { ...c, status: 'preisaenderung', matchedArticleId: match.id, preisAlt: match.preisProGebinde, preisDiffProzent: diff };
      });

      const document = {
        id: crypto.randomUUID(),
        betrieb: user.betrieb,
        filename,
        dokumentTyp: body.dokumentTyp && body.dokumentTyp !== 'Automatisch' ? body.dokumentTyp : 'Preisliste',
        sheetName,
        sheetNames,
        candidates,
        appliedRowIndexes: [],
        warning,
        fileBase64: contentBase64,
        fileMime: /\.xlsx$/i.test(filename)
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.documentsStore.insert(document);
      const { fileBase64, ...publicDocument } = document;
      return sendJSON(res, 200, { document: publicDocument });
    }, MAX_UPLOAD_BYTES);
  }

  async function handleDocumentsApply(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      const doc = store.documentsStore.findById(id, user.betrieb);
      if (!doc) return sendJSON(res, 404, { error: 'Dokument nicht gefunden.' });
      const rowIndexes = Array.isArray(body.rowIndexes) ? body.rowIndexes : [];
      let erstellt = 0;
      let aktualisiert = 0;
      for (const rowIndex of rowIndexes) {
        const cand = doc.candidates.find((c) => c.rowIndex === rowIndex);
        if (!cand || doc.appliedRowIndexes.includes(rowIndex)) continue;
        if (cand.status === 'neu') {
          const article = {
            id: crypto.randomUUID(),
            betrieb: user.betrieb,
            name: cand.name,
            artikelnummer: cand.artikelnummer || '',
            kategorie: cand.kategorie || '',
            lieferantId: null,
            gebindegroesse: 1,
            gebindeeinheit: 'kg',
            einheit: 'kg',
            einheitspreis: cand.preisProGebinde,
            preisProGebinde: cand.preisProGebinde,
            vorherigerPreisProGebinde: null,
            preisAenderungProzent: null,
            preisHistorie: cand.preisProGebinde != null ? [{ preis: cand.preisProGebinde, datum: new Date().toISOString() }] : [],
            mindestbestand: null,
            aktuellerBestand: null,
            allergene: [],
            allergeneUnbekannt: true,
            notizen: `Übernommen aus ${doc.filename}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await store.articlesStore.insert(article);
          erstellt++;
        } else if (cand.status === 'preisaenderung' && cand.matchedArticleId) {
          await updateArticlePrice(user.betrieb, cand.matchedArticleId, cand.preisProGebinde);
          aktualisiert++;
        }
        doc.appliedRowIndexes.push(rowIndex);
      }
      await store.documentsStore.update(id, user.betrieb, { appliedRowIndexes: doc.appliedRowIndexes });
      return sendJSON(res, 200, { results: { erstellt, aktualisiert } });
    });
  }

  function handleDocumentsFile(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    const doc = store.documentsStore.findById(id, user.betrieb);
    if (!doc || !doc.fileBase64) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    const buffer = Buffer.from(doc.fileBase64, 'base64');
    res.writeHead(200, {
      'Content-Type': doc.fileMime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  async function handleDocumentsDelete(req, res, id) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    try {
      await store.documentsStore.remove(id, user.betrieb);
    } catch (e) {
      return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ---------- Zusatzmodule (Addons) ----------
  async function handleAddons(req, res) {
    const user = requireUser(auth, req, res);
    if (!user) return;
    return withBody(req, res, async (body) => {
      if (body.addon !== 'haccp') return sendJSON(res, 400, { error: 'Unbekanntes Zusatzmodul.' });
      const enable = !!body.enabled;
      if (enable && !user.plan) {
        return sendJSON(res, 400, { error: 'Bitte zuerst ein Abo wählen, um dieses Zusatzmodul buchen zu können.' });
      }
      const addons = new Set(Array.isArray(user.addons) ? user.addons : []);
      if (enable) addons.add('haccp'); else addons.delete('haccp');
      const updated = await store.updateUser(user.id, { addons: Array.from(addons), haccpIncluded: enable || user.plan === 'enterprise' });
      return sendJSON(res, 200, { user: auth.publicUser(updated) });
    });
  }

  return {
    handleArticlesList, handleArticlesCreate, handleArticlesDelete,
    handleSuppliersList, handleSuppliersCreate, handleSuppliersDelete,
    handleSupplierPricesCreate, handleSupplierPricesDelete, handlePriceComparison,
    handleKalkulationList, handleKalkulationCreate, handleKalkulationUpdate, handleKalkulationDelete,
    handleGerichteList, handleGerichteCreate, handleGerichteUpdate, handleGerichteDelete,
    handleLeadsList, handleLeadsCreate, handleLeadsUpdate, handleLeadsDelete, handleLeadsFromEmail,
    handleAufgabenList, handleAufgabenCreate, handleAufgabenUpdate, handleAufgabenDelete,
    handleHaccpLibrary, handleHaccpEquipmentList, handleHaccpEquipmentCreate, handleHaccpEquipmentDelete,
    handleHaccpConceptList, handleHaccpConceptCreate, handleHaccpConceptUpdate, handleHaccpConceptDelete,
    handleReinigungVorlagen, handleReinigungEintraegeList, handleReinigungEintraegeCreate, handleReinigungEintraegeDelete,
    handleSupportList, handleSupportCreate, handleSupportUpdate, handleSupportDelete,
    handleDocumentsList, handleDocumentsAnalyze, handleDocumentsApply, handleDocumentsFile, handleDocumentsDelete,
    handleAddons,
  };
};

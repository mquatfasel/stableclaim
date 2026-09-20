// src/store.js
// Sehr einfache, dateibasierte Datenhaltung (JSON) — kein externes Paket nötig.
// Für den produktiven Einsatz mit mehreren Standorten empfiehlt sich der Umstieg
// auf eine echte Datenbank (Postgres o.ä.), siehe README.md, Abschnitt "Nächste Schritte".

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const COMPONENTS_FILE = path.join(DATA_DIR, 'components.json');
const KALKULATIONEN_FILE = path.join(DATA_DIR, 'kalkulationen.json');
const BEREICHE_FILE = path.join(DATA_DIR, 'bereiche.json');
const ZEITERFASSUNG_FILE = path.join(DATA_DIR, 'zeiterfassung.json');

// Neue, "echte" Module der App-Shell (siehe public/dashboard.js): jeweils eine
// einfache, je Betrieb (Mandant) gefilterte Liste in einer eigenen JSON-Datei.
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const KALKULATION_POSITIONEN_FILE = path.join(DATA_DIR, 'kalkulation-positionen.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'suppliers.json');
const SUPPLIER_PRICES_FILE = path.join(DATA_DIR, 'supplier-prices.json');
const AUFGABEN_FILE = path.join(DATA_DIR, 'aufgaben.json');
const GERICHTE_FILE = path.join(DATA_DIR, 'gerichte.json');
const HACCP_EQUIPMENT_FILE = path.join(DATA_DIR, 'haccp-equipment.json');
const HACCP_CONCEPT_FILE = path.join(DATA_DIR, 'haccp-concept.json');
const REINIGUNG_EINTRAEGE_FILE = path.join(DATA_DIR, 'reinigung-eintraege.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const SUPPORT_FILE = path.join(DATA_DIR, 'support.json');
const MITARBEITER_FILE = path.join(DATA_DIR, 'mitarbeiter.json');
const SCHICHTEN_FILE = path.join(DATA_DIR, 'schichten.json');

// Die klassischen 14 Hauptallergene (LMIV/EU-Lebensmittelinformationsverordnung),
// in der Formulierung, die schon im bestehenden Artikelstamm verwendet wird.
const ALLERGENE_14 = [
  'Glutenhaltiges Getreide',
  'Krebstiere und -erzeugnisse',
  'Eier und -erzeugnisse',
  'Fisch und -erzeugnisse',
  'Erdnüsse und -erzeugnisse',
  'Sojabohnen und -erzeugnisse',
  'Milch und -erzeugnisse (Laktose)',
  'Schalenfrüchte (Nüsse)',
  'Sellerie',
  'Senf',
  'Sesamsamen',
  'Schwefeldioxid und Sulfite',
  'Lupinen und -erzeugnisse',
  'Weichtiere und -erzeugnisse',
];

// Bestehende Schreibweisen aus dem Artikelstamm (Komponenten-Baukasten) auf die
// kanonische 14er-Liste abbilden, damit Allergenangaben überall gleich heißen.
const ALLERGEN_ALIAS = {
  'Milch und -erzeugnisse': 'Milch und -erzeugnisse (Laktose)',
  'Laktose': 'Milch und -erzeugnisse (Laktose)',
  'Eier und -erzeugnisse': 'Eier und -erzeugnisse',
  'Weichtiere und -erzeugnisse': 'Weichtiere und -erzeugnisse',
  'Krebstiere und -erzeugnisse': 'Krebstiere und -erzeugnisse',
};
function normalizeAllergen(name) {
  return ALLERGEN_ALIAS[name] || name;
}

// Komponenten für den (älteren) Kalkulations-Baukasten (Gerichte & Buffet) —
// bleibt als Datenbasis für /api/components und /api/kalkulationen bestehen.
// Preise und Allergene stammen aus dem echten CHEFS-CULINAR-Konto von SO[U]L Grömitz
// (Kundennummer 120455117, Einkaufsliste "Käufe der letzten 12 Monate"), Stand 20.09.2026.
// "allergene: null" bedeutet: beim jeweiligen Lieferanten noch nicht geprüft — kein
// bestätigt allergenfreier Artikel. Weitere Artikel aus den insgesamt 846 gekauften
// Positionen können hier Schritt für Schritt ergänzt werden (siehe Datenqualität-Hinweis
// im Artikelstamm-Modul).
const DEFAULT_COMPONENTS = [
  { id: 'og-knoblauch', name: 'O+G Knoblauch, Beutel, 1 KG', kategorie: 'Gemüse', einheit: 'kg', preisProEinheit: 8.54, allergene: [], lieferant: 'CHEFS CULINAR', artikelnummer: '14757556', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'og-salatmischung-wildkraeuter', name: 'O+G Salatmischung, Wildkräuter, 250g', kategorie: 'Salat', einheit: 'Schale', preisProEinheit: 4.65, allergene: [], lieferant: 'CHEFS CULINAR', artikelnummer: '14667671', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'og-lauchzwiebeln', name: 'O+G Lauchzwiebeln, 120g Bund', kategorie: 'Gemüse', einheit: 'Bund', preisProEinheit: 0.52, allergene: [], lieferant: 'CHEFS CULINAR', artikelnummer: '14757709', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'og-radieschen', name: 'O+G Radieschen, ohne Grün, 1 KG', kategorie: 'Gemüse', einheit: 'kg', preisProEinheit: 2.06, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '14758263', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'og-zwiebeln-rot', name: 'O+G Zwiebeln, rot, geschält, 5 KG', kategorie: 'Gemüse', einheit: 'kg', preisProEinheit: 1.99, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '15033079', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'og-tomaten-cherry', name: 'O+G Cherrystrauchtomaten Premium, 1 KG', kategorie: 'Gemüse', einheit: 'kg', preisProEinheit: 8.68, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '14760037', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'og-petersilie', name: 'O+G Kräuter, Petersilie kraus, 250g Bund', kategorie: 'Kräuter', einheit: 'Bund', preisProEinheit: 1.65, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '14761003', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'og-schnittlauch', name: 'O+G Kräuter, Schnittlauch, 100g Bund', kategorie: 'Kräuter', einheit: 'Bund', preisProEinheit: 1.82, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '14761249', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'ifri-rucola', name: 'IFRI 5 Rucola, gewaschen, 500g', kategorie: 'Salat', einheit: 'Beutel', preisProEinheit: 5.85, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '18399714', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'grana-padano', name: 'Grana Padano gehobelt, 0,5 KG', kategorie: 'Milchprodukte', einheit: 'kg', preisProEinheit: 18.78, allergene: ['Eier und -erzeugnisse', 'Milch und -erzeugnisse'], lieferant: 'CHEFS CULINAR (Hersteller: MARR S.P.A.)', artikelnummer: '18858570', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'base-culinar-schmand', name: 'Base Culinar Schmand 24%, 5 KG Eimer', kategorie: 'Milchprodukte', einheit: 'kg', preisProEinheit: 4.2, allergene: ['Laktose', 'Milch und -erzeugnisse'], lieferant: 'CHEFS CULINAR', artikelnummer: '60096181', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'mascarpone', name: 'Mascarpone mind. 81%, 2 KG Eimer', kategorie: 'Milchprodukte', einheit: 'kg', preisProEinheit: 9.3, allergene: null, lieferant: 'CHEFS CULINAR (Casarelli)', artikelnummer: '14607103', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'greco-feta', name: 'Greco Feta, Schaf-/Ziegenmilch, 48% Fett i.Tr.', kategorie: 'Milchprodukte', einheit: 'kg', preisProEinheit: 14.44, allergene: null, lieferant: 'CHEFS CULINAR (Greco)', artikelnummer: '10315200', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'tk-frutti-di-mare', name: 'TK Frutti di Mare, Meeresfrüchtemischung, blanchiert', kategorie: 'Fisch', einheit: 'kg', preisProEinheit: 9.98, allergene: ['Weichtiere und -erzeugnisse', 'Krebstiere und -erzeugnisse'], lieferant: 'CHEFS CULINAR', artikelnummer: '60037861', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'black-tiger-garnelen', name: 'TK Star Culinar Black Tiger Garnelen, ohne Schale', kategorie: 'Fisch', einheit: 'kg', preisProEinheit: 16.19, allergene: null, lieferant: 'CHEFS CULINAR (Star Culinar)', artikelnummer: '14397820', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'tk-pfifferlinge', name: 'TK Base Culinar Pfifferlinge, blanchiert', kategorie: 'Gemüse', einheit: 'kg', preisProEinheit: 15.02, allergene: null, lieferant: 'CHEFS CULINAR', artikelnummer: '14384080', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
  { id: 'base-culinar-wuerfelspeck', name: 'Base Culinar Würfelspeck, gepökelt, 8x8mm', kategorie: 'Fleisch', einheit: 'kg', preisProEinheit: 5.5, allergene: [], allergeneHinweis: 'Kann Spuren von Senf, Sellerie enthalten', lieferant: 'CHEFS CULINAR', artikelnummer: '60169275', quelle: 'Einkaufsliste 12 Monate' },
  { id: 'valenzi-preiselbeeren', name: 'Valenzi Kulturpreiselbeeren, 2 KG Eimer', kategorie: 'Sonstiges', einheit: 'kg', preisProEinheit: 7.75, allergene: null, lieferant: 'CHEFS CULINAR (Valenzi)', artikelnummer: '14002328', quelle: 'Einkaufsliste 12 Monate (Preis geprüft, Allergene noch offen)' },
];

// Startbestückung für den neuen, echten Artikelstamm (/api/articles): aus den
// obigen CHEFS-CULINAR-Komponenten abgeleitet (ein Lieferant "CHEFS CULINAR"
// wird beim ersten Serverstart automatisch angelegt, siehe insertDefaultSupplierIfMissing).
function buildDefaultArticlesFromComponents() {
  return DEFAULT_COMPONENTS.map((c) => ({
    id: c.id,
    betrieb: null, // wird beim ersten Zugriff je Betrieb dupliziert, siehe seedArticlesForBetrieb
    name: c.name,
    artikelnummer: c.artikelnummer || '',
    kategorie: c.kategorie || '',
    lieferantId: null, // wird bei der Aussaat auf den Standard-Lieferanten gesetzt
    gebindegroesse: 1,
    gebindeeinheit: c.einheit,
    einheit: c.einheit,
    einheitspreis: c.preisProEinheit,
    preisProGebinde: c.preisProEinheit,
    vorherigerPreisProGebinde: null,
    preisAenderungProzent: null,
    preisHistorie: [{ preis: c.preisProEinheit, datum: new Date().toISOString() }],
    mindestbestand: null,
    aktuellerBestand: null,
    allergene: Array.isArray(c.allergene) ? c.allergene.map(normalizeAllergen) : [],
    allergeneUnbekannt: c.allergene === null,
    notizen: c.quelle || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

// ---------- Echter Artikelstamm-Seed: komplette CHEFS-CULINAR-Einkaufsliste ----------
// Vollständiger, aus dem hochgeladenen PDF "Artikelverzeichnis - Käufe der
// letzten 12 Monate" (CHEFS CULINAR, Abrufdatum 20.09.2026) extrahierter
// Datenbestand: 846 real eingekaufte Artikel mit aktuellen Einkaufspreisen und
// auf die kanonische 14er-Allergenliste normierten Allergenangaben. Diese
// Datei ist die Startbestückung für den echten Artikelstamm (/api/articles);
// DEFAULT_COMPONENTS oben bleibt unverändert die Basis für den älteren
// Kalkulations-Baukasten (/api/components, /api/kalkulationen).
const CHEFS_CULINAR_SEED_FILE = path.join(__dirname, 'data', 'chefs-culinar-artikel.json');
let chefsCulinarSeedCache = null;
function loadChefsCulinarSeedArticles() {
  if (chefsCulinarSeedCache) return chefsCulinarSeedCache;
  try {
    const raw = fs.readFileSync(CHEFS_CULINAR_SEED_FILE, 'utf8');
    chefsCulinarSeedCache = JSON.parse(raw);
  } catch (e) {
    // Fällt zurück auf die kleine, handkuratierte Liste, falls die Datei
    // einmal fehlen sollte (z. B. in einer älteren Bereitstellung).
    chefsCulinarSeedCache = [];
  }
  return chefsCulinarSeedCache;
}

function buildDefaultArticlesFromChefsCulinar() {
  const rows = loadChefsCulinarSeedArticles();
  if (!rows.length) return buildDefaultArticlesFromComponents();
  return rows.map((c) => ({
    id: c.id,
    betrieb: null, // wird beim ersten Zugriff je Betrieb dupliziert, siehe seedArticlesForBetriebIfEmpty
    name: c.name,
    artikelnummer: c.artikelnummer || '',
    kategorie: c.kategorie || '',
    lieferantId: null, // wird bei der Aussaat auf den Standard-Lieferanten gesetzt
    gebindegroesse: c.gebindegroesse || 1,
    gebindeeinheit: c.gebindeeinheit || '',
    einheit: c.gebindeeinheit || '',
    einheitspreis: c.preisProGebinde,
    preisProGebinde: c.preisProGebinde,
    vorherigerPreisProGebinde: null,
    preisAenderungProzent: null,
    preisHistorie: c.preisProGebinde != null ? [{ preis: c.preisProGebinde, datum: new Date().toISOString() }] : [],
    mindestbestand: null,
    aktuellerBestand: null,
    allergene: Array.isArray(c.allergene) ? c.allergene.map(normalizeAllergen) : [],
    allergeneUnbekannt: !!c.allergeneUnbekannt,
    zusatzstoffe: Array.isArray(c.zusatzstoffe) ? c.zusatzstoffe : [],
    zusatzstoffeUnbekannt: !!c.zusatzstoffeUnbekannt,
    zutaten: c.zutaten || '',
    verfuegbar: c.verfuegbar !== false,
    notizen: c.notizen || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
  if (!fs.existsSync(COMPONENTS_FILE)) fs.writeFileSync(COMPONENTS_FILE, JSON.stringify(DEFAULT_COMPONENTS, null, 2), 'utf8');
  if (!fs.existsSync(KALKULATIONEN_FILE)) fs.writeFileSync(KALKULATIONEN_FILE, '[]', 'utf8');
  if (!fs.existsSync(BEREICHE_FILE)) fs.writeFileSync(BEREICHE_FILE, '[]', 'utf8');
  if (!fs.existsSync(ZEITERFASSUNG_FILE)) fs.writeFileSync(ZEITERFASSUNG_FILE, '[]', 'utf8');
  if (!fs.existsSync(ARTICLES_FILE)) fs.writeFileSync(ARTICLES_FILE, '[]', 'utf8');
  if (!fs.existsSync(KALKULATION_POSITIONEN_FILE)) fs.writeFileSync(KALKULATION_POSITIONEN_FILE, '[]', 'utf8');
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SUPPLIERS_FILE)) fs.writeFileSync(SUPPLIERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SUPPLIER_PRICES_FILE)) fs.writeFileSync(SUPPLIER_PRICES_FILE, '[]', 'utf8');
  if (!fs.existsSync(AUFGABEN_FILE)) fs.writeFileSync(AUFGABEN_FILE, '[]', 'utf8');
  if (!fs.existsSync(GERICHTE_FILE)) fs.writeFileSync(GERICHTE_FILE, '[]', 'utf8');
  if (!fs.existsSync(HACCP_EQUIPMENT_FILE)) fs.writeFileSync(HACCP_EQUIPMENT_FILE, '[]', 'utf8');
  if (!fs.existsSync(HACCP_CONCEPT_FILE)) fs.writeFileSync(HACCP_CONCEPT_FILE, '[]', 'utf8');
  if (!fs.existsSync(REINIGUNG_EINTRAEGE_FILE)) fs.writeFileSync(REINIGUNG_EINTRAEGE_FILE, '[]', 'utf8');
  if (!fs.existsSync(DOCUMENTS_FILE)) fs.writeFileSync(DOCUMENTS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SUPPORT_FILE)) fs.writeFileSync(SUPPORT_FILE, '[]', 'utf8');
  if (!fs.existsSync(MITARBEITER_FILE)) fs.writeFileSync(MITARBEITER_FILE, '[]', 'utf8');
  if (!fs.existsSync(SCHICHTEN_FILE)) fs.writeFileSync(SCHICHTEN_FILE, '[]', 'utf8');
}

// Ein simpler In-Process-"Write-Lock": verhindert, dass zwei fast gleichzeitige
// Requests sich beim Schreiben der JSON-Datei gegenseitig überschreiben.
let writeQueue = Promise.resolve();
function serialize(fn) {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

function readJSON(file) {
  ensureDataFiles();
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw || 'null');
  } catch (e) {
    throw new Error(`Datendatei ${file} ist beschädigt: ${e.message}`);
  }
}

function writeJSON(file, data) {
  return serialize(() => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  });
}

// ---------- users ----------
function getUsers() {
  return readJSON(USERS_FILE) || [];
}

function saveUsers(users) {
  return writeJSON(USERS_FILE, users);
}

function findUserByEmail(email) {
  const users = getUsers();
  const normalized = String(email || '').trim().toLowerCase();
  return users.find((u) => u.email === normalized) || null;
}

function findUserById(id) {
  const users = getUsers();
  return users.find((u) => u.id === id) || null;
}

function findUserByStripeCustomerId(customerId) {
  if (!customerId) return null;
  const users = getUsers();
  return users.find((u) => u.stripeCustomerId === customerId) || null;
}

async function insertUser(user) {
  const users = getUsers();
  if (users.some((u) => u.email === user.email)) {
    const err = new Error('E-Mail bereits registriert');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  users.push(user);
  await saveUsers(users);
  return user;
}

async function updateUser(id, patch) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) {
    const err = new Error('Benutzer nicht gefunden');
    err.code = 'NOT_FOUND';
    throw err;
  }
  users[idx] = { ...users[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveUsers(users);
  return users[idx];
}

// ---------- sessions ----------
function getSessions() {
  return readJSON(SESSIONS_FILE) || {};
}

async function createSession(token, userId) {
  const sessions = getSessions();
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  await writeJSON(SESSIONS_FILE, sessions);
}

function getSessionUserId(token) {
  if (!token) return null;
  const sessions = getSessions();
  const s = sessions[token];
  return s ? s.userId : null;
}

async function destroySession(token) {
  const sessions = getSessions();
  if (sessions[token]) {
    delete sessions[token];
    await writeJSON(SESSIONS_FILE, sessions);
  }
}

// ---------- Kalkulations-Baukasten: Komponenten ----------
function getComponents() {
  return readJSON(COMPONENTS_FILE) || [];
}

function findComponentById(id) {
  return getComponents().find((c) => c.id === id) || null;
}

// ---------- Kalkulations-Baukasten: gespeicherte Kalkulationen ----------
function getKalkulationen() {
  return readJSON(KALKULATIONEN_FILE) || [];
}

function saveKalkulationenList(list) {
  return writeJSON(KALKULATIONEN_FILE, list);
}

async function insertKalkulation(kalkulation) {
  const list = getKalkulationen();
  list.unshift(kalkulation);
  await saveKalkulationenList(list);
  return kalkulation;
}

async function deleteKalkulation(id, betrieb) {
  const list = getKalkulationen();
  const idx = list.findIndex((k) => k.id === id && k.betrieb === betrieb);
  if (idx === -1) {
    const err = new Error('Kalkulation nicht gefunden');
    err.code = 'NOT_FOUND';
    throw err;
  }
  list.splice(idx, 1);
  await saveKalkulationenList(list);
}

// ---------- Bereiche (Arbeitsflächen/Betriebsbereiche) ----------
function getBereiche(betrieb) {
  const alle = readJSON(BEREICHE_FILE) || [];
  return alle.filter((b) => b.betrieb === betrieb);
}

async function insertBereich(bereich) {
  const alle = readJSON(BEREICHE_FILE) || [];
  alle.unshift(bereich);
  await writeJSON(BEREICHE_FILE, alle);
  return bereich;
}

async function deleteBereich(id, betrieb) {
  const alle = readJSON(BEREICHE_FILE) || [];
  const idx = alle.findIndex((b) => b.id === id && b.betrieb === betrieb);
  if (idx === -1) {
    const err = new Error('Bereich nicht gefunden');
    err.code = 'NOT_FOUND';
    throw err;
  }
  alle.splice(idx, 1);
  await writeJSON(BEREICHE_FILE, alle);
}

function findBereichById(id, betrieb) {
  return getBereiche(betrieb).find((b) => b.id === id) || null;
}

// ---------- Zeiterfassung (Personal-Modul: Kommen/Gehen) ----------
function getZeiterfassung(betrieb) {
  const alle = readJSON(ZEITERFASSUNG_FILE) || [];
  return alle.filter((z) => z.betrieb === betrieb);
}

function findOffenenEintrag(userId) {
  const alle = readJSON(ZEITERFASSUNG_FILE) || [];
  return alle.find((z) => z.userId === userId && !z.ende) || null;
}

async function starteZeiterfassung(eintrag) {
  const alle = readJSON(ZEITERFASSUNG_FILE) || [];
  if (alle.some((z) => z.userId === eintrag.userId && !z.ende)) {
    const err = new Error('Es läuft bereits eine Zeiterfassung für diesen Benutzer.');
    err.code = 'ALREADY_RUNNING';
    throw err;
  }
  alle.unshift(eintrag);
  await writeJSON(ZEITERFASSUNG_FILE, alle);
  return eintrag;
}

async function stoppeZeiterfassung(userId, ende) {
  const alle = readJSON(ZEITERFASSUNG_FILE) || [];
  const idx = alle.findIndex((z) => z.userId === userId && !z.ende);
  if (idx === -1) {
    const err = new Error('Keine laufende Zeiterfassung gefunden.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  alle[idx].ende = ende;
  alle[idx].dauerMinuten = Math.round((new Date(ende) - new Date(alle[idx].beginn)) / 60000);
  await writeJSON(ZEITERFASSUNG_FILE, alle);
  return alle[idx];
}

// ---------- generischer, je Betrieb gefilterter Listen-Speicher ----------
// Für die neuen App-Shell-Module (Artikelstamm, Kalkulation, Anfragen, ...):
// alle folgen demselben Muster (Liste je Betrieb, per id gesucht/gelöscht).
function makeBetriebStore(file) {
  function all() {
    return readJSON(file) || [];
  }
  function list(betrieb) {
    return all().filter((x) => x.betrieb === betrieb);
  }
  function findById(id, betrieb) {
    return list(betrieb).find((x) => x.id === id) || null;
  }
  async function insert(item) {
    const items = all();
    items.unshift(item);
    await writeJSON(file, items);
    return item;
  }
  async function update(id, betrieb, patch) {
    const items = all();
    const idx = items.findIndex((x) => x.id === id && x.betrieb === betrieb);
    if (idx === -1) {
      const err = new Error('Eintrag nicht gefunden');
      err.code = 'NOT_FOUND';
      throw err;
    }
    items[idx] = { ...items[idx], ...patch, id: items[idx].id, betrieb: items[idx].betrieb, updatedAt: new Date().toISOString() };
    await writeJSON(file, items);
    return items[idx];
  }
  async function remove(id, betrieb) {
    const items = all();
    const idx = items.findIndex((x) => x.id === id && x.betrieb === betrieb);
    if (idx === -1) {
      const err = new Error('Eintrag nicht gefunden');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const [removed] = items.splice(idx, 1);
    await writeJSON(file, items);
    return removed;
  }
  return { all, list, findById, insert, update, remove };
}

const articlesStore = makeBetriebStore(ARTICLES_FILE);
const kalkulationPositionenStore = makeBetriebStore(KALKULATION_POSITIONEN_FILE);
const leadsStore = makeBetriebStore(LEADS_FILE);
const suppliersStore = makeBetriebStore(SUPPLIERS_FILE);
const supplierPricesStore = makeBetriebStore(SUPPLIER_PRICES_FILE);
const aufgabenStore = makeBetriebStore(AUFGABEN_FILE);
const gerichteStore = makeBetriebStore(GERICHTE_FILE);
const haccpEquipmentStore = makeBetriebStore(HACCP_EQUIPMENT_FILE);
const haccpConceptStore = makeBetriebStore(HACCP_CONCEPT_FILE);
const reinigungEintraegeStore = makeBetriebStore(REINIGUNG_EINTRAEGE_FILE);
const documentsStore = makeBetriebStore(DOCUMENTS_FILE);
const supportStore = makeBetriebStore(SUPPORT_FILE);
const mitarbeiterStore = makeBetriebStore(MITARBEITER_FILE);
const schichtenStore = makeBetriebStore(SCHICHTEN_FILE);

// Beim allerersten Zugriff eines Betriebs auf den Artikelstamm: die
// vollständige, echte CHEFS-CULINAR-Einkaufsliste (846 Artikel, siehe
// buildDefaultArticlesFromChefsCulinar) als Startbestückung übernehmen (nur,
// wenn der Betrieb noch gar keine Artikel hat) — inklusive eines
// Standard-Lieferanten "CHEFS CULINAR".
async function seedArticlesForBetriebIfEmpty(betrieb) {
  if (articlesStore.list(betrieb).length) return;
  let supplier = suppliersStore.list(betrieb).find((s) => s.name === 'CHEFS CULINAR');
  if (!supplier) {
    supplier = {
      id: 'seed-chefs-culinar',
      betrieb,
      name: 'CHEFS CULINAR',
      ansprechpartner: '',
      bestelltage: '',
      mindestbestellwert: null,
      lieferkosten: null,
      zahlungsbedingungen: '',
      telefon: '',
      email: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await suppliersStore.insert(supplier);
  }
  const seedArticles = buildDefaultArticlesFromChefsCulinar().map((a) => ({
    ...a,
    betrieb,
    lieferantId: supplier.id,
  }));
  for (const article of seedArticles) {
    await articlesStore.insert(article);
  }
}

// ---------- HACCP: eingebaute Baustein-Bibliothek + Ausrüstungstypen (statisch) ----------
const HACCP_EQUIPMENT_TYPES = [
  { id: 'kuehlhaus', label: 'Kühlhaus' },
  { id: 'kuehlaggregat', label: 'Kühlaggregat / Kühltresen' },
  { id: 'tiefkuehlung', label: 'Tiefkühlung' },
  { id: 'oberflaeche', label: 'Arbeitsfläche / Oberfläche' },
  { id: 'geraet', label: 'Gerät' },
  { id: 'sonstiges', label: 'Sonstiges' },
];

const HACCP_LIBRARY = [
  { id: 'tmpl-kuehlhaus', name: 'Temperaturkontrolle Kühlhaus', kategorie: 'Wareneingang & Lager', intervall: 'täglich', sollwertMin: 0, sollwertMax: 7, einheit: '°C', beschreibung: 'Kerntemperatur beim morgendlichen Check dokumentieren.' },
  { id: 'tmpl-tiefkuehlung', name: 'Temperaturkontrolle Tiefkühlung', kategorie: 'Wareneingang & Lager', intervall: 'täglich', sollwertMin: -22, sollwertMax: -18, einheit: '°C', beschreibung: 'Tiefkühlzellen/-truhen prüfen und dokumentieren.' },
  { id: 'tmpl-wareneingang', name: 'Wareneingangskontrolle', kategorie: 'Wareneingang & Lager', intervall: 'bei jeder Lieferung', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Temperatur, Verpackung, Mindesthaltbarkeit und Menge je Lieferung prüfen.' },
  { id: 'tmpl-fritteuse', name: 'Fritteusenöl-Kontrolle', kategorie: 'Küche', intervall: 'täglich', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Polare Anteile/Optik prüfen, Ölwechsel dokumentieren.' },
  { id: 'tmpl-spuelmaschine', name: 'Spülmaschinen-Temperatur', kategorie: 'Küche', intervall: 'täglich', sollwertMin: 60, sollwertMax: 85, einheit: '°C', beschreibung: 'Klarspül- und Reinigungstemperatur dokumentieren.' },
  { id: 'tmpl-personalhygiene', name: 'Personalhygiene-Kontrolle', kategorie: 'Personal', intervall: 'wöchentlich', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Arbeitskleidung, Handhygiene, Gesundheitsbelehrung nach §43 IfSG.' },
  { id: 'tmpl-schaedlinge', name: 'Schädlingsmonitoring', kategorie: 'Betrieb', intervall: 'monatlich', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Köderstationen/Fallen kontrollieren, Auffälligkeiten dokumentieren.' },
  { id: 'tmpl-reinigungsnachweis', name: 'Reinigung & Desinfektion Küche', kategorie: 'Küche', intervall: 'täglich', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Abschluss der täglichen Grundreinigung gegenzeichnen.' },
  { id: 'tmpl-warmhaltung', name: 'Warmhaltekontrolle Speisen', kategorie: 'Küche', intervall: 'täglich', sollwertMin: 65, sollwertMax: null, einheit: '°C', beschreibung: 'Kerntemperatur warmgehaltener Speisen vor Ausgabe prüfen.' },
  { id: 'tmpl-kuehltresen-theke', name: 'Kühltresen Theke/Bar', kategorie: 'Bar', intervall: 'täglich', sollwertMin: 0, sollwertMax: 7, einheit: '°C', beschreibung: 'Kühltresen und Kühlvitrinen im Servicebereich prüfen.' },
  { id: 'tmpl-eiswuerfel', name: 'Eiswürfelmaschine', kategorie: 'Bar', intervall: 'wöchentlich', sollwertMin: null, sollwertMax: null, einheit: '', beschreibung: 'Hygienezustand und Reinigung der Eiswürfelmaschine prüfen.' },
];

module.exports = {
  ALLERGENE_14,
  normalizeAllergen,
  HACCP_EQUIPMENT_TYPES,
  HACCP_LIBRARY,
  getUsers,
  findUserByEmail,
  findUserById,
  findUserByStripeCustomerId,
  insertUser,
  updateUser,
  createSession,
  getSessionUserId,
  destroySession,
  getComponents,
  findComponentById,
  getKalkulationen,
  insertKalkulation,
  deleteKalkulation,
  getBereiche,
  insertBereich,
  deleteBereich,
  findBereichById,
  getZeiterfassung,
  findOffenenEintrag,
  starteZeiterfassung,
  stoppeZeiterfassung,
  articlesStore,
  kalkulationPositionenStore,
  leadsStore,
  suppliersStore,
  supplierPricesStore,
  aufgabenStore,
  gerichteStore,
  haccpEquipmentStore,
  haccpConceptStore,
  reinigungEintraegeStore,
  documentsStore,
  supportStore,
  mitarbeiterStore,
  schichtenStore,
  seedArticlesForBetriebIfEmpty,
};


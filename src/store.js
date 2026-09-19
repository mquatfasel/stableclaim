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

// Komponenten für den Kalkulations-Baukasten (Gerichte & Buffet) — Artikelstamm-Kern.
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

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
  if (!fs.existsSync(COMPONENTS_FILE)) fs.writeFileSync(COMPONENTS_FILE, JSON.stringify(DEFAULT_COMPONENTS, null, 2), 'utf8');
  if (!fs.existsSync(KALKULATIONEN_FILE)) fs.writeFileSync(KALKULATIONEN_FILE, '[]', 'utf8');
  if (!fs.existsSync(BEREICHE_FILE)) fs.writeFileSync(BEREICHE_FILE, '[]', 'utf8');
  if (!fs.existsSync(ZEITERFASSUNG_FILE)) fs.writeFileSync(ZEITERFASSUNG_FILE, '[]', 'utf8');
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
// Der Nutzer baut seinen Betrieb Stück für Stück auf, indem er eigene Bereiche
// anlegt (z. B. "Küche", "Kühlhaus", "Bar", "Spülbereich"). Für jeden Bereich
// lassen sich HACCP- und Reinigungsplan-Vorlagen als PDF-taugliche, druckbare
// Seiten herunterladen (siehe /api/vorlagen/* in server.js).
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

module.exports = {
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
};

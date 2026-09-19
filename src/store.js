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

// Beispiel-Komponenten für den Kalkulations-Baukasten (Gerichte & Buffet).
// Das sind bewusst Platzhalterdaten, bis der echte Artikelstamm (siehe README,
// Abschnitt "Nächste Schritte") angebunden ist — Struktur ist aber identisch
// zu einem künftigen Artikelstamm-Eintrag (Name, Kategorie, Einheit, Preis).
const DEFAULT_COMPONENTS = [
  { id: 'rinderfilet', name: 'Rinderfilet', kategorie: 'Fleisch', einheit: 'kg', preisProEinheit: 32.0 },
  { id: 'haehnchenbrust', name: 'Hähnchenbrust', kategorie: 'Fleisch', einheit: 'kg', preisProEinheit: 8.4 },
  { id: 'schweinenacken', name: 'Schweinenacken', kategorie: 'Fleisch', einheit: 'kg', preisProEinheit: 7.9 },
  { id: 'lachsfilet', name: 'Lachsfilet', kategorie: 'Fisch', einheit: 'kg', preisProEinheit: 15.72 },
  { id: 'garnelen', name: 'Garnelen', kategorie: 'Fisch', einheit: 'kg', preisProEinheit: 19.5 },
  { id: 'kartoffeln', name: 'Kartoffeln', kategorie: 'Beilage', einheit: 'kg', preisProEinheit: 1.1 },
  { id: 'kartoffelgratin', name: 'Kartoffelgratin (Unterrezeptur)', kategorie: 'Beilage', einheit: 'kg', preisProEinheit: 3.4 },
  { id: 'rotkohl', name: 'Rotkohl', kategorie: 'Beilage', einheit: 'kg', preisProEinheit: 2.6 },
  { id: 'caesar-dressing', name: 'Caesar Dressing', kategorie: 'Sauce', einheit: 'l', preisProEinheit: 5.4 },
  { id: 'pfeffersauce', name: 'Pfeffersauce (Unterrezeptur)', kategorie: 'Sauce', einheit: 'l', preisProEinheit: 6.8 },
  { id: 'bbq-sauce', name: 'BBQ-Sauce', kategorie: 'Sauce', einheit: 'l', preisProEinheit: 4.9 },
  { id: 'gemischter-salat', name: 'Gemischter Salat', kategorie: 'Salat', einheit: 'kg', preisProEinheit: 3.2 },
  { id: 'brot', name: 'Brotauswahl', kategorie: 'Brot', einheit: 'kg', preisProEinheit: 2.4 },
  { id: 'dessertglas', name: 'Dessertglas (Stück)', kategorie: 'Dessert', einheit: 'Stück', preisProEinheit: 1.9 },
  { id: 'olivenoel', name: 'Olivenöl', kategorie: 'Sonstiges', einheit: 'l', preisProEinheit: 9.8 },
  { id: 'butter', name: 'Butter', kategorie: 'Sonstiges', einheit: 'kg', preisProEinheit: 6.1 },
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
  if (!fs.existsSync(COMPONENTS_FILE)) fs.writeFileSync(COMPONENTS_FILE, JSON.stringify(DEFAULT_COMPONENTS, null, 2), 'utf8');
  if (!fs.existsSync(KALKULATIONEN_FILE)) fs.writeFileSync(KALKULATIONEN_FILE, '[]', 'utf8');
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
};

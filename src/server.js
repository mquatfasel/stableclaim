// src/server.js
// StableClaim – Login, Benutzerverwaltung, App-Shell, Abo-Modelle & Stripe-Abrechnung.
// Reines Node.js (http, crypto, fs, https) – keine externen Pakete, kein npm install nötig.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const auth = require('./auth');
const billing = require('./billing');
const vorlagen = require('./vorlagen');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB Schutz gegen zu große Requests
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024; // Stripe-Events sind i.d.R. wenige KB

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const ROLLEN = [
  'Geschäftsleitung',
  'Küchenchef / Souschef',
  'Serviceleitung',
  'Einkauf',
  'HACCP-Verantwortlicher',
  'Administrator',
  'Mitarbeiter Küche / Service',
];
const PLAENE = ['basic', 'professional', 'enterprise'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- API-Handler ----------

async function handleRegister(req, res) {
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const name = String(body.name || '').trim();
  const betrieb = String(body.betrieb || '').trim();
  const rolle = String(body.rolle || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!name || !betrieb || !rolle || !email || !password) {
    return sendJSON(res, 400, { error: 'Bitte alle Felder ausfüllen.' });
  }
  if (!isValidEmail(email)) {
    return sendJSON(res, 400, { error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  }
  if (password.length < 8) {
    return sendJSON(res, 400, { error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
  }
  if (!ROLLEN.includes(rolle)) {
    return sendJSON(res, 400, { error: 'Ungültige Rolle.' });
  }

  const { salt, hash } = auth.hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name,
    betrieb,
    rolle,
    email,
    passwordSalt: salt,
    passwordHash: hash,
    plan: null,
    planRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await store.insertUser(user);
  } catch (e) {
    if (e.code === 'EMAIL_TAKEN') {
      return sendJSON(res, 409, { error: 'Für diese E-Mail existiert bereits ein Konto.' });
    }
    return sendJSON(res, 500, { error: 'Konto konnte nicht angelegt werden.' });
  }

  await auth.startSession(res, user.id);
  return sendJSON(res, 201, { user: auth.publicUser(user) });
}

async function handleLogin(req, res) {
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return sendJSON(res, 400, { error: 'Bitte E-Mail und Passwort angeben.' });
  }

  const user = store.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    // Bewusst dieselbe Fehlermeldung für "unbekannt" und "falsches Passwort",
    // damit sich nicht erraten lässt, welche E-Mails registriert sind.
    return sendJSON(res, 401, { error: 'E-Mail oder Passwort ist falsch.' });
  }

  await auth.startSession(res, user.id);
  return sendJSON(res, 200, { user: auth.publicUser(user) });
}

async function handleLogout(req, res) {
  const { token } = auth.currentUser(req);
  if (token) await store.destroySession(token);
  auth.clearSessionCookie(res);
  return sendJSON(res, 200, { ok: true });
}

function handleMe(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  return sendJSON(res, 200, { user: auth.publicUser(user) });
}

async function handlePlan(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const plan = String(body.plan || '');
  if (!PLAENE.includes(plan)) {
    return sendJSON(res, 400, { error: 'Ungültiger Plan.' });
  }
  const planRequested = plan === 'enterprise' && body.requestSales !== false;

  const updated = await store.updateUser(user.id, { plan, planRequested });
  return sendJSON(res, 200, { user: auth.publicUser(updated) });
}

// ---------- Stripe-Abrechnung ----------

async function handleBillingCheckout(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const plan = String(body.plan || '');
  if (!['basic', 'professional'].includes(plan)) {
    return sendJSON(res, 400, { error: 'Für diesen Plan gibt es keine Online-Zahlung. Bitte den Vertrieb kontaktieren.' });
  }

  try {
    const session = await billing.createCheckoutSession({ plan, user, baseUrl: baseUrl(req) });
    return sendJSON(res, 200, { url: session.url });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message });
  }
}

async function handleBillingPortal(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  if (!user.stripeCustomerId) {
    return sendJSON(res, 400, { error: 'Noch kein Stripe-Kunde vorhanden. Bitte zuerst ein kostenpflichtiges Abo abschließen.' });
  }
  try {
    const session = await billing.createPortalSession({ customerId: user.stripeCustomerId, baseUrl: baseUrl(req) });
    return sendJSON(res, 200, { url: session.url });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message });
  }
}

async function handleStripeWebhook(req, res) {
  let rawBody;
  try {
    rawBody = await readRawBody(req, MAX_WEBHOOK_BYTES);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  try {
    billing.verifyWebhookSignature(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return sendJSON(res, 400, { error: 'Ungültiges Event-JSON.' });
  }

  try {
    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && obj) {
      const userId = obj.client_reference_id || (obj.metadata && obj.metadata.stableclaim_user_id);
      const plan = obj.metadata && obj.metadata.plan;
      if (userId) {
        await store.updateUser(userId, {
          plan: plan || undefined,
          planRequested: false,
          stripeCustomerId: obj.customer || undefined,
          stripeSubscriptionId: obj.subscription || undefined,
          subscriptionStatus: 'active',
        });
      }
    } else if (event.type === 'customer.subscription.updated' && obj) {
      const existing = store.findUserByStripeCustomerId(obj.customer);
      if (existing) {
        await store.updateUser(existing.id, { subscriptionStatus: obj.status });
      }
    } else if (event.type === 'customer.subscription.deleted' && obj) {
      const existing = store.findUserByStripeCustomerId(obj.customer);
      if (existing) {
        await store.updateUser(existing.id, { plan: null, subscriptionStatus: 'canceled' });
      }
    }
  } catch (e) {
    console.error('Stripe-Webhook-Verarbeitung fehlgeschlagen:', e);
    // Trotzdem 200 zurückgeben, damit Stripe nicht endlos wiederholt; Fehler ist geloggt.
  }

  return sendJSON(res, 200, { received: true });
}

// ---------- Kalender ----------

function handleCalendarConfig(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  // Kein OAuth, keine Zugangsdaten: der Betreiber kann optional einen
  // öffentlichen Google-Kalender-Embed-Link hinterlegen (Google Kalender →
  // Einstellungen → „Kalender in Website einbetten" → iframe-src kopieren).
  return sendJSON(res, 200, { embedUrl: process.env.GOOGLE_CALENDAR_EMBED_URL || null });
}

// ---------- Kalkulations-Baukasten ----------

function calculateKalkulation({ portionen, zielWareneinsatzquote, komponenten }) {
  let wareneinsatzProPortion = 0;
  const zeilen = komponenten.map((k) => {
    const komponente = store.findComponentById(k.komponenteId);
    if (!komponente) {
      throw Object.assign(new Error(`Unbekannte Komponente: ${k.komponenteId}`), { status: 400 });
    }
    const mengeProPortion = Number(k.mengeProPortion) || 0;
    const mengeGesamt = mengeProPortion * portionen;
    const preisProPortion = mengeProPortion * komponente.preisProEinheit;
    const preisGesamt = mengeGesamt * komponente.preisProEinheit;
    wareneinsatzProPortion += preisProPortion;
    return {
      komponenteId: komponente.id,
      name: komponente.name,
      kategorie: komponente.kategorie,
      einheit: komponente.einheit,
      preisProEinheit: komponente.preisProEinheit,
      mengeProPortion,
      mengeGesamt: Math.round(mengeGesamt * 1000) / 1000,
      preisGesamt: Math.round(preisGesamt * 100) / 100,
    };
  });
  const wareneinsatzGesamt = Math.round(wareneinsatzProPortion * portionen * 100) / 100;
  wareneinsatzProPortion = Math.round(wareneinsatzProPortion * 100) / 100;
  const quote = zielWareneinsatzquote > 0 && zielWareneinsatzquote < 1 ? zielWareneinsatzquote : 0.3;
  const empfohlenerVkPreisProPortion = Math.round((wareneinsatzProPortion / quote) * 100) / 100;
  const deckungsbeitragProPortion = Math.round((empfohlenerVkPreisProPortion - wareneinsatzProPortion) * 100) / 100;
  return {
    zeilen,
    wareneinsatzGesamt,
    wareneinsatzProPortion,
    zielWareneinsatzquote: quote,
    empfohlenerVkPreisProPortion,
    deckungsbeitragProPortion,
  };
}

function handleComponentsList(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  return sendJSON(res, 200, { components: store.getComponents() });
}

function handleKalkulationenList(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  const list = store.getKalkulationen().filter((k) => k.betrieb === user.betrieb);
  return sendJSON(res, 200, { kalkulationen: list });
}

async function handleKalkulationenCreate(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const typ = body.typ === 'buffet' ? 'buffet' : 'gericht';
  const name = String(body.name || '').trim();
  const portionen = Math.max(1, Math.round(Number(body.portionen) || 1));
  const komponenten = Array.isArray(body.komponenten) ? body.komponenten : [];

  if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen für die Kalkulation angeben.' });
  if (!komponenten.length) return sendJSON(res, 400, { error: 'Bitte mindestens eine Komponente hinzufügen.' });

  let ergebnis;
  try {
    ergebnis = calculateKalkulation({
      portionen,
      zielWareneinsatzquote: Number(body.zielWareneinsatzquote) || 0.3,
      komponenten,
    });
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const kalkulation = {
    id: crypto.randomUUID(),
    typ,
    name,
    portionen,
    betrieb: user.betrieb,
    erstelltVon: user.id,
    erstelltAm: new Date().toISOString(),
    ...ergebnis,
  };

  await store.insertKalkulation(kalkulation);
  return sendJSON(res, 201, { kalkulation });
}

async function handleKalkulationenDelete(req, res, id) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  try {
    await store.deleteKalkulation(id, user.betrieb);
  } catch (e) {
    return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
  }
  return sendJSON(res, 200, { ok: true });
}

// ---------- Bereiche (Arbeitsflächen/Betriebsbereiche) ----------
// Damit baut der Nutzer seinen Betrieb Stück für Stück ab, indem er die
// tatsächlich vorhandenen Bereiche anlegt (Küche, Kühlhaus, Bar, ...). Für
// jeden Bereich lassen sich passende HACCP- und Reinigungsplan-Vorlagen
// herunterladen (siehe /api/vorlagen/* weiter unten).

function handleBereicheList(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  return sendJSON(res, 200, { bereiche: store.getBereiche(user.betrieb) });
}

async function handleBereicheCreate(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const name = String(body.name || '').trim();
  const typ = String(body.typ || '').trim() || 'Sonstiges';
  if (!name) return sendJSON(res, 400, { error: 'Bitte einen Namen für den Bereich angeben.' });

  const bereich = {
    id: crypto.randomUUID(),
    betrieb: user.betrieb,
    name,
    typ,
    erstelltVon: user.id,
    erstelltAm: new Date().toISOString(),
  };
  await store.insertBereich(bereich);
  return sendJSON(res, 201, { bereich });
}

async function handleBereicheDelete(req, res, id) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  try {
    await store.deleteBereich(id, user.betrieb);
  } catch (e) {
    return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
  }
  return sendJSON(res, 200, { ok: true });
}

// ---------- HACCP-/Reinigungsplan-Vorlagen (fertige, druckbare Seiten) ----------

function handleVorlage(req, res, art, bereichId) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  const bereich = store.findBereichById(bereichId, user.betrieb);
  if (!bereich) return sendJSON(res, 404, { error: 'Bereich nicht gefunden.' });

  const daten = { betrieb: user.betrieb, bereich: bereich.name };
  const html = art === 'reinigung' ? vorlagen.renderReinigungsplanVorlage(daten) : vorlagen.renderHaccpVorlage(daten);
  const dateiname = `${art === 'reinigung' ? 'reinigungsplan' : 'haccp-kontrollliste'}-${bereich.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '.html';

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `inline; filename="${dateiname}"`,
  });
  res.end(html);
}

// ---------- Personal: Zeiterfassung (Kommen/Gehen) ----------

function handleZeiterfassungList(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  const eintraege = store.getZeiterfassung(user.betrieb);
  const laufenderEintrag = store.findOffenenEintrag(user.id);
  return sendJSON(res, 200, { eintraege, laufenderEintrag });
}

async function handleZeiterfassungStart(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });

  const eintrag = {
    id: crypto.randomUUID(),
    betrieb: user.betrieb,
    userId: user.id,
    userName: user.name,
    beginn: new Date().toISOString(),
    ende: null,
    dauerMinuten: null,
  };
  try {
    await store.starteZeiterfassung(eintrag);
  } catch (e) {
    return sendJSON(res, e.code === 'ALREADY_RUNNING' ? 409 : 500, { error: e.message });
  }
  return sendJSON(res, 201, { eintrag });
}

async function handleZeiterfassungStop(req, res) {
  const { user } = auth.currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Nicht angemeldet.' });
  try {
    const eintrag = await store.stoppeZeiterfassung(user.id, new Date().toISOString());
    return sendJSON(res, 200, { eintrag });
  } catch (e) {
    return sendJSON(res, e.code === 'NOT_FOUND' ? 404 : 500, { error: e.message });
  }
}

// ---------- statische Dateien ----------

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Pfad-Traversal verhindern (z.B. "/../../etc/passwd")
  const safePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    return res.end('Ungültiger Pfad');
  }

  fs.readFile(safePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Nicht gefunden');
      }
      res.writeHead(500);
      return res.end('Serverfehler');
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- Router ----------

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  try {
    if (urlPath === '/api/auth/register' && req.method === 'POST') return void handleRegister(req, res);
    if (urlPath === '/api/auth/login' && req.method === 'POST') return void handleLogin(req, res);
    if (urlPath === '/api/auth/logout' && req.method === 'POST') return void handleLogout(req, res);
    if (urlPath === '/api/auth/me' && req.method === 'GET') return void handleMe(req, res);
    if (urlPath === '/api/plan' && req.method === 'POST') return void handlePlan(req, res);
    if (urlPath === '/api/billing/checkout' && req.method === 'POST') return void handleBillingCheckout(req, res);
    if (urlPath === '/api/billing/portal' && req.method === 'POST') return void handleBillingPortal(req, res);
    if (urlPath === '/api/billing/webhook' && req.method === 'POST') return void handleStripeWebhook(req, res);
    if (urlPath === '/api/calendar/config' && req.method === 'GET') return void handleCalendarConfig(req, res);
    if (urlPath === '/api/components' && req.method === 'GET') return void handleComponentsList(req, res);
    if (urlPath === '/api/kalkulationen' && req.method === 'GET') return void handleKalkulationenList(req, res);
    if (urlPath === '/api/kalkulationen' && req.method === 'POST') return void handleKalkulationenCreate(req, res);
    if (urlPath.startsWith('/api/kalkulationen/') && req.method === 'DELETE') {
      return void handleKalkulationenDelete(req, res, decodeURIComponent(urlPath.slice('/api/kalkulationen/'.length)));
    }
    if (urlPath === '/api/bereiche' && req.method === 'GET') return void handleBereicheList(req, res);
    if (urlPath === '/api/bereiche' && req.method === 'POST') return void handleBereicheCreate(req, res);
    if (urlPath.startsWith('/api/bereiche/') && req.method === 'DELETE') {
      return void handleBereicheDelete(req, res, decodeURIComponent(urlPath.slice('/api/bereiche/'.length)));
    }
    if (urlPath === '/api/vorlagen/haccp' && req.method === 'GET') {
      return void handleVorlage(req, res, 'haccp', new URL(req.url, 'http://x').searchParams.get('bereich'));
    }
    if (urlPath === '/api/vorlagen/reinigung' && req.method === 'GET') {
      return void handleVorlage(req, res, 'reinigung', new URL(req.url, 'http://x').searchParams.get('bereich'));
    }
    if (urlPath === '/api/zeiterfassung/eintraege' && req.method === 'GET') return void handleZeiterfassungList(req, res);
    if (urlPath === '/api/zeiterfassung/start' && req.method === 'POST') return void handleZeiterfassungStart(req, res);
    if (urlPath === '/api/zeiterfassung/stop' && req.method === 'POST') return void handleZeiterfassungStop(req, res);

    if (urlPath.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Unbekannter Endpunkt.' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);

    res.writeHead(405);
    res.end('Methode nicht erlaubt');
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: 'Unerwarteter Serverfehler.' });
  }
});

server.listen(PORT, () => {
  console.log(`StableClaim läuft auf http://localhost:${PORT}`);
});

# StableClaim — App-Shell, Login & Abo-Modelle

Eine eigenständige, lauffähige App (kein Mockup): echte Konten mit gehashten
Passwörtern, echte Sessions, eine vollständige Navigations-Shell mit allen
Modulen (Übersicht, Anfragen, Kalkulation, Rezepturen, Artikelstamm,
Allergene, HACCP, Reinigungspläne, E-Mail, Dokumente, Support) sowie eine
Stripe-Anbindung für die Abo-Pakete (Basic / Professional / Enterprise).
Läuft mit reinem Node.js — **keine externen Pakete, kein `npm install`
nötig.**

Live: **https://www.stableclaim.de**

## Schnellstart

```bash
node src/server.js
# oder: npm start
```

Dann im Browser öffnen: **http://localhost:3000**

Voraussetzung ist lediglich Node.js 18 oder neuer (`node -v` zum Prüfen).
Es gibt keine weiteren Abhängigkeiten zu installieren.

Optional: Port ändern über eine Umgebungsvariable:

```bash
PORT=8080 node src/server.js
```

## Was hier wirklich passiert

- **Registrierung** (`POST /api/auth/register`): Name, Betrieb, Rolle,
  E-Mail, Passwort. Das Passwort wird mit `crypto.scrypt` gehasht und
  gesalzen gespeichert — nie im Klartext. Bei bereits vergebener E-Mail
  kommt ein echter Fehler (409) zurück.
- **Login** (`POST /api/auth/login`): prüft die Zugangsdaten gegen den
  gespeicherten Hash und startet eine echte Session, danach Weiterleitung
  in die App-Shell (`/dashboard.html`).
- **Sessions**: Ein zufälliges Token landet als `HttpOnly`-Cookie im
  Browser und wird serverseitig in `data/sessions.json` einem Benutzer
  zugeordnet.
- **App-Shell** (`/dashboard.html`): Sidebar-Navigation mit allen Modulen
  aus der Zielarchitektur. Die Kontodaten (Name, Betrieb, Rolle) sind
  echt; die Inhalte je Modul (Rezepturen, Artikelstamm, Allergene, HACCP …)
  sind aktuell **Platzhalterdaten** zur Vorschau des Bedienkonzepts — echte
  Datenanbindung folgt Modul für Modul.
- **Support-Bereich**: eigener Menüpunkt für Mitarbeiter mit
  Wissensdatenbank (FAQ) und einem Formular für interne Anfragen an
  Admin/IT — aktuell als Oberfläche vorbereitet, ohne Versand.
- **Abo-Wahl** (`POST /api/plan`): speichert den gewählten Plan
  dauerhaft am Benutzerkonto (genutzt für Enterprise-Vertriebsanfragen).
- **Stripe-Abrechnung** (`/api/billing/*`): siehe eigener Abschnitt unten.
- **Datenhaltung**: `data/users.json` und `data/sessions.json` — einfache,
  lesbare JSON-Dateien. Bewusst einfach gehalten, siehe „Nächste Schritte"
  unten für den Weg zu einer echten Datenbank.

Alle Endpunkte:

| Methode | Pfad                     | Zweck                                          |
|---------|--------------------------|-------------------------------------------------|
| POST    | `/api/auth/register`     | Konto anlegen, Session starten                   |
| POST    | `/api/auth/login`        | Anmelden, Session starten                        |
| POST    | `/api/auth/logout`       | Session beenden                                  |
| GET     | `/api/auth/me`           | Aktuell angemeldeten Benutzer abfragen           |
| POST    | `/api/plan`              | Abo-Plan direkt setzen (u. a. Enterprise-Anfrage)|
| POST    | `/api/billing/checkout`  | Stripe-Checkout-Session für Basic/Professional   |
| POST    | `/api/billing/portal`    | Stripe-Kundenportal (Zahlungsmethode, Kündigung) |
| POST    | `/api/billing/webhook`   | Stripe-Webhook (Abo-Status synchronisieren)      |

## Stripe-Abrechnung einrichten

Die Anbindung ist vollständig im Code vorbereitet (`src/billing.js`), aber
**bewusst nicht mit echten Zugangsdaten verknüpft** — das übernimmt der
Betreiber selbst:

1. Bei [stripe.com](https://stripe.com) einloggen bzw. registrieren.
2. Zwei Produkte mit **wiederkehrendem Preis** anlegen: „Basic" und
   „Professional" (Enterprise läuft weiterhin über die Vertriebsanfrage,
   kein Self-Service-Checkout).
3. Im Dashboard unter **Developers → API keys** den Secret Key kopieren.
4. Unter **Developers → Webhooks** einen Endpoint auf
   `https://www.stableclaim.de/api/billing/webhook` anlegen, Events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted` abonnieren, Signing Secret kopieren.
5. Folgende Umgebungsvariablen bei Render eintragen (Settings →
   Environment):

   | Variable                     | Wert                                    |
   |-------------------------------|------------------------------------------|
   | `STRIPE_SECRET_KEY`           | `sk_live_…` bzw. `sk_test_…`              |
   | `STRIPE_WEBHOOK_SECRET`       | `whsec_…`                                 |
   | `STRIPE_PRICE_BASIC`          | `price_…` (Preis-ID des Basic-Produkts)   |
   | `STRIPE_PRICE_PROFESSIONAL`   | `price_…` (Preis-ID des Professional-Produkts) |
   | `PUBLIC_BASE_URL`             | `https://www.stableclaim.de`               |

Ohne diese Variablen antworten die Billing-Endpunkte mit einer klaren
Fehlermeldung („Stripe ist noch nicht konfiguriert …", Status 501) statt
die App zum Absturz zu bringen — die restliche App bleibt voll nutzbar.

Aus Sicherheitsgründen trägt diese Automatisierung selbst niemals
Passwörter oder API-Schlüssel in Formulare ein — das erledigt der
Betreiber im Stripe- bzw. Render-Dashboard.

## Projektstruktur

```
stableclaim/
├── src/
│   ├── server.js   # HTTP-Server, Routing, statische Auslieferung
│   ├── auth.js     # Passwort-Hashing, Sessions, Cookies
│   ├── store.js    # Dateibasierte Datenhaltung (JSON)
│   └── billing.js  # Stripe-Anbindung (Checkout, Portal, Webhook)
├── public/
│   ├── index.html      # Login/Registrierung + Preisseite
│   ├── app.js           # Frontend der Login-Seite
│   ├── style.css
│   ├── dashboard.html   # App-Shell (nach dem Login)
│   ├── dashboard.js      # Sidebar-Navigation, Seiten-Renderer, Routing
│   └── dashboard.css
└── data/           # wird beim ersten Start automatisch angelegt
    ├── users.json
    └── sessions.json
```

## Warum kein Express, kein bcrypt, kein npm install?

In der Entwicklungsumgebung, in der diese App entstanden ist, war der
Zugriff auf die npm-Registry gesperrt. Damit die App garantiert läuft —
unabhängig von Firewall, internem Netzwerk oder Offline-Rechnern im
Betrieb — verwendet sie ausschließlich in Node.js eingebaute Module
(`http`, `https`, `crypto`, `fs`). Das ist production-tauglich für den
Start, langfristig aber nicht zwingend das Ziel.

## Nächste Schritte

1. **Echte Datenanbindung je Modul**: Die Design-Shell zeigt Struktur und
   Layout; Rezepturen, Artikelstamm, Allergene, HACCP usw. sind aktuell
   Platzhalterdaten. Als Nächstes je Modul mit echten Daten/Formularen
   verbinden (Artikelstamm zuerst, da alle anderen Module darauf
   aufbauen).
2. **Echte Datenbank statt JSON-Dateien**, sobald mehrere Standorte oder
   viele gleichzeitige Nutzer dazukommen (z. B. Postgres).
3. **Stripe live schalten**: siehe Abschnitt oben — sobald die
   Umgebungsvariablen gesetzt sind, funktioniert der Checkout ohne
   Codeänderung.
4. **Rollenrechte durchsetzen**: Die Rolle wird gespeichert, aber noch
   nicht serverseitig genutzt, um Zugriff auf bestimmte Module
   einzuschränken (z. B. Finanzkennzahlen nur für Geschäftsleitung).
5. **Multi-Tenant-Trennung**: Aktuell teilen sich alle Konten eine
   Betriebs-Instanz. Für mehrere Betriebe (SaaS) braucht jede
   Datenbank-Tabelle eine `tenant_id` bzw. eine strikte Trennung pro
   Betrieb.
6. **Deployment**: läuft bereits produktiv auf Render, DNS bei Strato
   (`stableclaim.de`, CNAME `www` → Render, Domain-Redirect der nackten
   Domain auf `www.stableclaim.de`). Für Produktivbetrieb das Cookie in
   `src/auth.js` (`setSessionCookie`) um `Secure` ergänzen, sobald die App
   über HTTPS läuft (ist bei Render standardmäßig der Fall).
7. Ab hier weiter entlang der Roadmap: Bankett, Einkauf, Lager, Menu
   Engineering, Management-Controlling als weitere Module auf derselben
   Datenbasis aufbauen.

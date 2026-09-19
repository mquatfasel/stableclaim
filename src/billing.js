// src/billing.js
// Stripe-Anbindung ohne externes Paket – reine HTTPS-Aufrufe gegen die
// Stripe-REST-API (https://api.stripe.com) plus manuelle Webhook-Signaturprüfung.
//
// Benötigte Umgebungsvariablen (vom Betreiber selbst bei Render einzutragen,
// niemals von dieser App automatisiert):
//   STRIPE_SECRET_KEY            sk_live_… oder sk_test_…
//   STRIPE_WEBHOOK_SECRET        whsec_… (aus dem Webhook-Endpoint im Stripe-Dashboard)
//   STRIPE_PRICE_BASIC           price_… (wiederkehrender Preis für den Basic-Plan)
//   STRIPE_PRICE_PROFESSIONAL    price_… (wiederkehrender Preis für den Professional-Plan)
//   PUBLIC_BASE_URL              z.B. https://www.stableclaim.de (für Redirect-URLs)
//
// Ist STRIPE_SECRET_KEY nicht gesetzt, liefern die Funktionen einen klaren
// Fehler (Status 501) statt die App zum Absturz zu bringen.

const https = require('https');

function configured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function priceIdForPlan(plan) {
  const map = {
    basic: process.env.STRIPE_PRICE_BASIC,
    professional: process.env.STRIPE_PRICE_PROFESSIONAL,
  };
  return map[plan] || null;
}

function stripeRequest(method, path, params) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return reject(Object.assign(new Error('Stripe ist noch nicht konfiguriert (STRIPE_SECRET_KEY fehlt).'), { status: 501 }));
    }
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data || '{}');
          } catch (e) {
            return reject(Object.assign(new Error('Ungültige Antwort von Stripe.'), { status: 502 }));
          }
          if (res.statusCode >= 400) {
            const msg = (json.error && json.error.message) || 'Stripe-Fehler.';
            return reject(Object.assign(new Error(msg), { status: res.statusCode }));
          }
          resolve(json);
        });
      }
    );
    req.on('error', (e) => reject(Object.assign(new Error(`Stripe nicht erreichbar: ${e.message}`), { status: 502 })));
    req.write(body);
    req.end();
  });
}

async function createCheckoutSession({ plan, user, baseUrl }) {
  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    throw Object.assign(new Error(`Für den Plan "${plan}" ist noch kein Stripe-Preis hinterlegt.`), { status: 400 });
  }
  const params = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${baseUrl}/dashboard.html?checkout=success#konto`,
    cancel_url: `${baseUrl}/dashboard.html?checkout=cancel#konto`,
    client_reference_id: user.id,
    customer_email: user.email,
    'subscription_data[metadata][stableclaim_user_id]': user.id,
    'metadata[stableclaim_user_id]': user.id,
    'metadata[plan]': plan,
    allow_promotion_codes: 'true',
  };
  if (user.stripeCustomerId) {
    params.customer = user.stripeCustomerId;
    delete params.customer_email;
  }
  return stripeRequest('POST', '/v1/checkout/sessions', params);
}

async function createPortalSession({ customerId, baseUrl }) {
  return stripeRequest('POST', '/v1/billing_portal/sessions', {
    customer: customerId,
    return_url: `${baseUrl}/dashboard.html#konto`,
  });
}

function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!secret) {
    throw Object.assign(new Error('Stripe-Webhook ist noch nicht konfiguriert (STRIPE_WEBHOOK_SECRET fehlt).'), { status: 501 });
  }
  if (!sigHeader) {
    throw Object.assign(new Error('Fehlende Stripe-Signatur.'), { status: 400 });
  }
  const parts = {};
  sigHeader.split(',').forEach((p) => {
    const [k, v] = p.split('=');
    if (k && v) parts[k] = v;
  });
  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) {
    throw Object.assign(new Error('Ungültige Stripe-Signatur.'), { status: 400 });
  }
  const crypto = require('crypto');
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  let ok = false;
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    throw Object.assign(new Error('Stripe-Signatur ungültig.'), { status: 400 });
  }
}

module.exports = {
  configured,
  priceIdForPlan,
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
};

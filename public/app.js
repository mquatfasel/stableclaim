// public/app.js
// Echtes Frontend: spricht per fetch() gegen die eigene API (src/server.js).
// Keine Fake-Submits, keine simulierten Antworten.

let currentUser = null;

function $(id) { return document.getElementById(id); }

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* leerer Body, z.B. bei 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Serverfehler (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

// ---------- Rendering ----------
function initials(name) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/);
  return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function renderGuest() {
  $('state-account').hidden = true;
  $('state-guest').hidden = false;
}

function renderAccount() {
  $('state-guest').hidden = true;
  $('state-account').hidden = false;
  $('acc-avatar').textContent = initials(currentUser.name);
  $('acc-name').textContent = currentUser.name;
  $('acc-meta').textContent = `${currentUser.rolle} · ${currentUser.betrieb}`;
}

function setStatus(id, msg, kind) {
  const el = $(id);
  el.textContent = msg || '';
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

// ---------- Tabs ----------
function switchTab(which) {
  const isLogin = which === 'login';
  $('form-login').hidden = !isLogin;
  $('form-register').hidden = isLogin;
  $('tab-login').setAttribute('aria-selected', String(isLogin));
  $('tab-register').setAttribute('aria-selected', String(!isLogin));
}

// ---------- Auth-Aktionen ----------
async function handleLogin(evt) {
  evt.preventDefault();
  const email = $('li-email').value.trim();
  const password = $('li-pass').value;
  const btn = $('login-submit');
  btn.disabled = true;
  setStatus('status-login', 'Prüfe Zugangsdaten …');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    currentUser = data.user;
    setStatus('status-login', '');
    renderAccount();
    toast(`Willkommen zurück, ${currentUser.name.split(' ')[0]}.`);
  } catch (e) {
    setStatus('status-login', e.message, 'error');
  } finally {
    btn.disabled = false;
  }
  return false;
}

async function handleRegister(evt) {
  evt.preventDefault();
  const name = $('re-name').value.trim();
  const rolle = $('re-rolle').value;
  const betrieb = $('re-betrieb').value.trim();
  const email = $('re-email').value.trim();
  const password = $('re-pass').value;
  const password2 = $('re-pass2').value;
  const btn = $('register-submit');

  if (password !== password2) {
    setStatus('status-register', 'Die Passwörter stimmen nicht überein.', 'error');
    return false;
  }

  btn.disabled = true;
  setStatus('status-register', 'Lege Konto an …');
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: { name, rolle, betrieb, email, password },
    });
    currentUser = data.user;
    setStatus('status-register', '');
    renderAccount();
    toast(`Konto angelegt — willkommen, ${currentUser.name.split(' ')[0]}.`);
  } catch (e) {
    setStatus('status-register', e.message, 'error');
  } finally {
    btn.disabled = false;
  }
  return false;
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) { /* Cookie wird clientseitig ohnehin ungültig behandelt */ }
  currentUser = null;
  renderGuest();
  toast('Abgemeldet.');
}

// ---------- Boot ----------
async function boot() {
  $('tab-login').addEventListener('click', () => switchTab('login'));
  $('tab-register').addEventListener('click', () => switchTab('register'));
  $('form-login').addEventListener('submit', handleLogin);
  $('form-register').addEventListener('submit', handleRegister);
  $('btn-logout').addEventListener('click', handleLogout);

  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    renderAccount();
  } catch (e) {
    renderGuest();
  }
}

boot();

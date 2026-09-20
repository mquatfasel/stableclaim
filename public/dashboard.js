// public/dashboard.js
// App-Shell (Sidebar-Navigation) sowie die Module Kalender und Kalkulation.
// Echtes Frontend: spricht per fetch() gegen die eigene API (src/server.js).

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

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

function initials(name) {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/);
  return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function money(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ---------- Sidebar-Navigation ----------
function setActiveView(view) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('is-active', section.id === `view-${view}`);
  });
  try { localStorage.setItem('sc_dashboard_view', view); } catch (e) { /* privater Modus etc. */ }
}

function initNav() {
  $('sidebar-nav').addEventListener('click', (evt) => {
    const btn = evt.target.closest('.nav-item');
    if (!btn) return;
    setActiveView(btn.dataset.view);
  });
  let startView = 'uebersicht';
  try {
    const saved = localStorage.getItem('sc_dashboard_view');
    if (saved && document.getElementById(`view-${saved}`)) startView = saved;
  } catch (e) { /* ignorieren */ }
  setActiveView(startView);
}

// ---------- Konto ----------
async function loadAccount() {
  try {
    const data = await api('/api/auth/me');
    $('acc-avatar').textContent = initials(data.user.name);
    $('acc-name').textContent = data.user.name;
    $('acc-meta').textContent = `${data.user.rolle} · ${data.user.betrieb}`;
    return data.user;
  } catch (e) {
    window.location.href = '/index.html';
    return null;
  }
}

function initLogout() {
  $('btn-logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* Cookie wird ohnehin ungültig */ }
    window.location.href = '/index.html';
  });
}

// ================== Kalender ==================
const KAL_MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
let kalView = new Date();
kalView.setDate(1);

function renderKalender() {
  $('kal-monat-label').textContent = `${KAL_MONATE[kalView.getMonth()]} ${kalView.getFullYear()}`;
  const grid = $('kal-grid');
  grid.innerHTML = '';

  const first = new Date(kalView.getFullYear(), kalView.getMonth(), 1);
  // Montag = 0 ... Sonntag = 6
  const leadingEmpty = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(kalView.getFullYear(), kalView.getMonth() + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < leadingEmpty; i++) {
    const cell = document.createElement('div');
    cell.className = 'kal-day is-empty';
    grid.appendChild(cell);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    const isToday = today.getFullYear() === kalView.getFullYear()
      && today.getMonth() === kalView.getMonth()
      && today.getDate() === day;
    cell.className = 'kal-day' + (isToday ? ' is-today' : '');
    cell.textContent = String(day);
    grid.appendChild(cell);
  }
}

async function loadKalenderConfig() {
  try {
    const data = await api('/api/calendar/config');
    if (data.embedUrl) {
      $('kal-embed-wrap').innerHTML = `<iframe src="${data.embedUrl}" title="Google Kalender" loading="lazy"></iframe>`;
      $('kal-embed-hint').textContent = 'Direkt eingebetteter Google Kalender dieses Betriebs.';
    } else {
      $('kal-embed-hint').textContent = 'Noch kein Google Kalender eingebettet. In Render unter Environment die Variable GOOGLE_CALENDAR_EMBED_URL setzen (Google Kalender → Einstellungen → „Kalender in Website einbetten" → iframe-Link kopieren).';
    }
  } catch (e) {
    // Nicht kritisch für das restliche Modul — Fallback bleibt der externe Link.
  }
}

function initKalender() {
  $('kal-prev').addEventListener('click', () => {
    kalView.setMonth(kalView.getMonth() - 1);
    renderKalender();
  });
  $('kal-next').addEventListener('click', () => {
    kalView.setMonth(kalView.getMonth() + 1);
    renderKalender();
  });
  renderKalender();
  loadKalenderConfig();
}

// ================== Kalkulation ==================
let alleKomponenten = [];
let alleKalkulationen = [];
let kalkTyp = 'gericht';
let kalkRows = []; // { komponenteId, mengeProPortion }

function komponenteById(id) {
  return alleKomponenten.find((k) => k.id === id) || null;
}

function renderKomponentenSelect() {
  const select = $('kalk-komponente-select');
  const byKategorie = {};
  alleKomponenten.forEach((k) => {
    if (!byKategorie[k.kategorie]) byKategorie[k.kategorie] = [];
    byKategorie[k.kategorie].push(k);
  });
  select.innerHTML = Object.keys(byKategorie).sort().map((kategorie) => {
    const options = byKategorie[kategorie]
      .map((k) => `<option value="${k.id}">${k.name}</option>`)
      .join('');
    return `<optgroup label="${kategorie}">${options}</optgroup>`;
  }).join('');
  updateMengeEinheit();
}

function updateMengeEinheit() {
  const komponente = komponenteById($('kalk-komponente-select').value);
  $('kalk-menge-einheit').textContent = komponente ? komponente.einheit + ' / Portion' : '';
}

function sliderMaxForEinheit(einheit) {
  return einheit === 'Stück' ? 5 : 2;
}

function recalcKalkulation() {
  const portionen = Number($('kalk-portionen').value) || 1;
  const quote = (Number($('kalk-quote').value) || 30) / 100;

  let wareneinsatzProPortion = 0;
  kalkRows.forEach((row) => {
    const komponente = komponenteById(row.komponenteId);
    if (!komponente) return;
    wareneinsatzProPortion += row.mengeProPortion * komponente.preisProEinheit;
  });
  const wareneinsatzGesamt = wareneinsatzProPortion * portionen;
  const empfohlenerVk = quote > 0 ? wareneinsatzProPortion / quote : 0;
  const deckungsbeitrag = empfohlenerVk - wareneinsatzProPortion;

  $('kalk-sum-gesamt').textContent = money(wareneinsatzGesamt);
  $('kalk-sum-portion').textContent = money(wareneinsatzProPortion);
  $('kalk-sum-vk').textContent = money(empfohlenerVk);
  $('kalk-sum-db').textContent = money(deckungsbeitrag);

  // Zeilen (Menge gesamt / Preis gesamt) mit aktualisieren, ohne die Tabelle neu aufzubauen,
  // damit ein aktiver Schieberegler nicht den Fokus verliert.
  kalkRows.forEach((row) => {
    const komponente = komponenteById(row.komponenteId);
    if (!komponente) return;
    const tr = document.querySelector(`#kalk-rows tr[data-id="${row.komponenteId}"]`);
    if (!tr) return;
    const mengeGesamt = row.mengeProPortion * portionen;
    tr.querySelector('.kalk-menge-gesamt').textContent = `${mengeGesamt.toFixed(2)} ${komponente.einheit}`;
    tr.querySelector('.kalk-preis-gesamt').textContent = money(mengeGesamt * komponente.preisProEinheit);
  });

  return { portionen, quote, wareneinsatzGesamt, wareneinsatzProPortion, empfohlenerVk, deckungsbeitrag };
}

function renderKalkTable() {
  const tbody = $('kalk-rows');
  tbody.innerHTML = '';
  $('kalk-empty-hint').hidden = kalkRows.length > 0;

  kalkRows.forEach((row) => {
    const komponente = komponenteById(row.komponenteId);
    if (!komponente) return;
    const tr = document.createElement('tr');
    tr.dataset.id = row.komponenteId;
    tr.innerHTML = `
      <td>${komponente.name}<br><small class="hint" style="margin:0;">${komponente.kategorie}</small></td>
      <td class="mengefeld">
        <input type="range" min="0" max="${sliderMaxForEinheit(komponente.einheit)}" step="0.01" value="${row.mengeProPortion}">
        <div class="hint" style="margin-top:2px;">${row.mengeProPortion.toFixed(2)} ${komponente.einheit} / Portion</div>
      </td>
      <td class="kalk-menge-gesamt mono"></td>
      <td class="kalk-preis-gesamt mono"></td>
      <td><button class="kalk-row-remove" type="button" title="Entfernen">×</button></td>
    `;
    const slider = tr.querySelector('input[type="range"]');
    slider.addEventListener('input', () => {
      row.mengeProPortion = Number(slider.value);
      tr.querySelector('.hint').textContent = `${row.mengeProPortion.toFixed(2)} ${komponente.einheit} / Portion`;
      recalcKalkulation();
    });
    tr.querySelector('.kalk-row-remove').addEventListener('click', () => {
      kalkRows = kalkRows.filter((r) => r.komponenteId !== row.komponenteId);
      renderKalkTable();
      recalcKalkulation();
    });
    tbody.appendChild(tr);
  });

  recalcKalkulation();
}

function addKomponenteToBuilder() {
  const komponenteId = $('kalk-komponente-select').value;
  const komponente = komponenteById(komponenteId);
  if (!komponente) return;
  const mengeInput = Number($('kalk-menge-input').value);
  const menge = mengeInput > 0 ? mengeInput : (komponente.einheit === 'Stück' ? 1 : 0.1);

  const existing = kalkRows.find((r) => r.komponenteId === komponenteId);
  if (existing) {
    existing.mengeProPortion = menge;
  } else {
    kalkRows.push({ komponenteId, mengeProPortion: menge });
  }
  $('kalk-menge-input').value = '';
  renderKalkTable();
}

function resetBuilder() {
  kalkRows = [];
  $('kalk-name').value = '';
  $('kalk-portionen').value = 20;
  $('kalk-portionen-val').textContent = '20';
  $('kalk-quote').value = 30;
  $('kalk-quote-val').textContent = '30 %';
  renderKalkTable();
  setStatus('');
}

function setStatus(msg, kind) {
  const el = $('kalk-status');
  el.textContent = msg || '';
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

function switchKalkTyp(typ) {
  kalkTyp = typ;
  document.querySelectorAll('#kalk-typ-tabs .tab-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.kalkTyp === typ));
  });
  $('kalk-list-title').textContent = typ === 'buffet' ? 'Gespeicherte Buffets' : 'Gespeicherte Gerichte';
  renderSavedList();
}

function renderSavedList() {
  const list = alleKalkulationen.filter((k) => k.typ === kalkTyp);
  const wrap = $('kalk-saved-list');
  $('kalk-saved-empty').hidden = list.length > 0;
  wrap.innerHTML = '';
  list.forEach((k) => {
    const item = document.createElement('div');
    item.className = 'kalk-saved-item';
    const datum = new Date(k.erstelltAm).toLocaleDateString('de-DE');
    item.innerHTML = `
      <div class="row1"><strong>${k.name}</strong><span class="meta mono">${k.portionen} Port.</span></div>
      <div class="meta">Empf. VK: ${money(k.empfohlenerVkPreisProPortion)} / Portion · gespeichert am ${datum}</div>
      <div class="row-actions">
        <button data-action="open">Öffnen</button>
        <button data-action="email">Per E-Mail senden</button>
        <button data-action="delete">Löschen</button>
      </div>
    `;
    item.querySelector('[data-action="open"]').addEventListener('click', () => openSavedKalkulation(k));
    item.querySelector('[data-action="email"]').addEventListener('click', () => sendKalkulationEmail(k));
    item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSavedKalkulation(k));
    wrap.appendChild(item);
  });
}

function openSavedKalkulation(k) {
  switchKalkTyp(k.typ);
  document.querySelectorAll('#kalk-typ-tabs .tab-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.kalkTyp === k.typ));
  });
  $('kalk-name').value = k.name;
  $('kalk-portionen').value = k.portionen;
  $('kalk-portionen-val').textContent = String(k.portionen);
  $('kalk-quote').value = Math.round((k.zielWareneinsatzquote || 0.3) * 100);
  $('kalk-quote-val').textContent = `${Math.round((k.zielWareneinsatzquote || 0.3) * 100)} %`;
  kalkRows = k.zeilen
    .filter((z) => komponenteById(z.komponenteId))
    .map((z) => ({ komponenteId: z.komponenteId, mengeProPortion: z.mengeProPortion }));
  renderKalkTable();
  toast(`„${k.name}" geladen — Änderungen werden als neue Kalkulation gespeichert.`);
}

function buildEmailForKalkulation(k) {
  const zeilenText = k.zeilen
    .map((z) => `- ${z.name}: ${z.mengeGesamt} ${z.einheit} (${money(z.preisGesamt)})`)
    .join('\n');
  const subject = `Ihr individuelles Angebot: ${k.name}`;
  const body = [
    `Guten Tag,`,
    ``,
    `anbei unser Vorschlag „${k.name}" für ${k.portionen} Personen:`,
    ``,
    zeilenText,
    ``,
    `Empfohlener Verkaufspreis pro Portion: ${money(k.empfohlenerVkPreisProPortion)}`,
    `Gesamtpreis (${k.portionen} Portionen): ${money(k.empfohlenerVkPreisProPortion * k.portionen)}`,
    ``,
    `Mit freundlichen Grüßen`,
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function sendKalkulationEmail(k) {
  window.location.href = buildEmailForKalkulation(k);
}

async function deleteSavedKalkulation(k) {
  try {
    await api(`/api/kalkulationen/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
    alleKalkulationen = alleKalkulationen.filter((item) => item.id !== k.id);
    renderSavedList();
    toast('Kalkulation gelöscht.');
  } catch (e) {
    toast(e.message || 'Löschen fehlgeschlagen.');
  }
}

async function saveCurrentKalkulation() {
  const name = $('kalk-name').value.trim();
  if (!name) {
    setStatus('Bitte einen Namen angeben.', 'error');
    return;
  }
  if (!kalkRows.length) {
    setStatus('Bitte mindestens eine Komponente hinzufügen.', 'error');
    return;
  }
  const btn = $('kalk-save-btn');
  btn.disabled = true;
  setStatus('Speichere …');
  try {
    const data = await api('/api/kalkulationen', {
      method: 'POST',
      body: {
        typ: kalkTyp,
        name,
        portionen: Number($('kalk-portionen').value),
        zielWareneinsatzquote: Number($('kalk-quote').value) / 100,
        komponenten: kalkRows,
      },
    });
    alleKalkulationen.unshift(data.kalkulation);
    renderSavedList();
    setStatus('Gespeichert.', 'ok');
    toast(`„${name}" gespeichert.`);
  } catch (e) {
    setStatus(e.message || 'Speichern fehlgeschlagen.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function emailCurrentDraft() {
  if (!kalkRows.length) {
    setStatus('Bitte mindestens eine Komponente hinzufügen, bevor eine E-Mail erstellt wird.', 'error');
    return;
  }
  const ergebnis = recalcKalkulation();
  const name = $('kalk-name').value.trim() || (kalkTyp === 'buffet' ? 'Buffet-Angebot' : 'Gericht');
  const draft = {
    name,
    portionen: ergebnis.portionen,
    empfohlenerVkPreisProPortion: ergebnis.empfohlenerVk,
    zeilen: kalkRows.map((row) => {
      const komponente = komponenteById(row.komponenteId);
      const mengeGesamt = row.mengeProPortion * ergebnis.portionen;
      return {
        name: komponente.name,
        einheit: komponente.einheit,
        mengeGesamt: mengeGesamt.toFixed(2),
        preisGesamt: (mengeGesamt * komponente.preisProEinheit),
      };
    }),
  };
  window.location.href = buildEmailForKalkulation(draft);
}

async function initKalkulation() {
  try {
    const [komponentenData, kalkulationenData] = await Promise.all([
      api('/api/components'),
      api('/api/kalkulationen'),
    ]);
    alleKomponenten = komponentenData.components;
    alleKalkulationen = kalkulationenData.kalkulationen;
  } catch (e) {
    toast('Komponenten konnten nicht geladen werden.');
    alleKomponenten = [];
    alleKalkulationen = [];
  }

  renderKomponentenSelect();
  renderSavedList();
  renderKalkTable();

  $('kalk-typ-tabs').addEventListener('click', (evt) => {
    const btn = evt.target.closest('.tab-btn');
    if (!btn) return;
    switchKalkTyp(btn.dataset.kalkTyp);
  });
  $('kalk-komponente-select').addEventListener('change', updateMengeEinheit);
  $('kalk-add-btn').addEventListener('click', addKomponenteToBuilder);
  $('kalk-portionen').addEventListener('input', () => {
    $('kalk-portionen-val').textContent = $('kalk-portionen').value;
    recalcKalkulation();
  });
  $('kalk-quote').addEventListener('input', () => {
    $('kalk-quote-val').textContent = `${$('kalk-quote').value} %`;
    recalcKalkulation();
  });
  $('kalk-save-btn').addEventListener('click', saveCurrentKalkulation);
  $('kalk-email-btn').addEventListener('click', emailCurrentDraft);
  $('kalk-reset-btn').addEventListener('click', resetBuilder);
}

// ================== Artikelstamm & Allergene ==================
// Nutzt dieselben Komponenten wie die Kalkulation (alleKomponenten) — eine
// Information (Preis, Allergene) wird nur einmal gepflegt und erscheint
// automatisch an allen Stellen (Grundprinzip der Gastrozentrale).
function allergeneText(k) {
  if (Array.isArray(k.allergene) && k.allergene.length > 0) return k.allergene.join(', ');
  if (Array.isArray(k.allergene) && k.allergene.length === 0) return 'frei von kennzeichnungspflichtigen Allergenen';
  return 'noch zu prüfen';
}

function renderArtikelstamm() {
  const tbody = $('artikel-rows');
  if (!tbody) return;
  tbody.innerHTML = alleKomponenten.map((k) => `
    <tr>
      <td>${k.name}</td>
      <td>${k.kategorie}</td>
      <td>${k.einheit}</td>
      <td class="mono">${money(k.preisProEinheit)}</td>
      <td>${k.lieferant || '–'}</td>
      <td class="mono">${k.artikelnummer || '–'}</td>
    </tr>
  `).join('');
  const offen = alleKomponenten.filter((k) => k.allergene === null).length;
  $('artikel-hint').textContent = `${alleKomponenten.length} Artikel im Artikelstamm — Preise aus dem CHEFS-CULINAR-Konto. Weitere Artikel aus den insgesamt 846 gekauften Positionen der letzten 12 Monate lassen sich hier Schritt für Schritt ergänzen.`;
}

function renderAllergene() {
  const tbody = $('allergene-rows');
  if (!tbody) return;
  tbody.innerHTML = alleKomponenten.map((k) => `
    <tr>
      <td>${k.name}</td>
      <td>${k.kategorie}</td>
      <td>${allergeneText(k)}${k.allergeneHinweis ? `<br><small class="hint" style="margin:0;">${k.allergeneHinweis}</small>` : ''}</td>
    </tr>
  `).join('');
  const offen = alleKomponenten.filter((k) => k.allergene === null).length;
  $('allergene-hint').textContent = offen > 0
    ? `${offen} von ${alleKomponenten.length} Artikeln fehlt noch eine geprüfte Allergenangabe.`
    : `Für alle ${alleKomponenten.length} Artikel liegen geprüfte Allergenangaben vor.`;
}

// ================== Bereiche (HACCP / Reinigungspläne) ==================
let alleBereiche = [];

function bereichCardHtml(b, art) {
  const href = art === 'haccp' ? `/api/vorlagen/haccp?bereich=${encodeURIComponent(b.id)}` : `/api/vorlagen/reinigung?bereich=${encodeURIComponent(b.id)}`;
  const label = art === 'haccp' ? 'HACCP-Kontrollliste öffnen' : 'Reinigungsplan öffnen';
  return `
    <div class="bereich-card" data-id="${b.id}">
      <strong>${b.name}</strong>
      <span class="typ">${b.typ}</span>
      <div class="bereich-actions">
        <a href="${href}" target="_blank" rel="noopener">${label}</a>
        <button class="bereich-delete" data-action="delete" title="Bereich entfernen">×</button>
      </div>
    </div>
  `;
}

function renderBereiche() {
  ['haccp', 'reinigung'].forEach((art) => {
    const grid = $(`bereiche-grid-${art}`);
    const empty = $(`bereiche-empty-${art}`);
    if (!grid) return;
    empty.hidden = alleBereiche.length > 0;
    grid.innerHTML = alleBereiche.map((b) => bereichCardHtml(b, art)).join('');
    grid.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.bereich-card').dataset.id;
        deleteBereich(id);
      });
    });
  });
}

async function loadBereiche() {
  try {
    const data = await api('/api/bereiche');
    alleBereiche = data.bereiche;
  } catch (e) {
    alleBereiche = [];
  }
  renderBereiche();
}

async function addBereich(art) {
  const nameInput = $(`bereich-name-${art}`);
  const typSelect = $(`bereich-typ-${art}`);
  const name = nameInput.value.trim();
  if (!name) { toast('Bitte einen Namen für den Bereich angeben.'); return; }
  try {
    const data = await api('/api/bereiche', { method: 'POST', body: { name, typ: typSelect.value } });
    alleBereiche.unshift(data.bereich);
    renderBereiche();
    nameInput.value = '';
    toast(`Bereich „${name}" hinzugefügt.`);
  } catch (e) {
    toast(e.message || 'Bereich konnte nicht angelegt werden.');
  }
}

async function deleteBereich(id) {
  try {
    await api(`/api/bereiche/${encodeURIComponent(id)}`, { method: 'DELETE' });
    alleBereiche = alleBereiche.filter((b) => b.id !== id);
    renderBereiche();
  } catch (e) {
    toast(e.message || 'Bereich konnte nicht entfernt werden.');
  }
}

function initBereiche() {
  ['haccp', 'reinigung'].forEach((art) => {
    const btn = $(`bereich-add-btn-${art}`);
    if (btn) btn.addEventListener('click', () => addBereich(art));
  });
  loadBereiche();
}

// ================== Personal / Zeiterfassung ==================
let laufenderEintrag = null;
let zeitTimer = null;

function formatDauer(minuten) {
  if (minuten == null) return '–';
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

function formatZeitpunkt(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderZeitStatus() {
  const statusEl = $('zeit-status');
  const btn = $('zeit-toggle-btn');
  if (!statusEl || !btn) return;
  if (laufenderEintrag) {
    const seit = new Date(laufenderEintrag.beginn);
    const minuten = Math.max(0, Math.round((Date.now() - seit.getTime()) / 60000));
    statusEl.innerHTML = `Eingestempelt seit <strong>${formatZeitpunkt(laufenderEintrag.beginn)}</strong> — läuft seit ${formatDauer(minuten)}`;
    btn.textContent = 'Gehen';
    btn.classList.add('is-running');
  } else {
    statusEl.textContent = 'Aktuell nicht eingestempelt.';
    btn.textContent = 'Kommen';
    btn.classList.remove('is-running');
  }
}

function renderZeitTabelle(eintraege) {
  const tbody = $('zeit-rows');
  if (!tbody) return;
  const sortiert = [...eintraege].sort((a, b) => new Date(b.beginn) - new Date(a.beginn));
  $('zeit-empty').hidden = sortiert.length > 0;
  tbody.innerHTML = sortiert.map((z) => `
    <tr>
      <td>${z.userName}</td>
      <td>${formatZeitpunkt(z.beginn)}</td>
      <td>${z.ende ? formatZeitpunkt(z.ende) : '<em>läuft …</em>'}</td>
      <td class="mono">${formatDauer(z.dauerMinuten)}</td>
    </tr>
  `).join('');
}

async function loadZeiterfassung() {
  try {
    const data = await api('/api/zeiterfassung/eintraege');
    laufenderEintrag = data.laufenderEintrag;
    renderZeitStatus();
    renderZeitTabelle(data.eintraege);
  } catch (e) {
    // still ignorieren, Modul bleibt nutzbar
  }
}

async function toggleZeiterfassung() {
  const btn = $('zeit-toggle-btn');
  btn.disabled = true;
  try {
    if (laufenderEintrag) {
      await api('/api/zeiterfassung/stop', { method: 'POST' });
      toast('Ausgestempelt.');
    } else {
      await api('/api/zeiterfassung/start', { method: 'POST' });
      toast('Eingestempelt.');
    }
    await loadZeiterfassung();
  } catch (e) {
    toast(e.message || 'Zeiterfassung fehlgeschlagen.');
  } finally {
    btn.disabled = false;
  }
}

function initPersonal() {
  $('zeit-toggle-btn').addEventListener('click', toggleZeiterfassung);
  loadZeiterfassung();
  clearInterval(zeitTimer);
  zeitTimer = setInterval(() => { if (laufenderEintrag) renderZeitStatus(); }, 30000);
}

// ================== Personalakten ==================
let alleMitarbeiter = [];

function mitarbeiterCardHtml(m) {
  const zeilen = [];
  if (m.rolle) zeilen.push(m.rolle);
  if (m.email) zeilen.push(m.email);
  if (m.telefon) zeilen.push(m.telefon);
  if (m.eintrittsdatum) zeilen.push(`seit ${new Date(m.eintrittsdatum).toLocaleDateString('de-DE')}`);
  return `
    <div class="bereich-card" data-id="${m.id}">
      <strong>${m.name}</strong>
      <span class="typ">${zeilen.join(' · ') || 'Noch keine weiteren Angaben'}</span>
      <div class="bereich-actions">
        <button class="bereich-delete" data-action="delete" title="Personalakte entfernen">×</button>
      </div>
    </div>
  `;
}

function renderMitarbeiterGrid() {
  const grid = $('mitarbeiter-grid');
  const empty = $('mitarbeiter-empty');
  if (!grid) return;
  empty.hidden = alleMitarbeiter.length > 0;
  grid.innerHTML = alleMitarbeiter.map(mitarbeiterCardHtml).join('');
  grid.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.bereich-card').dataset.id;
      deleteMitarbeiter(id);
    });
  });
}

function renderMitarbeiterSelect() {
  const select = $('sch-mitarbeiter');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Mitarbeiter wählen…</option>'
    + alleMitarbeiter.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  if (current) select.value = current;
}

async function loadMitarbeiter() {
  try {
    const data = await api('/api/mitarbeiter');
    alleMitarbeiter = data.mitarbeiter;
  } catch (e) {
    alleMitarbeiter = [];
  }
  renderMitarbeiterGrid();
  renderMitarbeiterSelect();
}

async function addMitarbeiter() {
  const name = $('ma-name').value.trim();
  if (!name) { toast('Bitte einen Namen angeben.'); return; }
  try {
    const data = await api('/api/mitarbeiter', {
      method: 'POST',
      body: {
        name,
        rolle: $('ma-rolle').value,
        email: $('ma-email').value.trim(),
        eintrittsdatum: $('ma-eintritt').value || null,
      },
    });
    alleMitarbeiter.unshift(data.mitarbeiter);
    renderMitarbeiterGrid();
    renderMitarbeiterSelect();
    $('ma-name').value = '';
    $('ma-rolle').value = '';
    $('ma-email').value = '';
    $('ma-eintritt').value = '';
    toast(`Personalakte „${name}" angelegt.`);
  } catch (e) {
    toast(e.message || 'Mitarbeiter konnte nicht angelegt werden.');
  }
}

async function deleteMitarbeiter(id) {
  try {
    await api(`/api/mitarbeiter/${encodeURIComponent(id)}`, { method: 'DELETE' });
    alleMitarbeiter = alleMitarbeiter.filter((m) => m.id !== id);
    renderMitarbeiterGrid();
    renderMitarbeiterSelect();
  } catch (e) {
    toast(e.message || 'Personalakte konnte nicht entfernt werden.');
  }
}

async function initPersonalakten() {
  $('mitarbeiter-add-btn').addEventListener('click', addMitarbeiter);
  await loadMitarbeiter();
}

// ================== Dienstplan ==================
const DP_WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
let alleSchichten = [];
let dpWeekStart = mondayOf(new Date());

function mondayOf(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderDienstplan() {
  const grid = $('dp-grid');
  if (!grid) return;
  const weekEnd = new Date(dpWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  $('dp-woche-label').textContent = `${dpWeekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${weekEnd.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  const today = isoDate(new Date());
  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const day = new Date(dpWeekStart);
    day.setDate(day.getDate() + i);
    const dayIso = isoDate(day);
    const schichtenDesTages = alleSchichten
      .filter((s) => s.datum === dayIso)
      .sort((a, b) => (a.beginn || '').localeCompare(b.beginn || ''));

    const col = document.createElement('div');
    col.className = 'dp-day' + (dayIso === today ? ' is-today' : '');
    col.innerHTML = `
      <div class="dp-day-head">${DP_WOCHENTAGE[i]}<span class="datum">${day.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span></div>
      ${schichtenDesTages.length ? '' : '<span class="dp-day-empty">–</span>'}
    `;
    schichtenDesTages.forEach((s) => {
      const chip = document.createElement('div');
      chip.className = 'dp-shift';
      chip.innerHTML = `
        <button class="dp-remove" title="Schicht entfernen">×</button>
        <strong>${s.mitarbeiterName}</strong>
        <span class="zeit">${s.beginn || '–'}–${s.ende || '–'}</span>
        ${s.bereich ? `<span class="bereich">${s.bereich}</span>` : ''}
      `;
      chip.querySelector('.dp-remove').addEventListener('click', () => deleteSchicht(s.id));
      col.appendChild(chip);
    });
    grid.appendChild(col);
  }
}

async function loadSchichten() {
  try {
    const data = await api('/api/schichten');
    alleSchichten = data.schichten;
  } catch (e) {
    alleSchichten = [];
  }
  renderDienstplan();
}

async function addSchicht() {
  const datum = $('sch-datum').value;
  const mitarbeiterId = $('sch-mitarbeiter').value;
  const mitarbeiter = alleMitarbeiter.find((m) => m.id === mitarbeiterId);
  const statusEl = $('schicht-status');
  if (!datum) { statusEl.textContent = 'Bitte ein Datum wählen.'; return; }
  if (!mitarbeiter) { statusEl.textContent = 'Bitte einen Mitarbeiter wählen (siehe Personalakten).'; return; }

  statusEl.textContent = 'Speichere …';
  try {
    const data = await api('/api/schichten', {
      method: 'POST',
      body: {
        datum,
        mitarbeiterId: mitarbeiter.id,
        mitarbeiterName: mitarbeiter.name,
        beginn: $('sch-beginn').value,
        ende: $('sch-ende').value,
        bereich: $('sch-bereich').value.trim(),
      },
    });
    alleSchichten.unshift(data.schicht);
    dpWeekStart = mondayOf(new Date(datum));
    renderDienstplan();
    $('sch-bereich').value = '';
    statusEl.textContent = '';
    toast(`Schicht für ${mitarbeiter.name} gespeichert.`);
  } catch (e) {
    statusEl.textContent = e.message || 'Schicht konnte nicht gespeichert werden.';
  }
}

async function deleteSchicht(id) {
  try {
    await api(`/api/schichten/${encodeURIComponent(id)}`, { method: 'DELETE' });
    alleSchichten = alleSchichten.filter((s) => s.id !== id);
    renderDienstplan();
  } catch (e) {
    toast(e.message || 'Schicht konnte nicht entfernt werden.');
  }
}

function initDienstplan() {
  $('sch-datum').value = isoDate(new Date());
  $('schicht-add-btn').addEventListener('click', addSchicht);
  $('dp-prev').addEventListener('click', () => {
    dpWeekStart.setDate(dpWeekStart.getDate() - 7);
    renderDienstplan();
  });
  $('dp-next').addEventListener('click', () => {
    dpWeekStart.setDate(dpWeekStart.getDate() + 7);
    renderDienstplan();
  });
  loadSchichten();
}

// ---------- Boot ----------
async function boot() {
  const user = await loadAccount();
  if (!user) return; // wird bereits zu /index.html umgeleitet
  initNav();
  initLogout();
  initKalender();
  await initKalkulation();
  renderArtikelstamm();
  renderAllergene();
  initBereiche();
  initPersonal();
  await initPersonalakten();
  initDienstplan();
}

boot();

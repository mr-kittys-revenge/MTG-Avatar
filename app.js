// MTG Avatar Set Tracker
'use strict';

const STORAGE_KEY = 'mtg-avatar-collection-v2';
const PREFS_KEY = 'mtg-avatar-prefs-v1';
const PASSWORD_KEY = 'mtg-avatar-pwd-v1';
const VERSION_KEY = 'mtg-avatar-version-v1';

// ============================================================
// Auth + API client
// ============================================================
function getPassword() { return localStorage.getItem(PASSWORD_KEY) || ''; }
function setPassword(pw) { localStorage.setItem(PASSWORD_KEY, pw); }
function clearPassword() { localStorage.removeItem(PASSWORD_KEY); }

async function apiFetch(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (path !== '/api/auth') headers.set('X-App-Password', getPassword());
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearPassword();
    showLoginScreen('Session expired. Please sign in again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function checkAuth(pw) {
  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  return r.ok;
}

const SET_ORDER = ['tla', 'tle', 'ptla', 'jtla', 'atla', 'atle', 'ttla', 'ttle', 'ftla'];
const SET_NAMES = {
  tla: 'Main Set',
  tle: 'Eternal',
  ptla: 'Promos',
  jtla: 'Jumpstart',
  atla: 'Art Series',
  atle: 'Eternal Art',
  ttla: 'Tokens',
  ttle: 'Eternal Tokens',
  ftla: 'Beginner Box',
};
const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5 };

// ----- State -----
let CARDS = [];
let collection = loadCollectionCache();
let prefs = loadPrefs();
let serverVersion = parseInt(localStorage.getItem(VERSION_KEY)) || 0;
let pendingPatches = 0; // counter for in-flight saves
let lastServerSync = null;

const filters = {
  q: '',
  status: 'any',     // any | owned | missing | wishlist | hasFoil | needFoil
  sets: new Set(),
  rarities: new Set(),
  colors: new Set(),
  sort: 'set',
};

// ----- Storage (server-backed, with localStorage cache) -----
function loadCollectionCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveCollectionCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
  localStorage.setItem(VERSION_KEY, String(serverVersion));
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || { showStats: true }; }
  catch { return { showStats: true }; }
}
function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

async function syncFromServer() {
  setSyncStatus('Syncing…', false);
  try {
    const data = await apiFetch('/api/collection', { method: 'GET' });
    collection = data.collection || {};
    serverVersion = data.version || 0;
    lastServerSync = new Date();
    saveCollectionCache();
    renderGrid();
    setSyncStatus('Synced', false);
    setTimeout(() => hideSyncStatus(), 1500);
    return true;
  } catch (e) {
    setSyncStatus('Offline · cached', true);
    return false;
  }
}

function getEntry(id) {
  return collection[id] || { n: 0, f: 0, e: 0, w: false, note: '' };
}

// Optimistic local update + async PATCH to server.
function setEntry(id, updates) {
  const cur = getEntry(id);
  const next = { ...cur, ...updates };
  const empty = !next.n && !next.f && !next.e && !next.w && !next.note;
  if (empty) delete collection[id]; else collection[id] = next;
  saveCollectionCache();
  pushEntry(id, empty ? null : next);
}

async function pushEntry(id, entry) {
  pendingPatches++;
  setSyncStatus('Saving…', false);
  try {
    const r = await apiFetch('/api/collection', {
      method: 'PATCH',
      body: JSON.stringify({ id, entry }),
    });
    if (r?.version) { serverVersion = r.version; localStorage.setItem(VERSION_KEY, String(serverVersion)); }
    lastServerSync = new Date();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      setSyncStatus('Offline · changes saved locally', true);
    }
    return;
  } finally {
    pendingPatches--;
    if (pendingPatches === 0) {
      setSyncStatus('Saved', false);
      setTimeout(() => hideSyncStatus(), 1200);
    }
  }
}

const syncEl = () => document.getElementById('syncIndicator');
const syncTextEl = () => document.getElementById('syncText');
function setSyncStatus(text, isError) {
  const el = syncEl(); if (!el) return;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
  syncTextEl().textContent = text;
}
function hideSyncStatus() { const el = syncEl(); if (el) el.classList.add('hidden'); }

// ----- Helpers -----
function colorBucket(card) {
  const c = card.colors || [];
  if (c.length === 0) return 'C';
  if (c.length > 1) return 'M';
  return c[0];
}
function hasFinish(card, finish) {
  return (card.finishes || []).includes(finish);
}
function cardOwned(id) {
  const e = getEntry(id);
  return e.n > 0 || e.f > 0 || e.e > 0;
}
function totalOwned(id) {
  const e = getEntry(id);
  return e.n + e.f + e.e;
}

// ----- Filtering / sorting -----
function passesFilters(card) {
  const e = getEntry(card.id);

  if (filters.q) {
    if (!card.name.toLowerCase().includes(filters.q)) return false;
  }

  switch (filters.status) {
    case 'owned': if (!cardOwned(card.id)) return false; break;
    case 'missing': if (cardOwned(card.id)) return false; break;
    case 'wishlist': if (!e.w) return false; break;
    case 'hasFoil': if (e.f === 0 && e.e === 0) return false; break;
    case 'needFoil':
      if (!hasFinish(card, 'foil') && !hasFinish(card, 'etched')) return false;
      if (e.f > 0 || e.e > 0) return false;
      break;
  }

  if (filters.sets.size && !filters.sets.has(card.set)) return false;
  if (filters.rarities.size && !filters.rarities.has(card.rarity)) return false;

  if (filters.colors.size) {
    const b = colorBucket(card);
    if (!filters.colors.has(b)) return false;
  }

  return true;
}

function sortCards(arr) {
  const s = filters.sort;
  return arr.sort((a, b) => {
    if (s === 'name') return a.name.localeCompare(b.name);
    if (s === 'rarity') {
      const r = (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99);
      if (r) return r;
      return a.name.localeCompare(b.name);
    }
    if (s === 'color') {
      const order = { W: 0, U: 1, B: 2, R: 3, G: 4, M: 5, C: 6 };
      const c = (order[colorBucket(a)] ?? 9) - (order[colorBucket(b)] ?? 9);
      if (c) return c;
      return a.name.localeCompare(b.name);
    }
    // set order
    const so = (SET_ORDER.indexOf(a.set) + 1 || 99) - (SET_ORDER.indexOf(b.set) + 1 || 99);
    if (so) return so;
    return collectorNumKey(a.collector_number) - collectorNumKey(b.collector_number);
  });
}
function collectorNumKey(s) {
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 99999;
}

// ----- Rendering -----
const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');

function renderGrid() {
  const filtered = sortCards(CARDS.filter(passesFilters));
  emptyEl.classList.toggle('hidden', filtered.length > 0);

  // Use a doc fragment + chunks to keep responsive on mobile
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const card of filtered) frag.appendChild(makeCardEl(card));
  grid.appendChild(frag);

  renderStats(filtered);
  renderChips();
}

function makeCardEl(card) {
  const e = getEntry(card.id);
  const owned = cardOwned(card.id);
  const wrap = document.createElement('div');
  wrap.className = 'card' + (owned ? ' has-any' : '');
  wrap.dataset.id = card.id;

  const imgwrap = document.createElement('div');
  imgwrap.className = 'img-wrap loading';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = card.name;
  img.src = card.image_small || '';
  img.onload = () => imgwrap.classList.remove('loading');
  img.onerror = () => imgwrap.classList.remove('loading');
  imgwrap.appendChild(img);

  const badges = document.createElement('div');
  badges.className = 'badges';
  badges.innerHTML = `
    <span class="badge set">${card.set.toUpperCase()} ${card.collector_number}</span>
    <span class="badge r r-${card.rarity}">${card.rarity[0].toUpperCase()}</span>
  `;
  imgwrap.appendChild(badges);

  if (owned || e.w) {
    const marks = document.createElement('div');
    marks.className = 'has-mark';
    if (e.n > 0) marks.innerHTML += `<span class="pill">×${e.n}</span>`;
    if (e.f > 0) marks.innerHTML += `<span class="pill f">F×${e.f}</span>`;
    if (e.e > 0) marks.innerHTML += `<span class="pill f">E×${e.e}</span>`;
    if (e.w) marks.innerHTML += `<span class="pill w">★</span>`;
    imgwrap.appendChild(marks);
  }

  imgwrap.addEventListener('click', () => openModal(card));
  wrap.appendChild(imgwrap);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `
    <div class="name">${escapeHtml(card.name)}</div>
    <div class="num">${SET_NAMES[card.set] || card.set} · ${card.collector_number}</div>
  `;
  wrap.appendChild(meta);

  // Inline +/- controls (nonfoil + foil if available)
  const controls = document.createElement('div');
  controls.className = 'controls';

  const showN = hasFinish(card, 'nonfoil');
  const showF = hasFinish(card, 'foil');
  const showE = hasFinish(card, 'etched');

  if (showN) controls.appendChild(makeQRow(card, 'n', e.n, ''));
  if (showF) controls.appendChild(makeQRow(card, 'f', e.f, 'foil'));
  if (showE && !showF) controls.appendChild(makeQRow(card, 'e', e.e, 'foil'));
  if (showE && showF) {
    // Already have foil row — add etched only when distinct treatment
    controls.appendChild(makeQRow(card, 'e', e.e, 'foil'));
  }

  wrap.appendChild(controls);
  return wrap;
}

function makeQRow(card, key, value, cls) {
  const row = document.createElement('div');
  row.className = 'qbtn-row ' + cls;
  const label = key === 'n' ? 'NF' : key === 'f' ? 'FOIL' : 'ETCH';
  row.innerHTML = `
    <button class="qbtn minus" aria-label="decrease">−</button>
    <span class="qval">${value}</span>
    <span class="qlabel">${label}</span>
    <button class="qbtn plus" aria-label="increase">+</button>
  `;
  row.querySelector('.minus').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const cur = getEntry(card.id);
    const v = Math.max(0, (cur[key] || 0) - 1);
    setEntry(card.id, { [key]: v });
    refreshCardEl(card.id);
  });
  row.querySelector('.plus').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const cur = getEntry(card.id);
    const v = (cur[key] || 0) + 1;
    setEntry(card.id, { [key]: v });
    refreshCardEl(card.id);
  });
  return row;
}

function refreshCardEl(id) {
  const node = grid.querySelector(`.card[data-id="${cssEscape(id)}"]`);
  const card = CARDS.find(c => c.id === id);
  if (!node || !card) { renderGrid(); return; }
  const fresh = makeCardEl(card);
  node.replaceWith(fresh);
  renderStats();
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/(["\\])/g, '\\$1');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ----- Stats -----
const statsEl = document.getElementById('stats');
function renderStats() {
  if (!prefs.showStats) { statsEl.classList.add('hidden'); return; }
  statsEl.classList.remove('hidden');

  const blocks = [];

  // Overall
  let totalPrintings = CARDS.length;
  let ownedAny = 0, totalCards = 0, totalFoils = 0, wishlist = 0;
  for (const c of CARDS) {
    const e = getEntry(c.id);
    if (e.n + e.f + e.e > 0) ownedAny++;
    totalCards += e.n;
    totalFoils += e.f + e.e;
    if (e.w) wishlist++;
  }
  const pct = totalPrintings ? Math.round(ownedAny / totalPrintings * 100) : 0;
  blocks.push(stat('Collection', `${ownedAny}/${totalPrintings}`, `${pct}%`, pct));
  blocks.push(stat('Total cards', `${totalCards + totalFoils}`, `${totalCards} NF · ${totalFoils} foil`));
  if (wishlist) blocks.push(stat('Wishlist', `${wishlist}`, 'cards wanted'));

  // Per-set
  for (const s of SET_ORDER) {
    const cardsInSet = CARDS.filter(c => c.set === s);
    if (!cardsInSet.length) continue;
    const owned = cardsInSet.filter(c => cardOwned(c.id)).length;
    const pct = Math.round(owned / cardsInSet.length * 100);
    blocks.push(stat(SET_NAMES[s] || s, `${owned}/${cardsInSet.length}`, `${s.toUpperCase()} · ${pct}%`, pct));
  }

  statsEl.innerHTML = blocks.join('');
}
function stat(label, value, sub, pct) {
  return `<div class="stat">
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value">${escapeHtml(value)}</div>
    <div class="stat-sub">${escapeHtml(sub || '')}</div>
    ${pct != null ? `<div class="bar"><div style="width:${pct}%"></div></div>` : ''}
  </div>`;
}

// ----- Filter chips (active-filter summary) -----
const chipsEl = document.getElementById('chips');
function renderChips() {
  const chips = [];
  if (filters.status !== 'any') chips.push({ k: 'status', label: filterLabel('status', filters.status) });
  for (const s of filters.sets) chips.push({ k: 'set:' + s, label: SET_NAMES[s] || s });
  for (const r of filters.rarities) chips.push({ k: 'rarity:' + r, label: cap(r) });
  for (const c of filters.colors) chips.push({ k: 'color:' + c, label: colorLabel(c) });
  if (filters.sort !== 'set') chips.push({ k: 'sort', label: 'Sort: ' + filters.sort });

  if (!chips.length) { chipsEl.innerHTML = ''; return; }
  chipsEl.innerHTML = chips.map(c => `<button class="chip on" data-k="${c.k}">${escapeHtml(c.label)} ✕</button>`).join('') +
    `<button class="chip" id="clearAllFilters">Clear</button>`;

  chipsEl.querySelectorAll('.chip[data-k]').forEach(b => {
    b.addEventListener('click', () => {
      const [k, v] = b.dataset.k.split(':');
      if (k === 'status') filters.status = 'any';
      else if (k === 'sort') filters.sort = 'set';
      else if (k === 'set') filters.sets.delete(v);
      else if (k === 'rarity') filters.rarities.delete(v);
      else if (k === 'color') filters.colors.delete(v);
      syncSheet(); renderGrid();
    });
  });
  const clearBtn = chipsEl.querySelector('#clearAllFilters');
  if (clearBtn) clearBtn.addEventListener('click', resetFilters);
}
function filterLabel(k, v) {
  if (k === 'status') return ({ owned: 'Owned', missing: 'Missing', wishlist: 'Wishlist', hasFoil: 'Has Foil', needFoil: 'Need Foil' })[v] || v;
  return v;
}
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function colorLabel(c) {
  return ({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', M: 'Multicolor' })[c] || c;
}

// ----- Filter sheet -----
const sheet = document.getElementById('sheet');
const sheetBg = document.getElementById('sheetBg');

function buildSheet() {
  // Sets
  const setsEl = document.getElementById('optsSet');
  setsEl.innerHTML = SET_ORDER.filter(s => CARDS.some(c => c.set === s))
    .map(s => `<button class="opt" data-set="${s}">${SET_NAMES[s] || s} <span style="color:var(--fg2);font-family:monospace;font-size:11px;">${s}</span></button>`).join('');
  setsEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const s = b.dataset.set;
      if (filters.sets.has(s)) filters.sets.delete(s); else filters.sets.add(s);
      b.classList.toggle('on');
    });
  });

  // Rarities
  const rEl = document.getElementById('optsRarity');
  rEl.innerHTML = RARITIES.filter(r => CARDS.some(c => c.rarity === r))
    .map(r => `<button class="opt" data-rarity="${r}">${cap(r)}</button>`).join('');
  rEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const r = b.dataset.rarity;
      if (filters.rarities.has(r)) filters.rarities.delete(r); else filters.rarities.add(r);
      b.classList.toggle('on');
    });
  });

  // Colors
  document.querySelectorAll('#optsColor button').forEach(b => {
    b.addEventListener('click', () => {
      const c = b.dataset.color;
      if (filters.colors.has(c)) filters.colors.delete(c); else filters.colors.add(c);
      b.classList.toggle('on');
    });
  });

  // Status
  document.querySelectorAll('#optsStatus button').forEach(b => {
    b.addEventListener('click', () => {
      filters.status = b.dataset.status;
      document.querySelectorAll('#optsStatus button').forEach(x => x.classList.toggle('on', x === b));
      syncBottomTab();
    });
  });

  // Sort
  document.querySelectorAll('#optsSort button').forEach(b => {
    b.addEventListener('click', () => {
      filters.sort = b.dataset.sort;
      document.querySelectorAll('#optsSort button').forEach(x => x.classList.toggle('on', x === b));
    });
  });

  syncSheet();
}

function syncSheet() {
  document.querySelectorAll('#optsStatus button').forEach(b => b.classList.toggle('on', b.dataset.status === filters.status));
  document.querySelectorAll('#optsSet button').forEach(b => b.classList.toggle('on', filters.sets.has(b.dataset.set)));
  document.querySelectorAll('#optsRarity button').forEach(b => b.classList.toggle('on', filters.rarities.has(b.dataset.rarity)));
  document.querySelectorAll('#optsColor button').forEach(b => b.classList.toggle('on', filters.colors.has(b.dataset.color)));
  document.querySelectorAll('#optsSort button').forEach(b => b.classList.toggle('on', b.dataset.sort === filters.sort));
  syncBottomTab();
}

function showSheet(el) {
  el.classList.add('show');
  sheetBg.classList.add('show');
}
function hideSheets() {
  document.getElementById('sheet').classList.remove('show');
  document.getElementById('moreSheet').classList.remove('show');
  sheetBg.classList.remove('show');
}

document.getElementById('filterBtn').addEventListener('click', () => showSheet(sheet));
sheetBg.addEventListener('click', hideSheets);
document.getElementById('applyFilters').addEventListener('click', () => { hideSheets(); renderGrid(); });
document.getElementById('resetFilters').addEventListener('click', resetFilters);

function resetFilters() {
  filters.q = ''; document.getElementById('q').value = '';
  filters.status = 'any';
  filters.sets.clear(); filters.rarities.clear(); filters.colors.clear();
  filters.sort = 'set';
  syncSheet(); renderGrid();
}

// ----- Detail modal -----
const modal = document.getElementById('modal');
const modalBg = document.getElementById('modalBg');
const modalCard = document.getElementById('modalCard');

function openModal(card) {
  const e = getEntry(card.id);
  const showN = hasFinish(card, 'nonfoil');
  const showF = hasFinish(card, 'foil');
  const showE = hasFinish(card, 'etched');

  modalCard.innerHTML = `
    <div class="img-big"><img src="${card.image_normal || card.image_small || ''}" alt="${escapeHtml(card.name)}"></div>
    <div class="modal-body">
      <h2>${escapeHtml(card.name)}</h2>
      <div class="sub">${SET_NAMES[card.set] || card.set} (${card.set.toUpperCase()}) · #${card.collector_number} · ${cap(card.rarity)}${card.mana_cost ? ' · ' + escapeHtml(card.mana_cost) : ''}</div>
      ${showN ? row(card, 'n', e.n, 'Nonfoil') : ''}
      ${showF ? row(card, 'f', e.f, 'Foil', 'foil') : ''}
      ${showE ? row(card, 'e', e.e, 'Etched Foil', 'etched') : ''}
      <button class="wishlist-btn ${e.w ? 'on' : ''}" id="mWish">${e.w ? '★ On wishlist' : '☆ Add to wishlist'}</button>
      <button class="wishlist-btn" id="mExplain" style="background: var(--bg3); color: var(--accent);">✨ Explain this card</button>
      ${card.oracle_text ? `<div style="margin-top: 12px; padding: 10px; background: var(--bg3); border-radius: 8px; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(card.oracle_text)}</div>` : ''}
      ${card.flavor_text ? `<div style="margin-top: 8px; padding: 10px; font-size: 12px; color: var(--fg2); font-style: italic; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(card.flavor_text)}</div>` : ''}
      <textarea id="mNote" placeholder="Notes (condition, where bought, etc.)">${escapeHtml(e.note || '')}</textarea>
      <div class="links">
        ${card.scryfall_uri ? `<a href="${card.scryfall_uri}" target="_blank" rel="noopener">View on Scryfall ↗</a>` : ''}
      </div>
    </div>
  `;

  function row(c, key, val, label, cls = '') {
    return `<div class="row ${cls}">
      <div class="label ${cls}">${label}</div>
      <div class="qctrl">
        <button data-k="${key}" data-d="-1" aria-label="decrease">−</button>
        <span class="v" data-v="${key}">${val}</span>
        <button data-k="${key}" data-d="1" aria-label="increase">+</button>
      </div>
    </div>`;
  }

  modalCard.querySelectorAll('.qctrl button').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.k;
      const d = parseInt(b.dataset.d, 10);
      const cur = getEntry(card.id);
      const v = Math.max(0, (cur[k] || 0) + d);
      setEntry(card.id, { [k]: v });
      modalCard.querySelector(`.v[data-v="${k}"]`).textContent = v;
      refreshCardEl(card.id);
    });
  });

  const wishBtn = document.getElementById('mWish');
  wishBtn.addEventListener('click', () => {
    const cur = getEntry(card.id);
    setEntry(card.id, { w: !cur.w });
    const e2 = getEntry(card.id);
    wishBtn.classList.toggle('on', e2.w);
    wishBtn.textContent = e2.w ? '★ On wishlist' : '☆ Add to wishlist';
    refreshCardEl(card.id);
  });

  const noteEl = document.getElementById('mNote');
  noteEl.addEventListener('input', () => {
    setEntry(card.id, { note: noteEl.value });
  });

  document.getElementById('mExplain').addEventListener('click', () => openExplain(card));

  modal.classList.add('show');
  modalBg.classList.add('show');
}

function closeModal() {
  modal.classList.remove('show');
  modalBg.classList.remove('show');
}
modalBg.addEventListener('click', closeModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); hideSheets(); } });

// ----- Bottom tabs -----
function syncBottomTab() {
  const tabFor = filters.status === 'any' ? 'all'
    : filters.status === 'owned' ? 'owned'
    : filters.status === 'missing' ? 'missing'
    : filters.status === 'wishlist' ? 'wishlist'
    : null;
  document.querySelectorAll('.bb-btn[data-tab]').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tabFor);
  });
}
document.querySelectorAll('.bb-btn[data-tab]').forEach(b => {
  b.addEventListener('click', () => {
    const t = b.dataset.tab;
    filters.status = t === 'all' ? 'any' : t;
    syncSheet();
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ----- More sheet -----
const moreSheet = document.getElementById('moreSheet');
document.getElementById('moreBtn').addEventListener('click', () => showSheet(moreSheet));
document.getElementById('closeMore').addEventListener('click', hideSheets);

document.getElementById('toggleStats').addEventListener('click', () => {
  prefs.showStats = !prefs.showStats; savePrefs(); renderStats();
  toast(prefs.showStats ? 'Stats shown' : 'Stats hidden');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), collection }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mtg-avatar-collection-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Exported');
});

document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = data.collection || data;
    if (typeof incoming !== 'object') throw new Error('Bad format');
    const ok = confirm(`Import ${Object.keys(incoming).length} entries? This replaces the shared collection on the server.`);
    if (!ok) return;
    collection = incoming;
    saveCollectionCache();
    renderGrid();
    setSyncStatus('Uploading import…', false);
    try {
      await apiFetch('/api/collection', {
        method: 'PUT',
        body: JSON.stringify({ collection }),
      });
      toast('Import complete (synced)');
      setSyncStatus('Saved', false);
      setTimeout(hideSyncStatus, 1500);
    } catch (e) {
      toast('Imported locally — server sync failed: ' + e.message);
      setSyncStatus('Offline · changes local only', true);
    }
    hideSheets();
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
  ev.target.value = '';
});

document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm('Reset everything? This wipes the shared collection on the server. Cannot be undone.')) return;
  collection = {}; saveCollectionCache(); renderGrid();
  try {
    await apiFetch('/api/collection', { method: 'DELETE' });
    toast('Collection cleared');
  } catch (e) {
    toast('Cleared locally; server reset failed: ' + e.message);
  }
  hideSheets();
});

// ----- Search -----
let searchT;
document.getElementById('q').addEventListener('input', (e) => {
  clearTimeout(searchT);
  const v = e.target.value.toLowerCase().trim();
  searchT = setTimeout(() => { filters.q = v; renderGrid(); }, 120);
});

// ----- Toast -----
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1600);
}

// ============================================================
// Login screen
// ============================================================
function showLoginScreen(errMsg) {
  const screen = document.getElementById('loginScreen');
  const err = document.getElementById('loginError');
  err.textContent = errMsg || '';
  screen.classList.remove('hidden');
  // Focus password input
  setTimeout(() => document.getElementById('loginPwd').focus(), 50);
}
function hideLoginScreen() {
  document.getElementById('loginScreen').classList.add('hidden');
}

document.getElementById('loginSubmit').addEventListener('click', submitLogin);
document.getElementById('loginPwd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitLogin();
});

async function submitLogin() {
  const pwd = document.getElementById('loginPwd').value.trim();
  const err = document.getElementById('loginError');
  if (!pwd) { err.textContent = 'Enter the password.'; return; }
  err.textContent = '';
  document.getElementById('loginSubmit').disabled = true;
  try {
    const ok = await checkAuth(pwd);
    if (!ok) { err.textContent = 'Wrong password.'; return; }
    setPassword(pwd);
    hideLoginScreen();
    // Initial sync after login
    await syncFromServer();
  } catch (e) {
    err.textContent = 'Network error: ' + e.message;
  } finally {
    document.getElementById('loginSubmit').disabled = false;
    document.getElementById('loginPwd').value = '';
  }
}

// ============================================================
// Periodic background sync — picks up partner's changes.
// ============================================================
const SYNC_INTERVAL_MS = 30000;
let syncTimer = null;
function startBackgroundSync() {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && getPassword() && pendingPatches === 0) {
      syncFromServer();
    }
  }, SYNC_INTERVAL_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getPassword() && pendingPatches === 0) {
    syncFromServer();
  }
});

// ----- Boot -----
async function boot() {
  try {
    const r = await fetch('cards.json');
    CARDS = await r.json();
    buildSheet();
    renderGrid();
    document.getElementById('loading').style.display = 'none';

    // Auth gate
    if (!getPassword()) {
      showLoginScreen();
    } else {
      // Verify session and pull latest server state
      const ok = await checkAuth(getPassword());
      if (!ok) {
        clearPassword();
        showLoginScreen('Session expired. Please sign in again.');
      } else {
        await syncFromServer();
      }
    }
    startBackgroundSync();
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--red);padding:20px;text-align:center;">Failed to load cards.json<br><small>${escapeHtml(e.message)}</small></div>`;
  }
}
boot();

// ============================================================
// Settings (server-backed)
// ============================================================
const settingsSheet = document.getElementById('settingsSheet');
document.getElementById('settingsBtn').addEventListener('click', () => {
  hideSheets();
  document.getElementById('testResult').textContent = '';
  document.getElementById('lastSyncResult').textContent = lastServerSync
    ? 'Last sync: ' + lastServerSync.toLocaleTimeString()
    : '';
  showSheet(settingsSheet);
});
document.getElementById('closeSettings').addEventListener('click', hideSheets);

document.getElementById('testApiKey').addEventListener('click', async () => {
  const result = document.getElementById('testResult');
  result.textContent = 'Testing…';
  try {
    // Fire a tiny explain on a known card to verify the AI proxy works.
    const card = CARDS[0];
    const r = await apiFetch('/api/explain', {
      method: 'POST',
      body: JSON.stringify({ card, followup: 'Reply with the single word OK.' }),
    });
    const t = r.text || '';
    result.textContent = t.toLowerCase().includes('ok') ? '✓ working' : '⚠ unexpected: ' + t.slice(0, 40);
  } catch (e) {
    result.textContent = '✗ ' + e.message;
  }
});

document.getElementById('forceSync').addEventListener('click', async () => {
  const result = document.getElementById('lastSyncResult');
  result.textContent = 'Syncing…';
  const ok = await syncFromServer();
  result.textContent = ok
    ? 'Synced ' + new Date().toLocaleTimeString()
    : '✗ sync failed';
});

document.getElementById('signOut').addEventListener('click', () => {
  if (!confirm('Sign out? You will need to enter the password again.')) return;
  clearPassword();
  hideSheets();
  showLoginScreen();
});

// ============================================================
// Camera scan
// ============================================================
const scanScreen = document.getElementById('scanScreen');
const scanVideo = document.getElementById('scanVideo');
const scanCanvas = document.getElementById('scanCanvas');
const scanShoot = document.getElementById('scanShoot');
const scanResult = document.getElementById('scanResult');
const scanBusy = document.getElementById('scanBusy');
const scanBusyMsg = document.getElementById('scanBusyMsg');
const scanHint = document.getElementById('scanHint');
let scanStream = null;

document.getElementById('scanBtn').addEventListener('click', openScan);
document.getElementById('scanClose').addEventListener('click', closeScan);
scanShoot.addEventListener('click', captureAndIdentify);

async function openScan() {
  if (!getPassword()) {
    toast('Sign in first');
    showLoginScreen();
    return;
  }
  scanResult.classList.add('hidden');
  scanScreen.classList.remove('hidden');
  scanHint.textContent = 'Frame the card. Tap shutter to identify.';
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    scanVideo.srcObject = scanStream;
    await scanVideo.play();
  } catch (e) {
    closeScan();
    alert('Camera unavailable: ' + e.message + '\n\nThe camera requires HTTPS or localhost. If you opened this page from an IP address, deploy via GitHub Pages first.');
  }
}

function closeScan() {
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  scanVideo.srcObject = null;
  scanScreen.classList.add('hidden');
  scanResult.classList.add('hidden');
  scanBusy.classList.add('hidden');
}

function captureFrameAsJpeg(maxDim = 1280, quality = 0.85) {
  const v = scanVideo;
  if (!v.videoWidth) throw new Error('Camera not ready');
  const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * scale);
  const h = Math.round(v.videoHeight * scale);
  scanCanvas.width = w; scanCanvas.height = h;
  const ctx = scanCanvas.getContext('2d');
  ctx.drawImage(v, 0, 0, w, h);
  const dataUrl = scanCanvas.toDataURL('image/jpeg', quality);
  return dataUrl.split(',', 2)[1]; // base64 only
}

async function captureAndIdentify() {
  if (!getPassword()) { toast('Sign in first'); showLoginScreen(); return; }
  scanShoot.disabled = true;
  scanResult.classList.add('hidden');
  scanBusy.classList.remove('hidden');
  scanBusyMsg.textContent = 'Identifying…';
  try {
    const b64 = captureFrameAsJpeg();
    const ident = await identifyCard(b64);
    const matches = matchCard(ident);
    showScanResult(matches, ident);
  } catch (e) {
    showScanError(e.message);
  } finally {
    scanShoot.disabled = false;
    scanBusy.classList.add('hidden');
  }
}

async function identifyCard(imageB64) {
  const r = await apiFetch('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ imageBase64: imageB64, mimeType: 'image/jpeg' }),
  });
  return r.identification;
}

function matchCard(ident) {
  if (!ident) return [];
  const setCode = (ident.set_code || '').toLowerCase();
  const cn = String(ident.collector_number || '').replace(/^0+/, '');
  const name = (ident.name || '').toLowerCase().trim();

  // Exact set + collector number → unique
  if (setCode && cn) {
    const exact = CARDS.filter(c => c.set === setCode && String(c.collector_number).replace(/^0+/, '') === cn);
    if (exact.length) return exact;
  }

  // Name match — return all printings sorted by relevance to set hint
  if (name) {
    const candidates = CARDS.filter(c => c.name.toLowerCase() === name);
    if (candidates.length) {
      if (setCode) candidates.sort((a, b) => (a.set === setCode ? -1 : 1) - (b.set === setCode ? -1 : 1));
      return candidates.slice(0, 5);
    }

    // Fuzzy fallback — substring or close edit distance
    const fuzzy = CARDS
      .map(c => ({ c, score: nameScore(c.name.toLowerCase(), name) }))
      .filter(x => x.score > 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.c);
    return fuzzy;
  }
  return [];
}

function nameScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  // Cheap similarity: longest common subseq ratio approximation
  const al = a.length, bl = b.length;
  let common = 0;
  let i = 0, j = 0;
  while (i < al && j < bl) {
    if (a[i] === b[j]) { common++; i++; j++; }
    else if (al - i > bl - j) i++; else j++;
  }
  return common / Math.max(al, bl);
}

function showScanError(msg) {
  scanResult.classList.remove('hidden');
  scanResult.classList.add('error');
  scanResult.innerHTML = `
    <h4 style="color:#ffaaaa;">Error</h4>
    <div style="font-size: 13px;">${escapeHtml(msg)}</div>
    <div class="actions"><button id="srDismiss">Dismiss</button></div>
  `;
  document.getElementById('srDismiss').addEventListener('click', () => {
    scanResult.classList.add('hidden'); scanResult.classList.remove('error');
  });
}

function showScanResult(matches, ident) {
  scanResult.classList.remove('hidden');
  scanResult.classList.remove('error');

  if (!matches.length) {
    const dump = ident ? `<div style="font-size:11px;color:var(--fg2);margin-top:6px;">Read: <code>${escapeHtml(ident.name||'?')}</code> ${ident.set_code||'?'} #${ident.collector_number||'?'}</div>` : '';
    scanResult.innerHTML = `
      <h4>No match found</h4>
      <div style="font-size: 13px;">Could not match this card to the Avatar set.</div>
      ${dump}
      <div class="actions">
        <button id="srRetry">Retry</button>
        <button id="srDismiss">Dismiss</button>
      </div>
    `;
    document.getElementById('srRetry').addEventListener('click', () => { scanResult.classList.add('hidden'); });
    document.getElementById('srDismiss').addEventListener('click', () => { scanResult.classList.add('hidden'); });
    return;
  }

  const conf = ident.confidence || 'medium';
  const isFoil = document.getElementById('scanFoil').checked;
  const isEtched = document.getElementById('scanEtched').checked;
  const finishKey = isEtched ? 'e' : isFoil ? 'f' : 'n';
  const finishLabel = isEtched ? 'Etched' : isFoil ? 'Foil' : 'Nonfoil';

  const html = matches.map((c) => {
    const e = getEntry(c.id);
    const cur = e[finishKey] || 0;
    return `
      <div class="match" data-id="${c.id}">
        <img src="${c.image_small || ''}" alt="">
        <div class="info">
          <div class="nm">${escapeHtml(c.name)}</div>
          <div class="meta-line">${c.set.toUpperCase()} · #${c.collector_number} · ${cap(c.rarity)}</div>
          <div class="meta-line" style="color:var(--accent);">+1 ${finishLabel} → ${cur + 1}</div>
        </div>
        <button class="add" data-id="${c.id}">+1</button>
      </div>
    `;
  }).join('');

  scanResult.innerHTML = `
    <h4>${matches.length === 1 ? 'Match' : 'Top matches'} · confidence ${conf}</h4>
    ${html}
    <div class="actions">
      <button id="srRetry">Retry scan</button>
      <button id="srDismiss">Dismiss</button>
    </div>
  `;

  scanResult.querySelectorAll('button.add').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      const card = CARDS.find(c => c.id === id);
      if (!card) return;
      // Validate finish exists; if foil clicked but card has no foil, fall back to nonfoil
      let key = finishKey;
      if (key === 'f' && !hasFinish(card, 'foil')) key = 'n';
      if (key === 'e' && !hasFinish(card, 'etched')) key = hasFinish(card, 'foil') ? 'f' : 'n';
      const cur = getEntry(id);
      setEntry(id, { [key]: (cur[key] || 0) + 1 });
      refreshCardEl(id);
      toast(`+1 ${key === 'n' ? 'NF' : key === 'f' ? 'Foil' : 'Etched'}: ${card.name}`);
      const keepOpen = document.getElementById('scanRapid').checked;
      if (keepOpen) {
        scanResult.classList.add('hidden');
      } else {
        closeScan();
      }
    });
  });
  document.getElementById('srRetry').addEventListener('click', () => { scanResult.classList.add('hidden'); });
  document.getElementById('srDismiss').addEventListener('click', () => { scanResult.classList.add('hidden'); });
}

// ============================================================
// Explain this card
// ============================================================
const explainModal = document.getElementById('explainModal');
const explainBg = document.getElementById('explainBg');
const explainTitle = document.getElementById('explainTitle');
const explainSub = document.getElementById('explainSub');
const explainBody = document.getElementById('explainBody');
let lastExplainCard = null;

function openExplain(card) {
  if (!getPassword()) { toast('Sign in first'); showLoginScreen(); return; }
  lastExplainCard = card;
  explainTitle.textContent = card.name;
  explainSub.textContent = `${SET_NAMES[card.set] || card.set} (${card.set.toUpperCase()}) · #${card.collector_number} · ${cap(card.rarity)}`;
  explainBody.textContent = 'Asking Gemini…';
  explainModal.classList.add('show');
  explainBg.classList.add('show');

  apiFetch('/api/explain', {
    method: 'POST',
    body: JSON.stringify({ card }),
  }).then(r => {
    explainBody.textContent = r.text || '(empty response)';
  }).catch(e => {
    explainBody.textContent = 'Error: ' + e.message;
  });
}

document.getElementById('explainClose').addEventListener('click', () => {
  explainModal.classList.remove('show');
  explainBg.classList.remove('show');
});
explainBg.addEventListener('click', () => {
  explainModal.classList.remove('show');
  explainBg.classList.remove('show');
});
document.getElementById('explainAsk').addEventListener('click', async () => {
  if (!lastExplainCard) return;
  const q = window.prompt('Ask a follow-up about ' + lastExplainCard.name + ':');
  if (!q) return;
  const card = lastExplainCard;
  const previous = explainBody.textContent;
  explainBody.textContent = previous + '\n\n— You: ' + q + '\n— Gemini: …';
  try {
    const r = await apiFetch('/api/explain', {
      method: 'POST',
      body: JSON.stringify({ card, followup: q }),
    });
    explainBody.textContent = previous + '\n\n— You: ' + q + '\n— Gemini: ' + (r.text || '');
  } catch (e) {
    explainBody.textContent = previous + '\n\nError: ' + e.message;
  }
});

// ============================================================
// Live conversation mode (Gemini Live API via /api/live WebSocket relay)
// ============================================================
const LIVE_MODEL = 'models/gemini-3.1-flash-live-preview';
const liveScreen = document.getElementById('liveScreen');
const liveVideo = document.getElementById('liveVideo');
const liveCanvas = document.getElementById('liveCanvas');
const liveStatus = document.getElementById('liveStatus');
const liveTranscript = document.getElementById('liveTranscript');
const liveMicBar = document.getElementById('liveMicBar');
const liveCameraToggle = document.getElementById('liveCamera');
const liveMicToggle = document.getElementById('liveMic');

let liveWs = null;
let liveStream = null;
let liveAudioCtx = null;        // 16kHz capture context
let liveSource = null;
let liveProcessor = null;
let livePlayCtx = null;         // 24kHz playback context
let livePlayNext = 0;
let liveVideoTimer = null;
let liveTranscriptCarry = { you: '', gemini: '' };

document.getElementById('liveBtn').addEventListener('click', startLive);
document.getElementById('liveClose').addEventListener('click', stopLive);
document.getElementById('liveEnd').addEventListener('click', stopLive);

liveMicToggle.addEventListener('change', () => {
  if (!liveStream) return;
  liveStream.getAudioTracks().forEach(t => t.enabled = liveMicToggle.checked);
});
liveCameraToggle.addEventListener('change', () => {
  if (!liveStream) return;
  liveStream.getVideoTracks().forEach(t => t.enabled = liveCameraToggle.checked);
  liveScreen.classList.toggle('no-video', !liveCameraToggle.checked);
});

async function startLive() {
  if (!getPassword()) { toast('Sign in first'); showLoginScreen(); return; }
  if (liveWs) return;

  liveScreen.classList.remove('hidden');
  liveScreen.classList.remove('no-video');
  setLiveStatus('Requesting camera + mic…', '');
  liveTranscript.innerHTML = '';
  liveTranscriptCarry = { you: '', gemini: '' };

  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    setLiveStatus('Camera/mic denied: ' + e.message, 'error');
    return;
  }
  liveVideo.srcObject = liveStream;
  await liveVideo.play().catch(() => {});

  // Open WebSocket to our /api/live relay
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/api/live?pwd=${encodeURIComponent(getPassword())}`;
  setLiveStatus('Connecting…', '');
  try {
    liveWs = new WebSocket(wsUrl);
  } catch (e) {
    setLiveStatus('WebSocket failed: ' + e.message, 'error');
    return;
  }
  liveWs.binaryType = 'arraybuffer';

  liveWs.addEventListener('open', () => {
    sendSetup();
    startMicCapture();
    startVideoFrames();
    setLiveStatus('Live · talking', 'live');
  });
  liveWs.addEventListener('message', onLiveMessage);
  liveWs.addEventListener('close', (ev) => {
    setLiveStatus(`Closed (${ev.code}) ${ev.reason || ''}`.trim(), ev.code === 1000 ? '' : 'error');
    cleanupLive(false);
  });
  liveWs.addEventListener('error', () => {
    setLiveStatus('Connection error', 'error');
  });
}

function setLiveStatus(text, cls) {
  liveStatus.textContent = text;
  liveStatus.classList.remove('live', 'error');
  if (cls) liveStatus.classList.add(cls);
}

function sendSetup() {
  const summary = collectionSummary();
  const sys = `You are a helpful conversational assistant inside a Magic: The Gathering collection-tracking app for the Avatar: The Last Airbender Universes Beyond release.

The user's collection right now: ${summary}.

You can use these tools to help the user:
- find_card(query): search the 937-card catalog by name. Use this BEFORE add_card so you have the right card_id.
- add_card(card_id, finish, count): increment a card in the user's collection. finish is "nonfoil" / "foil" / "etched". count defaults to 1.
- set_wishlist(card_id, on): toggle wishlist for a card.
- get_collection_summary(): get current totals and per-set completion.

When the user shows you a card on camera and says they want to add it, identify it visually, call find_card to get the card_id, confirm the result with the user, then call add_card. Be concise — this is a voice conversation.

If the user asks open questions about their collection ("do I have any blue cards?", "what's a good deck for…"), answer using your knowledge of MTG and what tools tell you.`;

  liveWs.send(JSON.stringify({
    setup: {
      model: LIVE_MODEL,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
        },
      },
      systemInstruction: { parts: [{ text: sys }] },
      tools: [{
        functionDeclarations: [
          {
            name: 'find_card',
            description: 'Search the Avatar set catalog by card name. Returns up to 5 matches with their IDs.',
            parameters: {
              type: 'OBJECT',
              properties: { query: { type: 'STRING', description: 'Card name or partial name' } },
              required: ['query'],
            },
          },
          {
            name: 'add_card',
            description: "Increment a card in the user's collection.",
            parameters: {
              type: 'OBJECT',
              properties: {
                card_id: { type: 'STRING', description: 'Scryfall ID returned from find_card' },
                finish: { type: 'STRING', description: '"nonfoil", "foil", or "etched". Default nonfoil.' },
                count: { type: 'NUMBER', description: 'How many to add. Default 1.' },
              },
              required: ['card_id'],
            },
          },
          {
            name: 'set_wishlist',
            description: 'Set or unset wishlist flag on a card.',
            parameters: {
              type: 'OBJECT',
              properties: {
                card_id: { type: 'STRING' },
                on: { type: 'BOOLEAN' },
              },
              required: ['card_id', 'on'],
            },
          },
          {
            name: 'get_collection_summary',
            description: 'Return totals and per-set completion percentages.',
            parameters: { type: 'OBJECT', properties: {} },
          },
        ],
      }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }));
}

function collectionSummary() {
  let owned = 0, total = 0, foils = 0;
  for (const c of CARDS) {
    const e = getEntry(c.id);
    const has = e.n + e.f + e.e;
    if (has) owned++;
    total += has;
    foils += e.f + e.e;
  }
  return `${owned} unique printings owned out of ${CARDS.length}, ${total} cards total (${foils} foil)`;
}

// --- Mic capture: 16kHz PCM little-endian → base64 → realtimeInput ---
function startMicCapture() {
  liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  liveSource = liveAudioCtx.createMediaStreamSource(liveStream);
  // ScriptProcessorNode is deprecated but universally supported. Fine for MVP.
  liveProcessor = liveAudioCtx.createScriptProcessor(4096, 1, 1);
  liveProcessor.onaudioprocess = (ev) => {
    if (!liveWs || liveWs.readyState !== 1) return;
    const f32 = ev.inputBuffer.getChannelData(0);

    // Resample if AudioContext didn't honor 16kHz
    let out = f32;
    if (liveAudioCtx.sampleRate !== 16000) {
      out = downsample(f32, liveAudioCtx.sampleRate, 16000);
    }

    // Mic level for the meter
    let peak = 0;
    for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
    liveMicBar.style.width = Math.min(100, peak * 250) + '%';

    const i16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const v = Math.max(-1, Math.min(1, out[i]));
      i16[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
    }
    const b64 = bytesToBase64(new Uint8Array(i16.buffer));
    liveWs.send(JSON.stringify({
      realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } },
    }));
  };
  liveSource.connect(liveProcessor);
  liveProcessor.connect(liveAudioCtx.destination);
}

function downsample(f32, fromRate, toRate) {
  if (fromRate === toRate) return f32;
  const ratio = fromRate / toRate;
  const len = Math.floor(f32.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx), hi = Math.min(lo + 1, f32.length - 1);
    const frac = idx - lo;
    out[i] = f32[lo] * (1 - frac) + f32[hi] * frac;
  }
  return out;
}

// --- Camera frames: 1 FPS, JPEG, base64 ---
function startVideoFrames() {
  liveVideoTimer = setInterval(() => {
    if (!liveWs || liveWs.readyState !== 1) return;
    if (!liveCameraToggle.checked) return;
    if (!liveVideo.videoWidth) return;
    const W = 640, H = Math.round(liveVideo.videoHeight * 640 / liveVideo.videoWidth);
    liveCanvas.width = W; liveCanvas.height = H;
    const ctx = liveCanvas.getContext('2d');
    ctx.drawImage(liveVideo, 0, 0, W, H);
    const dataUrl = liveCanvas.toDataURL('image/jpeg', 0.7);
    const b64 = dataUrl.split(',', 2)[1];
    liveWs.send(JSON.stringify({
      realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } },
    }));
  }, 1000);
}

// --- Audio playback: receive 24kHz PCM and queue ---
function ensurePlayCtx() {
  if (!livePlayCtx) {
    livePlayCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    livePlayNext = livePlayCtx.currentTime;
  }
  // Some browsers require a user gesture; click-triggered start handles that.
  if (livePlayCtx.state === 'suspended') livePlayCtx.resume();
  return livePlayCtx;
}

function playPcm(int16) {
  const ctx = ensurePlayCtx();
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
  const buf = ctx.createBuffer(1, f32.length, 24000);
  buf.getChannelData(0).set(f32);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const now = ctx.currentTime;
  const startAt = Math.max(now, livePlayNext);
  src.start(startAt);
  livePlayNext = startAt + f32.length / 24000;
}

// --- Incoming messages ---
async function onLiveMessage(ev) {
  const text = ev.data instanceof ArrayBuffer
    ? new TextDecoder().decode(ev.data)
    : (ev.data instanceof Blob ? await ev.data.text() : ev.data);
  let msg;
  try { msg = JSON.parse(text); } catch { return; }

  if (msg.relay_error) {
    setLiveStatus('Relay error', 'error');
    appendTranscriptInfo('Relay error: ' + msg.relay_error);
    return;
  }
  if (msg.setupComplete) {
    return;
  }
  if (msg.serverContent) {
    const sc = msg.serverContent;
    if (sc.modelTurn?.parts) {
      for (const p of sc.modelTurn.parts) {
        if (p.inlineData?.mimeType?.startsWith('audio/pcm')) {
          const bytes = base64ToBytes(p.inlineData.data);
          const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
          playPcm(i16);
        }
        if (p.text) appendTranscriptStream('gemini', p.text);
      }
    }
    if (sc.outputTranscription?.text) {
      appendTranscriptStream('gemini', sc.outputTranscription.text);
    }
    if (sc.inputTranscription?.text) {
      appendTranscriptStream('you', sc.inputTranscription.text);
    }
    if (sc.turnComplete) flushTranscript();
  }
  if (msg.toolCall) {
    handleLiveToolCall(msg.toolCall);
  }
}

function appendTranscriptStream(who, delta) {
  // Streaming deltas: accumulate, render the running line.
  liveTranscriptCarry[who] += delta;
  let line = liveTranscript.querySelector(`.turn.${who}.streaming`);
  if (!line) {
    line = document.createElement('div');
    line.className = `turn ${who} streaming`;
    line.innerHTML = `<span class="who">${who === 'you' ? 'You' : 'Gemini'}:</span><span class="txt"></span>`;
    liveTranscript.appendChild(line);
  }
  line.querySelector('.txt').textContent = liveTranscriptCarry[who];
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function flushTranscript() {
  liveTranscript.querySelectorAll('.turn.streaming').forEach(el => el.classList.remove('streaming'));
  liveTranscriptCarry = { you: '', gemini: '' };
}

function appendTranscriptInfo(text) {
  const el = document.createElement('div');
  el.className = 'turn tool';
  el.textContent = text;
  liveTranscript.appendChild(el);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

// --- Tool calls from Gemini ---
function handleLiveToolCall(tc) {
  const responses = [];
  for (const call of (tc.functionCalls || [])) {
    let result;
    try {
      result = executeLiveTool(call.name, call.args || {});
    } catch (e) {
      result = { error: e.message };
    }
    appendTranscriptInfo(`tool: ${call.name}(${JSON.stringify(call.args || {})}) → ${truncate(JSON.stringify(result), 80)}`);
    responses.push({ name: call.name, id: call.id, response: { result } });
  }
  if (liveWs && liveWs.readyState === 1) {
    liveWs.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }
}

function executeLiveTool(name, args) {
  switch (name) {
    case 'find_card': {
      const q = String(args.query || '').toLowerCase().trim();
      if (!q) return { matches: [] };
      const exact = CARDS.filter(c => c.name.toLowerCase() === q);
      const partial = CARDS.filter(c => c.name.toLowerCase() !== q && c.name.toLowerCase().includes(q));
      const list = [...exact, ...partial].slice(0, 6);
      return {
        matches: list.map(c => {
          const e = getEntry(c.id);
          return {
            card_id: c.id,
            name: c.name,
            set: c.set.toUpperCase(),
            collector_number: c.collector_number,
            rarity: c.rarity,
            mana_cost: c.mana_cost || null,
            type_line: c.type_line || null,
            owned: { nonfoil: e.n, foil: e.f, etched: e.e, wishlist: e.w },
          };
        }),
      };
    }
    case 'add_card': {
      const card = CARDS.find(c => c.id === args.card_id);
      if (!card) return { error: `No card with id ${args.card_id}` };
      const finish = args.finish || 'nonfoil';
      const key = finish === 'foil' ? 'f' : finish === 'etched' ? 'e' : 'n';
      const cur = getEntry(card.id);
      const inc = Math.max(1, Math.round(args.count || 1));
      setEntry(card.id, { [key]: (cur[key] || 0) + inc });
      refreshCardEl(card.id);
      const e = getEntry(card.id);
      return { ok: true, name: card.name, set: card.set.toUpperCase(), totals: { nonfoil: e.n, foil: e.f, etched: e.e } };
    }
    case 'set_wishlist': {
      const card = CARDS.find(c => c.id === args.card_id);
      if (!card) return { error: `No card with id ${args.card_id}` };
      setEntry(card.id, { w: !!args.on });
      refreshCardEl(card.id);
      return { ok: true, name: card.name, wishlist: !!args.on };
    }
    case 'get_collection_summary': {
      const result = { sets: {}, total_owned_unique: 0, total_cards: 0, total_foils: 0, wishlist: 0 };
      for (const s of SET_ORDER) {
        const inSet = CARDS.filter(c => c.set === s);
        const owned = inSet.filter(c => cardOwned(c.id)).length;
        if (inSet.length) result.sets[s] = { name: SET_NAMES[s] || s, owned, total: inSet.length, pct: Math.round(owned / inSet.length * 100) };
      }
      for (const c of CARDS) {
        const e = getEntry(c.id);
        if (e.n + e.f + e.e) result.total_owned_unique++;
        result.total_cards += e.n + e.f + e.e;
        result.total_foils += e.f + e.e;
        if (e.w) result.wishlist++;
      }
      return result;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stopLive() {
  if (liveWs) {
    try { liveWs.close(1000, 'user ended'); } catch {}
  }
  cleanupLive(true);
  liveScreen.classList.add('hidden');
}

function cleanupLive(closeWs) {
  if (closeWs && liveWs) { try { liveWs.close(); } catch {} }
  liveWs = null;

  if (liveProcessor) { try { liveProcessor.disconnect(); } catch {} liveProcessor = null; }
  if (liveSource) { try { liveSource.disconnect(); } catch {} liveSource = null; }
  if (liveAudioCtx) { try { liveAudioCtx.close(); } catch {} liveAudioCtx = null; }
  if (livePlayCtx) { try { livePlayCtx.close(); } catch {} livePlayCtx = null; livePlayNext = 0; }
  if (liveVideoTimer) { clearInterval(liveVideoTimer); liveVideoTimer = null; }

  if (liveStream) {
    liveStream.getTracks().forEach(t => t.stop());
    liveStream = null;
  }
  liveVideo.srcObject = null;
  liveMicBar.style.width = '0%';
}

// ----- PWA service worker -----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

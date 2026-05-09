// MTG Avatar Set Tracker
'use strict';

const STORAGE_KEY = 'mtg-avatar-collection-v1';
const PREFS_KEY = 'mtg-avatar-prefs-v1';

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
let collection = loadCollection();
let prefs = loadPrefs();

const filters = {
  q: '',
  status: 'any',     // any | owned | missing | wishlist | hasFoil | needFoil
  sets: new Set(),
  rarities: new Set(),
  colors: new Set(),
  sort: 'set',
};

// ----- Storage -----
function loadCollection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveCollection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || { showStats: true }; }
  catch { return { showStats: true }; }
}
function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function getEntry(id) {
  return collection[id] || { n: 0, f: 0, e: 0, w: false, note: '' };
}
function setEntry(id, updates) {
  const cur = getEntry(id);
  const next = { ...cur, ...updates };
  if (!next.n && !next.f && !next.e && !next.w && !next.note) {
    delete collection[id];
  } else {
    collection[id] = next;
  }
  saveCollection();
}

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
    const incoming = data.collection || data; // tolerate raw collection objects
    if (typeof incoming !== 'object') throw new Error('Bad format');
    const ok = confirm(`Import ${Object.keys(incoming).length} entries? This replaces your current collection.`);
    if (!ok) return;
    collection = incoming; saveCollection();
    renderGrid(); toast('Import complete');
    hideSheets();
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
  ev.target.value = '';
});

document.getElementById('clearAll').addEventListener('click', () => {
  if (!confirm('Reset everything? This deletes all your collection data and cannot be undone.')) return;
  collection = {}; saveCollection();
  renderGrid(); toast('Collection cleared'); hideSheets();
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

// ----- Boot -----
async function boot() {
  try {
    const r = await fetch('cards.json');
    CARDS = await r.json();
    buildSheet();
    renderGrid();
    document.getElementById('loading').style.display = 'none';
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--red);padding:20px;text-align:center;">Failed to load cards.json<br><small>${escapeHtml(e.message)}</small></div>`;
  }
}
boot();

// ============================================================
// Settings & Gemini API
// ============================================================
const SETTINGS_KEY = 'mtg-avatar-settings-v1';
let settings = loadSettings();

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return { apiKey: '', model: 'gemini-2.5-flash', ...s };
  } catch { return { apiKey: '', model: 'gemini-2.5-flash' }; }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function hasApiKey() { return !!(settings.apiKey || '').trim(); }

const settingsSheet = document.getElementById('settingsSheet');
document.getElementById('settingsBtn').addEventListener('click', () => {
  hideSheets();
  document.getElementById('apiKeyInput').value = settings.apiKey || '';
  document.getElementById('modelSelect').value = settings.model;
  document.getElementById('testResult').textContent = '';
  showSheet(settingsSheet);
});
document.getElementById('closeSettings').addEventListener('click', hideSheets);
document.getElementById('saveSettings').addEventListener('click', () => {
  settings.apiKey = document.getElementById('apiKeyInput').value.trim();
  settings.model = document.getElementById('modelSelect').value;
  saveSettings();
  hideSheets();
  toast(hasApiKey() ? 'Settings saved' : 'Saved (no API key set)');
});

document.getElementById('testApiKey').addEventListener('click', async () => {
  const result = document.getElementById('testResult');
  const key = document.getElementById('apiKeyInput').value.trim();
  const model = document.getElementById('modelSelect').value;
  if (!key) { result.textContent = '⚠ enter a key first'; return; }
  result.textContent = 'Testing…';
  try {
    const r = await geminiCall({ apiKey: key, model, prompt: 'Reply with the single word OK.' });
    result.textContent = (r || '').toLowerCase().includes('ok') ? '✓ working' : '⚠ unexpected: ' + r.slice(0, 40);
  } catch (e) {
    result.textContent = '✗ ' + e.message;
  }
});

async function geminiCall({ apiKey, model, prompt, imageBase64, imageMime, jsonMode }) {
  apiKey = apiKey || settings.apiKey;
  model = model || settings.model;
  if (!apiKey) throw new Error('No API key set');

  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: jsonMode ? { responseMimeType: 'application/json' } : {},
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
  return text;
}

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
  if (!hasApiKey()) {
    toast('Add a Gemini API key first (More → AI Settings)');
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
  if (!hasApiKey()) { toast('Set Gemini API key in Settings'); return; }
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

const IDENTIFY_PROMPT = `You are looking at a Magic: The Gathering card from the "Avatar: The Last Airbender" Universes Beyond release.

Read the card and return ONLY a JSON object with these keys:
- name: the card's printed title (string)
- set_code: the 3-4 letter set code shown at the bottom of the card. Possible values: "TLA", "TLE", "PTLA", "JTLA", "ATLA", "ATLE", "TTLA", "TTLE", "FTLA". Return uppercase. Use null if you can't read it.
- collector_number: the printed collector number from the bottom of the card (e.g. "0123/394" → return "123"). Just the number portion as a string, leading zeros stripped. Use null if unreadable.
- treatment: brief description of the card treatment if special (e.g., "borderless", "showcase", "extended art", "anime", "etched foil"), or null for standard.
- confidence: "high", "medium", or "low" — how confident you are.

Return only the JSON object, no markdown, no explanation.`;

async function identifyCard(imageB64) {
  const text = await geminiCall({
    prompt: IDENTIFY_PROMPT,
    imageBase64: imageB64,
    jsonMode: true,
  });
  // Tolerate markdown fences if Gemini ignores jsonMode
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('Could not parse model response: ' + text.slice(0, 100)); }
  return parsed;
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
  if (!hasApiKey()) {
    toast('Add a Gemini API key first (More → AI Settings)');
    return;
  }
  lastExplainCard = card;
  explainTitle.textContent = card.name;
  explainSub.textContent = `${SET_NAMES[card.set] || card.set} (${card.set.toUpperCase()}) · #${card.collector_number} · ${cap(card.rarity)}`;
  explainBody.textContent = 'Asking Gemini…';
  explainModal.classList.add('show');
  explainBg.classList.add('show');

  const prompt = explainPrompt(card);
  geminiCall({ prompt }).then(text => {
    explainBody.textContent = text || '(empty response)';
  }).catch(e => {
    explainBody.textContent = 'Error: ' + e.message;
  });
}

function explainPrompt(card) {
  const parts = [
    `Card name: ${card.name}`,
    `Type: ${card.type_line || '(unknown)'}`,
    card.mana_cost ? `Mana cost: ${card.mana_cost}` : null,
    card.power ? `Power/Toughness: ${card.power}/${card.toughness}` : null,
    card.loyalty ? `Loyalty: ${card.loyalty}` : null,
    `Rarity: ${card.rarity}`,
    `Set: ${card.set_name} (${card.set.toUpperCase()})`,
    card.oracle_text ? `\nRules text:\n${card.oracle_text}` : null,
    card.flavor_text ? `\nFlavor text:\n${card.flavor_text}` : null,
  ].filter(Boolean).join('\n');

  return `You are a Magic: The Gathering rules expert. Explain this card for a player who knows the basics of MTG. Cover:

1. **What it does** in plain English (1-2 sentences)
2. **Key interactions / rulings** if any
3. **Where it shines** — what kind of deck or situation
4. **Watch out for** — common mistakes or pitfalls

Keep it concise (under 200 words). Use markdown bold for the section headings exactly as shown above.

Card details:
${parts}`;
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
  const q = prompt('Ask a follow-up about ' + lastExplainCard.name + ':');
  if (!q) return;
  const card = lastExplainCard;
  const previous = explainBody.textContent;
  explainBody.textContent = previous + '\n\n— You: ' + q + '\n— Gemini: …';
  try {
    const reply = await geminiCall({
      prompt: `Card: ${card.name}\nRules text: ${card.oracle_text || '(none)'}\nType: ${card.type_line}\n\nUser follow-up question: ${q}\n\nAnswer concisely. Use markdown.`,
    });
    explainBody.textContent = previous + '\n\n— You: ' + q + '\n— Gemini: ' + reply;
  } catch (e) {
    explainBody.textContent = previous + '\n\nError: ' + e.message;
  }
});

// ----- PWA service worker -----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

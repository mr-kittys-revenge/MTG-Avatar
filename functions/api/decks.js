// Saved decks — stored as a single JSON document in KV under key "decks".
// Shape: { [deckId]: { id, name, format, commander_id, vibe, cards, strategy, created_at, updated_at } }
//
// Endpoints:
//   GET    /api/decks         → { decks: { ... } }
//   POST   /api/decks         → save / create / update one deck. Body: { deck }
//   DELETE /api/decks?id=X    → remove one deck

const KEY = 'decks';

async function loadAll(env) {
  return (await env.COLLECTION.get(KEY, { type: 'json' })) || {};
}
async function saveAll(env, data) {
  await env.COLLECTION.put(KEY, JSON.stringify(data));
}

function sanitizeDeck(d) {
  if (!d || typeof d !== 'object') return null;
  const cards = Array.isArray(d.cards) ? d.cards.slice(0, 200).map(c => ({
    card_id: typeof c.card_id === 'string' ? c.card_id : null,
    name: typeof c.name === 'string' ? c.name.slice(0, 200) : '',
    set: typeof c.set === 'string' ? c.set.slice(0, 8).toLowerCase() : '',
    collector_number: typeof c.collector_number === 'string' ? c.collector_number.slice(0, 12) : '',
    count: Math.max(1, Math.min(99, parseInt(c.count) || 1)),
    role: typeof c.role === 'string' ? c.role.slice(0, 32) : '',
    reason: typeof c.reason === 'string' ? c.reason.slice(0, 300) : '',
    is_basic_land: !!c.is_basic_land,
  })) : [];
  return {
    id: typeof d.id === 'string' ? d.id.slice(0, 64) : crypto.randomUUID(),
    name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'Untitled deck',
    format: ['commander', 'casual60'].includes(d.format) ? d.format : 'commander',
    commander_id: typeof d.commander_id === 'string' ? d.commander_id : null,
    vibe: typeof d.vibe === 'string' ? d.vibe.slice(0, 40) : '',
    theme: typeof d.theme === 'string' ? d.theme.slice(0, 200) : '',
    cards,
    strategy: typeof d.strategy === 'string' ? d.strategy.slice(0, 4000) : '',
    created_at: typeof d.created_at === 'string' ? d.created_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function onRequestGet({ env }) {
  const decks = await loadAll(env);
  return json({ decks });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const clean = sanitizeDeck(body?.deck);
  if (!clean) return json({ error: 'invalid deck' }, 400);
  const all = await loadAll(env);
  all[clean.id] = clean;
  await saveAll(env, all);
  return json({ ok: true, deck: clean });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'no id' }, 400);
  const all = await loadAll(env);
  delete all[id];
  await saveAll(env, all);
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// Shared collection state stored as a single JSON document in KV.
//
// Bindings expected on the Pages project:
//   COLLECTION  →  KV namespace
//
//   GET   /api/collection                 → { collection, version }
//   PUT   /api/collection { collection }  → { ok, version }            (full replace)
//   PATCH /api/collection { id, entry }   → { ok, version, entry }     (single card)
//   DELETE /api/collection                → { ok, version }            (clear all)

const KEY = 'collection';
const META = 'collection_meta';

async function loadAll(env) {
  const data = (await env.COLLECTION.get(KEY, { type: 'json' })) || {};
  const meta = (await env.COLLECTION.get(META, { type: 'json' })) || { version: 0, updatedAt: null };
  return { data, meta };
}

async function saveAll(env, data) {
  const meta = (await env.COLLECTION.get(META, { type: 'json' })) || { version: 0 };
  const next = { version: (meta.version || 0) + 1, updatedAt: new Date().toISOString() };
  await env.COLLECTION.put(KEY, JSON.stringify(data));
  await env.COLLECTION.put(META, JSON.stringify(next));
  return next;
}

function isEmptyEntry(e) {
  if (!e) return true;
  return !(e.n || e.f || e.e) && !e.w && !(e.note && e.note.trim());
}

function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    n: Math.max(0, parseInt(e.n) || 0),
    f: Math.max(0, parseInt(e.f) || 0),
    e: Math.max(0, parseInt(e.e) || 0),
    w: !!e.w,
    note: typeof e.note === 'string' ? e.note.slice(0, 500) : '',
  };
}

export async function onRequestGet({ env }) {
  const { data, meta } = await loadAll(env);
  return json({ collection: data, version: meta.version || 0, updatedAt: meta.updatedAt || null });
}

export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const incoming = body?.collection;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return json({ error: 'collection must be an object' }, 400);
  }
  const cleaned = {};
  for (const [id, e] of Object.entries(incoming)) {
    if (typeof id !== 'string') continue;
    const s = sanitizeEntry(e);
    if (s && !isEmptyEntry(s)) cleaned[id] = s;
  }
  const meta = await saveAll(env, cleaned);
  return json({ ok: true, version: meta.version });
}

export async function onRequestPatch({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { id, entry } = body || {};
  if (!id || typeof id !== 'string') return json({ error: 'no id' }, 400);

  const { data } = await loadAll(env);
  const sanitized = sanitizeEntry(entry);

  if (!sanitized || isEmptyEntry(sanitized)) {
    delete data[id];
  } else {
    data[id] = sanitized;
  }
  const meta = await saveAll(env, data);
  return json({ ok: true, version: meta.version, entry: data[id] || null });
}

export async function onRequestDelete({ env }) {
  const meta = await saveAll(env, {});
  return json({ ok: true, version: meta.version });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

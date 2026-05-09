// GET /api/export → returns the full server state (collection + decks + meta)
// as a single JSON blob, with a Content-Disposition header that prompts a
// download in browsers. Used both interactively and by the scheduled
// GitHub Actions backup workflow.

export async function onRequestGet({ env }) {
  const [collection, decks, meta] = await Promise.all([
    env.COLLECTION.get('collection', { type: 'json' }),
    env.COLLECTION.get('decks', { type: 'json' }),
    env.COLLECTION.get('collection_meta', { type: 'json' }),
  ]);
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    collection: collection || {},
    decks: decks || {},
    meta: meta || {},
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="mtg-avatar-backup-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

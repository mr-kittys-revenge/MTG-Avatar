// POST /api/auth  { password }  →  { ok: true }  or  401
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const { password } = body || {};
  if (!password || password !== env.SHARED_PASSWORD) {
    return json({ error: 'wrong password' }, 401);
  }
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

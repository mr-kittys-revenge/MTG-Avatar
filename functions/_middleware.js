// Runs on every request to /functions/* (i.e. /api/*).
// Verifies the shared password header on all API routes except /api/auth (login).

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Only guard /api/* — let static asset routes (Pages serves them) pass.
  if (!url.pathname.startsWith('/api/')) return next();

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  // Login endpoint is public (it's where you submit the password)
  if (url.pathname === '/api/auth') {
    const res = await next();
    return withCors(res, request);
  }

  // Live WebSocket route handles its own auth (via ?pwd= query param,
  // since browsers can't send custom headers on WebSocket upgrade).
  if (url.pathname === '/api/live') return next();

  // All other /api/* require valid shared password
  const provided = request.headers.get('X-App-Password');
  if (!provided || provided !== env.SHARED_PASSWORD) {
    return json({ error: 'unauthorized' }, 401, request);
  }

  // Rate limit Gemini-touching endpoints to protect the API key from
  // runaway loops. Naive per-minute global counter — fine for two users.
  const path = url.pathname;
  if (path === '/api/scan' || path === '/api/explain' || path === '/api/deck-build') {
    if (env.COLLECTION) {
      const minute = Math.floor(Date.now() / 60000);
      const key = `ratelimit:gemini:${minute}`;
      const cur = parseInt(await env.COLLECTION.get(key)) || 0;
      const limit = parseInt(env.GEMINI_RATE_LIMIT) || 60;
      if (cur >= limit) {
        return json({ error: `rate limit ${limit}/min exceeded — try again shortly` }, 429, request);
      }
      // Best-effort increment with TTL so the key cleans itself up.
      await env.COLLECTION.put(key, String(cur + 1), { expirationTtl: 120 });
    }
  }

  const res = await next();
  return withCors(res, request);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(res, request) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

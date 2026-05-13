// Runs on every request to /functions/* (i.e. /api/*).
// Verifies the shared password header on all API routes except /api/auth (login).

export async function onRequest(context) {
  try { return await handleRequest(context); }
  catch (e) {
    console.log('[middleware] unhandled:', e?.message, e?.stack);
    return new Response(
      JSON.stringify({ error: 'middleware crashed', detail: e?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleRequest(context) {
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

  // Rate limit Gemini-touching endpoints. Best-effort only — if the KV
  // write fails (e.g., the 1-write-per-second-per-key cap fires when
  // both devices burst at the same minute) we silently skip enforcement
  // rather than 500ing the whole request.
  const path = url.pathname;
  if (path === '/api/scan' || path === '/api/explain' || path === '/api/deck-build') {
    if (env.COLLECTION) {
      try {
        const minute = Math.floor(Date.now() / 60000);
        // Shard the counter key across a few buckets so concurrent writes
        // don't all land on the same KV key. We still get an approximate
        // global count by reading all shards.
        const shards = 4;
        const shard = Math.floor(Math.random() * shards);
        const limit = parseInt(env.GEMINI_RATE_LIMIT) || 60;

        // Quick aggregate read — counts across shards
        const reads = await Promise.all(
          Array.from({ length: shards }, (_, i) =>
            env.COLLECTION.get(`ratelimit:gemini:${minute}:${i}`).then(v => parseInt(v) || 0)
          )
        );
        const total = reads.reduce((a, b) => a + b, 0);
        if (total >= limit) {
          return json({ error: `rate limit ${limit}/min exceeded — try again shortly` }, 429, request);
        }

        // Increment our chosen shard. Wrapped in its own try so a per-key
        // write throttle doesn't break the request.
        const shardKey = `ratelimit:gemini:${minute}:${shard}`;
        const cur = reads[shard];
        env.COLLECTION.put(shardKey, String(cur + 1), { expirationTtl: 120 })
          .catch(() => { /* best-effort */ });
      } catch (e) {
        // Never block a request because of rate-limit machinery failing.
        console.log('[ratelimit] skipped:', e?.message);
      }
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

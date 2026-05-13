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

  // Rate limiting now relies on Gemini's own API quota as the ceiling.
  // We previously implemented a KV-backed per-minute counter here, but it
  // burned through the Cloudflare free-tier KV write budget (1k/day)
  // faster than it provided value. If you need true rate limiting later,
  // use Cloudflare's Workers Rate Limiting API or move to a paid plan
  // with Durable Objects.

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

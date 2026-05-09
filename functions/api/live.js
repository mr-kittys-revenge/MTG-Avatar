// WebSocket relay between the browser and Gemini Live API.
//
// The browser opens a WebSocket to /api/live?pwd=<shared-password>. This
// Worker validates the password, opens an outbound WebSocket to Gemini
// Live, and relays messages bidirectionally without parsing them.
//
// Auth via query param because browsers can't set custom headers on
// WebSocket upgrade requests. The middleware is configured to bypass
// /api/live so this handler does its own auth.

export async function onRequest(context) {
  const { request, env } = context;

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const url = new URL(request.url);
  const pwd = url.searchParams.get('pwd');
  if (!pwd || pwd !== env.SHARED_PASSWORD) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!env.GEMINI_API_KEY) {
    return new Response('server not configured: GEMINI_API_KEY missing', { status: 500 });
  }

  // Pair: `client` is returned to the browser; `server` is what we listen to.
  const pair = new WebSocketPair();
  const [clientSide, serverSide] = Object.values(pair);
  serverSide.accept();

  // Open outbound to Gemini Live.
  // NOTE: must use https:// not wss:// when calling fetch() from a Worker.
  // The `Upgrade: websocket` header is what tells Cloudflare to perform the WS handshake.
  const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  let upstream;
  try {
    const r = await fetch(geminiUrl, { headers: { Upgrade: 'websocket' } });

    if (r.status !== 101 || !r.webSocket) {
      // Try to read the body for a useful error message.
      let bodyText = '';
      try { bodyText = await r.text(); } catch {}
      const detail = `HTTP ${r.status} ${r.statusText || ''} ${bodyText}`.trim().slice(0, 500);
      console.log('[live] Gemini upgrade failed:', detail);
      // Send error to client BEFORE closing so it's visible.
      try { serverSide.send(JSON.stringify({ relay_error: 'Gemini upgrade failed: ' + detail })); } catch {}
      // Brief delay to let the message flush before close
      await new Promise(res => setTimeout(res, 50));
      serverSide.close(1011, 'Gemini upgrade failed');
      return new Response(null, { status: 101, webSocket: clientSide });
    }
    upstream = r.webSocket;
    upstream.accept();
  } catch (e) {
    console.log('[live] Gemini connect threw:', e?.message, e?.stack);
    try { serverSide.send(JSON.stringify({ relay_error: 'Gemini connect threw: ' + (e?.message || e) })); } catch {}
    await new Promise(res => setTimeout(res, 50));
    serverSide.close(1011, 'Gemini connect failed');
    return new Response(null, { status: 101, webSocket: clientSide });
  }

  // Relay client → upstream
  serverSide.addEventListener('message', (ev) => {
    try { upstream.send(ev.data); }
    catch (e) { /* upstream gone; close handler will fire */ }
  });

  // Relay upstream → client. Gemini may send Blob/ArrayBuffer; pass through.
  upstream.addEventListener('message', (ev) => {
    try { serverSide.send(ev.data); }
    catch (e) {}
  });

  // Mirror close in both directions.
  serverSide.addEventListener('close', (ev) => {
    try { upstream.close(safeCode(ev.code), ev.reason); } catch {}
  });
  upstream.addEventListener('close', (ev) => {
    try { serverSide.close(safeCode(ev.code), ev.reason); } catch {}
  });
  serverSide.addEventListener('error', () => { try { upstream.close(1011, 'client error'); } catch {} });
  upstream.addEventListener('error', () => { try { serverSide.close(1011, 'upstream error'); } catch {} });

  return new Response(null, { status: 101, webSocket: clientSide });
}

// WebSocket close codes have to be 1000 or 3000-4999 from a Worker.
function safeCode(c) {
  if (c === 1000) return 1000;
  if (c >= 3000 && c <= 4999) return c;
  return 1011;
}

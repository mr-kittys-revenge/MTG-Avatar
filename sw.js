// Service worker — caches app shell + card data for offline use.
// Card images are cached on demand from Scryfall CDN.
//
// IMPORTANT: bump VERSION any time the app shell or app.js changes substantially.
// Otherwise old clients keep serving the cached version forever.
const VERSION = 'v17';
const CORE = `mtg-avatar-core-${VERSION}`;
const IMAGES = `mtg-avatar-images-${VERSION}`;

const CORE_ASSETS = [
  './',
  'index.html',
  'app.js',
  'cards.json',
  'manifest.json',
  'icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CORE).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // NEVER cache API requests — they're authenticated, dynamic, and short-lived.
  // Same for WebSocket upgrades (the SW shouldn't intercept those anyway, but be safe).
  if (url.pathname.startsWith('/api/')) return;

  // Scryfall card images — cache on demand, serve from cache when offline
  if (url.hostname.endsWith('scryfall.io') || url.hostname.endsWith('scryfall.com')) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // App shell — network-first for HTML/JS so updates land fast,
  // cache-first for everything else.
  if (url.origin === location.origin) {
    const isShell = req.url.endsWith('/') || req.url.endsWith('index.html') ||
                    req.url.endsWith('app.js') || req.url.endsWith('manifest.json');

    if (isShell) {
      event.respondWith(
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CORE).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => caches.match(req))
      );
      return;
    }

    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok && CORE_ASSETS.some((a) => req.url.endsWith(a))) {
          const copy = res.clone();
          caches.open(CORE).then((cache) => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});

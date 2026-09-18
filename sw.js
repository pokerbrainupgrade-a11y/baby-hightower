// Service worker: versioned precache of the app shell, cache-first for the
// shell, network-first for firebase-config.js, stale-while-revalidate for the
// Firebase SDK. Bump VERSION (and APP_VERSION in js/config.js) on every deploy —
// the app shows an "Update ready" toast and reloads on tap.
const VERSION = '1.2.0';
const SHELL = `bh-shell-${VERSION}`;
const RUNTIME = 'bh-runtime';

// The navigation shell is cached under './' only: static hosts (npx serve,
// GitHub Pages) redirect /index.html → /, and iOS Safari refuses to serve a
// redirected response from a service worker for a navigation.
const SHELL_URL = './';
const ASSETS = [
  './', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/views.js', './js/store.js', './js/sync.js', './js/db.js', './js/dates.js', './js/config.js', './js/obcall.js',
  './data/seed.json', './data/resources.json',
  './fonts/fraunces.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(ASSETS.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
      await cache.put(url, await clean(res));
    }));
  })());
});

// Strip the `redirected` flag so a followed redirect can be served to a navigation.
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/firebase-config.js')) return e.respondWith(networkFirst(req));
    if (req.mode === 'navigate') return e.respondWith(shellFirst(req));
    return e.respondWith(cacheFirst(req));
  }
  if (url.hostname === 'www.gstatic.com') return e.respondWith(staleWhileRevalidate(req));
});

async function shellFirst(req) {
  const shell = await caches.open(SHELL);
  return (await shell.match(SHELL_URL)) || networkFirst(req);
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(RUNTIME)).put(req, await clean(res.clone()));
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const fetching = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await fetching) || Response.error();
}

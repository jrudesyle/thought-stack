/**
 * Service Worker for ThoughtStack PWA.
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS): cache-first with background update
 *   - API data requests: network-first with offline fallback (503 + offline flag)
 */

const CACHE_NAME = 'note-app-v1';

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install: pre-cache app shell ───────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // Some files may not exist yet during development — that's OK
      });
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// ── Activate: clean up old caches ──────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ── Fetch: route strategy based on request type ────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests: network-first with offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // App shell / static assets: cache-first with background update
  event.respondWith(cacheFirstStrategy(request));
});

// ── Cache-first strategy ───────────────────────────────────────────

async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Background update: fetch fresh copy and update cache
    const fetchPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network unavailable — cached version is fine
      });

    // Don't await — return cached immediately
    return cached;
  }

  // Not cached — fetch from network and cache
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, clone);
    }
    return response;
  } catch {
    // Offline and not cached — return a basic offline page for navigation
    if (request.mode === 'navigate') {
      const cachedIndex = await caches.match('/index.html');
      if (cachedIndex) return cachedIndex;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── Network-first strategy (for API requests) ─────────────────────

async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    // Network unavailable — return 503 with offline flag
    return new Response(
      JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline' }, offline: true }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

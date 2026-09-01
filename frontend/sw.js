/**
 * QAForge PWA Service Worker v2.0
 * ─────────────────────────────────
 * Features:
 *  • App Shell caching (cache-first for core assets)
 *  • Stale-while-revalidate for dynamic content
 *  • Network-first for API calls
 *  • Offline fallback page
 *  • Cache versioning & cleanup
 *  • Background sync support
 *  • Push notification readiness
 */

const CACHE_VERSION = 'v3';
const STATIC_CACHE  = `qaforge-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `qaforge-dynamic-${CACHE_VERSION}`;
const IMG_CACHE     = `qaforge-images-${CACHE_VERSION}`;

// Max items in dynamic cache to prevent unbounded growth
const DYNAMIC_CACHE_LIMIT = 80;
const IMG_CACHE_LIMIT = 60;

// ── App Shell: Critical resources to pre-cache ──────────────────────────────
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/blog.html',
  '/author.html',
  '/offline.html',
  '/css/app.css',
  '/js/app.js',
  '/manifest.json',
  '/assets/icon.svg',
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function trimCache(cacheName, maxItems) {
  caches.open(cacheName).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > maxItems) {
        cache.delete(keys[0]).then(() => trimCache(cacheName, maxItems));
      }
    });
  });
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

function isImageRequest(request) {
  const url = new URL(request.url);
  return request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/i.test(url.pathname);
}

function isAPIRequest(request) {
  return request.url.includes('/api/');
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return /\.(css|js|woff2?|ttf|eot)$/i.test(url.pathname);
}

function isGoogleFontsRequest(request) {
  return request.url.includes('fonts.googleapis.com') ||
    request.url.includes('fonts.gstatic.com');
}

// ── INSTALL: Pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing QAForge Service Worker v2...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching app shell...');
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log('[SW] App shell cached. Activating immediately.');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Pre-cache failed:', err);
      })
  );
});

// ── ACTIVATE: Clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating new Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => {
            // Delete any cache that doesn't match current version
            return name.startsWith('qaforge-') &&
              name !== STATIC_CACHE &&
              name !== DYNAMIC_CACHE &&
              name !== IMG_CACHE;
          })
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming all clients...');
      return self.clients.claim();
    })
  );
});

// ── FETCH: Stratified caching logic ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) return;

  // ─ Strategy 1: API calls → Network Only (with offline fallback) ─
  if (isAPIRequest(request)) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Return a graceful JSON error for API calls when offline
          return new Response(
            JSON.stringify({
              error: 'offline',
              message: 'You are currently offline. This feature requires an internet connection.'
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // ─ Strategy 2: Google Fonts → Cache First, then network ─
  if (isGoogleFontsRequest(request)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // ─ Strategy 3: Static assets (JS/CSS) → Cache First, update in BG ─
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  // ─ Strategy 4: Images → Cache First with limit ─
  if (isImageRequest(request)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(IMG_CACHE).then(cache => {
              cache.put(request, clone);
              trimCache(IMG_CACHE, IMG_CACHE_LIMIT);
            });
          }
          return response;
        }).catch(() => {
          // Return transparent pixel for failed images
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        });
      })
    );
    return;
  }

  // ─ Strategy 5: HTML Pages → Network First, fallback to cache, then offline ─
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            return cached || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // ─ Strategy 6: Everything else → Stale-While-Revalidate ─
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(request, clone);
            trimCache(DYNAMIC_CACHE, DYNAMIC_CACHE_LIMIT);
          });
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ── MESSAGE: Handle skip-waiting from update prompt ─────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting requested by client.');
    self.skipWaiting();
  }
});

// ── PUSH: Push notification handler (ready for future use) ──────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'QAForge';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/app.html'
    },
    actions: [
      { action: 'open', title: 'Open QAForge' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('qaforge') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data.url || '/app.html');
    })
  );
});

// سوق حمد service worker.
// Kept intentionally minimal: precache the app shell and fall back safely.

const CACHE_NAME = 'smartstore-shell-v2';
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = ['/', OFFLINE_URL];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // Never cache API or streaming responses.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (
            response.ok &&
            response.type === 'basic' &&
            (url.pathname.startsWith('/_next/static/') ||
              url.pathname.startsWith('/smartstore-') ||
              response.headers.get('content-type')?.startsWith('image/'))
          ) {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => undefined);
          }

          return response;
        })
        .catch(() => Response.error());
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title
      : 'سوق حمد';
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body
      : 'لديك تحديث جديد.';
  const url =
    typeof payload.url === 'string' && payload.url.startsWith('/')
      ? payload.url
      : '/';
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag
      : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon.png',
      badge: '/apple-icon.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client && client.url === targetUrl.href) {
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl.href);
        }

        return undefined;
      }),
  );
});

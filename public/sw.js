// سوق حمد service worker.
// Kept intentionally minimal: precache the app shell and fall back safely.

const CACHE_NAME = 'smartstore-shell-v4';
const OFFLINE_URL = '/offline';

const PRECACHE_URLS = ['/', OFFLINE_URL];

const OFFLINE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>لا يوجد اتصال</title>
    <style>
      html,body{height:100%;margin:0;background:#08111d;color:#eaf6ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      body{box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:24px}
      main{width:min(420px,100%);padding:28px 22px;text-align:center;background:linear-gradient(180deg,rgba(15,33,52,.94),rgba(8,17,29,.94));border:1px solid rgba(125,211,252,.28);border-radius:22px;box-shadow:0 18px 54px rgba(0,0,0,.32)}
      .icon{display:flex;align-items:center;justify-content:center;width:62px;height:62px;margin:0 auto 18px;font-size:30px;background:#0ea5e9;border-radius:20px}
      h1{margin:0 0 10px;font-size:24px;font-weight:800}
      p{margin:0 0 22px;color:#b8c7d9;font-size:15px;line-height:1.8}
      button{width:100%;padding:14px 16px;color:#fff;font-size:17px;font-weight:700;background:#1d64f2;border:0;border-radius:14px}
      .hint{margin-top:14px;color:#8aa0b7;font-size:13px}
    </style>
  </head>
  <body>
    <main>
      <div class="icon">!</div>
      <h1>لا يوجد اتصال بالإنترنت</h1>
      <p>تعذر تحميل سوق حمد الآن. تحقق من الاتصال ثم أعد المحاولة.</p>
      <button type="button" onclick="location.href='/'">إعادة المحاولة</button>
      <div class="hint">سيعود التطبيق عند توفر الاتصال.</div>
    </main>
  </body>
</html>`;

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              if (url === OFFLINE_URL) {
                return cache.put(OFFLINE_URL, offlineResponse());
              }

              return undefined;
            }),
          ),
        ),
      )
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.resolve()
      .then(() => self.registration.navigationPreload?.enable?.())
      .catch(() => undefined)
      .then(() => caches.keys())
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

  // Listing and profile images should go straight to the browser/network stack.
  // PWA-controlled cache reads can delay media on mobile even when normal
  // browser loads are fast, so keep the service worker focused on the shell.
  if (request.destination === 'image') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then((preloadResponse) => preloadResponse ?? fetch(request))
        .catch(() =>
          caches
            .match(OFFLINE_URL)
            .then((cached) => cached ?? offlineResponse()),
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
              url.pathname.startsWith('/smartstore-'))
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

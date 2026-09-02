// Examora Service Worker — Offline Support + Caching
const CACHE_VERSION = 'examos-v2.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const API_CACHE     = `${CACHE_VERSION}-api`;

// Files to cache immediately on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install: precache shell ───────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('examos-') && k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for assets ──────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API calls — network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful API responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => {
              cache.put(request, clone);
              // Limit cache size
              cache.keys().then(keys => {
                if (keys.length > 50) cache.delete(keys[0]);
              });
            });
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || offlineApiResponse(url.pathname)))
    );
    return;
  }

  // Static assets — cache first, then network
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2|ttf)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML navigation — network first, fallback to cached index
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request)
          .then(r => r || caches.match('/index.html'))
          .then(r => r || offlinePage())
      )
  );
});

// ── Offline API response ──────────────────────────────────────
function offlineApiResponse(pathname) {
  const body = JSON.stringify({
    error: 'You are offline. Please check your connection.',
    offline: true,
    pathname,
  });
  return new Response(body, {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Offline HTML page ─────────────────────────────────────────
function offlinePage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Examora — Offline</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0A0A0F; color:#F1F1F5; font-family:'Inter',sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100dvh; padding:24px; }
    .card { background:#111118; border:1px solid rgba(255,255,255,0.08); border-radius:20px;
            padding:40px 32px; text-align:center; max-width:360px; width:100%; }
    .logo { width:52px; height:52px; background:linear-gradient(135deg,#4F46E5,#818CF8);
            border-radius:14px; display:flex; align-items:center; justify-content:center;
            font-size:24px; font-weight:900; color:#fff; margin:0 auto 20px; }
    h1 { font-size:1.4rem; font-weight:800; margin-bottom:8px; }
    p  { font-size:13px; color:#9898AA; line-height:1.6; margin-bottom:24px; }
    .icon { font-size:48px; margin-bottom:20px; }
    button { background:#6366F1; color:#fff; border:none; border-radius:10px;
             padding:12px 24px; font-size:14px; font-weight:700; cursor:pointer;
             font-family:inherit; transition:background 0.15s; }
    button:hover { background:#4F46E5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <div class="logo">E</div>
    <h1>You're Offline</h1>
    <p>Examora needs an internet connection. Please check your network and try again.</p>
    <button onclick="window.location.reload()">Retry Connection</button>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Examora', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || 'examos-notification',
      data: data.url ? { url: data.url } : {},
      actions: data.actions || [],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(clientList => {
      const existing = clientList.find(c => c.url.includes(url) && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

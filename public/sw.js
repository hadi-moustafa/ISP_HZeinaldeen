// Lightweight app-shell cache -- not a full offline framework. Data comes
// from IndexedDB (see src/lib/offline), this just keeps the static assets
// (JS/CSS/index.html) available so the app can launch without a network.
const CACHE_NAME = 'isp-manager-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()))
          return response
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match(request))),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
            return response
          })
          .catch(() => cached)
        return cached || network
      }),
    )
  }
})

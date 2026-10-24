// Service Worker mínimo para suporte PWA (Fase 0)
const CACHE_NAME = 'sys-refeicoes-v2';
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Apenas responde com cache se estiver offline para ativos estáticos.
  // Conforme OFFLINE_STRATEGY.md, requisições de API/mutação nunca são mockadas offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SHOW_NOTIFICATION') return;

  const title = event.data.title || 'MA Refeições';
  const options = {
    body: event.data.body || 'Há uma nova atualização no seu acesso.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: event.data.tag || 'consumer-update',
    data: { url: event.data.url || '/consumer' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/consumer';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const openClient = clients.find((client) => client.url.includes('/consumer'));
        if (openClient) {
          openClient.navigate(targetUrl);
          return openClient.focus();
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});

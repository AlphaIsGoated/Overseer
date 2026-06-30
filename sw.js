// ============================================================
// Service worker for Overseer — handles Web Push notifications.
// Must live at the root so it can control the entire app scope.
// Does not use ES module syntax (classic scripts, not type:module)
// for maximum browser compatibility.
// ============================================================
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let payload = { title: "Shrey's Dashboard", body: 'Check in with your coach.' };
  try { if (e.data) payload = Object.assign(payload, JSON.parse(e.data.text())); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'overseer-reminder',
      renotify: false,
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

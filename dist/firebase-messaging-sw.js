/* Firebase Cloud Messaging Service Worker for SHINE CAB */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'INIT_FIREBASE_MESSAGING' && event.data.config) {
    if (!firebase.apps.length) {
      firebase.initializeApp(event.data.config);
      const messaging = firebase.messaging();
      messaging.onBackgroundMessage((payload) => {
        const title = payload.notification?.title || 'SHINE CAB';
        const options = {
          body: payload.notification?.body || '',
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          data: payload.data || {},
        };
        self.registration.showNotification(title, options);
      });
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.deep_link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_DEEP_LINK', url: targetUrl });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

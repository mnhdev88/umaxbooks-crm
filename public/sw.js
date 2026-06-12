// Noveliotech CRM service worker.
//
// Intentionally NO fetch/caching handlers: the CRM is auth-gated live data,
// and cached pages cause stale-lead / redirect-to-login bugs. This worker
// only exists for Web Push.

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Noveliotech CRM', body: event.data.text() }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/badge-96.png',
    tag: data.tag, // collapses duplicate notifications for the same event
    data: { url: data.url || '/notifications' },
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Noveliotech CRM', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus an open CRM tab if there is one, otherwise open a new window
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return clients.openWindow(url)
    })
  )
})

// Activate updated workers immediately instead of waiting for all tabs to close
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()))

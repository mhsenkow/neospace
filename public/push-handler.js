/**
 * Mastodon web-push handlers — imported into the vite-pwa Workbox SW.
 * Payload is encrypted by the browser; event.data.json() yields notification fields.
 */
/* eslint-disable no-undef */
self.addEventListener('push', (event) => {
  let title = 'NeoSpace'
  let body = 'New activity'
  let url = '/notifications'
  let tag = 'neo-activity'
  try {
    const data = event.data ? event.data.json() : null
    if (data) {
      if (typeof data.title === 'string' && data.title) title = data.title
      if (typeof data.body === 'string' && data.body) body = data.body
      else if (typeof data.message === 'string' && data.message) body = data.message
      if (typeof data.tag === 'string' && data.tag) tag = data.tag
      if (typeof data.access_token === 'string') {
        // Mastodon may include token — never surface it
      }
      const loc = data.notification_id || data.id
      if (loc) url = `/notifications#${encodeURIComponent(String(loc))}`
      else if (typeof data.url === 'string' && data.url.startsWith('/')) url = data.url
    }
  } catch {
    try {
      const text = event.data && event.data.text()
      if (text) body = text.slice(0, 180)
    } catch {
      /* keep defaults */
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target =
    (event.notification.data && event.notification.data.url) || '/notifications'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(target)
              return
            } catch {
              /* fall through */
            }
          }
          client.postMessage({ type: 'neo-push-navigate', url: target })
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target)
    })(),
  )
})

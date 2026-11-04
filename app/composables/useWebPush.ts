/**
 * Subscribe the active account to Mastodon web push (Activity alerts).
 * Requires OAuth `push` scope (already in SCOPES) and a registered service worker.
 */
import { useInstancesStore } from '~/stores/instances'

const STORAGE_KEY = 'neo-web-push-enabled'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function useWebPush() {
  const instances = useInstancesStore()
  const supported = useState('neo-web-push-supported', () => false)
  const enabled = useState('neo-web-push-enabled', () => false)
  const busy = useState('neo-web-push-busy', () => false)
  const error = useState<string | null>('neo-web-push-error', () => null)

  const refreshSupport = () => {
    if (!import.meta.client) return
    supported.value =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    try {
      enabled.value = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      enabled.value = false
    }
  }

  const fetchVapidKey = async (accountId: string): Promise<string | null> => {
    const client = instances.getClient(accountId)
    try {
      const info = await client.v2.instance.fetch()
      const key = info.configuration?.vapid?.publicKey
      if (key) return key
    } catch {
      /* fall through */
    }
    try {
      const existing = await client.v1.push.subscription.fetch()
      if (existing?.serverKey) return existing.serverKey
    } catch {
      /* none yet */
    }
    return null
  }

  const enable = async (): Promise<boolean> => {
    error.value = null
    if (!supported.value) {
      error.value = 'This browser doesn’t support push notifications'
      return false
    }
    const accountId = instances.activeAccountId
    if (!accountId || !instances.isAuthenticated) {
      error.value = 'Sign in to enable Activity push'
      return false
    }
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        error.value = 'Notification permission was denied'
        return false
      }
      const vapid = await fetchVapidKey(accountId)
      if (!vapid) {
        error.value = 'Couldn’t read this server’s push key'
        return false
      }
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
        })
      }
      const json = sub.toJSON()
      const endpoint = json.endpoint
      const p256dh = json.keys?.p256dh || bufferToBase64Url(sub.getKey('p256dh'))
      const auth = json.keys?.auth || bufferToBase64Url(sub.getKey('auth'))
      if (!endpoint || !p256dh || !auth) {
        error.value = 'Push subscription was incomplete'
        return false
      }
      const client = instances.getClient(accountId)
      await client.v1.push.subscription.create({
        subscription: {
          endpoint,
          keys: { p256dh, auth },
        },
        data: {
          alerts: {
            mention: true,
            follow: true,
            favourite: true,
            reblog: true,
            poll: true,
            status: true,
            update: true,
          },
        },
        policy: 'all',
      })
      enabled.value = true
      try {
        localStorage.setItem(STORAGE_KEY, '1')
      } catch {
        /* ignore */
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Couldn’t enable push'
      return false
    } finally {
      busy.value = false
    }
  }

  const disable = async (): Promise<boolean> => {
    error.value = null
    busy.value = true
    try {
      const accountId = instances.activeAccountId
      if (accountId && instances.isAuthenticated) {
        try {
          await instances.getClient(accountId).v1.push.subscription.remove()
        } catch {
          /* already gone */
        }
      }
      if (supported.value) {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
      enabled.value = false
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Couldn’t disable push'
      return false
    } finally {
      busy.value = false
    }
  }

  if (import.meta.client) {
    refreshSupport()
  }

  return { supported, enabled, busy, error, enable, disable, refreshSupport }
}

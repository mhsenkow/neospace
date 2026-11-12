/**
 * Capacitor ships a frozen webDir — a PWA service worker only causes stale shells
 * and bogus "Update ready" toasts. Unregister any SW the vite-pwa client may install.
 */
import { isNativeShell } from '~/utils/nativeShell'

export default defineNuxtPlugin({
  name: 'native-disable-sw',
  enforce: 'pre',
  async setup() {
    if (!isNativeShell() || !('serviceWorker' in navigator)) return

    const wipe = async () => {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    }

    await wipe()
    // vite-pwa may register after this plugin — clear again once the page settles
    window.setTimeout(() => {
      void wipe()
    }, 2500)
  },
})

/**
 * Clear one-shot SW rescue flag once the app mounts successfully,
 * and force-check for a newer service worker on foreground.
 */
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.removeItem('neospace_sw_rescue')
  } catch {
    /* private mode */
  }

  if (!('serviceWorker' in navigator)) return

  const ping = () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      void reg?.update()
    }).catch(() => {})
  }

  // Catch up after backgrounding (iOS PWA especially)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping()
  })
  window.addEventListener('focus', ping)
  ping()
})

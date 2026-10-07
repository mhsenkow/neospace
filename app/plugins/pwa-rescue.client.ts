/**
 * After a successful boot, allow another SW rescue only after the app has been
 * healthy for a while. Clearing the flag immediately caused wipe/reload loops
 * whenever any subsequent /_nuxt/ error fired.
 */
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  const CLEAR_AFTER_MS = 60_000
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem('neospace_sw_rescue')
    } catch {
      /* private mode */
    }
  }, CLEAR_AFTER_MS)

  if (!('serviceWorker' in navigator)) return

  const ping = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        void reg?.update()
      })
      .catch(() => {})
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping()
  })
  window.addEventListener('focus', ping)
  ping()
})

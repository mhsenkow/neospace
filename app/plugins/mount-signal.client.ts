/**
 * Signals a successful app mount to the /boot/rescue.js watchdog.
 *
 * Fires on the first `page:finish` — after the layout and page have set up and
 * rendered — not while plugins initialize. Signalling earlier switched the
 * watchdog off before layout/page setup ran, so a crash there left a blank
 * screen with no rescue.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (typeof window === 'undefined') return
  const signal = () => {
    try {
      const w = window as Window & { __neospaceMounted?: (() => void) | null }
      w.__neospaceMounted?.()
      w.__neospaceMounted = null
    } catch {
      /* ignore */
    }
  }
  const stop = nuxtApp.hook('page:finish', () => {
    signal()
    stop()
  })
})

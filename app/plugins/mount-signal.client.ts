/** Signals successful app mount to /boot/rescue.js watchdog. */
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return
  try {
    const w = window as Window & { __neospaceMounted?: (() => void) | null }
    w.__neospaceMounted?.()
    w.__neospaceMounted = null
  } catch {
    /* ignore */
  }
})

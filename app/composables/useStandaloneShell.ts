/**
 * Detect installed PWA / iOS home-screen mode and publish `html.neo-standalone`
 * so chrome can pad under the status bar (Safari-in-tab is fine; standalone isn’t).
 */

const STANDALONE_MQ =
  '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)'

function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.(STANDALONE_MQ).matches) return true
  } catch {
    /* ignore */
  }
  // Legacy iOS home-screen apps
  return !!(navigator as Navigator & { standalone?: boolean }).standalone
}

/** Call once from the app shell; keeps `html.neo-standalone` in sync. */
export function useStandaloneShell() {
  const isStandalone = ref(false)

  const sync = () => {
    const next = isStandaloneNow()
    isStandalone.value = next
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('neo-standalone', next)
    }
  }

  onMounted(() => {
    sync()
    const mq = window.matchMedia?.(STANDALONE_MQ)
    const onChange = () => sync()
    mq?.addEventListener?.('change', onChange)
    onScopeDispose(() => mq?.removeEventListener?.('change', onChange))
  })

  return { isStandalone }
}

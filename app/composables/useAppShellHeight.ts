/**
 * Keep the mobile shell sized to the *visible* viewport.
 * Android Chrome often reports dvh/svh larger than what's on screen while the
 * URL bar is showing, which clips the in-flow tab bar below the fold.
 */
export const useAppShellHeight = () => {
  if (!import.meta.client) return

  let raf = 0

  const sync = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const vv = window.visualViewport
      const vvH = vv?.height ?? Number.POSITIVE_INFINITY
      // Prefer the smaller measurement — oversized heights push the tab bar off-screen
      const h = Math.round(Math.min(vvH, window.innerHeight, document.documentElement.clientHeight))
      if (h > 0) {
        document.documentElement.style.setProperty('--neo-app-height', `${h}px`)
      }
    })
  }

  onMounted(() => {
    sync()
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
  })

  onUnmounted(() => {
    cancelAnimationFrame(raf)
    window.visualViewport?.removeEventListener('resize', sync)
    window.visualViewport?.removeEventListener('scroll', sync)
    window.removeEventListener('resize', sync)
    window.removeEventListener('orientationchange', sync)
  })
}

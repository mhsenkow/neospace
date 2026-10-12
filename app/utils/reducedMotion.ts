/** True when motion should be minimised: the OS preference or NeoSpace's own Reduce motion setting. */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) {
      return true
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

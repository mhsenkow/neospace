/**
 * Ref-counted body scroll lock.
 * Multiple overlays can lock; overflow only clears when the count hits 0.
 */

let lockCount = 0

function syncClass() {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('neo-scroll-lock', lockCount > 0)
}

function lock() {
  lockCount += 1
  syncClass()
}

function unlock() {
  if (lockCount <= 0) {
    lockCount = 0
    syncClass()
    return
  }
  lockCount -= 1
  syncClass()
}

export function useScrollLock() {
  return { lock, unlock }
}

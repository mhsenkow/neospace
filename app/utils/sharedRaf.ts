/** One requestAnimationFrame loop shared by canvas loaders (FunLoader, etc.). */

type FrameCb = (now: number) => void

const listeners = new Set<FrameCb>()
let rafId = 0

function loop(now: number) {
  rafId = 0
  for (const cb of listeners) {
    // One throwing loader must not stop the frame loop for every other loader
    try {
      cb(now)
    } catch (e) {
      if (import.meta.dev) console.warn('[sharedRaf] subscriber threw', e)
    }
  }
  if (listeners.size > 0 && !rafId) {
    rafId = requestAnimationFrame(loop)
  }
}

export function subscribeSharedRaf(cb: FrameCb): () => void {
  listeners.add(cb)
  if (!rafId) rafId = requestAnimationFrame(loop)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}

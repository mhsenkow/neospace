/**
 * Shared reduced-motion flag — OS `prefers-reduced-motion` OR the in-app
 * setting (`html.reduce-motion`, toggled by the settings store).
 * One matchMedia listener for the whole app; the settings store pushes the in-app flag
 * via `setInAppReducedMotion` (no MutationObserver on <html> class flips).
 */

import { readonly, ref, type Ref } from 'vue'

const REDUCED_MQ = '(prefers-reduced-motion: reduce)'

const reduced = ref(false)
let initialised = false

function read(mq: MediaQueryList) {
  return mq.matches || document.documentElement.classList.contains('reduce-motion')
}

function init() {
  if (initialised || typeof window === 'undefined') return
  initialised = true
  const mq = window.matchMedia(REDUCED_MQ)
  const sync = () => {
    const next = read(mq)
    if (reduced.value !== next) reduced.value = next
  }
  sync()
  mq.addEventListener?.('change', sync)
  syncReduced = sync
}

let syncReduced: (() => void) | null = null

/** The settings store calls this right after toggling `html.reduce-motion`. */
export function setInAppReducedMotion(on: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('reduce-motion', on)
  // Before init() the class is read on first use, so there is nothing to push yet
  syncReduced?.()
}

/** Reactive: true when motion should be minimised. Safe to call during SSR. */
export function usePrefersReducedMotion(): Readonly<Ref<boolean>> {
  init()
  return readonly(reduced)
}

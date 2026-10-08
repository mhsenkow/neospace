/**
 * Shared reduced-motion flag — OS `prefers-reduced-motion` OR the in-app
 * setting (`html.reduce-motion`, toggled by the settings store).
 * One matchMedia listener + one class observer for the whole app.
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
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(sync).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }
}

/** Reactive: true when motion should be minimised. Safe to call during SSR. */
export function usePrefersReducedMotion(): Readonly<Ref<boolean>> {
  init()
  return readonly(reduced)
}

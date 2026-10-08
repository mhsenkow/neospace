/**
 * Shared reactive viewport breakpoints — one matchMedia listener per query.
 */

const DESK_MQ = '(min-width: 1024px)'
const MOBILE_MQ = '(max-width: 1023px)'

function createMediaRef(query: string, defaultValue = false) {
  const matches = ref(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : defaultValue,
  )
  let listeners = 0
  let mq: MediaQueryList | null = null
  let onChange: ((e: MediaQueryListEvent) => void) | null = null

  const subscribe = () => {
    if (typeof window === 'undefined') return
    if (!mq) {
      mq = window.matchMedia(query)
      matches.value = mq.matches
      onChange = (e) => {
        matches.value = e.matches
      }
      mq.addEventListener?.('change', onChange)
    }
    listeners += 1
  }

  const unsubscribe = () => {
    listeners = Math.max(0, listeners - 1)
    if (listeners === 0 && mq && onChange) {
      mq.removeEventListener?.('change', onChange)
      mq = null
      onChange = null
    }
  }

  return { matches, subscribe, unsubscribe }
}

/** Subscribe for the lifetime of the caller's effect scope (component / store). */
function track(media: ReturnType<typeof createMediaRef>) {
  media.subscribe()
  if (getCurrentScope()) onScopeDispose(media.unsubscribe)
  return media.matches
}

const mobileRef = createMediaRef(MOBILE_MQ)
const deskRef = createMediaRef(DESK_MQ)

/** True at viewport widths ≤1023px (matches shell SCSS breakpoint). */
export function useMobileViewport() {
  return track(mobileRef)
}

/** True at viewport widths ≥1024px. */
export function useDeskViewport() {
  return track(deskRef)
}

/** Reactive matchMedia result for an arbitrary media query. */
export function useMediaQuery(query: string, defaultValue = false) {
  return track(createMediaRef(query, defaultValue))
}

export { DESK_MQ, MOBILE_MQ }

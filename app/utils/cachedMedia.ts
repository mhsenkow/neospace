/**
 * `matchMedia` without allocating a new MediaQueryList on every call.
 * `MediaQueryList.matches` is live, so one cached list per query stays current —
 * scroll / visualViewport handlers can read it every frame for free.
 */

const lists = new Map<string, MediaQueryList>()

export function matchesMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  let mql = lists.get(query)
  if (!mql) {
    mql = window.matchMedia(query)
    lists.set(query, mql)
  }
  return mql.matches
}

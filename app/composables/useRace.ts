/**
 * AbortController + seq guard for concurrent request races.
 */

export type RaceTicket = {
  seq: number
  signal: AbortSignal
  isCurrent: () => boolean
  abort: () => void
}

export function createRaceGuard() {
  let seq = 0
  let controller: AbortController | null = null

  const cancel = () => {
    controller?.abort()
    controller = null
  }

  /** Abort in flight and make every outstanding ticket stale (isCurrent → false) */
  const abort = () => {
    seq++
    cancel()
  }

  const next = (): RaceTicket => {
    cancel()
    const current = ++seq
    controller = new AbortController()
    const { signal } = controller
    return {
      seq: current,
      signal,
      isCurrent: () => current === seq,
      abort: () => {
        if (current === seq) cancel()
      },
    }
  }

  return { next, abort }
}

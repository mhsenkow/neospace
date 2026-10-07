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

  const abort = () => {
    controller?.abort()
    controller = null
  }

  const next = (): RaceTicket => {
    abort()
    const current = ++seq
    controller = new AbortController()
    const { signal } = controller
    return {
      seq: current,
      signal,
      isCurrent: () => current === seq,
      abort: () => {
        if (current === seq) abort()
      },
    }
  }

  return { next, abort }
}

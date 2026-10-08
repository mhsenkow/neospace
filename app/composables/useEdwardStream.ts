/**
 * Federated firehose for Edward Mode — seed + ~10s sinceId poll.
 */

import { useEdwardStore, EDWARD_MAX_BALLS } from '~/stores/edward'
import { useInstancesStore } from '~/stores/instances'
import { statusIdentity } from '~/utils/statusIdentity'

const POLL_MS = 10_000
const SEED_LIMIT = 40
const POLL_LIMIT = 20

export function useEdwardStream() {
  const edward = useEdwardStore()
  const instances = useInstancesStore()

  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  let sinceCursors: Record<string, string> = {}

  const topCursorForTargets = () => {
    const top = edward.statuses[0]
    if (!top) return {}
    const targets = instances.publicTimelineTargets()
    // sinceId is instance-local — prefer the status's home instance, else first target
    // (same pattern as TimelineColumn.fetchNewSince)
    const key =
      (top._instanceId && targets.some((t) => t.id === top._instanceId)
        ? top._instanceId
        : targets[0]?.id) || top._instanceId
    if (!key) return {}
    return { [key]: top.id }
  }

  const refreshSinceCursors = () => {
    sinceCursors = topCursorForTargets()
  }

  const seed = async () => {
    edward.setLoading(true)
    edward.setError(null)
    try {
      const page = await instances.fetchMergedTimeline('federated', SEED_LIMIT)
      edward.replaceStatuses(page)
      refreshSinceCursors()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load thought stream'
      edward.setError(msg)
      edward.replaceStatuses([])
    } finally {
      edward.setLoading(false)
    }
  }

  const poll = async () => {
    if (!edward.active || !running) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (!edward.statuses.length) {
      await seed()
      return
    }

    try {
      const cursors = { ...sinceCursors }
      if (!Object.keys(cursors).length) refreshSinceCursors()

      const newer = await instances.fetchMergedTimeline(
        'federated',
        POLL_LIMIT,
        Object.keys(sinceCursors).length ? { ...sinceCursors } : undefined,
        { since: true },
      )

      if (!edward.active) return

      // Filter to truly new by identity
      const existing = new Set(edward.statuses.map((s) => statusIdentity(s)))
      const fresh = newer.filter((s) => {
        const key = statusIdentity(s)
        return key && !existing.has(key)
      })

      if (fresh.length) {
        edward.mergeNewer(fresh)
        refreshSinceCursors()
      }
    } catch {
      // Soft-fail polls — keep the stream alive
    }
  }

  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && edward.active && running) {
      void poll()
    }
  }

  const start = async () => {
    if (running) return
    running = true
    edward.clearStatuses()
    await seed()
    if (!running) return
    timer = setInterval(() => {
      void poll()
    }, POLL_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
  }

  const stop = () => {
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    sinceCursors = {}
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  return {
    start,
    stop,
    poll,
    seed,
    maxBalls: EDWARD_MAX_BALLS,
  }
}

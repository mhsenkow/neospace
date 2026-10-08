/**
 * Federated firehose for Edward Mode — multi-server seed + fast sinceId poll.
 * Hits every connected instance's public federated (+ local) timelines when possible.
 */

import { useEdwardStore, EDWARD_MAX_BALLS } from '~/stores/edward'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { statusIdentity, dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import { isAuthGatedPublicHost } from '~/utils/instances'
import { publicClient } from '~/composables/useMasto'
import {
  emptyAffinityContext,
  type EdwardAffinityContext,
} from '~/utils/edwardAffinity'

const POLL_MS = 6_000
const SEED_LIMIT = 40
const POLL_LIMIT = 25
const FOLLOWING_PAGE = 80
const FOLLOWING_MAX = 300
const HOME_SAMPLE = 40

export function useEdwardStream() {
  const edward = useEdwardStore()
  const instances = useInstancesStore()
  const groups = useGroupsStore()

  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  /** Newest status id per instance for sinceId polls */
  let sinceCursors: Record<string, string> = {}
  let affinityLoaded = false

  const firehoseTargets = () => {
    // Watch every connected server — denser than active-only publicTimelineTargets
    if (instances.instances.length) return instances.instances
    return instances.publicTimelineTargets()
  }

  const refreshSinceCursors = () => {
    const next: Record<string, string> = {}
    for (const s of edward.statuses) {
      const id = s._instanceId
      if (!id || next[id]) continue
      // statuses are newest-first; first seen per instance is the since cursor
      next[id] = s.id
    }
    sinceCursors = next
  }

  const fetchFromTargets = async (
    limit: number,
    cursors?: Record<string, string>,
    opts?: { since?: boolean },
  ): Promise<ExtendedStatus[]> => {
    const targets = firehoseTargets()
    if (!targets.length) {
      return instances.fetchMergedTimeline('federated', limit, undefined, opts)
    }

    const errors: string[] = []
    const pages = await Promise.all(
      targets.map(async (instance) => {
        try {
          if (!instance.accessToken && isAuthGatedPublicHost(instance.url)) {
            errors.push(`${instance.name} requires login`)
            return [] as ExtendedStatus[]
          }
          const client = instances.getClient(instance.id)
          const cursor = cursors?.[instance.id]
          // Federated + local in parallel for denser stream
          const [fed, local] = await Promise.all([
            client.v1.timelines.public.list({
              local: false,
              limit,
              ...(cursor ? (opts?.since ? { sinceId: cursor } : { maxId: cursor }) : {}),
            }),
            client.v1.timelines.public.list({
              local: true,
              limit: Math.ceil(limit / 2),
              ...(cursor ? (opts?.since ? { sinceId: cursor } : {}) : {}),
            }),
          ])
          const map = (s: (typeof fed)[number]): ExtendedStatus => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          })
          return [...fed.map(map), ...local.map(map)]
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Failed'
          errors.push(`${instance.name}: ${message}`)
          return []
        }
      }),
    )

    let all = pages.flat()
    if (!all.length) {
      // Guest / gated fallback
      try {
        const client = publicClient()
        const statuses = await client.v1.timelines.public.list({ local: false, limit })
        all = statuses.map((s) => ({
          ...s,
          _instanceId: 'fallback',
          _instanceUrl: '',
        }))
      } catch {
        if (errors[0]) throw new Error(errors[0])
      }
    }

    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return dedupeStatusesByIdentity(all).slice(0, Math.max(limit, EDWARD_MAX_BALLS))
  }

  const loadAffinity = async () => {
    if (affinityLoaded) return
    affinityLoaded = true
    const ctx: EdwardAffinityContext = emptyAffinityContext()
    const user = instances.currentUser
    if (!user) {
      edward.setAffinity(ctx)
      return
    }

    ctx.selfAcct = (user.acct || '').replace(/^@/, '').toLowerCase() || null
    ctx.selfUsername = (user.username || '').toLowerCase() || null

    try {
      if (!groups.followedTags.length) {
        await groups.fetchFollowedTags().catch(() => {})
      }
      for (const t of groups.followedTags) {
        const name = (t.name || '').replace(/^#/, '').toLowerCase()
        if (name) ctx.tags.add(name)
      }
    } catch {
      /* soft */
    }

    try {
      const primary = instances.primaryInstance
      if (primary?.accessToken) {
        const client = instances.getClient(primary.id)
        const userId = user.id
        const collected: string[] = []
        let maxId: string | undefined
        while (collected.length < FOLLOWING_MAX) {
          const batch = await client.v1.accounts.$select(userId).following.list({
            limit: FOLLOWING_PAGE,
            maxId,
          })
          const list = Array.isArray(batch) ? batch : []
          if (!list.length) break
          for (const a of list) {
            const acct = (a.acct || '').replace(/^@/, '').toLowerCase()
            if (acct) {
              ctx.following.add(acct)
              collected.push(acct)
            }
          }
          if (list.length < FOLLOWING_PAGE) break
          maxId = list[list.length - 1]?.id
          if (!maxId) break
        }

        try {
          const home = await client.v1.timelines.home.list({ limit: HOME_SAMPLE })
          for (const s of home) {
            const body = s.reblog || s
            const acct = (body.account?.acct || '').replace(/^@/, '').toLowerCase()
            if (acct) ctx.homeAuthors.add(acct)
          }
        } catch {
          /* soft */
        }
      }
    } catch {
      /* guest / soft-fail */
    }

    if (!running) return
    edward.setAffinity(ctx)
  }

  const seed = async () => {
    edward.setLoading(true)
    edward.setError(null)
    try {
      void loadAffinity()
      const page = await fetchFromTargets(SEED_LIMIT)
      edward.replaceStatuses(page)
      refreshSinceCursors()
      edward.setSourceCount(firehoseTargets().length || 1)
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
      if (!Object.keys(sinceCursors).length) refreshSinceCursors()
      const newer = await fetchFromTargets(POLL_LIMIT, { ...sinceCursors }, { since: true })
      if (!edward.active) return

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
      /* soft-fail */
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
    affinityLoaded = false
    edward.clearStatuses()
    edward.setAffinity(emptyAffinityContext())
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
    affinityLoaded = false
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

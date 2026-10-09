/**
 * Federated firehose for Edward Mode — multi-server seed + fast sinceId poll.
 * Hits every connected instance's public federated (+ local) timelines when possible.
 */

import { useEdwardStore, EDWARD_MAX_BALLS, newestIdPerInstance } from '~/stores/edward'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { statusIdentity, dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import { hostnameOf, isAuthGatedPublicHost, resolvePublicInstanceUrl } from '~/utils/instances'
import { publicClient } from '~/composables/useMasto'
import {
  emptyAffinityContext,
  type EdwardAffinityContext,
} from '~/utils/edwardAffinity'
import { httpStatusFrom } from '~/utils/friendlyError'

/**
 * Mastodon allows ~300 requests / 5 min per account (and per IP for guests) —
 * shared with every other open column. Each poll costs 1–2 requests per server,
 * so poll at a calm pace, fetch `local` only every few polls, and back off hard
 * on 429 / errors instead of hammering through them.
 */
const POLL_MS = 12_000
const POLL_MAX_MS = 120_000
/** Federated every poll; local every Nth (it overlaps heavily anyway) */
const LOCAL_EVERY = 3
const SEED_LIMIT = 40
const POLL_LIMIT = 25
const FOLLOWING_PAGE = 80
const FOLLOWING_MAX = 300
const HOME_SAMPLE = 40
/** Who-you-follow barely changes between sessions — don't refetch it each time */
const AFFINITY_TTL_MS = 15 * 60_000
let affinityCache: { userKey: string; at: number; ctx: EdwardAffinityContext } | null = null

export function useEdwardStream() {
  const edward = useEdwardStore()
  const instances = useInstancesStore()
  const groups = useGroupsStore()

  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pollCount = 0
  let failStreak = 0
  /** Set by fetchFromTargets when any server answered 429 */
  let rateLimited = false
  /** Newest status id per instance for sinceId polls */
  let sinceCursors: Record<string, string> = {}
  let affinityLoaded = false

  const firehoseTargets = () => {
    // Watch every connected server — denser than active-only publicTimelineTargets
    if (instances.instances.length) return instances.instances
    return instances.publicTimelineTargets()
  }

  /**
   * Bumped by stop(): a seed / poll still in flight from a previous session
   * (or before an account switch) must not write into the next one.
   */
  let generation = 0

  const refreshSinceCursors = () => {
    sinceCursors = newestIdPerInstance(edward.statuses)
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
    let succeeded = 0
    // Seed always pulls local for density; polls only every few rounds
    const withLocal = !opts?.since || pollCount % LOCAL_EVERY === 0
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
            withLocal
              ? client.v1.timelines.public.list({
                  local: true,
                  limit: Math.ceil(limit / 2),
                  ...(cursor ? (opts?.since ? { sinceId: cursor } : {}) : {}),
                })
              : Promise.resolve([] as Awaited<ReturnType<typeof client.v1.timelines.public.list>>),
          ])
          succeeded += 1
          const map = (s: (typeof fed)[number]): ExtendedStatus => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          })
          return [...fed.map(map), ...local.map(map)]
        } catch (e: unknown) {
          if (httpStatusFrom(e) === 429) rateLimited = true
          const message = e instanceof Error ? e.message : 'Failed'
          errors.push(`${instance.name}: ${message}`)
          return []
        }
      }),
    )

    let all = pages.flat()
    // Guest fallback only when no server could answer — an empty *poll*
    // (nothing new since the cursor) must not pull a stranger's firehose in.
    if (!all.length && !succeeded && !rateLimited) {
      // Guest / gated fallback — tag the real host so likes can resolve later
      try {
        const fallbackUrl = resolvePublicInstanceUrl(
          instances.activeAccount?.url || instances.instances[0]?.url,
        )
        const client = publicClient(fallbackUrl)
        const statuses = await client.v1.timelines.public.list({ local: false, limit })
        const host = hostnameOf(fallbackUrl) || 'fallback'
        all = statuses.map((s) => ({
          ...s,
          _instanceId: `public:${host}`,
          _instanceUrl: fallbackUrl,
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
    const gen = generation
    const ctx: EdwardAffinityContext = emptyAffinityContext()
    const user = instances.currentUser
    if (!user) {
      edward.setAffinity(ctx)
      return
    }
    const userKey = `${instances.primaryInstance?.id || ''}:${user.id}`
    if (affinityCache && affinityCache.userKey === userKey && Date.now() - affinityCache.at < AFFINITY_TTL_MS) {
      edward.setAffinity(affinityCache.ctx)
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

    affinityCache = { userKey, at: Date.now(), ctx }
    if (!running || gen !== generation) return
    edward.setAffinity(ctx)
  }

  const seed = async () => {
    const gen = generation
    edward.setLoading(true)
    edward.setError(null)
    rateLimited = false
    try {
      void loadAffinity()
      const page = await fetchFromTargets(SEED_LIMIT)
      if (gen !== generation) return
      edward.replaceStatuses(page)
      refreshSinceCursors()
      edward.setSourceCount(firehoseTargets().length || 1)
      if (!page.length && rateLimited) {
        failStreak += 1
        edward.setError('Your server is rate-limiting us — the stream will fill in shortly.')
      }
    } catch (e: unknown) {
      if (gen !== generation) return
      const msg = e instanceof Error ? e.message : 'Failed to load thought stream'
      edward.setError(msg)
      edward.replaceStatuses([])
    } finally {
      if (gen === generation) edward.setLoading(false)
    }
  }

  let inFlight = false
  let lastPollAt = 0

  const poll = async () => {
    if (!edward.active || !running || inFlight) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    inFlight = true
    lastPollAt = Date.now()
    rateLimited = false
    pollCount += 1
    const gen = generation
    let failed = false
    // Re-seeding manages its own backoff bookkeeping
    const reseeding = !edward.statuses.length
    try {
      if (reseeding) {
        await seed()
        return
      }
      if (!Object.keys(sinceCursors).length) refreshSinceCursors()
      const newer = await fetchFromTargets(POLL_LIMIT, { ...sinceCursors }, { since: true })
      if (!edward.active || gen !== generation) return

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
      // Every server (and the guest fallback) failed — offline, DNS, 5xx.
      // Back off like a 429 instead of retrying at full pace.
      failed = true
    } finally {
      // A stale poll must not clear the next run's in-flight flag / backoff
      if (gen === generation) {
        inFlight = false
        if (!reseeding) failStreak = rateLimited || failed ? failStreak + 1 : 0
      }
    }
  }

  /** Next poll delay: calm by default, doubling per consecutive rate-limit */
  const nextDelay = () =>
    failStreak ? Math.min(POLL_MAX_MS, POLL_MS * 2 ** failStreak) : POLL_MS

  const schedule = () => {
    if (!running) return
    const gen = generation
    timer = setTimeout(async () => {
      timer = null
      await poll()
      // stop() (+ start()) while this poll was in flight: the new run has its own loop
      if (gen === generation) schedule()
    }, nextDelay())
  }

  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible' || !edward.active || !running) return
    // Coming back to the tab: catch up once, unless we polled moments ago
    // or the server asked us to back off.
    if (failStreak || Date.now() - lastPollAt < POLL_MS / 2) return
    void poll()
  }

  const start = async () => {
    if (running) return
    running = true
    affinityLoaded = false
    pollCount = 0
    failStreak = 0
    edward.clearStatuses()
    edward.setAffinity(emptyAffinityContext())
    const gen = generation
    await seed()
    if (!running || gen !== generation) return
    lastPollAt = Date.now()
    schedule()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
  }

  const stop = () => {
    running = false
    generation += 1
    inFlight = false
    affinityLoaded = false
    if (timer) {
      clearTimeout(timer)
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
